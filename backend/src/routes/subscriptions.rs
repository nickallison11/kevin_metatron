use std::sync::Arc;

use axum::{
    extract::State,
    http::StatusCode,
    routing::{get, post},
    Json, Router,
};
use axum_extra::{
    headers::{authorization::Bearer, Authorization},
    TypedHeader,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use uuid::Uuid;

use crate::identity::require_user;
use crate::email;
use crate::state::AppState;

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/nonce", get(get_nonce))
        .route("/confirm", post(confirm_subscription))
        .route("/status", get(get_status))
}

#[derive(Serialize)]
struct NonceResponse {
    nonce: String,
}

async fn get_nonce(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
) -> Result<Json<NonceResponse>, (StatusCode, String)> {
    let authed = require_user(&state, bearer.token()).await?;
    let nonce = Uuid::new_v4().to_string();

    sqlx::query("UPDATE users SET pending_payment_nonce = $1 WHERE id = $2")
        .bind(&nonce)
        .bind(authed.id)
        .execute(&state.db)
        .await
        .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "internal error".to_string()))?;

    Ok(Json(NonceResponse { nonce }))
}

#[derive(Deserialize)]
struct ConfirmBody {
    signature: String,
    tier: String,
}

#[derive(Serialize)]
struct ConfirmResponse {
    status: String,
    tier: String,
    period_end: String,
}

async fn confirm_subscription(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
    Json(body): Json<ConfirmBody>,
) -> Result<Json<ConfirmResponse>, (StatusCode, Json<Value>)> {
    let authed = require_user(&state, bearer.token())
        .await
        .map_err(|(_, msg)| (StatusCode::UNAUTHORIZED, Json(json!({ "error": msg }))))?;
    let user_email: String = sqlx::query_scalar("SELECT email FROM users WHERE id = $1")
        .bind(authed.id)
        .fetch_one(&state.db)
        .await
        .map_err(|_| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "internal error" })),
            )
        })?;

    let tier = body.tier.to_ascii_lowercase();
    if tier != "monthly" && tier != "annual" {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "tier must be monthly or annual" })),
        ));
    }

    let pending_nonce: Option<String> =
        sqlx::query_scalar("SELECT pending_payment_nonce FROM users WHERE id = $1")
            .bind(authed.id)
            .fetch_optional(&state.db)
            .await
            .map_err(|_| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({ "error": "internal error" })),
                )
            })?
            .flatten();

    let pending_nonce = pending_nonce.ok_or((
        StatusCode::BAD_REQUEST,
        Json(json!({ "error": "no pending payment" })),
    ))?;

    let rpc_req = json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "getTransaction",
        "params": [
            body.signature,
            {
                "encoding": "jsonParsed",
                "commitment": "finalized",
                "maxSupportedTransactionVersion": 0
            }
        ]
    });

    let rpc_res = state
        .http_client
        .post(&state.solana_rpc_url)
        .json(&rpc_req)
        .send()
        .await
        .map_err(|_| {
            (
                StatusCode::BAD_GATEWAY,
                Json(json!({ "error": "rpc request failed" })),
            )
        })?;

    let rpc_json: Value = rpc_res.json().await.map_err(|_| {
        (
            StatusCode::BAD_GATEWAY,
            Json(json!({ "error": "rpc parse failed" })),
        )
    })?;

    let result = rpc_json.get("result").cloned().unwrap_or(Value::Null);
    if result.is_null() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "transaction not found or not finalized" })),
        ));
    }

    if !result
        .get("meta")
        .and_then(|m| m.get("err"))
        .unwrap_or(&Value::Null)
        .is_null()
    {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "transaction failed on chain" })),
        ));
    }

    let required_amount = if tier == "monthly" {
        "9990000"
    } else {
        "99000000"
    };

    let instructions = result
        .get("transaction")
        .and_then(|t| t.get("message"))
        .and_then(|m| m.get("instructions"))
        .and_then(|i| i.as_array())
        .cloned()
        .unwrap_or_default();

    let has_matching_transfer = instructions.iter().any(|ix| {
        let parsed = ix.get("parsed").unwrap_or(&Value::Null);
        let info = parsed.get("info").unwrap_or(&Value::Null);
        let ix_type = parsed.get("type").and_then(|v| v.as_str()).unwrap_or("");
        let mint = info.get("mint").and_then(|v| v.as_str()).unwrap_or("");
        let amount = info
            .get("tokenAmount")
            .and_then(|ta| ta.get("amount"))
            .and_then(|v| v.as_str())
            .unwrap_or("");
        ix_type == "transferChecked" && mint == state.usdc_mint && amount == required_amount
    });
    if !has_matching_transfer {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "required USDC transfer not found" })),
        ));
    }

    let post_balances = result
        .get("meta")
        .and_then(|m| m.get("postTokenBalances"))
        .and_then(|b| b.as_array())
        .cloned()
        .unwrap_or_default();
    let treasury_received = post_balances.iter().any(|bal| {
        let owner = bal.get("owner").and_then(|v| v.as_str()).unwrap_or("");
        let mint = bal.get("mint").and_then(|v| v.as_str()).unwrap_or("");
        owner == state.solana_treasury && mint == state.usdc_mint
    });
    if !treasury_received {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "treasury receipt not found" })),
        ));
    }

    let memo_contains_nonce = instructions.iter().any(|ix| {
        if let Some(parsed) = ix.get("parsed") {
            return value_contains_text(parsed, &pending_nonce);
        }
        false
    });
    if !memo_contains_nonce {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "memo nonce not found" })),
        ));
    }

    let period_end: String = if tier == "monthly" {
        sqlx::query_scalar(
            r#"
            UPDATE users
            SET pending_payment_nonce = NULL,
                subscription_tier = 'monthly',
                subscription_status = 'active',
                subscription_period_end = NOW() + INTERVAL '30 days'
            WHERE id = $1
            RETURNING subscription_period_end::text
            "#,
        )
        .bind(authed.id)
        .fetch_one(&state.db)
        .await
        .map_err(|_| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "internal error" })),
            )
        })?
    } else {
        sqlx::query_scalar(
            r#"
            UPDATE users
            SET pending_payment_nonce = NULL,
                subscription_tier = 'annual',
                subscription_status = 'active',
                subscription_period_end = NOW() + INTERVAL '365 days'
            WHERE id = $1
            RETURNING subscription_period_end::text
            "#,
        )
        .bind(authed.id)
        .fetch_one(&state.db)
        .await
        .map_err(|_| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "internal error" })),
            )
        })?
    };

    let amount_paid = if tier == "monthly" { "$9.99 USDC" } else { "$99.00 USDC" };
    email::send_email(
        &state.http_client,
        state.resend_api_key.as_deref(),
        &state.email_from,
        &user_email,
        "You're now on metatron Pro 🚀",
        &email::pro_activated_email_html(&period_end, amount_paid),
    )
    .await;

    Ok(Json(ConfirmResponse {
        status: "active".to_string(),
        tier,
        period_end,
    }))
}

fn value_contains_text(v: &Value, needle: &str) -> bool {
    match v {
        Value::String(s) => s.contains(needle),
        Value::Array(a) => a.iter().any(|x| value_contains_text(x, needle)),
        Value::Object(o) => o.values().any(|x| value_contains_text(x, needle)),
        _ => false,
    }
}

#[derive(Serialize)]
struct StatusResponse {
    subscription_tier: String,
    subscription_status: String,
    subscription_period_end: Option<String>,
}

async fn get_status(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
) -> Result<Json<StatusResponse>, (StatusCode, String)> {
    let authed = require_user(&state, bearer.token()).await?;

    let (subscription_tier, subscription_status, subscription_period_end): (
        String,
        String,
        Option<String>,
    ) = sqlx::query_as(
        r#"
        SELECT
            subscription_tier,
            subscription_status,
            subscription_period_end::text
        FROM users
        WHERE id = $1
        "#,
    )
    .bind(authed.id)
    .fetch_one(&state.db)
    .await
    .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "internal error".to_string()))?;

    Ok(Json(StatusResponse {
        subscription_tier,
        subscription_status,
        subscription_period_end,
    }))
}

use std::sync::Arc;

use axum::{
    extract::{Path, State},
    http::StatusCode,
    routing::{get, post},
    Json, Router,
};
use axum_extra::{
    headers::{authorization::Bearer, Authorization},
    TypedHeader,
};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use uuid::Uuid;

use crate::email;
use crate::identity::require_user;
use crate::routes::commerce::{finalize_connector_subscription, finalize_investor_subscription};
use crate::routes::subscription_finalize::finalize_pro_subscription;
use crate::state::AppState;

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/nonce", get(get_nonce))
        // Solana USD path disabled — replaced by NowPayments (`/commerce/nowpayments/subscribe`).
        // .route("/confirm", post(confirm_subscription))
        .route("/status", get(get_status))
        .route("/invoices/:id", get(get_invoice))
        .route("/invoices", get(get_invoices))
        .route(
            "/cancel",
            post(cancel_subscription).delete(undo_cancel_subscription),
        )
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

#[allow(dead_code)]
async fn confirm_subscription(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
    Json(body): Json<ConfirmBody>,
) -> Result<Json<ConfirmResponse>, (StatusCode, Json<Value>)> {
    let authed = require_user(&state, bearer.token())
        .await
        .map_err(|(_, msg)| (StatusCode::UNAUTHORIZED, Json(json!({ "error": msg }))))?;

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
        let mint_ok = mint == state.usdc_mint.as_str() || mint == state.usdt_mint.as_str();
        ix_type == "transferChecked" && mint_ok && amount == required_amount
    });
    if !has_matching_transfer {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "required USDC or USDT transfer not found" })),
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
        let mint_ok = mint == state.usdc_mint.as_str() || mint == state.usdt_mint.as_str();
        owner == state.solana_treasury && mint_ok
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

    let payment_method = instructions
        .iter()
        .find_map(|ix| {
            let parsed = ix.get("parsed")?;
            let info = parsed.get("info")?;
            let ix_type = parsed.get("type").and_then(|v| v.as_str())?;
            let mint = info.get("mint").and_then(|v| v.as_str())?;
            let amount = info
                .get("tokenAmount")
                .and_then(|ta| ta.get("amount"))
                .and_then(|v| v.as_str())?;
            let mint_ok = mint == state.usdc_mint.as_str() || mint == state.usdt_mint.as_str();
            if ix_type == "transferChecked" && mint_ok && amount == required_amount {
                if mint == state.usdt_mint.as_str() {
                    return Some("usdt");
                }
                return Some("usdc");
            }
            None
        })
        .unwrap_or("usdc");

    let (invoice_amount, amount_paid_display) = if tier == "monthly" {
        (Decimal::new(999, 2), "$9.99 USDC/USDT")
    } else {
        (Decimal::new(9900, 2), "$99.00 USDC/USDT")
    };

    let sig = body.signature.as_str();
    let period_end = match authed.role.as_str() {
        "INVESTOR" => {
            finalize_investor_subscription(
                &state,
                authed.id,
                &tier,
                payment_method,
                Some(sig),
                "USD",
                invoice_amount,
            )
            .await?;
            sqlx::query_scalar::<_, String>(
                r#"SELECT period_end::text FROM subscription_invoices WHERE user_id = $1 AND reference = $2 ORDER BY created_at DESC LIMIT 1"#,
            )
            .bind(authed.id)
            .bind(sig)
            .fetch_optional(&state.db)
            .await
            .map_err(|_| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({ "error": "internal error" })),
                )
            })?
            .ok_or_else(|| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({ "error": "internal error" })),
                )
            })?
        }
        "INTERMEDIARY" => {
            finalize_connector_subscription(
                &state,
                authed.id,
                &tier,
                payment_method,
                Some(sig),
                "USD",
                invoice_amount,
            )
            .await?;
            sqlx::query_scalar::<_, String>(
                r#"SELECT period_end::text FROM subscription_invoices WHERE user_id = $1 AND reference = $2 ORDER BY created_at DESC LIMIT 1"#,
            )
            .bind(authed.id)
            .bind(sig)
            .fetch_optional(&state.db)
            .await
            .map_err(|_| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({ "error": "internal error" })),
                )
            })?
            .ok_or_else(|| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({ "error": "internal error" })),
                )
            })?
        }
        _ => {
            finalize_pro_subscription(
                &state,
                authed.id,
                &tier,
                amount_paid_display,
                payment_method,
                Some(sig),
                "USD",
                invoice_amount,
            )
            .await?
        }
    };

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
    cancel_at_period_end: bool,
}

async fn get_status(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
) -> Result<Json<StatusResponse>, (StatusCode, String)> {
    let authed = require_user(&state, bearer.token()).await?;

    let (subscription_tier, subscription_status, subscription_period_end, cancel_at_period_end): (
        String,
        String,
        Option<String>,
        bool,
    ) = sqlx::query_as(
        r#"
        SELECT
            subscription_tier,
            subscription_status,
            subscription_period_end::text,
            cancel_at_period_end
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
        cancel_at_period_end,
    }))
}

#[derive(Serialize)]
struct InvoiceRow {
    id: String,
    amount: f64,
    currency: String,
    payment_method: String,
    tier: String,
    period_start: String,
    period_end: String,
    reference: Option<String>,
    created_at: String,
}

#[derive(Serialize)]
struct InvoiceDetailResponse {
    #[serde(flatten)]
    invoice: InvoiceRow,
    email: String,
}

async fn get_invoice(
    State(state): State<Arc<AppState>>,
    Path(invoice_id): Path<Uuid>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
) -> Result<Json<InvoiceDetailResponse>, (StatusCode, String)> {
    let authed = require_user(&state, bearer.token()).await?;

    let row: Option<(
        String,
        f64,
        String,
        String,
        String,
        String,
        String,
        Option<String>,
        String,
        String,
    )> = sqlx::query_as(
        r#"
        SELECT
            subscription_invoices.id::text,
            COALESCE(subscription_invoices.amount::float8, 0),
            subscription_invoices.currency,
            subscription_invoices.payment_method,
            subscription_invoices.tier,
            subscription_invoices.period_start::text,
            subscription_invoices.period_end::text,
            subscription_invoices.reference,
            subscription_invoices.created_at::text,
            users.email
        FROM subscription_invoices
        INNER JOIN users ON users.id = subscription_invoices.user_id
        WHERE subscription_invoices.id = $1 AND subscription_invoices.user_id = $2
        "#,
    )
    .bind(invoice_id)
    .bind(authed.id)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "internal error".to_string()))?;

    let Some((
        id,
        amount,
        currency,
        payment_method,
        tier,
        period_start,
        period_end,
        reference,
        created_at,
        email,
    )) = row
    else {
        return Err((StatusCode::NOT_FOUND, "invoice not found".to_string()));
    };

    Ok(Json(InvoiceDetailResponse {
        invoice: InvoiceRow {
            id,
            amount,
            currency,
            payment_method,
            tier,
            period_start,
            period_end,
            reference,
            created_at,
        },
        email,
    }))
}

async fn get_invoices(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
) -> Result<Json<Vec<InvoiceRow>>, (StatusCode, String)> {
    let authed = require_user(&state, bearer.token()).await?;

    let rows: Vec<(
        String,
        f64,
        String,
        String,
        String,
        String,
        String,
        Option<String>,
        String,
    )> = sqlx::query_as(
        r#"
        SELECT
            id::text,
            COALESCE(amount::float8, 0),
            currency,
            payment_method,
            tier,
            period_start::text,
            period_end::text,
            reference,
            created_at::text
        FROM subscription_invoices
        WHERE user_id = $1
        ORDER BY created_at DESC
        "#,
    )
    .bind(authed.id)
    .fetch_all(&state.db)
    .await
    .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "internal error".to_string()))?;

    Ok(Json(
        rows.into_iter()
            .map(
                |(
                    id,
                    amount,
                    currency,
                    payment_method,
                    tier,
                    period_start,
                    period_end,
                    reference,
                    created_at,
                )| InvoiceRow {
                    id,
                    amount,
                    currency,
                    payment_method,
                    tier,
                    period_start,
                    period_end,
                    reference,
                    created_at,
                },
            )
            .collect(),
    ))
}

async fn cancel_subscription(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
) -> Result<StatusCode, (StatusCode, String)> {
    let authed = require_user(&state, bearer.token()).await?;

    if let Some(secret) = state.paystack_secret_key.as_deref().filter(|s| !s.is_empty()) {
        let row: Option<(Option<String>, Option<String>)> = sqlx::query_as(
            "SELECT paystack_subscription_code, paystack_email_token FROM users WHERE id = $1",
        )
        .bind(authed.id)
        .fetch_optional(&state.db)
        .await
        .ok()
        .flatten();

        if let Some((Some(code), Some(token))) = row {
            if !code.is_empty() && !token.is_empty() {
                let _ = state
                    .http_client
                    .post("https://api.paystack.co/subscription/disable")
                    .header("Authorization", format!("Bearer {}", secret))
                    .header("Content-Type", "application/json")
                    .json(&json!({ "code": code, "token": token }))
                    .send()
                    .await;
            }
        }
    }

    let period_end: Option<String> = sqlx::query_scalar(
        r#"
        UPDATE users
        SET cancel_at_period_end = TRUE
        WHERE id = $1 AND subscription_status = 'active'
        RETURNING subscription_period_end::text
        "#,
    )
    .bind(authed.id)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "internal error".to_string()))?;

    let Some(period_end) = period_end else {
        return Err((StatusCode::BAD_REQUEST, "no active subscription".to_string()));
    };

    let user_email: String = sqlx::query_scalar("SELECT email FROM users WHERE id = $1")
        .bind(authed.id)
        .fetch_one(&state.db)
        .await
        .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "internal error".to_string()))?;

    email::send_email(
        &state.http_client,
        state.resend_api_key.as_deref(),
        &state.email_from,
        &user_email,
        "Your metatron Pro cancellation is confirmed",
        &email::subscription_cancelled_email_html(&period_end),
    )
    .await;

    Ok(StatusCode::OK)
}

async fn undo_cancel_subscription(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
) -> Result<StatusCode, (StatusCode, String)> {
    let authed = require_user(&state, bearer.token()).await?;

    let n = sqlx::query(
        r#"
        UPDATE users
        SET cancel_at_period_end = FALSE
        WHERE id = $1 AND subscription_status = 'active'
        "#,
    )
    .bind(authed.id)
    .execute(&state.db)
    .await
    .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "internal error".to_string()))?
    .rows_affected();

    if n == 0 {
        return Err((StatusCode::BAD_REQUEST, "no active subscription".to_string()));
    }

    Ok(StatusCode::OK)
}

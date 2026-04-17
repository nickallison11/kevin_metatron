use std::sync::Arc;

use axum::body::Bytes;
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::routing::post;
use axum::Json;
use axum::Router;
use axum_extra::{
    headers::{authorization::Bearer, Authorization},
    TypedHeader,
};
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::Sha512;
use uuid::Uuid;
use rust_decimal::Decimal;
use std::str::FromStr;

use crate::identity::require_user;
use crate::routes::subscriptions::finalize_pro_subscription;
use crate::state::AppState;

type HmacSha512 = Hmac<Sha512>;

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/subscribe", post(create_subscription))
        .route("/verify", post(verify_payment))
        .route("/connector/subscribe", post(create_connector_subscription))
        .route("/connector/verify", post(verify_connector_payment))
        .route("/investor/subscribe", post(create_investor_subscription))
        .route("/investor/verify", post(verify_investor_payment))
        .route("/webhook", post(webhook))
}

#[derive(Deserialize)]
struct SubscribeBody {
    tier: String,
    billing: String,
    currency: String,
}

#[derive(Deserialize)]
struct ConnectorSubscribeBody {
    billing: String,
}

#[derive(Deserialize)]
struct InvestorSubscribeBody {
    billing: String,
}

async fn create_subscription(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
    Json(body): Json<SubscribeBody>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let secret = state.paystack_secret_key.as_deref().filter(|s| !s.is_empty()).ok_or_else(|| {
        (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({ "error": "Paystack not configured" })),
        )
    })?;

    let authed = require_user(&state, bearer.token())
        .await
        .map_err(|(_, msg)| (StatusCode::UNAUTHORIZED, Json(json!({ "error": msg }))))?;

    let tier = body.tier.to_ascii_lowercase();
    if tier != "founder_basic" {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "tier must be founder_basic" })),
        ));
    }

    let billing = body.billing.to_ascii_lowercase();
    if billing != "monthly" && billing != "annual" {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "billing must be monthly or annual" })),
        ));
    }

    if body.currency.to_uppercase() != "ZAR" {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "currency must be ZAR" })),
        ));
    }

    let plan_code = match billing.as_str() {
        "annual" => state.paystack_plan_basic_annual.as_str(),
        _ => state.paystack_plan_basic_monthly.as_str(),
    };

    if plan_code.is_empty() {
        return Err((
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({ "error": "Paystack plan codes not configured" })),
        ));
    }

    let (user_id, user_email): (Uuid, String) = sqlx::query_as(
        "SELECT id, email FROM users WHERE id = $1",
    )
    .bind(authed.id)
    .fetch_one(&state.db)
    .await
    .map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "internal error" })),
        )
    })?;

    let amount_kobo: i64 = match billing.as_str() {
        "annual" => 169999,
        _ => 16999,
    };

    let reference = Uuid::new_v4().to_string();

    let payload = json!({
        "email": user_email,
        "amount": amount_kobo,
        "currency": "ZAR",
        "plan": plan_code,
        "reference": reference,
        "callback_url": format!(
            "https://platform.metatron.id/pricing?success=1&reference={}&redirect={}",
            reference,
            urlencoding::encode("/startup/settings/subscription")
        ),
        "metadata": {
            "user_id": user_id.to_string(),
            "tier": "founder_basic",
            "billing": billing,
            "currency": "ZAR"
        }
    });

    let res = state
        .http_client
        .post("https://api.paystack.co/transaction/initialize")
        .header("Authorization", format!("Bearer {}", secret))
        .header("Content-Type", "application/json")
        .json(&payload)
        .send()
        .await
        .map_err(|_| {
            (
                StatusCode::BAD_GATEWAY,
                Json(json!({ "error": "paystack request failed" })),
            )
        })?;

    let json: Value = res.json().await.map_err(|_| {
        (
            StatusCode::BAD_GATEWAY,
            Json(json!({ "error": "paystack parse failed" })),
        )
    })?;

    if !json.get("status").and_then(|s| s.as_bool()).unwrap_or(false) {
        let msg = json
            .get("message")
            .and_then(|m| m.as_str())
            .unwrap_or("paystack error");
        tracing::warn!("paystack subscribe initialize: {}", msg);
        return Err((
            StatusCode::BAD_GATEWAY,
            Json(json!({ "error": msg })),
        ));
    }

    let authorization_url = json
        .get("data")
        .and_then(|d| d.get("authorization_url"))
        .and_then(|u| u.as_str())
        .ok_or_else(|| {
            (
                StatusCode::BAD_GATEWAY,
                Json(json!({ "error": "missing authorization_url" })),
            )
        })?;

    Ok(Json(json!({ "hosted_url": authorization_url })))
}

async fn create_connector_subscription(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
    Json(body): Json<ConnectorSubscribeBody>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let secret = state
        .paystack_secret_key
        .as_deref()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| {
            (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(json!({ "error": "Paystack not configured" })),
            )
        })?;

    let authed = require_user(&state, bearer.token())
        .await
        .map_err(|(_, msg)| (StatusCode::UNAUTHORIZED, Json(json!({ "error": msg }))))?;
    if authed.role != "INTERMEDIARY" {
        return Err((
            StatusCode::FORBIDDEN,
            Json(json!({ "error": "wrong role for this resource" })),
        ));
    }

    let billing = body.billing.to_ascii_lowercase();
    if billing != "monthly" && billing != "annual" {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "billing must be monthly or annual" })),
        ));
    }

    let plan_code = match billing.as_str() {
        "annual" => state.paystack_connector_plan_basic_annual.as_str(),
        _ => state.paystack_connector_plan_basic_monthly.as_str(),
    };
    if plan_code.is_empty() {
        return Err((
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({ "error": "Connector Paystack plan codes not configured" })),
        ));
    }

    let (user_id, user_email): (Uuid, String) = sqlx::query_as(
        "SELECT id, email FROM users WHERE id = $1",
    )
    .bind(authed.id)
    .fetch_one(&state.db)
    .await
    .map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "internal error" })),
        )
    })?;

    let amount_kobo: i64 = if billing == "annual" { 169_999 } else { 16_999 };
    let reference = Uuid::new_v4().to_string();
    let payload = json!({
        "email": user_email,
        "amount": amount_kobo,
        "currency": "ZAR",
        "plan": plan_code,
        "reference": reference,
        "callback_url": format!(
            "{}/connector/settings/subscription?success=1&reference={}",
            state.frontend_url, reference
        ),
        "metadata": {
            "user_id": user_id.to_string(),
            "tier": "connector_basic",
            "billing": billing,
            "currency": "ZAR"
        }
    });

    let res = state
        .http_client
        .post("https://api.paystack.co/transaction/initialize")
        .header("Authorization", format!("Bearer {}", secret))
        .header("Content-Type", "application/json")
        .json(&payload)
        .send()
        .await
        .map_err(|_| {
            (
                StatusCode::BAD_GATEWAY,
                Json(json!({ "error": "paystack request failed" })),
            )
        })?;
    let json: Value = res.json().await.map_err(|_| {
        (
            StatusCode::BAD_GATEWAY,
            Json(json!({ "error": "paystack parse failed" })),
        )
    })?;
    if !json.get("status").and_then(|s| s.as_bool()).unwrap_or(false) {
        let msg = json
            .get("message")
            .and_then(|m| m.as_str())
            .unwrap_or("paystack error");
        return Err((StatusCode::BAD_GATEWAY, Json(json!({ "error": msg }))));
    }

    let authorization_url = json
        .get("data")
        .and_then(|d| d.get("authorization_url"))
        .and_then(|u| u.as_str())
        .ok_or_else(|| {
            (
                StatusCode::BAD_GATEWAY,
                Json(json!({ "error": "missing authorization_url" })),
            )
        })?;
    Ok(Json(json!({ "hosted_url": authorization_url })))
}

#[derive(Deserialize)]
struct VerifyBody {
    reference: String,
}

#[derive(Serialize)]
struct VerifyResponse {
    status: &'static str,
}

fn connector_plan_code_to_billing(state: &AppState, plan_code: &str) -> Option<&'static str> {
    if !state.paystack_connector_plan_basic_monthly.is_empty()
        && plan_code == state.paystack_connector_plan_basic_monthly
    {
        return Some("monthly");
    }
    if !state.paystack_connector_plan_basic_annual.is_empty()
        && plan_code == state.paystack_connector_plan_basic_annual
    {
        return Some("annual");
    }
    None
}

fn investor_plan_code_to_billing(state: &AppState, plan_code: &str) -> Option<&'static str> {
    if !state.paystack_investor_plan_basic_monthly.is_empty()
        && plan_code == state.paystack_investor_plan_basic_monthly
    {
        return Some("monthly");
    }
    if !state.paystack_investor_plan_basic_annual.is_empty()
        && plan_code == state.paystack_investor_plan_basic_annual
    {
        return Some("annual");
    }
    None
}

async fn finalize_connector_subscription(
    state: &AppState,
    user_id: Uuid,
    billing: &str,
    payment_method: &str,
    reference: Option<&str>,
) -> Result<(), (StatusCode, Json<Value>)> {
    let credits_to_add = if billing == "annual" { 600 } else { 50 };
    let (period_end, period_start): (String, String) = if billing == "annual" {
        sqlx::query_as(
            r#"
            SELECT
                (NOW() + INTERVAL '365 days')::text AS period_end,
                NOW()::text AS period_start
            "#,
        )
        .fetch_one(&state.db)
        .await
        .map_err(|_| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "internal error" })),
            )
        })?
    } else {
        sqlx::query_as(
            r#"
            SELECT
                (NOW() + INTERVAL '30 days')::text AS period_end,
                NOW()::text AS period_start
            "#,
        )
        .fetch_one(&state.db)
        .await
        .map_err(|_| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "internal error" })),
            )
        })?
    };

    sqlx::query(
        r#"
        INSERT INTO connector_profiles (user_id, connector_tier, enrichment_credits)
        VALUES ($1, 'paid', $2)
        ON CONFLICT (user_id) DO UPDATE
        SET connector_tier='paid',
            enrichment_credits = connector_profiles.enrichment_credits + $2,
            updated_at = now()
        "#,
    )
    .bind(user_id)
    .bind(credits_to_add)
    .execute(&state.db)
    .await
    .map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "internal error" })),
        )
    })?;

    sqlx::query(
        r#"
        INSERT INTO subscription_invoices (user_id, amount, currency, payment_method, tier, period_start, period_end, reference)
        VALUES ($1, $2, $3, $4, $5, $6::timestamptz, $7::timestamptz, $8)
        "#,
    )
    .bind(user_id)
    .bind(if billing == "annual" {
        Decimal::from_str("1699.99").unwrap()
    } else {
        Decimal::from_str("169.99").unwrap()
    })
    .bind("ZAR")
    .bind(payment_method)
    .bind("connector_basic")
    .bind(&period_start)
    .bind(&period_end)
    .bind(reference)
    .execute(&state.db)
    .await
    .map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "internal error" })),
        )
    })?;

    Ok(())
}

async fn finalize_investor_subscription(
    state: &AppState,
    user_id: Uuid,
    billing: &str,
    payment_method: &str,
    reference: Option<&str>,
) -> Result<(), (StatusCode, Json<Value>)> {
    let (period_end, period_start): (String, String) = if billing == "annual" {
        sqlx::query_as(
            "SELECT (NOW() + INTERVAL '365 days')::text AS period_end, NOW()::text AS period_start",
        )
        .fetch_one(&state.db)
        .await
        .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "internal error" }))))?
    } else {
        sqlx::query_as(
            "SELECT (NOW() + INTERVAL '30 days')::text AS period_end, NOW()::text AS period_start",
        )
        .fetch_one(&state.db)
        .await
        .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "internal error" }))))?
    };

    sqlx::query(
        r#"INSERT INTO investor_profiles (user_id, investor_tier)
           VALUES ($1, 'basic')
           ON CONFLICT (user_id) DO UPDATE SET investor_tier = 'basic', updated_at = NOW()"#,
    )
    .bind(user_id)
    .execute(&state.db)
    .await
    .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "internal error" }))))?;

    sqlx::query(
        r#"INSERT INTO subscription_invoices (user_id, amount, currency, payment_method, tier, period_start, period_end, reference)
           VALUES ($1, $2, $3, $4, $5, $6::timestamptz, $7::timestamptz, $8)"#,
    )
    .bind(user_id)
    .bind(if billing == "annual" {
        Decimal::from_str("1699.99").unwrap()
    } else {
        Decimal::from_str("169.99").unwrap()
    })
    .bind("ZAR")
    .bind(payment_method)
    .bind("investor_basic")
    .bind(&period_start)
    .bind(&period_end)
    .bind(reference)
    .execute(&state.db)
    .await
    .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "internal error" }))))?;

    Ok(())
}

fn plan_code_to_billing(state: &AppState, plan_code: &str) -> Option<&'static str> {
    if !state.paystack_plan_basic_monthly.is_empty()
        && plan_code == state.paystack_plan_basic_monthly
    {
        return Some("monthly");
    }
    if !state.paystack_plan_basic_annual.is_empty() && plan_code == state.paystack_plan_basic_annual
    {
        return Some("annual");
    }
    None
}

/// Resolves finalize tier (`monthly` | `annual`) from Paystack `plan` or metadata.
fn resolve_finalize_tier(
    state: &AppState,
    data: &Value,
    metadata: &Value,
) -> Result<String, (StatusCode, Json<Value>)> {
    if let Some(plan) = data.get("plan") {
        if let Some(code) = plan.get("plan_code").and_then(|c| c.as_str()) {
            if let Some(b) = plan_code_to_billing(state, code) {
                return Ok(b.to_string());
            }
        }
    }

    let tier_str = metadata
        .get("tier")
        .and_then(|t| t.as_str())
        .unwrap_or("monthly");

    if tier_str.eq_ignore_ascii_case("founder_basic") {
        let billing = metadata
            .get("billing")
            .and_then(|b| b.as_str())
            .unwrap_or("monthly")
            .to_ascii_lowercase();
        if billing == "annual" {
            return Ok("annual".to_string());
        }
        return Ok("monthly".to_string());
    }

    let tier_lower = tier_str.to_ascii_lowercase();
    if tier_lower == "monthly" || tier_lower == "annual" {
        return Ok(tier_lower);
    }

    Err((
        StatusCode::BAD_REQUEST,
        Json(json!({ "error": "invalid tier metadata" })),
    ))
}

fn zar_amounts_for_billing(billing: &str) -> (&'static str, Decimal) {
    match billing {
        "annual" => ("R1,699.99 ZAR", Decimal::from_str("1699.99").unwrap()),
        _ => ("R169.99 ZAR", Decimal::from_str("169.99").unwrap()),
    }
}

fn usd_amounts_for_billing(billing: &str) -> (&'static str, Decimal) {
    match billing {
        "annual" => ("$99.99 USD", Decimal::from_str("99.99").unwrap()),
        _ => ("$9.99 USD", Decimal::from_str("9.99").unwrap()),
    }
}

async fn verify_payment(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
    Json(body): Json<VerifyBody>,
) -> Result<Json<VerifyResponse>, (StatusCode, Json<Value>)> {
    let secret = state.paystack_secret_key.as_deref().filter(|s| !s.is_empty()).ok_or_else(|| {
        (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({ "error": "Paystack not configured" })),
        )
    })?;

    let authed = require_user(&state, bearer.token())
        .await
        .map_err(|(_, msg)| (StatusCode::UNAUTHORIZED, Json(json!({ "error": msg }))))?;

    let ref_trim = body.reference.trim();
    if ref_trim.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "reference required" })),
        ));
    }

    let url = format!("https://api.paystack.co/transaction/verify/{}", ref_trim);

    let res = state
        .http_client
        .get(&url)
        .header("Authorization", format!("Bearer {}", secret))
        .send()
        .await
        .map_err(|_| {
            (
                StatusCode::BAD_GATEWAY,
                Json(json!({ "error": "paystack request failed" })),
            )
        })?;

    let verify_json: Value = res.json().await.map_err(|_| {
        (
            StatusCode::BAD_GATEWAY,
            Json(json!({ "error": "paystack parse failed" })),
        )
    })?;

    if !verify_json
        .get("status")
        .and_then(|s| s.as_bool())
        .unwrap_or(false)
    {
        let msg = verify_json
            .get("message")
            .and_then(|m| m.as_str())
            .unwrap_or("verification failed");
        return Err((StatusCode::BAD_REQUEST, Json(json!({ "error": msg }))));
    }

    let data = verify_json.get("data").cloned().unwrap_or(Value::Null);
    let txn_status = data.get("status").and_then(|s| s.as_str()).unwrap_or("");
    if txn_status != "success" {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "payment not successful" })),
        ));
    }

    let metadata = data.get("metadata").cloned().unwrap_or(Value::Null);

    let user_id_str = metadata.get("user_id").and_then(|u| u.as_str()).ok_or_else(|| {
        (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "missing user_id in metadata" })),
        )
    })?;

    let pay_currency = metadata
        .get("currency")
        .and_then(|c| c.as_str())
        .unwrap_or("USD");

    let user_id = Uuid::parse_str(user_id_str).map_err(|_| {
        (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "invalid user_id" })),
        )
    })?;

    if user_id != authed.id {
        return Err((
            StatusCode::FORBIDDEN,
            Json(json!({ "error": "payment does not belong to this user" })),
        ));
    }

    let existing: i64 = sqlx::query_scalar(
        "SELECT COUNT(*)::bigint FROM subscription_invoices WHERE reference = $1",
    )
    .bind(ref_trim)
    .fetch_one(&state.db)
    .await
    .map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "internal error" })),
        )
    })?;

    if existing > 0 {
        return Ok(Json(VerifyResponse { status: "active" }));
    }

    let tier_lower = resolve_finalize_tier(&state, &data, &metadata)?;

    let (amount_paid, invoice_amount) = if pay_currency == "ZAR" {
        zar_amounts_for_billing(tier_lower.as_str())
    } else {
        usd_amounts_for_billing(tier_lower.as_str())
    };

    finalize_pro_subscription(
        &state,
        user_id,
        tier_lower.as_str(),
        amount_paid,
        "card",
        Some(ref_trim),
        pay_currency,
        invoice_amount,
    )
    .await?;

    Ok(Json(VerifyResponse { status: "active" }))
}

async fn verify_connector_payment(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
    Json(body): Json<VerifyBody>,
) -> Result<Json<VerifyResponse>, (StatusCode, Json<Value>)> {
    let secret = state
        .paystack_secret_key
        .as_deref()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| {
            (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(json!({ "error": "Paystack not configured" })),
            )
        })?;

    let authed = require_user(&state, bearer.token())
        .await
        .map_err(|(_, msg)| (StatusCode::UNAUTHORIZED, Json(json!({ "error": msg }))))?;
    if authed.role != "INTERMEDIARY" {
        return Err((
            StatusCode::FORBIDDEN,
            Json(json!({ "error": "wrong role for this resource" })),
        ));
    }

    let ref_trim = body.reference.trim();
    if ref_trim.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "reference required" })),
        ));
    }

    let existing: i64 = sqlx::query_scalar(
        "SELECT COUNT(*)::bigint FROM subscription_invoices WHERE reference = $1",
    )
    .bind(ref_trim)
    .fetch_one(&state.db)
    .await
    .map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "internal error" })),
        )
    })?;
    if existing > 0 {
        return Ok(Json(VerifyResponse { status: "active" }));
    }

    let url = format!("https://api.paystack.co/transaction/verify/{}", ref_trim);
    let res = state
        .http_client
        .get(&url)
        .header("Authorization", format!("Bearer {}", secret))
        .send()
        .await
        .map_err(|_| {
            (
                StatusCode::BAD_GATEWAY,
                Json(json!({ "error": "paystack request failed" })),
            )
        })?;
    let verify_json: Value = res.json().await.map_err(|_| {
        (
            StatusCode::BAD_GATEWAY,
            Json(json!({ "error": "paystack parse failed" })),
        )
    })?;
    if !verify_json
        .get("status")
        .and_then(|s| s.as_bool())
        .unwrap_or(false)
    {
        let msg = verify_json
            .get("message")
            .and_then(|m| m.as_str())
            .unwrap_or("verification failed");
        return Err((StatusCode::BAD_REQUEST, Json(json!({ "error": msg }))));
    }
    let data = verify_json.get("data").cloned().unwrap_or(Value::Null);
    if data.get("status").and_then(|s| s.as_str()).unwrap_or("") != "success" {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "payment not successful" })),
        ));
    }

    let metadata = data.get("metadata").cloned().unwrap_or(Value::Null);
    let user_id = Uuid::parse_str(
        metadata
            .get("user_id")
            .and_then(|u| u.as_str())
            .ok_or_else(|| {
                (
                    StatusCode::BAD_REQUEST,
                    Json(json!({ "error": "missing user_id in metadata" })),
                )
            })?,
    )
    .map_err(|_| (StatusCode::BAD_REQUEST, Json(json!({ "error": "invalid user_id" }))))?;
    if user_id != authed.id {
        return Err((
            StatusCode::FORBIDDEN,
            Json(json!({ "error": "payment does not belong to this user" })),
        ));
    }

    if metadata
        .get("tier")
        .and_then(|t| t.as_str())
        .unwrap_or("")
        .to_ascii_lowercase()
        != "connector_basic"
    {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "invalid connector subscription metadata" })),
        ));
    }

    let billing = metadata
        .get("billing")
        .and_then(|b| b.as_str())
        .unwrap_or("monthly")
        .to_ascii_lowercase();
    if billing != "monthly" && billing != "annual" {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "invalid billing metadata" })),
        ));
    }

    finalize_connector_subscription(&state, user_id, &billing, "card", Some(ref_trim)).await?;
    Ok(Json(VerifyResponse { status: "active" }))
}

async fn create_investor_subscription(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
    Json(body): Json<InvestorSubscribeBody>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let secret = state.paystack_secret_key.as_deref().filter(|s| !s.is_empty()).ok_or_else(|| {
        (StatusCode::SERVICE_UNAVAILABLE, Json(json!({ "error": "Paystack not configured" })))
    })?;

    let authed = require_user(&state, bearer.token())
        .await
        .map_err(|(_, msg)| (StatusCode::UNAUTHORIZED, Json(json!({ "error": msg }))))?;
    if authed.role != "INVESTOR" {
        return Err((StatusCode::FORBIDDEN, Json(json!({ "error": "investors only" }))));
    }

    let billing = body.billing.to_ascii_lowercase();
    if billing != "monthly" && billing != "annual" {
        return Err((StatusCode::BAD_REQUEST, Json(json!({ "error": "billing must be monthly or annual" }))));
    }

    let plan_code = match billing.as_str() {
        "annual" => state.paystack_investor_plan_basic_annual.as_str(),
        _ => state.paystack_investor_plan_basic_monthly.as_str(),
    };
    if plan_code.is_empty() {
        return Err((StatusCode::SERVICE_UNAVAILABLE, Json(json!({ "error": "Investor Paystack plan codes not configured" }))));
    }

    let (user_id, user_email): (Uuid, String) = sqlx::query_as("SELECT id, email FROM users WHERE id = $1")
        .bind(authed.id)
        .fetch_one(&state.db)
        .await
        .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "internal error" }))))?;

    let amount_kobo: i64 = if billing == "annual" { 169_999 } else { 16_999 };
    let reference = Uuid::new_v4().to_string();
    let payload = json!({
        "email": user_email,
        "amount": amount_kobo,
        "currency": "ZAR",
        "plan": plan_code,
        "reference": reference,
        "callback_url": format!("{}/investor/settings/subscription?success=1&reference={}", state.frontend_url, reference),
        "metadata": { "user_id": user_id.to_string(), "tier": "investor_basic", "billing": billing, "currency": "ZAR" }
    });

    let res = state.http_client.post("https://api.paystack.co/transaction/initialize")
        .header("Authorization", format!("Bearer {}", secret))
        .header("Content-Type", "application/json")
        .json(&payload).send().await
        .map_err(|_| (StatusCode::BAD_GATEWAY, Json(json!({ "error": "paystack request failed" }))))?;
    let json: Value = res.json().await
        .map_err(|_| (StatusCode::BAD_GATEWAY, Json(json!({ "error": "paystack parse failed" }))))?;
    if !json.get("status").and_then(|s| s.as_bool()).unwrap_or(false) {
        let msg = json.get("message").and_then(|m| m.as_str()).unwrap_or("paystack error");
        return Err((StatusCode::BAD_GATEWAY, Json(json!({ "error": msg }))));
    }
    let authorization_url = json.get("data").and_then(|d| d.get("authorization_url")).and_then(|u| u.as_str())
        .ok_or_else(|| (StatusCode::BAD_GATEWAY, Json(json!({ "error": "missing authorization_url" }))))?;
    Ok(Json(json!({ "hosted_url": authorization_url })))
}

async fn verify_investor_payment(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
    Json(body): Json<VerifyBody>,
) -> Result<Json<VerifyResponse>, (StatusCode, Json<Value>)> {
    let secret = state.paystack_secret_key.as_deref().filter(|s| !s.is_empty()).ok_or_else(|| {
        (StatusCode::SERVICE_UNAVAILABLE, Json(json!({ "error": "Paystack not configured" })))
    })?;

    let authed = require_user(&state, bearer.token())
        .await
        .map_err(|(_, msg)| (StatusCode::UNAUTHORIZED, Json(json!({ "error": msg }))))?;
    if authed.role != "INVESTOR" {
        return Err((StatusCode::FORBIDDEN, Json(json!({ "error": "investors only" }))));
    }

    let ref_trim = body.reference.trim();
    if ref_trim.is_empty() {
        return Err((StatusCode::BAD_REQUEST, Json(json!({ "error": "reference required" }))));
    }

    let existing: i64 = sqlx::query_scalar("SELECT COUNT(*)::bigint FROM subscription_invoices WHERE reference = $1")
        .bind(ref_trim).fetch_one(&state.db).await
        .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "internal error" }))))?;
    if existing > 0 {
        return Ok(Json(VerifyResponse { status: "active" }));
    }

    let url = format!("https://api.paystack.co/transaction/verify/{}", ref_trim);
    let res = state.http_client.get(&url)
        .header("Authorization", format!("Bearer {}", secret))
        .send().await
        .map_err(|_| (StatusCode::BAD_GATEWAY, Json(json!({ "error": "paystack request failed" }))))?;
    let verify_json: Value = res.json().await
        .map_err(|_| (StatusCode::BAD_GATEWAY, Json(json!({ "error": "paystack parse failed" }))))?;
    if !verify_json.get("status").and_then(|s| s.as_bool()).unwrap_or(false) {
        let msg = verify_json.get("message").and_then(|m| m.as_str()).unwrap_or("verification failed");
        return Err((StatusCode::BAD_REQUEST, Json(json!({ "error": msg }))));
    }
    let data = verify_json.get("data").cloned().unwrap_or(Value::Null);
    if data.get("status").and_then(|s| s.as_str()).unwrap_or("") != "success" {
        return Err((StatusCode::BAD_REQUEST, Json(json!({ "error": "payment not successful" }))));
    }
    let metadata = data.get("metadata").cloned().unwrap_or(Value::Null);
    let user_id = Uuid::parse_str(
        metadata.get("user_id").and_then(|u| u.as_str())
            .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({ "error": "missing user_id" }))))?,
    ).map_err(|_| (StatusCode::BAD_REQUEST, Json(json!({ "error": "invalid user_id" }))))?;
    if user_id != authed.id {
        return Err((StatusCode::FORBIDDEN, Json(json!({ "error": "payment does not belong to this user" }))));
    }
    if metadata.get("tier").and_then(|t| t.as_str()).unwrap_or("").to_ascii_lowercase() != "investor_basic" {
        return Err((StatusCode::BAD_REQUEST, Json(json!({ "error": "invalid investor subscription metadata" }))));
    }
    let billing = metadata.get("billing").and_then(|b| b.as_str()).unwrap_or("monthly").to_ascii_lowercase();

    finalize_investor_subscription(&state, user_id, &billing, "card", Some(ref_trim)).await?;
    Ok(Json(VerifyResponse { status: "active" }))
}

async fn store_paystack_subscription_if_present(
    state: &AppState,
    user_id: Uuid,
    data: &Value,
) {
    let sub = match data.get("subscription") {
        Some(s) if !s.is_null() => s,
        _ => return,
    };

    let code = sub
        .get("subscription_code")
        .or_else(|| sub.get("code"))
        .and_then(|v| v.as_str());

    let token = sub
        .get("email_token")
        .and_then(|v| v.as_str())
        .or_else(|| {
            data.get("customer")
                .and_then(|c| c.get("email_token"))
                .and_then(|v| v.as_str())
        });

    let (Some(code), Some(token)) = (code, token) else {
        return;
    };

    let _ = sqlx::query(
        r#"
        UPDATE users
        SET paystack_subscription_code = $1,
            paystack_email_token = $2
        WHERE id = $3
        "#,
    )
    .bind(code)
    .bind(token)
    .bind(user_id)
    .execute(&state.db)
    .await;
}

async fn finalize_from_paystack_data(
    state: &AppState,
    user_id: Uuid,
    data: &Value,
    metadata: &Value,
    paystack_ref: &str,
) -> Result<(), StatusCode> {
    let existing: i64 = sqlx::query_scalar(
        "SELECT COUNT(*)::bigint FROM subscription_invoices WHERE reference = $1",
    )
    .bind(paystack_ref)
    .fetch_one(&state.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    if existing > 0 {
        return Ok(());
    }

    // Route connector payments separately
    let tier_str = metadata.get("tier").and_then(|t| t.as_str()).unwrap_or("");
    if tier_str.eq_ignore_ascii_case("investor_basic") {
        let billing = metadata
            .get("billing")
            .and_then(|b| b.as_str())
            .unwrap_or("monthly");
        return finalize_investor_subscription(state, user_id, billing, "card", Some(paystack_ref))
            .await
            .map_err(|(s, _)| s);
    }
    if tier_str.eq_ignore_ascii_case("connector_basic") {
        let billing = metadata
            .get("billing")
            .and_then(|b| b.as_str())
            .unwrap_or("monthly");
        return finalize_connector_subscription(state, user_id, billing, "card", Some(paystack_ref))
            .await
            .map_err(|(s, _)| s);
    }

    let tier_lower = resolve_finalize_tier(state, data, metadata).map_err(|(s, _)| s)?;

    let pay_currency = metadata
        .get("currency")
        .and_then(|c| c.as_str())
        .unwrap_or("USD");

    let (amount_paid, invoice_amount) = if pay_currency == "ZAR" {
        zar_amounts_for_billing(tier_lower.as_str())
    } else {
        usd_amounts_for_billing(tier_lower.as_str())
    };

    finalize_pro_subscription(
        state,
        user_id,
        tier_lower.as_str(),
        amount_paid,
        "card",
        Some(paystack_ref),
        pay_currency,
        invoice_amount,
    )
    .await
    .map_err(|(s, _)| s)?;

    store_paystack_subscription_if_present(state, user_id, data).await;

    Ok(())
}

async fn handle_invoice_payment_success(
    state: &AppState,
    data: &Value,
) -> Result<(), StatusCode> {
    let plan_code = data
        .get("subscription")
        .and_then(|s| s.get("plan"))
        .and_then(|p| p.get("plan_code"))
        .or_else(|| data.get("plan").and_then(|p| p.get("plan_code")))
        .and_then(|v| v.as_str())
        .ok_or_else(|| {
            tracing::warn!("invoice.payment_success: missing plan_code");
            StatusCode::BAD_REQUEST
        })?;

    let founder_billing = plan_code_to_billing(state, plan_code);
    let connector_billing = connector_plan_code_to_billing(state, plan_code);
    let investor_billing = investor_plan_code_to_billing(state, plan_code);
    if founder_billing.is_none() && connector_billing.is_none() && investor_billing.is_none() {
        tracing::warn!("invoice.payment_success: unknown plan_code {}", plan_code);
        return Err(StatusCode::BAD_REQUEST);
    }

    let email = data
        .get("customer")
        .and_then(|c| c.get("email"))
        .and_then(|v| v.as_str())
        .or_else(|| {
            data.get("authorization")
                .and_then(|a| a.get("customer"))
                .and_then(|c| c.get("email"))
                .and_then(|v| v.as_str())
        })
        .ok_or_else(|| {
            tracing::warn!("invoice.payment_success: missing customer email");
            StatusCode::BAD_REQUEST
        })?;

    let user_id: Uuid = sqlx::query_scalar(
        r#"SELECT id FROM users WHERE lower(trim(email)) = lower(trim($1))"#,
    )
    .bind(email)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
    .ok_or_else(|| {
        tracing::warn!("invoice.payment_success: no user for email");
        StatusCode::BAD_REQUEST
    })?;

    let paystack_ref = data
        .get("reference")
        .and_then(|r| r.as_str())
        .ok_or_else(|| {
            tracing::warn!("invoice.payment_success: missing reference");
            StatusCode::BAD_REQUEST
        })?;

    let existing: i64 = sqlx::query_scalar(
        "SELECT COUNT(*)::bigint FROM subscription_invoices WHERE reference = $1",
    )
    .bind(paystack_ref)
    .fetch_one(&state.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    if existing > 0 {
        return Ok(());
    }

    if let Some(billing) = connector_billing {
        finalize_connector_subscription(state, user_id, billing, "card", Some(paystack_ref))
            .await
            .map_err(|(s, _)| s)?;
    } else if let Some(billing) = investor_billing {
        finalize_investor_subscription(state, user_id, billing, "card", Some(paystack_ref))
            .await
            .map_err(|(s, _)| s)?;
    } else if let Some(billing) = founder_billing {
        let (amount_paid, invoice_amount) = zar_amounts_for_billing(billing);
        finalize_pro_subscription(
            state,
            user_id,
            billing,
            amount_paid,
            "card",
            Some(paystack_ref),
            "ZAR",
            invoice_amount,
        )
        .await
        .map_err(|(s, _)| s)?;
    }

    store_paystack_subscription_if_present(state, user_id, data).await;

    Ok(())
}

async fn webhook(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<StatusCode, StatusCode> {
    let secret = match &state.paystack_secret_key {
        Some(s) if !s.is_empty() => s.as_str(),
        _ => {
            tracing::warn!("paystack webhook: secret not configured");
            return Err(StatusCode::SERVICE_UNAVAILABLE);
        }
    };

    let sig_hex = headers
        .get("x-paystack-signature")
        .or_else(|| headers.get("X-Paystack-Signature"))
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| {
            tracing::warn!("paystack webhook: missing signature header");
            StatusCode::UNAUTHORIZED
        })?;

    let mut mac = HmacSha512::new_from_slice(secret.as_bytes()).map_err(|e| {
        tracing::error!("paystack webhook: hmac init: {e}");
        StatusCode::INTERNAL_SERVER_ERROR
    })?;
    mac.update(&body);
    let expected = hex::encode(mac.finalize().into_bytes());

    if expected != sig_hex {
        tracing::warn!("paystack webhook: signature mismatch");
        return Err(StatusCode::UNAUTHORIZED);
    }

    let v: Value = serde_json::from_slice(&body).map_err(|e| {
        tracing::warn!("paystack webhook: json parse: {e}");
        StatusCode::BAD_REQUEST
    })?;

    let event = v.get("event").and_then(|e| e.as_str()).unwrap_or("");
    let data = v.get("data").cloned().unwrap_or(Value::Null);

    if event == "invoice.payment_success" {
        return handle_invoice_payment_success(&state, &data)
            .await
            .map(|_| StatusCode::OK);
    }

    if event != "charge.success" {
        return Ok(StatusCode::OK);
    }

    let metadata = data.get("metadata").cloned().unwrap_or(Value::Null);

    let user_id_str = metadata
        .get("user_id")
        .and_then(|u| u.as_str())
        .ok_or_else(|| {
            tracing::warn!("paystack webhook: missing user_id in metadata");
            StatusCode::BAD_REQUEST
        })?;

    let user_id = Uuid::parse_str(user_id_str).map_err(|_| {
        tracing::warn!("paystack webhook: invalid user_id");
        StatusCode::BAD_REQUEST
    })?;

    let paystack_ref = data
        .get("reference")
        .and_then(|r| r.as_str())
        .ok_or_else(|| {
            tracing::warn!("paystack webhook: missing reference");
            StatusCode::BAD_REQUEST
        })?;

    finalize_from_paystack_data(&state, user_id, &data, &metadata, paystack_ref)
        .await
        .map_err(|s| {
            tracing::warn!("paystack webhook: finalize failed");
            s
        })?;

    Ok(StatusCode::OK)
}

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
        .route("/create-charge", post(create_charge))
        .route("/verify", post(verify_payment))
        .route("/webhook", post(webhook))
}

#[derive(Deserialize)]
struct CreateChargeBody {
    tier: String,
    currency: Option<String>,
}

async fn create_charge(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
    Json(body): Json<CreateChargeBody>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let secret = state.paystack_secret_key.as_deref().ok_or_else(|| {
        (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({ "error": "Paystack not configured" })),
        )
    })?;

    let authed = require_user(&state, bearer.token())
        .await
        .map_err(|(_, msg)| (StatusCode::UNAUTHORIZED, Json(json!({ "error": msg }))))?;

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

    let tier = body.tier.to_ascii_lowercase();
    if tier != "monthly" && tier != "annual" {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "tier must be monthly or annual" })),
        ));
    }

    let currency = match body.currency.as_deref() {
        Some("ZAR") => "ZAR",
        None if state.paystack_currency == "ZAR" => "ZAR",
        _ => "USD",
    };

    let amount: i64 = match (currency, tier.as_str()) {
        ("ZAR", "monthly") => 16999,
        ("ZAR", "annual") => 169999,
        (_, "monthly") => 999,
        (_, "annual") => 9999,
        _ => unreachable!(),
    };

    let reference = Uuid::new_v4().to_string();

    let payload = json!({
        "email": user_email,
        "amount": amount,
        "currency": currency,
        "reference": reference,
        "callback_url": format!(
            "https://platform.metatron.id/pricing?success=1&reference={}&redirect={}",
            reference,
            urlencoding::encode("/startup/settings/subscription")
        ),
        "metadata": {
            "user_id": user_id.to_string(),
            "tier": tier,
            "currency": currency
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
        tracing::warn!("paystack initialize: {}", msg);
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

#[derive(Deserialize)]
struct VerifyBody {
    reference: String,
}

#[derive(Serialize)]
struct VerifyResponse {
    status: &'static str,
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

    let tier_str = metadata
        .get("tier")
        .and_then(|t| t.as_str())
        .unwrap_or("monthly");

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

    let tier_lower = tier_str.to_ascii_lowercase();
    if tier_lower != "monthly" && tier_lower != "annual" {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "invalid tier" })),
        ));
    }

    let amount_paid = match (pay_currency, tier_lower.as_str()) {
        ("ZAR", "annual") => "R1,699.99 ZAR",
        ("ZAR", _) => "R169.99 ZAR",
        (_, "annual") => "$99.99 USD",
        _ => "$9.99 USD",
    };

    let invoice_amount = match (pay_currency, tier_lower.as_str()) {
        ("ZAR", "annual") => Decimal::from_str("1699.99").unwrap(),
        ("ZAR", _) => Decimal::from_str("169.99").unwrap(),
        (_, "annual") => Decimal::from_str("99.99").unwrap(),
        _ => Decimal::from_str("9.99").unwrap(),
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
    if event != "charge.success" {
        return Ok(StatusCode::OK);
    }

    let data = v.get("data").cloned().unwrap_or(Value::Null);
    let metadata = data.get("metadata").cloned().unwrap_or(Value::Null);

    let user_id_str = metadata
        .get("user_id")
        .and_then(|u| u.as_str())
        .ok_or_else(|| {
            tracing::warn!("paystack webhook: missing user_id in metadata");
            StatusCode::BAD_REQUEST
        })?;

    let tier_str = metadata
        .get("tier")
        .and_then(|t| t.as_str())
        .unwrap_or("monthly");

    let pay_currency = metadata
        .get("currency")
        .and_then(|c| c.as_str())
        .unwrap_or("USD");

    let user_id = Uuid::parse_str(user_id_str).map_err(|_| {
        tracing::warn!("paystack webhook: invalid user_id");
        StatusCode::BAD_REQUEST
    })?;

    let tier_lower = tier_str.to_ascii_lowercase();
    if tier_lower != "monthly" && tier_lower != "annual" {
        tracing::warn!("paystack webhook: invalid tier {}", tier_str);
        return Err(StatusCode::BAD_REQUEST);
    }

    let amount_paid = match (pay_currency, tier_lower.as_str()) {
        ("ZAR", "annual") => "R1,699.99 ZAR",
        ("ZAR", _) => "R169.99 ZAR",
        (_, "annual") => "$99.99 USD",
        _ => "$9.99 USD",
    };

    let invoice_amount = match (pay_currency, tier_lower.as_str()) {
        ("ZAR", "annual") => Decimal::from_str("1699.99").unwrap(),
        ("ZAR", _) => Decimal::from_str("169.99").unwrap(),
        (_, "annual") => Decimal::from_str("99.99").unwrap(),
        _ => Decimal::from_str("9.99").unwrap(),
    };

    let paystack_ref = data
        .get("reference")
        .and_then(|r| r.as_str())
        .ok_or_else(|| {
            tracing::warn!("paystack webhook: missing reference");
            StatusCode::BAD_REQUEST
        })?;

    let _ = finalize_pro_subscription(
        &state,
        user_id,
        tier_lower.as_str(),
        amount_paid,
        "card",
        Some(paystack_ref),
        pay_currency,
        invoice_amount,
    )
    .await
    .map_err(|(status, _)| {
        tracing::warn!("paystack webhook: finalize failed with status {:?}", status);
        status
    })?;

    Ok(StatusCode::OK)
}

//! Stripe Billing: Checkout for new subscriptions, the customer portal for
//! changes and cancellation, and a webhook that mirrors the subscription onto
//! the user (plan, billing period, status, period end). `is_basic` / `is_pro`
//! follow from those columns via the `sync_is_*` triggers.
//!
//! Prices live in Stripe and are found by lookup key, e.g. `basic_monthly_usd`.

use std::sync::Arc;

use axum::body::Bytes;
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::routing::post;
use axum::{Json, Router};
use axum_extra::{
    headers::{authorization::Bearer, Authorization},
    TypedHeader,
};
use hmac::{Hmac, Mac};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::Sha256;
use uuid::Uuid;

use crate::identity::require_user;
use crate::routes::commerce::require_payments_enabled;
use crate::state::AppState;

type ApiError = (StatusCode, Json<Value>);

const STRIPE_API: &str = "https://api.stripe.com/v1";
/// Reject webhook events signed more than this many seconds ago.
const SIGNATURE_TOLERANCE_SECS: i64 = 300;

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/checkout", post(create_checkout))
        .route("/portal", post(create_portal))
        .route("/webhook", post(webhook))
}

fn err(status: StatusCode, msg: &str) -> ApiError {
    (status, Json(json!({ "error": msg })))
}

fn secret_key(state: &AppState) -> Result<&str, ApiError> {
    state
        .stripe_secret_key
        .as_deref()
        .ok_or_else(|| err(StatusCode::SERVICE_UNAVAILABLE, "Payments are not configured."))
}

/// Form-encoded call to the Stripe API; returns the JSON body or Stripe's error message.
async fn stripe_call(
    state: &AppState,
    method: reqwest::Method,
    path: &str,
    form: &[(&str, String)],
) -> Result<Value, ApiError> {
    let key = secret_key(state)?;
    let url = format!("{STRIPE_API}/{path}");
    let req = state.http_client.request(method.clone(), &url).basic_auth(key, Some(""));
    let req = if method == reqwest::Method::GET { req.query(form) } else { req.form(form) };
    let res = req.send().await.map_err(|e| {
        tracing::error!("stripe {path}: request failed: {e}");
        err(StatusCode::BAD_GATEWAY, "Could not reach the payment provider.")
    })?;
    let ok = res.status().is_success();
    let body: Value = res.json().await.unwrap_or(Value::Null);
    if !ok {
        let msg = body["error"]["message"].as_str().unwrap_or("Payment provider error.");
        tracing::warn!("stripe {path}: {msg}");
        return Err(err(StatusCode::BAD_GATEWAY, msg));
    }
    Ok(body)
}

fn role_path(role: &str) -> &'static str {
    match role {
        "INVESTOR" => "/investor",
        "INTERMEDIARY" => "/connector",
        _ => "/startup",
    }
}

#[derive(Deserialize)]
struct CheckoutBody {
    plan: String,
    billing: String,
    currency: String,
    /// Dashboard page to go back to once the plan is active, e.g. `/startup/profile`.
    #[serde(default)]
    return_to: Option<String>,
}

/// Only a path inside the user's own dashboard, made of plain path characters.
fn safe_return_path(raw: Option<&str>, role_base: &str) -> Option<String> {
    let p = raw?.trim();
    let inside = p == role_base || p.starts_with(&format!("{role_base}/"));
    let plain = p.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '/' | '-' | '_')) && !p.contains("//");
    (inside && plain).then(|| p.to_string())
}

async fn create_checkout(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
    Json(body): Json<CheckoutBody>,
) -> Result<Json<Value>, ApiError> {
    require_payments_enabled(&state)?;
    let user = require_user(&state, bearer.token())
        .await
        .map_err(|(s, m)| err(s, &m))?;
    // Connector plans come later.
    if user.role != "STARTUP" && user.role != "INVESTOR" {
        return Err(err(StatusCode::FORBIDDEN, "Paid plans are for founders and investors."));
    }

    let plan = body.plan.trim().to_ascii_lowercase();
    let billing = body.billing.trim().to_ascii_lowercase();
    let currency = body.currency.trim().to_ascii_lowercase();
    if !matches!(plan.as_str(), "basic" | "pro")
        || !matches!(billing.as_str(), "monthly" | "annual")
        || !matches!(currency.as_str(), "usd" | "eur")
    {
        return Err(err(StatusCode::BAD_REQUEST, "Unknown plan, billing period or currency."));
    }

    let (email, customer_id, subscription_id, status): (String, Option<String>, Option<String>, Option<String>) =
        sqlx::query_as(
            "SELECT email, stripe_customer_id, stripe_subscription_id, subscription_status FROM users WHERE id = $1",
        )
        .bind(user.id)
        .fetch_one(&state.db)
        .await
        .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "internal error"))?;

    // Existing subscribers change plan in the customer portal, not a second checkout.
    if subscription_id.is_some() && status.as_deref() == Some("active") {
        return Err(err(StatusCode::CONFLICT, "You already have a plan. Use Manage billing to change it."));
    }

    let lookup_key = format!("{plan}_{billing}_{currency}");
    let prices = stripe_call(
        &state,
        reqwest::Method::GET,
        "prices",
        &[("lookup_keys[]", lookup_key.clone()), ("active", "true".into())],
    )
    .await?;
    let price_id = prices["data"][0]["id"]
        .as_str()
        .ok_or_else(|| {
            tracing::error!("stripe: no active price for lookup key {lookup_key}");
            err(StatusCode::SERVICE_UNAVAILABLE, "That plan isn't available right now.")
        })?
        .to_string();

    let customer_id = match customer_id {
        Some(id) => id,
        None => {
            let customer = stripe_call(
                &state,
                reqwest::Method::POST,
                "customers",
                &[("email", email.clone()), ("metadata[user_id]", user.id.to_string())],
            )
            .await?;
            let id = customer["id"]
                .as_str()
                .ok_or_else(|| err(StatusCode::BAD_GATEWAY, "Payment provider error."))?
                .to_string();
            sqlx::query("UPDATE users SET stripe_customer_id = $1 WHERE id = $2")
                .bind(&id)
                .bind(user.id)
                .execute(&state.db)
                .await
                .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "internal error"))?;
            id
        }
    };

    let settings_url = format!(
        "{}{}/settings/subscription",
        crate::email::frontend_url(),
        role_path(&user.role)
    );
    // Checkout started from the upgrade popup goes back to the page it was
    // opened on (`?upgraded=1` there waits for the plan to switch on).
    let back = safe_return_path(body.return_to.as_deref(), role_path(&user.role))
        .map(|p| format!("{}{p}", crate::email::frontend_url()));
    let success_url = match &back {
        Some(b) => format!("{b}?upgraded=1"),
        None => format!("{settings_url}?success=1"),
    };
    let cancel_url = back.unwrap_or_else(|| settings_url.clone());
    let session = stripe_call(
        &state,
        reqwest::Method::POST,
        "checkout/sessions",
        &[
            ("mode", "subscription".into()),
            ("customer", customer_id),
            ("line_items[0][price]", price_id),
            ("line_items[0][quantity]", "1".into()),
            ("client_reference_id", user.id.to_string()),
            ("subscription_data[metadata][user_id]", user.id.to_string()),
            ("success_url", success_url),
            ("cancel_url", cancel_url),
        ],
    )
    .await?;
    let url = session["url"]
        .as_str()
        .ok_or_else(|| err(StatusCode::BAD_GATEWAY, "Payment provider error."))?;
    Ok(Json(json!({ "url": url })))
}

#[derive(Deserialize)]
struct PortalBody {
    /// With plan + billing, the portal opens straight on confirming that change
    /// (e.g. Basic -> Pro); otherwise it opens on the overview.
    plan: Option<String>,
    billing: Option<String>,
}

async fn create_portal(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
    body: Option<Json<PortalBody>>,
) -> Result<Json<Value>, ApiError> {
    let user = require_user(&state, bearer.token())
        .await
        .map_err(|(s, m)| err(s, &m))?;
    let (customer_id, subscription_id): (Option<String>, Option<String>) =
        sqlx::query_as("SELECT stripe_customer_id, stripe_subscription_id FROM users WHERE id = $1")
            .bind(user.id)
            .fetch_one(&state.db)
            .await
            .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "internal error"))?;
    let customer_id =
        customer_id.ok_or_else(|| err(StatusCode::NOT_FOUND, "No billing account yet."))?;

    let return_url = format!(
        "{}{}/settings/subscription",
        crate::email::frontend_url(),
        role_path(&user.role)
    );
    let mut form = vec![("customer", customer_id), ("return_url", return_url.clone())];

    let change = body.as_ref().and_then(|Json(b)| {
        let plan = b.plan.as_deref()?.trim().to_ascii_lowercase();
        let billing = b.billing.as_deref()?.trim().to_ascii_lowercase();
        (matches!(plan.as_str(), "basic" | "pro") && matches!(billing.as_str(), "monthly" | "annual"))
            .then_some((plan, billing))
    });
    if let (Some((plan, billing)), Some(sub_id)) = (change, subscription_id) {
        require_payments_enabled(&state)?;
        // Stay in the subscription's own currency; Stripe can't switch it mid-subscription.
        let sub = stripe_call(&state, reqwest::Method::GET, &format!("subscriptions/{sub_id}"), &[]).await?;
        let item = &sub["items"]["data"][0];
        let item_id = item["id"].as_str().unwrap_or("").to_string();
        let currency = item["price"]["currency"].as_str().unwrap_or("usd").to_string();
        let lookup_key = format!("{plan}_{billing}_{currency}");
        let prices = stripe_call(
            &state,
            reqwest::Method::GET,
            "prices",
            &[("lookup_keys[]", lookup_key.clone()), ("active", "true".into())],
        )
        .await?;
        let price_id = prices["data"][0]["id"].as_str().unwrap_or("").to_string();
        if item_id.is_empty() || price_id.is_empty() {
            tracing::error!("stripe portal: cannot build plan change to {lookup_key}");
            return Err(err(StatusCode::SERVICE_UNAVAILABLE, "That plan isn't available right now."));
        }
        form.extend([
            ("flow_data[type]", "subscription_update_confirm".to_string()),
            ("flow_data[subscription_update_confirm][subscription]", sub_id),
            ("flow_data[subscription_update_confirm][items][0][id]", item_id),
            ("flow_data[subscription_update_confirm][items][0][price]", price_id),
            ("flow_data[after_completion][type]", "redirect".to_string()),
            ("flow_data[after_completion][redirect][return_url]", format!("{return_url}?success=1")),
        ]);
    }

    let session = stripe_call(&state, reqwest::Method::POST, "billing_portal/sessions", &form).await?;
    let url = session["url"]
        .as_str()
        .ok_or_else(|| err(StatusCode::BAD_GATEWAY, "Payment provider error."))?;
    Ok(Json(json!({ "url": url })))
}

/// Checks the `Stripe-Signature` header (`t=…,v1=…`) against the raw body.
fn signature_ok(secret: &str, header: &str, payload: &[u8]) -> bool {
    let mut timestamp = None;
    let mut signatures = Vec::new();
    for part in header.split(',') {
        match part.split_once('=') {
            Some(("t", t)) => timestamp = t.parse::<i64>().ok(),
            Some(("v1", sig)) => signatures.push(sig),
            _ => {}
        }
    }
    let Some(t) = timestamp else { return false };
    if (chrono::Utc::now().timestamp() - t).abs() > SIGNATURE_TOLERANCE_SECS {
        return false;
    }
    signatures.iter().any(|sig| {
        let Ok(expected) = hex::decode(sig) else { return false };
        let Ok(mut mac) = Hmac::<Sha256>::new_from_slice(secret.as_bytes()) else { return false };
        mac.update(t.to_string().as_bytes());
        mac.update(b".");
        mac.update(payload);
        mac.verify_slice(&expected).is_ok()
    })
}

async fn webhook(State(state): State<Arc<AppState>>, headers: HeaderMap, body: Bytes) -> StatusCode {
    let Some(secret) = state.stripe_webhook_secret.as_deref() else {
        tracing::error!("stripe webhook: STRIPE_WEBHOOK_SECRET not set");
        return StatusCode::SERVICE_UNAVAILABLE;
    };
    let header = headers
        .get("stripe-signature")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    if !signature_ok(secret, header, &body) {
        tracing::warn!("stripe webhook: bad signature");
        return StatusCode::BAD_REQUEST;
    }
    let Ok(event) = serde_json::from_slice::<Value>(&body) else {
        return StatusCode::BAD_REQUEST;
    };
    let kind = event["type"].as_str().unwrap_or("");
    let object = &event["data"]["object"];

    let result = match kind {
        "customer.subscription.created"
        | "customer.subscription.updated"
        | "customer.subscription.deleted" => sync_subscription(&state, object).await,
        "invoice.paid" => record_invoice(&state, object).await,
        _ => Ok(()),
    };
    match result {
        Ok(()) => StatusCode::OK,
        Err(e) => {
            // Stripe retries non-2xx responses, so a transient failure heals itself.
            tracing::error!("stripe webhook {kind}: {e}");
            StatusCode::INTERNAL_SERVER_ERROR
        }
    }
}

/// Finds our user for a Stripe object: subscription metadata first, then the customer id.
async fn user_for(state: &AppState, user_id: Option<&str>, customer: &str) -> Result<Option<Uuid>, String> {
    if let Some(id) = user_id.and_then(|s| Uuid::parse_str(s).ok()) {
        return Ok(Some(id));
    }
    sqlx::query_scalar("SELECT id FROM users WHERE stripe_customer_id = $1")
        .bind(customer)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| e.to_string())
}

/// `basic_monthly_usd` -> ("basic", "monthly").
fn plan_from_lookup_key(key: &str) -> Option<(&'static str, &'static str)> {
    let mut parts = key.split('_');
    let plan = match parts.next()? {
        "basic" => "basic",
        "pro" => "pro",
        _ => return None,
    };
    let billing = match parts.next()? {
        "monthly" => "monthly",
        "annual" => "annual",
        _ => return None,
    };
    Some((plan, billing))
}

async fn sync_subscription(state: &AppState, sub: &Value) -> Result<(), String> {
    let sub_id = sub["id"].as_str().ok_or("subscription without id")?;
    let customer = sub["customer"].as_str().unwrap_or("");
    let Some(user_id) = user_for(state, sub["metadata"]["user_id"].as_str(), customer).await? else {
        tracing::warn!("stripe: subscription {sub_id} has no matching user");
        return Ok(());
    };

    let item = &sub["items"]["data"][0];
    let lookup_key = item["price"]["lookup_key"].as_str().unwrap_or("");
    let Some((plan, billing)) = plan_from_lookup_key(lookup_key) else {
        tracing::warn!("stripe: subscription {sub_id} has unknown price {lookup_key}");
        return Ok(());
    };
    // Newer API versions put the period end on the item.
    let period_end = sub["current_period_end"]
        .as_i64()
        .or_else(|| item["current_period_end"].as_i64())
        .ok_or("subscription without period end")?;
    // Past-due keeps access until the period ends while Stripe retries the card.
    let status = match sub["status"].as_str().unwrap_or("") {
        "active" | "trialing" | "past_due" => "active",
        "incomplete" => return Ok(()),
        _ => "inactive",
    };
    let cancel_at_period_end = sub["cancel_at_period_end"].as_bool().unwrap_or(false);

    sqlx::query(
        "UPDATE users
         SET subscription_plan = $1, subscription_tier = $2, subscription_status = $3,
             subscription_period_end = to_timestamp($4), cancel_at_period_end = $5,
             pending_downgrade_to = NULL,
             stripe_subscription_id = $6, stripe_customer_id = COALESCE(stripe_customer_id, $7)
         WHERE id = $8",
    )
    .bind(plan)
    .bind(billing)
    .bind(status)
    .bind(period_end as f64)
    .bind(cancel_at_period_end)
    .bind(sub_id)
    .bind(customer)
    .bind(user_id)
    .execute(&state.db)
    .await
    .map_err(|e| e.to_string())?;
    tracing::info!("stripe: user {user_id} -> {plan} {billing} {status}");
    Ok(())
}

async fn record_invoice(state: &AppState, invoice: &Value) -> Result<(), String> {
    let invoice_id = invoice["id"].as_str().ok_or("invoice without id")?;
    let customer = invoice["customer"].as_str().unwrap_or("");
    let line = &invoice["lines"]["data"][0];
    let user_meta = invoice["subscription_details"]["metadata"]["user_id"]
        .as_str()
        .or_else(|| invoice["parent"]["subscription_details"]["metadata"]["user_id"].as_str());
    let Some(user_id) = user_for(state, user_meta, customer).await? else {
        tracing::warn!("stripe: invoice {invoice_id} has no matching user");
        return Ok(());
    };

    let amount = invoice["amount_paid"].as_i64().unwrap_or(0) as f64 / 100.0;
    let currency = invoice["currency"].as_str().unwrap_or("usd").to_ascii_uppercase();
    let lookup_key = line["price"]["lookup_key"]
        .as_str()
        .or_else(|| line["pricing"]["price_details"]["price"].as_str())
        .unwrap_or("");
    let billing = plan_from_lookup_key(lookup_key).map(|(_, b)| b).unwrap_or("monthly");
    let start = line["period"]["start"].as_i64().unwrap_or(0) as f64;
    let end = line["period"]["end"].as_i64().unwrap_or(0) as f64;

    sqlx::query(
        "INSERT INTO subscription_invoices (user_id, amount, currency, payment_method, tier, period_start, period_end, reference)
         SELECT $1, $2::numeric, $3, 'stripe', $4, to_timestamp($5), to_timestamp($6), $7
         WHERE NOT EXISTS (SELECT 1 FROM subscription_invoices WHERE reference = $7)",
    )
    .bind(user_id)
    .bind(amount)
    .bind(currency)
    .bind(billing)
    .bind(start)
    .bind(end)
    .bind(invoice_id)
    .execute(&state.db)
    .await
    .map_err(|e| e.to_string())?;
    Ok(())
}

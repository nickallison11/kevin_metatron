use axum::http::StatusCode;
use axum::Json;
use rust_decimal::Decimal;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::email;
use crate::state::AppState;

/// Activates Pro subscription and sends the welcome email (on-chain and Coinbase Commerce).
pub async fn finalize_pro_subscription(
    state: &AppState,
    user_id: Uuid,
    tier: &str,
    amount_paid_display: &str,
    payment_method: &str,
    reference: Option<&str>,
    invoice_currency: &str,
    invoice_amount: Decimal,
) -> Result<String, (StatusCode, Json<Value>)> {
    let tier = tier.to_ascii_lowercase();
    if tier != "monthly" && tier != "annual" {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "tier must be monthly or annual" })),
        ));
    }

    let user_email: String = sqlx::query_scalar("SELECT email FROM users WHERE id = $1")
        .bind(user_id)
        .fetch_one(&state.db)
        .await
        .map_err(|_| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "internal error" })),
            )
        })?;

    let (period_end, period_start): (String, String) = if tier == "monthly" {
        sqlx::query_as(
            r#"
            UPDATE users
            SET pending_payment_nonce = NULL,
                subscription_tier = 'monthly',
                subscription_status = 'active',
                cancel_at_period_end = FALSE,
                subscription_period_end = GREATEST(NOW(), COALESCE(subscription_period_end, NOW())) + INTERVAL '30 days'
            WHERE id = $1
            RETURNING
                subscription_period_end::text,
                (subscription_period_end - INTERVAL '30 days')::text
            "#,
        )
        .bind(user_id)
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
            UPDATE users
            SET pending_payment_nonce = NULL,
                subscription_tier = 'annual',
                subscription_status = 'active',
                cancel_at_period_end = FALSE,
                subscription_period_end = GREATEST(NOW(), COALESCE(subscription_period_end, NOW())) + INTERVAL '365 days'
            WHERE id = $1
            RETURNING
                subscription_period_end::text,
                (subscription_period_end - INTERVAL '365 days')::text
            "#,
        )
        .bind(user_id)
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
        INSERT INTO subscription_invoices (user_id, amount, currency, payment_method, tier, period_start, period_end, reference)
        VALUES ($1, $2, $3, $4, $5, $6::timestamptz, $7::timestamptz, $8)
        "#,
    )
    .bind(user_id)
    .bind(invoice_amount)
    .bind(invoice_currency)
    .bind(payment_method)
    .bind(tier.as_str())
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

    email::send_email(
        &state.http_client,
        state.resend_api_key.as_deref(),
        &state.email_from,
        &user_email,
        "You're now on metatron Pro 🚀",
        &email::pro_activated_email_html(&period_end, amount_paid_display),
    )
    .await;

    Ok(period_end)
}

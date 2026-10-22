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
use crate::state::AppState;

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/status", get(get_status))
        .route("/invoices/:id", get(get_invoice))
        .route("/invoices", get(get_invoices))
        .route("/email-preferences", get(get_email_prefs).put(update_email_prefs))
        .route("/notify-me", get(get_plan_interest).post(add_plan_interest))
}

/// Records that a user wants to hear when a paid plan launches. Idempotent.
pub(crate) async fn record_plan_interest(
    db: &sqlx::PgPool,
    user_id: Uuid,
    plan: &str,
    source: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO plan_interest (user_id, plan, source) VALUES ($1, $2, $3)
         ON CONFLICT (user_id, plan) DO NOTHING",
    )
    .bind(user_id)
    .bind(plan)
    .bind(source)
    .execute(db)
    .await
    .map(|_| ())
}

#[derive(Deserialize)]
struct PlanInterestBody {
    plan: String,
    source: Option<String>,
}

async fn add_plan_interest(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
    Json(body): Json<PlanInterestBody>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let authed = require_user(&state, bearer.token()).await?;
    let plan = body.plan.trim().to_ascii_lowercase();
    if plan != "basic" && plan != "pro" {
        return Err((StatusCode::BAD_REQUEST, "plan must be basic or pro".into()));
    }
    let source = body.source.as_deref().unwrap_or("web").trim();
    let source = if source.is_empty() { "web" } else { source };
    record_plan_interest(&state.db, authed.id, &plan, source)
        .await
        .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "internal error".into()))?;
    Ok(Json(json!({ "ok": true })))
}

async fn get_plan_interest(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let authed = require_user(&state, bearer.token()).await?;
    let plans: Vec<String> = sqlx::query_scalar("SELECT plan FROM plan_interest WHERE user_id = $1")
        .bind(authed.id)
        .fetch_all(&state.db)
        .await
        .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "internal error".into()))?;
    Ok(Json(json!({ "plans": plans })))
}

#[derive(Serialize)]
struct StatusResponse {
    subscription_tier: String,
    subscription_status: String,
    subscription_period_end: Option<String>,
    cancel_at_period_end: bool,
    pending_downgrade_to: Option<String>,
}

async fn get_status(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
) -> Result<Json<StatusResponse>, (StatusCode, String)> {
    let authed = require_user(&state, bearer.token()).await?;

    let (subscription_tier, subscription_status, subscription_period_end, cancel_at_period_end, pending_downgrade_to): (
        String,
        String,
        Option<String>,
        bool,
        Option<String>,
    ) = sqlx::query_as(
        r#"
        SELECT
            subscription_plan AS subscription_tier,
            subscription_status,
            subscription_period_end::text,
            cancel_at_period_end,
            pending_downgrade_to
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
        pending_downgrade_to,
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

#[derive(Serialize, sqlx::FromRow)]
struct EmailPrefsResponse {
    weekly_matches: bool,
    unsubscribed_all: bool,
}

async fn get_email_prefs(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
) -> Result<Json<EmailPrefsResponse>, (StatusCode, String)> {
    let user = require_user(&state, bearer.token()).await?;
    let prefs = sqlx::query_as::<_, EmailPrefsResponse>(
        "SELECT weekly_matches, unsubscribed_all FROM email_preferences WHERE user_id = $1",
    )
    .bind(user.id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("get_email_prefs: {e}");
        (StatusCode::INTERNAL_SERVER_ERROR, "db error".into())
    })?
    .unwrap_or(EmailPrefsResponse {
        weekly_matches: true,
        unsubscribed_all: false,
    });
    Ok(Json(prefs))
}

#[derive(Deserialize)]
struct EmailPrefsBody {
    weekly_matches: bool,
    unsubscribed_all: bool,
}

async fn update_email_prefs(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
    Json(body): Json<EmailPrefsBody>,
) -> Result<StatusCode, (StatusCode, String)> {
    let user = require_user(&state, bearer.token()).await?;
    sqlx::query(
        r#"
        INSERT INTO email_preferences (user_id, weekly_matches, unsubscribed_all, last_updated)
        VALUES ($1, $2, $3, NOW())
        ON CONFLICT (user_id)
        DO UPDATE SET weekly_matches = $2, unsubscribed_all = $3, last_updated = NOW()
        "#,
    )
    .bind(user.id)
    .bind(body.weekly_matches)
    .bind(body.unsubscribed_all)
    .execute(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("update_email_prefs: {e}");
        (StatusCode::INTERNAL_SERVER_ERROR, "db error".into())
    })?;
    Ok(StatusCode::OK)
}

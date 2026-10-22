use std::sync::Arc;

use axum::extract::State;
use axum::http::StatusCode;
use axum::routing::get;
use axum::Json;
use axum::Router;
use serde_json::{json, Value};

use crate::state::AppState;

/// Refuses new checkouts while paid plans are switched off (PAYMENTS_ENABLED unset).
pub(crate) fn require_payments_enabled(state: &AppState) -> Result<(), (StatusCode, Json<Value>)> {
    if state.payments_enabled {
        Ok(())
    } else {
        Err((
            StatusCode::FORBIDDEN,
            Json(json!({ "error": "Paid plans are coming soon." })),
        ))
    }
}

/// Public: whether paid plans can be bought right now, so the site can hide pricing.
async fn payments_config(State(state): State<Arc<AppState>>) -> Json<Value> {
    Json(json!({ "payments_enabled": state.payments_enabled }))
}

/// Billing runs on Stripe only (`/commerce/stripe/*`).
pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/config", get(payments_config))
        .nest("/stripe", super::stripe_billing::router())
}

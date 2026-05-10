use std::sync::Arc;

use axum::{
    extract::State,
    http::StatusCode,
    routing::post,
    Json, Router,
};
use serde::Deserialize;
use serde_json::json;

use crate::email::{self, WAITLIST_ADMIN_SUBJECT, WAITLIST_CONFIRMATION_SUBJECT};
use crate::state::AppState;

const WAITLIST_FROM: &str = "metatron <kevin@metatron.id>";
const WAITLIST_ADMIN_TO: &str = "contact@metatron.id";

pub fn router() -> Router<Arc<AppState>> {
    Router::new().route("/", post(submit_waitlist))
}

#[derive(Deserialize)]
pub struct WaitlistBody {
    name: String,
    startup_name: String,
    email: String,
    #[serde(default)]
    tier: Option<String>,
    #[serde(default)]
    user_agent: Option<String>,
    #[serde(default)]
    referrer: Option<String>,
}

async fn submit_waitlist(
    State(state): State<Arc<AppState>>,
    Json(body): Json<WaitlistBody>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    let name = body.name.trim();
    let startup_name = body.startup_name.trim();
    let email_addr = body.email.trim();
    if name.is_empty() || startup_name.is_empty() || email_addr.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "name, startup_name, and email are required" })),
        ));
    }

    let tier = body
        .tier
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("Basic / Pro");

    let user_agent = body
        .user_agent
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());
    let referrer = body
        .referrer
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());

    sqlx::query(
        r#"
        INSERT INTO waitlist_signups (name, startup_name, email, tier, user_agent, referrer)
        VALUES ($1, $2, $3, $4, $5, $6)
        "#,
    )
    .bind(name)
    .bind(startup_name)
    .bind(email_addr)
    .bind(tier)
    .bind(user_agent)
    .bind(referrer)
    .execute(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("waitlist insert: {e}");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Could not save signup" })),
        )
    })?;

    let user_html = email::waitlist_confirmation_html(name, startup_name, tier);
    email::send_email(
        &state.http_client,
        state.resend_api_key.as_deref(),
        WAITLIST_FROM,
        email_addr,
        WAITLIST_CONFIRMATION_SUBJECT,
        &user_html,
    )
    .await;

    let admin_html = email::waitlist_admin_notification_html(
        name,
        startup_name,
        email_addr,
        tier,
        user_agent,
        referrer,
    );
    email::send_email(
        &state.http_client,
        state.resend_api_key.as_deref(),
        WAITLIST_FROM,
        WAITLIST_ADMIN_TO,
        WAITLIST_ADMIN_SUBJECT,
        &admin_html,
    )
    .await;

    Ok(Json(json!({ "success": true })))
}

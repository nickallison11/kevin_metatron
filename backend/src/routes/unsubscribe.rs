use std::sync::Arc;

use axum::{
    extract::{Query, State},
    http::StatusCode,
    response::Html,
    routing::get,
    Router,
};
use hmac::{Hmac, Mac};
use serde::Deserialize;
use sha2::Sha256;
use uuid::Uuid;

use crate::state::AppState;

type HmacSha256 = Hmac<Sha256>;

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/", get(unsubscribe_get).post(unsubscribe_post))
}

pub fn generate_token(secret: &str, user_id: Uuid, email_type: &str) -> String {
    let data = format!("{}:{}", user_id, email_type);
    let mut mac =
        HmacSha256::new_from_slice(secret.as_bytes()).expect("HMAC key");
    mac.update(data.as_bytes());
    let result = mac.finalize();
    let sig = hex::encode(result.into_bytes());
    format!("{}:{}:{}", user_id, email_type, sig)
}

fn verify_token(secret: &str, token: &str) -> Option<(Uuid, String)> {
    let parts: Vec<&str> = token.splitn(3, ':').collect();
    if parts.len() != 3 {
        return None;
    }
    let user_id = Uuid::parse_str(parts[0]).ok()?;
    let email_type = parts[1];
    let provided_sig = parts[2];

    let data = format!("{}:{}", user_id, email_type);
    let mut mac =
        HmacSha256::new_from_slice(secret.as_bytes()).expect("HMAC key");
    mac.update(data.as_bytes());

    let expected = hex::encode(mac.finalize().into_bytes());
    if expected != provided_sig {
        return None;
    }
    Some((user_id, email_type.to_string()))
}

#[derive(Deserialize)]
struct UnsubscribeQuery {
    token: String,
}

async fn do_unsubscribe(state: &AppState, token: &str) -> Result<Html<String>, StatusCode> {
    let (user_id, _email_type) = verify_token(&state.unsubscribe_secret, token)
        .ok_or(StatusCode::BAD_REQUEST)?;

    sqlx::query(
        r#"
        INSERT INTO email_preferences (user_id, unsubscribed_all, last_updated)
        VALUES ($1, TRUE, NOW())
        ON CONFLICT (user_id)
        DO UPDATE SET unsubscribed_all = TRUE, last_updated = NOW()
        "#,
    )
    .bind(user_id)
    .execute(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("unsubscribe db error: {e}");
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    Ok(Html(UNSUBSCRIBED_HTML.to_string()))
}

async fn unsubscribe_get(
    State(state): State<Arc<AppState>>,
    Query(q): Query<UnsubscribeQuery>,
) -> Result<Html<String>, StatusCode> {
    do_unsubscribe(&state, &q.token).await
}

async fn unsubscribe_post(
    State(state): State<Arc<AppState>>,
    Query(q): Query<UnsubscribeQuery>,
) -> Result<Html<String>, StatusCode> {
    do_unsubscribe(&state, &q.token).await
}

const UNSUBSCRIBED_HTML: &str = r#"<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Unsubscribed — metatron</title>
<style>body{font-family:'DM Sans',system-ui,sans-serif;background:#0a0a0f;color:#e8e8ed;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
.card{background:#16161f;border:1px solid rgba(255,255,255,0.06);border-radius:12px;padding:40px;max-width:440px;text-align:center}
h1{font-size:1.4rem;margin-bottom:12px}p{color:#8888a0;line-height:1.6}</style></head>
<body><div class="card"><h1>You've been unsubscribed</h1>
<p>You will no longer receive weekly match emails from metatron. You can re-enable them anytime in your dashboard settings.</p>
</div></body></html>"#;

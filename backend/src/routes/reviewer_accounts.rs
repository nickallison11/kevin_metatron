use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use axum::{
    extract::{Query, State},
    http::StatusCode,
    routing::{get, post},
    Json, Router,
};
use axum_extra::{
    headers::{authorization::Bearer, Authorization},
    TypedHeader,
};
use jsonwebtoken::{encode, Algorithm, Header};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::auth::Claims;
use crate::email;
use crate::identity::require_reviewer;
use crate::state::AppState;

use super::unsubscribe::{generate_token, verify_token};

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/magic-link", post(request_magic_link))
        .route("/consume", get(consume_magic_link))
        .route("/me/ratings", get(my_ratings))
}

fn internal(e: impl std::fmt::Display) -> (StatusCode, String) {
    tracing::error!("{e}");
    (StatusCode::INTERNAL_SERVER_ERROR, "internal error".to_string())
}

#[derive(Deserialize)]
struct MagicLinkRequest {
    email: String,
    name: Option<String>,
    return_to: Option<String>,
}

/// Always returns 200 regardless of whether the email already has a reviewer
/// account, to avoid enumeration.
async fn request_magic_link(
    State(state): State<Arc<AppState>>,
    Json(body): Json<MagicLinkRequest>,
) -> Json<serde_json::Value> {
    let email = body.email.trim().to_lowercase();
    if email.is_empty() || !email.contains('@') {
        return Json(serde_json::json!({ "ok": true }));
    }

    let reviewer_id: Result<Uuid, _> = sqlx::query_scalar(
        r#"
        INSERT INTO reviewer_accounts (email, name)
        VALUES ($1, $2)
        ON CONFLICT (email) DO UPDATE SET name = COALESCE(reviewer_accounts.name, EXCLUDED.name)
        RETURNING id
        "#,
    )
    .bind(&email)
    .bind(&body.name)
    .fetch_one(&state.db)
    .await;

    if let Ok(reviewer_id) = reviewer_id {
        let token = generate_token(&state.unsubscribe_secret, reviewer_id, "reviewer_login");
        let link_url = match &body.return_to {
            Some(rt) if !rt.trim().is_empty() => format!(
                "{}/reviewer-login?token={}&return_to={}",
                state.frontend_url,
                token,
                urlencoding::encode(rt)
            ),
            _ => format!("{}/reviewer-login?token={}", state.frontend_url, token),
        };
        let http_client = state.http_client.clone();
        let api_key = state.resend_api_key.clone();
        let from = state.email_from.clone();
        tokio::spawn(async move {
            email::send_reviewer_magic_link_email(
                &http_client,
                api_key.as_deref(),
                &from,
                &email,
                &link_url,
            )
            .await;
        });
    } else if let Err(e) = reviewer_id {
        tracing::error!("reviewer magic-link upsert failed: {e}");
    }

    Json(serde_json::json!({ "ok": true }))
}

#[derive(Deserialize)]
struct ConsumeQuery {
    token: String,
}

#[derive(Serialize)]
struct ConsumeResponse {
    token: String,
    name: Option<String>,
    email: String,
}

const REVIEWER_JWT_TTL_SECS: u64 = 30 * 24 * 3600;

async fn consume_magic_link(
    State(state): State<Arc<AppState>>,
    Query(q): Query<ConsumeQuery>,
) -> Result<Json<ConsumeResponse>, (StatusCode, String)> {
    let (reviewer_id, email_type) = verify_token(&state.unsubscribe_secret, &q.token)
        .ok_or((StatusCode::BAD_REQUEST, "invalid or expired link".to_string()))?;
    if email_type != "reviewer_login" {
        return Err((StatusCode::BAD_REQUEST, "invalid link".to_string()));
    }

    sqlx::query(
        "UPDATE reviewer_accounts SET email_verified_at = COALESCE(email_verified_at, now()) WHERE id = $1",
    )
    .bind(reviewer_id)
    .execute(&state.db)
    .await
    .map_err(internal)?;

    let (email, name): (String, Option<String>) = sqlx::query_as(
        "SELECT email, name FROM reviewer_accounts WHERE id = $1",
    )
    .bind(reviewer_id)
    .fetch_one(&state.db)
    .await
    .map_err(internal)?;

    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(internal)?
        .as_secs();
    let claims = Claims {
        sub: reviewer_id.to_string(),
        role: "REVIEWER".to_string(),
        exp: (now + Duration::from_secs(REVIEWER_JWT_TTL_SECS).as_secs()) as usize,
    };
    let jwt = encode(&Header::new(Algorithm::HS256), &claims, &state.jwt_encoding)
        .map_err(internal)?;

    Ok(Json(ConsumeResponse { token: jwt, name, email }))
}

#[derive(Serialize, sqlx::FromRow)]
struct MyRatingRow {
    id: Uuid,
    startup_user_id: Uuid,
    overall_stars: i16,
    comment: Option<String>,
    created_at: chrono::DateTime<chrono::Utc>,
}

async fn my_ratings(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
) -> Result<Json<Vec<MyRatingRow>>, (StatusCode, String)> {
    let reviewer = require_reviewer(&state, bearer.token()).await?;

    let rows = sqlx::query_as::<_, MyRatingRow>(
        r#"
        SELECT id, startup_user_id, overall_stars, comment, created_at
        FROM startup_ratings
        WHERE reviewer_account_id = $1
        ORDER BY created_at DESC
        "#,
    )
    .bind(reviewer.id)
    .fetch_all(&state.db)
    .await
    .map_err(internal)?;

    Ok(Json(rows))
}

use std::sync::Arc;

use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    routing::{get, post},
    Json, Router,
};
use serde::Serialize;
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::identity::{require_role, require_user_optional};
use crate::state::AppState;

use super::ratings::{bearer_token, client_ip};

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/mine", get(my_deck_views))
        .route("/:startup_user_id", post(record_view))
}

fn internal(e: impl std::fmt::Display) -> (StatusCode, String) {
    tracing::error!("deck_views: {e}");
    (StatusCode::INTERNAL_SERVER_ERROR, "internal error".to_string())
}

/// Separate salt namespace from `ratings::ip_hash` -- same technique, but a
/// different prefix so the two hash sets can never collide.
fn deck_view_ip_hash(state: &AppState, ip: &str) -> String {
    let data = format!("deck_view_ip:{}:{}", state.unsubscribe_secret, ip);
    hex::encode(Sha256::digest(data.as_bytes()))
}

const DEBOUNCE_MINUTES: i64 = 30;

async fn record_view(
    State(state): State<Arc<AppState>>,
    Path(startup_user_id): Path<Uuid>,
    headers: HeaderMap,
) -> Result<StatusCode, (StatusCode, String)> {
    let exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM users WHERE id = $1 AND role = 'STARTUP')",
    )
    .bind(startup_user_id)
    .fetch_one(&state.db)
    .await
    .map_err(internal)?;
    if !exists {
        return Err((StatusCode::NOT_FOUND, "startup not found".to_string()));
    }

    let viewer = require_user_optional(&state, bearer_token(&headers)).await?;

    let (viewer_user_id, viewer_ip_hash): (Option<Uuid>, Option<String>) = match &viewer {
        Some(user) => (Some(user.id), None),
        None => (None, Some(deck_view_ip_hash(&state, &client_ip(&headers)))),
    };

    // Debounce: a refresh/re-render firing this repeatedly shouldn't inflate
    // the view log -- one row per viewer per startup per 30 minutes.
    let recent: bool = sqlx::query_scalar(
        r#"
        SELECT EXISTS(
            SELECT 1 FROM deck_views
            WHERE startup_user_id = $1
              AND viewed_at > NOW() - make_interval(mins => $2)
              AND (
                ($3::uuid IS NOT NULL AND viewer_user_id = $3) OR
                ($3::uuid IS NULL AND $4::text IS NOT NULL AND viewer_ip_hash = $4)
              )
        )
        "#,
    )
    .bind(startup_user_id)
    .bind(DEBOUNCE_MINUTES as i32)
    .bind(viewer_user_id)
    .bind(&viewer_ip_hash)
    .fetch_one(&state.db)
    .await
    .map_err(internal)?;

    if !recent {
        sqlx::query(
            "INSERT INTO deck_views (startup_user_id, viewer_user_id, viewer_ip_hash, source) \
             VALUES ($1, $2, $3, 'directory')",
        )
        .bind(startup_user_id)
        .bind(viewer_user_id)
        .bind(&viewer_ip_hash)
        .execute(&state.db)
        .await
        .map_err(internal)?;
    }

    Ok(StatusCode::NO_CONTENT)
}

#[derive(Serialize, sqlx::FromRow)]
struct DeckViewRow {
    id: Uuid,
    viewed_at: chrono::DateTime<chrono::Utc>,
    source: String,
    viewer_email: Option<String>,
    viewer_role: Option<String>,
    viewer_org: Option<String>,
}

async fn my_deck_views(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<Vec<DeckViewRow>>, (StatusCode, String)> {
    let token = bearer_token(&headers)
        .ok_or((StatusCode::UNAUTHORIZED, "missing token".to_string()))?;
    let user = require_role(&state, token, &["STARTUP"]).await?;

    let rows = sqlx::query_as::<_, DeckViewRow>(
        r#"
        SELECT
            dv.id,
            dv.viewed_at,
            dv.source,
            u.email AS viewer_email,
            u.role::text AS viewer_role,
            COALESCE(ip.firm_name, cp.company_name) AS viewer_org
        FROM deck_views dv
        LEFT JOIN users u ON u.id = dv.viewer_user_id
        LEFT JOIN investor_profiles ip ON ip.user_id = dv.viewer_user_id
        LEFT JOIN profiles cp ON cp.user_id = dv.viewer_user_id AND dv.viewer_user_id != $1
        WHERE dv.startup_user_id = $1
        ORDER BY dv.viewed_at DESC
        LIMIT 50
        "#,
    )
    .bind(user.id)
    .fetch_all(&state.db)
    .await
    .map_err(internal)?;

    Ok(Json(rows))
}

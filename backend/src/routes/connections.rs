use std::sync::Arc;

use axum::{
    extract::State,
    routing::get,
    Json, Router,
};
use axum_extra::{
    headers::{authorization::Bearer, Authorization},
    TypedHeader,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::identity::require_user;
use crate::routes::profile::FounderPublicDto;
use crate::state::AppState;

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/", get(list_outgoing).post(create_connection))
        .route("/following", get(list_following_founders))
}

#[derive(Deserialize)]
pub struct CreateConnectionBody {
    pub to_user_id: Uuid,
    pub connection_type: String,
}

#[derive(Serialize, sqlx::FromRow)]
pub struct ConnectionOut {
    pub id: Uuid,
    pub to_user_id: Uuid,
    pub connection_type: String,
    pub status: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

async fn create_connection(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
    Json(body): Json<CreateConnectionBody>,
) -> Result<Json<ConnectionOut>, (axum::http::StatusCode, String)> {
    let u = require_user(&state, bearer.token()).await?;

    if body.to_user_id == u.id {
        return Err((
            axum::http::StatusCode::BAD_REQUEST,
            "cannot connect to self".to_string(),
        ));
    }

    let t = body.connection_type.to_lowercase();
    if !matches!(
        t.as_str(),
        "follow" | "message_request" | "intro_request"
    ) {
        return Err((
            axum::http::StatusCode::BAD_REQUEST,
            "invalid connection_type".to_string(),
        ));
    }

    let status: &str = if t == "follow" { "accepted" } else { "pending" };

    let row = sqlx::query_as::<_, ConnectionOut>(
        r#"
        INSERT INTO connections (from_user_id, to_user_id, connection_type, status)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (from_user_id, to_user_id) DO UPDATE SET
            connection_type = EXCLUDED.connection_type,
            status = EXCLUDED.status
        RETURNING id, to_user_id, connection_type, status, created_at
        "#,
    )
    .bind(u.id)
    .bind(body.to_user_id)
    .bind(&t)
    .bind(status)
    .fetch_one(&state.db)
    .await
    .map_err(internal)?;

    Ok(Json(row))
}

async fn list_outgoing(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
) -> Result<Json<Vec<ConnectionOut>>, (axum::http::StatusCode, String)> {
    let u = require_user(&state, bearer.token()).await?;

    let rows = sqlx::query_as::<_, ConnectionOut>(
        r#"
        SELECT id, to_user_id, connection_type, status, created_at
        FROM connections
        WHERE from_user_id = $1
        ORDER BY created_at DESC
        "#,
    )
    .bind(u.id)
    .fetch_all(&state.db)
    .await
    .map_err(internal)?;

    Ok(Json(rows))
}

async fn list_following_founders(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
) -> Result<Json<Vec<FounderPublicDto>>, (axum::http::StatusCode, String)> {
    let u = require_user(&state, bearer.token()).await?;

    let rows = sqlx::query_as::<_, FounderPublicDto>(
        r#"
        SELECT
            p.user_id,
            p.company_name,
            p.one_liner,
            p.stage,
            p.sector,
            p.country::text AS country,
            CASE WHEN u.is_basic = TRUE OR u.is_pro = TRUE OR p.deck_expires_at IS NULL OR p.deck_expires_at > NOW() THEN p.pitch_deck_url ELSE NULL END AS pitch_deck_url
        FROM connections c
        INNER JOIN profiles p ON p.user_id = c.to_user_id
        INNER JOIN users u ON u.id = p.user_id AND u.role = 'STARTUP'
        WHERE c.from_user_id = $1
          AND c.connection_type = 'follow'
          AND c.status = 'accepted'
        ORDER BY c.created_at DESC
        "#,
    )
    .bind(u.id)
    .fetch_all(&state.db)
    .await
    .map_err(internal)?;

    Ok(Json(rows))
}

fn internal<E: std::fmt::Debug>(_e: E) -> (axum::http::StatusCode, String) {
    (
        axum::http::StatusCode::INTERNAL_SERVER_ERROR,
        "internal error".to_string(),
    )
}

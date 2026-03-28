use std::sync::Arc;

use axum::{
    extract::State,
    headers::{authorization::Bearer, Authorization},
    routing::{get, post},
    Json, Router, TypedHeader,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::auth::Claims;
use crate::state::AppState;

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/", post(create_pool).get(list_pools))
}

#[derive(Deserialize)]
pub struct CreatePoolRequest {
    pub name: String,
    pub description: Option<String>,
}

#[derive(Serialize)]
pub struct PoolResponse {
    pub id: Uuid,
    pub name: String,
    pub description: Option<String>,
}

async fn create_pool(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
    Json(body): Json<CreatePoolRequest>,
) -> Result<Json<PoolResponse>, (axum::http::StatusCode, String)> {
    let claims = decode_claims(&state, bearer.token())?;
    let user_id = Uuid::parse_str(&claims.sub)
        .map_err(|_| (axum::http::StatusCode::UNAUTHORIZED, "invalid token".to_string()))?;

    let pool_id = Uuid::new_v4();

    sqlx::query!(
        r#"
        INSERT INTO funding_pools (id, name, description, created_by)
        VALUES ($1, $2, $3, $4)
        "#,
        pool_id,
        body.name,
        body.description,
        user_id
    )
    .execute(&state.db)
    .await
    .map_err(internal)?;

    Ok(Json(PoolResponse {
        id: pool_id,
        name: body.name,
        description: body.description,
    }))
}

async fn list_pools(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
) -> Result<Json<Vec<PoolResponse>>, (axum::http::StatusCode, String)> {
    let _claims = decode_claims(&state, bearer.token())?;

    let rows = sqlx::query!(
        r#"
        SELECT id, name, description
        FROM funding_pools
        ORDER BY created_at DESC
        "#
    )
    .fetch_all(&state.db)
    .await
    .map_err(internal)?;

    let items = rows
        .into_iter()
        .map(|r| PoolResponse {
            id: r.id,
            name: r.name,
            description: r.description,
        })
        .collect();

    Ok(Json(items))
}

fn decode_claims(
    state: &AppState,
    token: &str,
) -> Result<Claims, (axum::http::StatusCode, String)> {
    jsonwebtoken::decode::<Claims>(
        token,
        &state.jwt_decoding,
        &jsonwebtoken::Validation::new(jsonwebtoken::Algorithm::HS256),
    )
    .map(|data| data.claims)
    .map_err(|_| {
        (
            axum::http::StatusCode::UNAUTHORIZED,
            "invalid token".to_string(),
        )
    })
}

fn internal<E>(_err: E) -> (axum::http::StatusCode, String) {
    (
        axum::http::StatusCode::INTERNAL_SERVER_ERROR,
        "internal error".to_string(),
    )
}


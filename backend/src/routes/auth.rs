use std::sync::Arc;

use axum::{
    extract::State,
    http::StatusCode,
    routing::{post, put},
    Json, Router,
};
use axum_extra::{
    headers::{authorization::Bearer, Authorization},
    TypedHeader,
};
use serde::{Deserialize, Serialize};

use crate::auth;
use crate::identity::require_user;
use crate::state::AppState;

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/signup", post(signup))
        .route("/login", post(login))
        .route("/role", put(set_role))
}

#[derive(Deserialize)]
pub struct SignupRequest {
    pub email: String,
    pub password: String,
    /// Optional: `founder`, `investor`, or `connector` (maps to DB roles).
    #[serde(default)]
    pub role: Option<String>,
}

#[derive(Serialize)]
pub struct AuthResponse {
    pub token: String,
}

async fn signup(
    State(state): State<Arc<AppState>>,
    Json(body): Json<SignupRequest>,
) -> Result<Json<AuthResponse>, (axum::http::StatusCode, String)> {
    let db_role = auth::signup_role_from_frontend(body.role.as_deref());
    let user_id =
        auth::create_user_with_password(&state.db, &body.email, &body.password, db_role).await
        .map_err(|e| match e {
            auth::AuthError::EmailExists => (
                axum::http::StatusCode::CONFLICT,
                "email already in use".to_string(),
            ),
            _ => (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                "could not create user".to_string(),
            ),
        })?;

    let token = auth::issue_jwt(&state, user_id, db_role)
        .map_err(|_| {
            (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                "could not issue token".to_string(),
            )
        })?;

    Ok(Json(AuthResponse { token }))
}

async fn login(
    State(state): State<Arc<AppState>>,
    Json(body): Json<SignupRequest>,
) -> Result<Json<AuthResponse>, (axum::http::StatusCode, String)> {
    let user_id =
        auth::verify_user_credentials(&state.db, &body.email, &body.password)
            .await
            .map_err(|_| {
                (
                    axum::http::StatusCode::UNAUTHORIZED,
                    "invalid credentials".to_string(),
                )
            })?;

    let role: String = sqlx::query_scalar("SELECT role::text FROM users WHERE id = $1")
        .bind(user_id)
        .fetch_one(&state.db)
        .await
        .map_err(|_| {
            (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                "could not load role".to_string(),
            )
        })?;

    let token = auth::issue_jwt(&state, user_id, &role)
        .map_err(|_| {
            (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                "could not issue token".to_string(),
            )
        })?;

    Ok(Json(AuthResponse { token }))
}

#[derive(Deserialize)]
pub struct SetRoleRequest {
    pub role: String,
}

async fn set_role(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
    Json(body): Json<SetRoleRequest>,
) -> Result<StatusCode, (StatusCode, String)> {
    let authed = require_user(&state, bearer.token()).await?;

    sqlx::query(
        r#"
        UPDATE users
        SET role = $1::user_role
        WHERE id = $2
        "#,
    )
    .bind(auth::signup_role_from_frontend(Some(&body.role)))
    .bind(authed.id)
    .execute(&state.db)
    .await
    .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "internal error".to_string()))?;

    Ok(StatusCode::OK)
}

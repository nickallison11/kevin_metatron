use std::sync::Arc;

use axum::{extract::State, routing::post, Json, Router};
use serde::{Deserialize, Serialize};

use crate::auth;
use crate::state::AppState;

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/signup", post(signup))
        .route("/login", post(login))
}

#[derive(Deserialize)]
pub struct SignupRequest {
    pub email: String,
    pub password: String,
}

#[derive(Serialize)]
pub struct AuthResponse {
    pub token: String,
}

async fn signup(
    State(state): State<Arc<AppState>>,
    Json(body): Json<SignupRequest>,
) -> Result<Json<AuthResponse>, (axum::http::StatusCode, String)> {
    let user_id = auth::create_user_with_password(&state.db, &body.email, &body.password)
        .await
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

    let token = auth::issue_jwt(&state, user_id)
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

    let token = auth::issue_jwt(&state, user_id)
        .map_err(|_| {
            (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                "could not issue token".to_string(),
            )
        })?;

    Ok(Json(AuthResponse { token }))
}



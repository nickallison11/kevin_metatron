use axum::http::StatusCode;
use jsonwebtoken::{decode, Algorithm, Validation};
use uuid::Uuid;

use crate::auth::Claims;
use crate::state::AppState;

pub struct AuthedUser {
    pub id: Uuid,
    pub role: String,
}

pub async fn require_user(
    state: &AppState,
    token: &str,
) -> Result<AuthedUser, (StatusCode, String)> {
    let claims = decode::<Claims>(
        token,
        &state.jwt_decoding,
        &Validation::new(Algorithm::HS256),
    )
    .map_err(|_| (StatusCode::UNAUTHORIZED, "invalid token".to_string()))?
    .claims;

    let uid = Uuid::parse_str(&claims.sub)
        .map_err(|_| (StatusCode::UNAUTHORIZED, "invalid token".to_string()))?;

    let role: String = sqlx::query_scalar("SELECT role::text FROM users WHERE id = $1")
        .bind(uid)
        .fetch_one(&state.db)
        .await
        .map_err(|_| (StatusCode::UNAUTHORIZED, "user not found".to_string()))?;

    Ok(AuthedUser { id: uid, role })
}

pub async fn require_role(
    state: &AppState,
    token: &str,
    allowed: &[&str],
) -> Result<AuthedUser, (StatusCode, String)> {
    let u = require_user(state, token).await?;
    if !allowed.iter().any(|r| r.eq_ignore_ascii_case(&u.role)) {
        return Err((StatusCode::FORBIDDEN, "wrong role for this resource".to_string()));
    }
    Ok(u)
}

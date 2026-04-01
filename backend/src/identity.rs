use axum::http::StatusCode;
use jsonwebtoken::{decode, Algorithm, Validation};
use uuid::Uuid;

use crate::auth::Claims;
use crate::crypto;
use crate::state::AppState;

pub struct AuthedUser {
    pub id: Uuid,
    pub role: String,
    pub is_pro: bool,
    pub custom_ai_provider: Option<String>,
    pub custom_ai_api_key: Option<String>,
    pub custom_ai_model: Option<String>,
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

    let (
        role,
        is_pro,
        custom_ai_provider,
        custom_ai_api_key,
        custom_ai_model,
    ): (
        String,
        bool,
        Option<String>,
        Option<String>,
        Option<String>,
    ) = sqlx::query_as(
        r#"
        SELECT
            role::text,
            is_pro,
            custom_ai_provider,
            custom_ai_api_key,
            custom_ai_model
        FROM users
        WHERE id = $1
        "#,
    )
    .bind(uid)
    .fetch_one(&state.db)
    .await
    .map_err(|_| (StatusCode::UNAUTHORIZED, "user not found".to_string()))?;

    let custom_ai_api_key = match custom_ai_api_key {
        Some(encrypted) => match crypto::decrypt(&state.encryption_key, &encrypted) {
            Ok(value) => Some(value),
            Err(e) => {
                tracing::warn!("custom_ai_api_key decrypt failed for user {}: {}", uid, e);
                None
            }
        },
        None => None,
    };

    Ok(AuthedUser {
        id: uid,
        role,
        is_pro,
        custom_ai_provider,
        custom_ai_api_key,
        custom_ai_model,
    })
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

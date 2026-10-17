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
    pub is_basic: bool,
    pub is_admin: bool,
    pub is_super_admin: bool,
    pub subscription_tier: String,
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
        is_basic,
        is_admin,
        is_super_admin,
        subscription_tier,
        custom_ai_provider,
        custom_ai_api_key,
        custom_ai_model,
        is_suspended,
    ): (
        String,
        bool,
        bool,
        bool,
        bool,
        String,
        Option<String>,
        Option<String>,
        Option<String>,
        bool,
    ) = sqlx::query_as(
        r#"
        SELECT
            role::text,
            is_pro,
            is_basic,
            is_admin,
            is_super_admin,
            subscription_tier,
            custom_ai_provider,
            custom_ai_api_key,
            custom_ai_model,
            is_suspended
        FROM users
        WHERE id = $1
        "#,
    )
    .bind(uid)
    .fetch_one(&state.db)
    .await
    .map_err(|_| (StatusCode::UNAUTHORIZED, "user not found".to_string()))?;

    if is_suspended {
        return Err((StatusCode::FORBIDDEN, "account suspended".to_string()));
    }

    // Real activity signal for idle-timeout (see `auth::rotate_refresh_token`)
    // — every protected route goes through `require_user`, but the silent
    // token-refresh endpoint does not (it takes the refresh token directly,
    // no bearer auth), so this can't be gamed by just leaving a tab open.
    // Throttled to avoid a write on every single request from active users.
    if let Err(e) = sqlx::query(
        "UPDATE users SET last_active_at = now() WHERE id = $1 AND last_active_at < now() - INTERVAL '2 minutes'",
    )
    .bind(uid)
    .execute(&state.db)
    .await
    {
        tracing::warn!("require_user: last_active_at update failed for {}: {}", uid, e);
    }

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
        is_basic,
        is_admin,
        is_super_admin,
        subscription_tier,
        custom_ai_provider,
        custom_ai_api_key,
        custom_ai_model,
    })
}

pub async fn require_admin(
    state: &AppState,
    token: &str,
) -> Result<AuthedUser, (StatusCode, String)> {
    let u = require_user(state, token).await?;
    if !u.is_admin {
        return Err((StatusCode::FORBIDDEN, "admin only".to_string()));
    }
    Ok(u)
}

pub async fn require_super_admin(
    state: &AppState,
    token: &str,
) -> Result<AuthedUser, (StatusCode, String)> {
    let u = require_user(state, token).await?;
    if !u.is_super_admin {
        return Err((StatusCode::FORBIDDEN, "Forbidden".to_string()));
    }
    Ok(u)
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

/// Like `require_user`, but for routes usable both logged-in and logged-out
/// (e.g. rating submission) -- returns `Ok(None)` instead of erroring when
/// no token is present or the token is invalid/expired.
pub async fn require_user_optional(
    state: &AppState,
    token: Option<&str>,
) -> Result<Option<AuthedUser>, (StatusCode, String)> {
    match token {
        Some(t) => match require_user(state, t).await {
            Ok(u) => Ok(Some(u)),
            Err((StatusCode::UNAUTHORIZED, _)) => Ok(None),
            Err(e) => Err(e),
        },
        None => Ok(None),
    }
}

pub struct ReviewerAuthed {
    pub id: Uuid,
    pub email: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

/// Auth for the lightweight `reviewer_accounts` tier (magic-link JWTs with
/// `role: "REVIEWER"`) -- entirely separate from `require_user`, which only
/// ever looks up `users`.
pub async fn require_reviewer(
    state: &AppState,
    token: &str,
) -> Result<ReviewerAuthed, (StatusCode, String)> {
    let claims = decode::<Claims>(
        token,
        &state.jwt_decoding,
        &Validation::new(Algorithm::HS256),
    )
    .map_err(|_| (StatusCode::UNAUTHORIZED, "invalid token".to_string()))?
    .claims;

    if claims.role != "REVIEWER" {
        return Err((StatusCode::UNAUTHORIZED, "invalid token".to_string()));
    }

    let rid = Uuid::parse_str(&claims.sub)
        .map_err(|_| (StatusCode::UNAUTHORIZED, "invalid token".to_string()))?;

    let (email, created_at): (String, chrono::DateTime<chrono::Utc>) = sqlx::query_as(
        "SELECT email, created_at FROM reviewer_accounts WHERE id = $1",
    )
    .bind(rid)
    .fetch_one(&state.db)
    .await
    .map_err(|_| (StatusCode::UNAUTHORIZED, "reviewer not found".to_string()))?;

    Ok(ReviewerAuthed {
        id: rid,
        email,
        created_at,
    })
}

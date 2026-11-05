use std::time::{Duration, SystemTime, UNIX_EPOCH};

use argon2::{password_hash::SaltString, Argon2, PasswordHash, PasswordHasher, PasswordVerifier};
use jsonwebtoken::{decode, encode, Algorithm, Header, Validation};
use rand::RngCore;
use rand_core::OsRng;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::{PgPool, Row};
use thiserror::Error;
use uuid::Uuid;

use crate::state::AppState;

#[derive(Debug, Serialize, Deserialize)]
pub struct Claims {
    pub sub: String,
    pub role: String,
    pub exp: usize,
    /// Session (signed-in device) the token belongs to; absent on service tokens.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sid: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct OAuthStateClaims {
    pub sub: String,
    pub provider: String,
    pub exp: usize,
}

#[derive(Error, Debug)]
pub enum AuthError {
    #[error("email already in use")]
    EmailExists,
    #[error("invalid credentials")]
    InvalidCredentials,
    #[error("registration closed")]
    RegistrationClosed,
    #[error("verified email required")]
    EmailRequired,
    #[error("internal error")]
    Internal,
}

/// Postgres `user_role` label, e.g. `STARTUP`, `INVESTOR`, `INTERMEDIARY`.
pub fn signup_role_from_frontend(role: Option<&str>) -> &'static str {
    let s = role.unwrap_or("founder").to_ascii_lowercase();
    match s.as_str() {
        "investor" => "INVESTOR",
        "connector" => "INTERMEDIARY",
        _ => "STARTUP",
    }
}

pub async fn create_user_with_password(
    db: &PgPool,
    email: &str,
    password: &str,
    role: &str,
) -> Result<Uuid, AuthError> {
    let salt = SaltString::generate(&mut OsRng);
    let argon2 = Argon2::default();
    let password_hash = argon2
        .hash_password(password.as_bytes(), &salt)
        .map_err(|_| AuthError::Internal)?
        .to_string();

    let user_id = Uuid::new_v4();

    let res = sqlx::query(
        r#"
        INSERT INTO users (id, email, password_hash, role)
        VALUES ($1, $2, $3, $4::user_role)
        "#,
    )
    .bind(user_id)
    .bind(email)
    .bind(&password_hash)
    .bind(role)
    .execute(db)
    .await;

    match res {
        Ok(_) => Ok(user_id),
        Err(e) => {
            if let Some(code) = e.as_database_error().and_then(|d| d.code()) {
                if code == "23505" {
                    return Err(AuthError::EmailExists);
                }
            }
            Err(AuthError::Internal)
        }
    }
}

pub async fn verify_user_credentials(
    db: &PgPool,
    email: &str,
    password: &str,
) -> Result<Uuid, AuthError> {
    let row = sqlx::query(
        r#"
        SELECT id, password_hash
        FROM users
        WHERE LOWER(email) = LOWER($1)
        "#,
    )
    .bind(email)
    .fetch_optional(db)
    .await
    .map_err(|_| AuthError::Internal)?;

    let row = row.ok_or(AuthError::InvalidCredentials)?;
    let id: Uuid = row
        .try_get::<Uuid, _>("id")
        .map_err(|_| AuthError::Internal)?;
    let hash_opt: Option<String> = row
        .try_get::<Option<String>, _>("password_hash")
        .map_err(|_| AuthError::Internal)?;

    // OAuth-only users have no password hash
    let hash = hash_opt.ok_or(AuthError::InvalidCredentials)?;

    let parsed_hash = PasswordHash::new(&hash).map_err(|_| AuthError::Internal)?;

    Argon2::default()
        .verify_password(password.as_bytes(), &parsed_hash)
        .map_err(|_| AuthError::InvalidCredentials)?;

    Ok(id)
}

pub fn issue_jwt(
    state: &AppState,
    user_id: Uuid,
    role: &str,
) -> Result<String, AuthError> {
    issue_session_jwt(state, user_id, role, None)
}

/// Access token for a signed-in device; `sid` lets `require_user` record the
/// device's own activity.
fn issue_session_jwt(
    state: &AppState,
    user_id: Uuid,
    role: &str,
    session_id: Option<Uuid>,
) -> Result<String, AuthError> {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| AuthError::Internal)?
        .as_secs();
    let exp = now + Duration::from_secs(20 * 60).as_secs();

    let claims = Claims {
        sub: user_id.to_string(),
        role: role.to_string(),
        exp: exp as usize,
        sid: session_id.map(|s| s.to_string()),
    };

    encode(
        &Header::new(Algorithm::HS256),
        &claims,
        &state.jwt_encoding,
    )
    .map_err(|_| AuthError::Internal)
}

fn sha256_hex(raw_hex: &str) -> String {
    hex::encode(Sha256::digest(raw_hex.as_bytes()))
}

fn generate_raw_token() -> String {
    let mut raw = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut raw);
    hex::encode(raw)
}

/// A sign-in lasts at most this long, however active the device is.
pub const SESSION_MAX_SECS: i64 = 30 * 24 * 3600;

/// A device not used for this long is signed out. Activity is counted per
/// device (`auth_sessions.last_active_at`, touched by `require_user`); the
/// background token refresh doesn't count.
const IDLE_TIMEOUT_SECS: i64 = 7 * 24 * 3600;

/// Two tabs can refresh with the same token at once. The loser presents a
/// token rotated moments ago; within this window that's a race, not theft.
const ROTATION_GRACE_SECS: i64 = 30;

/// Inserts a refresh token for a session and returns its id and the raw
/// token to hand to the client. Only the SHA-256 hash is stored.
async fn create_refresh_token(
    state: &AppState,
    user_id: Uuid,
    session_id: Uuid,
) -> Result<(Uuid, String), AuthError> {
    let raw = generate_raw_token();
    let hash = sha256_hex(&raw);

    let id: Uuid = sqlx::query_scalar(
        r#"
        INSERT INTO refresh_tokens (user_id, token_hash, expires_at, session_id)
        VALUES ($1, $2, now() + make_interval(secs => $3), $4)
        RETURNING id
        "#,
    )
    .bind(user_id)
    .bind(&hash)
    .bind(SESSION_MAX_SECS as f64)
    .bind(session_id)
    .fetch_one(&state.db)
    .await
    .map_err(|_| AuthError::Internal)?;

    Ok((id, raw))
}

/// Starts a new session (one signed-in device) and issues its access token +
/// refresh token — the standard shape returned by every login-success path
/// (signup, login, 2FA, telegram, OAuth).
pub async fn issue_token_pair(
    state: &AppState,
    user_id: Uuid,
    role: &str,
) -> Result<(String, String), AuthError> {
    let session_id: Uuid =
        sqlx::query_scalar("INSERT INTO auth_sessions (user_id) VALUES ($1) RETURNING id")
            .bind(user_id)
            .fetch_one(&state.db)
            .await
            .map_err(|_| AuthError::Internal)?;
    let access_token = issue_session_jwt(state, user_id, role, Some(session_id))?;
    let (_, refresh_token) = create_refresh_token(state, user_id, session_id).await?;
    Ok((access_token, refresh_token))
}

/// Validates + rotates a refresh token: the presented token is revoked and
/// a new one issued in its place (`replaced_by` links them), so a refresh
/// token is single-use. A rotated token presented again after the grace
/// window is a strong signal of theft/replay — every session for that user
/// is revoked as a defense-in-depth response.
///
/// Returns a new refresh token, or `None` when a tab lost a refresh race:
/// it gets an access token only and keeps the newer refresh token the
/// winning tab already received (the cookie is shared).
pub async fn rotate_refresh_token(
    state: &AppState,
    raw_token: &str,
) -> Result<(Uuid, String, String, Option<String>), AuthError> {
    let hash = sha256_hex(raw_token);

    let row: Option<(Uuid, Uuid, Option<Uuid>, bool, bool, Option<Uuid>, bool)> = sqlx::query_as(
        r#"
        SELECT id, user_id, session_id,
               revoked_at IS NOT NULL,
               COALESCE(revoked_at > now() - make_interval(secs => $2), FALSE),
               replaced_by,
               expires_at < now()
        FROM refresh_tokens
        WHERE token_hash = $1
        "#,
    )
    .bind(&hash)
    .bind(ROTATION_GRACE_SECS as f64)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| AuthError::Internal)?;

    let Some((token_id, user_id, session_id, revoked, just_rotated, replaced_by, expired)) = row else {
        return Err(AuthError::InvalidCredentials);
    };
    // Tokens from before sessions existed that weren't live at the migration.
    let Some(session_id) = session_id else {
        return Err(AuthError::InvalidCredentials);
    };

    let session: Option<(bool, bool, bool)> = sqlx::query_as(
        r#"
        SELECT revoked_at IS NOT NULL,
               started_at < now() - make_interval(secs => $2),
               last_active_at < now() - make_interval(secs => $3)
        FROM auth_sessions WHERE id = $1
        "#,
    )
    .bind(session_id)
    .bind(SESSION_MAX_SECS as f64)
    .bind(IDLE_TIMEOUT_SECS as f64)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| AuthError::Internal)?;
    let Some((session_revoked, too_old, idle)) = session else {
        return Err(AuthError::InvalidCredentials);
    };
    if session_revoked {
        return Err(AuthError::InvalidCredentials);
    }
    if too_old || idle {
        revoke_session(state, session_id).await?;
        return Err(AuthError::InvalidCredentials);
    }

    let role: String = sqlx::query_scalar("SELECT role::text FROM users WHERE id = $1")
        .bind(user_id)
        .fetch_one(&state.db)
        .await
        .map_err(|_| AuthError::Internal)?;

    if revoked {
        // Only a replayed rotated token looks like theft. One revoked by
        // sign-out or a password change is just dead (its session is revoked
        // too, caught above).
        if replaced_by.is_some() && just_rotated {
            let access_token = issue_session_jwt(state, user_id, &role, Some(session_id))?;
            return Ok((user_id, role, access_token, None));
        }
        if replaced_by.is_some() {
            revoke_all_refresh_tokens(state, user_id).await?;
        }
        return Err(AuthError::InvalidCredentials);
    }
    if expired {
        return Err(AuthError::InvalidCredentials);
    }

    let (new_id, new_raw) = create_refresh_token(state, user_id, session_id).await?;

    sqlx::query("UPDATE refresh_tokens SET revoked_at = now(), replaced_by = $1 WHERE id = $2")
        .bind(new_id)
        .bind(token_id)
        .execute(&state.db)
        .await
        .map_err(|_| AuthError::Internal)?;

    let access_token = issue_session_jwt(state, user_id, &role, Some(session_id))?;

    Ok((user_id, role, access_token, Some(new_raw)))
}

async fn revoke_session(state: &AppState, session_id: Uuid) -> Result<(), AuthError> {
    sqlx::query("UPDATE auth_sessions SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL")
        .bind(session_id)
        .execute(&state.db)
        .await
        .map_err(|_| AuthError::Internal)?;
    sqlx::query("UPDATE refresh_tokens SET revoked_at = now() WHERE session_id = $1 AND revoked_at IS NULL")
        .bind(session_id)
        .execute(&state.db)
        .await
        .map_err(|_| AuthError::Internal)?;
    Ok(())
}

/// Signs out the device this refresh token belongs to.
pub async fn revoke_refresh_token(state: &AppState, raw_token: &str) -> Result<(), AuthError> {
    let hash = sha256_hex(raw_token);
    let session_id: Option<Option<Uuid>> =
        sqlx::query_scalar("SELECT session_id FROM refresh_tokens WHERE token_hash = $1")
            .bind(&hash)
            .fetch_optional(&state.db)
            .await
            .map_err(|_| AuthError::Internal)?;
    if let Some(sid) = session_id.flatten() {
        return revoke_session(state, sid).await;
    }
    sqlx::query("UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL")
        .bind(&hash)
        .execute(&state.db)
        .await
        .map_err(|_| AuthError::Internal)?;
    Ok(())
}

/// Signs out every device.
pub async fn revoke_all_refresh_tokens(state: &AppState, user_id: Uuid) -> Result<(), AuthError> {
    sqlx::query("UPDATE auth_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL")
        .bind(user_id)
        .execute(&state.db)
        .await
        .map_err(|_| AuthError::Internal)?;
    sqlx::query("UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL")
        .bind(user_id)
        .execute(&state.db)
        .await
        .map_err(|_| AuthError::Internal)?;
    Ok(())
}

/// Records activity on the device behind an access token, and reports
/// whether that device is still signed in. Throttled to one write every
/// 2 minutes.
pub async fn touch_session(state: &AppState, session_id: Uuid) -> Result<bool, AuthError> {
    let live: Option<bool> = sqlx::query_scalar(
        "SELECT revoked_at IS NULL FROM auth_sessions WHERE id = $1",
    )
    .bind(session_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| AuthError::Internal)?;
    if live != Some(true) {
        return Ok(false);
    }
    sqlx::query(
        "UPDATE auth_sessions SET last_active_at = now() WHERE id = $1 AND last_active_at < now() - INTERVAL '2 minutes'",
    )
    .bind(session_id)
    .execute(&state.db)
    .await
    .map_err(|_| AuthError::Internal)?;
    Ok(true)
}


pub fn issue_oauth_state(state: &AppState, provider: &str) -> Result<String, AuthError> {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| AuthError::Internal)?
        .as_secs();
    let exp = now + 300; // 5 minutes

    let claims = OAuthStateClaims {
        sub: "oauth_state".to_string(),
        provider: provider.to_string(),
        exp: exp as usize,
    };

    encode(
        &Header::new(Algorithm::HS256),
        &claims,
        &state.jwt_encoding,
    )
    .map_err(|_| AuthError::Internal)
}

pub fn verify_oauth_state(
    state: &AppState,
    token: &str,
    expected_provider: &str,
) -> Result<(), AuthError> {
    let claims = decode::<OAuthStateClaims>(
        token,
        &state.jwt_decoding,
        &Validation::new(Algorithm::HS256),
    )
    .map_err(|_| AuthError::InvalidCredentials)?
    .claims;

    if claims.sub != "oauth_state" || claims.provider != expected_provider {
        return Err(AuthError::InvalidCredentials);
    }

    Ok(())
}

pub async fn find_or_create_oauth_user(
    db: &PgPool,
    provider: &str,
    provider_uid: &str,
    email: Option<&str>,
    access_token: &str,
    allow_create: bool,
) -> Result<(Uuid, bool), AuthError> {
    // 1) Existing oauth account: update token and return.
    let existing_user_id: Option<Uuid> = sqlx::query_scalar(
        r#"
        SELECT user_id
        FROM oauth_accounts
        WHERE provider = $1 AND provider_uid = $2
        "#,
    )
    .bind(provider)
    .bind(provider_uid)
    .fetch_optional(db)
    .await
    .map_err(|_| AuthError::Internal)?;

    if let Some(user_id) = existing_user_id {
        sqlx::query(
            r#"
            UPDATE oauth_accounts
            SET access_token = $1
            WHERE provider = $2 AND provider_uid = $3
            "#,
        )
        .bind(access_token)
        .bind(provider)
        .bind(provider_uid)
        .execute(db)
        .await
        .map_err(|_| AuthError::Internal)?;

        return Ok((user_id, false));
    }

    // 2) Existing platform user by email: link oauth account. Callers pass
    // only an email the provider has verified, so nobody can attach their
    // login to someone else's account by claiming that address.
    let email = email.map(|e| e.trim().to_lowercase());
    if let Some(email) = email.as_deref() {
        let existing_user_id: Option<Uuid> = sqlx::query_scalar(
            r#"
            SELECT id
            FROM users
            WHERE LOWER(email) = $1
            "#,
        )
        .bind(email)
        .fetch_optional(db)
        .await
        .map_err(|_| AuthError::Internal)?;

        if let Some(user_id) = existing_user_id {
            sqlx::query(
                r#"
                INSERT INTO oauth_accounts (user_id, provider, provider_uid, access_token)
                VALUES ($1, $2, $3, $4)
                "#,
            )
            .bind(user_id)
            .bind(provider)
            .bind(provider_uid)
            .bind(access_token)
            .execute(db)
            .await
            .map_err(|_| AuthError::Internal)?;

            return Ok((user_id, false));
        }
    }

    // 3) New platform user (OAuth-only => no password_hash).
    if !allow_create {
        return Err(AuthError::RegistrationClosed);
    }
    let Some(email_val) = email.as_deref() else {
        return Err(AuthError::EmailRequired);
    };
    let user_id = Uuid::new_v4();

    sqlx::query(
        r#"
        INSERT INTO users (id, email, password_hash, role)
        VALUES ($1, $2, NULL, 'STARTUP'::user_role)
        "#,
    )
    .bind(user_id)
    .bind(email_val)
    .execute(db)
    .await
    .map_err(|_| AuthError::Internal)?;

    sqlx::query(
        r#"
        INSERT INTO oauth_accounts (user_id, provider, provider_uid, access_token)
        VALUES ($1, $2, $3, $4)
        "#,
    )
    .bind(user_id)
    .bind(provider)
    .bind(provider_uid)
    .bind(access_token)
    .execute(db)
    .await
    .map_err(|_| AuthError::Internal)?;

    Ok((user_id, true))
}

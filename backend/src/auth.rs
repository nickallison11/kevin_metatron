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
        WHERE email = $1
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
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| AuthError::Internal)?
        .as_secs();
    let exp = now + Duration::from_secs(20 * 60).as_secs();

    let claims = Claims {
        sub: user_id.to_string(),
        role: role.to_string(),
        exp: exp as usize,
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

const REFRESH_TOKEN_TTL_SECS: i64 = 30 * 24 * 3600;

/// Inserts a new refresh token row (30-day sliding expiry) and returns the
/// raw token to hand to the client. Only the SHA-256 hash is stored.
async fn create_refresh_token(state: &AppState, user_id: Uuid) -> Result<String, AuthError> {
    let raw = generate_raw_token();
    let hash = sha256_hex(&raw);

    sqlx::query(
        r#"
        INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
        VALUES ($1, $2, now() + make_interval(secs => $3))
        "#,
    )
    .bind(user_id)
    .bind(&hash)
    .bind(REFRESH_TOKEN_TTL_SECS as f64)
    .execute(&state.db)
    .await
    .map_err(|_| AuthError::Internal)?;

    Ok(raw)
}

/// Issues a fresh access token + refresh token pair — the standard shape
/// returned by every login-success path (signup, login, 2FA, telegram,
/// OAuth).
pub async fn issue_token_pair(
    state: &AppState,
    user_id: Uuid,
    role: &str,
) -> Result<(String, String), AuthError> {
    let access_token = issue_jwt(state, user_id, role)?;
    let refresh_token = create_refresh_token(state, user_id).await?;
    Ok((access_token, refresh_token))
}

/// Validates + rotates a refresh token: the presented token is revoked and
/// a new one issued in its place (`replaced_by` links them), so a refresh
/// token is single-use. If a token that's already been rotated is presented
/// again, that's a strong signal of theft/replay — every refresh token for
/// that user is revoked as a defense-in-depth response.
pub async fn rotate_refresh_token(
    state: &AppState,
    raw_token: &str,
) -> Result<(Uuid, String, String, String), AuthError> {
    let hash = sha256_hex(raw_token);

    let row: Option<(Uuid, Uuid, Option<chrono::DateTime<chrono::Utc>>, chrono::DateTime<chrono::Utc>)> =
        sqlx::query_as(
            r#"
            SELECT id, user_id, revoked_at, expires_at
            FROM refresh_tokens
            WHERE token_hash = $1
            "#,
        )
        .bind(&hash)
        .fetch_optional(&state.db)
        .await
        .map_err(|_| AuthError::Internal)?;

    let Some((token_id, user_id, revoked_at, expires_at)) = row else {
        return Err(AuthError::InvalidCredentials);
    };

    if revoked_at.is_some() {
        revoke_all_refresh_tokens(state, user_id).await?;
        return Err(AuthError::InvalidCredentials);
    }

    if expires_at < chrono::Utc::now() {
        return Err(AuthError::InvalidCredentials);
    }

    let role: String = sqlx::query_scalar("SELECT role::text FROM users WHERE id = $1")
        .bind(user_id)
        .fetch_one(&state.db)
        .await
        .map_err(|_| AuthError::Internal)?;

    let new_raw = generate_raw_token();
    let new_hash = sha256_hex(&new_raw);

    let new_id: Uuid = sqlx::query_scalar(
        r#"
        INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
        VALUES ($1, $2, now() + make_interval(secs => $3))
        RETURNING id
        "#,
    )
    .bind(user_id)
    .bind(&new_hash)
    .bind(REFRESH_TOKEN_TTL_SECS as f64)
    .fetch_one(&state.db)
    .await
    .map_err(|_| AuthError::Internal)?;

    sqlx::query("UPDATE refresh_tokens SET revoked_at = now(), replaced_by = $1 WHERE id = $2")
        .bind(new_id)
        .bind(token_id)
        .execute(&state.db)
        .await
        .map_err(|_| AuthError::Internal)?;

    let access_token = issue_jwt(state, user_id, &role)?;

    Ok((user_id, role, access_token, new_raw))
}

pub async fn revoke_refresh_token(state: &AppState, raw_token: &str) -> Result<(), AuthError> {
    let hash = sha256_hex(raw_token);
    sqlx::query("UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL")
        .bind(&hash)
        .execute(&state.db)
        .await
        .map_err(|_| AuthError::Internal)?;
    Ok(())
}

pub async fn revoke_all_refresh_tokens(state: &AppState, user_id: Uuid) -> Result<(), AuthError> {
    sqlx::query("UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL")
        .bind(user_id)
        .execute(&state.db)
        .await
        .map_err(|_| AuthError::Internal)?;
    Ok(())
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

    // 2) Existing platform user by email: link oauth account.
    if let Some(email) = email {
        let existing_user_id: Option<Uuid> = sqlx::query_scalar(
            r#"
            SELECT id
            FROM users
            WHERE email = $1
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
    let user_id = Uuid::new_v4();
    let email_val = email.unwrap_or("unknown@oauth.metatron.id");

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

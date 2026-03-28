use std::time::{Duration, SystemTime, UNIX_EPOCH};

use argon2::{password_hash::SaltString, Argon2, PasswordHash, PasswordHasher, PasswordVerifier};
use jsonwebtoken::{encode, Algorithm, Header};
use rand_core::OsRng;
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use thiserror::Error;
use uuid::Uuid;

use crate::state::AppState;

#[derive(Debug, Serialize, Deserialize)]
pub struct Claims {
    pub sub: String,
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

pub async fn create_user_with_password(
    db: &PgPool,
    email: &str,
    password: &str,
) -> Result<Uuid, AuthError> {
    let salt = SaltString::generate(&mut OsRng);
    let argon2 = Argon2::default();
    let password_hash = argon2
        .hash_password(password.as_bytes(), &salt)
        .map_err(|_| AuthError::Internal)?
        .to_string();

    let user_id = Uuid::new_v4();

    let res = sqlx::query!(
        r#"
        INSERT INTO users (id, email, password_hash, role)
        VALUES ($1, $2, $3, 'STARTUP')
        "#,
        user_id,
        email,
        password_hash
    )
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
    let row = sqlx::query!(
        r#"
        SELECT id, password_hash
        FROM users
        WHERE email = $1
        "#,
        email
    )
    .fetch_optional(db)
    .await
    .map_err(|_| AuthError::Internal)?;

    let row = row.ok_or(AuthError::InvalidCredentials)?;

    let parsed_hash =
        PasswordHash::new(&row.password_hash).map_err(|_| AuthError::Internal)?;

    Argon2::default()
        .verify_password(password.as_bytes(), &parsed_hash)
        .map_err(|_| AuthError::InvalidCredentials)?;

    Ok(row.id)
}

pub fn issue_jwt(state: &AppState, user_id: Uuid) -> Result<String, AuthError> {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| AuthError::Internal)?
        .as_secs();
    let exp = now + Duration::from_hours(24).as_secs();

    let claims = Claims {
        sub: user_id.to_string(),
        exp: exp as usize,
    };

    encode(
        &Header::new(Algorithm::HS256),
        &claims,
        &state.jwt_encoding,
    )
    .map_err(|_| AuthError::Internal)
}


use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use argon2::{
    password_hash::{PasswordHash, PasswordHasher, SaltString},
    Argon2, PasswordVerifier,
};
use axum::{
    extract::State,
    http::StatusCode,
    routing::{delete, get, post, put},
    Json, Router,
};
use axum_extra::{
    headers::{authorization::Bearer, Authorization},
    TypedHeader,
};
use serde::{Deserialize, Serialize};
use totp_rs::{Algorithm as TotpAlgorithm, Secret as TotpSecret, TOTP};

use jsonwebtoken::{decode, encode, Algorithm as JwtAlgorithm, Header, Validation};
use rand::RngCore;
use rand_core::OsRng;
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::auth;
use crate::crypto;
use crate::email;
use crate::identity::require_user;
use crate::state::AppState;

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/register", post(signup))
        .route("/login", post(login))
        .route("/forgot-password", post(forgot_password))
        .route("/reset-password", post(reset_password))
        .route("/telegram", post(telegram_auth))
        .route("/change-email", put(change_email))
        .route("/change-password", put(change_password))
        .route("/profile", put(update_profile))
        .route("/me", get(get_me))
        .route("/2fa/setup", post(two_fa_setup))
        .route("/2fa/confirm", post(two_fa_confirm))
        .route("/2fa", delete(two_fa_disable))
        .route("/2fa/login", post(two_fa_login))
        .route("/account", delete(delete_account))
        .route("/me/export", get(export_data))
        .route("/role", put(set_role))
        .route("/ai-settings", put(set_ai_settings))
}

#[derive(Deserialize)]
pub struct ForgotPasswordRequest {
    pub email: String,
}

#[derive(Deserialize)]
pub struct ResetPasswordRequest {
    pub token: String,
    pub new_password: String,
}

#[derive(Deserialize)]
pub struct SignupRequest {
    pub email: String,
    pub password: String,
    /// Optional: `founder`, `investor`, or `connector` (maps to DB roles).
    #[serde(default)]
    pub role: Option<String>,
}

#[derive(Deserialize)]
pub struct ChangeEmailRequest {
    pub current_password: String,
    pub new_email: String,
}

#[derive(Deserialize)]
pub struct ChangePasswordRequest {
    pub current_password: String,
    pub new_password: String,
}

#[derive(Deserialize)]
pub struct UpdateProfileRequest {
    pub first_name: String,
    pub last_name: String,
}

#[derive(Deserialize)]
pub struct TwoFaConfirmRequest {
    pub code: String,
}

#[derive(Deserialize)]
pub struct TwoFaDisableRequest {
    pub code: String,
}

#[derive(Deserialize)]
pub struct TwoFaLoginRequest {
    pub partial_token: String,
    pub code: String,
}

#[derive(Serialize)]
pub struct TwoFaSetupResponse {
    pub otpauth_uri: String,
    pub secret: String,
}

#[derive(Serialize)]
pub struct AuthResponse {
    pub token: String,
}

#[derive(Serialize)]
struct LoginResponse {
    #[serde(skip_serializing_if = "Option::is_none")]
    token: Option<String>,
    requires_2fa: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    partial_token: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct TwoFaPendingClaims {
    pub sub: String,
    pub role: String,
    pub exp: usize,
    pub two_fa_pending: bool,
}

#[derive(Serialize)]
struct ErrorResponse {
    error: String,
}

#[derive(Deserialize)]
pub struct TelegramAuthRequest {
    pub telegram_id: String,
    pub telegram_name: Option<String>,
    pub bot_secret: String,
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

    email::send_email(
        &state.http_client,
        state.resend_api_key.as_deref(),
        &state.email_from,
        &body.email,
        "Welcome to metatron",
        &email::welcome_email_html(),
    )
    .await;

    Ok(Json(AuthResponse { token }))
}

fn sha256_hex_token(token_hex: &str) -> String {
    let digest = Sha256::digest(token_hex.as_bytes());
    hex::encode(digest)
}

async fn forgot_password(
    State(state): State<Arc<AppState>>,
    Json(body): Json<ForgotPasswordRequest>,
) -> StatusCode {
    let email = body.email.trim();
    if email.is_empty() {
        return StatusCode::OK;
    }

    let user: Option<(Uuid, String)> = sqlx::query_as::<_, (Uuid, String)>(
        "SELECT id, email FROM users WHERE email = $1",
    )
    .bind(email)
    .fetch_optional(&state.db)
    .await
    .unwrap_or(None);

    if let Some((user_id, user_email)) = user {
        let mut raw = [0u8; 32];
        rand::thread_rng().fill_bytes(&mut raw);
        let token_hex = hex::encode(raw);
        let token_hash = sha256_hex_token(&token_hex);

        let insert = sqlx::query(
            r#"
            INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
            VALUES ($1, $2, NOW() + INTERVAL '1 hour')
            "#,
        )
        .bind(user_id)
        .bind(&token_hash)
        .execute(&state.db)
        .await;

        if insert.is_ok() {
            email::send_password_reset_email(
                &state.http_client,
                state.resend_api_key.as_deref(),
                &state.email_from,
                &user_email,
                &token_hex,
            )
            .await;
        }
    }

    StatusCode::OK
}

async fn reset_password(
    State(state): State<Arc<AppState>>,
    Json(body): Json<ResetPasswordRequest>,
) -> Result<StatusCode, (StatusCode, String)> {
    let token_hex = body.token.trim();
    if token_hex.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            "Invalid or expired reset link".to_string(),
        ));
    }

    let token_hash = sha256_hex_token(token_hex);

    let row: Option<(Uuid, Uuid)> = sqlx::query_as::<_, (Uuid, Uuid)>(
        r#"
        SELECT id, user_id
        FROM password_reset_tokens
        WHERE token_hash = $1
          AND used_at IS NULL
          AND expires_at > NOW()
        "#,
    )
    .bind(&token_hash)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "internal error".to_string(),
        )
    })?;

    let Some((token_id, user_id)) = row else {
        return Err((
            StatusCode::BAD_REQUEST,
            "Invalid or expired reset link".to_string(),
        ));
    };

    let new_hash =
        hash_password(&body.new_password).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;

    let mut tx = state.db.begin().await.map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "internal error".to_string(),
        )
    })?;

    sqlx::query("UPDATE users SET password_hash = $1 WHERE id = $2")
        .bind(&new_hash)
        .bind(user_id)
        .execute(&mut *tx)
        .await
        .map_err(|_| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "internal error".to_string(),
            )
        })?;

    sqlx::query("UPDATE password_reset_tokens SET used_at = NOW() WHERE id = $1")
        .bind(token_id)
        .execute(&mut *tx)
        .await
        .map_err(|_| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "internal error".to_string(),
            )
        })?;

    tx.commit().await.map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "internal error".to_string(),
        )
    })?;

    Ok(StatusCode::OK)
}

async fn login(
    State(state): State<Arc<AppState>>,
    Json(body): Json<SignupRequest>,
) -> Result<Json<LoginResponse>, (axum::http::StatusCode, String)> {
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

    let totp_enabled: bool = sqlx::query_scalar("SELECT totp_enabled FROM users WHERE id = $1")
        .bind(user_id)
        .fetch_one(&state.db)
        .await
        .map_err(|_| {
            (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                "could not load 2FA status".to_string(),
            )
        })?;

    if totp_enabled {
        let partial_token = issue_two_fa_pending_jwt(&state, user_id, &role).map_err(
            |_| {
                (
                    axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                    "could not issue 2FA token".to_string(),
                )
            },
        )?;
        return Ok(Json(LoginResponse {
            token: None,
            requires_2fa: true,
            partial_token: Some(partial_token),
        }));
    }

    let token = auth::issue_jwt(&state, user_id, &role).map_err(|_| {
        (
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            "could not issue token".to_string(),
        )
    })?;

    Ok(Json(LoginResponse {
        token: Some(token),
        requires_2fa: false,
        partial_token: None,
    }))
}

fn issue_two_fa_pending_jwt(
    state: &AppState,
    user_id: uuid::Uuid,
    role: &str,
) -> Result<String, auth::AuthError> {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| auth::AuthError::Internal)?
        .as_secs();
    let exp = now + Duration::from_secs(300).as_secs(); // short-lived (5 minutes)

    let claims = TwoFaPendingClaims {
        sub: user_id.to_string(),
        role: role.to_string(),
        exp: exp as usize,
        two_fa_pending: true,
    };

    encode(
        &Header::new(JwtAlgorithm::HS256),
        &claims,
        &state.jwt_encoding,
    )
    .map_err(|_| auth::AuthError::Internal)
}

fn verify_password_hash(stored_hash: &str, password: &str) -> Result<(), String> {
    let parsed_hash = PasswordHash::new(stored_hash).map_err(|_| "invalid password hash".to_string())?;
    Argon2::default()
        .verify_password(password.as_bytes(), &parsed_hash)
        .map_err(|_| "invalid current password".to_string())?;
    Ok(())
}

fn hash_password(password: &str) -> Result<String, String> {
    let salt = SaltString::generate(&mut OsRng);
    let argon2 = Argon2::default();
    argon2
        .hash_password(password.as_bytes(), &salt)
        .map_err(|_| "could not hash password".to_string())
        .map(|h| h.to_string())
}

fn totp_from_base32_secret(secret_base32: &str, account_name: String) -> Result<TOTP, String> {
    let secret = TotpSecret::Encoded(secret_base32.to_string());
    TOTP::new(
        TotpAlgorithm::SHA1,
        6,
        1,
        30,
        secret.to_bytes().map_err(|_| "invalid 2FA secret".to_string())?,
        Some("Metatron".to_string()),
        account_name,
    )
    .map_err(|e| format!("could not build TOTP: {e}"))
}

fn decode_partial_token(
    state: &AppState,
    partial_token: &str,
) -> Result<TwoFaPendingClaims, (StatusCode, String)> {
    let claims = decode::<TwoFaPendingClaims>(
        partial_token,
        &state.jwt_decoding,
        &Validation::new(JwtAlgorithm::HS256),
    )
    .map_err(|_| (StatusCode::UNAUTHORIZED, "invalid 2FA token".to_string()))?
    .claims;

    if !claims.two_fa_pending {
        return Err((
            StatusCode::UNAUTHORIZED,
            "2FA token not pending".to_string(),
        ));
    }

    Ok(claims)
}

async fn change_email(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
    Json(body): Json<ChangeEmailRequest>,
) -> Result<StatusCode, (StatusCode, String)> {
    let authed = require_user(&state, bearer.token()).await?;

    let stored_hash: Option<String> = sqlx::query_scalar(
        "SELECT password_hash FROM users WHERE id = $1",
    )
    .bind(authed.id)
    .fetch_one(&state.db)
    .await
    .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "internal error".to_string()))?;

    let stored_hash = stored_hash.ok_or((
        StatusCode::FORBIDDEN,
        "password not set for this account".to_string(),
    ))?;

    verify_password_hash(&stored_hash, &body.current_password)
        .map_err(|e| (StatusCode::UNAUTHORIZED, e))?;

    let old_email: String = sqlx::query_scalar("SELECT email FROM users WHERE id = $1")
        .bind(authed.id)
        .fetch_one(&state.db)
        .await
        .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "internal error".to_string()))?;

    let email_in_use: Option<uuid::Uuid> = sqlx::query_scalar(
        "SELECT id FROM users WHERE email = $1 AND id <> $2",
    )
    .bind(&body.new_email)
    .bind(authed.id)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "internal error".to_string()))?;

    if email_in_use.is_some() {
        return Err((
            StatusCode::CONFLICT,
            "email already in use".to_string(),
        ));
    }

    sqlx::query("UPDATE users SET email = $1 WHERE id = $2")
        .bind(&body.new_email)
        .bind(authed.id)
        .execute(&state.db)
        .await
        .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "internal error".to_string()))?;

    email::send_email(
        &state.http_client,
        state.resend_api_key.as_deref(),
        &state.email_from,
        &old_email,
        "Your metatron email has been changed",
        &email::email_changed_notice_html(&body.new_email),
    )
    .await;

    Ok(StatusCode::OK)
}

async fn change_password(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
    Json(body): Json<ChangePasswordRequest>,
) -> Result<StatusCode, (StatusCode, String)> {
    let authed = require_user(&state, bearer.token()).await?;

    let stored_hash: Option<String> = sqlx::query_scalar(
        "SELECT password_hash FROM users WHERE id = $1",
    )
    .bind(authed.id)
    .fetch_one(&state.db)
    .await
    .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "internal error".to_string()))?;

    let stored_hash = stored_hash.ok_or((
        StatusCode::FORBIDDEN,
        "password not set for this account".to_string(),
    ))?;

    verify_password_hash(&stored_hash, &body.current_password)
        .map_err(|e| (StatusCode::UNAUTHORIZED, e))?;

    let new_hash =
        hash_password(&body.new_password).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;

    sqlx::query("UPDATE users SET password_hash = $1 WHERE id = $2")
        .bind(new_hash)
        .bind(authed.id)
        .execute(&state.db)
        .await
        .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "internal error".to_string()))?;

    Ok(StatusCode::OK)
}

#[derive(Serialize, sqlx::FromRow)]
pub struct MeResponse {
    pub id: Uuid,
    pub email: String,
    pub role: String,
    pub is_pro: bool,
    pub totp_enabled: bool,
    pub first_name: Option<String>,
    pub last_name: Option<String>,
}

async fn update_profile(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
    Json(body): Json<UpdateProfileRequest>,
) -> Result<StatusCode, (StatusCode, String)> {
    let authed = require_user(&state, bearer.token()).await?;

    let first = body.first_name.trim();
    let last = body.last_name.trim();
    let first_opt = if first.is_empty() { None } else { Some(first.to_string()) };
    let last_opt = if last.is_empty() { None } else { Some(last.to_string()) };

    sqlx::query(
        r#"
        UPDATE users
        SET first_name = $1,
            last_name = $2
        WHERE id = $3
        "#,
    )
    .bind(first_opt)
    .bind(last_opt)
    .bind(authed.id)
    .execute(&state.db)
    .await
    .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "internal error".to_string()))?;

    Ok(StatusCode::OK)
}

async fn get_me(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
) -> Result<Json<MeResponse>, (StatusCode, String)> {
    let authed = require_user(&state, bearer.token()).await?;

    let me = sqlx::query_as::<_, MeResponse>(
        r#"
        SELECT
            id,
            email,
            role::text AS role,
            is_pro,
            totp_enabled,
            first_name,
            last_name
        FROM users
        WHERE id = $1
        "#,
    )
    .bind(authed.id)
    .fetch_one(&state.db)
    .await
    .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "internal error".to_string()))?;

    Ok(Json(me))
}

async fn two_fa_setup(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
) -> Result<Json<TwoFaSetupResponse>, (StatusCode, String)> {
    let authed = require_user(&state, bearer.token()).await?;

    let email: String = sqlx::query_scalar("SELECT email FROM users WHERE id = $1")
        .bind(authed.id)
        .fetch_one(&state.db)
        .await
        .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "internal error".to_string()))?;

    let secret = TotpSecret::generate_secret();
    let totp = TOTP::new(
        TotpAlgorithm::SHA1,
        6,
        1,
        30,
        secret.to_bytes().map_err(|_| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "invalid 2FA secret".to_string(),
            )
        })?,
        Some("Metatron".to_string()),
        email.clone(),
    )
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("could not build TOTP: {e}")))?;
    let secret_base32 = totp.get_secret_base32();
    let otpauth_uri = totp.get_url();

    let encrypted_secret =
        crypto::encrypt(&state.encryption_key, &secret_base32).map_err(|_| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "internal error".to_string(),
            )
        })?;

    sqlx::query(
        r#"
        UPDATE users
        SET totp_secret = $1,
            totp_enabled = FALSE
        WHERE id = $2
        "#,
    )
    .bind(encrypted_secret)
    .bind(authed.id)
    .execute(&state.db)
    .await
    .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "internal error".to_string()))?;

    Ok(Json(TwoFaSetupResponse {
        otpauth_uri,
        secret: secret_base32,
    }))
}

async fn two_fa_confirm(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
    Json(body): Json<TwoFaConfirmRequest>,
) -> Result<StatusCode, (StatusCode, String)> {
    let authed = require_user(&state, bearer.token()).await?;

    let (totp_enabled, totp_secret_enc): (bool, Option<String>) = sqlx::query_as(
        "SELECT totp_enabled, totp_secret FROM users WHERE id = $1",
    )
    .bind(authed.id)
    .fetch_one(&state.db)
    .await
    .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "internal error".to_string()))?;

    let totp_secret_enc = totp_secret_enc.ok_or((
        StatusCode::BAD_REQUEST,
        "2FA not set up".to_string(),
    ))?;

    // Allow confirming even if already enabled; we just validate the code.
    let secret_base32 = crypto::decrypt(&state.encryption_key, &totp_secret_enc)
        .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "internal error".to_string()))?;

    let email: String = sqlx::query_scalar("SELECT email FROM users WHERE id = $1")
        .bind(authed.id)
        .fetch_one(&state.db)
        .await
        .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "internal error".to_string()))?;

    let totp = totp_from_base32_secret(&secret_base32, email)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;

    let ok = totp
        .check_current(&body.code)
        .map_err(|_| (StatusCode::BAD_REQUEST, "invalid code".to_string()))?;

    if !ok {
        return Err((
            StatusCode::BAD_REQUEST,
            "invalid 2FA code".to_string(),
        ));
    }

    sqlx::query("UPDATE users SET totp_enabled = TRUE WHERE id = $1")
        .bind(authed.id)
        .execute(&state.db)
        .await
        .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "internal error".to_string()))?;

    // Use `totp_enabled` only to avoid an unused variable warning.
    let _ = totp_enabled;

    Ok(StatusCode::OK)
}

async fn two_fa_disable(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
    Json(body): Json<TwoFaDisableRequest>,
) -> Result<StatusCode, (StatusCode, String)> {
    let authed = require_user(&state, bearer.token()).await?;

    let (totp_secret_enc, _totp_enabled): (Option<String>, bool) = sqlx::query_as(
        "SELECT totp_secret, totp_enabled FROM users WHERE id = $1",
    )
    .bind(authed.id)
    .fetch_one(&state.db)
    .await
    .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "internal error".to_string()))?;

    let totp_secret_enc = totp_secret_enc.ok_or((
        StatusCode::BAD_REQUEST,
        "2FA not set up".to_string(),
    ))?;

    let secret_base32 = crypto::decrypt(&state.encryption_key, &totp_secret_enc)
        .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "internal error".to_string()))?;

    let email: String = sqlx::query_scalar("SELECT email FROM users WHERE id = $1")
        .bind(authed.id)
        .fetch_one(&state.db)
        .await
        .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "internal error".to_string()))?;

    let totp = totp_from_base32_secret(&secret_base32, email)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;

    let ok = totp
        .check_current(&body.code)
        .map_err(|_| (StatusCode::BAD_REQUEST, "invalid code".to_string()))?;

    if !ok {
        return Err((
            StatusCode::BAD_REQUEST,
            "invalid 2FA code".to_string(),
        ));
    }

    sqlx::query(
        r#"
        UPDATE users
        SET totp_secret = NULL,
            totp_enabled = FALSE
        WHERE id = $1
        "#,
    )
    .bind(authed.id)
    .execute(&state.db)
    .await
    .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "internal error".to_string()))?;

    Ok(StatusCode::OK)
}

async fn two_fa_login(
    State(state): State<Arc<AppState>>,
    Json(body): Json<TwoFaLoginRequest>,
) -> Result<Json<AuthResponse>, (StatusCode, String)> {
    let claims = decode_partial_token(&state, &body.partial_token)?;
    let user_id = uuid::Uuid::parse_str(&claims.sub)
        .map_err(|_| (StatusCode::UNAUTHORIZED, "invalid token".to_string()))?;

    let (totp_enabled, totp_secret_enc): (bool, Option<String>) = sqlx::query_as(
        "SELECT totp_enabled, totp_secret FROM users WHERE id = $1",
    )
    .bind(user_id)
    .fetch_one(&state.db)
    .await
    .map_err(|_| (StatusCode::UNAUTHORIZED, "invalid token".to_string()))?;

    if !totp_enabled {
        return Err((StatusCode::FORBIDDEN, "2FA not enabled".to_string()));
    }

    let totp_secret_enc = totp_secret_enc.ok_or((
        StatusCode::FORBIDDEN,
        "2FA secret missing".to_string(),
    ))?;

    let secret_base32 = crypto::decrypt(&state.encryption_key, &totp_secret_enc)
        .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "internal error".to_string()))?;

    let email: String = sqlx::query_scalar("SELECT email FROM users WHERE id = $1")
        .bind(user_id)
        .fetch_one(&state.db)
        .await
        .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "internal error".to_string()))?;

    let totp = totp_from_base32_secret(&secret_base32, email)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;
    let ok = totp
        .check_current(&body.code)
        .map_err(|_| (StatusCode::BAD_REQUEST, "invalid code".to_string()))?;

    if !ok {
        return Err((StatusCode::BAD_REQUEST, "invalid 2FA code".to_string()));
    }

    let token = auth::issue_jwt(&state, user_id, &claims.role).map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "could not issue token".to_string(),
        )
    })?;

    let _ = totp_enabled;

    Ok(Json(AuthResponse { token }))
}

async fn telegram_auth(
    State(state): State<Arc<AppState>>,
    Json(body): Json<TelegramAuthRequest>,
) -> Result<Json<AuthResponse>, (axum::http::StatusCode, String)> {
    let expected = state.telegram_bot_secret.as_deref().ok_or((
        axum::http::StatusCode::UNAUTHORIZED,
        "bot auth not configured".to_string(),
    ))?;

    if body.bot_secret != expected {
        return Err((
            axum::http::StatusCode::UNAUTHORIZED,
            "invalid bot secret".to_string(),
        ));
    }

    let _ = &body.telegram_name;
    let existing: Option<(uuid::Uuid, String)> = sqlx::query_as(
        "SELECT id, role::text FROM users WHERE telegram_id = $1",
    )
    .bind(&body.telegram_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| {
        (
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            "internal error".to_string(),
        )
    })?;

    let (user_id, role) = if let Some((id, role)) = existing {
        (id, role)
    } else {
        let generated_email = format!("tg_{}@telegram.local", body.telegram_id);
        let user_id: uuid::Uuid = sqlx::query_scalar(
            r#"
            INSERT INTO users (email, telegram_id, role)
            VALUES ($1, $2, 'STARTUP')
            RETURNING id
            "#,
        )
        .bind(generated_email)
        .bind(&body.telegram_id)
        .fetch_one(&state.db)
        .await
        .map_err(|_| {
            (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                "internal error".to_string(),
            )
        })?;
        (user_id, "STARTUP".to_string())
    };

    let token = auth::issue_jwt(&state, user_id, &role).map_err(|_| {
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

#[derive(Deserialize)]
pub struct AiSettingsRequest {
    pub provider: String,
    pub api_key: String,
    pub model: String,
}

async fn set_ai_settings(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
    Json(body): Json<AiSettingsRequest>,
) -> Result<StatusCode, (StatusCode, String)> {
    let authed = require_user(&state, bearer.token()).await?;

    if !authed.is_pro {
        return Err((
            StatusCode::FORBIDDEN,
            "pro subscription required".to_string(),
        ));
    }
    let encrypted_api_key = crypto::encrypt(&state.encryption_key, &body.api_key)
        .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "internal error".to_string()))?;

    sqlx::query(
        r#"
        UPDATE users
        SET custom_ai_provider = $1,
            custom_ai_api_key = $2,
            custom_ai_model = $3
        WHERE id = $4
        "#,
    )
    .bind(body.provider)
    .bind(encrypted_api_key)
    .bind(body.model)
    .bind(authed.id)
    .execute(&state.db)
    .await
    .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "internal error".to_string()))?;

    Ok(StatusCode::OK)
}

#[derive(Serialize, sqlx::FromRow)]
struct AccountExport {
    id: uuid::Uuid,
    email: String,
    role: String,
    organization_id: Option<uuid::Uuid>,
    jurisdiction_country: Option<String>,
    is_accredited: Option<bool>,
    is_pro: bool,
    totp_enabled: bool,
    custom_ai_provider: Option<String>,
    custom_ai_model: Option<String>,
    telegram_id: Option<String>,
    created_at: String,
    updated_at: String,
}

#[derive(Serialize, sqlx::FromRow)]
struct ProfileExport {
    id: uuid::Uuid,
    user_id: uuid::Uuid,
    company_name: Option<String>,
    one_liner: Option<String>,
    stage: Option<String>,
    sector: Option<String>,
    country: Option<String>,
    website: Option<String>,
    pitch_deck_url: Option<String>,
    created_at: String,
    updated_at: String,
}

#[derive(Serialize, sqlx::FromRow)]
struct PitchExport {
    id: uuid::Uuid,
    organization_id: uuid::Uuid,
    created_by: uuid::Uuid,
    title: String,
    description: Option<String>,
    sector: Option<String>,
    stage: Option<String>,
    target_raise: Option<String>,
    currency: Option<String>,
    jurisdiction_country: Option<String>,
    created_at: String,
    updated_at: String,
}

#[derive(Serialize, sqlx::FromRow)]
struct CallExport {
    id: uuid::Uuid,
    user_id: uuid::Uuid,
    original_filename: String,
    mime_type: Option<String>,
    transcript: Option<String>,
    analysis: Option<serde_json::Value>,
    created_at: String,
}

#[derive(Serialize, sqlx::FromRow)]
struct MemoryExport {
    id: uuid::Uuid,
    user_id: uuid::Uuid,
    content: String,
    created_at: String,
}

#[derive(Serialize, sqlx::FromRow)]
struct OauthAccountExport {
    id: uuid::Uuid,
    user_id: uuid::Uuid,
    provider: String,
    provider_uid: String,
    created_at: String,
}

#[derive(Serialize, sqlx::FromRow)]
struct IntroductionExport {
    id: uuid::Uuid,
    investor_user_id: uuid::Uuid,
    startup_user_id: uuid::Uuid,
    status: String,
    note: Option<String>,
    created_at: String,
}

#[derive(Serialize)]
struct ExportPayload {
    account: AccountExport,
    profile: Option<ProfileExport>,
    pitches: Vec<PitchExport>,
    calls: Vec<CallExport>,
    memories: Vec<MemoryExport>,
    oauth_accounts: Vec<OauthAccountExport>,
    introductions: Vec<IntroductionExport>,
}

async fn delete_account(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
) -> Result<StatusCode, (StatusCode, Json<ErrorResponse>)> {
    let authed = require_user(&state, bearer.token())
        .await
        .map_err(|(_, msg)| {
            (
                StatusCode::UNAUTHORIZED,
                Json(ErrorResponse { error: msg }),
            )
        })?;

    let stored_paths: Vec<String> = sqlx::query_scalar(
        "SELECT stored_path FROM call_recordings WHERE user_id = $1",
    )
    .bind(authed.id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("delete account: failed loading file paths for {}: {e}", authed.id);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: "internal error".to_string(),
            }),
        )
    })?;

    let mut file_delete_failures = 0usize;
    for stored_path in stored_paths {
        match tokio::fs::remove_file(&stored_path).await {
            Ok(_) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => {
                file_delete_failures += 1;
                tracing::error!("delete account: failed deleting file {}: {e}", stored_path);
            }
        }
    }

    sqlx::query("DELETE FROM users WHERE id = $1")
        .bind(authed.id)
        .execute(&state.db)
        .await
        .map_err(|e| {
            tracing::error!("delete account: failed deleting user {}: {e}", authed.id);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: "internal error".to_string(),
                }),
            )
        })?;

    if file_delete_failures > 0 {
        return Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: format!(
                    "account deleted, but failed removing {file_delete_failures} uploaded file(s)"
                ),
            }),
        ));
    }

    Ok(StatusCode::NO_CONTENT)
}

async fn export_data(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
) -> Result<Json<ExportPayload>, (StatusCode, String)> {
    let authed = require_user(&state, bearer.token()).await?;

    let account: AccountExport = sqlx::query_as(
        r#"
        SELECT
            id,
            email,
            role::text AS role,
            organization_id,
            jurisdiction_country::text AS jurisdiction_country,
            is_accredited,
            is_pro,
            totp_enabled,
            custom_ai_provider,
            custom_ai_model,
            telegram_id,
            created_at::text AS created_at,
            updated_at::text AS updated_at
        FROM users
        WHERE id = $1
        "#,
    )
    .bind(authed.id)
    .fetch_one(&state.db)
    .await
    .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "internal error".to_string()))?;

    let profile: Option<ProfileExport> = sqlx::query_as(
        r#"
        SELECT
            id,
            user_id,
            company_name,
            one_liner,
            stage,
            sector,
            country::text AS country,
            website,
            pitch_deck_url,
            created_at::text AS created_at,
            updated_at::text AS updated_at
        FROM profiles
        WHERE user_id = $1
        "#,
    )
    .bind(authed.id)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "internal error".to_string()))?;

    let pitches: Vec<PitchExport> = sqlx::query_as(
        r#"
        SELECT
            id,
            organization_id,
            created_by,
            title,
            description,
            sector,
            stage,
            target_raise::text AS target_raise,
            currency::text AS currency,
            jurisdiction_country::text AS jurisdiction_country,
            created_at::text AS created_at,
            updated_at::text AS updated_at
        FROM pitches
        WHERE created_by = $1
        ORDER BY created_at DESC
        "#,
    )
    .bind(authed.id)
    .fetch_all(&state.db)
    .await
    .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "internal error".to_string()))?;

    let calls: Vec<CallExport> = sqlx::query_as(
        r#"
        SELECT
            id,
            user_id,
            original_filename,
            mime_type,
            transcript,
            analysis,
            created_at::text AS created_at
        FROM call_recordings
        WHERE user_id = $1
        ORDER BY created_at DESC
        "#,
    )
    .bind(authed.id)
    .fetch_all(&state.db)
    .await
    .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "internal error".to_string()))?;

    let memories: Vec<MemoryExport> = sqlx::query_as(
        r#"
        SELECT
            id,
            user_id,
            content,
            created_at::text AS created_at
        FROM kevin_memories
        WHERE user_id = $1
        ORDER BY created_at DESC
        "#,
    )
    .bind(authed.id)
    .fetch_all(&state.db)
    .await
    .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "internal error".to_string()))?;

    let oauth_accounts: Vec<OauthAccountExport> = sqlx::query_as(
        r#"
        SELECT
            id,
            user_id,
            provider,
            provider_uid,
            created_at::text AS created_at
        FROM oauth_accounts
        WHERE user_id = $1
        ORDER BY created_at DESC
        "#,
    )
    .bind(authed.id)
    .fetch_all(&state.db)
    .await
    .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "internal error".to_string()))?;

    let introductions: Vec<IntroductionExport> = sqlx::query_as(
        r#"
        SELECT
            id,
            investor_user_id,
            startup_user_id,
            status,
            note,
            created_at::text AS created_at
        FROM introductions
        WHERE investor_user_id = $1 OR startup_user_id = $1
        ORDER BY created_at DESC
        "#,
    )
    .bind(authed.id)
    .fetch_all(&state.db)
    .await
    .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "internal error".to_string()))?;

    Ok(Json(ExportPayload {
        account,
        profile,
        pitches,
        calls,
        memories,
        oauth_accounts,
        introductions,
    }))
}

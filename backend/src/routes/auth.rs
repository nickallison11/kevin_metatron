use std::sync::Arc;

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

use crate::auth;
use crate::crypto;
use crate::identity::require_user;
use crate::state::AppState;

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/signup", post(signup))
        .route("/login", post(login))
        .route("/telegram", post(telegram_auth))
        .route("/account", delete(delete_account))
        .route("/me/export", get(export_data))
        .route("/role", put(set_role))
        .route("/ai-settings", put(set_ai_settings))
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

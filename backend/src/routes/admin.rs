use std::sync::Arc;

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::routing::{get, put};
use sqlx::Error as SqlxError;
use axum::{Json, Router};
use axum_extra::{
    headers::{authorization::Bearer, Authorization},
    TypedHeader,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::identity::require_admin;
use crate::state::AppState;

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/users", get(list_users))
        .route("/users/:id/pro", put(set_user_pro))
        .route("/users/:id/suspend", put(toggle_user_suspend))
        .route(
            "/users/:id",
            get(get_user_detail).delete(delete_user),
        )
        .route("/prospects", get(list_prospects).post(create_prospect))
        .route("/prospects/:id", put(update_prospect).delete(delete_prospect))
}

#[derive(Serialize, sqlx::FromRow)]
pub struct AdminUserRow {
    pub id: Uuid,
    pub email: String,
    pub role: String,
    pub is_pro: bool,
    pub is_admin: bool,
    pub telegram_id: Option<String>,
    pub created_at: String,
    pub kevin_message_count: i32,
}

async fn list_users(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
) -> Result<Json<Vec<AdminUserRow>>, (StatusCode, String)> {
    let _ = require_admin(&state, bearer.token()).await?;

    let rows = sqlx::query_as::<_, AdminUserRow>(
        r#"
        SELECT
            u.id,
            u.email,
            u.role::text AS role,
            u.is_pro,
            u.is_admin,
            u.telegram_id,
            u.created_at::text AS created_at,
            COALESCE(k.message_count, 0)::int AS kevin_message_count
        FROM users u
        LEFT JOIN kevin_daily_usage k
            ON k.user_id = u.id AND k.usage_date = CURRENT_DATE
        ORDER BY u.created_at DESC
        "#,
    )
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("admin list_users: {e}");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "database error".to_string(),
        )
    })?;

    Ok(Json(rows))
}

#[derive(Serialize)]
pub struct AdminUserDetail {
    pub user: AdminUserCore,
    pub profile: Option<AdminProfile>,
    pub pitches: Vec<AdminPitch>,
    pub kevin_usage_7d: Vec<KevinUsageDay>,
}

#[derive(Serialize, sqlx::FromRow)]
pub struct AdminUserCore {
    pub id: Uuid,
    pub email: String,
    pub role: String,
    pub is_pro: bool,
    pub is_admin: bool,
    pub is_suspended: bool,
    pub telegram_id: Option<String>,
    pub whatsapp_number: Option<String>,
    pub subscription_tier: String,
    pub created_at: String,
}

#[derive(Serialize, sqlx::FromRow)]
pub struct AdminProfile {
    pub company_name: Option<String>,
    pub one_liner: Option<String>,
    pub stage: Option<String>,
    pub sector: Option<String>,
    pub country: Option<String>,
    pub website: Option<String>,
    pub pitch_deck_url: Option<String>,
}

#[derive(Serialize, sqlx::FromRow)]
pub struct AdminPitch {
    pub id: Uuid,
    pub title: String,
    pub description: Option<String>,
    pub created_at: String,
}

#[derive(Serialize, sqlx::FromRow)]
pub struct KevinUsageDay {
    pub usage_date: String,
    pub message_count: i32,
}

async fn get_user_detail(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
    Path(id): Path<Uuid>,
) -> Result<Json<AdminUserDetail>, (StatusCode, String)> {
    let _ = require_admin(&state, bearer.token()).await?;

    let user = sqlx::query_as::<_, AdminUserCore>(
        r#"
        SELECT
            id,
            email,
            role::text AS role,
            is_pro,
            is_admin,
            is_suspended,
            telegram_id,
            whatsapp_number,
            subscription_tier,
            created_at::text AS created_at
        FROM users WHERE id = $1
        "#,
    )
    .bind(id)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "database error".to_string()))?
    .ok_or((StatusCode::NOT_FOUND, "user not found".to_string()))?;

    let profile = sqlx::query_as::<_, AdminProfile>(
        r#"
        SELECT company_name, one_liner, stage, sector, country::text, website, pitch_deck_url
        FROM profiles WHERE user_id = $1
        "#,
    )
    .bind(id)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "database error".to_string()))?;

    let pitches = sqlx::query_as::<_, AdminPitch>(
        r#"
        SELECT id, title, description, created_at::text AS created_at
        FROM pitches WHERE created_by = $1
        ORDER BY created_at DESC
        LIMIT 50
        "#,
    )
    .bind(id)
    .fetch_all(&state.db)
    .await
    .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "database error".to_string()))?;

    let kevin_usage_7d = sqlx::query_as::<_, KevinUsageDay>(
        r#"
        SELECT usage_date::text AS usage_date, message_count::int
        FROM kevin_daily_usage
        WHERE user_id = $1 AND usage_date >= CURRENT_DATE - INTERVAL '7 days'
        ORDER BY usage_date DESC
        "#,
    )
    .bind(id)
    .fetch_all(&state.db)
    .await
    .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "database error".to_string()))?;

    Ok(Json(AdminUserDetail {
        user,
        profile,
        pitches,
        kevin_usage_7d,
    }))
}

#[derive(Deserialize)]
pub struct SetUserProBody {
    pub is_pro: bool,
}

async fn set_user_pro(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
    Path(id): Path<Uuid>,
    Json(body): Json<SetUserProBody>,
) -> Result<StatusCode, (StatusCode, String)> {
    let _ = require_admin(&state, bearer.token()).await?;

    sqlx::query(
        r#"
        UPDATE users SET is_pro = $1, updated_at = now() WHERE id = $2
        "#,
    )
    .bind(body.is_pro)
    .bind(id)
    .execute(&state.db)
    .await
    .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "database error".to_string()))?;

    Ok(StatusCode::OK)
}

#[derive(Serialize)]
pub struct SuspendToggleResponse {
    pub is_suspended: bool,
}

async fn toggle_user_suspend(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
    Path(id): Path<Uuid>,
) -> Result<Json<SuspendToggleResponse>, (StatusCode, String)> {
    let admin = require_admin(&state, bearer.token()).await?;
    if admin.id == id {
        return Err((
            StatusCode::BAD_REQUEST,
            "cannot change suspension on your own account".to_string(),
        ));
    }

    let next = sqlx::query_scalar::<_, bool>(
        r#"
        UPDATE users
        SET is_suspended = NOT is_suspended, updated_at = now()
        WHERE id = $1
        RETURNING is_suspended
        "#,
    )
    .bind(id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("toggle_user_suspend: {e}");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "database error".to_string(),
        )
    })?;

    let next = next.ok_or((StatusCode::NOT_FOUND, "user not found".to_string()))?;

    Ok(Json(SuspendToggleResponse {
        is_suspended: next,
    }))
}

async fn delete_user(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, (StatusCode, String)> {
    let admin = require_admin(&state, bearer.token()).await?;
    if admin.id == id {
        return Err((
            StatusCode::BAD_REQUEST,
            "cannot delete your own account".to_string(),
        ));
    }

    let r = sqlx::query("DELETE FROM users WHERE id = $1")
        .bind(id)
        .execute(&state.db)
        .await
        .map_err(|e| {
            if let SqlxError::Database(ref d) = e {
                if d.code().as_deref() == Some("23503") {
                    return (
                        StatusCode::CONFLICT,
                        "cannot delete user: referenced by other data".to_string(),
                    );
                }
            }
            tracing::error!("delete_user: {e}");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "database error".to_string(),
            )
        })?;

    if r.rows_affected() == 0 {
        return Err((StatusCode::NOT_FOUND, "user not found".to_string()));
    }

    Ok(StatusCode::NO_CONTENT)
}

#[derive(Serialize, sqlx::FromRow)]
pub struct ProspectRow {
    pub id: Uuid,
    pub name: String,
    pub email: String,
    pub linkedin_url: Option<String>,
    pub role: Option<String>,
    pub status: String,
    pub notes: Option<String>,
    pub created_at: String,
}

async fn list_prospects(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
) -> Result<Json<Vec<ProspectRow>>, (StatusCode, String)> {
    let _ = require_admin(&state, bearer.token()).await?;

    let rows = sqlx::query_as::<_, ProspectRow>(
        r#"
        SELECT id, name, email, linkedin_url, role, status, notes, created_at::text AS created_at
        FROM prospects
        ORDER BY created_at DESC
        "#,
    )
    .fetch_all(&state.db)
    .await
    .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "database error".to_string()))?;

    Ok(Json(rows))
}

#[derive(Deserialize)]
pub struct CreateProspectBody {
    pub name: String,
    pub email: String,
    #[serde(default)]
    pub linkedin_url: Option<String>,
    #[serde(default)]
    pub role: Option<String>,
    #[serde(default)]
    pub notes: Option<String>,
    #[serde(default)]
    pub status: Option<String>,
}

async fn create_prospect(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
    Json(body): Json<CreateProspectBody>,
) -> Result<Json<ProspectRow>, (StatusCode, String)> {
    let _ = require_admin(&state, bearer.token()).await?;

    let status = body
        .status
        .unwrap_or_else(|| "contacted".to_string());
    if !matches!(
        status.as_str(),
        "contacted" | "responded" | "onboarded" | "declined" | "signed_up"
    ) {
        return Err((StatusCode::BAD_REQUEST, "invalid status".to_string()));
    }

    let row = sqlx::query_as::<_, ProspectRow>(
        r#"
        INSERT INTO prospects (name, email, linkedin_url, role, status, notes)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id, name, email, linkedin_url, role, status, notes, created_at::text AS created_at
        "#,
    )
    .bind(body.name.trim())
    .bind(body.email.trim())
    .bind(body.linkedin_url.as_ref().map(|s| s.trim().to_string()))
    .bind(body.role.as_ref().map(|s| s.trim().to_string()))
    .bind(&status)
    .bind(body.notes.as_ref().map(|s| s.trim().to_string()))
    .fetch_one(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("create_prospect: {e}");
        (StatusCode::INTERNAL_SERVER_ERROR, "database error".to_string())
    })?;

    Ok(Json(row))
}

#[derive(Deserialize)]
pub struct UpdateProspectBody {
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub notes: Option<String>,
}

async fn update_prospect(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
    Path(id): Path<Uuid>,
    Json(body): Json<UpdateProspectBody>,
) -> Result<StatusCode, (StatusCode, String)> {
    let _ = require_admin(&state, bearer.token()).await?;

    if let Some(ref s) = body.status {
        if !matches!(
            s.as_str(),
            "contacted" | "responded" | "onboarded" | "declined" | "signed_up"
        ) {
            return Err((StatusCode::BAD_REQUEST, "invalid status".to_string()));
        }
    }

    sqlx::query(
        r#"
        UPDATE prospects SET
            status = COALESCE($2, status),
            notes = COALESCE($3, notes)
        WHERE id = $1
        "#,
    )
    .bind(id)
    .bind(body.status.as_ref())
    .bind(body.notes.as_ref())
    .execute(&state.db)
    .await
    .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "database error".to_string()))?;

    Ok(StatusCode::OK)
}

async fn delete_prospect(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, (StatusCode, String)> {
    let _ = require_admin(&state, bearer.token()).await?;

    let r = sqlx::query("DELETE FROM prospects WHERE id = $1")
        .bind(id)
        .execute(&state.db)
        .await
        .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "database error".to_string()))?;

    if r.rows_affected() == 0 {
        return Err((StatusCode::NOT_FOUND, "not found".to_string()));
    }

    Ok(StatusCode::NO_CONTENT)
}

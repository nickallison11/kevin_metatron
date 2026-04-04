use std::sync::Arc;

use axum::{
    extract::State,
    routing::get,
    Json, Router,
};
use axum_extra::{
    headers::{authorization::Bearer, Authorization},
    TypedHeader,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::identity::{require_role, require_user, AuthedUser};
use crate::state::AppState;

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/", get(get_own).put(put_own))
        .route("/all", get(list_all))
        .route("/introductions", get(list_brokered_introductions))
        .route("/referrals", get(list_referrals))
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct ConnectorProfileDto {
    pub organisation: Option<String>,
    pub bio: Option<String>,
    pub speciality: Option<String>,
    pub country: Option<String>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct ConnectorPublicDto {
    pub user_id: Uuid,
    pub organisation: Option<String>,
    pub bio: Option<String>,
    pub speciality: Option<String>,
    pub country: Option<String>,
}

#[derive(sqlx::FromRow)]
struct ConnectorRow {
    organisation: Option<String>,
    bio: Option<String>,
    speciality: Option<String>,
    country: Option<String>,
}

#[derive(Serialize, sqlx::FromRow)]
pub struct BrokeredIntroduction {
    pub id: Uuid,
    pub startup_user_id: Uuid,
    pub investor_user_id: Uuid,
    pub status: String,
    pub founder_company: Option<String>,
    pub investor_firm: Option<String>,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Serialize, sqlx::FromRow)]
pub struct ReferralRow {
    pub id: Uuid,
    pub email: Option<String>,
    pub referred_user_id: Option<Uuid>,
    pub status: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

async fn fetch_dto(
    state: &AppState,
    user_id: Uuid,
) -> Result<ConnectorProfileDto, (axum::http::StatusCode, String)> {
    let row = sqlx::query_as::<_, ConnectorRow>(
        r#"
        SELECT organisation, bio, speciality, country
        FROM connector_profiles WHERE user_id = $1
        "#,
    )
    .bind(user_id)
    .fetch_optional(&state.db)
    .await
    .map_err(internal)?;

    Ok(row
        .map(|r| ConnectorProfileDto {
            organisation: r.organisation,
            bio: r.bio,
            speciality: r.speciality,
            country: r.country,
        })
        .unwrap_or_default())
}

async fn get_own(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
) -> Result<Json<ConnectorProfileDto>, (axum::http::StatusCode, String)> {
    let AuthedUser { id, .. } =
        require_role(&state, bearer.token(), &["INTERMEDIARY"]).await?;

    Ok(Json(fetch_dto(&state, id).await?))
}

async fn put_own(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
    Json(body): Json<ConnectorProfileDto>,
) -> Result<Json<ConnectorProfileDto>, (axum::http::StatusCode, String)> {
    let AuthedUser { id, .. } =
        require_role(&state, bearer.token(), &["INTERMEDIARY"]).await?;

    let country = body.country.as_ref().and_then(|c| {
        let s: String = c
            .chars()
            .filter(|ch| ch.is_ascii_alphabetic())
            .take(2)
            .collect();
        if s.len() == 2 {
            Some(s.to_uppercase())
        } else {
            None
        }
    });

    sqlx::query(
        r#"
        INSERT INTO connector_profiles (user_id, organisation, bio, speciality, country)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (user_id) DO UPDATE SET
            organisation = EXCLUDED.organisation,
            bio = EXCLUDED.bio,
            speciality = EXCLUDED.speciality,
            country = EXCLUDED.country,
            updated_at = now()
        "#,
    )
    .bind(id)
    .bind(&body.organisation)
    .bind(&body.bio)
    .bind(&body.speciality)
    .bind(&country)
    .execute(&state.db)
    .await
    .map_err(internal)?;

    Ok(Json(fetch_dto(&state, id).await?))
}

async fn list_all(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
) -> Result<Json<Vec<ConnectorPublicDto>>, (axum::http::StatusCode, String)> {
    let _u = require_user(&state, bearer.token()).await?;
    let sql = r#"
        SELECT
            u.id AS user_id,
            cp.organisation,
            cp.bio,
            cp.speciality,
            cp.country
        FROM users u
        INNER JOIN connector_profiles cp ON cp.user_id = u.id
        WHERE u.role = 'INTERMEDIARY'
        ORDER BY cp.updated_at DESC NULLS LAST, cp.created_at DESC
        "#;

    let rows = sqlx::query_as::<_, ConnectorPublicDto>(sql)
        .fetch_all(&state.db)
        .await
        .map_err(internal)?;

    Ok(Json(rows))
}

async fn list_brokered_introductions(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
) -> Result<Json<Vec<BrokeredIntroduction>>, (axum::http::StatusCode, String)> {
    let AuthedUser { id, .. } =
        require_role(&state, bearer.token(), &["INTERMEDIARY"]).await?;

    let rows = sqlx::query_as::<_, BrokeredIntroduction>(
        r#"
        SELECT
            i.id,
            i.startup_user_id,
            i.investor_user_id,
            i.status,
            sf.company_name AS founder_company,
            inv.firm_name AS investor_firm,
            i.created_at
        FROM introductions i
        LEFT JOIN profiles sf ON sf.user_id = i.startup_user_id
        LEFT JOIN investor_profiles inv ON inv.user_id = i.investor_user_id
        WHERE i.broker_user_id = $1
        ORDER BY i.created_at DESC
        "#,
    )
    .bind(id)
    .fetch_all(&state.db)
    .await
    .map_err(internal)?;

    Ok(Json(rows))
}

async fn list_referrals(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
) -> Result<Json<Vec<ReferralRow>>, (axum::http::StatusCode, String)> {
    let AuthedUser { id, .. } =
        require_role(&state, bearer.token(), &["INTERMEDIARY"]).await?;

    let rows = sqlx::query_as::<_, ReferralRow>(
        r#"
        SELECT id, email, referred_user_id, status, created_at
        FROM referrals
        WHERE referrer_user_id = $1
        ORDER BY created_at DESC
        "#,
    )
    .bind(id)
    .fetch_all(&state.db)
    .await
    .map_err(internal)?;

    Ok(Json(rows))
}

fn internal<E: std::fmt::Debug>(_e: E) -> (axum::http::StatusCode, String) {
    (
        axum::http::StatusCode::INTERNAL_SERVER_ERROR,
        "internal error".to_string(),
    )
}

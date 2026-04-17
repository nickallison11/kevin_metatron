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
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct InvestorProfileDto {
    pub firm_name: Option<String>,
    pub bio: Option<String>,
    pub investment_thesis: Option<String>,
    pub sectors: Option<Vec<String>>,
    pub stages: Option<Vec<String>>,
    pub ticket_size_min: Option<i64>,
    pub ticket_size_max: Option<i64>,
    pub country: Option<String>,
    pub investor_tier: Option<String>,
    #[serde(default)]
    pub is_accredited: bool,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct InvestorPublicDto {
    pub user_id: Uuid,
    pub firm_name: Option<String>,
    pub bio: Option<String>,
    pub sectors: Option<Vec<String>>,
    pub stages: Option<Vec<String>>,
    pub ticket_size_min: Option<i64>,
    pub ticket_size_max: Option<i64>,
    pub country: Option<String>,
}

#[derive(sqlx::FromRow)]
struct InvestorRow {
    firm_name: Option<String>,
    bio: Option<String>,
    investment_thesis: Option<String>,
    sectors: Option<Vec<String>>,
    stages: Option<Vec<String>>,
    ticket_size_min: Option<i64>,
    ticket_size_max: Option<i64>,
    country: Option<String>,
    investor_tier: Option<String>,
    is_accredited: bool,
}

async fn fetch_dto(
    state: &AppState,
    user_id: Uuid,
) -> Result<InvestorProfileDto, (axum::http::StatusCode, String)> {
    let row = sqlx::query_as::<_, InvestorRow>(
        r#"
        SELECT firm_name, bio, investment_thesis, sectors, stages,
               ticket_size_min, ticket_size_max, country, investor_tier, is_accredited
        FROM investor_profiles WHERE user_id = $1
        "#,
    )
    .bind(user_id)
    .fetch_optional(&state.db)
    .await
    .map_err(internal)?;

    Ok(row.map(into_dto).unwrap_or_default())
}

async fn get_own(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
) -> Result<Json<InvestorProfileDto>, (axum::http::StatusCode, String)> {
    let AuthedUser { id, .. } =
        require_role(&state, bearer.token(), &["INVESTOR"]).await?;

    Ok(Json(fetch_dto(&state, id).await?))
}

fn into_dto(r: InvestorRow) -> InvestorProfileDto {
    InvestorProfileDto {
        firm_name: r.firm_name,
        bio: r.bio,
        investment_thesis: r.investment_thesis,
        sectors: r.sectors,
        stages: r.stages,
        ticket_size_min: r.ticket_size_min,
        ticket_size_max: r.ticket_size_max,
        country: r.country,
        investor_tier: r.investor_tier,
        is_accredited: r.is_accredited,
    }
}

async fn put_own(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
    Json(body): Json<InvestorProfileDto>,
) -> Result<Json<InvestorProfileDto>, (axum::http::StatusCode, String)> {
    let AuthedUser { id, .. } =
        require_role(&state, bearer.token(), &["INVESTOR"]).await?;

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
        INSERT INTO investor_profiles (
            user_id, firm_name, bio, investment_thesis, sectors, stages,
            ticket_size_min, ticket_size_max, country, is_accredited
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (user_id) DO UPDATE SET
            firm_name = EXCLUDED.firm_name,
            bio = EXCLUDED.bio,
            investment_thesis = EXCLUDED.investment_thesis,
            sectors = EXCLUDED.sectors,
            stages = EXCLUDED.stages,
            ticket_size_min = EXCLUDED.ticket_size_min,
            ticket_size_max = EXCLUDED.ticket_size_max,
            country = EXCLUDED.country,
            is_accredited = EXCLUDED.is_accredited,
            updated_at = now()
        "#,
    )
    .bind(id)
    .bind(&body.firm_name)
    .bind(&body.bio)
    .bind(&body.investment_thesis)
    .bind(&body.sectors)
    .bind(&body.stages)
    .bind(body.ticket_size_min)
    .bind(body.ticket_size_max)
    .bind(&country)
    .bind(body.is_accredited)
    .execute(&state.db)
    .await
    .map_err(internal)?;

    Ok(Json(fetch_dto(&state, id).await?))
}

async fn list_all(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
) -> Result<Json<Vec<InvestorPublicDto>>, (axum::http::StatusCode, String)> {
    let _u = require_user(&state, bearer.token()).await?;
    let sql = r#"
        SELECT
            u.id AS user_id,
            ip.firm_name,
            ip.bio,
            ip.sectors,
            ip.stages,
            ip.ticket_size_min,
            ip.ticket_size_max,
            ip.country
        FROM users u
        INNER JOIN investor_profiles ip ON ip.user_id = u.id
        WHERE u.role = 'INVESTOR'
        ORDER BY ip.updated_at DESC NULLS LAST, ip.created_at DESC
        "#;

    let rows = sqlx::query_as::<_, InvestorPublicDto>(sql)
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

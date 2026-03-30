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

use crate::identity::{require_role, AuthedUser};
use crate::state::AppState;

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/", get(get_profile).put(put_profile))
}

#[derive(Debug, Serialize, Deserialize, Default, Clone)]
pub struct ProfileDto {
    pub company_name: Option<String>,
    pub one_liner: Option<String>,
    pub stage: Option<String>,
    pub sector: Option<String>,
    pub country: Option<String>,
    pub website: Option<String>,
    pub pitch_deck_url: Option<String>,
}

async fn get_profile(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
) -> Result<Json<ProfileDto>, (axum::http::StatusCode, String)> {
    let AuthedUser { id, .. } =
        require_role(&state, bearer.token(), &["STARTUP"]).await?;
    fetch_profile(&state, id).await
}

async fn fetch_profile(
    state: &AppState,
    user_id: uuid::Uuid,
) -> Result<Json<ProfileDto>, (axum::http::StatusCode, String)> {
    let row = sqlx::query_as::<_, ProfileRow>(
        r#"
        SELECT company_name, one_liner, stage, sector, country::text as country,
               website, pitch_deck_url
        FROM profiles WHERE user_id = $1
        "#,
    )
    .bind(user_id)
    .fetch_optional(&state.db)
    .await
    .map_err(internal)?;

    Ok(Json(row.map(Into::into).unwrap_or_default()))
}

#[derive(sqlx::FromRow)]
struct ProfileRow {
    company_name: Option<String>,
    one_liner: Option<String>,
    stage: Option<String>,
    sector: Option<String>,
    country: Option<String>,
    website: Option<String>,
    pitch_deck_url: Option<String>,
}

impl From<ProfileRow> for ProfileDto {
    fn from(r: ProfileRow) -> Self {
        ProfileDto {
            company_name: r.company_name,
            one_liner: r.one_liner,
            stage: r.stage,
            sector: r.sector,
            country: r.country,
            website: r.website,
            pitch_deck_url: r.pitch_deck_url,
        }
    }
}

async fn put_profile(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
    Json(body): Json<ProfileDto>,
) -> Result<Json<ProfileDto>, (axum::http::StatusCode, String)> {
    let AuthedUser { id, .. } =
        require_role(&state, bearer.token(), &["STARTUP"]).await?;

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
        INSERT INTO profiles (
            user_id, company_name, one_liner, stage, sector, country, website, pitch_deck_url
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (user_id) DO UPDATE SET
            company_name = EXCLUDED.company_name,
            one_liner = EXCLUDED.one_liner,
            stage = EXCLUDED.stage,
            sector = EXCLUDED.sector,
            country = EXCLUDED.country,
            website = EXCLUDED.website,
            pitch_deck_url = EXCLUDED.pitch_deck_url,
            updated_at = now()
        "#,
    )
    .bind(id)
    .bind(&body.company_name)
    .bind(&body.one_liner)
    .bind(&body.stage)
    .bind(&body.sector)
    .bind(&country)
    .bind(&body.website)
    .bind(&body.pitch_deck_url)
    .execute(&state.db)
    .await
    .map_err(internal)?;

    fetch_profile(&state, id).await
}

fn internal<E: std::fmt::Debug>(_e: E) -> (axum::http::StatusCode, String) {
    (
        axum::http::StatusCode::INTERNAL_SERVER_ERROR,
        "internal error".to_string(),
    )
}

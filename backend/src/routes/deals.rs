use std::sync::Arc;

use axum::{
    extract::State,
    routing::{get, post},
    Json, Router,
};
use axum_extra::{
    headers::{authorization::Bearer, Authorization},
    TypedHeader,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::identity::{require_role, AuthedUser};
use crate::state::AppState;

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/startups", get(list_startups))
        .route("/intros", post(request_intro))
}

#[derive(Serialize, sqlx::FromRow)]
pub struct StartupCard {
    pub user_id: Uuid,
    pub company_name: Option<String>,
    pub one_liner: Option<String>,
    pub stage: Option<String>,
    pub sector: Option<String>,
    pub pitch_deck_url: Option<String>,
}

#[derive(Deserialize)]
pub struct IntroRequest {
    pub startup_user_id: Uuid,
    pub note: Option<String>,
}

#[derive(Serialize)]
pub struct IntroResponse {
    pub id: Uuid,
    pub status: String,
}

async fn list_startups(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
) -> Result<Json<Vec<StartupCard>>, (axum::http::StatusCode, String)> {
    let AuthedUser { id: investor_id, .. } =
        require_role(&state, bearer.token(), &["INVESTOR"]).await?;

    let inv = sqlx::query_as::<_, InvestorFilter>(
        r#"SELECT sectors, stages FROM investor_profiles WHERE user_id = $1"#,
    )
    .bind(investor_id)
    .fetch_optional(&state.db)
    .await
    .map_err(internal)?;

    let mut startups = sqlx::query_as::<_, StartupCard>(
        r#"
        SELECT p.user_id, p.company_name, p.one_liner, p.stage, p.sector, p.pitch_deck_url
        FROM profiles p
        INNER JOIN users u ON u.id = p.user_id
        WHERE u.role = 'STARTUP'
        ORDER BY p.updated_at DESC NULLS LAST, p.created_at DESC
        "#,
    )
    .fetch_all(&state.db)
    .await
    .map_err(internal)?;

    if let Some(ref f) = inv {
        startups.retain(|s| matches_interests(s, f));
    }

    Ok(Json(startups))
}

#[derive(sqlx::FromRow)]
struct InvestorFilter {
    sectors: Option<Vec<String>>,
    stages: Option<Vec<String>>,
}

fn matches_interests(s: &StartupCard, inv: &InvestorFilter) -> bool {
    let sectors = inv.sectors.as_ref().filter(|v| !v.is_empty());
    let stages = inv.stages.as_ref().filter(|v| !v.is_empty());

    let sector_ok = sectors.map_or(true, |list| {
        s.sector
            .as_ref()
            .map(|sec| list.iter().any(|x| x.eq_ignore_ascii_case(sec)))
            .unwrap_or(true)
    });

    let stage_ok = stages.map_or(true, |list| {
        s.stage
            .as_ref()
            .map(|st| list.iter().any(|x| x.eq_ignore_ascii_case(st)))
            .unwrap_or(true)
    });

    sector_ok && stage_ok
}

async fn request_intro(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
    Json(body): Json<IntroRequest>,
) -> Result<Json<IntroResponse>, (axum::http::StatusCode, String)> {
    let AuthedUser { id: investor_id, .. } =
        require_role(&state, bearer.token(), &["INVESTOR"]).await?;

    let ok: bool = sqlx::query_scalar(
        r#"
        SELECT EXISTS(
          SELECT 1 FROM users u
          INNER JOIN profiles p ON p.user_id = u.id
          WHERE u.id = $1 AND u.role = 'STARTUP'
        )
        "#,
    )
    .bind(body.startup_user_id)
    .fetch_one(&state.db)
    .await
    .map_err(internal)?;

    if !ok {
        return Err((
            axum::http::StatusCode::NOT_FOUND,
            "startup not found".into(),
        ));
    }

    let intro_id = Uuid::new_v4();
    sqlx::query(
        r#"
        INSERT INTO introductions (id, investor_user_id, startup_user_id, status, note)
        VALUES ($1, $2, $3, 'PENDING', $4)
        "#,
    )
    .bind(intro_id)
    .bind(investor_id)
    .bind(body.startup_user_id)
    .bind(&body.note)
    .execute(&state.db)
    .await
    .map_err(internal)?;

    Ok(Json(IntroResponse {
        id: intro_id,
        status: "PENDING".into(),
    }))
}

fn internal<E: std::fmt::Debug>(e: E) -> (axum::http::StatusCode, String) {
    tracing::error!(?e, "deals route");
    (
        axum::http::StatusCode::INTERNAL_SERVER_ERROR,
        "internal error".to_string(),
    )
}

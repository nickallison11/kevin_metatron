use std::sync::Arc;

use axum::{
    extract::{Path, State},
    routing::{post, put},
    Json, Router,
};
use axum_extra::{
    headers::{authorization::Bearer, Authorization},
    TypedHeader,
};
use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use sqlx::{PgPool, Row};
use uuid::Uuid;

use crate::auth::Claims;
use crate::ipfs_snapshot::snapshot_user_context;
use crate::state::AppState;

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/", post(create_pitch).get(list_pitches))
        .route("/:id", put(update_pitch))
}

#[derive(Deserialize)]
pub struct CreatePitchRequest {
    pub title: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub problem: Option<String>,
    #[serde(default)]
    pub solution: Option<String>,
    #[serde(default)]
    pub market_size: Option<String>,
    #[serde(default)]
    pub business_model: Option<String>,
    #[serde(default)]
    pub traction: Option<String>,
    #[serde(default)]
    pub funding_ask: Option<String>,
    #[serde(default)]
    pub use_of_funds: Option<String>,
    #[serde(default)]
    pub team_size: Option<i32>,
    #[serde(default)]
    pub incorporation_country: Option<String>,
    #[serde(default)]
    pub team_members: Option<JsonValue>,
}

#[derive(Deserialize)]
pub struct UpdatePitchRequest {
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub problem: Option<String>,
    #[serde(default)]
    pub solution: Option<String>,
    #[serde(default)]
    pub market_size: Option<String>,
    #[serde(default)]
    pub business_model: Option<String>,
    #[serde(default)]
    pub traction: Option<String>,
    #[serde(default)]
    pub funding_ask: Option<String>,
    #[serde(default)]
    pub use_of_funds: Option<String>,
    #[serde(default)]
    pub team_size: Option<i32>,
    #[serde(default)]
    pub incorporation_country: Option<String>,
    #[serde(default)]
    pub team_members: Option<JsonValue>,
}

#[derive(Serialize)]
pub struct PitchResponse {
    pub id: Uuid,
    pub title: String,
    pub description: Option<String>,
    pub problem: Option<String>,
    pub solution: Option<String>,
    pub market_size: Option<String>,
    pub business_model: Option<String>,
    pub traction: Option<String>,
    pub funding_ask: Option<String>,
    pub use_of_funds: Option<String>,
    pub team_size: Option<i32>,
    pub incorporation_country: Option<String>,
    pub team_members: Option<JsonValue>,
    /// `profiles.stage` for the pitch author (joined on list).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stage: Option<String>,
}

fn opt_trim(s: Option<String>) -> Option<String> {
    s.and_then(|t| {
        let t = t.trim();
        if t.is_empty() {
            None
        } else {
            Some(t.to_string())
        }
    })
}

fn row_to_pitch_response(r: &sqlx::postgres::PgRow, include_stage: bool) -> Result<PitchResponse, sqlx::Error> {
    let stage = if include_stage {
        r.try_get::<Option<String>, _>("profile_stage").ok().flatten()
    } else {
        None
    };
    Ok(PitchResponse {
        id: r.try_get("id")?,
        title: r.try_get("title")?,
        description: r.try_get("description")?,
        problem: r.try_get("problem")?,
        solution: r.try_get("solution")?,
        market_size: r.try_get("market_size")?,
        business_model: r.try_get("business_model")?,
        traction: r.try_get("traction")?,
        funding_ask: r.try_get("funding_ask")?,
        use_of_funds: r.try_get("use_of_funds")?,
        team_size: r.try_get("team_size")?,
        incorporation_country: r.try_get("incorporation_country")?,
        team_members: r.try_get("team_members")?,
        stage,
    })
}

async fn create_pitch(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
    Json(body): Json<CreatePitchRequest>,
) -> Result<Json<PitchResponse>, (axum::http::StatusCode, String)> {
    let claims = decode_claims(&state, bearer.token())?;
    let user_id = Uuid::parse_str(&claims.sub)
        .map_err(|_| (axum::http::StatusCode::UNAUTHORIZED, "invalid token".to_string()))?;

    let org_id = ensure_user_org(&state.db, user_id)
        .await
        .map_err(internal)?;

    let pitch_id = Uuid::new_v4();

    sqlx::query(
        r#"
        INSERT INTO pitches (
            id, organization_id, created_by, title, description,
            problem, solution, market_size, business_model, traction, funding_ask, use_of_funds,
            team_size, incorporation_country, team_members
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
        "#,
    )
    .bind(pitch_id)
    .bind(org_id)
    .bind(user_id)
    .bind(body.title.trim())
    .bind(opt_trim(body.description))
    .bind(opt_trim(body.problem))
    .bind(opt_trim(body.solution))
    .bind(opt_trim(body.market_size))
    .bind(opt_trim(body.business_model))
    .bind(opt_trim(body.traction))
    .bind(opt_trim(body.funding_ask))
    .bind(opt_trim(body.use_of_funds))
    .bind(body.team_size)
    .bind(opt_trim(body.incorporation_country))
    .bind(body.team_members)
    .execute(&state.db)
    .await
    .map_err(internal)?;

    let row = sqlx::query(
        r#"
        SELECT
            id, title, description, problem, solution, market_size,
            business_model, traction, funding_ask, use_of_funds,
            team_size, incorporation_country, team_members,
            NULL::text AS profile_stage
        FROM pitches WHERE id = $1
        "#,
    )
    .bind(pitch_id)
    .fetch_one(&state.db)
    .await
    .map_err(internal)?;

    let p = row_to_pitch_response(&row, true).map_err(internal)?;
    let snap_state = Arc::clone(&state);
    tokio::spawn(async move {
        snapshot_user_context(snap_state, user_id).await;
    });
    Ok(Json(PitchResponse { stage: None, ..p }))
}

async fn list_pitches(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
) -> Result<Json<Vec<PitchResponse>>, (axum::http::StatusCode, String)> {
    let claims = decode_claims(&state, bearer.token())?;
    let user_id = Uuid::parse_str(&claims.sub)
        .map_err(|_| (axum::http::StatusCode::UNAUTHORIZED, "invalid token".to_string()))?;

    let org_id = ensure_user_org(&state.db, user_id)
        .await
        .map_err(internal)?;

    let rows = sqlx::query(
        r#"
        SELECT
            p.id,
            p.title,
            p.description,
            p.problem,
            p.solution,
            p.market_size,
            p.business_model,
            p.traction,
            p.funding_ask,
            p.use_of_funds,
            p.team_size,
            p.incorporation_country,
            p.team_members,
            pr.stage AS profile_stage
        FROM pitches p
        LEFT JOIN profiles pr ON pr.user_id = p.created_by
        WHERE p.organization_id = $1
        ORDER BY p.created_at DESC
        "#,
    )
    .bind(org_id)
    .fetch_all(&state.db)
    .await
    .map_err(internal)?;

    let items = rows
        .iter()
        .map(|r| row_to_pitch_response(r, true))
        .collect::<Result<Vec<_>, _>>()
        .map_err(internal)?;

    Ok(Json(items))
}

async fn update_pitch(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
    Path(pitch_id): Path<Uuid>,
    Json(body): Json<UpdatePitchRequest>,
) -> Result<Json<PitchResponse>, (axum::http::StatusCode, String)> {
    let claims = decode_claims(&state, bearer.token())?;
    let user_id = Uuid::parse_str(&claims.sub)
        .map_err(|_| (axum::http::StatusCode::UNAUTHORIZED, "invalid token".to_string()))?;

    let org_id = ensure_user_org(&state.db, user_id)
        .await
        .map_err(internal)?;

    let n = sqlx::query(
        r#"
        UPDATE pitches SET
            title = COALESCE($2, title),
            description = COALESCE($3, description),
            problem = COALESCE($4, problem),
            solution = COALESCE($5, solution),
            market_size = COALESCE($6, market_size),
            business_model = COALESCE($7, business_model),
            traction = COALESCE($8, traction),
            funding_ask = COALESCE($9, funding_ask),
            use_of_funds = COALESCE($10, use_of_funds),
            team_size = COALESCE($11, team_size),
            incorporation_country = COALESCE($12, incorporation_country),
            team_members = COALESCE($13, team_members),
            updated_at = now()
        WHERE id = $1 AND organization_id = $14
        "#,
    )
    .bind(pitch_id)
    .bind(body.title.as_ref().map(|s| s.trim()).filter(|s| !s.is_empty()))
    .bind(opt_trim(body.description))
    .bind(opt_trim(body.problem))
    .bind(opt_trim(body.solution))
    .bind(opt_trim(body.market_size))
    .bind(opt_trim(body.business_model))
    .bind(opt_trim(body.traction))
    .bind(opt_trim(body.funding_ask))
    .bind(opt_trim(body.use_of_funds))
    .bind(body.team_size)
    .bind(opt_trim(body.incorporation_country))
    .bind(body.team_members.as_ref())
    .bind(org_id)
    .execute(&state.db)
    .await
    .map_err(internal)?;

    if n.rows_affected() == 0 {
        return Err((axum::http::StatusCode::NOT_FOUND, "pitch not found".to_string()));
    }

    let row = sqlx::query(
        r#"
        SELECT
            p.id,
            p.title,
            p.description,
            p.problem,
            p.solution,
            p.market_size,
            p.business_model,
            p.traction,
            p.funding_ask,
            p.use_of_funds,
            p.team_size,
            p.incorporation_country,
            p.team_members,
            pr.stage AS profile_stage
        FROM pitches p
        LEFT JOIN profiles pr ON pr.user_id = p.created_by
        WHERE p.id = $1 AND p.organization_id = $2
        "#,
    )
    .bind(pitch_id)
    .bind(org_id)
    .fetch_one(&state.db)
    .await
    .map_err(internal)?;

    let p = row_to_pitch_response(&row, true).map_err(internal)?;
    let snap_state = Arc::clone(&state);
    tokio::spawn(async move {
        snapshot_user_context(snap_state, user_id).await;
    });
    Ok(Json(p))
}

/// Load a pitch card for API responses (e.g. after deck extraction).
pub async fn pitch_response_for_org_pitch(
    pool: &PgPool,
    org_id: Uuid,
    pitch_id: Uuid,
) -> Result<PitchResponse, sqlx::Error> {
    let row = sqlx::query(
        r#"
        SELECT
            p.id,
            p.title,
            p.description,
            p.problem,
            p.solution,
            p.market_size,
            p.business_model,
            p.traction,
            p.funding_ask,
            p.use_of_funds,
            p.team_size,
            p.incorporation_country,
            p.team_members,
            pr.stage AS profile_stage
        FROM pitches p
        LEFT JOIN profiles pr ON pr.user_id = p.created_by
        WHERE p.id = $1 AND p.organization_id = $2
        "#,
    )
    .bind(pitch_id)
    .bind(org_id)
    .fetch_one(pool)
    .await?;
    row_to_pitch_response(&row, true)
}

fn decode_claims(
    state: &AppState,
    token: &str,
) -> Result<Claims, (axum::http::StatusCode, String)> {
    jsonwebtoken::decode::<Claims>(
        token,
        &state.jwt_decoding,
        &jsonwebtoken::Validation::new(jsonwebtoken::Algorithm::HS256),
    )
    .map(|data| data.claims)
    .map_err(|_| {
        (
            axum::http::StatusCode::UNAUTHORIZED,
            "invalid token".to_string(),
        )
    })
}

pub async fn ensure_user_org(db: &PgPool, user_id: Uuid) -> Result<Uuid, sqlx::Error> {
    let row = sqlx::query(
        r#"
        SELECT organization_id, email
        FROM users
        WHERE id = $1
        "#,
    )
    .bind(user_id)
    .fetch_one(db)
    .await?;

    let org_existing: Option<Uuid> = row.try_get::<Option<Uuid>, _>("organization_id")?;
    if let Some(org_id) = org_existing {
        return Ok(org_id);
    }

    let email: String = row.try_get::<String, _>("email")?;
    let org_id = Uuid::new_v4();
    let name = format!("{} org", email);

    sqlx::query(
        r#"
        INSERT INTO organizations (id, name, country_code)
        VALUES ($1, $2, $3)
        "#,
    )
    .bind(org_id)
    .bind(&name)
    .bind("US")
    .execute(db)
    .await?;

    sqlx::query(
        r#"
        UPDATE users
        SET organization_id = $1
        WHERE id = $2
        "#,
    )
    .bind(org_id)
    .bind(user_id)
    .execute(db)
    .await?;

    Ok(org_id)
}

fn internal<E>(_err: E) -> (axum::http::StatusCode, String) {
    (
        axum::http::StatusCode::INTERNAL_SERVER_ERROR,
        "internal error".to_string(),
    )
}

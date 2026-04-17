use std::sync::Arc;

use axum::{
    extract::{Path, State},
    http::StatusCode,
    routing::{get, patch},
    Json, Router,
};
use axum_extra::{
    headers::{authorization::Bearer, Authorization},
    TypedHeader,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::identity::require_user;
use crate::state::AppState;

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/", get(list_pipeline).post(add_to_pipeline))
        .route("/:id", patch(update_pipeline).delete(remove_from_pipeline))
}

#[derive(Serialize, sqlx::FromRow)]
pub struct PipelineRow {
    pub id: Uuid,
    pub founder_user_id: Uuid,
    pub stage: String,
    pub notes: Option<String>,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
    pub company_name: Option<String>,
    pub one_liner: Option<String>,
    pub sector: Option<String>,
    pub startup_stage: Option<String>,
    pub country: Option<String>,
    pub angel_score: Option<i32>,
}

#[derive(Deserialize)]
pub struct AddPipelineBody {
    pub founder_user_id: Uuid,
    pub stage: Option<String>,
    pub notes: Option<String>,
}

#[derive(Deserialize)]
pub struct UpdatePipelineBody {
    pub stage: Option<String>,
    pub notes: Option<String>,
}

fn internal(e: impl std::fmt::Display) -> (StatusCode, String) {
    tracing::error!("{e}");
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        "internal error".to_string(),
    )
}

fn require_investor(role: &str) -> Result<(), (StatusCode, String)> {
    if role != "INVESTOR" {
        return Err((
            StatusCode::FORBIDDEN,
            "investors only".to_string(),
        ));
    }
    Ok(())
}

async fn list_pipeline(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
) -> Result<Json<Vec<PipelineRow>>, (StatusCode, String)> {
    let user = require_user(&state, bearer.token()).await?;
    require_investor(user.role.as_str())?;
    let rows = sqlx::query_as::<_, PipelineRow>(
        r#"SELECT ip.id, ip.founder_user_id, ip.stage, ip.notes, ip.created_at, ip.updated_at,
                  p.company_name, p.one_liner, p.sector, p.stage AS startup_stage, p.country,
                  a.score AS angel_score
           FROM investor_pipeline ip
           LEFT JOIN profiles p ON p.user_id = ip.founder_user_id
           LEFT JOIN angel_scores a ON a.founder_user_id = ip.founder_user_id
           WHERE ip.investor_user_id = $1
           ORDER BY ip.updated_at DESC"#,
    )
    .bind(user.id)
    .fetch_all(&state.db)
    .await
    .map_err(internal)?;
    Ok(Json(rows))
}

async fn add_to_pipeline(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
    Json(body): Json<AddPipelineBody>,
) -> Result<Json<PipelineRow>, (StatusCode, String)> {
    let user = require_user(&state, bearer.token()).await?;
    require_investor(user.role.as_str())?;
    let stage = body.stage.unwrap_or_else(|| "watching".to_string());
    let valid_stages = [
        "watching",
        "considering",
        "due_diligence",
        "passed",
        "invested",
    ];
    if !valid_stages.contains(&stage.as_str()) {
        return Err((StatusCode::BAD_REQUEST, "invalid stage".to_string()));
    }
    let row = sqlx::query_as::<_, PipelineRow>(
        r#"INSERT INTO investor_pipeline (investor_user_id, founder_user_id, stage, notes)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (investor_user_id, founder_user_id) DO UPDATE SET
               stage = EXCLUDED.stage, notes = COALESCE(EXCLUDED.notes, investor_pipeline.notes), updated_at = NOW()
             RETURNING id, founder_user_id, stage, notes, created_at, updated_at,
               (SELECT company_name FROM profiles WHERE user_id = founder_user_id) AS company_name,
               (SELECT one_liner FROM profiles WHERE user_id = founder_user_id) AS one_liner,
               (SELECT sector FROM profiles WHERE user_id = founder_user_id) AS sector,
               (SELECT stage FROM profiles WHERE user_id = founder_user_id) AS startup_stage,
               (SELECT country FROM profiles WHERE user_id = founder_user_id) AS country,
               (SELECT score FROM angel_scores WHERE founder_user_id = founder_user_id) AS angel_score"#,
    )
    .bind(user.id)
    .bind(body.founder_user_id)
    .bind(stage)
    .bind(body.notes)
    .fetch_one(&state.db)
    .await
    .map_err(internal)?;
    Ok(Json(row))
}

async fn update_pipeline(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
    Path(id): Path<Uuid>,
    Json(body): Json<UpdatePipelineBody>,
) -> Result<Json<PipelineRow>, (StatusCode, String)> {
    let user = require_user(&state, bearer.token()).await?;
    require_investor(user.role.as_str())?;
    if let Some(ref s) = body.stage {
        let valid_stages = [
            "watching",
            "considering",
            "due_diligence",
            "passed",
            "invested",
        ];
        if !valid_stages.contains(&s.as_str()) {
            return Err((StatusCode::BAD_REQUEST, "invalid stage".to_string()));
        }
    }
    let row = sqlx::query_as::<_, PipelineRow>(
        r#"UPDATE investor_pipeline SET
               stage = COALESCE($3, stage),
               notes = COALESCE($4, notes),
               updated_at = NOW()
             WHERE id = $1 AND investor_user_id = $2
             RETURNING id, founder_user_id, stage, notes, created_at, updated_at,
               (SELECT company_name FROM profiles WHERE user_id = founder_user_id) AS company_name,
               (SELECT one_liner FROM profiles WHERE user_id = founder_user_id) AS one_liner,
               (SELECT sector FROM profiles WHERE user_id = founder_user_id) AS sector,
               (SELECT stage FROM profiles WHERE user_id = founder_user_id) AS startup_stage,
               (SELECT country FROM profiles WHERE user_id = founder_user_id) AS country,
               (SELECT score FROM angel_scores WHERE founder_user_id = founder_user_id) AS angel_score"#,
    )
    .bind(id)
    .bind(user.id)
    .bind(body.stage.as_deref())
    .bind(body.notes.as_deref())
    .fetch_optional(&state.db)
    .await
    .map_err(internal)?
    .ok_or_else(|| (StatusCode::NOT_FOUND, "not found".to_string()))?;
    Ok(Json(row))
}

async fn remove_from_pipeline(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, (StatusCode, String)> {
    let user = require_user(&state, bearer.token()).await?;
    require_investor(user.role.as_str())?;
    let r = sqlx::query("DELETE FROM investor_pipeline WHERE id = $1 AND investor_user_id = $2")
        .bind(id)
        .bind(user.id)
        .execute(&state.db)
        .await
        .map_err(internal)?;
    if r.rows_affected() == 0 {
        return Err((StatusCode::NOT_FOUND, "not found".to_string()));
    }
    Ok(StatusCode::NO_CONTENT)
}

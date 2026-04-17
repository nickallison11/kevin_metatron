use std::sync::Arc;

use axum::{
    extract::{Path, State},
    http::StatusCode,
    routing::{delete, get},
    Json, Router,
};
use axum_extra::{
    headers::{authorization::Bearer, Authorization},
    TypedHeader,
};
use serde::Serialize;
use uuid::Uuid;

use crate::ai::complete_chat;
use crate::identity::require_user;
use crate::state::AppState;

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/", get(list_memos).post(generate_memo))
        .route("/:id", delete(delete_memo))
}

fn internal(e: impl std::fmt::Display) -> (StatusCode, String) {
    tracing::error!("{e}");
    (StatusCode::INTERNAL_SERVER_ERROR, "internal error".to_string())
}

#[derive(Serialize, sqlx::FromRow)]
struct MemoRow {
    id: Uuid,
    founder_user_id: Uuid,
    content: String,
    generated_at: chrono::DateTime<chrono::Utc>,
    company_name: Option<String>,
}

#[derive(serde::Deserialize)]
struct GenerateMemoBody {
    founder_user_id: Uuid,
}

async fn get_investor_tier(state: &AppState, user_id: Uuid) -> Result<String, (StatusCode, String)> {
    let tier: Option<String> = sqlx::query_scalar(
        "SELECT investor_tier FROM investor_profiles WHERE user_id = $1",
    )
    .bind(user_id)
    .fetch_optional(&state.db)
    .await
    .map_err(internal)?;
    Ok(tier.unwrap_or_else(|| "free".to_string()))
}

async fn list_memos(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
) -> Result<Json<Vec<MemoRow>>, (StatusCode, String)> {
    let user = require_user(&state, bearer.token()).await?;
    if user.role != "INVESTOR" {
        return Err((StatusCode::FORBIDDEN, "investors only".to_string()));
    }
    let rows = sqlx::query_as::<_, MemoRow>(
        r#"SELECT m.id, m.founder_user_id, m.content, m.generated_at,
                  p.company_name
           FROM investment_memos m
           LEFT JOIN profiles p ON p.user_id = m.founder_user_id
           WHERE m.investor_user_id = $1
           ORDER BY m.generated_at DESC"#,
    )
    .bind(user.id)
    .fetch_all(&state.db)
    .await
    .map_err(internal)?;
    Ok(Json(rows))
}

async fn generate_memo(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
    Json(body): Json<GenerateMemoBody>,
) -> Result<Json<MemoRow>, (StatusCode, String)> {
    let user = require_user(&state, bearer.token()).await?;
    if user.role != "INVESTOR" {
        return Err((StatusCode::FORBIDDEN, "investors only".to_string()));
    }

    let tier = get_investor_tier(&state, user.id).await?;
    if tier == "free" {
        return Err((StatusCode::PAYMENT_REQUIRED, "upgrade to generate investment memos".to_string()));
    }

    if tier == "basic" {
        let count: i64 = sqlx::query_scalar(
            r#"SELECT COUNT(*)::bigint FROM investment_memos
               WHERE investor_user_id = $1
               AND date_trunc('month', generated_at) = date_trunc('month', NOW())"#,
        )
        .bind(user.id)
        .fetch_one(&state.db)
        .await
        .map_err(internal)?;
        if count >= 5 {
            return Err((StatusCode::TOO_MANY_REQUESTS, "5 memo limit reached for this month".to_string()));
        }
    }

    let profile: Option<(Option<String>, Option<String>, Option<String>, Option<String>, Option<String>)> =
        sqlx::query_as(
            "SELECT company_name, one_liner, sector, stage, country FROM profiles WHERE user_id = $1",
        )
        .bind(body.founder_user_id)
        .fetch_optional(&state.db)
        .await
        .map_err(internal)?;

    let (company_name, one_liner, sector, stage, country) =
        profile.unwrap_or_default();

    let pitch: Option<(Option<String>, Option<String>, Option<String>, Option<String>, Option<String>, Option<String>, Option<String>)> =
        sqlx::query_as(
            "SELECT problem, solution, market_size, business_model, traction, funding_ask, use_of_funds FROM pitches WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 1",
        )
        .bind(body.founder_user_id)
        .fetch_optional(&state.db)
        .await
        .map_err(internal)?;

    let (problem, solution, market_size, business_model, traction, funding_ask, use_of_funds) =
        pitch.unwrap_or_default();

    let score: Option<(Option<i32>, Option<i32>, Option<i32>, Option<i32>, Option<i32>)> =
        sqlx::query_as(
            "SELECT score, team_score, market_score, traction_score, pitch_score FROM angel_scores WHERE founder_user_id = $1",
        )
        .bind(body.founder_user_id)
        .fetch_optional(&state.db)
        .await
        .map_err(internal)?;

    let (angel_score, team_score, market_score, traction_score, pitch_score) =
        score.unwrap_or_default();

    let prompt = format!(
        "You are a professional investment analyst. Write a structured investment memo for the following startup.\n\n\
        Company: {company}\nOne-liner: {one_liner}\nSector: {sector} | Stage: {stage} | Country: {country}\n\n\
        Problem: {problem}\nSolution: {solution}\nMarket Size: {market_size}\n\
        Business Model: {business_model}\nTraction: {traction}\n\
        Funding Ask: {funding_ask}\nUse of Funds: {use_of_funds}\n\n\
        Angel Score: {score}/100 (Team: {team}/25, Market: {market}/25, Traction: {traction_s}/25, Pitch: {pitch}/25)\n\n\
        Write a 600–800 word investment memo with these sections:\n\
        1. Executive Summary\n2. Problem & Solution\n3. Market Opportunity\n\
        4. Business Model\n5. Traction\n6. Team\n7. Ask & Use of Funds\n8. Risks\n9. Recommendation",
        company = company_name.as_deref().unwrap_or("Unknown"),
        one_liner = one_liner.as_deref().unwrap_or("N/A"),
        sector = sector.as_deref().unwrap_or("N/A"),
        stage = stage.as_deref().unwrap_or("N/A"),
        country = country.as_deref().unwrap_or("N/A"),
        problem = problem.as_deref().unwrap_or("N/A"),
        solution = solution.as_deref().unwrap_or("N/A"),
        market_size = market_size.as_deref().unwrap_or("N/A"),
        business_model = business_model.as_deref().unwrap_or("N/A"),
        traction = traction.as_deref().unwrap_or("N/A"),
        funding_ask = funding_ask.as_deref().unwrap_or("N/A"),
        use_of_funds = use_of_funds.as_deref().unwrap_or("N/A"),
        score = angel_score.unwrap_or(0),
        team = team_score.unwrap_or(0),
        market = market_score.unwrap_or(0),
        traction_s = traction_score.unwrap_or(0),
        pitch = pitch_score.unwrap_or(0),
    );

    let api_key = state.ai_api_key.as_deref().unwrap_or("");
    let content = complete_chat(
        &state.http_client,
        "gemini",
        api_key,
        "gemini-2.5-flash",
        "You are a professional investment analyst writing concise, factual investment memos.",
        vec![("user".into(), prompt)],
    )
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;

    let row = sqlx::query_as::<_, MemoRow>(
        r#"INSERT INTO investment_memos (investor_user_id, founder_user_id, content)
           VALUES ($1, $2, $3)
           ON CONFLICT (investor_user_id, founder_user_id)
           DO UPDATE SET content = EXCLUDED.content, generated_at = NOW()
           RETURNING id, founder_user_id, content, generated_at,
             (SELECT company_name FROM profiles WHERE user_id = founder_user_id) AS company_name"#,
    )
    .bind(user.id)
    .bind(body.founder_user_id)
    .bind(&content)
    .fetch_one(&state.db)
    .await
    .map_err(internal)?;

    Ok(Json(row))
}

async fn delete_memo(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, (StatusCode, String)> {
    let user = require_user(&state, bearer.token()).await?;
    if user.role != "INVESTOR" {
        return Err((StatusCode::FORBIDDEN, "investors only".to_string()));
    }
    let r = sqlx::query("DELETE FROM investment_memos WHERE id = $1 AND investor_user_id = $2")
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

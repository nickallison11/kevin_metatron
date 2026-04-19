use std::sync::Arc;

use axum::{
    extract::{Path, State},
    http::StatusCode,
    routing::get,
    Json, Router,
};
use axum_extra::{
    headers::{authorization::Bearer, Authorization},
    TypedHeader,
};
use serde::Serialize;
use serde_json::Value;
use uuid::Uuid;

use crate::identity::require_user;
use crate::state::AppState;

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/", get(get_own_score).post(generate_score))
        .route("/:user_id", get(get_score_by_id))
}

#[derive(Serialize, sqlx::FromRow)]
pub struct AngelScore {
    pub founder_user_id: Uuid,
    pub score: i32,
    pub team_score: Option<i32>,
    pub market_score: Option<i32>,
    pub traction_score: Option<i32>,
    pub pitch_score: Option<i32>,
    pub reasoning: Option<String>,
    pub generated_at: chrono::DateTime<chrono::Utc>,
}

fn internal(e: impl std::fmt::Display) -> (StatusCode, String) {
    tracing::error!("{e}");
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        "internal error".to_string(),
    )
}

async fn get_own_score(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
) -> Result<Json<Option<AngelScore>>, (StatusCode, String)> {
    let user = require_user(&state, bearer.token()).await?;
    let row = sqlx::query_as::<_, AngelScore>(
        "SELECT founder_user_id, score, team_score, market_score, traction_score, pitch_score, reasoning, generated_at \
         FROM angel_scores WHERE founder_user_id = $1",
    )
    .bind(user.id)
    .fetch_optional(&state.db)
    .await
    .map_err(internal)?;
    Ok(Json(row))
}

async fn get_score_by_id(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
    Path(user_id): Path<Uuid>,
) -> Result<Json<Option<AngelScore>>, (StatusCode, String)> {
    let _user = require_user(&state, bearer.token()).await?;
    let row = sqlx::query_as::<_, AngelScore>(
        "SELECT founder_user_id, score, team_score, market_score, traction_score, pitch_score, reasoning, generated_at \
         FROM angel_scores WHERE founder_user_id = $1",
    )
    .bind(user_id)
    .fetch_optional(&state.db)
    .await
    .map_err(internal)?;
    Ok(Json(row))
}

async fn generate_score(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
) -> Result<Json<AngelScore>, (StatusCode, String)> {
    let user = require_user(&state, bearer.token()).await?;
    if user.role != "STARTUP" {
        return Err((
            StatusCode::FORBIDDEN,
            "Angel score is only available for founder accounts".to_string(),
        ));
    }

    let existing = sqlx::query_as::<_, AngelScore>(
        "SELECT founder_user_id, score, team_score, market_score, traction_score, pitch_score, reasoning, generated_at \
         FROM angel_scores WHERE founder_user_id = $1 AND generated_at > NOW() - INTERVAL '24 hours'",
    )
    .bind(user.id)
    .fetch_optional(&state.db)
    .await
    .map_err(internal)?;
    if let Some(score) = existing {
        return Ok(Json(score));
    }

    let gemini_key = std::env::var("GEMINI_API_KEY")
        .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "GEMINI_API_KEY not set".to_string()))?;

    let profile: Option<(
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
    )> = sqlx::query_as(
        "SELECT company_name, one_liner, stage, sector, country, website FROM profiles WHERE user_id = $1",
    )
    .bind(user.id)
    .fetch_optional(&state.db)
    .await
    .map_err(internal)?;

    let pitches: Vec<Value> = sqlx::query_scalar(
        "SELECT to_jsonb(p) FROM pitches p WHERE created_by = $1 ORDER BY created_at DESC LIMIT 3",
    )
    .bind(user.id)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    let profile_text = match profile {
        Some((company, one_liner, stage, sector, country, website)) => format!(
            "Company: {}\nOne-liner: {}\nStage: {}\nSector: {}\nCountry: {}\nWebsite: {}",
            company.unwrap_or_default(),
            one_liner.unwrap_or_default(),
            stage.unwrap_or_default(),
            sector.unwrap_or_default(),
            country.unwrap_or_default(),
            website.unwrap_or_default()
        ),
        None => "No profile data available.".to_string(),
    };

    let pitch_text = if pitches.is_empty() {
        "No pitch data available.".to_string()
    } else {
        serde_json::to_string(&pitches).unwrap_or_default()
    };

    let prompt = format!(
        r#"You are Kevin, an AI investment analyst. Score this founder 0–100 across 4 dimensions (max 25 points each):
- team (0-25): founder credibility, profile completeness, background signals
- market (0-25): sector timing, geography, addressable market opportunity
- traction (0-25): stage-appropriate evidence, metrics, momentum
- pitch (0-25): clarity, narrative quality, completeness

Founder profile:
{profile_text}

Pitch data:
{pitch_text}

Return ONLY valid JSON, no markdown, no code fences:
{{"score":0,"team":0,"market":0,"traction":0,"pitch":0,"reasoning":"2-3 sentence explanation"}}"#
    );

    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={}",
        gemini_key
    );
    let payload = serde_json::json!({
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {"maxOutputTokens": 4096, "temperature": 0.2, "thinkingConfig": {"thinkingBudget": 0}}
    });

    let client = reqwest::Client::new();
    let res = tokio::time::timeout(
        std::time::Duration::from_secs(30),
        client
            .post(&url)
            .header("content-type", "application/json")
            .json(&payload)
            .send(),
    )
    .await
    .map_err(|_| (StatusCode::GATEWAY_TIMEOUT, "Gemini timeout".to_string()))?
    .map_err(|e| (StatusCode::BAD_GATEWAY, e.to_string()))?;

    let body: Value = res
        .json()
        .await
        .map_err(|e| (StatusCode::BAD_GATEWAY, e.to_string()))?;
    let text = body["candidates"][0]["content"]["parts"][0]["text"]
        .as_str()
        .unwrap_or("{}");
    let clean = text
        .trim()
        .trim_start_matches("```json")
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim();
    let parsed: Value = serde_json::from_str(clean).unwrap_or_else(|_| {
        serde_json::json!({"score":50,"team":12,"market":12,"traction":13,"pitch":13,"reasoning":"Score generated with limited profile data. Complete your profile for a more accurate score."})
    });

    let score = parsed["score"].as_i64().unwrap_or(50).clamp(0, 100) as i32;
    let team = parsed["team"].as_i64().map(|v| v.clamp(0, 25) as i32);
    let market = parsed["market"].as_i64().map(|v| v.clamp(0, 25) as i32);
    let traction = parsed["traction"].as_i64().map(|v| v.clamp(0, 25) as i32);
    let pitch_s = parsed["pitch"].as_i64().map(|v| v.clamp(0, 25) as i32);
    let reasoning = parsed["reasoning"].as_str().map(str::to_owned);

    let row = sqlx::query_as::<_, AngelScore>(
        "INSERT INTO angel_scores (founder_user_id, score, team_score, market_score, traction_score, pitch_score, reasoning) \
         VALUES ($1, $2, $3, $4, $5, $6, $7) \
         ON CONFLICT (founder_user_id) DO UPDATE SET \
           score = EXCLUDED.score, team_score = EXCLUDED.team_score, \
           market_score = EXCLUDED.market_score, traction_score = EXCLUDED.traction_score, \
           pitch_score = EXCLUDED.pitch_score, reasoning = EXCLUDED.reasoning, \
           generated_at = NOW() \
         RETURNING founder_user_id, score, team_score, market_score, traction_score, pitch_score, reasoning, generated_at",
    )
    .bind(user.id)
    .bind(score)
    .bind(team)
    .bind(market)
    .bind(traction)
    .bind(pitch_s)
    .bind(reasoning)
    .fetch_one(&state.db)
    .await
    .map_err(internal)?;

    Ok(Json(row))
}

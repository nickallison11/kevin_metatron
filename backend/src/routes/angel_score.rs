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

/// The founder's own score plus whether it still reflects their profile and pitch.
#[derive(Serialize)]
pub struct OwnScore {
    #[serde(flatten)]
    score: AngelScore,
    /// False once the profile, pitch or deck changed after the score was generated.
    up_to_date: bool,
}

/// After a re-score, wait this long before scoring the same founder again, so a
/// burst of edits costs one AI call, not one per edit.
const RESCORE_COOLDOWN_MINUTES: i64 = 10;

/// Latest edit to anything the score is based on: the profile (incl. deck) or a pitch.
async fn content_changed_at(
    state: &AppState,
    user_id: Uuid,
) -> Result<Option<chrono::DateTime<chrono::Utc>>, (StatusCode, String)> {
    sqlx::query_scalar(
        "SELECT GREATEST( \
           (SELECT updated_at FROM profiles WHERE user_id = $1), \
           (SELECT MAX(updated_at) FROM pitches WHERE created_by = $1))",
    )
    .bind(user_id)
    .fetch_one(&state.db)
    .await
    .map_err(internal)
}

/// Whether there's anything to score yet: a pitch, a deck, or a one-liner.
async fn has_content(state: &AppState, user_id: Uuid) -> Result<bool, (StatusCode, String)> {
    sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM pitches WHERE created_by = $1) \
             OR EXISTS(SELECT 1 FROM profiles WHERE user_id = $1 \
                       AND (NULLIF(TRIM(one_liner), '') IS NOT NULL OR deck_text IS NOT NULL))",
    )
    .bind(user_id)
    .fetch_one(&state.db)
    .await
    .map_err(internal)
}

fn internal(e: impl std::fmt::Display) -> (StatusCode, String) {
    tracing::error!("{e}");
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        "internal error".to_string(),
    )
}

/// Free tier sees the overall score + narrative reasoning only; Basic and Pro
/// see the full team/market/traction/pitch sub-score breakdown. Gated on the
/// viewer's own tier, not whichever founder's score is being viewed -- detail
/// level is a perk of the viewer's subscription, same as everywhere else in
/// the tier matrix.
pub(crate) fn redact_breakdown_if_free(mut score: AngelScore, is_basic: bool, is_pro: bool) -> AngelScore {
    if !is_basic && !is_pro {
        score.team_score = None;
        score.market_score = None;
        score.traction_score = None;
        score.pitch_score = None;
    }
    score
}

async fn get_own_score(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
) -> Result<Json<Option<OwnScore>>, (StatusCode, String)> {
    let user = require_user(&state, bearer.token()).await?;
    let row = sqlx::query_as::<_, AngelScore>(
        "SELECT founder_user_id, score, team_score, market_score, traction_score, pitch_score, reasoning, generated_at \
         FROM angel_scores WHERE founder_user_id = $1",
    )
    .bind(user.id)
    .fetch_optional(&state.db)
    .await
    .map_err(internal)?;
    let Some(score) = row else { return Ok(Json(None)) };
    let changed = content_changed_at(&state, user.id).await?;
    let up_to_date = changed.map_or(true, |c| c <= score.generated_at);
    Ok(Json(Some(OwnScore {
        score: redact_breakdown_if_free(score, user.is_basic, user.is_pro),
        up_to_date,
    })))
}

async fn get_score_by_id(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
    Path(user_id): Path<Uuid>,
) -> Result<Json<Option<AngelScore>>, (StatusCode, String)> {
    let user = require_user(&state, bearer.token()).await?;
    let row = sqlx::query_as::<_, AngelScore>(
        "SELECT founder_user_id, score, team_score, market_score, traction_score, pitch_score, reasoning, generated_at \
         FROM angel_scores WHERE founder_user_id = $1",
    )
    .bind(user_id)
    .fetch_optional(&state.db)
    .await
    .map_err(internal)?;
    Ok(Json(row.map(|s| redact_breakdown_if_free(s, user.is_basic, user.is_pro))))
}

async fn generate_score(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
) -> Result<Json<OwnScore>, (StatusCode, String)> {
    let user = require_user(&state, bearer.token()).await?;
    if user.role != "STARTUP" {
        return Err((
            StatusCode::FORBIDDEN,
            "Angel score is only available for founder accounts".to_string(),
        ));
    }

    // Only call the AI when the score is missing or the profile/pitch changed
    // since it was generated (and not again within the cooldown).
    let existing = sqlx::query_as::<_, AngelScore>(
        "SELECT founder_user_id, score, team_score, market_score, traction_score, pitch_score, reasoning, generated_at \
         FROM angel_scores WHERE founder_user_id = $1",
    )
    .bind(user.id)
    .fetch_optional(&state.db)
    .await
    .map_err(internal)?;
    let changed = content_changed_at(&state, user.id).await?;
    if let Some(score) = existing {
        let up_to_date = changed.map_or(true, |c| c <= score.generated_at);
        let cooling = score.generated_at > chrono::Utc::now() - chrono::Duration::minutes(RESCORE_COOLDOWN_MINUTES);
        if up_to_date || cooling {
            return Ok(Json(OwnScore {
                score: redact_breakdown_if_free(score, user.is_basic, user.is_pro),
                up_to_date,
            }));
        }
    } else if !has_content(&state, user.id).await? {
        return Err((
            StatusCode::CONFLICT,
            "Add your pitch first; Kevin scores you once it's in.".to_string(),
        ));
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

The "reasoning" field is shown directly to the founder on their dashboard —
write it as feedback from an analyst to a founder, not as internal notes.
Never mention data sources, tables, "profile" vs "pitch data" as system
concepts, or that anything is "missing," "confusing," or inconsistent
between inputs. If the company name or details differ between the two
sections, silently prefer whichever is more complete and score on that
alone — don't narrate the discrepancy. Speak to the founder in second
person, be specific and constructive, and keep it to 2-3 sentences.

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

    let ok = res.status().is_success();
    let body: Value = res
        .json()
        .await
        .map_err(|e| (StatusCode::BAD_GATEWAY, e.to_string()))?;
    if !ok {
        crate::alerts::check_gemini_error(&body.to_string());
    }

    let tier = if user.is_pro { "pro" } else if user.is_basic { "basic" } else { "free" };
    crate::cost::record_llm_usage(
        &state.db,
        Some(user.id),
        Some(user.role.as_str()),
        Some(tier),
        "angel_score",
        "gemini",
        "gemini-2.5-flash",
        body["usageMetadata"]["promptTokenCount"].as_i64().unwrap_or(0) as i32,
        body["usageMetadata"]["candidatesTokenCount"].as_i64().unwrap_or(0) as i32,
    )
    .await;

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

    // Gemini's number is the base; each founder/company link filled in adds fixed points.
    let base = score;
    let score = (base + crate::routes::founder_extras::profile_bonus(&state.db, user.id).await).min(100);

    let row = sqlx::query_as::<_, AngelScore>(
        "INSERT INTO angel_scores (founder_user_id, score, team_score, market_score, traction_score, pitch_score, reasoning, base_score) \
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) \
         ON CONFLICT (founder_user_id) DO UPDATE SET \
           score = EXCLUDED.score, base_score = EXCLUDED.base_score, team_score = EXCLUDED.team_score, \
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
    .bind(base)
    .fetch_one(&state.db)
    .await
    .map_err(internal)?;

    Ok(Json(OwnScore {
        score: redact_breakdown_if_free(row, user.is_basic, user.is_pro),
        up_to_date: true,
    }))
}

use std::sync::Arc;

use axum::{
    extract::State,
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
        .route("/", get(get_matches).post(generate_matches))
}

#[derive(Serialize, sqlx::FromRow)]
pub struct KevinMatch {
    pub id: Uuid,
    pub matched_user_id: Uuid,
    pub match_type: String,
    pub score: i32,
    pub reasoning: Option<String>,
    pub generated_at: chrono::DateTime<chrono::Utc>,
    pub firm_name: Option<String>,
    pub company_name: Option<String>,
    pub one_liner: Option<String>,
    pub stage: Option<String>,
    pub sector: Option<String>,
    pub country: Option<String>,
    pub angel_score: Option<i32>,
}

fn internal(e: impl std::fmt::Display) -> (StatusCode, String) {
    tracing::error!("{e}");
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        "internal error".to_string(),
    )
}

async fn fetch_kevin_matches_for_user(
    state: &AppState,
    user_id: Uuid,
    match_type: Option<&str>,
    limit: i64,
) -> Result<Vec<KevinMatch>, (StatusCode, String)> {
    let rows = if let Some(mt) = match_type {
        sqlx::query_as::<_, KevinMatch>(
            r#"SELECT km.id, km.matched_user_id, km.match_type, km.score, km.reasoning, km.generated_at,
                  ip.firm_name, p.company_name, p.one_liner, p.stage, p.sector, p.country,
                  a.score AS angel_score
           FROM kevin_matches km
           LEFT JOIN investor_profiles ip ON ip.user_id = km.matched_user_id
           LEFT JOIN profiles p ON p.user_id = km.matched_user_id
           LEFT JOIN angel_scores a ON a.founder_user_id = km.matched_user_id
           WHERE km.for_user_id = $1 AND km.match_type = $2
           ORDER BY km.score DESC, km.generated_at DESC
           LIMIT $3"#,
        )
        .bind(user_id)
        .bind(mt)
        .bind(limit)
        .fetch_all(&state.db)
        .await
    } else {
        sqlx::query_as::<_, KevinMatch>(
            r#"SELECT km.id, km.matched_user_id, km.match_type, km.score, km.reasoning, km.generated_at,
                  ip.firm_name, p.company_name, p.one_liner, p.stage, p.sector, p.country,
                  a.score AS angel_score
           FROM kevin_matches km
           LEFT JOIN investor_profiles ip ON ip.user_id = km.matched_user_id
           LEFT JOIN profiles p ON p.user_id = km.matched_user_id
           LEFT JOIN angel_scores a ON a.founder_user_id = km.matched_user_id
           WHERE km.for_user_id = $1
           ORDER BY km.score DESC, km.generated_at DESC
           LIMIT $2"#,
        )
        .bind(user_id)
        .bind(limit)
        .fetch_all(&state.db)
        .await
    }
    .map_err(internal)?;
    Ok(rows)
}

async fn get_matches(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
) -> Result<Json<Vec<KevinMatch>>, (StatusCode, String)> {
    let user = require_user(&state, bearer.token()).await?;
    let rows = fetch_kevin_matches_for_user(&state, user.id, None, 10).await?;
    Ok(Json(rows))
}

async fn generate_matches(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
) -> Result<Json<Vec<KevinMatch>>, (StatusCode, String)> {
    let user = require_user(&state, bearer.token()).await?;

    let fresh_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*)::bigint FROM kevin_matches WHERE for_user_id = $1 AND generated_at > NOW() - INTERVAL '6 hours'",
    )
    .bind(user.id)
    .fetch_one(&state.db)
    .await
    .unwrap_or(0);
    if fresh_count > 0 {
        let rows = fetch_kevin_matches_for_user(&state, user.id, None, 10).await?;
        return Ok(Json(rows));
    }

    let gemini_key = std::env::var("GEMINI_API_KEY")
        .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "GEMINI_API_KEY not set".to_string()))?;

    let role = user.role.as_str();

    let (user_context, candidates_json, match_type) = if role == "STARTUP" {
        let profile: Option<(Option<String>, Option<String>, Option<String>, Option<String>)> =
            sqlx::query_as(
                "SELECT company_name, one_liner, stage, sector FROM profiles WHERE user_id = $1",
            )
            .bind(user.id)
            .fetch_optional(&state.db)
            .await
            .map_err(internal)?;

        let (company, one_liner, stage, sector) =
            profile.unwrap_or((None, None, None, None));
        let ctx = format!(
            "Founder: {}, {}, Stage: {}, Sector: {}",
            company.unwrap_or_default(),
            one_liner.unwrap_or_default(),
            stage.clone().unwrap_or_default(),
            sector.clone().unwrap_or_default()
        );

        #[derive(sqlx::FromRow, Serialize)]
        struct InvCandidate {
            user_id: Uuid,
            firm_name: Option<String>,
            bio: Option<String>,
            investment_thesis: Option<String>,
            sectors: Option<Vec<String>>,
            stages: Option<Vec<String>>,
            ticket_size_min: Option<i64>,
            ticket_size_max: Option<i64>,
            country: Option<String>,
        }
        let candidates: Vec<InvCandidate> = sqlx::query_as(
            r#"SELECT ip.user_id, ip.firm_name, ip.bio, ip.investment_thesis, ip.sectors, ip.stages,
                      ip.ticket_size_min, ip.ticket_size_max, ip.country
                 FROM investor_profiles ip
                 JOIN users u ON u.id = ip.user_id
                 WHERE (ip.sectors IS NULL OR ip.sectors = '{}'::text[] OR $1::text IS NULL OR $1 = ANY(ip.sectors))
                   AND (ip.stages IS NULL OR ip.stages = '{}'::text[] OR $2::text IS NULL OR $2 = ANY(ip.stages))
                 ORDER BY RANDOM() LIMIT 20"#,
        )
        .bind(&sector)
        .bind(&stage)
        .fetch_all(&state.db)
        .await
        .map_err(internal)?;

        let json = serde_json::to_string(&candidates).unwrap_or_default();
        (ctx, json, "founder_investor")
    } else {
        let inv_profile: Option<(
            Option<String>,
            Option<String>,
            Option<Vec<String>>,
            Option<Vec<String>>,
        )> = sqlx::query_as(
            "SELECT firm_name, investment_thesis, sectors, stages FROM investor_profiles WHERE user_id = $1",
        )
        .bind(user.id)
        .fetch_optional(&state.db)
        .await
        .map_err(internal)?;

        let (firm, thesis, sectors, stages) =
            inv_profile.unwrap_or((None, None, None, None));
        let ctx = format!(
            "Investor: {}, Thesis: {}, Sectors: {:?}, Stages: {:?}",
            firm.unwrap_or_default(),
            thesis.unwrap_or_default(),
            sectors.clone().unwrap_or_default(),
            stages.clone().unwrap_or_default()
        );

        #[derive(sqlx::FromRow, Serialize)]
        struct FounderCandidate {
            user_id: Uuid,
            company_name: Option<String>,
            one_liner: Option<String>,
            stage: Option<String>,
            sector: Option<String>,
            country: Option<String>,
            angel_score: Option<i32>,
        }
        let candidates: Vec<FounderCandidate> = sqlx::query_as(
            r#"SELECT p.user_id, p.company_name, p.one_liner, p.stage, p.sector, p.country,
                      a.score AS angel_score
                 FROM profiles p
                 JOIN users u ON u.id = p.user_id
                 LEFT JOIN angel_scores a ON a.founder_user_id = p.user_id
                 WHERE ($1::text[] IS NULL OR p.sector = ANY($1))
                   AND ($2::text[] IS NULL OR p.stage = ANY($2))
                 ORDER BY COALESCE(a.score, 0) DESC
                 LIMIT 20"#,
        )
        .bind(&sectors)
        .bind(&stages)
        .fetch_all(&state.db)
        .await
        .map_err(internal)?;

        let json = serde_json::to_string(&candidates).unwrap_or_default();
        (ctx, json, "investor_founder")
    };

    if candidates_json == "[]" {
        return Ok(Json(vec![]));
    }

    let prompt = format!(
        r#"You are Kevin, an AI matchmaking engine for metatron. Rank these candidates for the user below.
For each candidate return a match score 0–100 and a one-line reason (max 12 words, be specific).

User: {user_context}

Candidates (JSON array):
{candidates_json}

Return ONLY a valid JSON array, no markdown, no code fences:
[{{"user_id":"...","score":0,"reasoning":"..."}}]

Return the top 5 matches only, ranked by score descending."#
    );

    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={}",
        gemini_key
    );
    let payload = serde_json::json!({
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {"maxOutputTokens": 1024, "temperature": 0.2}
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
        .unwrap_or("[]");
    let clean = text
        .trim()
        .trim_start_matches("```json")
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim();
    let ranked: Vec<Value> = serde_json::from_str(clean).unwrap_or_default();

    sqlx::query("DELETE FROM kevin_matches WHERE for_user_id = $1 AND match_type = $2")
        .bind(user.id)
        .bind(match_type)
        .execute(&state.db)
        .await
        .map_err(internal)?;

    for item in &ranked {
        let uid_str = item["user_id"].as_str().unwrap_or("");
        let Ok(matched_id) = Uuid::parse_str(uid_str) else {
            continue;
        };
        let score = item["score"].as_i64().unwrap_or(0).clamp(0, 100) as i32;
        let reasoning = item["reasoning"].as_str().map(str::to_owned);
        let _ = sqlx::query(
            "INSERT INTO kevin_matches (for_user_id, matched_user_id, match_type, score, reasoning) \
             VALUES ($1, $2, $3, $4, $5) \
             ON CONFLICT (for_user_id, matched_user_id, match_type) DO UPDATE SET \
               score = EXCLUDED.score, reasoning = EXCLUDED.reasoning, generated_at = NOW()",
        )
        .bind(user.id)
        .bind(matched_id)
        .bind(match_type)
        .bind(score)
        .bind(reasoning)
        .execute(&state.db)
        .await;
    }

    let rows = fetch_kevin_matches_for_user(&state, user.id, Some(match_type), 5).await?;
    Ok(Json(rows))
}

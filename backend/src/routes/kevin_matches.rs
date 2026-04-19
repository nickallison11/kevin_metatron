use std::collections::HashMap;
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
    pub matched_user_id: Option<Uuid>,
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
    (StatusCode::INTERNAL_SERVER_ERROR, "internal error".to_string())
}

const FETCH_SQL: &str = r#"
    SELECT km.id, km.matched_user_id, km.match_type, km.score, km.reasoning, km.generated_at,
        COALESCE(km.display_name, ip.firm_name) AS firm_name,
        p.company_name,
        COALESCE(km.display_one_liner, p.one_liner) AS one_liner,
        COALESCE(km.display_stage, p.stage) AS stage,
        COALESCE(km.display_sector, p.sector) AS sector,
        COALESCE(km.display_country, ip.country, p.country) AS country,
        a.score AS angel_score
    FROM kevin_matches km
    LEFT JOIN investor_profiles ip ON ip.user_id = km.matched_user_id
    LEFT JOIN profiles p ON p.user_id = km.matched_user_id
    LEFT JOIN angel_scores a ON a.founder_user_id = km.matched_user_id
    WHERE km.for_user_id = $1
    ORDER BY km.score DESC, km.generated_at DESC
    LIMIT $2
"#;

const FETCH_TYPED_SQL: &str = r#"
    SELECT km.id, km.matched_user_id, km.match_type, km.score, km.reasoning, km.generated_at,
        COALESCE(km.display_name, ip.firm_name) AS firm_name,
        p.company_name,
        COALESCE(km.display_one_liner, p.one_liner) AS one_liner,
        COALESCE(km.display_stage, p.stage) AS stage,
        COALESCE(km.display_sector, p.sector) AS sector,
        COALESCE(km.display_country, ip.country, p.country) AS country,
        a.score AS angel_score
    FROM kevin_matches km
    LEFT JOIN investor_profiles ip ON ip.user_id = km.matched_user_id
    LEFT JOIN profiles p ON p.user_id = km.matched_user_id
    LEFT JOIN angel_scores a ON a.founder_user_id = km.matched_user_id
    WHERE km.for_user_id = $1 AND km.match_type = $2
    ORDER BY km.score DESC, km.generated_at DESC
    LIMIT $3
"#;

async fn fetch_kevin_matches_for_user(
    state: &AppState,
    user_id: Uuid,
    match_type: Option<&str>,
    limit: i64,
) -> Result<Vec<KevinMatch>, (StatusCode, String)> {
    let rows = if let Some(mt) = match_type {
        sqlx::query_as::<_, KevinMatch>(FETCH_TYPED_SQL)
            .bind(user_id)
            .bind(mt)
            .bind(limit)
            .fetch_all(&state.db)
            .await
    } else {
        sqlx::query_as::<_, KevinMatch>(FETCH_SQL)
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

// Display info tracked per candidate ID
struct CandidateInfo {
    source: &'static str, // "user" or "contact"
    display_name: Option<String>,
    display_one_liner: Option<String>,
    display_sector: Option<String>,
    display_stage: Option<String>,
    display_country: Option<String>,
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

    let (user_context, candidates_json, candidate_info, match_type) = if role == "STARTUP" {
        let profile: Option<(Option<String>, Option<String>, Option<String>, Option<String>)> =
            sqlx::query_as(
                "SELECT company_name, one_liner, stage, sector FROM profiles WHERE user_id = $1",
            )
            .bind(user.id)
            .fetch_optional(&state.db)
            .await
            .map_err(internal)?;

        let (company, one_liner, stage, sector) = profile.unwrap_or((None, None, None, None));
        let ctx = format!(
            "Founder: {}, {}, Stage: {}, Sector: {}",
            company.unwrap_or_default(),
            one_liner.unwrap_or_default(),
            stage.clone().unwrap_or_default(),
            sector.clone().unwrap_or_default()
        );

        // Registered investors
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
        let registered: Vec<InvCandidate> = sqlx::query_as(
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

        // Connector network investors (metatron connect + all connectors)
        #[derive(sqlx::FromRow)]
        struct ContactCandidate {
            id: Uuid,
            name: String,
            firm_or_company: Option<String>,
            one_liner: Option<String>,
            sector_focus: Option<String>,
            stage_focus: Option<String>,
            geography: Option<String>,
        }
        let contacts: Vec<ContactCandidate> = sqlx::query_as(
            r#"SELECT id, name, firm_or_company, one_liner, sector_focus, stage_focus, geography
                 FROM connector_network_contacts
                 WHERE role = 'investor' AND is_archived = false
                 ORDER BY RANDOM() LIMIT 30"#,
        )
        .fetch_all(&state.db)
        .await
        .map_err(internal)?;

        let mut info: HashMap<String, CandidateInfo> = HashMap::new();
        let mut all: Vec<Value> = vec![];

        for inv in &registered {
            let id = inv.user_id.to_string();
            info.insert(id.clone(), CandidateInfo {
                source: "user",
                display_name: inv.firm_name.clone(),
                display_one_liner: None,
                display_sector: None,
                display_stage: None,
                display_country: inv.country.clone(),
            });
            all.push(serde_json::json!({
                "id": id,
                "source": "user",
                "name": inv.firm_name,
                "thesis": inv.investment_thesis,
                "sectors": inv.sectors,
                "stages": inv.stages,
                "country": inv.country,
            }));
        }

        for c in contacts.iter().take(20) {
            let id = c.id.to_string();
            let display_name = c.firm_or_company.clone().unwrap_or_else(|| c.name.clone());
            // Truncate long fields to keep prompt compact
            let sector = c.sector_focus.as_deref().map(|s| &s[..s.len().min(60)]).map(str::to_owned);
            let stage = c.stage_focus.as_deref().map(|s| &s[..s.len().min(40)]).map(str::to_owned);
            info.insert(id.clone(), CandidateInfo {
                source: "contact",
                display_name: Some(display_name.clone()),
                display_one_liner: c.one_liner.clone(),
                display_sector: c.sector_focus.clone(),
                display_stage: c.stage_focus.clone(),
                display_country: c.geography.clone(),
            });
            all.push(serde_json::json!({
                "id": id,
                "name": display_name,
                "sector": sector,
                "stage": stage,
                "country": c.geography,
            }));
        }

        let json = serde_json::to_string(&all).unwrap_or_default();
        (ctx, json, info, "founder_investor")
    } else {
        // Investor → find founders (unchanged logic, no connector contacts for this direction)
        let inv_profile: Option<(Option<String>, Option<String>, Option<Vec<String>>, Option<Vec<String>>)> =
            sqlx::query_as(
                "SELECT firm_name, investment_thesis, sectors, stages FROM investor_profiles WHERE user_id = $1",
            )
            .bind(user.id)
            .fetch_optional(&state.db)
            .await
            .map_err(internal)?;

        let (firm, thesis, sectors, stages) = inv_profile.unwrap_or((None, None, None, None));
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
        let founders: Vec<FounderCandidate> = sqlx::query_as(
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

        let mut info: HashMap<String, CandidateInfo> = HashMap::new();
        for f in &founders {
            let id = f.user_id.to_string();
            info.insert(id.clone(), CandidateInfo {
                source: "user",
                display_name: f.company_name.clone(),
                display_one_liner: f.one_liner.clone(),
                display_sector: f.sector.clone(),
                display_stage: f.stage.clone(),
                display_country: f.country.clone(),
            });
        }

        let json = serde_json::to_string(&founders).unwrap_or_default();
        (ctx, json, info, "investor_founder")
    };

    if candidates_json == "[]" || candidate_info.is_empty() {
        return Ok(Json(vec![]));
    }

    let prompt = format!(
        r#"You are Kevin, an AI matchmaking engine for metatron. Rank these candidates for the user below.
For each candidate return a match score 0–100 and a one-line reason (max 12 words, be specific).

User: {user_context}

Candidates (JSON array, each has an "id" and "source" field):
{candidates_json}

Return ONLY a valid JSON array, no markdown, no code fences:
[{{"id":"...","score":0,"reasoning":"..."}}]

Return the top 5 matches only, ranked by score descending."#
    );

    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={}",
        gemini_key
    );
    let payload = serde_json::json!({
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {"maxOutputTokens": 4096, "temperature": 0.2}
    });

    let client = reqwest::Client::new();
    let res = tokio::time::timeout(
        std::time::Duration::from_secs(30),
        client.post(&url).header("content-type", "application/json").json(&payload).send(),
    )
    .await
    .map_err(|_| (StatusCode::GATEWAY_TIMEOUT, "Gemini timeout".to_string()))?
    .map_err(|e| (StatusCode::BAD_GATEWAY, e.to_string()))?;

    let body: Value = res.json().await.map_err(|e| (StatusCode::BAD_GATEWAY, e.to_string()))?;
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
    eprintln!("DBG ranked={} clean_len={}", ranked.len(), clean.len());

    sqlx::query("DELETE FROM kevin_matches WHERE for_user_id = $1 AND match_type = $2")
        .bind(user.id)
        .bind(match_type)
        .execute(&state.db)
        .await
        .map_err(internal)?;

    for item in &ranked {
        let id_str = item["id"].as_str().unwrap_or("");
        let Some(info) = candidate_info.get(id_str) else { continue; };
        let Ok(candidate_uuid) = Uuid::parse_str(id_str) else { continue; };
        let score = item["score"].as_i64().unwrap_or(0).clamp(0, 100) as i32;
        let reasoning = item["reasoning"].as_str().map(str::to_owned);

        if info.source == "user" {
            let _ = sqlx::query(
                r#"INSERT INTO kevin_matches
                    (for_user_id, matched_user_id, contact_id, match_type, score, reasoning,
                     display_name, display_one_liner, display_sector, display_stage, display_country)
                   VALUES ($1, $2, NULL, $3, $4, $5, $6, $7, $8, $9, $10)
                   ON CONFLICT (for_user_id, matched_user_id, match_type) WHERE matched_user_id IS NOT NULL
                   DO UPDATE SET score = EXCLUDED.score, reasoning = EXCLUDED.reasoning,
                     generated_at = NOW(), display_name = EXCLUDED.display_name,
                     display_one_liner = EXCLUDED.display_one_liner"#,
            )
            .bind(user.id)
            .bind(candidate_uuid)
            .bind(match_type)
            .bind(score)
            .bind(&reasoning)
            .bind(info.display_name.as_deref())
            .bind(info.display_one_liner.as_deref())
            .bind(info.display_sector.as_deref())
            .bind(info.display_stage.as_deref())
            .bind(info.display_country.as_deref())
            .execute(&state.db)
            .await;
        } else {
            let _ = sqlx::query(
                r#"INSERT INTO kevin_matches
                    (for_user_id, matched_user_id, contact_id, match_type, score, reasoning,
                     display_name, display_one_liner, display_sector, display_stage, display_country)
                   VALUES ($1, NULL, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                   ON CONFLICT (for_user_id, contact_id, match_type) WHERE contact_id IS NOT NULL
                   DO UPDATE SET score = EXCLUDED.score, reasoning = EXCLUDED.reasoning,
                     generated_at = NOW(), display_name = EXCLUDED.display_name,
                     display_one_liner = EXCLUDED.display_one_liner"#,
            )
            .bind(user.id)
            .bind(candidate_uuid)
            .bind(match_type)
            .bind(score)
            .bind(&reasoning)
            .bind(info.display_name.as_deref())
            .bind(info.display_one_liner.as_deref())
            .bind(info.display_sector.as_deref())
            .bind(info.display_stage.as_deref())
            .bind(info.display_country.as_deref())
            .execute(&state.db)
            .await;
        }
    }

    let rows = fetch_kevin_matches_for_user(&state, user.id, Some(match_type), 5).await?;
    Ok(Json(rows))
}

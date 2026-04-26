use std::collections::HashMap;
use std::sync::Arc;

use axum::{
    extract::{Path, State},
    http::StatusCode,
    routing::{get, post},
    Json, Router,
};
use axum_extra::{
    headers::{authorization::Bearer, Authorization},
    TypedHeader,
};
use serde::Serialize;
use serde_json::Value;
use uuid::Uuid;

use crate::email;
use crate::identity::require_user;
use crate::state::AppState;

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/", get(get_matches).post(generate_matches))
        .route("/:id/request-intro", post(request_intro))
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
    pub intro_requested_at: Option<chrono::DateTime<chrono::Utc>>,
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
        a.score AS angel_score,
        km.intro_requested_at
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
        a.score AS angel_score,
        km.intro_requested_at
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
    let (is_basic, is_pro_user): (bool, bool) = if user.role.as_str() == "STARTUP" {
        sqlx::query_as::<_, (bool, bool)>(
            "SELECT COALESCE(is_basic, false), COALESCE(is_pro, false) FROM users WHERE id = $1",
        )
        .bind(user.id)
        .fetch_one(&state.db)
        .await
        .unwrap_or((false, false))
    } else {
        (false, false)
    };
    let match_limit: i64 = if is_pro_user {
        if state.match_limit_pro == 0 {
            i64::MAX
        } else {
            state.match_limit_pro
        }
    } else if is_basic {
        state.match_limit_basic
    } else {
        state.match_limit_free
    };
    let rows = fetch_kevin_matches_for_user(&state, user.id, None, match_limit).await?;
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

    let (is_basic, is_pro_user): (bool, bool) = if user.role.as_str() == "STARTUP" {
        sqlx::query_as::<_, (bool, bool)>(
            "SELECT COALESCE(is_basic, false), COALESCE(is_pro, false) FROM users WHERE id = $1",
        )
        .bind(user.id)
        .fetch_one(&state.db)
        .await
        .unwrap_or((false, false))
    } else {
        (false, false)
    };
    let match_limit: i64 = if is_pro_user {
        if state.match_limit_pro == 0 {
            i64::MAX
        } else {
            state.match_limit_pro
        }
    } else if is_basic {
        state.match_limit_basic
    } else {
        state.match_limit_free
    };
    let cache_interval = if is_basic || is_pro_user { "6 hours" } else { "7 days" };

    let fresh_count: i64 = sqlx::query_scalar(
        &format!("SELECT COUNT(*)::bigint FROM kevin_matches WHERE for_user_id = $1 AND generated_at > NOW() - INTERVAL '{cache_interval}'"),
    )
    .bind(user.id)
    .fetch_one(&state.db)
    .await
    .unwrap_or(0);
    if fresh_count > 0 {
        let rows = fetch_kevin_matches_for_user(&state, user.id, None, match_limit).await?;
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
        // Gate: require complete profile before generating matches
        if company.is_none() || one_liner.is_none() || stage.is_none() || sector.is_none() {
            return Ok(Json(vec![]));
        }
        let company = company.unwrap();
        let one_liner = one_liner.unwrap();
        let stage = stage.unwrap();
        let sector = sector.unwrap();
        let ctx = format!(
            "Founder: {}, {}, Stage: {}, Sector: {}",
            company, one_liner, stage, sector
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
        r#"You are Kevin, metatron's AI matchmaking engine. Analyse each candidate investor and explain why this specific founder is a strong fit for them.

Founder: {user_context}

Investor candidates (JSON array):
{candidates_json}

For each candidate, return:
- score: 0–100 match score
- reasoning: 2–3 sentences (max 40 words) written TO the investor explaining why THIS founder is right for THEIR portfolio. Be specific — reference the founder's stage, sector, problem, and how it connects to the investor's known thesis or focus. Never be generic.

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
        "generationConfig": {"maxOutputTokens": 8192, "temperature": 0.2, "thinkingConfig": {"thinkingBudget": 0}}
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
    // Extract just the [...] block in case Gemini adds preamble/postamble text
    let json_str = if let (Some(start), Some(end)) = (clean.find('['), clean.rfind(']')) {
        &clean[start..=end]
    } else {
        clean
    };
    let ranked: Vec<Value> = serde_json::from_str(json_str).unwrap_or_default();

    // Only delete matches where no intro has been requested — preserve actioned rows
    sqlx::query("DELETE FROM kevin_matches WHERE for_user_id = $1 AND match_type = $2 AND intro_requested_at IS NULL")
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

    let rows = fetch_kevin_matches_for_user(&state, user.id, Some(match_type), match_limit).await?;
    Ok(Json(rows))
}

async fn request_intro(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
    Path(match_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let user = require_user(&state, bearer.token()).await?;
    if user.role.as_str() != "STARTUP" {
        return Err((StatusCode::FORBIDDEN, "founders only".to_string()));
    }

    // Load the match (must belong to this user)
    let row: Option<(
        Uuid,
        Option<Uuid>,
        Option<Uuid>,
        Option<chrono::DateTime<chrono::Utc>>,
        Option<String>,
    )> = sqlx::query_as(
        r#"SELECT id, contact_id, matched_user_id, intro_requested_at, reasoning
           FROM kevin_matches
           WHERE id = $1 AND for_user_id = $2"#,
    )
    .bind(match_id)
    .bind(user.id)
    .fetch_optional(&state.db)
    .await
    .map_err(internal)?;

    let (_id, contact_id, matched_user_id, intro_requested_at, reasoning_opt) =
        row.ok_or((StatusCode::NOT_FOUND, "match not found".to_string()))?;

    if intro_requested_at.is_some() {
        return Err((StatusCode::CONFLICT, "introduction already requested".to_string()));
    }

    let reasoning = reasoning_opt.unwrap_or_default();

    // Get founder details
    let founder_email: String = sqlx::query_scalar("SELECT email FROM users WHERE id = $1")
        .bind(user.id)
        .fetch_one(&state.db)
        .await
        .map_err(internal)?;

    let founder_profile: Option<(
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
    )> = sqlx::query_as(
        r#"SELECT p.company_name, p.one_liner, p.stage, p.sector,
            CASE WHEN u.is_basic = TRUE OR u.is_pro = TRUE OR p.deck_expires_at IS NULL OR p.deck_expires_at > NOW() THEN p.pitch_deck_url ELSE NULL END AS pitch_deck_url
           FROM profiles p
           JOIN users u ON u.id = p.user_id
           WHERE p.user_id = $1"#,
    )
    .bind(user.id)
    .fetch_optional(&state.db)
    .await
    .map_err(internal)?;

    let (fp_company, fp_one_liner, fp_stage, fp_sector, fp_deck_url) =
        founder_profile.unwrap_or((None, None, None, None, None));

    // Block intro request if founder profile is incomplete
    if fp_company.is_none() || fp_one_liner.is_none() || fp_stage.is_none() || fp_sector.is_none() {
        return Err((
            StatusCode::BAD_REQUEST,
            "Please complete your founder profile (company name, description, stage and sector) before requesting an introduction.".to_string(),
        ));
    }

    let company_name = fp_company.unwrap_or_else(|| "their company".to_string());
    let founder_one_liner = fp_one_liner.unwrap_or_default();
    let founder_stage = fp_stage.unwrap_or_default();
    let founder_sector = fp_sector.unwrap_or_default();
    let founder_deck_url = fp_deck_url
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    // Default investor_channels reflects what we dispatched to the investor.
    // For external-connector intros, the investor is reached via their connector (email).
    let mut investor_channels = String::from("email");
    let mut investor_display_name = String::from("the investor");

    // Founder channels are fetched once here so branches that self-handle
    // founder notifications (e.g. registered investor) can reference them.
    let founder_channels: Option<(Option<String>, Option<String>)> = sqlx::query_as(
        "SELECT telegram_id, whatsapp_number FROM users WHERE id = $1",
    )
    .bind(user.id)
    .fetch_optional(&state.db)
    .await
    .unwrap_or(None);

    // When a branch sends the founder-side confirmation + messaging itself,
    // set this flag so the shared tail code doesn't duplicate the sends.
    let mut founder_notified_in_branch = false;

    if let Some(contact_id) = contact_id {
        // Connector network contact
        let contact: Option<(String, Option<String>, Option<String>, Uuid)> = sqlx::query_as(
            r#"SELECT name, email, firm_or_company, connector_user_id
               FROM connector_network_contacts WHERE id = $1"#,
        )
        .bind(contact_id)
        .fetch_optional(&state.db)
        .await
        .map_err(internal)?;

        let (contact_name, contact_email, contact_firm, connector_user_id) =
            contact.ok_or((StatusCode::NOT_FOUND, "contact not found".to_string()))?;

        // Is this a metatron connect contact? Check connector user's email domain
        let connector_email: String = sqlx::query_scalar("SELECT email FROM users WHERE id = $1")
            .bind(connector_user_id)
            .fetch_one(&state.db)
            .await
            .map_err(internal)?;

        let is_metatron_connect = connector_email.ends_with("@metatrondao.io");

        let investor_name: String = contact_firm.clone().unwrap_or_else(|| contact_name.clone());
        investor_display_name = investor_name.clone();

        if is_metatron_connect {
            // Direct email to investor (test override via env var)
            let to_email = std::env::var("INTRO_TEST_EMAIL")
                .unwrap_or_else(|_| contact_email.clone().unwrap_or_default());

            let mut sent_email = false;
            let mut sent_telegram = false;
            let mut sent_whatsapp = false;

            // Look up investor's Telegram and WhatsApp via their email
            let investor_channels_row: Option<(Option<String>, Option<String>)> = if !to_email
                .trim()
                .is_empty()
            {
                sqlx::query_as(
                    "SELECT telegram_id, whatsapp_number FROM users WHERE LOWER(email) = LOWER($1)",
                )
                .bind(&to_email)
                .fetch_optional(&state.db)
                .await
                .unwrap_or(None)
            } else {
                None
            };

            let (investor_tg, investor_wa) =
                investor_channels_row.unwrap_or((None, None));

            // Send investor email using the new template — always include deck URL
            if !to_email.trim().is_empty() {
                let html = email::intro_investor_email_html(
                    &investor_name,
                    &company_name,
                    &founder_one_liner,
                    &founder_stage,
                    &founder_sector,
                    &reasoning,
                    founder_deck_url.as_deref(),
                );
                email::send_email(
                    &state.http_client,
                    state.resend_api_key.as_deref(),
                    &state.email_from,
                    &to_email,
                    &format!("Introduction request: {} → {}", company_name, investor_name),
                    &html,
                )
                .await;
                sent_email = true;
            }

            // Investor Telegram
            if let (Some(tg_id), Some(bot_token)) = (
                investor_tg.as_deref().filter(|s| !s.trim().is_empty()),
                state.telegram_bot_token.as_deref(),
            ) {
                let deck_line = founder_deck_url
                    .as_deref()
                    .map(|u| format!("\nDeck: {u}"))
                    .unwrap_or_default();
                let tg_text = format!(
                    "New intro request via metatron\n\n{} ({}) would like to connect.\nStage: {} · Sector: {}\n\nWhy Kevin matched you:\n{}{}\n\nReply via metatron or email {}.",
                    company_name,
                    founder_one_liner,
                    founder_stage,
                    founder_sector,
                    reasoning,
                    deck_line,
                    founder_email,
                );
                let tg_url = format!("https://api.telegram.org/bot{}/sendMessage", bot_token);
                let tg_payload = serde_json::json!({
                    "chat_id": tg_id,
                    "text": tg_text,
                });
                match state.http_client.post(&tg_url).json(&tg_payload).send().await {
                    Ok(resp) if resp.status().is_success() => {
                        sent_telegram = true;
                    }
                    Ok(resp) => {
                        tracing::warn!(
                            "investor telegram notification failed status={}",
                            resp.status()
                        );
                    }
                    Err(e) => {
                        tracing::warn!("investor telegram notification error: {e}");
                    }
                }
            }

            // Investor WhatsApp
            if let (Some(wa_number), Some(wa_token), Some(phone_id)) = (
                investor_wa.as_deref().filter(|s| !s.trim().is_empty()),
                state.whatsapp_access_token.as_deref(),
                state.whatsapp_phone_number_id.as_deref(),
            ) {
                let deck_line = founder_deck_url
                    .as_deref()
                    .map(|u| format!("\nDeck: {u}"))
                    .unwrap_or_default();
                let wa_text = format!(
                    "metatron intro request\n\n{} ({}) would like to connect.\nStage: {} · Sector: {}\n\nWhy Kevin matched you:\n{}{}\n\nReply via metatron or email {}.",
                    company_name,
                    founder_one_liner,
                    founder_stage,
                    founder_sector,
                    reasoning,
                    deck_line,
                    founder_email,
                );
                let wa_url = format!("https://graph.facebook.com/v18.0/{}/messages", phone_id);
                let wa_payload = serde_json::json!({
                    "messaging_product": "whatsapp",
                    "recipient_type": "individual",
                    "to": wa_number,
                    "type": "text",
                    "text": { "body": wa_text }
                });
                match state
                    .http_client
                    .post(&wa_url)
                    .bearer_auth(wa_token)
                    .json(&wa_payload)
                    .send()
                    .await
                {
                    Ok(resp) if resp.status().is_success() => {
                        sent_whatsapp = true;
                    }
                    Ok(resp) => {
                        tracing::warn!(
                            "investor whatsapp notification failed status={}",
                            resp.status()
                        );
                    }
                    Err(e) => {
                        tracing::warn!("investor whatsapp notification error: {e}");
                    }
                }
            }

            // Build human-readable channels string
            investor_channels = match (sent_email, sent_telegram, sent_whatsapp) {
                (true, true, true) => "email, Telegram and WhatsApp".to_string(),
                (true, true, false) => "email and Telegram".to_string(),
                (true, false, true) => "email and WhatsApp".to_string(),
                (false, true, true) => "Telegram and WhatsApp".to_string(),
                (true, false, false) => "email".to_string(),
                (false, true, false) => "Telegram".to_string(),
                (false, false, true) => "WhatsApp".to_string(),
                (false, false, false) => "metatron".to_string(),
            };
        } else {
            // Create connector_introduction record and notify connector
            let _ = sqlx::query(
                "INSERT INTO connector_introductions (connector_user_id, person_a_name, person_a_email, person_b_name, person_b_email, notes) \
                 VALUES ($1, $2, $3, $4, $5, $6)",
            )
            .bind(connector_user_id)
            .bind(&company_name)
            .bind(&founder_email)
            .bind(contact_firm.as_deref().unwrap_or(contact_name.as_str()))
            .bind(contact_email.as_deref().unwrap_or(""))
            .bind(format!(
                "Introduction requested via Kevin Matches. Founder: {} — {}\n\nKevin's reasoning:\n{}",
                company_name, founder_one_liner, reasoning
            ))
            .execute(&state.db)
            .await;

            // Notify the connector by email
            let resend_key = std::env::var("RESEND_API_KEY").unwrap_or_default();
            let notif = serde_json::json!({
                "from": "kevin@metatron.id",
                "to": [connector_email],
                "subject": format!("New intro request: {} → {}", company_name, investor_name),
                "html": format!(
                    "<p>A founder has requested an introduction via metatron.</p>\
                    <p><strong>Founder:</strong> {} ({})<br/><strong>Investor:</strong> {}</p>\
                    <p><strong>Why Kevin matched them:</strong><br/>{}</p>\
                    <p>Please facilitate this introduction via your connector dashboard.</p>",
                    company_name, founder_email, investor_name, reasoning
                )
            });
            if let Err(e) = state
                .http_client
                .post("https://api.resend.com/emails")
                .header("Authorization", format!("Bearer {}", resend_key))
                .json(&notif)
                .send()
                .await
            {
                tracing::warn!("connector notification email send failed: {e}");
            }

            // Investor is reached through their connector.
            investor_channels = "their connector".to_string();
        }
    } else if let Some(investor_user_id) = matched_user_id {
        // Registered platform investor — look up their details directly
        let investor_row: Option<(String, Option<String>, Option<String>)> = sqlx::query_as(
            "SELECT email, telegram_id, whatsapp_number FROM users WHERE id = $1",
        )
        .bind(investor_user_id)
        .fetch_optional(&state.db)
        .await
        .map_err(internal)?;

        if let Some((investor_email, investor_telegram_id, investor_whatsapp)) = investor_row {
            // Pull investor display name from investor_profiles
            let investor_name: String = sqlx::query_scalar::<_, Option<String>>(
                "SELECT firm_name FROM investor_profiles WHERE user_id = $1",
            )
            .bind(investor_user_id)
            .fetch_optional(&state.db)
            .await
            .map_err(internal)?
            .flatten()
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| investor_email.clone());

            let to_email = std::env::var("INTRO_TEST_EMAIL")
                .unwrap_or_else(|_| investor_email.clone());

            // Build investor_channels string
            let mut channels: Vec<&str> = vec!["email"];
            if investor_telegram_id.is_some() {
                channels.push("Telegram");
            }
            if investor_whatsapp.is_some() {
                channels.push("WhatsApp");
            }
            let investor_channels_local = match channels.as_slice() {
                [a] => a.to_string(),
                [a, b] => format!("{a} and {b}"),
                [a, b, c] => format!("{a}, {b} and {c}"),
                _ => "email".to_string(),
            };

            // Investor email
            let deck_url = founder_deck_url.as_deref();
            let reasoning_str: &str = if reasoning.trim().is_empty() {
                "Strong alignment between your investment thesis and this founder's profile."
            } else {
                reasoning.as_str()
            };
            email::send_email(
                &state.http_client,
                state.resend_api_key.as_deref(),
                &state.email_from,
                &to_email,
                &format!("{} — a founder Kevin thinks you should meet", company_name),
                &email::intro_investor_email_html(
                    &investor_name,
                    &company_name,
                    &founder_one_liner,
                    &founder_stage,
                    &founder_sector,
                    reasoning_str,
                    deck_url,
                ),
            )
            .await;

            // Investor Telegram — when INTRO_TEST_EMAIL is set, re-resolve to the
            // test recipient's Telegram instead of the real investor's.
            let effective_telegram = if std::env::var("INTRO_TEST_EMAIL").is_ok() {
                sqlx::query_scalar::<_, Option<String>>(
                    "SELECT telegram_id FROM users WHERE LOWER(email) = LOWER($1)",
                )
                .bind(&to_email)
                .fetch_optional(&state.db)
                .await
                .unwrap_or(None)
                .flatten()
            } else {
                investor_telegram_id.clone()
            };

            if let (Some(tg_id), Some(bot_token)) =
                (effective_telegram, state.telegram_bot_token.as_deref())
            {
                let tg_msg = format!(
                    "👋 {}, Kevin here.\n\nI've matched you with a founder I think you should meet.\n\nHere's why:\n{}\n\n🏢 {}\n💡 {}\n📍 Stage: {} · Sector: {}{}",
                    investor_name,
                    reasoning_str,
                    company_name,
                    founder_one_liner,
                    founder_stage,
                    founder_sector,
                    deck_url.map(|u| format!("\n📄 Deck: {}", u)).unwrap_or_default()
                );
                let _ = state
                    .http_client
                    .post(format!(
                        "https://api.telegram.org/bot{}/sendMessage",
                        bot_token
                    ))
                    .json(&serde_json::json!({ "chat_id": tg_id, "text": tg_msg }))
                    .send()
                    .await;
            }

            // Investor WhatsApp
            let effective_whatsapp = if std::env::var("INTRO_TEST_EMAIL").is_ok() {
                sqlx::query_scalar::<_, Option<String>>(
                    "SELECT whatsapp_number FROM users WHERE LOWER(email) = LOWER($1)",
                )
                .bind(&to_email)
                .fetch_optional(&state.db)
                .await
                .unwrap_or(None)
                .flatten()
            } else {
                investor_whatsapp
            };

            if let (Some(wa_number), Some(wa_token), Some(phone_id)) = (
                effective_whatsapp,
                state.whatsapp_access_token.as_deref(),
                state.whatsapp_phone_number_id.as_deref(),
            ) {
                let wa_msg = format!(
                    "👋 {}, Kevin here.\n\nI've matched you with a founder I think you should meet.\n\nHere's why:\n{}\n\n🏢 {}\n💡 {}\n📍 Stage: {} · Sector: {}{}",
                    investor_name,
                    reasoning_str,
                    company_name,
                    founder_one_liner,
                    founder_stage,
                    founder_sector,
                    deck_url.map(|u| format!("\n📄 Deck: {}", u)).unwrap_or_default()
                );
                let _ = state
                    .http_client
                    .post(format!(
                        "https://graph.facebook.com/v18.0/{}/messages",
                        phone_id
                    ))
                    .bearer_auth(wa_token)
                    .json(&serde_json::json!({
                        "messaging_product": "whatsapp",
                        "recipient_type": "individual",
                        "to": wa_number,
                        "type": "text",
                        "text": { "body": wa_msg }
                    }))
                    .send()
                    .await;
            }

            // Founder confirmation — same as metatron connect path
            email::send_email(
                &state.http_client,
                state.resend_api_key.as_deref(),
                &state.email_from,
                &founder_email,
                &format!("Kevin has introduced you to {}", investor_name),
                &email::intro_founder_confirmation_html(
                    &investor_name,
                    &company_name,
                    reasoning_str,
                    &investor_channels_local,
                ),
            )
            .await;

            // Founder Telegram
            if let Some((founder_tg, _)) = founder_channels.as_ref() {
                if let (Some(tg_id), Some(bot_token)) =
                    (founder_tg.as_deref(), state.telegram_bot_token.as_deref())
                {
                    let msg = format!(
                        "✅ Done! I've introduced you to {}.\n\nHere's what I told them:\n{}\n\nThey've been notified via {} and will reach out if interested. Keep building! 🚀",
                        investor_name, reasoning_str, investor_channels_local
                    );
                    let _ = state
                        .http_client
                        .post(format!(
                            "https://api.telegram.org/bot{}/sendMessage",
                            bot_token
                        ))
                        .json(&serde_json::json!({ "chat_id": tg_id, "text": msg }))
                        .send()
                        .await;
                }
            }

            // Propagate for completeness (so subsequent reads reflect reality),
            // then mark the founder-side as handled so tail code skips duplicates.
            investor_display_name = investor_name;
            investor_channels = investor_channels_local;
            founder_notified_in_branch = true;
        }
    }

    // Mark intro as requested
    sqlx::query("UPDATE kevin_matches SET intro_requested_at = NOW() WHERE id = $1")
        .bind(match_id)
        .execute(&state.db)
        .await
        .map_err(internal)?;

    if !founder_notified_in_branch {
        // Email confirmation to founder — includes reasoning and channels used
        let confirmation_html = email::intro_founder_confirmation_html(
            &investor_display_name,
            &company_name,
            &reasoning,
            &investor_channels,
        );
        email::send_email(
            &state.http_client,
            state.resend_api_key.as_deref(),
            &state.email_from,
            &founder_email,
            &format!("Intro request sent — {}", company_name),
            &confirmation_html,
        )
        .await;

        let kevin_msg = format!(
            "Your intro request for {} has been submitted via {}.\n\nWhy Kevin matched you:\n{}\n\nI'll let you know when they respond. Keep building!",
            company_name, investor_channels, reasoning
        );

        if let Some((telegram_id, whatsapp_number)) = founder_channels {
            // Telegram notification
            if let (Some(tg_id), Some(bot_token)) =
                (telegram_id, state.telegram_bot_token.as_deref())
            {
                let tg_url = format!("https://api.telegram.org/bot{}/sendMessage", bot_token);
                let tg_payload = serde_json::json!({
                    "chat_id": tg_id,
                    "text": kevin_msg,
                });
                if let Err(e) = state
                    .http_client
                    .post(&tg_url)
                    .json(&tg_payload)
                    .send()
                    .await
                {
                    tracing::warn!("founder telegram notification failed: {e}");
                }
            }

            // WhatsApp notification
            if let (Some(wa_number), Some(wa_token), Some(phone_id)) = (
                whatsapp_number,
                state.whatsapp_access_token.as_deref(),
                state.whatsapp_phone_number_id.as_deref(),
            ) {
                let wa_url = format!("https://graph.facebook.com/v18.0/{}/messages", phone_id);
                let wa_payload = serde_json::json!({
                    "messaging_product": "whatsapp",
                    "recipient_type": "individual",
                    "to": wa_number,
                    "type": "text",
                    "text": { "body": kevin_msg }
                });
                if let Err(e) = state
                    .http_client
                    .post(&wa_url)
                    .bearer_auth(wa_token)
                    .json(&wa_payload)
                    .send()
                    .await
                {
                    tracing::warn!("founder whatsapp notification failed: {e}");
                }
            }
        }
    }

    Ok(Json(serde_json::json!({"ok": true})))
}

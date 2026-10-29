//! Founder readiness: where a founder stands on the way to funding, from
//! Build to Growth, as Kevin assessed it in chat; plus the programmes list he
//! recommends from. The list grows on its own: Kevin's web search adds
//! programmes as unverified, founders report the ones they did, connectors
//! add theirs. A programme is verified once enough founders report doing it,
//! or a connector adds it; nobody has to review it.

use std::sync::Arc;

use axum::{extract::State, http::StatusCode, routing::get, Json, Router};
use axum_extra::{
    headers::{authorization::Bearer, Authorization},
    TypedHeader,
};
use serde::Serialize;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::identity::require_user;
use crate::state::AppState;

pub(crate) const STAGES: &[(&str, &str)] = &[
    ("build", "Build"),
    ("accelerator", "Accelerator"),
    ("angels", "Angels"),
    ("seed", "Seed"),
    ("series_a", "Series A"),
    ("series_b", "Series B+"),
    ("growth", "Growth"),
];
const KINDS: &[&str] = &["incubator", "accelerator", "bootcamp", "scaleup", "other"];
/// Founders who must report doing a programme before it counts as verified.
const VERIFY_REPORTS: i64 = 2;
/// Fewer programmes than this on file for a founder: search the web for more.
const MIN_PROGRAMMES: usize = 3;

pub fn router() -> Router<Arc<AppState>> {
    Router::new().route("/", get(get_own))
}

fn stage_index(stage: &str) -> Option<usize> {
    STAGES.iter().position(|(k, _)| *k == stage)
}

pub(crate) fn stage_label(stage: &str) -> &'static str {
    stage_index(stage).map(|i| STAGES[i].1).unwrap_or("Unknown")
}

fn stage_keys() -> Vec<&'static str> {
    STAGES.iter().map(|(k, _)| *k).collect()
}

async fn is_paid(state: &AppState, user_id: Uuid) -> bool {
    sqlx::query_scalar("SELECT COALESCE(is_basic, false) OR COALESCE(is_pro, false) FROM users WHERE id = $1")
        .bind(user_id)
        .fetch_one(&state.db)
        .await
        .unwrap_or(false)
}

// ---------------------------------------------------------------------------
// Kevin's tools
// ---------------------------------------------------------------------------

const SAVE_DESCRIPTION: &str = "Save where this founder stands on the way to funding, once you've assessed it. Stages: build (idea or prototype, no real users yet: an incubator or bootcamp first), accelerator (working product, first users or customers, team in place: ready for accelerators), angels (early revenue or strong traction: angels and pre-seed funds), seed (repeatable growth in a clear market: seed funds), series_a (product-market fit, repeatable sales, roughly $1-3M a year in recurring revenue in the US or Europe and less in emerging markets: VCs that lead Series A rounds), series_b (strong growth, improving unit economics, a management team: growth VCs, venture debt, strategic investors), growth (scale and a path to profit: growth funds, private equity, secondary sales). Judge against their sector and country, not Silicon Valley norms.";

const FIND_DESCRIPTION: &str = "Find incubators, accelerators, bootcamps or scale-up programmes for this founder's stage, sector and country. Checks metatron's list first and searches the web when it's short. Tell the user which are verified (founders on metatron did them) and which were found online and aren't verified yet.";

const RECORD_DESCRIPTION: &str = "Save a programme (incubator, accelerator, bootcamp or scale-up programme) the user did, runs or recommends, so Kevin can recommend it to other founders. Call it whenever they mention one by name, with whether it helped if they said.";

fn save_properties() -> Value {
    json!({
        "stage": { "type": "string", "enum": stage_keys(), "description": "Where they are now." },
        "summary": { "type": "string", "description": "One or two sentences to the founder on why they're at this stage." },
        "gaps": { "type": "array", "items": { "type": "string" }, "description": "Up to 3 things missing to reach the next stage, each a short line." },
        "next_steps": { "type": "array", "items": { "type": "string" }, "description": "Up to 3 concrete next steps, each a short line." }
    })
}

fn find_properties() -> Value {
    json!({
        "stage": { "type": "string", "enum": stage_keys(), "description": "Defaults to their saved stage." },
        "sector": { "type": "string", "description": "Defaults to their profile." },
        "country": { "type": "string", "description": "Defaults to their profile." }
    })
}

fn record_properties() -> Value {
    json!({
        "name": { "type": "string", "description": "The programme's name." },
        "url": { "type": "string", "description": "Its website, if known." },
        "kind": { "type": "string", "enum": KINDS },
        "location": { "type": "string", "description": "City or country, or Remote." },
        "stages": { "type": "array", "items": { "type": "string", "enum": stage_keys() }, "description": "Stages it suits, if known." },
        "sectors": { "type": "array", "items": { "type": "string" }, "description": "Sectors it focuses on, if any." },
        "did_it": { "type": "boolean", "description": "True if the user took part in it." },
        "helpful": { "type": "boolean", "description": "Whether they said it helped, if they did." },
        "detail": { "type": "string", "description": "One sentence with what the user said about it." }
    })
}

/// (name, description, properties, required) for the tools this role gets.
fn tool_specs(role: &str) -> Vec<(&'static str, &'static str, Value, Vec<&'static str>)> {
    let mut specs = Vec::new();
    if role == "STARTUP" {
        specs.push(("save_readiness", SAVE_DESCRIPTION, save_properties(), vec!["stage", "summary"]));
        specs.push(("find_programmes", FIND_DESCRIPTION, find_properties(), vec![]));
    }
    specs.push(("record_programme", RECORD_DESCRIPTION, record_properties(), vec!["name", "detail"]));
    specs
}

fn schema(properties: Value, required: Vec<&str>) -> Value {
    let mut s = json!({ "type": "object", "properties": properties });
    if !required.is_empty() {
        s["required"] = json!(required);
    }
    s
}

pub(crate) fn tools_for_anthropic(role: &str) -> Vec<Value> {
    tool_specs(role)
        .into_iter()
        .map(|(name, description, properties, required)| {
            json!({
                "name": name,
                "description": description,
                "input_schema": schema(properties, required)
            })
        })
        .collect()
}

pub(crate) fn tools_for_gemini(role: &str) -> Vec<Value> {
    tool_specs(role)
        .into_iter()
        .map(|(name, description, properties, required)| {
            json!({
                "name": name,
                "description": description,
                "parameters": schema(properties, required)
            })
        })
        .collect()
}

/// Just record_programme, for the WhatsApp/Telegram feedback extractor.
pub(crate) fn record_programme_tool_for_gemini() -> Value {
    json!({
        "name": "record_programme",
        "description": RECORD_DESCRIPTION,
        "parameters": { "type": "object", "properties": record_properties(), "required": ["name", "detail"] }
    })
}

/// Runs one of this module's tools; None when the name isn't one of them.
pub(crate) async fn execute(state: &AppState, user_id: Uuid, role: &str, tool_name: &str, input: &Value) -> Option<String> {
    Some(match tool_name {
        "save_readiness" if role == "STARTUP" => save(state, user_id, input).await,
        "find_programmes" if role == "STARTUP" => find(state, user_id, input).await,
        "record_programme" => record_programme(state, user_id, role, input).await,
        "save_readiness" | "find_programmes" => "That's only for founders.".to_string(),
        _ => return None,
    })
}

fn string_list(input: &Value, field: &str) -> Vec<String> {
    input[field]
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter_map(|v| v.as_str())
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .take(3)
                .collect()
        })
        .unwrap_or_default()
}

async fn save(state: &AppState, user_id: Uuid, input: &Value) -> String {
    let stage = input["stage"].as_str().unwrap_or("").trim();
    if stage_index(stage).is_none() {
        return format!("Not saved: stage must be one of {}.", stage_keys().join(", "));
    }
    let summary = input["summary"].as_str().unwrap_or("").trim();
    if summary.is_empty() {
        return "Not saved: summary is empty.".to_string();
    }
    let gaps = string_list(input, "gaps");
    let next_steps = string_list(input, "next_steps");

    let saved = sqlx::query(
        r#"INSERT INTO founder_readiness (user_id, stage, summary, gaps, next_steps)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (user_id) DO UPDATE SET stage = EXCLUDED.stage, summary = EXCLUDED.summary,
               gaps = EXCLUDED.gaps, next_steps = EXCLUDED.next_steps, assessed_at = now()"#,
    )
    .bind(user_id)
    .bind(stage)
    .bind(summary)
    .bind(&gaps)
    .bind(&next_steps)
    .execute(&state.db)
    .await;
    if let Err(e) = saved {
        tracing::error!("save_readiness failed: {e}");
        return "Not saved: database error.".to_string();
    }

    if is_paid(state, user_id).await {
        "Saved. It's on their dashboard too. Tell them their stage and why, what's missing for the next one, and the next steps.".to_string()
    } else {
        "Saved. This user is on Free: tell them their stage and why in one or two lines only. What's missing for the next stage and the programmes for them come with Basic or Pro; say so in one line.".to_string()
    }
}

/// The founder's sector and country from their profile.
async fn profile_sector_country(state: &AppState, user_id: Uuid) -> (Option<String>, Option<String>) {
    sqlx::query_as("SELECT sector, country FROM profiles WHERE user_id = $1")
        .bind(user_id)
        .fetch_optional(&state.db)
        .await
        .ok()
        .flatten()
        .unwrap_or((None, None))
}

async fn saved_stage(state: &AppState, user_id: Uuid) -> Option<String> {
    sqlx::query_scalar("SELECT stage FROM founder_readiness WHERE user_id = $1")
        .bind(user_id)
        .fetch_optional(&state.db)
        .await
        .ok()
        .flatten()
}

#[derive(Serialize, sqlx::FromRow)]
pub struct Programme {
    pub name: String,
    pub url: Option<String>,
    pub kind: String,
    pub location: Option<String>,
    pub summary: Option<String>,
    pub verified: bool,
    #[serde(skip)]
    pub reports: i64,
    #[serde(skip)]
    pub helpful: i64,
}

/// Programmes on file for a stage, sector and country: verified first.
async fn programmes_for(
    state: &AppState,
    stage: &str,
    sector: Option<&str>,
    country: Option<&str>,
    limit: i64,
) -> Vec<Programme> {
    sqlx::query_as(
        r#"SELECT p.name, p.url, p.kind, p.location, p.summary,
                  p.status = 'verified' AS verified,
                  COUNT(r.id) AS reports,
                  COUNT(r.id) FILTER (WHERE r.helpful) AS helpful
             FROM programmes p
             LEFT JOIN programme_reports r ON r.programme_id = p.id
            WHERE p.status <> 'removed'
              AND (p.stages = '{}' OR $1 = ANY(p.stages))
              AND (p.sectors = '{}' OR $2::text IS NULL OR EXISTS (
                     SELECT 1 FROM unnest(p.sectors) s, unnest(string_to_array($2, ',')) f
                      WHERE LOWER(TRIM(s)) = LOWER(TRIM(f))))
              AND ($3::text IS NULL OR p.location IS NULL
                   OR p.location ILIKE '%' || $3 || '%'
                   OR p.location ~* '(remote|online|global|worldwide)')
            GROUP BY p.id
            ORDER BY (p.status = 'verified') DESC, COUNT(r.id) FILTER (WHERE r.helpful) DESC,
                     (p.location ILIKE '%' || COALESCE($3, '') || '%') DESC, p.created_at DESC
            LIMIT $4"#,
    )
    .bind(stage)
    .bind(sector)
    .bind(country)
    .bind(limit)
    .fetch_all(&state.db)
    .await
    .unwrap_or_else(|e| {
        tracing::warn!("programmes query failed: {e}");
        Vec::new()
    })
}

async fn find(state: &AppState, user_id: Uuid, input: &Value) -> String {
    if !is_paid(state, user_id).await {
        return "Programme recommendations come with Basic or Pro. Tell the user in one line; they can upgrade from the Upgrade button.".to_string();
    }
    let given = |field: &str| input[field].as_str().map(str::trim).filter(|s| !s.is_empty()).map(str::to_string);
    let (profile_sector, profile_country) = profile_sector_country(state, user_id).await;
    let stage = match given("stage").filter(|s| stage_index(s).is_some()) {
        Some(s) => s,
        None => match saved_stage(state, user_id).await {
            Some(s) => s,
            None => return "No stage yet: assess it and call save_readiness first, or pass a stage.".to_string(),
        },
    };
    let sector = given("sector").or(profile_sector);
    let country = given("country").or(profile_country);

    let mut found = programmes_for(state, &stage, sector.as_deref(), country.as_deref(), 6).await;
    if found.len() < MIN_PROGRAMMES {
        search_web(state, user_id, &stage, sector.as_deref(), country.as_deref()).await;
        found = programmes_for(state, &stage, sector.as_deref(), country.as_deref(), 6).await;
    }
    if found.is_empty() {
        return "No programmes found for this stage, sector and country. Say so honestly; don't invent any.".to_string();
    }

    let lines: Vec<String> = found
        .into_iter()
        .map(|p| {
            let mut line = format!("- {} ({}", p.name, p.kind);
            if let Some(l) = &p.location {
                line.push_str(&format!(", {l}"));
            }
            line.push(')');
            if let Some(u) = &p.url {
                line.push_str(&format!(" {u}"));
            }
            if let Some(s) = &p.summary {
                line.push_str(&format!(": {s}"));
            }
            if p.verified {
                line.push_str(&format!(
                    " [verified: {} founder(s) on metatron did it, {} found it helpful]",
                    p.reports, p.helpful
                ));
            } else {
                line.push_str(" [found online, not verified]");
            }
            line
        })
        .collect();
    format!(
        "Programmes for the {} stage (don't add any that aren't here):\n{}",
        stage_label(&stage),
        lines.join("\n")
    )
}

/// Asks Gemini with Google Search for real programmes and adds the new ones
/// to the list as unverified.
async fn search_web(state: &AppState, user_id: Uuid, stage: &str, sector: Option<&str>, country: Option<&str>) {
    let Some(api_key) = state.ai_api_key.as_deref() else { return };
    let model = "gemini-2.5-flash";
    let sector = sector.unwrap_or("technology");
    let country = country.unwrap_or("any country");
    let kind_hint = match stage {
        "build" => "incubators, pre-incubators and founder bootcamps",
        "accelerator" | "angels" => "accelerators",
        "seed" => "accelerators and seed programmes",
        _ => "scale-up programmes for growth-stage companies",
    };
    let prompt = format!(
        "Find up to 5 real {kind_hint} that a {sector} startup based in {country} at the {} stage could join now. Prefer ones in or open to {country}, then remote or global ones. Only include programmes you found in the search results, with their official website.\n\nReturn ONLY a JSON array, no other text:\n[{{\"name\":\"...\",\"url\":\"https://...\",\"kind\":\"incubator|accelerator|bootcamp|scaleup|other\",\"location\":\"city or country, or Remote\",\"stages\":[\"{}\"],\"sectors\":[\"...\"],\"summary\":\"one sentence\"}}]\nFor stages use only: {}. Leave sectors empty if it takes any sector.",
        stage_label(stage),
        stage,
        stage_keys().join(", ")
    );
    let body = json!({
        "contents": [{ "role": "user", "parts": [{ "text": prompt }] }],
        "tools": [{ "google_search": {} }],
        "generationConfig": { "temperature": 0.2 }
    });
    let url = format!("https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent");
    let response = match state.http_client.post(&url).query(&[("key", api_key)]).json(&body).send().await {
        Ok(r) => r,
        Err(e) => {
            tracing::warn!("programme search request failed: {e}");
            return;
        }
    };
    let status = response.status();
    let value: Value = match response.json().await {
        Ok(v) => v,
        Err(e) => {
            tracing::warn!("programme search json parse failed: {e}");
            return;
        }
    };
    if !status.is_success() {
        crate::alerts::check_provider_error("gemini", status.as_u16(), &value.to_string());
        tracing::warn!("programme search error {status}: {value}");
        return;
    }
    crate::cost::record_llm_usage(
        &state.db,
        Some(user_id),
        Some("STARTUP"),
        None,
        "programme_search",
        "gemini",
        model,
        value["usageMetadata"]["promptTokenCount"].as_i64().unwrap_or(0) as i32,
        value["usageMetadata"]["candidatesTokenCount"].as_i64().unwrap_or(0) as i32,
    )
    .await;

    let text: String = value["candidates"][0]["content"]["parts"]
        .as_array()
        .map(|parts| parts.iter().filter_map(|p| p["text"].as_str()).collect())
        .unwrap_or_default();
    let json_str = match (text.find('['), text.rfind(']')) {
        (Some(start), Some(end)) if end > start => &text[start..=end],
        _ => {
            tracing::warn!("programme search: no JSON array in reply");
            return;
        }
    };
    let items: Vec<Value> = serde_json::from_str(json_str).unwrap_or_default();
    for item in items.iter().take(5) {
        let name = item["name"].as_str().unwrap_or("").trim();
        let url = item["url"].as_str().map(str::trim).filter(|u| u.starts_with("http"));
        if name.is_empty() || url.is_none() {
            continue;
        }
        let kind = item["kind"].as_str().filter(|k| KINDS.contains(k)).unwrap_or("other");
        let stages: Vec<String> = item["stages"]
            .as_array()
            .map(|a| a.iter().filter_map(|v| v.as_str()).filter(|s| stage_index(s).is_some()).map(str::to_string).collect())
            .unwrap_or_default();
        let sectors: Vec<String> = item["sectors"]
            .as_array()
            .map(|a| a.iter().filter_map(|v| v.as_str()).map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect())
            .unwrap_or_default();
        let _ = sqlx::query(
            r#"INSERT INTO programmes (name, url, kind, location, stages, sectors, summary, source, added_by)
               VALUES ($1, $2, $3, $4, $5, $6, $7, 'search', $8)
               ON CONFLICT ((LOWER(name))) DO NOTHING"#,
        )
        .bind(name)
        .bind(url)
        .bind(kind)
        .bind(item["location"].as_str().map(str::trim).filter(|s| !s.is_empty()))
        .bind(&stages)
        .bind(&sectors)
        .bind(item["summary"].as_str().map(str::trim).filter(|s| !s.is_empty()))
        .bind(user_id)
        .execute(&state.db)
        .await;
    }
}

pub(crate) async fn record_programme(state: &AppState, user_id: Uuid, role: &str, input: &Value) -> String {
    let name = input["name"].as_str().unwrap_or("").trim();
    if name.is_empty() {
        return "Not saved: name is empty.".to_string();
    }
    let detail = input["detail"].as_str().unwrap_or("").trim();
    if detail.is_empty() {
        return "Not saved: detail is empty.".to_string();
    }
    let opt = |field: &str| input[field].as_str().map(str::trim).filter(|s| !s.is_empty()).map(str::to_string);
    let kind = opt("kind").filter(|k| KINDS.contains(&k.as_str())).unwrap_or_else(|| "other".to_string());
    let stages: Vec<String> = string_list(input, "stages").into_iter().filter(|s| stage_index(s).is_some()).collect();
    let sectors = string_list(input, "sectors");
    let source = if role == "CONNECTOR" { "connector" } else { "founder" };

    let row: Result<(Uuid, String), _> = sqlx::query_as(
        r#"INSERT INTO programmes (name, url, kind, location, stages, sectors, source, added_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT ((LOWER(name))) DO UPDATE SET
               url = COALESCE(programmes.url, EXCLUDED.url),
               kind = CASE WHEN programmes.kind = 'other' THEN EXCLUDED.kind ELSE programmes.kind END,
               location = COALESCE(programmes.location, EXCLUDED.location),
               stages = CASE WHEN programmes.stages = '{}' THEN EXCLUDED.stages ELSE programmes.stages END,
               sectors = CASE WHEN programmes.sectors = '{}' THEN EXCLUDED.sectors ELSE programmes.sectors END,
               updated_at = now()
           RETURNING id, status"#,
    )
    .bind(name)
    .bind(opt("url").filter(|u| u.starts_with("http")))
    .bind(&kind)
    .bind(opt("location"))
    .bind(&stages)
    .bind(&sectors)
    .bind(source)
    .bind(user_id)
    .fetch_one(&state.db)
    .await;
    let (programme_id, status) = match row {
        Ok(r) => r,
        Err(e) => {
            tracing::error!("record_programme failed: {e}");
            return "Not saved: database error.".to_string();
        }
    };
    if status == "removed" {
        return "Saved.".to_string();
    }

    if role == "STARTUP" && input["did_it"].as_bool().unwrap_or(false) {
        let _ = sqlx::query(
            r#"INSERT INTO programme_reports (programme_id, user_id, helpful, detail)
               VALUES ($1, $2, $3, $4)
               ON CONFLICT (programme_id, user_id) DO UPDATE SET
                   helpful = COALESCE(EXCLUDED.helpful, programme_reports.helpful),
                   detail = EXCLUDED.detail"#,
        )
        .bind(programme_id)
        .bind(user_id)
        .bind(input["helpful"].as_bool())
        .bind(detail)
        .execute(&state.db)
        .await;
    }

    // Verified once a connector vouches for it or enough founders did it.
    let _ = sqlx::query(
        r#"UPDATE programmes SET status = 'verified', updated_at = now()
            WHERE id = $1 AND status = 'unverified'
              AND ($2 OR (SELECT COUNT(*) FROM programme_reports WHERE programme_id = $1) >= $3)"#,
    )
    .bind(programme_id)
    .bind(role == "CONNECTOR")
    .bind(VERIFY_REPORTS)
    .execute(&state.db)
    .await;

    "Saved.".to_string()
}

// ---------------------------------------------------------------------------
// Context for Kevin and matching
// ---------------------------------------------------------------------------

#[derive(sqlx::FromRow)]
struct Readiness {
    stage: String,
    summary: String,
    gaps: Vec<String>,
    next_steps: Vec<String>,
    assessed_at: chrono::DateTime<chrono::Utc>,
}

async fn load(state: &AppState, user_id: Uuid) -> Option<Readiness> {
    sqlx::query_as("SELECT stage, summary, gaps, next_steps, assessed_at FROM founder_readiness WHERE user_id = $1")
        .bind(user_id)
        .fetch_optional(&state.db)
        .await
        .ok()
        .flatten()
}

/// The founder's readiness for Kevin's context, on every channel.
pub(crate) async fn context_section(state: &AppState, user_id: Uuid) -> String {
    let Some(r) = load(state, user_id).await else {
        return "\nReadiness: not assessed yet. If they ask whether they're ready for investors, what to do next, or which programmes or investors suit them, assess it.".to_string();
    };
    let paid = is_paid(state, user_id).await;
    let mut s = format!(
        "\nReadiness (Kevin's assessment, {}): {} stage. {}",
        r.assessed_at.format("%Y-%m-%d"),
        stage_label(&r.stage),
        r.summary
    );
    if paid {
        if !r.gaps.is_empty() {
            s.push_str(&format!("\n  Missing for the next stage: {}", r.gaps.join("; ")));
        }
        if !r.next_steps.is_empty() {
            s.push_str(&format!("\n  Next steps: {}", r.next_steps.join("; ")));
        }
    } else {
        s.push_str("\n  (What's missing and the programmes for them are Basic/Pro; on Free give only the stage and why.)");
    }
    s.push_str("\n  Reassess with save_readiness when what they tell you changes the picture, or it's over 60 days old.");
    s
}

/// The founder's stage for the match-ranking prompt; empty if not assessed.
pub(crate) async fn matching_line(state: &AppState, user_id: Uuid) -> String {
    let Some(r) = load(state, user_id).await else { return String::new() };
    let later = stage_index(&r.stage).is_some_and(|i| i >= 4);
    format!(
        "\nKevin's readiness assessment: {} stage. Score investors who invest at this stage highest. Investors who only invest at much later stages should score 30 or lower{}.",
        stage_label(&r.stage),
        if later { ", and so should angels and pre-seed funds" } else { "" }
    )
}

/// True when the founder was assessed since their matches were last generated.
pub(crate) async fn assessed_since_last_matches(state: &AppState, user_id: Uuid) -> bool {
    sqlx::query_scalar(
        r#"SELECT EXISTS(
               SELECT 1 FROM founder_readiness
                WHERE user_id = $1
                  AND assessed_at > COALESCE(
                      (SELECT MAX(generated_at) FROM kevin_matches WHERE for_user_id = $1),
                      '-infinity'::timestamptz))"#,
    )
    .bind(user_id)
    .fetch_one(&state.db)
    .await
    .unwrap_or(false)
}

// ---------------------------------------------------------------------------
// Dashboard card
// ---------------------------------------------------------------------------

#[derive(Serialize)]
pub struct OwnReadiness {
    stage: String,
    label: &'static str,
    previous: Option<&'static str>,
    next: Option<&'static str>,
    summary: String,
    /// None on Free: what's missing, the steps and programmes are Basic/Pro.
    gaps: Option<Vec<String>>,
    next_steps: Option<Vec<String>>,
    programmes: Option<Vec<Programme>>,
    assessed_at: chrono::DateTime<chrono::Utc>,
}

async fn get_own(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
) -> Result<Json<Option<OwnReadiness>>, (StatusCode, String)> {
    let user = require_user(&state, bearer.token()).await?;
    let Some(r) = load(&state, user.id).await else { return Ok(Json(None)) };
    let i = stage_index(&r.stage).unwrap_or(0);
    let paid = is_paid(&state, user.id).await;
    let programmes = if paid {
        let (sector, country) = profile_sector_country(&state, user.id).await;
        Some(programmes_for(&state, &r.stage, sector.as_deref(), country.as_deref(), 3).await)
    } else {
        None
    };
    Ok(Json(Some(OwnReadiness {
        label: stage_label(&r.stage),
        previous: i.checked_sub(1).map(|p| STAGES[p].1),
        next: STAGES.get(i + 1).map(|(_, l)| *l),
        summary: r.summary,
        gaps: paid.then_some(r.gaps),
        next_steps: paid.then_some(r.next_steps),
        programmes,
        assessed_at: r.assessed_at,
        stage: r.stage,
    })))
}

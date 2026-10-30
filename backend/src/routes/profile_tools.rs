//! Kevin's tools for changing what's on the user's account from any channel
//! (web chat, WhatsApp, Telegram, email, or an AI app connected over MCP):
//! the startup profile and pitch, the investor profile, and answering intro
//! requests. Only the fields the user gives are changed.

use serde_json::{json, Value};
use uuid::Uuid;

use crate::state::AppState;

/// Startup stages, as the platform's Startup Profile offers them.
const STARTUP_STAGES: &[&str] = &["idea", "pre-seed", "seed", "series-a", "series-b", "series-c", "growth", "profitable"];

const PITCH_FIELDS: &[(&str, &str)] = &[
    ("description", "What the company does (the overview)"),
    ("problem", "The problem it solves"),
    ("solution", "How it solves it"),
    ("market_size", "The market and its size"),
    ("business_model", "How it makes money"),
    ("traction", "Users, revenue, growth and other traction"),
    ("funding_ask", "How much they're raising and on what terms"),
    ("use_of_funds", "What the money will be spent on"),
    ("incorporation_country", "Where the company is incorporated"),
];

/// (name, description, properties, required) for the tools this role gets.
fn tool_specs(role: &str) -> Vec<(&'static str, &'static str, Value, Vec<&'static str>)> {
    let mut specs = Vec::new();
    if role == "STARTUP" {
        specs.push((
            "update_startup_profile",
            "Save changes to the founder's startup profile on metatron when they tell you new or corrected details. Only pass the fields they gave; the rest stay as they are.",
            json!({
                "company_name": { "type": "string" },
                "one_liner": { "type": "string", "description": "One sentence on what the company does" },
                "stage": { "type": "string", "enum": STARTUP_STAGES },
                "sector": { "type": "string", "description": "Comma-separated, e.g. \"FinTech, AI\"" },
                "country": { "type": "string", "description": "Where the company is based: country name or 2-letter code" },
                "website": { "type": "string" }
            }),
            vec![],
        ));
        let mut pitch = serde_json::Map::new();
        for (field, desc) in PITCH_FIELDS {
            pitch.insert(field.to_string(), json!({ "type": "string", "description": desc }));
        }
        pitch.insert("team_size".into(), json!({ "type": "integer", "description": "People working on it" }));
        specs.push((
            "update_pitch",
            "Save the founder's pitch sections on metatron (overview, problem, solution, market, business model, traction, funding ask, use of funds, team size). Write each in their words, as full sentences. Only pass the sections they gave; the rest stay as they are.",
            Value::Object(pitch),
            vec![],
        ));
    }
    if role == "INVESTOR" {
        specs.push((
            "update_investor_profile",
            "Save changes to the investor's profile on metatron when they tell you new or corrected details. Only pass the fields they gave; the rest stay as they are.",
            json!({
                "firm_name": { "type": "string" },
                "bio": { "type": "string" },
                "investment_thesis": { "type": "string" },
                "sectors": { "type": "array", "items": { "type": "string" } },
                "stages": { "type": "array", "items": { "type": "string" } },
                "ticket_size_min": { "type": "integer", "description": "In US dollars" },
                "ticket_size_max": { "type": "integer", "description": "In US dollars" },
                "country": { "type": "string" },
                "website": { "type": "string" }
            }),
            vec![],
        ));
    }
    specs.push((
        "answer_intro_request",
        "Accept or pass on an intro request someone sent this user, once the user has said which. Use the match_id from the intro requests waiting for them. Accepting shares contact details between the two; passing sends the requester a polite note.",
        json!({
            "match_id": { "type": "string", "description": "From the intro requests waiting for the user" },
            "accept": { "type": "boolean", "description": "true to accept, false to pass" }
        }),
        vec!["match_id", "accept"],
    ));
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
            json!({ "name": name, "description": description, "input_schema": schema(properties, required) })
        })
        .collect()
}

pub(crate) fn tools_for_gemini(role: &str) -> Vec<Value> {
    tool_specs(role)
        .into_iter()
        .map(|(name, description, properties, required)| {
            json!({ "name": name, "description": description, "parameters": schema(properties, required) })
        })
        .collect()
}

/// Runs one of this module's tools; None when the name isn't one of them.
pub(crate) async fn execute(state: &AppState, user_id: Uuid, role: &str, tool_name: &str, input: &Value) -> Option<String> {
    Some(match tool_name {
        "update_startup_profile" if role == "STARTUP" => update_startup_profile(state, user_id, input).await,
        "update_pitch" if role == "STARTUP" => update_pitch(state, user_id, input).await,
        "update_investor_profile" if role == "INVESTOR" => update_investor_profile(state, user_id, input).await,
        "answer_intro_request" => answer_intro_request(state, user_id, input).await,
        "update_startup_profile" | "update_pitch" | "update_investor_profile" => {
            "That's not available for this account's role.".to_string()
        }
        _ => return None,
    })
}

fn text(input: &Value, field: &str) -> Option<String> {
    input[field].as_str().map(str::trim).filter(|s| !s.is_empty()).map(str::to_string)
}

fn saved(fields: &[&str]) -> String {
    if fields.is_empty() {
        "Nothing saved: no fields were given.".to_string()
    } else {
        format!("Saved: {}.", fields.join(", "))
    }
}

async fn update_startup_profile(state: &AppState, user_id: Uuid, input: &Value) -> String {
    let stage = text(input, "stage").map(|s| s.to_lowercase());
    if let Some(s) = stage.as_deref() {
        if !STARTUP_STAGES.contains(&s) {
            return format!("Not saved: stage must be one of {}.", STARTUP_STAGES.join(", "));
        }
    }
    let country = match text(input, "country") {
        None => None,
        Some(c) => match crate::countries::resolve(&c) {
            Some((code, _)) => Some(code.to_string()),
            None => return format!("Not saved: '{c}' isn't a country I know. Use its name or 2-letter code."),
        },
    };
    let fields = ["company_name", "one_liner", "sector", "website"].map(|f| text(input, f));
    let given: Vec<&str> = ["company_name", "one_liner", "stage", "sector", "country", "website"]
        .into_iter()
        .zip([&fields[0], &fields[1], &stage, &fields[2], &country, &fields[3]])
        .filter(|(_, v)| v.is_some())
        .map(|(k, _)| k)
        .collect();
    if given.is_empty() {
        return saved(&given);
    }

    let result = sqlx::query(
        r#"INSERT INTO profiles (user_id, company_name, one_liner, stage, sector, country, website)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (user_id) DO UPDATE SET
               company_name = COALESCE(EXCLUDED.company_name, profiles.company_name),
               one_liner = COALESCE(EXCLUDED.one_liner, profiles.one_liner),
               stage = COALESCE(EXCLUDED.stage, profiles.stage),
               sector = COALESCE(EXCLUDED.sector, profiles.sector),
               country = COALESCE(EXCLUDED.country, profiles.country),
               website = COALESCE(EXCLUDED.website, profiles.website),
               updated_at = now()"#,
    )
    .bind(user_id)
    .bind(&fields[0])
    .bind(&fields[1])
    .bind(&stage)
    .bind(&fields[2])
    .bind(&country)
    .bind(&fields[3])
    .execute(&state.db)
    .await;
    match result {
        Ok(_) => saved(&given),
        Err(e) => {
            tracing::error!("update_startup_profile failed: {e}");
            "Not saved: database error.".to_string()
        }
    }
}

async fn update_pitch(state: &AppState, user_id: Uuid, input: &Value) -> String {
    let values: Vec<(&str, String)> = PITCH_FIELDS
        .iter()
        .filter_map(|(f, _)| text(input, f).map(|v| (*f, v)))
        .collect();
    let team_size = input["team_size"].as_i64().filter(|n| (1..=100_000).contains(n)).map(|n| n as i32);
    let mut given: Vec<&str> = values.iter().map(|(f, _)| *f).collect();
    if team_size.is_some() {
        given.push("team_size");
    }
    if given.is_empty() {
        return saved(&given);
    }

    // The founder's latest pitch, or a new one if they have none yet.
    let existing: Option<Uuid> = sqlx::query_scalar(
        "SELECT id FROM pitches WHERE created_by = $1 ORDER BY created_at DESC LIMIT 1",
    )
    .bind(user_id)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();
    let pitch_id = match existing {
        Some(id) => id,
        None => {
            let org_id = match super::pitches::ensure_user_org(&state.db, user_id).await {
                Ok(id) => id,
                Err(e) => {
                    tracing::error!("update_pitch: org failed: {e}");
                    return "Not saved: database error.".to_string();
                }
            };
            let title: String = sqlx::query_scalar::<_, Option<String>>("SELECT company_name FROM profiles WHERE user_id = $1")
                .bind(user_id)
                .fetch_optional(&state.db)
                .await
                .ok()
                .flatten()
                .flatten()
                .unwrap_or_else(|| "Pitch".to_string());
            let id = Uuid::new_v4();
            if let Err(e) = sqlx::query("INSERT INTO pitches (id, organization_id, created_by, title) VALUES ($1, $2, $3, $4)")
                .bind(id)
                .bind(org_id)
                .bind(user_id)
                .bind(&title)
                .execute(&state.db)
                .await
            {
                tracing::error!("update_pitch: insert failed: {e}");
                return "Not saved: database error.".to_string();
            }
            id
        }
    };

    let get = |f: &str| values.iter().find(|(k, _)| *k == f).map(|(_, v)| v.clone());
    let result = sqlx::query(
        r#"UPDATE pitches SET
               description = COALESCE($2, description),
               problem = COALESCE($3, problem),
               solution = COALESCE($4, solution),
               market_size = COALESCE($5, market_size),
               business_model = COALESCE($6, business_model),
               traction = COALESCE($7, traction),
               funding_ask = COALESCE($8, funding_ask),
               use_of_funds = COALESCE($9, use_of_funds),
               incorporation_country = COALESCE($10, incorporation_country),
               team_size = COALESCE($11, team_size),
               updated_at = now()
           WHERE id = $1"#,
    )
    .bind(pitch_id)
    .bind(get("description"))
    .bind(get("problem"))
    .bind(get("solution"))
    .bind(get("market_size"))
    .bind(get("business_model"))
    .bind(get("traction"))
    .bind(get("funding_ask"))
    .bind(get("use_of_funds"))
    .bind(get("incorporation_country"))
    .bind(team_size)
    .execute(&state.db)
    .await;
    match result {
        Ok(_) => saved(&given),
        Err(e) => {
            tracing::error!("update_pitch failed: {e}");
            "Not saved: database error.".to_string()
        }
    }
}

async fn update_investor_profile(state: &AppState, user_id: Uuid, input: &Value) -> String {
    let list = |f: &str| -> Option<Vec<String>> {
        input[f].as_array().map(|a| {
            a.iter().filter_map(|v| v.as_str()).map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect::<Vec<_>>()
        }).filter(|v: &Vec<String>| !v.is_empty())
    };
    let amount = |f: &str| input[f].as_i64().filter(|n| *n >= 0);
    let firm_name = text(input, "firm_name");
    let bio = text(input, "bio");
    let thesis = text(input, "investment_thesis");
    let sectors = list("sectors");
    let stages = list("stages");
    let (min, max) = (amount("ticket_size_min"), amount("ticket_size_max"));
    let country = text(input, "country");
    let website = text(input, "website");
    let given: Vec<&str> = [
        ("firm_name", firm_name.is_some()),
        ("bio", bio.is_some()),
        ("investment_thesis", thesis.is_some()),
        ("sectors", sectors.is_some()),
        ("stages", stages.is_some()),
        ("ticket_size_min", min.is_some()),
        ("ticket_size_max", max.is_some()),
        ("country", country.is_some()),
        ("website", website.is_some()),
    ]
    .into_iter()
    .filter(|(_, g)| *g)
    .map(|(k, _)| k)
    .collect();
    if given.is_empty() {
        return saved(&given);
    }

    let result = sqlx::query(
        r#"INSERT INTO investor_profiles (user_id, firm_name, bio, investment_thesis, sectors, stages,
                                          ticket_size_min, ticket_size_max, country, website)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           ON CONFLICT (user_id) DO UPDATE SET
               firm_name = COALESCE(EXCLUDED.firm_name, investor_profiles.firm_name),
               bio = COALESCE(EXCLUDED.bio, investor_profiles.bio),
               investment_thesis = COALESCE(EXCLUDED.investment_thesis, investor_profiles.investment_thesis),
               sectors = COALESCE(EXCLUDED.sectors, investor_profiles.sectors),
               stages = COALESCE(EXCLUDED.stages, investor_profiles.stages),
               ticket_size_min = COALESCE(EXCLUDED.ticket_size_min, investor_profiles.ticket_size_min),
               ticket_size_max = COALESCE(EXCLUDED.ticket_size_max, investor_profiles.ticket_size_max),
               country = COALESCE(EXCLUDED.country, investor_profiles.country),
               website = COALESCE(EXCLUDED.website, investor_profiles.website),
               updated_at = now()"#,
    )
    .bind(user_id)
    .bind(&firm_name)
    .bind(&bio)
    .bind(&thesis)
    .bind(&sectors)
    .bind(&stages)
    .bind(min)
    .bind(max)
    .bind(&country)
    .bind(&website)
    .execute(&state.db)
    .await;
    match result {
        Ok(_) => saved(&given),
        Err(e) => {
            tracing::error!("update_investor_profile failed: {e}");
            "Not saved: database error.".to_string()
        }
    }
}

async fn answer_intro_request(state: &AppState, user_id: Uuid, input: &Value) -> String {
    let Some(match_id) = input["match_id"].as_str().and_then(|s| s.trim().parse::<Uuid>().ok()) else {
        return "Not done: match_id isn't a valid ID. Use one from the intro requests waiting for the user.".to_string();
    };
    let Some(accept) = input["accept"].as_bool() else {
        return "Not done: say whether to accept (true) or pass (false).".to_string();
    };
    match super::kevin_matches::answer_intro_request(state, user_id, match_id, accept).await {
        Ok(()) if accept => "Accepted. Both of you will get each other's details by email.".to_string(),
        Ok(()) => "Passed. They'll get a polite note.".to_string(),
        Err((_, e)) => format!("Not done: {e}."),
    }
}

/// Intro requests waiting for this user's answer, for Kevin's context.
pub(crate) async fn waiting_requests_section(state: &AppState, user_id: Uuid) -> String {
    let rows: Vec<(Uuid, String, Option<String>, chrono::DateTime<chrono::Utc>)> = sqlx::query_as(
        r#"SELECT km.id,
                  COALESCE(NULLIF(TRIM(p.company_name), ''), NULLIF(TRIM(ip.firm_name), ''), 'Someone'),
                  COALESCE(p.one_liner, ip.investment_thesis),
                  km.intro_requested_at
             FROM kevin_matches km
             LEFT JOIN profiles p ON p.user_id = km.for_user_id
             LEFT JOIN investor_profiles ip ON ip.user_id = km.for_user_id
            WHERE km.matched_user_id = $1 AND km.intro_requested_at IS NOT NULL
              AND km.intro_accepted_at IS NULL AND km.intro_passed_at IS NULL
            ORDER BY km.intro_requested_at DESC
            LIMIT 10"#,
    )
    .bind(user_id)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();
    if rows.is_empty() {
        return String::new();
    }
    let lines: Vec<String> = rows
        .into_iter()
        .map(|(id, name, about, at)| {
            let about = about
                .map(|a| format!(": {}", a.chars().take(140).collect::<String>()))
                .unwrap_or_default();
            format!("- match_id {id}: {name}{about} (asked {})", at.format("%Y-%m-%d"))
        })
        .collect();
    format!(
        "\nIntro requests waiting for this user's answer (answer with answer_intro_request once they decide):\n{}",
        lines.join("\n")
    )
}

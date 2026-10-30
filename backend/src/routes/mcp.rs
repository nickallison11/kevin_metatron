//! Kevin's MCP server: users connect their own AI app (Claude, ChatGPT,
//! Gemini, Grok...) to metatron and it uses Kevin's tools on their behalf.
//! Streamable HTTP transport, answering each JSON-RPC request with plain JSON
//! (no server-sent stream). Signed in through mcp_auth.rs.
//!
//! The user's own model does the talking, so Kevin's rules live in the tools:
//! they return only real data, say plainly what isn't there, and carry the
//! plan limits themselves.

use std::sync::Arc;

use axum::{
    body::Bytes,
    extract::State,
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::post,
    Json, Router,
};
use serde_json::{json, Value};
use uuid::Uuid;

use crate::state::AppState;

const PROTOCOL_VERSIONS: &[&str] = &["2025-06-18", "2025-03-26", "2024-11-05"];

const INSTRUCTIONS: &str = "These tools connect you to Kevin, metatron's fundraising assistant. metatron connects founders, investors and connectors. Call get_my_overview at the start of any conversation about the user's fundraising, matches or intros. Only state names, scores and details these tools return: never invent investors, programmes or results, and if a tool finds nothing, say so. Call a programme verified only when the tool marks it verified. When a tool returns a plan limit or upgrade message, pass it on as it is. When you need details from the user, ask one question at a time.";

pub fn router() -> Router<Arc<AppState>> {
    Router::new().route("/mcp", post(handle).get(no_stream).delete(no_stream))
}

/// This server doesn't open server-sent event streams.
async fn no_stream() -> StatusCode {
    StatusCode::METHOD_NOT_ALLOWED
}

struct McpUser {
    id: Uuid,
    role: String,
    email: String,
    is_basic: bool,
    is_pro: bool,
}

async fn authenticate(state: &AppState, headers: &HeaderMap) -> Option<McpUser> {
    let token = headers
        .get(header::AUTHORIZATION)?
        .to_str()
        .ok()?
        .strip_prefix("Bearer ")?
        .trim();
    let user_id = super::mcp_auth::user_for_access_token(state, token).await?;
    let (role, email, is_basic, is_pro, suspended): (String, String, bool, bool, bool) = sqlx::query_as(
        r#"SELECT role::text, email, COALESCE(is_basic, false), COALESCE(is_pro, false), COALESCE(is_suspended, false)
             FROM users WHERE id = $1"#,
    )
    .bind(user_id)
    .fetch_optional(&state.db)
    .await
    .ok()??;
    (!suspended).then_some(McpUser { id: user_id, role, email, is_basic, is_pro })
}

fn unauthorized(headers: &HeaderMap) -> Response {
    let metadata = format!("{}/.well-known/oauth-protected-resource", super::mcp_auth::base_url(headers));
    (
        StatusCode::UNAUTHORIZED,
        [(header::WWW_AUTHENTICATE, format!("Bearer resource_metadata=\"{metadata}\""))],
        Json(json!({ "error": "invalid_token", "error_description": "Sign in to metatron to use Kevin" })),
    )
        .into_response()
}

async fn handle(State(state): State<Arc<AppState>>, headers: HeaderMap, body: Bytes) -> Response {
    let Some(user) = authenticate(&state, &headers).await else {
        return unauthorized(&headers);
    };
    let message: Value = match serde_json::from_slice(&body) {
        Ok(v) => v,
        Err(_) => return Json(rpc_error(Value::Null, -32700, "Parse error")).into_response(),
    };

    if let Some(batch) = message.as_array() {
        let mut replies = Vec::new();
        for m in batch {
            if let Some(r) = handle_message(&state, &user, m).await {
                replies.push(r);
            }
        }
        return if replies.is_empty() { StatusCode::ACCEPTED.into_response() } else { Json(Value::Array(replies)).into_response() };
    }
    match handle_message(&state, &user, &message).await {
        Some(reply) => Json(reply).into_response(),
        None => StatusCode::ACCEPTED.into_response(),
    }
}

fn rpc_error(id: Value, code: i64, message: &str) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
}

/// One JSON-RPC message; None for notifications and responses, which get no reply.
async fn handle_message(state: &AppState, user: &McpUser, m: &Value) -> Option<Value> {
    let id = m.get("id")?.clone();
    let Some(method) = m["method"].as_str() else {
        return None;
    };
    let params = &m["params"];
    let result = match method {
        "initialize" => {
            let asked = params["protocolVersion"].as_str().unwrap_or("");
            let version = if PROTOCOL_VERSIONS.contains(&asked) { asked } else { PROTOCOL_VERSIONS[0] };
            json!({
                "protocolVersion": version,
                "capabilities": { "tools": { "listChanged": false } },
                "serverInfo": { "name": "kevin", "title": "Kevin from metatron", "version": "0.1.0" },
                "instructions": INSTRUCTIONS
            })
        }
        "ping" => json!({}),
        "tools/list" => json!({ "tools": tools(&user.role) }),
        "tools/call" => {
            let name = params["name"].as_str().unwrap_or("");
            let empty = json!({});
            let args = if params["arguments"].is_object() { &params["arguments"] } else { &empty };
            let (text, is_error) = call_tool(state, user, name, args).await;
            json!({ "content": [{ "type": "text", "text": text }], "isError": is_error })
        }
        _ => return Some(rpc_error(id, -32601, "Method not found")),
    };
    Some(json!({ "jsonrpc": "2.0", "id": id, "result": result }))
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

fn read_only(open_world: bool) -> Value {
    json!({ "readOnlyHint": true, "destructiveHint": false, "openWorldHint": open_world })
}

fn tools(role: &str) -> Vec<Value> {
    let mut list = vec![
        json!({
            "name": "get_my_overview",
            "title": "My metatron overview",
            "description": "Everything Kevin knows about the user's metatron account: profile, pitch, funding stage, Angel Score, top matches, intros and what they've told Kevin before. Call this first.",
            "inputSchema": { "type": "object", "properties": {} },
            "annotations": read_only(false)
        }),
        json!({
            "name": "lookup_match",
            "title": "Look up a match",
            "description": "Look up one of the user's matched startups or investors by name: their profile and why they match.",
            "inputSchema": {
                "type": "object",
                "properties": { "name": { "type": "string", "description": "The startup's or investor's name" } },
                "required": ["name"]
            },
            "annotations": read_only(false)
        }),
        json!({
            "name": "search_network",
            "title": "Search metatron",
            "description": "Search everyone on metatron (founders and investors) by name, sector, stage or country. How much detail and how many results come back depends on the user's plan.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "query": { "type": "string", "description": "A name, sector, stage or country" },
                    "type": { "type": "string", "enum": ["founders", "investors", "all"] }
                },
                "required": ["query"]
            },
            "annotations": read_only(false)
        }),
    ];
    if role == "STARTUP" {
        list.push(json!({
            "name": "find_programmes",
            "title": "Find programmes",
            "description": "Incubators, accelerators, bootcamps or scale-up programmes for the founder's funding stage, sector and country, from metatron's list (searched online when the list is short). Each is marked verified or found online.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "stage": { "type": "string", "enum": super::readiness::STAGES.iter().map(|(k, _)| *k).collect::<Vec<_>>() },
                    "sector": { "type": "string" },
                    "country": { "type": "string" }
                }
            },
            "annotations": read_only(true)
        }));
    }
    list
}

/// Runs a tool: (text for the model, whether it's an error).
async fn call_tool(state: &AppState, user: &McpUser, name: &str, args: &Value) -> (String, bool) {
    if !tools(&user.role).iter().any(|t| t["name"] == name) {
        return (format!("Unknown tool: {name}"), true);
    }
    if let Some(limit_message) = count_against_daily_limit(state, user).await {
        return (limit_message, true);
    }
    let text = match name {
        "get_my_overview" => super::kevin::build_context(state, user.id, &user.role).await,
        "lookup_match" => super::kevin::execute_kevin_tool(state, user.id, &user.email, &user.role, name, args).await,
        "search_network" => search_network(state, user, args).await,
        "find_programmes" => super::readiness::execute(state, user.id, &user.role, name, args).await.unwrap_or_default(),
        _ => return (format!("Unknown tool: {name}"), true),
    };
    (text, false)
}

/// Each tool call counts as one Kevin message, on the same daily limit as
/// every other channel. Some(message) when the limit is reached.
async fn count_against_daily_limit(state: &AppState, user: &McpUser) -> Option<String> {
    let limit = super::kevin::kevin_daily_limit(state, user.id, user.is_basic, user.is_pro).await;
    if limit == i32::MAX {
        return None;
    }
    let count: i32 = sqlx::query_scalar(
        r#"INSERT INTO kevin_daily_usage (user_id, usage_date, message_count)
           VALUES ($1, CURRENT_DATE, 1)
           ON CONFLICT (user_id, usage_date)
           DO UPDATE SET message_count = kevin_daily_usage.message_count + 1
           RETURNING message_count"#,
    )
    .bind(user.id)
    .fetch_one(&state.db)
    .await
    .unwrap_or(0);
    if count <= limit {
        return None;
    }
    let _ = sqlx::query(
        "UPDATE kevin_daily_usage SET message_count = message_count - 1 WHERE user_id = $1 AND usage_date = CURRENT_DATE",
    )
    .bind(user.id)
    .execute(&state.db)
    .await;
    Some(if user.is_basic {
        "The user has reached their daily Kevin limit. It resets at midnight UTC.".to_string()
    } else {
        super::kevin::free_limit_message(state, limit)
    })
}

// ---------------------------------------------------------------------------
// Network search, by plan
// ---------------------------------------------------------------------------

/// Text cut to `max` characters, without a trailing full stop (the caller adds one).
fn clip(text: &str, max: usize) -> String {
    let t = text.trim();
    let cut = if t.chars().count() > max { format!("{}…", t.chars().take(max).collect::<String>().trim_end()) } else { t.to_string() };
    cut.trim_end_matches('.').to_string()
}

/// Free sees basic details and few results; Basic and Pro see more. Contact
/// details never come back here, only through an accepted intro.
async fn search_network(state: &AppState, user: &McpUser, args: &Value) -> String {
    let query = args["query"].as_str().unwrap_or("").trim().to_lowercase();
    if query.chars().count() < 2 {
        return "Give a name, sector, stage or country to search for.".to_string();
    }
    let kind = args["type"].as_str().unwrap_or("all");
    let (limit, level): (i64, u8) = if user.is_pro { (50, 2) } else if user.is_basic { (20, 1) } else { (5, 0) };
    let like = format!("%{query}%");
    let country_name = |c: Option<String>| {
        c.map(|c| crate::countries::resolve(c.trim()).map(|(_, n)| n.to_string()).unwrap_or(c))
    };
    let mut lines = Vec::new();

    if kind == "founders" || kind == "all" {
        let founders: Vec<(Uuid, Option<String>, Option<String>, Option<String>, Option<String>, Option<String>, Option<i32>)> =
            sqlx::query_as(
                r#"SELECT p.user_id, p.company_name, p.one_liner, p.stage, p.sector, p.country::text, a.score
                     FROM profiles p
                     LEFT JOIN angel_scores a ON a.founder_user_id = p.user_id
                    WHERE p.company_name IS NOT NULL AND p.user_id <> $3
                      AND (p.company_name ILIKE $1 OR p.sector ILIKE $1 OR p.stage ILIKE $1
                           OR p.country::text ILIKE $1 OR p.one_liner ILIKE $1)
                    ORDER BY p.updated_at DESC
                    LIMIT $2"#,
            )
            .bind(&like)
            .bind(limit)
            .bind(user.id)
            .fetch_all(&state.db)
            .await
            .unwrap_or_default();
        for (id, company, one_liner, stage, sector, country, score) in founders {
            let meta: Vec<String> = [stage, sector, country_name(country)].into_iter().flatten().collect();
            let mut line = format!("[Founder] {} ({})", company.unwrap_or_default(), meta.join(", "));
            if level >= 1 {
                if let Some(v) = one_liner.filter(|v| !v.trim().is_empty()) {
                    line.push_str(&format!(": {}", clip(&v, 200)));
                }
                if let Some(s) = score {
                    line.push_str(&format!(". Angel Score {s}/100"));
                }
            }
            if level >= 2 {
                line.push_str(&format!(". Profile: {}/startups/{id}", state.frontend_url));
            }
            lines.push(line);
        }
    }

    if kind == "investors" || kind == "all" {
        let investors: Vec<(Option<String>, Option<String>, Option<String>, Option<Vec<String>>, Option<Vec<String>>, Option<String>, Option<i64>, Option<i64>, Option<String>)> =
            sqlx::query_as(
                r#"SELECT firm_name, bio, investment_thesis, sectors, stages, country, ticket_size_min, ticket_size_max, website
                     FROM investor_profiles
                    WHERE firm_name IS NOT NULL AND user_id <> $3
                      AND (firm_name ILIKE $1 OR bio ILIKE $1 OR country ILIKE $1
                           OR sectors::text ILIKE $1 OR stages::text ILIKE $1 OR investment_thesis ILIKE $1)
                    ORDER BY updated_at DESC
                    LIMIT $2"#,
            )
            .bind(&like)
            .bind(limit)
            .bind(user.id)
            .fetch_all(&state.db)
            .await
            .unwrap_or_default();
        for (firm, bio, thesis, sectors, stages, country, min, max, website) in investors {
            let mut meta = Vec::new();
            if let Some(v) = stages.filter(|v| !v.is_empty()) {
                meta.push(v.join(", "));
            }
            if let Some(v) = sectors.filter(|v| !v.is_empty()) {
                meta.push(v.join(", "));
            }
            if let Some(v) = country_name(country) {
                meta.push(v);
            }
            let mut line = format!("[Investor] {} ({})", firm.unwrap_or_default(), meta.join("; "));
            if level >= 1 {
                if let Some(t) = thesis.filter(|t| !t.trim().is_empty()) {
                    line.push_str(&format!(": {}", clip(&t, 200)));
                }
                match (min, max) {
                    (Some(a), Some(b)) => line.push_str(&format!(". Tickets ${a}-${b}")),
                    (None, Some(b)) => line.push_str(&format!(". Tickets up to ${b}")),
                    (Some(a), None) => line.push_str(&format!(". Tickets from ${a}")),
                    _ => {}
                }
            }
            if level >= 2 {
                if let Some(b) = bio.filter(|b| !b.trim().is_empty()) {
                    line.push_str(&format!(". {}", clip(&b, 300)));
                }
                if let Some(w) = website.filter(|w| !w.trim().is_empty()) {
                    line.push_str(&format!(". {w}"));
                }
            }
            lines.push(line);
        }
    }

    if lines.is_empty() {
        return format!("Nobody on metatron matches '{query}'.");
    }
    lines.truncate(limit as usize);
    let mut out = lines.join("\n");
    if level == 0 {
        let more = if state.payments_enabled {
            format!("Basic and Pro show more details and up to 20 or 50 results ({}/pricing).", state.frontend_url)
        } else {
            "Basic and Pro, coming soon, will show more details and more results.".to_string()
        };
        out.push_str(&format!("\n\nFree plan: basic details and up to 5 results. {more}"));
    } else if level == 1 {
        out.push_str("\n\nBasic plan: up to 20 results. Pro shows full profiles and up to 50.");
    }
    out
}

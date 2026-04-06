use std::sync::Arc;

use axum::extract::rejection::JsonRejection;
use axum::http::StatusCode;
use axum::{extract::State, routing::post, Json, Router};
use axum_extra::{
    headers::{authorization::Bearer, Authorization},
    TypedHeader,
};
use serde::{Deserialize, Serialize};

use uuid::Uuid;

use crate::ai::complete_chat;
use crate::crypto;
use crate::email;
use crate::identity::require_user;
use crate::memory;
use crate::state::AppState;

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/chat", post(chat))
        .route("/inbound-email", post(inbound_email))
}

fn kevin_daily_limit(is_pro: bool, subscription_tier: &str) -> i32 {
    if is_pro {
        match subscription_tier.to_ascii_lowercase().as_str() {
            "pro" => i32::MAX,
            _ => 200, // basic
        }
    } else {
        20 // free
    }
}

fn parse_email_address(from_header: &str) -> String {
    let s = from_header.trim();
    if let Some(start) = s.find('<') {
        if let Some(end) = s.rfind('>') {
            if end > start {
                return s[start + 1..end].trim().to_string();
            }
        }
    }
    s.to_string()
}

fn strip_html_tags_simple(s: &str) -> String {
    let mut out = String::new();
    let mut in_tag = false;
    for c in s.chars() {
        match c {
            '<' => in_tag = true,
            '>' if in_tag => in_tag = false,
            _ if !in_tag => out.push(c),
            _ => {}
        }
    }
    out
}

fn clean_email_body_block(block: &str) -> String {
    let lines: Vec<&str> = block
        .lines()
        .filter(|line| {
            let t = line.trim_start();
            !t.starts_with("--")
                && !t.starts_with("Content-")
                && !t.starts_with("MIME-")
        })
        .collect();
    let joined = lines.join("\n");
    strip_html_tags_simple(&joined)
}

/// Extract first non-empty plain text from raw RFC 822 message.
fn extract_plain_text_from_raw_email(raw: &str) -> String {
    let after_headers = raw
        .split_once("\r\n\r\n")
        .or_else(|| raw.split_once("\n\n"))
        .map(|(_, b)| b)
        .unwrap_or(raw);

    let normalized = after_headers.replace('\r', "");
    for block in normalized.split("\n\n") {
        let cleaned = clean_email_body_block(block);
        if !cleaned.trim().is_empty() {
            return cleaned.trim().to_string();
        }
    }
    String::new()
}

#[derive(Deserialize)]
struct InboundEmailRequest {
    from: String,
    to: String,
    subject: String,
    raw: String,
}

#[derive(sqlx::FromRow)]
struct UserForEmail {
    id: Uuid,
    is_pro: bool,
    subscription_tier: String,
    role: String,
    custom_ai_provider: Option<String>,
    custom_ai_api_key: Option<String>,
    custom_ai_model: Option<String>,
}

async fn inbound_email(
    State(state): State<Arc<AppState>>,
    body: Result<Json<InboundEmailRequest>, JsonRejection>,
) -> StatusCode {
    let body = match body {
        Ok(Json(b)) => b,
        Err(e) => {
            tracing::error!("inbound-email: invalid JSON: {e}");
            return StatusCode::OK;
        }
    };

    let state = Arc::clone(&state);
    tokio::spawn(async move {
        inbound_email_process(state, body).await;
    });
    StatusCode::OK
}

async fn inbound_email_process(state: Arc<AppState>, body: InboundEmailRequest) {
    let _ = &body.to;
    let from_addr = parse_email_address(&body.from);
    let resend_key = state.resend_api_key.as_deref().unwrap_or("");

    let plain = extract_plain_text_from_raw_email(&body.raw);
    if plain.trim().is_empty() {
        return;
    }

    let user_row: Option<UserForEmail> = match sqlx::query_as(
        r#"
        SELECT id, is_pro, subscription_tier, role::text,
               custom_ai_provider, custom_ai_api_key, custom_ai_model
        FROM users
        WHERE LOWER(email) = LOWER($1)
        "#,
    )
    .bind(&from_addr)
    .fetch_optional(&state.db)
    .await
    {
        Ok(r) => r,
        Err(e) => {
            tracing::error!("inbound-email: user lookup failed: {e}");
            return;
        }
    };

    let reply_subject = if body.subject.trim().is_empty() {
        "Re: (no subject)".to_string()
    } else if body.subject.trim().to_lowercase().starts_with("re:") {
        body.subject.trim().to_string()
    } else {
        format!("Re: {}", body.subject.trim())
    };

    let Some(user) = user_row else {
        email::send_kevin_email_reply(
            &state.http_client,
            resend_key,
            "kevin@metatron.id",
            &from_addr,
            &reply_subject,
            "Hi! You need a free metatron account to chat with Kevin. Sign up at platform.metatron.id",
        )
        .await;
        return;
    };

    let custom_ai_api_key = match user.custom_ai_api_key {
        Some(ref encrypted) => match crypto::decrypt(&state.encryption_key, encrypted) {
            Ok(value) => Some(value),
            Err(e) => {
                tracing::warn!("inbound-email: custom_ai_api_key decrypt failed: {e}");
                None
            }
        },
        None => None,
    };

    let daily_limit = kevin_daily_limit(user.is_pro, &user.subscription_tier);

    if daily_limit < i32::MAX {
        let count: i32 = match sqlx::query_scalar(
            r#"
            INSERT INTO kevin_daily_usage (user_id, usage_date, message_count)
            VALUES ($1, CURRENT_DATE, 1)
            ON CONFLICT (user_id, usage_date)
            DO UPDATE SET message_count = kevin_daily_usage.message_count + 1
            RETURNING message_count
            "#,
        )
        .bind(user.id)
        .fetch_one(&state.db)
        .await
        {
            Ok(c) => c,
            Err(e) => {
                tracing::error!("inbound-email: usage upsert failed: {e}");
                return;
            }
        };

        if count > daily_limit {
            let _ = sqlx::query(
                "UPDATE kevin_daily_usage SET message_count = message_count - 1 WHERE user_id = $1 AND usage_date = CURRENT_DATE",
            )
            .bind(user.id)
            .execute(&state.db)
            .await;

            let limit_body = if !user.is_pro {
                "You've used your 20 daily Kevin messages across all channels. Upgrade to Founder Basic at platform.metatron.id/pricing for 200 messages/day."
            } else {
                "You've reached your daily Kevin limit. It resets at midnight UTC. Upgrade at platform.metatron.id/pricing for higher limits."
            };

            email::send_kevin_email_reply(
                &state.http_client,
                resend_key,
                "kevin@metatron.id",
                &from_addr,
                &reply_subject,
                limit_body,
            )
            .await;
            return;
        }
    }

    let last_user_message = plain.clone();

    let recalled = if last_user_message.trim().is_empty() {
        Vec::new()
    } else {
        match memory::recall_memories(
            &state.db,
            &state.http_client,
            state.gemini_embedding_key.as_deref(),
            user.is_pro,
            user.id,
            &last_user_message,
        )
        .await
        {
            Ok(v) => v,
            Err(e) => {
                tracing::warn!("kevin inbound-email memory recall failed: {e}");
                Vec::new()
            }
        }
    };

    let context = build_context(&state, user.id, &user.role).await;
    let memory_section = if recalled.is_empty() {
        String::new()
    } else {
        let lines = recalled
            .into_iter()
            .map(|m| format!("- {m}"))
            .collect::<Vec<_>>()
            .join("\n");
        format!("\n\n## Kevin's memory of this user\n{lines}")
    };

    let system = format!(
        r#"You are Kevin, the AI copilot for Metatron (metatron.id).

Metatron is the intelligence layer connecting founders, investors, and ecosystem partners globally. You help users navigate fundraising, diligence, pitch refinement, and relationship context. Be concise, practical, and professional.

## Current user context
{context}{memory_section}

Stay in character as Kevin. If asked about capabilities you don't have, say what you can help with within Metatron (profiles, pitches, intros, call notes). Do not use markdown formatting. No bold, no asterisks, no bullet point symbols. Plain text only."#
    );

    let ai_route: Option<(&str, &str, &str)> = if user.is_pro {
        if let Some(ref custom_key) = custom_ai_api_key {
            let provider = user
                .custom_ai_provider
                .as_deref()
                .unwrap_or("openai");
            let model = user.custom_ai_model.as_deref().unwrap_or("gpt-4o-mini");
            Some((provider, custom_key.as_str(), model))
        } else if let Some(key) = state.anthropic_api_key.as_deref() {
            Some((
                "anthropic",
                key,
                "claude-haiku-4-5-20251001",
            ))
        } else if let Some(key) = state.ai_api_key.as_deref() {
            Some(("gemini", key, "gemini-2.5-flash-lite"))
        } else {
            None
        }
    } else if let Some(key) = state.ai_api_key.as_deref() {
        Some(("gemini", key, "gemini-2.5-flash-lite"))
    } else {
        None
    };

    let Some((provider, api_key, model)) = ai_route else {
        email::send_kevin_email_reply(
            &state.http_client,
            resend_key,
            "kevin@metatron.id",
            &from_addr,
            &reply_subject,
            "Kevin is temporarily unavailable.",
        )
        .await;
        return;
    };

    let msgs = vec![("user".to_string(), plain)];

    let reply = match complete_chat(
        &state.http_client,
        provider,
        api_key,
        model,
        &system,
        msgs,
    )
    .await
    {
        Ok(r) => strip_markdown(&r),
        Err(e) => {
            tracing::error!("inbound-email complete_chat: {e}");
            email::send_kevin_email_reply(
                &state.http_client,
                resend_key,
                "kevin@metatron.id",
                &from_addr,
                &reply_subject,
                "Kevin is temporarily unavailable.",
            )
            .await;
            return;
        }
    };

    email::send_kevin_email_reply(
        &state.http_client,
        resend_key,
        "kevin@metatron.id",
        &from_addr,
        &reply_subject,
        &reply,
    )
    .await;

    if let Some(gemini_key) = state.ai_api_key.clone() {
        let db = state.db.clone();
        let http = state.http_client.clone();
        let uid = user.id;
        let is_pro = user.is_pro;
        let embedding_key = state.gemini_embedding_key.clone();
        let conversation = format!("User: {last_user_message}\nKevin: {reply}");
        tokio::spawn(async move {
            if let Err(e) = memory::store_memory(
                &db,
                &http,
                &gemini_key,
                embedding_key.as_deref(),
                is_pro,
                uid,
                &conversation,
            )
            .await
            {
                tracing::warn!("kevin inbound-email memory store failed: {e}");
            }
        });
    }
}

#[derive(Deserialize)]
pub struct ChatRequest {
    pub messages: Vec<ChatMessage>,
    #[serde(default)]
    pub system_context: Option<String>,
}

#[derive(Deserialize, Serialize, Clone)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Serialize)]
struct ChatResponse {
    pub reply: String,
}

async fn chat(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
    Json(body): Json<ChatRequest>,
) -> Result<Json<ChatResponse>, (StatusCode, String)> {
    let user = require_user(&state, bearer.token()).await?;

    let mut msgs: Vec<(String, String)> = Vec::new();
    for m in &body.messages {
        let role = if m.role == "assistant" {
            "assistant"
        } else {
            "user"
        };
        msgs.push((role.to_string(), m.content.clone()));
    }

    if msgs.is_empty() {
        return Err((StatusCode::BAD_REQUEST, "messages required".into()));
    }

    let last_user_message = msgs
        .iter()
        .rev()
        .find_map(|(role, content)| (role == "user").then_some(content.clone()))
        .unwrap_or_default();

    let recalled = if last_user_message.trim().is_empty() {
        Vec::new()
    } else {
        match memory::recall_memories(
            &state.db,
            &state.http_client,
            state.gemini_embedding_key.as_deref(),
            user.is_pro,
            user.id,
            &last_user_message,
        )
        .await
        {
            Ok(v) => v,
            Err(e) => {
                tracing::warn!("kevin memory recall failed: {e}");
                Vec::new()
            }
        }
    };

    let context = build_context(&state, user.id, &user.role).await;
    let memory_section = if recalled.is_empty() {
        String::new()
    } else {
        let lines = recalled
            .into_iter()
            .map(|m| format!("- {m}"))
            .collect::<Vec<_>>()
            .join("\n");
        format!("\n\n## Kevin's memory of this user\n{lines}")
    };

    let role_extra = body
        .system_context
        .as_deref()
        .map(|s| format!("\n\n## Role-specific guidance\n{s}"))
        .unwrap_or_default();

    let system = format!(
        r#"You are Kevin, the AI copilot for Metatron (metatron.id).

Metatron is the intelligence layer connecting founders, investors, and ecosystem partners globally. You help users navigate fundraising, diligence, pitch refinement, and relationship context. Be concise, practical, and professional.

## Current user context
{context}{memory_section}{role_extra}

Stay in character as Kevin. If asked about capabilities you don't have, say what you can help with within Metatron (profiles, pitches, intros, call notes). Do not use markdown formatting. No bold, no asterisks, no bullet point symbols. Plain text only."#
    );

    let (provider, api_key, model) = if user.is_pro {
        // Pro custom routing: only the custom API key is required; provider/model can default.
        if let Some(custom_key) = user.custom_ai_api_key.as_deref() {
            let provider = user
                .custom_ai_provider
                .as_deref()
                .unwrap_or("openai");
            let model = user.custom_ai_model.as_deref().unwrap_or("gpt-4o-mini");
            (provider, custom_key, model)
        } else if let Some(key) = state.anthropic_api_key.as_deref() {
            (
                "anthropic",
                key,
                "claude-haiku-4-5-20251001",
            )
        } else if let Some(key) = state.ai_api_key.as_deref() {
            ("gemini", key, "gemini-2.5-flash-lite")
        } else {
            return Err((StatusCode::SERVICE_UNAVAILABLE, "AI not configured".to_string()));
        }
    } else if let Some(key) = state.ai_api_key.as_deref() {
        ("gemini", key, "gemini-2.5-flash-lite")
    } else {
        return Err((StatusCode::SERVICE_UNAVAILABLE, "AI not configured".to_string()));
    };

    let daily_limit = kevin_daily_limit(user.is_pro, &user.subscription_tier);

    if daily_limit < i32::MAX {
        let count: i32 = sqlx::query_scalar(
            r#"
            INSERT INTO kevin_daily_usage (user_id, usage_date, message_count)
            VALUES ($1, CURRENT_DATE, 1)
            ON CONFLICT (user_id, usage_date)
            DO UPDATE SET message_count = kevin_daily_usage.message_count + 1
            RETURNING message_count
            "#,
        )
        .bind(user.id)
        .fetch_one(&state.db)
        .await
        .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "db error".into()))?;

        if count > daily_limit {
            let _ = sqlx::query(
                "UPDATE kevin_daily_usage SET message_count = message_count - 1 WHERE user_id = $1 AND usage_date = CURRENT_DATE",
            )
            .bind(user.id)
            .execute(&state.db)
            .await;

            let msg = if !user.is_pro {
                "You've used your 20 daily Kevin messages across all channels. Upgrade to Founder Basic at platform.metatron.id/pricing for 200 messages/day.".to_string()
            } else {
                format!(
                    "Daily message limit reached ({daily_limit}/day). Resets at midnight UTC."
                )
            };
            return Err((StatusCode::TOO_MANY_REQUESTS, msg));
        }
    }

    let reply = complete_chat(
        &state.http_client,
        provider,
        api_key,
        model,
        &system,
        msgs,
    )
    .await
    .map_err(|e| (StatusCode::BAD_GATEWAY, e))?;
    let reply = strip_markdown(&reply);

    if let Some(gemini_key) = state.ai_api_key.clone() {
        let db = state.db.clone();
        let http = state.http_client.clone();
        let uid = user.id;
        let is_pro = user.is_pro;
        let embedding_key = state.gemini_embedding_key.clone();
        let conversation = format!("User: {last_user_message}\nKevin: {reply}");
        tokio::spawn(async move {
            if let Err(e) = memory::store_memory(
                &db,
                &http,
                &gemini_key,
                embedding_key.as_deref(),
                is_pro,
                uid,
                &conversation,
            )
            .await
            {
                tracing::warn!("kevin memory store failed: {e}");
            }
        });
    }

    Ok(Json(ChatResponse { reply }))
}

async fn build_context(state: &AppState, user_id: uuid::Uuid, role: &str) -> String {
    let mut parts = vec![format!("Role: {role}")];

    if let Ok(row) = sqlx::query_as::<_, ProfileCtx>(
        r#"
        SELECT company_name, one_liner, stage, sector, country::text, website, pitch_deck_url
        FROM profiles WHERE user_id = $1
        "#,
    )
    .bind(user_id)
    .fetch_optional(&state.db)
    .await
    {
        if let Some(p) = row {
            parts.push(format!(
                "Founder profile: company={:?} one_liner={:?} stage={:?} sector={:?} country={:?} website={:?} deck={:?}",
                p.company_name, p.one_liner, p.stage, p.sector, p.country, p.website, p.pitch_deck_url
            ));
        }
    }

    if let Ok(rows) = sqlx::query_as::<_, PitchCtx>(
        r#"
        SELECT title, description FROM pitches WHERE created_by = $1 ORDER BY created_at DESC LIMIT 8
        "#,
    )
    .bind(user_id)
    .fetch_all(&state.db)
    .await
    {
        if !rows.is_empty() {
            let lines: Vec<String> = rows
                .into_iter()
                .map(|p| {
                    format!(
                        "- {} ({})",
                        p.title,
                        p.description.unwrap_or_default()
                    )
                })
                .collect();
            parts.push(format!("Recent pitches:\n{}", lines.join("\n")));
        }
    }

    if let Ok(row) = sqlx::query_as::<_, InvestorCtx>(
        r#"
        SELECT sectors, stages FROM investor_profiles WHERE user_id = $1
        "#,
    )
    .bind(user_id)
    .fetch_optional(&state.db)
    .await
    {
        if let Some(i) = row {
            parts.push(format!(
                "Investor preferences: sectors={:?} stages={:?}",
                i.sectors, i.stages
            ));
        }
    }

    parts.join("\n")
}

#[derive(sqlx::FromRow)]
struct ProfileCtx {
    company_name: Option<String>,
    one_liner: Option<String>,
    stage: Option<String>,
    sector: Option<String>,
    country: Option<String>,
    website: Option<String>,
    pitch_deck_url: Option<String>,
}

#[derive(sqlx::FromRow)]
struct PitchCtx {
    title: String,
    description: Option<String>,
}

#[derive(sqlx::FromRow)]
struct InvestorCtx {
    sectors: Option<Vec<String>>,
    stages: Option<Vec<String>>,
}

fn strip_markdown(text: &str) -> String {
    let mut result = String::new();
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '*' {
            // skip all consecutive asterisks
            while chars.peek() == Some(&'*') {
                chars.next();
            }
            continue;
        }
        if c == '_' && chars.peek() == Some(&'_') {
            chars.next();
            continue;
        }
        if c == '#' {
            // skip # characters at start of content or after newline
            continue;
        }
        result.push(c);
    }
    result
}

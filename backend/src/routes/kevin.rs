use std::sync::Arc;

use axum::extract::rejection::JsonRejection;
use axum::http::HeaderMap;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::{
    extract::{Query, State},
    routing::{get, post},
    Json, Router,
};
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

use super::onboarding;

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/chat/sessions", get(chat_sessions))
        .route("/chat/history", get(chat_history))
        .route("/chat", post(chat))
        .route("/inbound-email", post(inbound_email))
        .route("/telegram", post(telegram_kevin))
}

fn kevin_daily_limit(is_basic: bool, is_pro: bool) -> i32 {
    if is_pro {
        i32::MAX
    } else if is_basic {
        200
    } else {
        20
    }
}

fn telegram_bot_secret_header_ok(headers: &HeaderMap, expected: &str) -> bool {
    if expected.is_empty() {
        return false;
    }
    headers
        .get("x-bot-secret")
        .and_then(|v| v.to_str().ok())
        .map(|s| s == expected)
        .unwrap_or(false)
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
    is_basic: bool,
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
        SELECT id, is_pro, is_basic, subscription_tier, role::text,
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

    let daily_limit = kevin_daily_limit(user.is_basic, user.is_pro);

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

            let limit_body = if !user.is_pro && !user.is_basic {
                "You've used your 20 daily Kevin messages across all channels. Upgrade to Basic at platform.metatron.id/pricing for 200 messages/day."
            } else {
                "You've reached your daily Kevin limit. It resets at midnight UTC."
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
    let memory_section = memory_section_from_recalled(recalled);

    let system = format!(
        r#"You are Kevin, the AI copilot for Metatron (metatron.id).

Metatron is the intelligence layer connecting founders, investors, and ecosystem partners globally. You help users navigate fundraising, diligence, pitch refinement, and relationship context. Be concise, practical, and professional.

## Current user context
{context}{memory_section}

Stay in character as Kevin. You have tools to:
- Look up and introduce matched investors/founders on the Metatron network (search_network)
- Search the open web for investors, funds, and companies NOT yet on the platform (search_web)
- Email pitch decks to interested investors

CRITICAL RULES — follow these exactly:
1. NEVER fabricate investor names, firm names, or any details. If a tool returns empty results, say so honestly: "I did not find any investors matching that in the Metatron network."
2. NEVER use placeholder text like [Investor Name], [Firm Name], [Details], or any bracket placeholders. Only report information that was actually returned by a tool.
3. When search_network returns no results, immediately use search_web to find investors on the open web instead. Do not stop at an empty network result.
4. When reporting tool results, quote the exact names and details returned. Do not paraphrase or invent additional context.
5. Do not say you cannot search the web — you can, using search_web.
6. Each message you receive is a fresh request — you do not automatically retain the actual data from tool calls made in earlier messages, only the summary text you wrote. If a user asks for details, names, or specifics about something you previously said you found (e.g. "send me their details," "tell me more about them"), and you do not see the literal tool output for that search earlier in this exact conversation, you must call the tool again before answering. Never answer a follow-up like this from memory of your own prior summary — that is exactly how placeholder text like [Investor Name 1] happens.

Do not use markdown formatting. No bold, no asterisks, no bullet point symbols. Plain text only."#
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
        Ok((r, usage)) => {
            let tier = if user.is_pro { "pro" } else if user.is_basic { "basic" } else { "free" };
            crate::cost::record_llm_usage(
                &state.db,
                Some(user.id),
                Some(user.role.as_str()),
                Some(tier),
                "kevin_email",
                provider,
                model,
                usage.input_tokens,
                usage.output_tokens,
            )
            .await;
            strip_markdown(&r)
        }
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

    let db2 = state.db.clone();
    let uid2 = user.id;
    let user_msg = last_user_message.clone();
    let assistant_msg = reply.clone();
    tokio::spawn(async move {
        let _ = sqlx::query(
            "INSERT INTO kevin_chat_turns (user_id, role, content) VALUES ($1, 'user', $2), ($1, 'assistant', $3)",
        )
        .bind(uid2)
        .bind(&user_msg)
        .bind(&assistant_msg)
        .execute(&db2)
        .await;
    });
}

#[derive(Deserialize)]
pub struct ChatRequest {
    pub messages: Vec<ChatMessage>,
    #[serde(default)]
    pub system_context: Option<String>,
    #[serde(default)]
    pub session_id: Option<Uuid>,
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

#[derive(Deserialize)]
pub struct TelegramInboundRequest {
    pub telegram_id: i64,
    pub message: String,
}

#[derive(Serialize)]
struct TelegramJsonError {
    error: String,
    message: String,
}

#[derive(sqlx::FromRow)]
pub(crate) struct UserForTelegram {
    pub id: Uuid,
    pub is_pro: bool,
    pub is_basic: bool,
    pub subscription_tier: String,
    pub role: String,
    pub custom_ai_provider: Option<String>,
    pub custom_ai_api_key: Option<String>,
    pub custom_ai_model: Option<String>,
}

pub(crate) enum KevinReplyError {
    Limit(String),
    ServiceUnavailable,
    BadGateway(String),
    Internal,
}

/// Shared Kevin single-turn reply for Telegram, WhatsApp, etc.
pub(crate) async fn kevin_reply_for_linked_user(
    state: &Arc<AppState>,
    user: UserForTelegram,
    message: String,
) -> Result<String, KevinReplyError> {
    let last_user_message = message.clone();
    let msgs = vec![("user".to_string(), message)];

    let custom_ai_api_key = match user.custom_ai_api_key {
        Some(ref encrypted) => match crypto::decrypt(&state.encryption_key, encrypted) {
            Ok(value) => Some(value),
            Err(e) => {
                tracing::warn!("kevin linked user: custom_ai_api_key decrypt failed: {e}");
                None
            }
        },
        None => None,
    };

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
                tracing::warn!("kevin linked user: memory recall failed: {e}");
                Vec::new()
            }
        }
    };

    let context = build_context(state, user.id, &user.role).await;
    let memory_section = memory_section_from_recalled(recalled);

    let system = format!(
        r#"You are Kevin, the AI copilot for Metatron (metatron.id).

Metatron is the intelligence layer connecting founders, investors, and ecosystem partners globally. You help users navigate fundraising, diligence, pitch refinement, and relationship context. Be concise, practical, and professional.

## Current user context
{context}{memory_section}

Stay in character as Kevin. You are talking to this user over Telegram or WhatsApp, not the web app.

CRITICAL RULES — follow these exactly:
1. Your "Current top matches" above (if present) are this user's real, current matches. When the user asks to see a match, asks "why is this a fit," or asks for details on something already listed there, answer directly from that data — name, fit score, one-liner, sector, stage, reasoning, deck link. Do NOT tell the user to log into the platform to see something that is already listed above.
2. Only send the user to platform.metatron.id if they want to take an action this chat can't do (e.g. requesting an intro, browsing beyond their current top matches, changing profile settings) — not merely to view a match already in your context.
3. NEVER fabricate investor names, firm names, scores, or any details not present in the context above. If something isn't there, say so honestly rather than inventing it.
4. NEVER use placeholder text like [Investor Name], [Firm Name], [Details], or any bracket placeholders.

Do not use markdown formatting. No bold, no asterisks, no bullet point symbols. Plain text only."#
    );

    let (provider, api_key, model) = if user.is_pro || user.is_basic {
        if let Some(key) = state.anthropic_api_key.as_deref() {
            ("anthropic", key, "claude-haiku-4-5-20251001")
        } else if let Some(key) = state.ai_api_key.as_deref() {
            ("gemini", key, "gemini-2.5-flash-lite")
        } else {
            return Err(KevinReplyError::ServiceUnavailable);
        }
    } else if let Some(key) = state.ai_api_key.as_deref() {
        ("gemini", key, "gemini-2.5-flash-lite")
    } else {
        return Err(KevinReplyError::ServiceUnavailable);
    };

    let daily_limit = kevin_daily_limit(user.is_basic, user.is_pro);

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
                tracing::error!("kevin linked user: usage upsert failed: {e}");
                return Err(KevinReplyError::Internal);
            }
        };

        if count > daily_limit {
            let _ = sqlx::query(
                "UPDATE kevin_daily_usage SET message_count = message_count - 1 WHERE user_id = $1 AND usage_date = CURRENT_DATE",
            )
            .bind(user.id)
            .execute(&state.db)
            .await;

            let limit_msg = if !user.is_pro && !user.is_basic {
                "You've used your 20 daily Kevin messages across all channels. Upgrade to Basic at platform.metatron.id/pricing for 200 messages/day.".to_string()
            } else {
                "You've reached your daily Kevin limit. It resets at midnight UTC.".to_string()
            };
            return Err(KevinReplyError::Limit(limit_msg));
        }
    }

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
        Ok((r, usage)) => {
            let tier = if user.is_pro { "pro" } else if user.is_basic { "basic" } else { "free" };
            crate::cost::record_llm_usage(
                &state.db,
                Some(user.id),
                Some(user.role.as_str()),
                Some(tier),
                "kevin_telegram_whatsapp",
                provider,
                model,
                usage.input_tokens,
                usage.output_tokens,
            )
            .await;
            r
        }
        Err(e) => {
            tracing::error!("kevin linked user: complete_chat failed: {e}");
            return Err(KevinReplyError::BadGateway(e));
        }
    };
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
                tracing::warn!("kevin linked user: memory store failed: {e}");
            }
        });
    }

    let db2 = state.db.clone();
    let uid2 = user.id;
    let user_msg = last_user_message.clone();
    let assistant_msg = reply.clone();
    tokio::spawn(async move {
        let _ = sqlx::query(
            "INSERT INTO kevin_chat_turns (user_id, role, content) VALUES ($1, 'user', $2), ($1, 'assistant', $3)",
        )
        .bind(uid2)
        .bind(&user_msg)
        .bind(&assistant_msg)
        .execute(&db2)
        .await;
    });

    Ok(reply)
}

async fn telegram_kevin(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<TelegramInboundRequest>,
) -> impl IntoResponse {
    if !telegram_bot_secret_header_ok(&headers, &state.platform_bot_secret) {
        return StatusCode::UNAUTHORIZED.into_response();
    }

    if body.message.trim().is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(TelegramJsonError {
                error: "bad_request".into(),
                message: "message required".into(),
            }),
        )
            .into_response();
    }

    let tg_id = body.telegram_id.to_string();
    let message = body.message;

    let user_row: Option<UserForTelegram> = match sqlx::query_as(
        r#"
        SELECT id, is_pro, is_basic, subscription_tier, role::text,
               custom_ai_provider, custom_ai_api_key, custom_ai_model
        FROM users WHERE telegram_id = $1
        "#,
    )
    .bind(&tg_id)
    .fetch_optional(&state.db)
    .await
    {
        Ok(r) => r,
        Err(e) => {
            tracing::error!("telegram kevin: user lookup failed: {e}");
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(TelegramJsonError {
                    error: "internal_error".into(),
                    message: "database error".into(),
                }),
            )
                .into_response();
        }
    };

    let Some(user) = user_row else {
        let reply = onboarding::handle_messaging_onboarding(&state, "telegram", &tg_id, &message)
            .await
            .unwrap_or_else(|e| {
                tracing::error!("telegram onboarding error: {e}");
                "Something went wrong. Please try again.".to_string()
            });
        return Json(ChatResponse { reply }).into_response();
    };

    match kevin_reply_for_linked_user(&state, user, message).await {
        Ok(reply) => Json(ChatResponse { reply }).into_response(),
        Err(KevinReplyError::Limit(msg)) => (
            StatusCode::TOO_MANY_REQUESTS,
            Json(TelegramJsonError {
                error: "limit_reached".into(),
                message: msg,
            }),
        )
            .into_response(),
        Err(KevinReplyError::ServiceUnavailable) => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(TelegramJsonError {
                error: "service_unavailable".into(),
                message: "AI not configured".into(),
            }),
        )
            .into_response(),
        Err(KevinReplyError::BadGateway(e)) => (
            StatusCode::BAD_GATEWAY,
            Json(TelegramJsonError {
                error: "bad_gateway".into(),
                message: e,
            }),
        )
            .into_response(),
        Err(KevinReplyError::Internal) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(TelegramJsonError {
                error: "internal_error".into(),
                message: "database error".into(),
            }),
        )
            .into_response(),
    }
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
    let memory_section = memory_section_from_recalled(recalled);

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

Stay in character as Kevin. You have tools to:
- Look up and introduce matched investors/founders on the Metatron network (search_network)
- Search the open web for investors, funds, and companies NOT yet on the platform (search_web)
- Email pitch decks to interested investors

CRITICAL RULES — follow these exactly:
1. NEVER fabricate investor names, firm names, or any details. If a tool returns empty results, say so honestly: "I did not find any investors matching that in the Metatron network."
2. NEVER use placeholder text like [Investor Name], [Firm Name], [Details], or any bracket placeholders. Only report information that was actually returned by a tool.
3. When search_network returns no results, immediately use search_web to find investors on the open web instead. Do not stop at an empty network result.
4. When reporting tool results, quote the exact names and details returned. Do not paraphrase or invent additional context.
5. Do not say you cannot search the web — you can, using search_web.
6. Each message you receive is a fresh request — you do not automatically retain the actual data from tool calls made in earlier messages, only the summary text you wrote. If a user asks for details, names, or specifics about something you previously said you found (e.g. "send me their details," "tell me more about them"), and you do not see the literal tool output for that search earlier in this exact conversation, you must call the tool again before answering. Never answer a follow-up like this from memory of your own prior summary — that is exactly how placeholder text like [Investor Name 1] happens.

Do not use markdown formatting. No bold, no asterisks, no bullet point symbols. Plain text only."#
    );

    let daily_limit = kevin_daily_limit(user.is_basic, user.is_pro);

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

            let msg = if !user.is_pro && !user.is_basic {
                "You've used your 20 daily Kevin messages across all channels. Upgrade to Basic at platform.metatron.id/pricing for 200 messages/day.".to_string()
            } else {
                "You've reached your daily Kevin limit. It resets at midnight UTC.".to_string()
            };
            return Err((StatusCode::TOO_MANY_REQUESTS, msg));
        }
    }

    let user_email: String = sqlx::query_scalar("SELECT email FROM users WHERE id = $1")
        .bind(user.id)
        .fetch_one(&state.db)
        .await
        .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "db error".into()))?;

    let anthropic_msgs: Vec<serde_json::Value> = msgs
        .iter()
        .map(|(role, content)| serde_json::json!({ "role": role, "content": content }))
        .collect();

    let reply = run_kevin_with_tools(
        &state,
        user.id,
        &user_email,
        &user.role,
        user.is_pro,
        user.is_basic,
        &system,
        anthropic_msgs,
        body.session_id,
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
                tracing::warn!("kevin memory store failed: {e}");
            }
        });
    }

    let db2 = state.db.clone();
    let uid2 = user.id;
    let user_msg = last_user_message.clone();
    let assistant_msg = reply.clone();
    let session_id = body.session_id;
    tokio::spawn(async move {
        let _ = sqlx::query(
            r#"INSERT INTO kevin_chat_turns (user_id, role, content, session_id)
               VALUES ($1, 'user', $2, $3), ($1, 'assistant', $4, $3)"#,
        )
        .bind(uid2)
        .bind(&user_msg)
        .bind(session_id)
        .bind(&assistant_msg)
        .execute(&db2)
        .await;
    });

    Ok(Json(ChatResponse { reply }))
}

#[derive(Deserialize)]
struct HistoryParams {
    session_id: Option<Uuid>,
}

#[derive(Serialize)]
struct SessionSummary {
    session_id: Uuid,
    title: String,
    last_message_at: String,
    message_count: i64,
}

async fn chat_sessions(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
) -> Result<Json<Vec<SessionSummary>>, (StatusCode, String)> {
    let user = require_user(&state, bearer.token()).await?;

    #[derive(sqlx::FromRow)]
    struct SessionRow {
        session_id: Uuid,
        title: String,
        last_message_at: String,
        message_count: i64,
    }

    let rows: Vec<SessionRow> = sqlx::query_as(
        r#"
        SELECT
            t.session_id,
            COALESCE(
                (SELECT t2.content FROM kevin_chat_turns t2
                 WHERE t2.session_id = t.session_id
                   AND t2.user_id = $1
                   AND t2.role = 'user'
                 ORDER BY t2.created_at ASC
                 LIMIT 1),
                ''
            ) AS title,
            MAX(t.created_at)::text AS last_message_at,
            COUNT(*)::bigint AS message_count
        FROM kevin_chat_turns t
        WHERE t.user_id = $1 AND t.session_id IS NOT NULL
        GROUP BY t.session_id
        ORDER BY MAX(t.created_at) DESC
        LIMIT 30
        "#,
    )
    .bind(user.id)
    .fetch_all(&state.db)
    .await
    .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "db error".into()))?;

    Ok(Json(
        rows
            .into_iter()
            .map(|r| SessionSummary {
                session_id: r.session_id,
                title: r.title.chars().take(50).collect::<String>(),
                last_message_at: r.last_message_at,
                message_count: r.message_count,
            })
            .collect(),
    ))
}

async fn chat_history(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
    Query(params): Query<HistoryParams>,
) -> Result<Json<Vec<ChatMessage>>, (StatusCode, String)> {
    let user = require_user(&state, bearer.token()).await?;

    let rows: Vec<(String, String)> = if let Some(sid) = params.session_id {
        sqlx::query_as(
            r#"SELECT role, content FROM kevin_chat_turns
               WHERE user_id = $1 AND session_id = $2
               ORDER BY created_at ASC"#,
        )
        .bind(user.id)
        .bind(sid)
        .fetch_all(&state.db)
        .await
    } else {
        sqlx::query_as(
            r#"
            SELECT role, content FROM (
                SELECT role, content, created_at
                FROM kevin_chat_turns
                WHERE user_id = $1
                ORDER BY created_at DESC
                LIMIT 40
            ) sub ORDER BY sub.created_at ASC
            "#,
        )
        .bind(user.id)
        .fetch_all(&state.db)
        .await
    }
    .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "db error".into()))?;

    Ok(Json(
        rows
            .into_iter()
            .map(|(role, content)| ChatMessage { role, content })
            .collect(),
    ))
}

fn memory_section_from_recalled(recalled: Vec<String>) -> String {
    if recalled.is_empty() {
        return String::new();
    }
    let lines = recalled
        .into_iter()
        .map(|m| format!("- {m}"))
        .collect::<Vec<_>>()
        .join("\n");
    format!(
        "\n\n## Kevin's memory of this user\nYou have recalled the following facts about this user from previous conversations. Reference them naturally when relevant — especially at the start of a new conversation:\n{lines}"
    )
}

pub(crate) async fn build_context(state: &AppState, user_id: uuid::Uuid, role: &str) -> String {
    let friendly_role = match role {
        "STARTUP" => "Founder",
        "INVESTOR" => "Investor",
        "INTERMEDIARY" => "Connector",
        _ => role,
    };
    let mut parts = vec![format!("Role: {friendly_role}")];

    if let Ok(Some(email)) = sqlx::query_scalar::<_, String>("SELECT email FROM users WHERE id = $1")
        .bind(user_id)
        .fetch_optional(&state.db)
        .await
    {
        parts.push(format!("Email: {email}"));
    }

    if let Ok(row) = sqlx::query_as::<_, ProfileCtx>(
        r#"
        SELECT company_name, one_liner, stage, sector, country::text, website, pitch_deck_url,
               context_ipfs_url, deck_text
        FROM profiles WHERE user_id = $1
        "#,
    )
    .bind(user_id)
    .fetch_optional(&state.db)
    .await
    {
        if let Some(p) = row {
            let mut profile_parts = Vec::new();
            if let Some(v) = p.company_name {
                profile_parts.push(format!("Company: {v}"));
            }
            if let Some(v) = p.one_liner {
                profile_parts.push(format!("One-liner: {v}"));
            }
            if let Some(v) = p.stage {
                profile_parts.push(format!("Stage: {v}"));
            }
            if let Some(v) = p.sector {
                profile_parts.push(format!("Sector: {v}"));
            }
            if let Some(v) = p.country {
                profile_parts.push(format!("Country: {v}"));
            }
            if let Some(v) = p.website {
                profile_parts.push(format!("Website: {v}"));
            }
            if let Some(v) = p.pitch_deck_url {
                profile_parts.push(format!("Deck URL: {v}"));
            }
            if let Some(v) = p.context_ipfs_url {
                profile_parts.push(format!("Data profile (IPFS): {v}"));
            }
            if !profile_parts.is_empty() {
                parts.push(format!(
                    "Founder profile:\n{}",
                    profile_parts.join("\n")
                ));
            }
            if let Some(ref t) = p.deck_text {
                if !t.trim().is_empty() {
                    parts.push(format!("\n## Pitch deck contents\n{}", t));
                }
            }
        }
    }

    if let Ok(rows) = sqlx::query_as::<_, PitchCtx>(
        r#"
        SELECT title, description, problem, solution, market_size, business_model,
               traction, funding_ask, use_of_funds, incorporation_country
        FROM pitches WHERE created_by = $1 ORDER BY created_at DESC LIMIT 3
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
                    let mut s = format!("Pitch: {}", p.title);
                    if let Some(v) = p.description {
                        s.push_str(&format!("\n  One-liner: {v}"));
                    }
                    if let Some(v) = p.problem {
                        s.push_str(&format!("\n  Problem: {v}"));
                    }
                    if let Some(v) = p.solution {
                        s.push_str(&format!("\n  Solution: {v}"));
                    }
                    if let Some(v) = p.market_size {
                        s.push_str(&format!("\n  Market: {v}"));
                    }
                    if let Some(v) = p.business_model {
                        s.push_str(&format!("\n  Business model: {v}"));
                    }
                    if let Some(v) = p.traction {
                        s.push_str(&format!("\n  Traction: {v}"));
                    }
                    if let Some(v) = p.funding_ask {
                        s.push_str(&format!("\n  Funding ask: {v}"));
                    }
                    if let Some(v) = p.use_of_funds {
                        s.push_str(&format!("\n  Use of funds: {v}"));
                    }
                    if let Some(v) = p.incorporation_country {
                        s.push_str(&format!("\n  Country: {v}"));
                    }
                    s
                })
                .collect();
            parts.push(format!("Pitch data:\n{}", lines.join("\n\n")));
        }
    }

    #[derive(sqlx::FromRow)]
    struct CallCtx {
        original_filename: String,
        analysis: Option<sqlx::types::Json<serde_json::Value>>,
        source: Option<String>,
    }

    if let Ok(rows) = sqlx::query_as::<_, CallCtx>(
        r#"
        SELECT original_filename, analysis, source
        FROM call_recordings
        WHERE user_id = $1 AND analysis IS NOT NULL
        ORDER BY created_at DESC
        LIMIT 5
        "#,
    )
    .bind(user_id)
    .fetch_all(&state.db)
    .await
    {
        if !rows.is_empty() {
            let lines: Vec<String> = rows
                .into_iter()
                .map(|c| {
                    let a = c.analysis.map(|sqlx::types::Json(v)| v).unwrap_or_default();
                    let mut s = format!(
                        "Call: {} (source: {})",
                        c.original_filename,
                        c.source.as_deref().unwrap_or("manual upload")
                    );
                    if let Some(v) = a.get("summary").and_then(|v| v.as_str()) {
                        s.push_str(&format!("\n  Summary: {v}"));
                    }
                    if let Some(v) = a.get("investor_sentiment").and_then(|v| v.as_str()) {
                        s.push_str(&format!("\n  Investor sentiment: {v}"));
                    }
                    if let Some(items) = a.get("key_takeaways").and_then(|v| v.as_array()) {
                        let items: Vec<&str> = items.iter().filter_map(|x| x.as_str()).collect();
                        if !items.is_empty() {
                            s.push_str(&format!("\n  Key takeaways: {}", items.join("; ")));
                        }
                    }
                    if let Some(items) = a.get("action_items").and_then(|v| v.as_array()) {
                        let items: Vec<&str> = items.iter().filter_map(|x| x.as_str()).collect();
                        if !items.is_empty() {
                            s.push_str(&format!("\n  Action items: {}", items.join("; ")));
                        }
                    }
                    s
                })
                .collect();
            parts.push(format!(
                "Call intelligence (most recent calls, incl. imported Fireflies/Fathom/tl;dv notes):\n{}",
                lines.join("\n\n")
            ));
        }
    }

    if let Ok(row) = sqlx::query_as::<_, InvestorCtx>(
        r#"
        SELECT firm_name, sectors, stages FROM investor_profiles WHERE user_id = $1
        "#,
    )
    .bind(user_id)
    .fetch_optional(&state.db)
    .await
    {
        if let Some(i) = row {
            if let Some(v) = i.firm_name {
                parts.push(format!("Investment firm: {v}"));
            }
            parts.push(format!(
                "Investor preferences: sectors={:?} stages={:?}",
                i.sectors, i.stages
            ));
        }
    }

    // Current matches — inlined so Kevin can discuss them directly on
    // Telegram/WhatsApp, which have no tool-calling loop to fetch this
    // live (unlike the web chat widget's lookup_match tool).
    if let Ok(matches) = crate::routes::kevin_matches::fetch_kevin_matches_for_user(state, user_id, None).await {
        let top: Vec<_> = matches.into_iter().take(5).collect();
        if !top.is_empty() {
            let lines: Vec<String> = top
                .into_iter()
                .map(|m| {
                    let name = m
                        .company_name
                        .or(m.firm_name)
                        .unwrap_or_else(|| "Unnamed match".to_string());
                    let mut s = format!("Match: {name} ({}% fit)", m.score);
                    if let Some(v) = m.one_liner {
                        s.push_str(&format!("\n  One-liner: {v}"));
                    }
                    if let Some(v) = m.sector {
                        s.push_str(&format!("\n  Sector: {v}"));
                    }
                    if let Some(v) = m.stage {
                        s.push_str(&format!("\n  Stage: {v}"));
                    }
                    if let Some(v) = m.country {
                        s.push_str(&format!("\n  Country: {v}"));
                    }
                    if let Some(v) = m.reasoning {
                        s.push_str(&format!("\n  Why it's a fit: {v}"));
                    }
                    if let Some(v) = m.deck_url {
                        s.push_str(&format!("\n  Deck: {v}"));
                    }
                    s
                })
                .collect();
            parts.push(format!(
                "Current top matches (share these details directly when asked — no need to send the user to the platform to see them):\n{}",
                lines.join("\n\n")
            ));
        }
    }

    // Network-level ambient awareness
    if let Ok(row) = sqlx::query_as::<_, (i64, i64, i64)>(
        "SELECT (SELECT COUNT(*) FROM profiles WHERE company_name IS NOT NULL), (SELECT COUNT(*) FROM investor_profiles), (SELECT COUNT(*) FROM introductions WHERE status = 'accepted')"
    )
    .fetch_optional(&state.db)
    .await
    {
        if let Some((founders, investors, intros)) = row {
            parts.push(format!(
                "Network: {} founders · {} investors · {} accepted intros on metatron",
                founders, investors, intros
            ));
        }
    }

    // Gospel knowledge injected by admin
    if let Ok(rows) = sqlx::query_as::<_, (String, String)>(
        r#"SELECT title, body FROM kevin_knowledge
           WHERE role_target = 'all' OR role_target = $1
           ORDER BY created_at ASC"#,
    )
    .bind(role)
    .fetch_all(&state.db)
    .await
    {
        if !rows.is_empty() {
            let knowledge: Vec<String> = rows
                .into_iter()
                .map(|(title, body)| format!("### {title}\n{body}"))
                .collect();
            parts.push(format!("\n## Kevin Knowledge (gospel — always follow)\n{}", knowledge.join("\n\n")));
        }
    }

    // Auto-learned patterns from network activity (see kevin_learning.rs) —
    // same injection shape as kevin_knowledge above, but generated weekly
    // from outcome data rather than admin-authored. Softer framing since
    // these are inferred patterns, not hard rules.
    if let Ok(rows) = sqlx::query_as::<_, (String, String)>(
        r#"SELECT title, body FROM kevin_insights
           WHERE role_target = 'all' OR role_target = $1
           ORDER BY generated_at ASC"#,
    )
    .bind(role)
    .fetch_all(&state.db)
    .await
    {
        if !rows.is_empty() {
            let insights: Vec<String> = rows
                .into_iter()
                .map(|(title, body)| format!("### {title}\n{body}"))
                .collect();
            parts.push(format!(
                "\n## Learned patterns (from network activity — useful context, not hard rules)\n{}",
                insights.join("\n\n")
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
    context_ipfs_url: Option<String>,
    deck_text: Option<String>,
}

#[derive(sqlx::FromRow)]
struct PitchCtx {
    title: String,
    description: Option<String>,
    problem: Option<String>,
    solution: Option<String>,
    market_size: Option<String>,
    business_model: Option<String>,
    traction: Option<String>,
    funding_ask: Option<String>,
    use_of_funds: Option<String>,
    incorporation_country: Option<String>,
}

#[derive(sqlx::FromRow)]
struct InvestorCtx {
    firm_name: Option<String>,
    sectors: Option<Vec<String>>,
    stages: Option<Vec<String>>,
}

pub(crate) fn kevin_tools_for_role(role: &str) -> serde_json::Value {
    let mut tools = vec![
        serde_json::json!({
            "name": "lookup_match",
            "description": "Look up a matched startup or investor by name. Returns their profile and match details.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "name": {
                        "type": "string",
                        "description": "The name of the startup or investor to look up"
                    }
                },
                "required": ["name"]
            }
        }),
        serde_json::json!({
            "name": "request_intro",
            "description": "Request an introduction to a matched startup or investor.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "matched_user_id": {
                        "type": "string",
                        "description": "The UUID of the matched user to request an intro to"
                    }
                },
                "required": ["matched_user_id"]
            }
        }),
    ];

    if role == "INVESTOR" {
        tools.push(serde_json::json!({
            "name": "email_pitch_deck",
            "description": "Email a matched startup's pitch deck link to the investor's registered email address.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "matched_user_id": {
                        "type": "string",
                        "description": "The UUID of the matched startup whose deck to send"
                    }
                },
                "required": ["matched_user_id"]
            }
        }));
    }

    tools.push(serde_json::json!({
        "name": "search_network",
        "description": "Search the metatron network for founders, investors, or connectors by name, sector, stage, or country. Use this to answer questions about who is in the network, what companies are raising, or which investors are active.",
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Search term: company name, sector, stage, country, investor firm name, or any keyword"
                },
                "filter": {
                    "type": "string",
                    "enum": ["founders", "investors", "all"],
                    "description": "Which part of the network to search. Default: all"
                }
            },
            "required": ["query"]
        }
    }));

    tools.push(serde_json::json!({
        "name": "search_web",
        "description": "Search the open web for investors, companies, funds, or market information that is NOT in the metatron network. Use this when the user asks to find investors outside the platform, research a specific VC firm, or explore a market. Returns real-time results with citations.",
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "The search query, e.g. \"fintech investors Southeast Asia seed stage\""
                }
            },
            "required": ["query"]
        }
    }));

    serde_json::json!(tools)
}

pub(crate) fn kevin_tools_for_gemini(role: &str) -> serde_json::Value {
    let mut declarations = vec![
        serde_json::json!({
            "name": "lookup_match",
            "description": "Look up a matched startup or investor by name. Returns their profile and match details.",
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {
                        "type": "string",
                        "description": "The name of the startup or investor to look up"
                    }
                },
                "required": ["name"]
            }
        }),
        serde_json::json!({
            "name": "request_intro",
            "description": "Request an introduction to a matched startup or investor.",
            "parameters": {
                "type": "object",
                "properties": {
                    "matched_user_id": {
                        "type": "string",
                        "description": "The UUID of the matched user to request an intro to"
                    }
                },
                "required": ["matched_user_id"]
            }
        }),
    ];

    if role == "INVESTOR" {
        declarations.push(serde_json::json!({
            "name": "email_pitch_deck",
            "description": "Email a matched startup's pitch deck link to the investor's registered email address.",
            "parameters": {
                "type": "object",
                "properties": {
                    "matched_user_id": {
                        "type": "string",
                        "description": "The UUID of the matched startup whose deck to send"
                    }
                },
                "required": ["matched_user_id"]
            }
        }));
    }

    declarations.push(serde_json::json!({
        "name": "search_network",
        "description": "Search the metatron network for founders, investors, or connectors by name, sector, stage, or country.",
        "parameters": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Search term"
                },
                "filter": {
                    "type": "string",
                    "description": "founders | investors | all"
                }
            },
            "required": ["query"]
        }
    }));

    declarations.push(serde_json::json!({
        "name": "search_web",
        "description": "Search the open web for investors, companies, funds, or market information that is NOT in the metatron network. Use when the user wants to find investors outside the platform or research a specific firm.",
        "parameters": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "The search query"
                }
            },
            "required": ["query"]
        }
    }));

    serde_json::json!([{ "function_declarations": declarations }])
}


pub(crate) fn kevin_tools_for_openai(role: &str) -> serde_json::Value {
    let anthropic_tools = kevin_tools_for_role(role);
    let tools = anthropic_tools.as_array().map(|arr| {
        arr.iter().map(|t| serde_json::json!({
            "type": "function",
            "function": {
                "name": t["name"],
                "description": t["description"],
                "parameters": t["input_schema"]
            }
        })).collect::<Vec<_>>()
    }).unwrap_or_default();
    serde_json::json!(tools)
}

pub(crate) async fn execute_kevin_tool(
    state: &AppState,
    user_id: Uuid,
    user_email: &str,
    role: &str,
    tool_name: &str,
    tool_input: &serde_json::Value,
) -> String {
    match tool_name {
        "lookup_match" => {
            let name = tool_input["name"].as_str().unwrap_or("").to_lowercase();
            if name.is_empty() {
                return "No name provided.".to_string();
            }

            #[derive(sqlx::FromRow)]
            struct MatchRow {
                matched_user_id: Uuid,
                display_name: Option<String>,
                score: i32,
                match_type: String,
                intro_requested_at: Option<chrono::DateTime<chrono::Utc>>,
                intro_accepted_at: Option<chrono::DateTime<chrono::Utc>>,
            }

            let rows: Vec<MatchRow> = sqlx::query_as(
                r#"SELECT km.matched_user_id, km.display_name, km.score, km.match_type,
                          km.intro_requested_at, km.intro_accepted_at
                   FROM kevin_matches km
                   WHERE km.for_user_id = $1
                     AND LOWER(km.display_name) LIKE $2
                   LIMIT 5"#,
            )
            .bind(user_id)
            .bind(format!("%{name}%"))
            .fetch_all(&state.db)
            .await
            .unwrap_or_default();

            if rows.is_empty() {
                return format!("No matches found for '{name}'.");
            }

            let mut parts = Vec::new();
            for r in rows {
                let mut info = format!(
                    "Name: {}\nID: {}\nMatch type: {}\nScore: {}",
                    r.display_name.as_deref().unwrap_or("Unknown"),
                    r.matched_user_id,
                    r.match_type,
                    r.score,
                );
                if r.intro_requested_at.is_some() {
                    info.push_str("\nIntro: requested");
                }
                if r.intro_accepted_at.is_some() {
                    info.push_str(", accepted");
                }

                if r.match_type == "founder_investor" || r.match_type == "investor_founder" {
                    let profile: Option<(
                        Option<String>,
                        Option<String>,
                        Option<String>,
                        Option<String>,
                    )> = sqlx::query_as(
                        "SELECT company_name, one_liner, stage, sector FROM profiles WHERE user_id = $1",
                    )
                    .bind(r.matched_user_id)
                    .fetch_optional(&state.db)
                    .await
                    .ok()
                    .flatten();

                    if let Some((company, one_liner, stage, sector)) = profile {
                        if let Some(v) = company {
                            info.push_str(&format!("\nCompany: {v}"));
                        }
                        if let Some(v) = one_liner {
                            info.push_str(&format!("\nOne-liner: {v}"));
                        }
                        if let Some(v) = stage {
                            info.push_str(&format!("\nStage: {v}"));
                        }
                        if let Some(v) = sector {
                            info.push_str(&format!("\nSector: {v}"));
                        }
                    }

                    let deck: Option<(Option<String>,)> = sqlx::query_as(
                        r#"SELECT CASE WHEN deck_expires_at IS NULL OR deck_expires_at > now()
                                       THEN pitch_deck_url ELSE NULL END
                           FROM profiles WHERE user_id = $1"#,
                    )
                    .bind(r.matched_user_id)
                    .fetch_optional(&state.db)
                    .await
                    .ok()
                    .flatten();

                    if let Some((Some(url),)) = deck {
                        info.push_str(&format!("\nPitch deck: {url}"));
                    }
                }

                parts.push(info);
            }

            parts.join("\n\n---\n\n")
        }

        "request_intro" => {
            let matched_id_str = tool_input["matched_user_id"].as_str().unwrap_or("");
            let matched_id: Uuid = match matched_id_str.parse() {
                Ok(id) => id,
                Err(_) => return "Invalid matched_user_id.".to_string(),
            };

            let exists: bool = sqlx::query_scalar(
                "SELECT EXISTS(SELECT 1 FROM kevin_matches WHERE for_user_id = $1 AND matched_user_id = $2)",
            )
            .bind(user_id)
            .bind(matched_id)
            .fetch_one(&state.db)
            .await
            .unwrap_or(false);

            if !exists {
                return "This user is not in your matches.".to_string();
            }

            let already: bool = sqlx::query_scalar(
                "SELECT EXISTS(SELECT 1 FROM kevin_matches WHERE for_user_id = $1 AND matched_user_id = $2 AND intro_requested_at IS NOT NULL)",
            )
            .bind(user_id)
            .bind(matched_id)
            .fetch_one(&state.db)
            .await
            .unwrap_or(false);

            if already {
                return "An intro has already been requested with this person.".to_string();
            }

            let updated = sqlx::query(
                "UPDATE kevin_matches SET intro_requested_at = now() WHERE for_user_id = $1 AND matched_user_id = $2",
            )
            .bind(user_id)
            .bind(matched_id)
            .execute(&state.db)
            .await;

            if updated.is_err() {
                return "Failed to record intro request.".to_string();
            }

            #[derive(sqlx::FromRow)]
            struct NotifyRow {
                email: String,
                display_name: Option<String>,
                telegram_id: Option<String>,
            }
            let notify: Option<NotifyRow> = sqlx::query_as(
                r#"SELECT u.email, km.display_name, u.telegram_id
                   FROM users u
                   JOIN kevin_matches km ON km.for_user_id = $1 AND km.matched_user_id = u.id
                   WHERE u.id = $2"#,
            )
            .bind(user_id)
            .bind(matched_id)
            .fetch_optional(&state.db)
            .await
            .ok()
            .flatten();

            let matched_name = notify
                .as_ref()
                .and_then(|n| n.display_name.as_deref())
                .unwrap_or("your match");

            let requester_name: Option<String> = sqlx::query_scalar(
                "SELECT COALESCE(p.company_name, ip.firm_name, u.email) FROM users u \
                 LEFT JOIN profiles p ON p.user_id = u.id \
                 LEFT JOIN investor_profiles ip ON ip.user_id = u.id \
                 WHERE u.id = $1",
            )
            .bind(user_id)
            .fetch_optional(&state.db)
            .await
            .ok()
            .flatten();

            let requester_display = requester_name.as_deref().unwrap_or(user_email);

            if let (Some(bot_token), Some(chat_id)) = (
                state.telegram_bot_token.as_deref(),
                notify.as_ref().and_then(|n| n.telegram_id.as_deref()).filter(|t| !t.is_empty()),
            ) {
                let text = format!(
                    "You have a new intro request from {} on metatron. Log in to platform.metatron.id to respond.",
                    requester_display
                );
                let url = format!("https://api.telegram.org/bot{bot_token}/sendMessage");
                let _ = state
                    .http_client
                    .post(&url)
                    .json(&serde_json::json!({ "chat_id": chat_id, "text": text }))
                    .send()
                    .await;
            }

            // Send HTML email notification via Resend
            if let (Some(resend_key), Some(notify_row)) = (&state.resend_api_key, &notify) {
                let recipient_role: Option<String> = sqlx::query_scalar(
                    "SELECT role FROM users WHERE id = $1",
                )
                .bind(matched_id)
                .fetch_optional(&state.db)
                .await
                .ok()
                .flatten();

                let matches_href = match recipient_role.as_deref() {
                    Some("INVESTOR") => "https://platform.metatron.id/investor/matches",
                    _ => "https://platform.metatron.id/startup/matches",
                };

                // Company name on the recipient's profile (e.g. startup when investor receives mail)
                let founder_company: String = sqlx::query_scalar(
                    "SELECT COALESCE(p.company_name, 'your startup') FROM profiles p WHERE p.user_id = $1",
                )
                .bind(matched_id)
                .fetch_optional(&state.db)
                .await
                .ok()
                .flatten()
                .unwrap_or_else(|| "your startup".to_string());

                // Requester context: investor thesis line, or founder one-liner / stage · sector
                #[derive(sqlx::FromRow)]
                struct InvestorEnrichment {
                    focus: String,
                    investment_thesis: Option<String>,
                    ticket_size_min: Option<i64>,
                    ticket_size_max: Option<i64>,
                }
                let enrichment: Option<InvestorEnrichment> = sqlx::query_as(
                    r#"SELECT
                         COALESCE(
                           array_to_string(sectors, ', ') || CASE WHEN stages IS NOT NULL THEN ' · ' || array_to_string(stages, ', ') ELSE '' END,
                           'Early-stage'
                         ) AS focus,
                         investment_thesis,
                         ticket_size_min,
                         ticket_size_max
                       FROM investor_profiles WHERE user_id = $1"#,
                )
                .bind(user_id)
                .fetch_optional(&state.db)
                .await
                .ok()
                .flatten();
                let investor_focus = enrichment
                    .as_ref()
                    .map(|e| e.focus.clone())
                    .unwrap_or_else(|| "Early-stage".to_string());
                let has_investor_profile = enrichment.is_some();

                let founder_context: String = sqlx::query_scalar::<_, String>(
                    r#"SELECT COALESCE(
                         NULLIF(TRIM(CONCAT_WS(' · ', NULLIF(TRIM(stage), ''), NULLIF(TRIM(sector), ''))), ''),
                         NULLIF(TRIM(one_liner), ''),
                         'Founder'
                       )
                       FROM profiles WHERE user_id = $1"#,
                )
                .bind(user_id)
                .fetch_optional(&state.db)
                .await
                .ok()
                .flatten()
                .unwrap_or_else(|| "Founder".to_string());

                let context_line = if has_investor_profile {
                    investor_focus
                } else {
                    founder_context
                };

                let subtitle = match recipient_role.as_deref() {
                    Some("INVESTOR") => format!(
                        "{} is requesting an introduction on metatron",
                        requester_display
                    ),
                    _ => format!(
                        "A matched contact wants to connect with {}",
                        founder_company
                    ),
                };

                let thesis_html = if has_investor_profile {
                    enrichment
                        .as_ref()
                        .and_then(|e| e.investment_thesis.as_deref())
                        .filter(|t| !t.trim().is_empty())
                        .map(|t| {
                            let safe = t
                                .replace('&', "&amp;")
                                .replace('<', "&lt;")
                                .replace('>', "&gt;")
                                .replace('"', "&quot;");
                            format!(r#"<p style="color:#8888a0;font-size:13px;font-style:italic;line-height:1.6;margin:0 0 12px">&ldquo;{}&rdquo;</p>"#, safe)
                        })
                        .unwrap_or_default()
                } else {
                    String::new()
                };

                let ticket_html = if has_investor_profile {
                    enrichment
                        .as_ref()
                        .and_then(|e| match (e.ticket_size_min, e.ticket_size_max) {
                            (Some(mn), Some(mx)) => Some(format!(
                                r#"<p style="color:#8888a0;font-size:12px;font-family:monospace;margin:0 0 16px">Check size: ${} – ${}</p>"#,
                                format_check_size(mn),
                                format_check_size(mx)
                            )),
                            (Some(mn), None) => Some(format!(
                                r#"<p style="color:#8888a0;font-size:12px;font-family:monospace;margin:0 0 16px">Check size: ${}+</p>"#,
                                format_check_size(mn)
                            )),
                            _ => None,
                        })
                        .unwrap_or_default()
                } else {
                    String::new()
                };

                let subject = format!("{} wants an intro on metatron", requester_display);
                let html = format!(r#"<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;600&display=swap');</style>
</head>
<body style="background:#0a0a0f;margin:0;padding:0;font-family:'DM Sans',system-ui,sans-serif">
  <div style="max-width:560px;margin:0 auto;padding:40px 20px">
    <div style="text-align:center;margin-bottom:32px">
      <img src="https://metatron.id/metatron-logo.png" alt="metatron" height="42" style="display:block;margin:0 auto">
    </div>
    <h1 style="color:#e8e8ed;font-size:24px;font-weight:600;text-align:center;margin:0 0 4px">New intro request</h1>
    <p style="color:#8888a0;font-size:14px;text-align:center;margin:0 0 28px">{}</p>
    <div style="background:#16161f;border:1px solid rgba(255,255,255,0.06);border-radius:12px;padding:24px;margin-bottom:16px">
      <p style="color:#e8e8ed;font-size:18px;font-weight:600;margin:0 0 4px">{}</p>
      <p style="color:#6c5ce7;font-size:12px;font-family:monospace;margin:0 0 12px">{}</p>
      {}{}
      <p style="color:#c0c0d0;font-size:14px;line-height:1.6;margin:0 0 24px">
        {} has matched with {} on metatron and requested an introduction. Log in to review the request and accept or decline.
      </p>
      <a href="{}"
         style="display:inline-block;background:#6c5ce7;color:#fff;border-radius:8px;padding:12px 24px;font-size:14px;font-weight:600;text-decoration:none">
        Review intro request
      </a>
    </div>
    <p style="color:#8888a0;font-size:12px;text-align:center;margin:24px 0 0;line-height:1.6">
      — The metatron team &nbsp;·&nbsp;
      <a href="https://platform.metatron.id" style="color:#6c5ce7;text-decoration:none">platform.metatron.id</a>
    </p>
  </div>
</body>
</html>"#,
                    subtitle,
                    requester_display,
                    context_line,
                    thesis_html,
                    ticket_html,
                    requester_display,
                    founder_company,
                    matches_href,
                );

                let body = serde_json::json!({
                    "from": "Kevin <kevin@metatron.id>",
                    "to": [notify_row.email.clone()],
                    "subject": subject,
                    "html": html,
                    "text": format!(
                        "{} has requested an introduction with {} on metatron.\n\nLog in to {} to accept or decline.\n\n— The metatron team",
                        requester_display, founder_company, matches_href
                    )
                });
                let intro_res = state
                    .http_client
                    .post("https://api.resend.com/emails")
                    .header("Authorization", format!("Bearer {resend_key}"))
                    .json(&body)
                    .send()
                    .await;
                match intro_res {
                    Ok(resp) => {
                        if !resp.status().is_success() {
                            let status = resp.status();
                            let err_body = resp.text().await.unwrap_or_default();
                            tracing::error!("intro email Resend error {status}: {err_body}");
                        }
                    }
                    Err(e) => tracing::error!("intro email send failed: {e}"),
                }
            }

            format!("Intro request sent to {}.", matched_name)
        }

        "email_pitch_deck" => {
            if role != "INVESTOR" {
                return "This action is only available to investors.".to_string();
            }

            let matched_id_str = tool_input["matched_user_id"].as_str().unwrap_or("");
            let matched_id: Uuid = match matched_id_str.parse() {
                Ok(id) => id,
                Err(_) => return "Invalid matched_user_id.".to_string(),
            };

            let exists: bool = sqlx::query_scalar(
                "SELECT EXISTS(SELECT 1 FROM kevin_matches WHERE for_user_id = $1 AND matched_user_id = $2)",
            )
            .bind(user_id)
            .bind(matched_id)
            .fetch_one(&state.db)
            .await
            .unwrap_or(false);

            if !exists {
                return "This startup is not in your matches.".to_string();
            }

            // Fetch richer company data for the email
            #[derive(sqlx::FromRow)]
            struct PitchEmailData {
                deck_url: Option<String>,
                title: String,
                one_liner: Option<String>,
                sector: Option<String>,
                stage: Option<String>,
                funding_ask: Option<String>,
            }
            let pitch_data: Option<PitchEmailData> = sqlx::query_as(
                r#"SELECT
                     CASE WHEN p.deck_expires_at IS NULL OR p.deck_expires_at > now()
                          THEN p.pitch_deck_url ELSE NULL END AS deck_url,
                     COALESCE(p.company_name, 'this startup') AS title,
                     COALESCE(p.one_liner,
                       (SELECT reasoning FROM kevin_matches
                        WHERE matched_user_id = p.user_id AND for_user_id = $2
                        ORDER BY generated_at DESC
                        LIMIT 1)
                     ) AS one_liner,
                     p.sector,
                     p.stage,
                     (SELECT funding_ask FROM pitches WHERE created_by = p.user_id ORDER BY created_at DESC LIMIT 1) AS funding_ask
                   FROM profiles p
                   WHERE p.user_id = $1"#,
            )
            .bind(matched_id)
            .bind(user_id)
            .fetch_optional(&state.db)
            .await
            .ok()
            .flatten();

            let pd = match pitch_data {
                Some(d) => d,
                None => return "This startup has not uploaded a pitch deck yet.".to_string(),
            };
            let deck_url = match pd.deck_url {
                Some(ref u) => u.clone(),
                None => return "This startup's pitch deck has expired.".to_string(),
            };

            if let Some(resend_key) = &state.resend_api_key {
                let sector_stage = match (&pd.sector, &pd.stage) {
                    (Some(s), Some(st)) => format!("{} · {}", s, st),
                    (Some(s), None) => s.clone(),
                    (None, Some(st)) => st.clone(),
                    _ => String::new(),
                };

                let html = format!(r#"<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;600&display=swap');</style>
</head>
<body style="background:#0a0a0f;margin:0;padding:0;font-family:'DM Sans',system-ui,sans-serif">
  <div style="max-width:560px;margin:0 auto;padding:40px 20px">
    <div style="text-align:center;margin-bottom:32px">
      <img src="https://metatron.id/metatron-logo.png" alt="metatron" height="42" style="display:block;margin:0 auto">
    </div>
    <h1 style="color:#e8e8ed;font-size:24px;font-weight:600;text-align:center;margin:0 0 4px">Pitch deck ready</h1>
    <p style="color:#8888a0;font-size:14px;text-align:center;margin:0 0 28px">Requested by Kevin on your behalf</p>
    <div style="background:#16161f;border:1px solid rgba(255,255,255,0.06);border-radius:12px;padding:24px;margin-bottom:16px">
      <p style="color:#e8e8ed;font-size:18px;font-weight:600;margin:0 0 4px">{}</p>
      {}
      {}
      {}
      <a href="{}"
         style="display:inline-block;background:#6c5ce7;color:#fff;border-radius:8px;padding:12px 24px;font-size:14px;font-weight:600;text-decoration:none;margin-top:8px">
        View pitch deck
      </a>
    </div>
    <p style="color:#8888a0;font-size:12px;text-align:center;margin:24px 0 0;line-height:1.6">
      — The metatron team &nbsp;·&nbsp;
      <a href="https://platform.metatron.id" style="color:#6c5ce7;text-decoration:none">platform.metatron.id</a>
    </p>
  </div>
</body>
</html>"#,
                    pd.title,
                    if sector_stage.is_empty() { String::new() } else {
                        format!(r#"<p style="color:#6c5ce7;font-size:12px;font-family:monospace;margin:0 0 12px">{}</p>"#, sector_stage)
                    },
                    pd.one_liner.as_deref().map(|s| format!(
                        r#"<p style="color:#c0c0d0;font-size:14px;line-height:1.6;margin:0 0 12px">{}</p>"#, s
                    )).unwrap_or_default(),
                    pd.funding_ask.as_deref().map(|s| format!(
                        r#"<p style="color:#8888a0;font-size:13px;font-family:monospace;margin:0 0 16px">Raising: {}</p>"#, s
                    )).unwrap_or_default(),
                    deck_url,
                );

                let result = state
                    .http_client
                    .post("https://api.resend.com/emails")
                    .header("Authorization", format!("Bearer {resend_key}"))
                    .json(&serde_json::json!({
                        "from": "Kevin <kevin@metatron.id>",
                        "to": [user_email],
                        "subject": format!("Pitch deck: {}", pd.title),
                        "html": html,
                        "text": format!("Pitch deck for {}:\n\n{}\n\n— Kevin", pd.title, deck_url)
                    }))
                    .send()
                    .await;

                match result {
                    Ok(r) if r.status().is_success() => {
                        format!("Pitch deck for {} sent to {}.", pd.title, user_email)
                    }
                    Ok(r) => {
                        let status = r.status();
                        let body = r.text().await.unwrap_or_default();
                        tracing::error!("Resend error {status}: {body}");
                        "Failed to send pitch deck email. Please try again.".to_string()
                    }
                    Err(e) => {
                        tracing::error!("pitch deck email send failed: {e}");
                        "Failed to send pitch deck email. Please try again.".to_string()
                    }
                }
            } else {
                "Email service not configured.".to_string()
            }
        }

        "search_network" => {
            let query = tool_input["query"].as_str().unwrap_or("").to_lowercase();
            let filter = tool_input["filter"].as_str().unwrap_or("all");

            if query.trim().is_empty() {
                return "Please provide a search term.".to_string();
            }

            let like = format!("%{query}%");
            let mut results = Vec::new();

            if filter == "founders" || filter == "all" {
                #[derive(sqlx::FromRow)]
                struct FounderResult {
                    company_name: Option<String>,
                    one_liner: Option<String>,
                    stage: Option<String>,
                    sector: Option<String>,
                    country: Option<String>,
                }
                let founders: Vec<FounderResult> = sqlx::query_as(
                    r#"SELECT company_name, one_liner, stage, sector, country::text
                       FROM profiles
                       WHERE company_name ILIKE $1
                          OR sector ILIKE $1
                          OR stage ILIKE $1
                          OR country::text ILIKE $1
                          OR one_liner ILIKE $1
                       ORDER BY updated_at DESC
                       LIMIT 8"#,
                )
                .bind(&like)
                .fetch_all(&state.db)
                .await
                .unwrap_or_default();

                for f in founders {
                    let mut line = format!("[Founder] {}", f.company_name.as_deref().unwrap_or("Unknown"));
                    if let Some(v) = f.one_liner { line.push_str(&format!(" — {v}")); }
                    let mut meta = Vec::new();
                    if let Some(v) = f.stage { meta.push(v); }
                    if let Some(v) = f.sector { meta.push(v); }
                    if let Some(v) = f.country { meta.push(v.trim().to_string()); }
                    if !meta.is_empty() { line.push_str(&format!(" ({})", meta.join(", "))); }
                    results.push(line);
                }
            }

            if filter == "investors" || filter == "all" {
                #[derive(sqlx::FromRow)]
                struct InvestorResult {
                    firm_name: Option<String>,
                    bio: Option<String>,
                    sectors: Option<Vec<String>>,
                    stages: Option<Vec<String>>,
                    country: Option<String>,
                }
                let investors: Vec<InvestorResult> = sqlx::query_as(
                    r#"SELECT firm_name, bio, sectors, stages, country
                       FROM investor_profiles
                       WHERE firm_name ILIKE $1
                          OR bio ILIKE $1
                          OR country ILIKE $1
                          OR sectors::text ILIKE $1
                          OR stages::text ILIKE $1
                       ORDER BY updated_at DESC
                       LIMIT 8"#,
                )
                .bind(&like)
                .fetch_all(&state.db)
                .await
                .unwrap_or_default();

                for i in investors {
                    let mut line = format!("[Investor] {}", i.firm_name.as_deref().unwrap_or("Unknown firm"));
                    if let Some(v) = i.bio { if !v.trim().is_empty() { line.push_str(&format!(" — {}", v.chars().take(120).collect::<String>())); } }
                    let mut meta = Vec::new();
                    if let Some(v) = i.sectors { if !v.is_empty() { meta.push(format!("sectors: {}", v.join(", "))); } }
                    if let Some(v) = i.stages { if !v.is_empty() { meta.push(format!("stages: {}", v.join(", "))); } }
                    if let Some(v) = i.country { meta.push(v); }
                    if !meta.is_empty() { line.push_str(&format!(" ({})", meta.join("; "))); }
                    results.push(line);
                }
            }

            if results.is_empty() {
                format!("No results found for '{query}' in the metatron network.")
            } else {
                results.join("
")
            }
        }

        "search_web" => {
            let query = tool_input["query"].as_str().unwrap_or("").trim().to_string();
            if query.is_empty() {
                return "Please provide a search query.".to_string();
            }

            let output = tokio::process::Command::new("openclaw")
                .args(["capability", "web", "search", "--query", &query, "--limit", "5", "--json"])
                .output()
                .await;

            match output {
                Err(e) => {
                    tracing::error!("search_web: openclaw spawn failed: {e}");
                    format!("Web search unavailable: {e}")
                }
                Ok(out) if !out.status.success() => {
                    let stderr = String::from_utf8_lossy(&out.stderr);
                    tracing::error!("search_web: openclaw error: {stderr}");
                    format!("Web search failed. Try a different query.")
                }
                Ok(out) => {
                    let raw = String::from_utf8_lossy(&out.stdout);
                    match serde_json::from_str::<serde_json::Value>(&raw) {
                        Err(_) => "Web search returned unreadable data.".to_string(),
                        Ok(json) => {
                            let result = &json["outputs"][0]["result"];
                            let content = result["content"].as_str().unwrap_or("").trim().to_string();
                            let citations = result["citations"]
                                .as_array()
                                .map(|arr| {
                                    arr.iter()
                                        .filter_map(|c| c["url"].as_str())
                                        .map(|u| format!("- {u}"))
                                        .collect::<Vec<_>>()
                                        .join("\n")
                                })
                                .unwrap_or_default();

                            if content.is_empty() {
                                "No results found for that query.".to_string()
                            } else if citations.is_empty() {
                                content
                            } else {
                                format!("{content}\n\nSources:\n{citations}")
                            }
                        }
                    }
                }
            }
        }

        _ => format!("Unknown tool: {tool_name}"),
    }
}

async fn run_kevin_with_tools_gemini(
    state: &AppState,
    user_id: Uuid,
    user_email: &str,
    role: &str,
    system: &str,
    initial_messages: &[serde_json::Value],
    api_key: &str,
    model: &str,
) -> (String, Vec<crate::kevin_context::ContextRow>, crate::ai::TokenUsage) {
    // `initial_messages` already arrives in Gemini-native {role, parts} shape
    // (built by kevin_context::to_gemini) — used as-is, not re-derived.
    let mut contents: Vec<serde_json::Value> = initial_messages.to_vec();
    let mut new_rows: Vec<crate::kevin_context::ContextRow> = Vec::new();
    // Each loop iteration is a fully separate, fully-billed API call that
    // resends the whole growing context — summing every iteration's
    // reported usage is the correct total spend for this turn, not double
    // counting.
    let mut usage = crate::ai::TokenUsage::default();

    let tools = kevin_tools_for_gemini(role);
    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
    );

    for _ in 0..4 {
        let body = serde_json::json!({
            "system_instruction": { "parts": [{ "text": system }] },
            "tools": tools,
            "contents": contents
        });

        let response = match state
            .http_client
            .post(&url)
            .query(&[("key", api_key)])
            .json(&body)
            .send()
            .await
        {
            Ok(r) => r,
            Err(e) => {
                tracing::error!("gemini tool call request failed: {e}");
                return ("Kevin is temporarily unavailable.".to_string(), new_rows, usage);
            }
        };

        if !response.status().is_success() {
            let status = response.status();
            let text = response.text().await.unwrap_or_default();
            tracing::error!("gemini tool call error {status}: {text}");
            return ("Kevin is temporarily unavailable.".to_string(), new_rows, usage);
        }

        let value: serde_json::Value = match response.json().await {
            Ok(v) => v,
            Err(e) => {
                tracing::error!("gemini tool call json parse failed: {e}");
                return ("Kevin is temporarily unavailable.".to_string(), new_rows, usage);
            }
        };

        usage.input_tokens += value["usageMetadata"]["promptTokenCount"].as_i64().unwrap_or(0) as i32;
        usage.output_tokens += value["usageMetadata"]["candidatesTokenCount"].as_i64().unwrap_or(0) as i32;

        let parts = value["candidates"][0]["content"]["parts"]
            .as_array()
            .cloned()
            .unwrap_or_default();

        let function_calls: Vec<&serde_json::Value> = parts
            .iter()
            .filter(|p| p.get("functionCall").is_some())
            .collect();

        if function_calls.is_empty() {
            for part in &parts {
                if let Some(text) = part["text"].as_str() {
                    if !text.is_empty() {
                        let text = strip_markdown(text);
                        new_rows.push(crate::kevin_context::text_row("assistant", &text));
                        return (text, new_rows, usage);
                    }
                }
            }
            return ("Kevin is temporarily unavailable.".to_string(), new_rows, usage);
        }

        contents.push(serde_json::json!({
            "role": "model",
            "parts": parts
        }));
        new_rows.push(crate::kevin_context::ContextRow {
            role: "assistant".to_string(),
            blocks: crate::kevin_context::gemini_parts_to_blocks(&parts),
        });

        let mut response_parts = Vec::new();
        let mut result_triples = Vec::new();
        for fc_part in function_calls {
            let fc = &fc_part["functionCall"];
            let tool_name = fc["name"].as_str().unwrap_or("");
            let tool_input = &fc["args"];
            let result =
                execute_kevin_tool(state, user_id, user_email, role, tool_name, tool_input).await;
            response_parts.push(serde_json::json!({
                "functionResponse": {
                    "name": tool_name,
                    "response": { "result": result }
                }
            }));
            result_triples.push((format!("call_{}", Uuid::new_v4()), tool_name.to_string(), result));
        }

        contents.push(serde_json::json!({
            "role": "user",
            "parts": response_parts
        }));
        new_rows.push(crate::kevin_context::tool_result_row(result_triples));
    }

    ("Kevin reached the tool call limit. Please try again.".to_string(), new_rows, usage)
}


#[derive(Debug, PartialEq)]
enum QueryComplexity {
    Simple,      // NadirClaw (free, local)
    Moderate,    // GPT-4.1-mini + tools  (Pro) / Haiku (Basic)
    Complex,     // Sonnet + tools         (Pro) / Haiku (Basic)
    DeepComplex, // Opus + tools           (Pro) / Haiku (Basic)
}

fn classify_query_complexity(message: &str) -> QueryComplexity {
    let msg = message.to_lowercase();
    let len = message.len();

    // Tool-trigger keywords
    let tool_triggers = [
        "request intro", "intro request", "send deck", "email deck",
        "pitch deck", "send pitch", "request an intro", "connect me",
        "make an intro", "intro to",
        // web-search triggers
        "search the web", "find investors", "find me investors", "look for investors",
        "research investors", "who invests", "investors in", "find a vc", "find vc",
        "find funds", "find a fund", "who backs", "who funds", "look up investors",
        "find me a vc", "find me a fund", "who should i talk to", "who should i speak",
        "find startups", "research the market", "look up",
    ];
    let needs_tools = tool_triggers.iter().any(|kw| msg.contains(kw));

    // Deep analysis keywords — need Opus for Pro
    let deep_triggers = [
        "review my pitch", "review my deck", "review the pitch", "review the deck",
        "review this pitch", "review this deck", "analyse my pitch", "analyze my pitch",
        "analyse my deck", "analyze my deck", "full strategy", "comprehensive",
        "step by step plan", "detailed analysis", "detailed plan", "write my",
        "write an investor", "outreach strategy", "fundraising strategy",
        "investor strategy", "evaluate my", "evaluate the",
    ];
    let needs_opus = len > 400
        || (len > 280 && deep_triggers.iter().any(|kw| msg.contains(kw)));

    // Complex reasoning keywords — need Sonnet for Pro
    let complex_triggers = [
        "strategy", "analyse", "analyze", "advise", "advice",
        "write me", "help me write", "draft", "plan for", "how should i",
        "what should i do", "compare", "evaluate", "outreach",
    ];
    let needs_sonnet = (len > 180 && !needs_opus)
        || complex_triggers.iter().any(|kw| msg.contains(kw));

    if needs_opus {
        QueryComplexity::DeepComplex
    } else if needs_sonnet || (needs_tools && len > 120) {
        QueryComplexity::Complex
    } else if needs_tools || len > 100 {
        QueryComplexity::Moderate
    } else {
        QueryComplexity::Simple
    }
}


async fn run_kevin_openai_tool_loop(
    state: &AppState,
    base_url: &str,
    api_key: &str,
    model: &str,
    user_id: Uuid,
    user_email: &str,
    role: &str,
    system: &str,
    messages: Vec<serde_json::Value>,
) -> Result<(String, Vec<crate::kevin_context::ContextRow>, crate::ai::TokenUsage), String> {
    let tools = kevin_tools_for_openai(role);
    let mut msgs: Vec<serde_json::Value> = vec![
        serde_json::json!({"role": "system", "content": system})
    ];
    msgs.extend(messages);
    let mut new_rows: Vec<crate::kevin_context::ContextRow> = Vec::new();
    let mut usage = crate::ai::TokenUsage::default();

    for _ in 0..4 {
        let request_body = serde_json::json!({
            "model": model,
            "messages": msgs,
            "tools": tools,
            "tool_choice": "auto"
        });

        let response = match state
            .http_client
            .post(base_url)
            .header("Authorization", format!("Bearer {api_key}"))
            .header("content-type", "application/json")
            .json(&request_body)
            .send()
            .await
        {
            Ok(r) => r,
            Err(e) => return Err(format!("openai-compatible request: {e}")),
        };

        if !response.status().is_success() {
            let t = response.text().await.unwrap_or_default();
            return Err(format!("openai-compatible error: {t}"));
        }

        let value: serde_json::Value = match response.json().await {
            Ok(v) => v,
            Err(e) => return Err(format!("openai json: {e}")),
        };

        usage.input_tokens += value["usage"]["prompt_tokens"].as_i64().unwrap_or(0) as i32;
        usage.output_tokens += value["usage"]["completion_tokens"].as_i64().unwrap_or(0) as i32;

        let choice = match value["choices"].get(0) {
            Some(c) => c.clone(),
            None => return Err("no choices in openai response".to_string()),
        };
        let finish_reason = choice["finish_reason"].as_str().unwrap_or("stop");
        let message = choice["message"].clone();

        if finish_reason != "tool_calls" {
            let text = strip_markdown(message["content"].as_str().unwrap_or(""));
            new_rows.push(crate::kevin_context::text_row("assistant", &text));
            return Ok((text, new_rows, usage));
        }

        let tool_calls = match message["tool_calls"].as_array() {
            Some(tc) => tc.clone(),
            None => return Err("tool_calls missing".to_string()),
        };

        msgs.push(message.clone());
        new_rows.push(crate::kevin_context::ContextRow {
            role: "assistant".to_string(),
            blocks: crate::kevin_context::openai_message_to_blocks(&message),
        });

        let mut result_triples = Vec::new();
        for tc in &tool_calls {
            let tc_id = tc["id"].as_str().unwrap_or("").to_string();
            let fn_name = tc["function"]["name"].as_str().unwrap_or("");
            let args: serde_json::Value = serde_json::from_str(
                tc["function"]["arguments"].as_str().unwrap_or("{}")
            ).unwrap_or(serde_json::json!({}));

            let result = execute_kevin_tool(state, user_id, user_email, role, fn_name, &args).await;
            msgs.push(serde_json::json!({
                "role": "tool",
                "tool_call_id": tc_id,
                "content": result
            }));
            result_triples.push((tc_id, fn_name.to_string(), result));
        }
        new_rows.push(crate::kevin_context::tool_result_row(result_triples));
    }

    Err("max openai tool turns reached".to_string())
}


async fn run_kevin_anthropic_tool_loop(
    state: &AppState,
    api_key: &str,
    model: &str,
    user_id: Uuid,
    user_email: &str,
    role: &str,
    system: &str,
    messages: Vec<serde_json::Value>,
) -> Result<(String, Vec<crate::kevin_context::ContextRow>, crate::ai::TokenUsage), String> {
    let tools = kevin_tools_for_role(role);
    let mut msgs = messages;
    let mut new_rows: Vec<crate::kevin_context::ContextRow> = Vec::new();
    let mut usage = crate::ai::TokenUsage::default();

    for _ in 0..4 {
        let request_body = serde_json::json!({
            "model": model,
            "max_tokens": 2048,
            "system": system,
            "tools": tools,
            "messages": msgs
        });

        let response = match state
            .http_client
            .post("https://api.anthropic.com/v1/messages")
            .header("x-api-key", api_key)
            .header("anthropic-version", "2023-06-01")
            .json(&request_body)
            .send()
            .await
        {
            Ok(r) => r,
            Err(e) => return Err(format!("anthropic request: {e}")),
        };

        if !response.status().is_success() {
            let status = response.status();
            let text = response.text().await.unwrap_or_default();
            return Err(format!("anthropic {status}: {text}"));
        }

        let value: serde_json::Value = match response.json().await {
            Ok(v) => v,
            Err(e) => return Err(format!("anthropic json: {e}")),
        };

        usage.input_tokens += value["usage"]["input_tokens"].as_i64().unwrap_or(0) as i32;
        usage.output_tokens += value["usage"]["output_tokens"].as_i64().unwrap_or(0) as i32;

        let stop_reason = value["stop_reason"].as_str().unwrap_or("end_turn");

        if stop_reason != "tool_use" {
            if let Some(content) = value["content"].as_array() {
                for block in content {
                    if block["type"].as_str() == Some("text") {
                        let text = strip_markdown(block["text"].as_str().unwrap_or(""));
                        new_rows.push(crate::kevin_context::text_row("assistant", &text));
                        return Ok((text, new_rows, usage));
                    }
                }
            }
            return Err("no text block in anthropic response".to_string());
        }

        let content = match value["content"].as_array() {
            Some(c) => c.clone(),
            None => return Err("no content array".to_string()),
        };

        msgs.push(serde_json::json!({ "role": "assistant", "content": content }));
        new_rows.push(crate::kevin_context::ContextRow {
            role: "assistant".to_string(),
            blocks: crate::kevin_context::anthropic_content_to_blocks(&content),
        });

        let mut tool_results = Vec::new();
        let mut result_triples = Vec::new();
        for block in &content {
            if block["type"].as_str() == Some("tool_use") {
                let tool_name = block["name"].as_str().unwrap_or("");
                let tool_id   = block["id"].as_str().unwrap_or("");
                let result = execute_kevin_tool(
                    state, user_id, user_email, role, tool_name, &block["input"],
                ).await;
                tool_results.push(serde_json::json!({
                    "type": "tool_result",
                    "tool_use_id": tool_id,
                    "content": result
                }));
                result_triples.push((tool_id.to_string(), tool_name.to_string(), result));
            }
        }
        msgs.push(serde_json::json!({ "role": "user", "content": tool_results }));
        new_rows.push(crate::kevin_context::tool_result_row(result_triples));
    }

    Err("max anthropic tool turns reached".to_string())
}

pub(crate) async fn run_kevin_with_tools(
    state: &AppState,
    user_id: Uuid,
    user_email: &str,
    role: &str,
    is_pro: bool,
    is_basic: bool,
    system: &str,
    messages: Vec<serde_json::Value>,
    session_id: Option<Uuid>,
) -> String {
    // Determine complexity from the last user message
    let last_msg = messages
        .iter()
        .rev()
        .find_map(|m| {
            if m["role"].as_str() == Some("user") {
                m["content"].as_str().map(|s| s.to_string())
            } else {
                None
            }
        })
        .unwrap_or_default();
    let complexity = classify_query_complexity(&last_msg);

    // Prefer real persisted context (with actual tool_call/tool_result blocks)
    // over the frontend's flattened text history, when it exists. A session
    // with no persisted rows yet — brand new, or predates this feature —
    // falls back to `messages` exactly as before; nothing to migrate, it
    // just starts accumulating structured context from here on.
    let prior_rows = match session_id {
        Some(sid) => crate::kevin_context::load(state, sid).await,
        None => Vec::new(),
    };
    let using_persisted = !prior_rows.is_empty();

    let seed_rows: Vec<crate::kevin_context::ContextRow> = if using_persisted {
        let mut rows = prior_rows;
        rows.push(crate::kevin_context::text_row("user", &last_msg));
        rows
    } else {
        messages
            .iter()
            .map(|m| {
                let r = if m["role"].as_str() == Some("assistant") { "assistant" } else { "user" };
                crate::kevin_context::text_row(r, m["content"].as_str().unwrap_or(""))
            })
            .collect()
    };
    let new_user_row = crate::kevin_context::text_row("user", &last_msg);

    // Persists exactly the new turn (user message + whatever the successful
    // provider generated) — never the seed, whether it came from prior
    // persisted rows or the flattened fallback — so history never
    // duplicates across requests.
    async fn persist(
        state: &AppState,
        session_id: Option<Uuid>,
        user_id: Uuid,
        new_user_row: &crate::kevin_context::ContextRow,
        new_rows: Vec<crate::kevin_context::ContextRow>,
    ) {
        if let Some(sid) = session_id {
            let mut to_save = vec![new_user_row.clone()];
            to_save.extend(new_rows);
            crate::kevin_context::append(state, sid, user_id, &to_save).await;
        }
    }

    let usage_tier = if is_pro { "pro" } else if is_basic { "basic" } else { "free" };

    // Records which model actually answered + its spend, for the daily
    // usage report (see kevin_learning.rs's sibling usage-report endpoint).
    async fn log_usage(
        state: &AppState,
        user_id: Uuid,
        role: &str,
        tier: &str,
        provider: &str,
        model: &str,
        usage: crate::ai::TokenUsage,
    ) {
        crate::cost::record_llm_usage(
            &state.db,
            Some(user_id),
            Some(role),
            Some(tier),
            "kevin_chat",
            provider,
            model,
            usage.input_tokens,
            usage.output_tokens,
        )
        .await;
    }

    // Tier 0: NadirClaw (local, free) for simple queries — no tool use needed
    if complexity == QueryComplexity::Simple {
        // NadirClaw has no concept of tool calls — skip any "tool" rows a
        // prior (tool-using) turn in this session may have left behind, and
        // only pass the plain text of user/assistant turns.
        let nadirclaw_msgs: Vec<(String, String)> = seed_rows
            .iter()
            .filter(|r| r.role != "tool")
            .filter_map(|r| {
                let text = r.blocks.iter().find_map(|b| b["text"].as_str())?;
                if text.is_empty() { return None; }
                Some((r.role.clone(), text.to_string()))
            })
            .collect();
        match crate::ai::complete_chat(
            &state.http_client,
            "nadirclaw",
            &state.nadirclaw_url,
            "auto",
            system,
            nadirclaw_msgs,
        )
        .await
        {
            Ok((reply, usage)) if !reply.is_empty() => {
                let text = strip_markdown(&reply);
                persist(state, session_id, user_id, &new_user_row, vec![
                    crate::kevin_context::text_row("assistant", &text),
                ]).await;
                log_usage(state, user_id, role, usage_tier, "nadirclaw", "auto", usage).await;
                return text;
            }
            _ => {
                tracing::warn!("nadirclaw unavailable, falling back to paid tier");
            }
        }
    }

    // ── Pro tier routing ────────────────────────────────────────────────────
    if is_pro {
        if let Some(anthropic_key) = &state.anthropic_api_key {
            let model = match complexity {
                QueryComplexity::DeepComplex => "claude-opus-4-5-20251101",
                QueryComplexity::Complex     => "claude-sonnet-4-6",
                _                            => "claude-haiku-4-5-20251001",
            };

            // Moderate: try Hermes 4 70B first (cheap, native tool-calling), fall back to Haiku
            if complexity == QueryComplexity::Moderate {
                if let Some(openrouter_key) = &state.openrouter_api_key {
                    let seed = crate::kevin_context::to_openai(&seed_rows);
                    match run_kevin_openai_tool_loop(
                        state,
                        "https://openrouter.ai/api/v1/chat/completions",
                        openrouter_key,
                        "nousresearch/hermes-4-70b",
                        user_id, user_email, role, system, seed,
                    ).await {
                        Ok((reply, new_rows, usage)) if !reply.is_empty() => {
                            persist(state, session_id, user_id, &new_user_row, new_rows).await;
                            log_usage(state, user_id, role, usage_tier, "openrouter", "nousresearch/hermes-4-70b", usage).await;
                            return reply;
                        }
                        Ok(_) => tracing::warn!("hermes empty, falling back to haiku"),
                        Err(e) => tracing::warn!("hermes failed ({e}), falling back to haiku"),
                    }
                }
            }

            // Complex/DeepComplex: try Kimi K3 first (frontier-tier alternative), fall back to Sonnet/Opus
            if complexity == QueryComplexity::Complex || complexity == QueryComplexity::DeepComplex {
                if let Some(openrouter_key) = &state.openrouter_api_key {
                    let seed = crate::kevin_context::to_openai(&seed_rows);
                    match run_kevin_openai_tool_loop(
                        state,
                        "https://openrouter.ai/api/v1/chat/completions",
                        openrouter_key,
                        "moonshotai/kimi-k3",
                        user_id, user_email, role, system, seed,
                    ).await {
                        Ok((reply, new_rows, usage)) if !reply.is_empty() => {
                            persist(state, session_id, user_id, &new_user_row, new_rows).await;
                            log_usage(state, user_id, role, usage_tier, "openrouter", "moonshotai/kimi-k3", usage).await;
                            return reply;
                        }
                        Ok(_) => tracing::warn!("kimi k3 empty, falling back to {model}"),
                        Err(e) => tracing::warn!("kimi k3 failed ({e}), falling back to {model}"),
                    }
                }
            }

            let seed = crate::kevin_context::to_anthropic(&seed_rows);
            match run_kevin_anthropic_tool_loop(
                state, anthropic_key, model, user_id, user_email, role, system, seed,
            ).await {
                Ok((reply, new_rows, usage)) if !reply.is_empty() => {
                    persist(state, session_id, user_id, &new_user_row, new_rows).await;
                    log_usage(state, user_id, role, usage_tier, "anthropic", model, usage).await;
                    return reply;
                }
                Ok(_) => tracing::warn!("anthropic empty response"),
                Err(e) => tracing::error!("anthropic tool loop failed: {e}"),
            }
            return "Kevin is temporarily unavailable.".to_string();
        }
    }

    // ── Basic tier routing: Haiku with tools ─────────────────────────────────
    if is_basic {
        if let Some(anthropic_key) = &state.anthropic_api_key {
            let seed = crate::kevin_context::to_anthropic(&seed_rows);
            match run_kevin_anthropic_tool_loop(
                state, anthropic_key, "claude-haiku-4-5-20251001",
                user_id, user_email, role, system, seed,
            ).await {
                Ok((reply, new_rows, usage)) if !reply.is_empty() => {
                    persist(state, session_id, user_id, &new_user_row, new_rows).await;
                    log_usage(state, user_id, role, usage_tier, "anthropic", "claude-haiku-4-5-20251001", usage).await;
                    return reply;
                }
                Ok(_) => tracing::warn!("haiku empty, falling back to gemini"),
                Err(e) => tracing::warn!("haiku failed ({e}), falling back to gemini"),
            }
        }
    }

    if let Some(api_key) = &state.ai_api_key {
        let seed = crate::kevin_context::to_gemini(&seed_rows);
        let (reply, new_rows, usage) = run_kevin_with_tools_gemini(
            state,
            user_id,
            user_email,
            role,
            system,
            &seed,
            api_key,
            state.gemini_model.as_str(),
        )
        .await;
        persist(state, session_id, user_id, &new_user_row, new_rows).await;
        log_usage(state, user_id, role, usage_tier, "gemini", state.gemini_model.as_str(), usage).await;
        return reply;
    }

    "Kevin is not configured on this server.".to_string()
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

fn format_check_size(n: i64) -> String {
    if n >= 1_000_000 {
        format!("{}M", n / 1_000_000)
    } else if n >= 1_000 {
        format!("{}K", n / 1_000)
    } else {
        n.to_string()
    }
}

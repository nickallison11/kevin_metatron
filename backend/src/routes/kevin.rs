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
    let memory_section = memory_section_from_recalled(recalled);

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

Stay in character as Kevin. If asked about capabilities you don't have, say what you can help with within Metatron (profiles, pitches, intros, call notes). Do not use markdown formatting. No bold, no asterisks, no bullet point symbols. Plain text only."#
    );

    let (provider, api_key, model) = if user.is_pro {
        if let Some(ref custom_key) = custom_ai_api_key {
            let provider = user
                .custom_ai_provider
                .as_deref()
                .unwrap_or("openai");
            let model = user.custom_ai_model.as_deref().unwrap_or("gpt-4o-mini");
            (provider, custom_key.as_str(), model)
        } else if let Some(key) = state.anthropic_api_key.as_deref() {
            (
                "anthropic",
                key,
                "claude-haiku-4-5-20251001",
            )
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

            let limit_msg = if !user.is_pro {
                "You've used your 20 daily Kevin messages across all channels. Upgrade to Founder Basic at platform.metatron.id/pricing for 200 messages/day.".to_string()
            } else {
                format!(
                    "Daily message limit reached ({daily_limit}/day). Resets at midnight UTC."
                )
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
        Ok(r) => r,
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
        SELECT id, is_pro, subscription_tier, role::text,
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

Stay in character as Kevin. If asked about capabilities you don't have, say what you can help with within Metatron (profiles, pitches, intros, call notes). Do not use markdown formatting. No bold, no asterisks, no bullet point symbols. Plain text only."#
    );

    let (_provider, _api_key, _model) = if user.is_pro {
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
        &system,
        anthropic_msgs,
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

    serde_json::json!([{ "function_declarations": declarations }])
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
                        r#"SELECT CASE WHEN pitch_deck_expires_at IS NULL OR pitch_deck_expires_at > now()
                                       THEN pitch_deck_url ELSE NULL END
                           FROM pitches WHERE created_by = $1 ORDER BY created_at DESC LIMIT 1"#,
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
                    "You have a new intro request from {} on Metatron. Log in to platform.metatron.id to respond.",
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

            if let (Some(resend_key), Some(notify_row)) = (&state.resend_api_key, &notify) {
                let body = serde_json::json!({
                    "from": "Kevin <kevin@metatron.id>",
                    "to": [notify_row.email.clone()],
                    "subject": format!("{} wants an intro on Metatron", requester_display),
                    "text": format!(
                        "Hi,\n\n{} has requested an introduction with you on Metatron.\n\nLog in to platform.metatron.id to accept or decline.\n\n— The metatron team",
                        requester_display
                    )
                });
                let _ = state
                    .http_client
                    .post("https://api.resend.com/emails")
                    .header("Authorization", format!("Bearer {resend_key}"))
                    .json(&body)
                    .send()
                    .await;
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

            let deck: Option<(Option<String>, Option<String>)> = sqlx::query_as(
                r#"SELECT
                     CASE WHEN pitch_deck_expires_at IS NULL OR pitch_deck_expires_at > now()
                          THEN pitch_deck_url ELSE NULL END,
                     title
                   FROM pitches WHERE created_by = $1 ORDER BY created_at DESC LIMIT 1"#,
            )
            .bind(matched_id)
            .fetch_optional(&state.db)
            .await
            .ok()
            .flatten();

            let (deck_url, company_name) = match deck {
                Some((Some(url), title)) => (
                    url,
                    title.unwrap_or_else(|| "this startup".to_string()),
                ),
                Some((None, _)) => return "This startup's pitch deck has expired.".to_string(),
                None => return "This startup has not uploaded a pitch deck yet.".to_string(),
            };

            if let Some(resend_key) = &state.resend_api_key {
                let body = serde_json::json!({
                    "from": "Kevin <kevin@metatron.id>",
                    "to": [user_email],
                    "subject": format!("Pitch deck: {}", company_name),
                    "text": format!(
                        "Hi,\n\nHere is the pitch deck for {} as requested:\n\n{}\n\nThis link has been shared from Metatron.\n\n— Kevin",
                        company_name, deck_url
                    )
                });
                let result = state
                    .http_client
                    .post("https://api.resend.com/emails")
                    .header("Authorization", format!("Bearer {resend_key}"))
                    .json(&body)
                    .send()
                    .await;

                match result {
                    Ok(r) if r.status().is_success() => {
                        format!("Pitch deck for {} sent to {}.", company_name, user_email)
                    }
                    _ => "Failed to send pitch deck email. Please try again.".to_string(),
                }
            } else {
                "Email service not configured.".to_string()
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
) -> String {
    let mut contents: Vec<serde_json::Value> = initial_messages
        .iter()
        .map(|m| {
            let gemini_role = if m["role"].as_str() == Some("assistant") {
                "model"
            } else {
                "user"
            };
            let text = m["content"].as_str().unwrap_or("");
            serde_json::json!({ "role": gemini_role, "parts": [{ "text": text }] })
        })
        .collect();

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
                return "Kevin is temporarily unavailable.".to_string();
            }
        };

        if !response.status().is_success() {
            let status = response.status();
            let text = response.text().await.unwrap_or_default();
            tracing::error!("gemini tool call error {status}: {text}");
            return "Kevin is temporarily unavailable.".to_string();
        }

        let value: serde_json::Value = match response.json().await {
            Ok(v) => v,
            Err(e) => {
                tracing::error!("gemini tool call json parse failed: {e}");
                return "Kevin is temporarily unavailable.".to_string();
            }
        };

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
                        return strip_markdown(text);
                    }
                }
            }
            return "Kevin is temporarily unavailable.".to_string();
        }

        contents.push(serde_json::json!({
            "role": "model",
            "parts": parts
        }));

        let mut response_parts = Vec::new();
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
        }

        contents.push(serde_json::json!({
            "role": "user",
            "parts": response_parts
        }));
    }

    "Kevin reached the tool call limit. Please try again.".to_string()
}

pub(crate) async fn run_kevin_with_tools(
    state: &AppState,
    user_id: Uuid,
    user_email: &str,
    role: &str,
    is_pro: bool,
    system: &str,
    messages: Vec<serde_json::Value>,
) -> String {
    if is_pro {
        if let Some(api_key) = &state.anthropic_api_key {
            let tools = kevin_tools_for_role(role);
            let mut msgs = messages.clone();

            for _ in 0..4 {
                let request_body = serde_json::json!({
                    "model": "claude-sonnet-4-6",
                    "max_tokens": 1024,
                    "system": system,
                    "tools": tools,
                    "messages": msgs
                });

                let response = match state
                    .http_client
                    .post("https://api.anthropic.com/v1/messages")
                    .header("x-api-key", api_key.as_str())
                    .header("anthropic-version", "2023-06-01")
                    .json(&request_body)
                    .send()
                    .await
                {
                    Ok(r) => r,
                    Err(e) => {
                        tracing::error!("anthropic tool call request failed: {e}");
                        return "Kevin is temporarily unavailable.".to_string();
                    }
                };

                if !response.status().is_success() {
                    let status = response.status();
                    let text = response.text().await.unwrap_or_default();
                    tracing::error!("anthropic tool call error {status}: {text}");
                    return "Kevin is temporarily unavailable.".to_string();
                }

                let value: serde_json::Value = match response.json().await {
                    Ok(v) => v,
                    Err(e) => {
                        tracing::error!("anthropic tool call json parse failed: {e}");
                        return "Kevin is temporarily unavailable.".to_string();
                    }
                };

                let stop_reason = value["stop_reason"].as_str().unwrap_or("end_turn");

                if stop_reason != "tool_use" {
                    if let Some(content) = value["content"].as_array() {
                        for block in content {
                            if block["type"].as_str() == Some("text") {
                                let text = block["text"].as_str().unwrap_or("").to_string();
                                return strip_markdown(&text);
                            }
                        }
                    }
                    return "Kevin is temporarily unavailable.".to_string();
                }

                let content = match value["content"].as_array() {
                    Some(c) => c.clone(),
                    None => return "Kevin is temporarily unavailable.".to_string(),
                };

                msgs.push(serde_json::json!({ "role": "assistant", "content": content }));

                let mut tool_results = Vec::new();
                for block in &content {
                    if block["type"].as_str() == Some("tool_use") {
                        let tool_name = block["name"].as_str().unwrap_or("");
                        let tool_id = block["id"].as_str().unwrap_or("");
                        let tool_input = &block["input"];
                        let result = execute_kevin_tool(
                            state, user_id, user_email, role, tool_name, tool_input,
                        )
                        .await;
                        tool_results.push(serde_json::json!({
                            "type": "tool_result",
                            "tool_use_id": tool_id,
                            "content": result
                        }));
                    }
                }

                msgs.push(serde_json::json!({ "role": "user", "content": tool_results }));
            }

            return "Kevin reached the tool call limit. Please try again.".to_string();
        }
    }

    if let Some(api_key) = &state.ai_api_key {
        return run_kevin_with_tools_gemini(
            state,
            user_id,
            user_email,
            role,
            system,
            &messages,
            api_key,
            state.gemini_model.as_str(),
        )
        .await;
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

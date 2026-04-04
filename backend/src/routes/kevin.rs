use std::sync::Arc;

use axum::{extract::State, routing::post, Json, Router};
use axum_extra::{
    headers::{authorization::Bearer, Authorization},
    TypedHeader,
};
use serde::{Deserialize, Serialize};

use crate::ai::complete_chat;
use crate::identity::require_user;
use crate::memory;
use crate::state::AppState;

pub fn router() -> Router<Arc<AppState>> {
    Router::new().route("/chat", post(chat))
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
) -> Result<Json<ChatResponse>, (axum::http::StatusCode, String)> {
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
        return Err((
            axum::http::StatusCode::BAD_REQUEST,
            "messages required".into(),
        ));
    }

    let last_user_message = msgs
        .iter()
        .rev()
        .find_map(|(role, content)| (role == "user").then_some(content.clone()))
        .unwrap_or_default();

    let recalled = if let Some(gemini_key) = state.ai_api_key.as_deref() {
        if last_user_message.trim().is_empty() {
            Vec::new()
        } else {
            match memory::recall_memories(
                &state.db,
                &state.http_client,
                gemini_key,
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
        }
    } else {
        Vec::new()
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
            return Err((
                axum::http::StatusCode::SERVICE_UNAVAILABLE,
                "AI not configured".to_string(),
            ));
        }
    } else if let Some(key) = state.ai_api_key.as_deref() {
        ("gemini", key, "gemini-2.5-flash-lite")
    } else {
        return Err((
            axum::http::StatusCode::SERVICE_UNAVAILABLE,
            "AI not configured".to_string(),
        ));
    };

    let reply = complete_chat(
        &state.http_client,
        provider,
        api_key,
        model,
        &system,
        msgs,
    )
    .await
    .map_err(|e| (axum::http::StatusCode::BAD_GATEWAY, e))?;
    let reply = strip_markdown(&reply);

    if let Some(gemini_key) = state.ai_api_key.clone() {
        let db = state.db.clone();
        let http = state.http_client.clone();
        let uid = user.id;
        let conversation = format!("User: {last_user_message}\nKevin: {reply}");
        tokio::spawn(async move {
            if let Err(e) = memory::store_memory(
                &db,
                &http,
                &gemini_key,
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

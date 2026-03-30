use std::sync::Arc;

use axum::{extract::State, routing::post, Json, Router};
use axum_extra::{
    headers::{authorization::Bearer, Authorization},
    TypedHeader,
};
use serde::{Deserialize, Serialize};

use crate::claude::complete_chat;
use crate::identity::require_user;
use crate::state::AppState;

pub fn router() -> Router<Arc<AppState>> {
    Router::new().route("/chat", post(chat))
}

#[derive(Deserialize)]
pub struct ChatRequest {
    pub messages: Vec<ChatMessage>,
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

    let key = state
        .anthropic_api_key
        .as_ref()
        .ok_or((
            axum::http::StatusCode::SERVICE_UNAVAILABLE,
            "ANTHROPIC_API_KEY not configured".to_string(),
        ))?;

    let context = build_context(&state, user.id, &user.role).await;

    let system = format!(
        r#"You are Kevin, the AI copilot for Metatron (metatron.id).

Metatron is the intelligence layer connecting founders, investors, and ecosystem partners globally. You help users navigate fundraising, diligence, pitch refinement, and relationship context. Be concise, practical, and professional.

## Current user context
{context}

Stay in character as Kevin. If asked about capabilities you don't have, say what you can help with within Metatron (profiles, pitches, intros, call notes)."#
    );

    let mut msgs: Vec<(String, String)> = Vec::new();
    for m in body.messages {
        let role = if m.role == "assistant" {
            "assistant"
        } else {
            "user"
        };
        msgs.push((role.to_string(), m.content));
    }

    if msgs.is_empty() {
        return Err((
            axum::http::StatusCode::BAD_REQUEST,
            "messages required".into(),
        ));
    }

    let reply = complete_chat(&state.http_client, key, &system, msgs)
        .await
        .map_err(|e| (axum::http::StatusCode::BAD_GATEWAY, e))?;

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

use axum::{
    extract::{Path, State},
    http::StatusCode,
    routing::{get, post, put},
    Json, Router,
};
use axum_extra::{
    headers::{authorization::Bearer, Authorization},
    TypedHeader,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::types::Uuid;
use std::sync::Arc;

use crate::identity::require_user;
use crate::state::AppState;

#[derive(Debug, Serialize)]
struct ConversationSummary {
    id: String,
    r#type: String,
    last_message_at: String,
    unread_count: i64,
    other_name: Option<String>,
    last_message: Option<String>,
}

#[derive(Debug, Serialize)]
struct MessageOut {
    id: String,
    sender_id: Option<String>,
    body: String,
    created_at: String,
    is_mine: bool,
}

#[derive(Debug, Serialize)]
struct SendResult {
    conversation_id: String,
    reply: Option<String>,
}

#[derive(Debug, Deserialize)]
struct SendKevinBody {
    body: String,
}

#[derive(Debug, Deserialize)]
struct SendDirectBody {
    recipient_id: String,
    body: String,
}

async fn fire_telegram(bot_token: &str, chat_id: i64, text: &str, client: &reqwest::Client) {
    let url = format!("https://api.telegram.org/bot{bot_token}/sendMessage");
    let _ = client
        .post(&url)
        .json(&serde_json::json!({ "chat_id": chat_id, "text": text }))
        .send()
        .await;
}

async fn ensure_kevin_conversation(
    db: &sqlx::PgPool,
    user_id: Uuid,
) -> Result<Uuid, (StatusCode, String)> {
    let existing: Option<(Uuid,)> = sqlx::query_as(
        "SELECT c.id FROM conversations c \
         JOIN conversation_participants cp ON cp.conversation_id = c.id \
         WHERE c.type = 'kevin' AND cp.user_id = $1 LIMIT 1",
    )
    .bind(user_id)
    .fetch_optional(db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    if let Some((id,)) = existing {
        return Ok(id);
    }

    let (conv_id,): (Uuid,) =
        sqlx::query_as("INSERT INTO conversations (type) VALUES ('kevin') RETURNING id")
            .fetch_one(db)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    sqlx::query("INSERT INTO conversation_participants (conversation_id, user_id) VALUES ($1, $2)")
        .bind(conv_id)
        .bind(user_id)
        .execute(db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(conv_id)
}

async fn ensure_direct_conversation(
    db: &sqlx::PgPool,
    user_a: Uuid,
    user_b: Uuid,
) -> Result<Uuid, (StatusCode, String)> {
    let existing: Option<(Uuid,)> = sqlx::query_as(
        "SELECT c.id FROM conversations c \
         JOIN conversation_participants cp1 ON cp1.conversation_id = c.id AND cp1.user_id = $1 \
         JOIN conversation_participants cp2 ON cp2.conversation_id = c.id AND cp2.user_id = $2 \
         WHERE c.type = 'direct' LIMIT 1",
    )
    .bind(user_a)
    .bind(user_b)
    .fetch_optional(db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    if let Some((id,)) = existing {
        return Ok(id);
    }

    let (conv_id,): (Uuid,) =
        sqlx::query_as("INSERT INTO conversations (type) VALUES ('direct') RETURNING id")
            .fetch_one(db)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    sqlx::query(
        "INSERT INTO conversation_participants (conversation_id, user_id) \
         VALUES ($1, $2), ($1, $3)",
    )
    .bind(conv_id)
    .bind(user_a)
    .bind(user_b)
    .execute(db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(conv_id)
}

async fn list_conversations(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
) -> Result<Json<Vec<ConversationSummary>>, (StatusCode, String)> {
    let user = require_user(&state, bearer.token()).await?;
    let user_id: Uuid = user.id;

    #[derive(sqlx::FromRow)]
    struct Row {
        id: Uuid,
        r#type: String,
        last_message_at: DateTime<Utc>,
        unread_count: i32,
        other_name: Option<String>,
        last_message: Option<String>,
    }

    let rows: Vec<Row> = sqlx::query_as(
        "SELECT c.id, c.type, c.last_message_at, cp.unread_count, \
         u.email as other_name, \
         lm.body as last_message \
         FROM conversations c \
         JOIN conversation_participants cp ON cp.conversation_id = c.id AND cp.user_id = $1 \
         LEFT JOIN conversation_participants cp2 ON cp2.conversation_id = c.id AND cp2.user_id != $1 \
         LEFT JOIN users u ON u.id = cp2.user_id \
         LEFT JOIN LATERAL ( \
             SELECT body FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1 \
         ) lm ON true \
         ORDER BY c.last_message_at DESC",
    )
    .bind(user_id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let out = rows
        .into_iter()
        .map(|r| ConversationSummary {
            id: r.id.to_string(),
            r#type: r.r#type,
            last_message_at: r.last_message_at.to_rfc3339(),
            unread_count: r.unread_count as i64,
            other_name: r.other_name,
            last_message: r.last_message,
        })
        .collect();

    Ok(Json(out))
}

async fn get_conversation(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
    Path(conv_id): Path<String>,
) -> Result<Json<Vec<MessageOut>>, (StatusCode, String)> {
    let user = require_user(&state, bearer.token()).await?;
    let user_id: Uuid = user.id;
    let conv_uuid: Uuid = conv_id
        .parse()
        .map_err(|_| (StatusCode::BAD_REQUEST, "bad id".into()))?;

    let ok: Option<(bool,)> = sqlx::query_as(
        "SELECT EXISTS(SELECT 1 FROM conversation_participants \
         WHERE conversation_id = $1 AND user_id = $2)",
    )
    .bind(conv_uuid)
    .bind(user_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    if !ok.map(|(b,)| b).unwrap_or(false) {
        return Err((StatusCode::FORBIDDEN, "not a participant".into()));
    }

    #[derive(sqlx::FromRow)]
    struct MsgRow {
        id: Uuid,
        sender_id: Option<Uuid>,
        body: String,
        created_at: DateTime<Utc>,
    }

    let rows: Vec<MsgRow> = sqlx::query_as(
        "SELECT id, sender_id, body, created_at FROM messages \
         WHERE conversation_id = $1 ORDER BY created_at ASC LIMIT 100",
    )
    .bind(conv_uuid)
    .fetch_all(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let out = rows
        .into_iter()
        .map(|r| MessageOut {
            id: r.id.to_string(),
            sender_id: r.sender_id.map(|u| u.to_string()),
            body: r.body,
            created_at: r.created_at.to_rfc3339(),
            is_mine: r.sender_id == Some(user_id),
        })
        .collect();

    Ok(Json(out))
}

async fn send_kevin_message(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
    Json(body): Json<SendKevinBody>,
) -> Result<Json<SendResult>, (StatusCode, String)> {
    let user = require_user(&state, bearer.token()).await?;
    let user_id: Uuid = user.id;
    let text = body.body.trim().to_string();
    if text.is_empty() {
        return Err((StatusCode::BAD_REQUEST, "body is empty".into()));
    }

    let conv_id = ensure_kevin_conversation(&state.db, user_id).await?;

    sqlx::query("INSERT INTO messages (conversation_id, sender_id, body) VALUES ($1, $2, $3)")
        .bind(conv_id)
        .bind(user_id)
        .bind(&text)
        .execute(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    #[derive(sqlx::FromRow)]
    struct HistRow {
        sender_id: Option<Uuid>,
        body: String,
    }
    let history: Vec<HistRow> = sqlx::query_as(
        "SELECT sender_id, body FROM messages WHERE conversation_id = $1 \
         ORDER BY created_at DESC LIMIT 20",
    )
    .bind(conv_id)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    let mut anthropic_msgs: Vec<serde_json::Value> = history
        .into_iter()
        .rev()
        .map(|m| {
            serde_json::json!({
                "role": if m.sender_id == Some(user_id) { "user" } else { "assistant" },
                "content": m.body
            })
        })
        .collect();

    if anthropic_msgs.last().and_then(|m| m["role"].as_str()) != Some("user") {
        anthropic_msgs.push(serde_json::json!({ "role": "user", "content": text }));
    }

    let reply = if let Some(api_key) = &state.anthropic_api_key {
        match state
            .http_client
            .post("https://api.anthropic.com/v1/messages")
            .header("x-api-key", api_key.as_str())
            .header("anthropic-version", "2023-06-01")
            .json(&serde_json::json!({
                "model": "claude-sonnet-4-6",
                "max_tokens": 1024,
                "system": "You are Kevin, metatron's AI co-pilot. Help founders raise capital, assist investors with deal flow, and support connectors with introductions. Be concise and helpful.",
                "messages": anthropic_msgs
            }))
            .send()
            .await
        {
            Ok(r) => match r.json::<serde_json::Value>().await {
                Ok(v) => v["content"][0]["text"]
                    .as_str()
                    .map(|s| s.to_string())
                    .unwrap_or_else(|| "Kevin is temporarily unavailable.".to_string()),
                Err(_) => "Kevin is temporarily unavailable.".to_string(),
            },
            Err(_) => "Kevin is temporarily unavailable.".to_string(),
        }
    } else {
        "Kevin is not configured on this server.".to_string()
    };

    sqlx::query("INSERT INTO messages (conversation_id, sender_id, body) VALUES ($1, NULL, $2)")
        .bind(conv_id)
        .bind(&reply)
        .execute(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    sqlx::query("UPDATE conversations SET last_message_at = now() WHERE id = $1")
        .bind(conv_id)
        .execute(&state.db)
        .await
        .ok();

    Ok(Json(SendResult {
        conversation_id: conv_id.to_string(),
        reply: Some(reply),
    }))
}

async fn send_direct_message(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
    Json(body): Json<SendDirectBody>,
) -> Result<Json<SendResult>, (StatusCode, String)> {
    let user = require_user(&state, bearer.token()).await?;
    let user_id: Uuid = user.id;
    let recipient_id: Uuid = body
        .recipient_id
        .parse()
        .map_err(|_| (StatusCode::BAD_REQUEST, "invalid recipient_id".into()))?;
    let text = body.body.trim().to_string();

    if text.is_empty() {
        return Err((StatusCode::BAD_REQUEST, "body is empty".into()));
    }
    if user_id == recipient_id {
        return Err((StatusCode::BAD_REQUEST, "cannot message yourself".into()));
    }

    let conv_id = ensure_direct_conversation(&state.db, user_id, recipient_id).await?;

    sqlx::query("INSERT INTO messages (conversation_id, sender_id, body) VALUES ($1, $2, $3)")
        .bind(conv_id)
        .bind(user_id)
        .bind(&text)
        .execute(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    sqlx::query("UPDATE conversations SET last_message_at = now() WHERE id = $1")
        .bind(conv_id)
        .execute(&state.db)
        .await
        .ok();

    sqlx::query(
        "UPDATE conversation_participants SET unread_count = unread_count + 1 \
         WHERE conversation_id = $1 AND user_id = $2",
    )
    .bind(conv_id)
    .bind(recipient_id)
    .execute(&state.db)
    .await
    .ok();

    let sender_name: Option<String> =
        sqlx::query_scalar("SELECT email FROM users WHERE id = $1")
            .bind(user_id)
            .fetch_optional(&state.db)
            .await
            .ok()
            .flatten();
    let sender_display = sender_name.unwrap_or_else(|| "Someone on metatron".to_string());

    let telegram_id: Option<i64> = sqlx::query_scalar("SELECT telegram_id FROM users WHERE id = $1")
        .bind(recipient_id)
        .fetch_optional(&state.db)
        .await
        .ok()
        .flatten();

    if let (Some(bot_token), Some(tg_id)) = (&state.telegram_bot_token, telegram_id) {
        let notif = format!(
            "💬 New message from {} on metatron:\n\n{}\n\nReply at platform.metatron.id",
            sender_display, text
        );
        fire_telegram(bot_token, tg_id, &notif, &state.http_client).await;
    }

    Ok(Json(SendResult {
        conversation_id: conv_id.to_string(),
        reply: None,
    }))
}

async fn mark_read(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
    Path(conv_id): Path<String>,
) -> Result<StatusCode, (StatusCode, String)> {
    let user = require_user(&state, bearer.token()).await?;
    let user_id: Uuid = user.id;
    let conv_uuid: Uuid = conv_id
        .parse()
        .map_err(|_| (StatusCode::BAD_REQUEST, "bad id".into()))?;

    sqlx::query(
        "UPDATE conversation_participants SET unread_count = 0 \
         WHERE conversation_id = $1 AND user_id = $2",
    )
    .bind(conv_uuid)
    .bind(user_id)
    .execute(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(StatusCode::NO_CONTENT)
}

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/conversations", get(list_conversations))
        .route("/conversations/:id", get(get_conversation))
        .route("/conversations/:id/read", put(mark_read))
        .route("/kevin", post(send_kevin_message))
        .route("/direct", post(send_direct_message))
}

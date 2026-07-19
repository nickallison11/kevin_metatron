//! Provider-agnostic conversation memory for Kevin's web chat widget.
//!
//! Kevin routes between Anthropic, OpenAI, and Gemini per tier/complexity —
//! sometimes within the same conversation. Each provider has its own wire
//! format for tool calls and tool results (Anthropic: content-block arrays;
//! OpenAI: `tool_calls` + separate `role:"tool"` messages; Gemini:
//! `functionCall`/`functionResponse` parts with no call ID at all, matched
//! by name instead). This module stores one normalized representation and
//! converts to/from each provider's native format, so a follow-up turn
//! always has the real prior tool output available regardless of which
//! provider handled the earlier turn.
//!
//! Normalized block shapes:
//!   {"type": "text", "text": "..."}
//!   {"type": "tool_call", "id": "...", "name": "...", "input": {...}}
//!   {"type": "tool_result", "tool_call_id": "...", "name": "...", "content": "..."}
//!
//! `name` is carried on tool_result too (redundant for Anthropic/OpenAI,
//! which match by id) because Gemini's functionResponse has no id concept
//! and matches by name alone.

use serde_json::{json, Value};
use sqlx::types::Json as SqlxJson;
use uuid::Uuid;

use crate::state::AppState;

#[derive(Clone, Debug)]
pub struct ContextRow {
    pub role: String, // "user" | "assistant" | "tool"
    pub blocks: Vec<Value>,
}

pub fn text_row(role: &str, text: &str) -> ContextRow {
    ContextRow {
        role: role.to_string(),
        blocks: vec![json!({"type": "text", "text": text})],
    }
}

fn row_text(row: &ContextRow) -> String {
    row.blocks
        .iter()
        .filter_map(|b| {
            if b["type"] == "text" {
                b["text"].as_str()
            } else {
                None
            }
        })
        .collect::<Vec<_>>()
        .join("")
}

/// Caps how much prior context is replayed to a provider on each turn.
/// Unbounded growth would eventually exceed provider context/token limits
/// on a long-running conversation. 60 matches the existing trim the
/// frontend already applies to its own local chat history.
const MAX_CONTEXT_ROWS: i64 = 60;

pub async fn load(state: &AppState, session_id: Uuid) -> Vec<ContextRow> {
    // Take the most recent MAX_CONTEXT_ROWS by seq, then restore ascending
    // order — a plain ORDER BY seq LIMIT would give the oldest rows instead
    // of the most recent ones.
    let rows: Vec<(String, SqlxJson<Vec<Value>>)> = sqlx::query_as(
        r#"SELECT role, blocks FROM (
               SELECT role, blocks, seq FROM kevin_chat_context
               WHERE session_id = $1
               ORDER BY seq DESC
               LIMIT $2
           ) recent
           ORDER BY seq ASC"#,
    )
    .bind(session_id)
    .bind(MAX_CONTEXT_ROWS)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    rows.into_iter()
        .map(|(role, SqlxJson(blocks))| ContextRow { role, blocks })
        .collect()
}

/// Appends new rows to a session, best-effort. Failure here should never
/// break the chat response the user already received — it just means the
/// next turn falls back to less context, not an error.
///
/// Wrapped in a transaction holding a per-session advisory lock so two
/// requests racing on the same session_id (a frontend double-send, a
/// second browser tab) can't both compute the same MAX(seq) and silently
/// drop one side's rows via ON CONFLICT DO NOTHING — the second transaction
/// blocks on the lock until the first commits, then sees the real max.
pub async fn append(state: &AppState, session_id: Uuid, user_id: Uuid, rows: &[ContextRow]) {
    if rows.is_empty() {
        return;
    }

    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(e) => {
            tracing::warn!("kevin_context: append failed to open transaction: {e}");
            return;
        }
    };

    if let Err(e) = sqlx::query("SELECT pg_advisory_xact_lock(hashtext($1::text))")
        .bind(session_id)
        .execute(&mut *tx)
        .await
    {
        tracing::warn!("kevin_context: advisory lock failed for session {session_id}: {e}");
        return;
    }

    let start_seq: i32 = sqlx::query_scalar(
        "SELECT COALESCE(MAX(seq), 0) FROM kevin_chat_context WHERE session_id = $1",
    )
    .bind(session_id)
    .fetch_one(&mut *tx)
    .await
    .unwrap_or(0);

    for (i, row) in rows.iter().enumerate() {
        let seq = start_seq + 1 + i as i32;
        let res = sqlx::query(
            r#"INSERT INTO kevin_chat_context (session_id, user_id, seq, role, blocks)
               VALUES ($1, $2, $3, $4, $5)
               ON CONFLICT (session_id, seq) DO NOTHING"#,
        )
        .bind(session_id)
        .bind(user_id)
        .bind(seq)
        .bind(&row.role)
        .bind(SqlxJson(row.blocks.clone()))
        .execute(&mut *tx)
        .await;
        if let Err(e) = res {
            tracing::warn!("kevin_context: append failed for session {session_id}: {e}");
        }
    }

    if let Err(e) = tx.commit().await {
        tracing::warn!("kevin_context: append transaction commit failed for session {session_id}: {e}");
    }
}

// ---------------------------------------------------------------------------
// Anthropic
// ---------------------------------------------------------------------------

pub fn to_anthropic(rows: &[ContextRow]) -> Vec<Value> {
    rows.iter()
        .map(|r| match r.role.as_str() {
            "tool" => {
                let content: Vec<Value> = r
                    .blocks
                    .iter()
                    .filter(|b| b["type"] == "tool_result")
                    .map(|b| {
                        json!({
                            "type": "tool_result",
                            "tool_use_id": b["tool_call_id"],
                            "content": b["content"]
                        })
                    })
                    .collect();
                json!({"role": "user", "content": content})
            }
            "assistant" => {
                let content: Vec<Value> = r
                    .blocks
                    .iter()
                    .map(|b| match b["type"].as_str() {
                        Some("tool_call") => json!({
                            "type": "tool_use",
                            "id": b["id"],
                            "name": b["name"],
                            "input": b["input"]
                        }),
                        _ => json!({"type": "text", "text": b["text"].as_str().unwrap_or("")}),
                    })
                    .collect();
                json!({"role": "assistant", "content": content})
            }
            _ => json!({"role": "user", "content": row_text(r)}),
        })
        .collect()
}

/// Converts a raw Anthropic `content` array (from an API response) into
/// normalized blocks, for capturing what the model just did.
pub fn anthropic_content_to_blocks(content: &[Value]) -> Vec<Value> {
    content
        .iter()
        .map(|b| match b["type"].as_str() {
            Some("tool_use") => json!({
                "type": "tool_call",
                "id": b["id"],
                "name": b["name"],
                "input": b["input"]
            }),
            _ => json!({"type": "text", "text": b["text"].as_str().unwrap_or("")}),
        })
        .collect()
}

// ---------------------------------------------------------------------------
// OpenAI
// ---------------------------------------------------------------------------

pub fn to_openai(rows: &[ContextRow]) -> Vec<Value> {
    let mut out = Vec::new();
    for r in rows {
        match r.role.as_str() {
            "tool" => {
                for b in r.blocks.iter().filter(|b| b["type"] == "tool_result") {
                    out.push(json!({
                        "role": "tool",
                        "tool_call_id": b["tool_call_id"],
                        "content": b["content"]
                    }));
                }
            }
            "assistant" => {
                let text = row_text(r);
                let tool_calls: Vec<Value> = r
                    .blocks
                    .iter()
                    .filter(|b| b["type"] == "tool_call")
                    .map(|b| {
                        json!({
                            "id": b["id"],
                            "type": "function",
                            "function": {
                                "name": b["name"],
                                "arguments": serde_json::to_string(&b["input"]).unwrap_or_default()
                            }
                        })
                    })
                    .collect();
                let mut msg = json!({
                    "role": "assistant",
                    "content": if text.is_empty() { Value::Null } else { json!(text) }
                });
                if !tool_calls.is_empty() {
                    msg["tool_calls"] = json!(tool_calls);
                }
                out.push(msg);
            }
            _ => out.push(json!({"role": "user", "content": row_text(r)})),
        }
    }
    out
}

/// Converts an OpenAI assistant `message` object (from an API response,
/// content + optional tool_calls) into normalized blocks.
pub fn openai_message_to_blocks(message: &Value) -> Vec<Value> {
    let mut blocks = Vec::new();
    if let Some(text) = message["content"].as_str() {
        if !text.is_empty() {
            blocks.push(json!({"type": "text", "text": text}));
        }
    }
    if let Some(tcs) = message["tool_calls"].as_array() {
        for tc in tcs {
            let args: Value = serde_json::from_str(tc["function"]["arguments"].as_str().unwrap_or("{}"))
                .unwrap_or_else(|_| json!({}));
            blocks.push(json!({
                "type": "tool_call",
                "id": tc["id"],
                "name": tc["function"]["name"],
                "input": args
            }));
        }
    }
    blocks
}

// ---------------------------------------------------------------------------
// Gemini
// ---------------------------------------------------------------------------

pub fn to_gemini(rows: &[ContextRow]) -> Vec<Value> {
    rows.iter()
        .map(|r| match r.role.as_str() {
            "tool" => {
                let parts: Vec<Value> = r
                    .blocks
                    .iter()
                    .filter(|b| b["type"] == "tool_result")
                    .map(|b| {
                        json!({
                            "functionResponse": {
                                "name": b["name"],
                                "response": {"result": b["content"]}
                            }
                        })
                    })
                    .collect();
                json!({"role": "user", "parts": parts})
            }
            "assistant" => {
                let parts: Vec<Value> = r
                    .blocks
                    .iter()
                    .map(|b| match b["type"].as_str() {
                        Some("tool_call") => json!({
                            "functionCall": {"name": b["name"], "args": b["input"]}
                        }),
                        _ => json!({"text": b["text"].as_str().unwrap_or("")}),
                    })
                    .collect();
                json!({"role": "model", "parts": parts})
            }
            _ => json!({"role": "user", "parts": [{"text": row_text(r)}]}),
        })
        .collect()
}

/// Converts Gemini response `parts` into normalized blocks. Gemini has no
/// call-id concept, so we synthesize one purely for internal bookkeeping —
/// it round-trips fine since to_gemini() never reads tool_call_id, only name.
pub fn gemini_parts_to_blocks(parts: &[Value]) -> Vec<Value> {
    parts
        .iter()
        .map(|p| {
            if let Some(fc) = p.get("functionCall") {
                json!({
                    "type": "tool_call",
                    "id": format!("call_{}", Uuid::new_v4()),
                    "name": fc["name"],
                    "input": fc["args"]
                })
            } else {
                json!({"type": "text", "text": p["text"].as_str().unwrap_or("")})
            }
        })
        .collect()
}

/// Builds a normalized tool_result row after executing a tool, carrying
/// both id (Anthropic/OpenAI) and name (Gemini) so it converts cleanly to
/// whichever provider handles the next turn.
pub fn tool_result_row(results: Vec<(String, String, String)>) -> ContextRow {
    // (tool_call_id, name, content)
    let blocks = results
        .into_iter()
        .map(|(id, name, content)| {
            json!({
                "type": "tool_result",
                "tool_call_id": id,
                "name": name,
                "content": content
            })
        })
        .collect();
    ContextRow {
        role: "tool".to_string(),
        blocks,
    }
}

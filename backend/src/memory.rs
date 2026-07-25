use pgvector::Vector;
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use uuid::Uuid;

const MAX_TEXT_TURN_CHARS: usize = 8000;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GeminiSummarySystemInstruction {
    parts: Vec<TextPart>,
}

#[derive(Serialize)]
struct TextPart {
    text: String,
}

#[derive(Serialize)]
struct GeminiSummaryContent {
    role: String,
    parts: Vec<TextPart>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GeminiSummaryRequest {
    system_instruction: GeminiSummarySystemInstruction,
    contents: Vec<GeminiSummaryContent>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GeminiSummaryResponse {
    candidates: Option<Vec<GeminiSummaryCandidate>>,
    usage_metadata: Option<GeminiSummaryUsageMetadata>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GeminiSummaryUsageMetadata {
    prompt_token_count: Option<i32>,
    candidates_token_count: Option<i32>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GeminiSummaryCandidate {
    content: Option<GeminiSummaryOutContent>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GeminiSummaryOutContent {
    parts: Option<Vec<GeminiSummaryOutPart>>,
}

#[derive(Deserialize)]
struct GeminiSummaryOutPart {
    text: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct EmbedContentRequest {
    model: String,
    content: EmbedInputContent,
    output_dimensionality: i32,
}

#[derive(Serialize)]
struct EmbedInputContent {
    parts: Vec<TextPart>,
}

#[derive(Deserialize)]
struct EmbedContentResponse {
    embedding: Option<EmbeddingOut>,
}

#[derive(Deserialize)]
struct EmbeddingOut {
    values: Option<Vec<f32>>,
}

fn truncate_text(s: &str, max: usize) -> String {
    let t = s.trim();
    if t.len() <= max {
        return t.to_string();
    }
    t.chars().take(max).collect()
}

fn storage_text(summary: &str, conversation: &str) -> String {
    let s = summary.trim();
    if s.is_empty() {
        truncate_text(conversation, MAX_TEXT_TURN_CHARS)
    } else {
        truncate_text(s, MAX_TEXT_TURN_CHARS)
    }
}

/// Paid subscribers with `GEMINI_EMBEDDING_KEY` can use vector semantic memory; others use plain-text turns only.
fn semantic_memory_enabled(is_pro_subscriber: bool, embedding_key: Option<&str>) -> bool {
    is_pro_subscriber && embedding_key.is_some()
}

async fn append_text_memory_turn(db: &PgPool, user_id: Uuid, content: &str) -> Result<(), String> {
    let content = content.trim();
    if content.is_empty() {
        return Ok(());
    }

    sqlx::query(
        r#"
        INSERT INTO kevin_text_memories (user_id, content)
        VALUES ($1, $2)
        "#,
    )
    .bind(user_id)
    .bind(content)
    .execute(db)
    .await
    .map_err(|e| format!("text memory insert: {e}"))?;

    sqlx::query(
        r#"
        DELETE FROM kevin_text_memories
        WHERE user_id = $1
        AND id NOT IN (
            SELECT id FROM (
                SELECT id FROM kevin_text_memories
                WHERE user_id = $1
                ORDER BY created_at DESC
                LIMIT 10
            ) keep_ids
        )
        "#,
    )
    .bind(user_id)
    .execute(db)
    .await
    .map_err(|e| format!("text memory prune: {e}"))?;

    Ok(())
}

async fn fetch_recent_text_memories(db: &PgPool, user_id: Uuid) -> Result<Vec<String>, String> {
    let rows: Vec<String> = sqlx::query_scalar(
        r#"
        SELECT content FROM (
            SELECT content, created_at
            FROM kevin_text_memories
            WHERE user_id = $1
            ORDER BY created_at DESC
            LIMIT 10
        ) sub
        ORDER BY sub.created_at ASC
        "#,
    )
    .bind(user_id)
    .fetch_all(db)
    .await
    .map_err(|e| format!("text memory fetch: {e}"))?;

    Ok(rows)
}

/// Summarize then store: paid + embedding key → vector row when embedding works; otherwise (or on failure) last 10 turns in `kevin_text_memories`.
pub async fn store_memory(
    db: &PgPool,
    http: &reqwest::Client,
    gemini_api_key: &str,
    embedding_key: Option<&str>,
    is_pro_subscriber: bool,
    user_id: Uuid,
    conversation: &str,
) -> Result<(), String> {
    let summary = match summarize_conversation(db, http, gemini_api_key, user_id, conversation).await {
        Ok(s) => s,
        Err(e) => {
            tracing::warn!("memory summarize failed: {e}");
            String::new()
        }
    };

    let to_store = storage_text(&summary, conversation);
    if to_store.is_empty() {
        return Ok(());
    }

    if semantic_memory_enabled(is_pro_subscriber, embedding_key) {
        let summary_trim = summary.trim();
        if !summary_trim.is_empty() {
            if let Some(key) = embedding_key {
                match embed_text(db, http, key, user_id, summary_trim).await {
                    Ok(values) => {
                        let embedding = Vector::from(values);
                        sqlx::query(
                            r#"
                            INSERT INTO kevin_memories (user_id, content, embedding)
                            VALUES ($1, $2, $3)
                            "#,
                        )
                        .bind(user_id)
                        .bind(summary_trim.to_string())
                        .bind(embedding)
                        .execute(db)
                        .await
                        .map_err(|e| format!("store memory db: {e}"))?;
                        return Ok(());
                    }
                    Err(e) => {
                        tracing::warn!("memory embedding failed, falling back to text memory: {e}");
                    }
                }
            }
        }
    }

    append_text_memory_turn(db, user_id, &to_store).await
}

/// Semantic recall for paid + `GEMINI_EMBEDDING_KEY` when query embedding works; always merges recent plain-text turns (last 10).
pub async fn recall_memories(
    db: &PgPool,
    http: &reqwest::Client,
    embedding_key: Option<&str>,
    is_pro_subscriber: bool,
    user_id: Uuid,
    query: &str,
) -> Result<Vec<String>, String> {
    let recent = fetch_recent_text_memories(db, user_id).await?;

    if query.trim().is_empty() {
        return Ok(recent);
    }

    let mut semantic: Vec<String> = Vec::new();
    if semantic_memory_enabled(is_pro_subscriber, embedding_key) {
        if let Some(key) = embedding_key {
            match embed_text(db, http, key, user_id, query).await {
                Ok(query_embedding_values) => {
                    let query_embedding = Vector::from(query_embedding_values);
                    semantic = sqlx::query_scalar(
                        r#"
                        SELECT content
                        FROM kevin_memories
                        WHERE user_id = $1
                        ORDER BY embedding <=> $2 ASC
                        LIMIT 5
                        "#,
                    )
                    .bind(user_id)
                    .bind(query_embedding)
                    .fetch_all(db)
                    .await
                    .map_err(|e| format!("recall memory db: {e}"))?;
                }
                Err(e) => {
                    tracing::warn!("kevin memory query embed failed (using text memory only): {e}");
                }
            }
        }
    }

    let mut out = semantic;
    out.extend(recent);
    Ok(out)
}

async fn summarize_conversation(
    db: &PgPool,
    http: &reqwest::Client,
    ai_api_key: &str,
    user_id: Uuid,
    conversation: &str,
) -> Result<String, String> {
    let req = GeminiSummaryRequest {
        system_instruction: GeminiSummarySystemInstruction {
            parts: vec![TextPart {
                text: "You are Kevin memory extraction. Summarize this conversation into 2-3 concise factual bullet points worth remembering about the user, fundraising context, startup details, goals, and preferences. Return plain text bullets only.".to_string(),
            }],
        },
        contents: vec![GeminiSummaryContent {
            role: "user".to_string(),
            parts: vec![TextPart {
                text: conversation.to_string(),
            }],
        }],
    };

    let url =
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";
    let res = http
        .post(url)
        .query(&[("key", ai_api_key)])
        .json(&req)
        .send()
        .await
        .map_err(|e| format!("memory summarize request: {e}"))?;

    if !res.status().is_success() {
        let body = res.text().await.unwrap_or_default();
        return Err(format!("memory summarize error: {body}"));
    }

    let parsed: GeminiSummaryResponse = res
        .json()
        .await
        .map_err(|e| format!("memory summarize json: {e}"))?;

    if let Some(ref u) = parsed.usage_metadata {
        crate::cost::record_llm_usage(
            db,
            Some(user_id),
            None,
            None,
            "memory_summarize",
            "gemini",
            "gemini-2.5-flash",
            u.prompt_token_count.unwrap_or(0),
            u.candidates_token_count.unwrap_or(0),
        )
        .await;
    }

    let text = parsed
        .candidates
        .as_ref()
        .and_then(|c| c.first())
        .and_then(|c| c.content.as_ref())
        .and_then(|c| c.parts.as_ref())
        .and_then(|p| p.first())
        .and_then(|p| p.text.as_ref())
        .cloned()
        .unwrap_or_default();

    Ok(text.trim().to_string())
}

/// `gemini-embedding-001` replaces `text-embedding-004`, which Google shut
/// down 2026-01-14 — every call to the old model was silently failing.
/// `outputDimensionality: 768` keeps output compatible with the existing
/// fixed `vector(768)` `kevin_memories.embedding` column (see
/// `migrations/0005_kevin_memory.sql`), avoiding a disruptive column-width
/// migration or invalidating stored embeddings.
const EMBEDDING_MODEL: &str = "gemini-embedding-001";
const EMBEDDING_DIMENSIONS: i32 = 768;

async fn embed_text(
    db: &PgPool,
    http: &reqwest::Client,
    ai_api_key: &str,
    user_id: Uuid,
    text: &str,
) -> Result<Vec<f32>, String> {
    let req = EmbedContentRequest {
        model: format!("models/{EMBEDDING_MODEL}"),
        content: EmbedInputContent {
            parts: vec![TextPart {
                text: text.to_string(),
            }],
        },
        output_dimensionality: EMBEDDING_DIMENSIONS,
    };

    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/{EMBEDDING_MODEL}:embedContent"
    );
    let res = http
        .post(&url)
        .query(&[("key", ai_api_key)])
        .json(&req)
        .send()
        .await
        .map_err(|e| format!("embedding request: {e}"))?;

    if !res.status().is_success() {
        let body = res.text().await.unwrap_or_default();
        return Err(format!("embedding error: {body}"));
    }

    let parsed: EmbedContentResponse = res
        .json()
        .await
        .map_err(|e| format!("embedding json: {e}"))?;

    // embedContent doesn't return a usage/token-count field on this API, so
    // cost is estimated from input length (~4 chars/token, the standard
    // rough heuristic) rather than an exact provider-reported count.
    let estimated_tokens = (text.chars().count() as f64 / 4.0).ceil() as i32;
    crate::cost::record_llm_usage(
        db,
        Some(user_id),
        None,
        None,
        "memory_embed",
        "gemini",
        EMBEDDING_MODEL,
        estimated_tokens,
        0,
    )
    .await;

    parsed
        .embedding
        .and_then(|e| e.values)
        .ok_or_else(|| "embedding response missing values".to_string())
}

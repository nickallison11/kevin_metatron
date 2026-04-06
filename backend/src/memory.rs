use pgvector::Vector;
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use uuid::Uuid;

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
struct GeminiSummaryResponse {
    candidates: Option<Vec<GeminiSummaryCandidate>>,
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
struct EmbedContentRequest {
    model: String,
    content: EmbedInputContent,
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

pub async fn store_memory(
    db: &PgPool,
    http: &reqwest::Client,
    ai_api_key: &str,
    user_id: Uuid,
    conversation: &str,
) -> Result<(), String> {
    let summary = summarize_conversation(http, ai_api_key, conversation).await?;
    if summary.trim().is_empty() {
        return Ok(());
    }

    let embedding_values = embed_text(http, ai_api_key, &summary).await?;
    let embedding = Vector::from(embedding_values);

    sqlx::query(
        r#"
        INSERT INTO kevin_memories (user_id, content, embedding)
        VALUES ($1, $2, $3)
        "#,
    )
    .bind(user_id)
    .bind(summary)
    .bind(embedding)
    .execute(db)
    .await
    .map_err(|e| format!("store memory db: {e}"))?;

    Ok(())
}

pub async fn recall_memories(
    db: &PgPool,
    http: &reqwest::Client,
    ai_api_key: &str,
    user_id: Uuid,
    query: &str,
) -> Result<Vec<String>, String> {
    if query.trim().is_empty() {
        return Ok(Vec::new());
    }

    let query_embedding_values = embed_text(http, ai_api_key, query).await?;
    let query_embedding = Vector::from(query_embedding_values);

    let rows: Vec<String> = sqlx::query_scalar(
        r#"
        SELECT content
        FROM kevin_memories
        WHERE user_id = $1
        ORDER BY
          CASE WHEN embedding IS NOT NULL THEN embedding <=> $2 ELSE 1.0 END ASC
        LIMIT 5
        "#,
    )
    .bind(user_id)
    .bind(query_embedding)
    .fetch_all(db)
    .await
    .map_err(|e| format!("recall memory db: {e}"))?;

    Ok(rows)
}

async fn summarize_conversation(
    http: &reqwest::Client,
    ai_api_key: &str,
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

async fn embed_text(
    http: &reqwest::Client,
    ai_api_key: &str,
    text: &str,
) -> Result<Vec<f32>, String> {
    let req = EmbedContentRequest {
        model: "models/text-embedding-004".to_string(),
        content: EmbedInputContent {
            parts: vec![TextPart {
                text: text.to_string(),
            }],
        },
    };

    let url =
        "https://generativelanguage.googleapis.com/v1/models/text-embedding-004:embedContent";
    let res = http
        .post(url)
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

    parsed
        .embedding
        .and_then(|e| e.values)
        .ok_or_else(|| "embedding response missing values".to_string())
}

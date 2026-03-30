use std::sync::Arc;

use axum::{
    extract::{Multipart, State},
    routing::get,
    Json, Router,
};
use axum_extra::{
    headers::{authorization::Bearer, Authorization},
    TypedHeader,
};
use chrono::{DateTime, Utc};
use serde::Serialize;
use serde_json::Value as JsonValue;
use sqlx::types::Json as SqlxJson;
use tokio::io::AsyncWriteExt;
use uuid::Uuid;

use crate::claude::{complete_json_object, mock_call_analysis_json};
use crate::identity::{require_role, AuthedUser};
use crate::state::AppState;

const MAX_AUDIO_BYTES: usize = 80 * 1024 * 1024;

pub fn router() -> Router<Arc<AppState>> {
    Router::new().route(
        "/",
        get(list_calls).post(upload_call),
    )
}

#[derive(Serialize)]
pub struct CallDto {
    pub id: Uuid,
    pub original_filename: String,
    pub transcript: Option<String>,
    pub analysis: Option<JsonValue>,
    pub created_at: DateTime<Utc>,
}

#[derive(sqlx::FromRow)]
struct CallRow {
    id: Uuid,
    original_filename: String,
    transcript: Option<String>,
    analysis: Option<SqlxJson<JsonValue>>,
    created_at: DateTime<Utc>,
}

impl From<CallRow> for CallDto {
    fn from(r: CallRow) -> Self {
        CallDto {
            id: r.id,
            original_filename: r.original_filename,
            transcript: r.transcript,
            analysis: r.analysis.map(|SqlxJson(v)| v),
            created_at: r.created_at,
        }
    }
}

async fn list_calls(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
) -> Result<Json<Vec<CallDto>>, (axum::http::StatusCode, String)> {
    let AuthedUser { id, .. } =
        require_role(&state, bearer.token(), &["STARTUP"]).await?;

    let rows = sqlx::query_as::<_, CallRow>(
        r#"
        SELECT id, original_filename, transcript, analysis, created_at
        FROM call_recordings
        WHERE user_id = $1
        ORDER BY created_at DESC
        "#,
    )
    .bind(id)
    .fetch_all(&state.db)
    .await
    .map_err(internal)?;

    Ok(Json(rows.into_iter().map(Into::into).collect()))
}

async fn upload_call(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
    mut multipart: Multipart,
) -> Result<Json<CallDto>, (axum::http::StatusCode, String)> {
    let AuthedUser { id, .. } =
        require_role(&state, bearer.token(), &["STARTUP"]).await?;

    let mut file_bytes: Option<Vec<u8>> = None;
    let mut original = String::from("recording");
    let mut mime = String::from("application/octet-stream");

    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| (axum::http::StatusCode::BAD_REQUEST, e.to_string()))?
    {
        if field.name() == Some("file") {
            original = field
                .file_name()
                .map(|s| s.to_string())
                .unwrap_or_else(|| "recording".into());
            if let Some(ct) = field.content_type() {
                mime = ct.to_string();
            }
            let data = field
                .bytes()
                .await
                .map_err(|e| (axum::http::StatusCode::BAD_REQUEST, e.to_string()))?;
            if data.len() > MAX_AUDIO_BYTES {
                return Err((
                    axum::http::StatusCode::PAYLOAD_TOO_LARGE,
                    "file too large".into(),
                ));
            }
            file_bytes = Some(data.to_vec());
            break;
        }
    }

    let raw = file_bytes.ok_or((
        axum::http::StatusCode::BAD_REQUEST,
        "missing file field".to_string(),
    ))?;

    let ext = original
        .rsplit_once('.')
        .map(|(_, e)| e)
        .unwrap_or("m4a")
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .take(6)
        .collect::<String>()
        .to_lowercase();

    let file_id = Uuid::new_v4();
    let stored_name = format!("{file_id}.{ext}");
    let path = state.upload_dir.join(&stored_name);

    let mut f = tokio::fs::File::create(&path)
        .await
        .map_err(internal)?;
    f.write_all(&raw).await.map_err(internal)?;

    let call_id = Uuid::new_v4();
    sqlx::query(
        r#"
        INSERT INTO call_recordings (id, user_id, original_filename, stored_path, mime_type)
        VALUES ($1, $2, $3, $4, $5)
        "#,
    )
    .bind(call_id)
    .bind(id)
    .bind(&original)
    .bind(&stored_name)
    .bind(&mime)
    .execute(&state.db)
    .await
    .map_err(internal)?;

    let transcript = mock_transcribe(&original);

    let analysis = if let Some(ref key) = state.anthropic_api_key {
        let system = "You are an expert venture analyst. Read call transcripts and extract structured diligence signals.";
        let prompt = format!(
            "Transcript:\n{transcript}\n\nReturn JSON with keys: summary (string), key_takeaways (array of strings), action_items (array of strings), investor_sentiment (one of: very_positive, positive, neutral, skeptical, negative)."
        );
        match complete_json_object(&state.http_client, key, system, &prompt).await {
            Ok(v) => v,
            Err(e) => {
                tracing::warn!("claude analysis failed: {e}");
                mock_call_analysis_json(&transcript)
            }
        }
    } else {
        mock_call_analysis_json(&transcript)
    };

    sqlx::query(
        r#"
        UPDATE call_recordings
        SET transcript = $1, analysis = $2
        WHERE id = $3
        "#,
    )
    .bind(&transcript)
    .bind(SqlxJson(analysis))
    .bind(call_id)
    .execute(&state.db)
    .await
    .map_err(internal)?;

    let row = sqlx::query_as::<_, CallRow>(
        r#"
        SELECT id, original_filename, transcript, analysis, created_at
        FROM call_recordings WHERE id = $1
        "#,
    )
    .bind(call_id)
    .fetch_one(&state.db)
    .await
    .map_err(internal)?;

    Ok(Json(row.into()))
}

fn mock_transcribe(filename: &str) -> String {
    format!(
        "[Mock transcription — connect Whisper later] Recording `{filename}`: discussion covered runway, product milestones, investor fit, and next steps for data room access."
    )
}

fn internal<E: std::fmt::Debug>(e: E) -> (axum::http::StatusCode, String) {
    tracing::error!(?e, "calls route");
    (
        axum::http::StatusCode::INTERNAL_SERVER_ERROR,
        "internal error".to_string(),
    )
}

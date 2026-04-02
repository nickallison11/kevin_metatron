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
use reqwest::multipart::{Form, Part};
use serde::Serialize;
use serde_json::Value as JsonValue;
use sqlx::types::Json as SqlxJson;
use tokio::io::AsyncWriteExt;
use uuid::Uuid;

use crate::ai::{complete_json_object, mock_call_analysis_json};
use crate::identity::require_role;
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
    let authed_user = require_role(&state, bearer.token(), &["STARTUP"]).await?;
    if !authed_user.is_pro {
        return Err((
            axum::http::StatusCode::FORBIDDEN,
            "pro subscription required".to_string(),
        ));
    }
    let id = authed_user.id;

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
    let authed_user = require_role(&state, bearer.token(), &["STARTUP"]).await?;
    if !authed_user.is_pro {
        return Err((
            axum::http::StatusCode::FORBIDDEN,
            "pro subscription required".to_string(),
        ));
    }
    let id = authed_user.id;

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

    let transcript = match whisper_transcribe(
        &state.http_client,
        &state.whisper_url,
        &raw,
        &original,
        &mime,
    )
    .await
    {
        Ok(t) => t,
        Err(e) => {
            tracing::warn!("whisper transcription failed: {e}");
            mock_transcribe(&original)
        }
    };

    let analysis = if let Some(ref key) = state.ai_api_key {
        let system = "You are an expert venture analyst. Read call transcripts and extract structured diligence signals.";
        let prompt = format!(
            "Transcript:\n{transcript}\n\nReturn JSON with keys: summary (string), key_takeaways (array of strings), action_items (array of strings), investor_sentiment (one of: very_positive, positive, neutral, skeptical, negative)."
        );
        match complete_json_object(
            &state.http_client,
            "gemini",
            key,
            "gemini-2.5-flash",
            system,
            &prompt,
        )
        .await
        {
            Ok(v) => v,
            Err(e) => {
                tracing::warn!("gemini analysis failed: {e}");
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

async fn whisper_transcribe(
    http_client: &reqwest::Client,
    whisper_url: &str,
    audio_bytes: &[u8],
    original_filename: &str,
    _mime: &str,
) -> Result<String, String> {
    let base = whisper_url.trim_end_matches('/');
    let url = format!("{base}/asr?output=txt&language=en");

    let form = Form::new()
        .part(
            "audio_file",
            Part::bytes(audio_bytes.to_vec()).file_name(original_filename.to_string()),
        );

    let resp = http_client
        .post(url)
        .multipart(form)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let status = resp.status();
    let txt = resp.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!(
            "whisper non-success: status={} body={}",
            status,
            txt.chars().take(300).collect::<String>()
        ));
    }

    Ok(txt.trim().to_string())
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

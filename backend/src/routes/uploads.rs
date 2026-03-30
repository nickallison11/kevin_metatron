use std::sync::Arc;

use axum::{
    body::Body,
    extract::{Multipart, Path, State},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    routing::post,
    Router,
};
use axum_extra::{
    headers::{authorization::Bearer, Authorization},
    TypedHeader,
};
use serde::Serialize;
use tokio::fs::File;
use tokio::io::AsyncWriteExt;
use uuid::Uuid;

use crate::identity::{require_role, AuthedUser};
use crate::state::AppState;

const MAX_UPLOAD_BYTES: usize = 52 * 1024 * 1024;

pub fn router() -> Router<Arc<AppState>> {
    Router::new().route("/pitch-deck", post(upload_pitch_deck))
}

#[derive(Serialize)]
struct UploadResponse {
    url: String,
}

async fn upload_pitch_deck(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
    mut multipart: Multipart,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let AuthedUser { id, .. } =
        require_role(&state, bearer.token(), &["STARTUP"]).await?;

    let mut file_bytes: Option<Vec<u8>> = None;
    let mut original = String::from("deck");

    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?
    {
        if field.name() == Some("file") {
            original = field
                .file_name()
                .map(|s| s.to_string())
                .unwrap_or_else(|| "deck".into());
            let data = field
                .bytes()
                .await
                .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;
            if data.len() > MAX_UPLOAD_BYTES {
                return Err((StatusCode::PAYLOAD_TOO_LARGE, "file too large".into()));
            }
            file_bytes = Some(data.to_vec());
            break;
        }
    }

    let raw = file_bytes.ok_or((StatusCode::BAD_REQUEST, "missing file field".to_string()))?;

    let ext = original
        .rsplit_once('.')
        .map(|(_, e)| e)
        .unwrap_or("pdf")
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .take(8)
        .collect::<String>()
        .to_lowercase();
    let allowed = matches!(ext.as_str(), "pdf" | "ppt" | "pptx" | "key" | "zip");
    let ext = if allowed { ext.as_str() } else { "bin" };

    let file_id = Uuid::new_v4();
    let stored_name = format!("{file_id}.{ext}");
    let path = state.upload_dir.join(&stored_name);

    let mut f = File::create(&path)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    f.write_all(&raw)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let url = format!("{}/files/{}", state.public_base_url, stored_name);

    sqlx::query(
        r#"
        INSERT INTO profiles (user_id, pitch_deck_url)
        VALUES ($1, $2)
        ON CONFLICT (user_id) DO UPDATE SET
            pitch_deck_url = EXCLUDED.pitch_deck_url,
            updated_at = now()
        "#,
    )
    .bind(id)
    .bind(&url)
    .execute(&state.db)
    .await
    .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "db error".into()))?;

    Ok((
        StatusCode::CREATED,
        axum::Json(UploadResponse { url }),
    ))
}

pub async fn serve_file(
    State(state): State<Arc<AppState>>,
    Path(name): Path<String>,
) -> Result<Response, (StatusCode, String)> {
    if !is_safe_stored_name(&name) {
        return Err((StatusCode::NOT_FOUND, "not found".into()));
    }
    let path = state.upload_dir.join(&name);
    if !path.starts_with(&state.upload_dir) {
        return Err((StatusCode::NOT_FOUND, "not found".into()));
    }
    let bytes = tokio::fs::read(&path)
        .await
        .map_err(|_| (StatusCode::NOT_FOUND, "not found".into()))?;

    let mime = mime_guess::from_path(&name)
        .first_or_octet_stream()
        .to_string();

    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, mime)
        .body(Body::from(bytes))
        .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "body".into()))
}

fn is_safe_stored_name(name: &str) -> bool {
    let parts: Vec<&str> = name.split('.').collect();
    if parts.len() != 2 {
        return false;
    }
    if Uuid::parse_str(parts[0]).is_err() {
        return false;
    }
    let ext = parts[1];
    !ext.is_empty()
        && ext.len() <= 12
        && ext.chars().all(|c| c.is_ascii_alphanumeric())
}

/// Used by claude context builder (optional).
#[allow(dead_code)]
pub fn file_url_for_stored_name(state: &AppState, stored: &str) -> String {
    format!("{}/files/{}", state.public_base_url, stored)
}

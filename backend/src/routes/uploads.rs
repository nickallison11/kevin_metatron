use std::sync::Arc;

use axum::{
    body::Body,
    extract::{Multipart, Path, State},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    routing::{post, put},
    Json,
    Router,
};
use axum_extra::{
    headers::{authorization::Bearer, Authorization},
    TypedHeader,
};
use serde::Deserialize;
use uuid::Uuid;

use crate::identity::require_user;
use crate::state::AppState;

const MAX_UPLOAD_BYTES: usize = 52 * 1024 * 1024;

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/pitch-deck", post(upload_pitch_deck))
        .route("/ipfs-visibility", put(set_ipfs_visibility))
}

async fn upload_pitch_deck(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
    mut multipart: Multipart,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let authed_user = require_user(&state, bearer.token()).await?;
    if !authed_user.is_pro {
        return Ok((
            StatusCode::FORBIDDEN,
            axum::Json(serde_json::json!({
                "error": "pitch deck upload requires a pro subscription"
            })),
        ));
    }
    if !authed_user.role.eq_ignore_ascii_case("STARTUP") {
        return Err((StatusCode::FORBIDDEN, "wrong role for this resource".into()));
    }
    let id = authed_user.id;
    let pinata_jwt = match state.pinata_jwt.as_deref() {
        Some(v) if !v.trim().is_empty() => v.to_string(),
        _ => {
            return Ok((
                StatusCode::SERVICE_UNAVAILABLE,
                Json(serde_json::json!({ "error": "file storage not configured" })),
            ));
        }
    };
    let pinata_gateway = state
        .pinata_gateway
        .as_deref()
        .unwrap_or("gateway.pinata.cloud")
        .trim_end_matches('/')
        .to_string();

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
    let visibility: String = sqlx::query_scalar(
        "SELECT COALESCE(ipfs_visibility, 'private') FROM profiles WHERE user_id = $1",
    )
    .bind(id)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "db error".into()))?
    .unwrap_or_else(|| "private".to_string());
    let visibility = if visibility.eq_ignore_ascii_case("public") {
        "public".to_string()
    } else {
        "private".to_string()
    };

    let filename = format!("{}.{}", Uuid::new_v4(), ext);
    let mut form =
        reqwest::multipart::Form::new().part("file", reqwest::multipart::Part::bytes(raw).file_name(filename));
    form = form.text("network", visibility.clone());

    let pinata_res = state
        .http_client
        .post("https://uploads.pinata.cloud/v3/files")
        .bearer_auth(&pinata_jwt)
        .multipart(form)
        .send()
        .await
        .map_err(|e| (StatusCode::BAD_GATEWAY, format!("pinata upload failed: {e}")))?;
    let pinata_status = pinata_res.status();
    let pinata_text = pinata_res
        .text()
        .await
        .map_err(|_| (StatusCode::BAD_GATEWAY, "pinata upload parse failed".into()))?;
    if !pinata_status.is_success() {
        return Err((
            StatusCode::BAD_GATEWAY,
            format!("pinata upload failed: {pinata_text}"),
        ));
    }
    let pinata_json: serde_json::Value = serde_json::from_str(&pinata_text)
        .map_err(|_| (StatusCode::BAD_GATEWAY, "pinata upload parse failed".into()))?;

    let url = if visibility == "public" {
        let cid = pinata_json
            .get("data")
            .and_then(|d| d.get("cid"))
            .and_then(|v| v.as_str())
            .ok_or((StatusCode::BAD_GATEWAY, "pinata cid missing".into()))?;
        format!("https://{pinata_gateway}/ipfs/{cid}")
    } else {
        let file_id = pinata_json
            .get("data")
            .and_then(|d| d.get("id"))
            .and_then(|v| v.as_str())
            .ok_or((StatusCode::BAD_GATEWAY, "pinata file id missing".into()))?;

        let sign_res = state
            .http_client
            .post("https://api.pinata.cloud/v3/files/sign")
            .bearer_auth(&pinata_jwt)
            .json(&serde_json::json!({
                "id": file_id,
                "expires": 3600
            }))
            .send()
            .await
            .map_err(|e| (StatusCode::BAD_GATEWAY, format!("pinata sign failed: {e}")))?;
        let sign_status = sign_res.status();
        let sign_text = sign_res
            .text()
            .await
            .map_err(|_| (StatusCode::BAD_GATEWAY, "pinata sign parse failed".into()))?;
        if !sign_status.is_success() {
            return Err((StatusCode::BAD_GATEWAY, format!("pinata sign failed: {sign_text}")));
        }
        let sign_json: serde_json::Value = serde_json::from_str(&sign_text)
            .map_err(|_| (StatusCode::BAD_GATEWAY, "pinata sign parse failed".into()))?;

        if let Some(signed) = sign_json
            .get("data")
            .and_then(|d| d.get("url").or_else(|| d.get("signed_url")).or_else(|| d.get("signedURL")))
            .and_then(|v| v.as_str())
        {
            signed.to_string()
        } else {
            let token = sign_json
                .get("data")
                .and_then(|d| d.get("token").or_else(|| d.get("jwt")))
                .and_then(|v| v.as_str())
                .ok_or((StatusCode::BAD_GATEWAY, "pinata signed url missing".into()))?;
            format!("https://{pinata_gateway}/files/{file_id}?pinata_gateway_token={token}")
        }
    };

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
        Json(serde_json::json!({
            "url": url,
            "visibility": visibility
        })),
    ))
}

#[derive(Deserialize)]
struct VisibilityBody {
    visibility: String,
}

async fn set_ipfs_visibility(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
    Json(body): Json<VisibilityBody>,
) -> Result<StatusCode, (StatusCode, String)> {
    let authed_user = require_user(&state, bearer.token()).await?;
    if !authed_user.is_pro {
        return Err((
            StatusCode::FORBIDDEN,
            "pitch deck upload requires a pro subscription".into(),
        ));
    }
    if !authed_user.role.eq_ignore_ascii_case("STARTUP") {
        return Err((StatusCode::FORBIDDEN, "wrong role for this resource".into()));
    }

    let visibility = body.visibility.to_ascii_lowercase();
    if visibility != "public" && visibility != "private" {
        return Err((
            StatusCode::BAD_REQUEST,
            "visibility must be either 'public' or 'private'".into(),
        ));
    }

    sqlx::query(
        r#"
        INSERT INTO profiles (user_id, ipfs_visibility)
        VALUES ($1, $2)
        ON CONFLICT (user_id) DO UPDATE SET
            ipfs_visibility = EXCLUDED.ipfs_visibility,
            updated_at = now()
        "#,
    )
    .bind(authed_user.id)
    .bind(visibility)
    .execute(&state.db)
    .await
    .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "db error".into()))?;

    Ok(StatusCode::NO_CONTENT)
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

/// Used by Kevin / AI context builder (optional).
#[allow(dead_code)]
pub fn file_url_for_stored_name(state: &AppState, stored: &str) -> String {
    format!("{}/files/{}", state.public_base_url, stored)
}

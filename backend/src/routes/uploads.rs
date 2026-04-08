use std::sync::Arc;

use axum::{
    body::Body,
    extract::{Path, Query, State},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post, put},
    Json,
    Router,
};
use axum_extra::{
    headers::{authorization::Bearer, Authorization},
    TypedHeader,
};
use chrono::{Duration as ChronoDuration, Utc};
use serde::Deserialize;
use serde_json::{json, Value as JsonValue};
use uuid::Uuid;

use crate::ai;
use crate::identity::require_user;
use crate::routes::pitches::{ensure_user_org, pitch_response_for_org_pitch, PitchResponse};
use crate::state::AppState;

const MAX_UPLOAD_BYTES: usize = 52 * 1024 * 1024;
const SIGNED_UPLOAD_TTL_SECS: u64 = 300;

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/pinata-jwt", get(get_pinata_jwt))
        .route("/pitch-deck-cid", post(pitch_deck_cid))
        .route("/ipfs-visibility", put(set_ipfs_visibility))
}

#[derive(Deserialize)]
struct PinataJwtQuery {
    #[serde(default = "default_deck_filename")]
    filename: String,
}

fn default_deck_filename() -> String {
    "deck.pdf".to_string()
}

fn sanitize_upload_filename(raw: &str) -> String {
    let base = raw
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or("deck.pdf")
        .trim();
    if base.is_empty() {
        return "deck.pdf".to_string();
    }
    let safe: String = base
        .chars()
        .filter(|c| *c != '/' && *c != '\\' && *c != '\0')
        .take(200)
        .collect();
    if safe.to_lowercase().ends_with(".pdf") {
        safe
    } else {
        format!("{safe}.pdf")
    }
}

/// Returns a short-lived Pinata signed upload URL (browser POSTs the file there).
async fn get_pinata_jwt(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
    Query(q): Query<PinataJwtQuery>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let authed_user = require_user(&state, bearer.token()).await?;
    if !authed_user.role.eq_ignore_ascii_case("STARTUP") {
        return Err((StatusCode::FORBIDDEN, "wrong role for this resource".into()));
    }

    if let Err(resp) = check_deck_upload_allowed(&state, authed_user.id, authed_user.is_pro).await {
        return Ok(resp);
    }

    let pinata_jwt = match state.pinata_jwt.as_deref() {
        Some(v) if !v.trim().is_empty() => v.to_string(),
        _ => {
            return Ok((
                StatusCode::SERVICE_UNAVAILABLE,
                Json(json!({ "error": "file storage not configured" })),
            )
                .into_response());
        }
    };

    let visibility = fetch_profile_visibility(&state.db, authed_user.id)
        .await
        .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "db error".to_string()))?;
    let network = if visibility == "public" {
        "public"
    } else {
        "private"
    };

    let filename = sanitize_upload_filename(&q.filename);
    let date = Utc::now().timestamp();
    let sign_body = json!({
        "date": date,
        "expires": SIGNED_UPLOAD_TTL_SECS,
        "network": network,
        "filename": filename,
        "max_file_size": MAX_UPLOAD_BYTES,
        "allow_mime_types": ["application/pdf"]
    });

    let sign_res = state
        .http_client
        .post("https://uploads.pinata.cloud/v3/files/sign")
        .bearer_auth(&pinata_jwt)
        .json(&sign_body)
        .send()
        .await
        .map_err(|e| (StatusCode::BAD_GATEWAY, format!("pinata sign failed: {e}")))?;
    let sign_status = sign_res.status();
    let sign_text = sign_res
        .text()
        .await
        .map_err(|_| (StatusCode::BAD_GATEWAY, "pinata sign parse failed".into()))?;
    if !sign_status.is_success() {
        return Err((
            StatusCode::BAD_GATEWAY,
            format!("pinata sign failed: {sign_text}"),
        ));
    }
    let sign_json: serde_json::Value = serde_json::from_str(&sign_text)
        .map_err(|_| (StatusCode::BAD_GATEWAY, "pinata sign parse failed".into()))?;
    let upload_url = sign_json
        .get("data")
        .and_then(|d| {
            d.as_str()
                .map(|s| s.to_string())
                .or_else(|| d.get("url").and_then(|u| u.as_str()).map(|s| s.to_string()))
        })
        .ok_or((
            StatusCode::BAD_GATEWAY,
            "pinata sign response missing data url".into(),
        ))?;

    Ok((
        StatusCode::OK,
        Json(json!({
            "upload_url": upload_url,
            "network": network,
            "expires_in": SIGNED_UPLOAD_TTL_SECS,
        })),
    )
        .into_response())
}

#[derive(Deserialize)]
struct PitchDeckCidBody {
    filename: String,
    #[serde(default)]
    cid: Option<String>,
    #[serde(default)]
    file_id: Option<String>,
}

async fn pitch_deck_cid(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
    Json(body): Json<PitchDeckCidBody>,
) -> Result<Response, (StatusCode, String)> {
    let authed_user = require_user(&state, bearer.token()).await?;
    if !authed_user.role.eq_ignore_ascii_case("STARTUP") {
        return Err((StatusCode::FORBIDDEN, "wrong role for this resource".into()));
    }
    let id = authed_user.id;

    if let Err(resp) = check_deck_upload_allowed(&state, id, authed_user.is_pro).await {
        return Ok(resp);
    }

    let pinata_jwt = match state.pinata_jwt.as_deref() {
        Some(v) if !v.trim().is_empty() => v.to_string(),
        _ => {
            return Ok((
                StatusCode::SERVICE_UNAVAILABLE,
                Json(json!({ "error": "file storage not configured" })),
            )
                .into_response());
        }
    };

    let pinata_gateway = state
        .pinata_gateway
        .as_deref()
        .unwrap_or("gateway.pinata.cloud")
        .trim_end_matches('/')
        .to_string();

    let visibility = fetch_profile_visibility(&state.db, id)
        .await
        .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "db error".into()))?;

    let filename = sanitize_upload_filename(&body.filename);
    let cid = body
        .cid
        .as_ref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty());
    let file_id = body
        .file_id
        .as_ref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty());

    if visibility == "public" && cid.is_none() {
        return Err((
            StatusCode::BAD_REQUEST,
            "cid is required for public uploads".into(),
        ));
    }
    if visibility == "private" && file_id.is_none() {
        return Err((
            StatusCode::BAD_REQUEST,
            "file_id is required for private uploads".into(),
        ));
    }

    let deck_url = build_stored_deck_url(
        &state.http_client,
        &pinata_jwt,
        &pinata_gateway,
        visibility.as_str(),
        cid,
        file_id,
    )
    .await
    .map_err(|e| (StatusCode::BAD_GATEWAY, e))?;

    let cid_out: Option<String> = if visibility == "public" {
        cid.map(|s| s.to_string())
    } else {
        file_id.map(|s| s.to_string())
    };

    let deck_expires_at = Utc::now() + ChronoDuration::days(14);

    sqlx::query(
        r#"
        INSERT INTO profiles (user_id, pitch_deck_url, deck_expires_at, deck_upload_count)
        VALUES ($1, $2, $3, 1)
        ON CONFLICT (user_id) DO UPDATE SET
            pitch_deck_url = EXCLUDED.pitch_deck_url,
            deck_expires_at = EXCLUDED.deck_expires_at,
            deck_upload_count = COALESCE(profiles.deck_upload_count, 0) + 1,
            updated_at = now()
        "#,
    )
    .bind(id)
    .bind(&deck_url)
    .bind(deck_expires_at)
    .execute(&state.db)
    .await
    .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "db error".into()))?;

    let is_pdf = filename.to_lowercase().ends_with(".pdf");
    let raw_pdf = if is_pdf {
        Some(
            fetch_deck_pdf_bytes(
                &state.http_client,
                &pinata_jwt,
                &pinata_gateway,
                visibility.as_str(),
                cid,
                file_id,
            )
            .await
            .map_err(|e| (StatusCode::BAD_GATEWAY, e))?,
        )
    } else {
        None
    };

    if let Some(ref bytes) = raw_pdf {
        if bytes.len() > MAX_UPLOAD_BYTES {
            return Err((StatusCode::BAD_REQUEST, "file too large".into()));
        }
    }

    let mut extracted: Option<JsonValue> = None;
    let mut extraction_error: Option<String> = None;
    let mut pitch: Option<PitchResponse> = None;

    if let Some(raw) = raw_pdf {
        if let Some(api_key) = state.ai_api_key.as_deref().filter(|k| !k.trim().is_empty()) {
            match ai::extract_pitch_from_deck_pdf(&state.http_client, api_key, &raw).await {
                Ok(v) => {
                    extracted = Some(v.clone());
                    match insert_pitch_from_extracted(&state.db, id, &v).await {
                        Ok(pid) => {
                            let org_id = ensure_user_org(&state.db, id).await.map_err(|_| {
                                (StatusCode::INTERNAL_SERVER_ERROR, "db error".into())
                            })?;
                            match pitch_response_for_org_pitch(&state.db, org_id, pid).await {
                                Ok(p) => pitch = Some(p),
                                Err(e) => {
                                    tracing::error!("pitch_response after deck insert: {e}");
                                }
                            }
                        }
                        Err(e) => {
                            tracing::error!("insert_pitch_from_extracted: {e}");
                        }
                    }
                }
                Err(e) => {
                    extraction_error = Some(e);
                }
            }
        } else {
            extraction_error = Some("GEMINI_API_KEY not configured".into());
        }
    }

    let mut out = json!({
        "url": deck_url,
        "visibility": visibility,
        "cid": cid_out,
        "deck_expires_at": deck_expires_at.to_rfc3339(),
        "extracted": extracted,
        "pitch": pitch,
    });
    if let Some(ref err) = extraction_error {
        out.as_object_mut()
            .expect("object")
            .insert("extraction_error".into(), json!(err));
    }

    Ok((StatusCode::CREATED, Json(out)).into_response())
}

async fn check_deck_upload_allowed(
    state: &AppState,
    user_id: Uuid,
    is_pro: bool,
) -> Result<(), axum::response::Response> {
    let deck_count: i32 = sqlx::query_scalar(
        r#"
        SELECT COALESCE(deck_upload_count, 0)::int
        FROM profiles WHERE user_id = $1
        "#,
    )
    .bind(user_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "db error" })),
        )
            .into_response()
    })?
    .unwrap_or(0);

    if !is_pro && deck_count >= 1 {
        return Err((
            StatusCode::FORBIDDEN,
            Json(json!({
                "error": "Free accounts can upload one deck"
            })),
        )
            .into_response());
    }
    Ok(())
}

async fn fetch_profile_visibility(db: &sqlx::PgPool, user_id: Uuid) -> Result<String, sqlx::Error> {
    let v: Option<String> = sqlx::query_scalar(
        "SELECT COALESCE(ipfs_visibility, 'private') FROM profiles WHERE user_id = $1",
    )
    .bind(user_id)
    .fetch_optional(db)
    .await?;

    let s = v.unwrap_or_else(|| "private".to_string());
    Ok(if s.eq_ignore_ascii_case("public") {
        "public".to_string()
    } else {
        "private".to_string()
    })
}

async fn build_stored_deck_url(
    client: &reqwest::Client,
    pinata_jwt: &str,
    pinata_gateway: &str,
    visibility: &str,
    cid: Option<&str>,
    file_id: Option<&str>,
) -> Result<String, String> {
    if visibility == "public" {
        let cid = cid.ok_or_else(|| "missing cid".to_string())?;
        return Ok(format!("https://{pinata_gateway}/ipfs/{cid}"));
    }

    let file_id = file_id.ok_or_else(|| "missing file_id".to_string())?;
    let sign_res = client
        .post("https://api.pinata.cloud/v3/files/sign")
        .bearer_auth(pinata_jwt)
        .json(&json!({
            "id": file_id,
            "expires": 3600
        }))
        .send()
        .await
        .map_err(|e| format!("pinata sign failed: {e}"))?;
    let sign_status = sign_res.status();
    let sign_text = sign_res
        .text()
        .await
        .map_err(|_| "pinata sign parse failed".to_string())?;
    if !sign_status.is_success() {
        return Err(format!("pinata sign failed: {sign_text}"));
    }
    let sign_json: serde_json::Value =
        serde_json::from_str(&sign_text).map_err(|_| "pinata sign parse failed".to_string())?;

    if let Some(signed) = sign_json
        .get("data")
        .and_then(|d| d.get("url").or_else(|| d.get("signed_url")).or_else(|| d.get("signedURL")))
        .and_then(|v| v.as_str())
    {
        return Ok(signed.to_string());
    }

    let token = sign_json
        .get("data")
        .and_then(|d| d.get("token").or_else(|| d.get("jwt")))
        .and_then(|v| v.as_str())
        .ok_or_else(|| "pinata signed url missing".to_string())?;
    Ok(format!(
        "https://{pinata_gateway}/files/{file_id}?pinata_gateway_token={token}"
    ))
}

async fn fetch_deck_pdf_bytes(
    client: &reqwest::Client,
    pinata_jwt: &str,
    pinata_gateway: &str,
    visibility: &str,
    cid: Option<&str>,
    file_id: Option<&str>,
) -> Result<Vec<u8>, String> {
    let url = if visibility == "public" {
        let cid = cid.ok_or_else(|| "missing cid".to_string())?;
        format!("https://{pinata_gateway}/ipfs/{cid}")
    } else {
        build_stored_deck_url(
            client,
            pinata_jwt,
            pinata_gateway,
            visibility,
            cid,
            file_id,
        )
        .await?
    };

    let res = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("fetch deck failed: {e}"))?;
    if !res.status().is_success() {
        return Err(format!("fetch deck: HTTP {}", res.status()));
    }
    res.bytes()
        .await
        .map(|b| b.to_vec())
        .map_err(|e| format!("read deck body: {e}"))
}

fn ev_str(obj: &JsonValue, key: &str) -> Option<String> {
    obj.get(key).and_then(|v| match v {
        JsonValue::String(s) => {
            let t = s.trim();
            if t.is_empty() {
                None
            } else {
                Some(t.to_string())
            }
        }
        JsonValue::Number(n) => Some(n.to_string()),
        JsonValue::Bool(b) => Some(b.to_string()),
        _ => None,
    })
}

fn normalize_team_members(v: &JsonValue) -> Option<JsonValue> {
    let arr = v.get("team_members")?.as_array()?;
    let mut out = Vec::new();
    for item in arr {
        let Some(o) = item.as_object() else {
            continue;
        };
        let name = o
            .get("name")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .trim()
            .to_string();
        let role = o
            .get("role")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .trim()
            .to_string();
        let linkedin = o
            .get("linkedin")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .trim()
            .to_string();
        if name.is_empty() && role.is_empty() && linkedin.is_empty() {
            continue;
        }
        out.push(json!({
            "name": name,
            "role": role,
            "linkedin": linkedin,
        }));
    }
    if out.is_empty() {
        None
    } else {
        Some(JsonValue::Array(out))
    }
}

async fn insert_pitch_from_extracted(
    db: &sqlx::PgPool,
    user_id: Uuid,
    extracted: &JsonValue,
) -> Result<Uuid, sqlx::Error> {
    let org_id = ensure_user_org(db, user_id).await?;
    let pitch_id = Uuid::new_v4();

    let title = ev_str(extracted, "company_name")
        .or_else(|| ev_str(extracted, "company"))
        .unwrap_or_else(|| "Untitled pitch".to_string());

    let description = ev_str(extracted, "one_liner");
    let problem = ev_str(extracted, "problem");
    let solution = ev_str(extracted, "solution");
    let market_size = ev_str(extracted, "market_size").or_else(|| ev_str(extracted, "market size"));
    let business_model = ev_str(extracted, "business_model");
    let traction = ev_str(extracted, "traction");
    let funding_ask = ev_str(extracted, "funding_ask").or_else(|| ev_str(extracted, "funding ask"));
    let use_of_funds = ev_str(extracted, "use_of_funds").or_else(|| ev_str(extracted, "use of funds"));
    let incorporation_country = ev_str(extracted, "incorporation_country");
    let team_members = normalize_team_members(extracted);

    sqlx::query(
        r#"
        INSERT INTO pitches (
            id, organization_id, created_by, title, description,
            problem, solution, market_size, business_model, traction, funding_ask, use_of_funds,
            team_size, incorporation_country, team_members
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
        "#,
    )
    .bind(pitch_id)
    .bind(org_id)
    .bind(user_id)
    .bind(&title)
    .bind(&description)
    .bind(&problem)
    .bind(&solution)
    .bind(&market_size)
    .bind(&business_model)
    .bind(&traction)
    .bind(&funding_ask)
    .bind(&use_of_funds)
    .bind(Option::<i32>::None)
    .bind(&incorporation_country)
    .bind(team_members)
    .execute(db)
    .await?;

    Ok(pitch_id)
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

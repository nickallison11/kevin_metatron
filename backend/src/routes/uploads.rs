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
use chrono::{Duration as ChronoDuration, Utc};
use serde::Deserialize;
use serde_json::{json, Value as JsonValue};
use uuid::Uuid;

use crate::ai;
use crate::identity::require_user;
use crate::ipfs_snapshot::snapshot_user_context;
use crate::routes::pitches::{ensure_user_org, pitch_response_for_org_pitch, PitchResponse};
use crate::state::AppState;

const MAX_UPLOAD_BYTES: usize = 52 * 1024 * 1024;

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/pitch-deck", post(upload_pitch_deck))
        .route("/ipfs-visibility", put(set_ipfs_visibility))
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

/// Multipart pitch deck upload: Pinata `pinFileToIPFS`, profile deck fields, Gemini extraction, pitch insert.
async fn upload_pitch_deck(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
    mut multipart: Multipart,
) -> Result<axum::response::Response, (StatusCode, String)> {
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
    let is_pdf = ext == "pdf";

    let filename = format!("{}.{}", Uuid::new_v4(), ext);
    let display_name = sanitize_upload_filename(&original);

    let mime = if is_pdf { "application/pdf" } else { "application/octet-stream" };

    // Determine group for this user's tier.
    let pinata_group = match authed_user.subscription_tier.to_ascii_lowercase().as_str() {
        "pro" => state.pinata_group_pro.clone(),
        "basic" | "monthly" | "annual" => state.pinata_group_basic.clone(),
        _ => state.pinata_group_free.clone(),
    };

    // Try v3 upload (uploads.pinata.cloud — no body-size limit, supports group_id).
    // Fall back to v2 pinFileToIPFS if v3 fails.
    let file_part = reqwest::multipart::Part::bytes(raw.clone())
        .file_name(filename.clone())
        .mime_str(mime)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let mut v3_form = reqwest::multipart::Form::new()
        .text("name", display_name.clone())
        .text("network", "public")
        .part("file", file_part);
    if let Some(ref gid) = pinata_group {
        v3_form = v3_form.text("group_id", gid.clone());
    }

    let v3_res = state
        .http_client
        .post("https://uploads.pinata.cloud/v3/files")
        .bearer_auth(&pinata_jwt)
        .multipart(v3_form)
        .send()
        .await;

    let cid: String = match v3_res {
        Ok(r) if r.status().is_success() => {
            let text = r.text().await.unwrap_or_default();
            let j: serde_json::Value = serde_json::from_str(&text)
                .map_err(|_| (StatusCode::BAD_GATEWAY, "pinata v3 parse failed".into()))?;
            let c = j.pointer("/data/cid").and_then(|v| v.as_str())
                .ok_or((StatusCode::BAD_GATEWAY, "pinata v3 missing data.cid".into()))?
                .to_string();
            tracing::info!("pinata: v3 uploaded CID {} group {:?}", c, pinata_group);
            c
        }
        Ok(r) => {
            let status = r.status();
            let body = r.text().await.unwrap_or_default();
            tracing::warn!("pinata: v3 upload returned {} — falling back to v2: {}", status, body.chars().take(200).collect::<String>());
            // v2 fallback
            let meta = json!({ "name": display_name });
            let part2 = reqwest::multipart::Part::bytes(raw.clone())
                .file_name(filename)
                .mime_str(mime)
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
            let form2 = reqwest::multipart::Form::new()
                .text("pinataMetadata", meta.to_string())
                .part("file", part2);
            let res2 = state.http_client
                .post("https://api.pinata.cloud/pinning/pinFileToIPFS")
                .bearer_auth(&pinata_jwt)
                .multipart(form2)
                .send()
                .await
                .map_err(|e| (StatusCode::BAD_GATEWAY, format!("pinata v2 failed: {e}")))?;
            let s2 = res2.status();
            let t2 = res2.text().await.unwrap_or_default();
            if !s2.is_success() {
                tracing::error!("pinata v2 failed: status={} body={}", s2, t2.chars().take(300).collect::<String>());
                return Err((StatusCode::BAD_GATEWAY, format!("pinata upload failed: {t2}")));
            }
            let j2: serde_json::Value = serde_json::from_str(&t2)
                .map_err(|_| (StatusCode::BAD_GATEWAY, "pinata v2 parse failed".into()))?;
            let c = j2.get("IpfsHash").and_then(|v| v.as_str())
                .ok_or((StatusCode::BAD_GATEWAY, "pinata v2 missing IpfsHash".into()))?
                .to_string();
            tracing::info!("pinata: v2 fallback uploaded CID {}", c);
            c
        }
        Err(e) => {
            return Err((StatusCode::BAD_GATEWAY, format!("pinata upload failed: {e}")));
        }
    };
    let cid = cid.as_str();

    let url = format!("https://{pinata_gateway}/ipfs/{cid}");
    let visibility = "public";
    let cid_out: Option<String> = Some(cid.to_string());

    let deck_expires_at = Utc::now() + ChronoDuration::days(14);

    sqlx::query(
        r#"
        INSERT INTO profiles (user_id, pitch_deck_url, deck_expires_at, deck_upload_count)
        VALUES ($1, $2, $3, 1)
        ON CONFLICT (user_id) DO UPDATE SET
            pitch_deck_url = EXCLUDED.pitch_deck_url,
            deck_expires_at = EXCLUDED.deck_expires_at,
            deck_upload_count = COALESCE(profiles.deck_upload_count, 0) + 1,
            deck_7day_email_sent = FALSE,
            deck_1day_email_sent = FALSE,
            deck_expired_email_sent = FALSE,
            updated_at = now()
        "#,
    )
    .bind(id)
    .bind(&url)
    .bind(deck_expires_at)
    .execute(&state.db)
    .await
    .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "db error".into()))?;

    let mut extracted: Option<JsonValue> = None;
    let mut extraction_error: Option<String> = None;
    let mut pitch: Option<PitchResponse> = None;

    if is_pdf {
        if let Some(api_key) = state.ai_api_key.as_deref().filter(|k| !k.trim().is_empty()) {
            match ai::extract_pitch_from_deck_pdf(
                &state.http_client,
                api_key,
                &raw,
                state.gemini_model.as_str(),
            )
            .await
            {
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

    let mut body = json!({
        "url": url,
        "visibility": visibility,
        "cid": cid_out,
        "deck_expires_at": deck_expires_at.to_rfc3339(),
        "extracted": extracted,
        "pitch": pitch,
    });
    if let Some(ref err) = extraction_error {
        body.as_object_mut()
            .expect("object")
            .insert("extraction_error".into(), json!(err));
    }

    let snap_state = Arc::clone(&state);
    let snap_uid = id;
    tokio::spawn(async move {
        snapshot_user_context(snap_state, snap_uid).await;
    });

    Ok((StatusCode::CREATED, Json(body)).into_response())
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

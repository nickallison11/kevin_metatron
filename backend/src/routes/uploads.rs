use std::sync::Arc;

use axum::{
    body::Body,
    extract::{Multipart, Path, State},
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
use chrono::Utc;
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
        .route("/pitch-deck", post(upload_pitch_deck).delete(delete_pitch_deck))
        .route("/pitch-deck/reimport", post(reimport_pitch_deck))
        .route("/pitch-deck/cover", post(deck_cover))
        .route("/file/:cid", get(serve_ipfs_file))
        .route("/logo", post(upload_logo))
        .route("/logo/from-website", post(logo_from_website))
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

/// Pins bytes to IPFS via Pinata (v3 upload, falling back to v2 pinFileToIPFS)
/// and returns the CID.
async fn pin_to_ipfs(
    state: &AppState,
    pinata_jwt: &str,
    raw: Vec<u8>,
    filename: &str,
    display_name: &str,
    mime: &str,
    pinata_group: Option<String>,
) -> Result<String, (StatusCode, String)> {
    // v3 (uploads.pinata.cloud) has no body-size limit and supports group_id.
    let file_part = reqwest::multipart::Part::bytes(raw.clone())
        .file_name(filename.to_string())
        .mime_str(mime)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let mut v3_form = reqwest::multipart::Form::new()
        .text("name", display_name.to_string())
        .text("network", "public")
        .part("file", file_part);
    if let Some(ref gid) = pinata_group {
        v3_form = v3_form.text("group_id", gid.clone());
    }

    let v3_res = state
        .http_client
        .post("https://uploads.pinata.cloud/v3/files")
        .bearer_auth(pinata_jwt)
        .multipart(v3_form)
        .send()
        .await;

    match v3_res {
        Ok(r) if r.status().is_success() => {
            let text = r.text().await.unwrap_or_default();
            let j: serde_json::Value = serde_json::from_str(&text)
                .map_err(|_| (StatusCode::BAD_GATEWAY, "pinata v3 parse failed".into()))?;
            let c = j.pointer("/data/cid").and_then(|v| v.as_str())
                .ok_or((StatusCode::BAD_GATEWAY, "pinata v3 missing data.cid".into()))?
                .to_string();
            tracing::info!("pinata: v3 uploaded CID {} group {:?}", c, pinata_group);
            Ok(c)
        }
        Ok(r) => {
            let status = r.status();
            let body = r.text().await.unwrap_or_default();
            tracing::warn!("pinata: v3 upload returned {} — falling back to v2: {}", status, body.chars().take(200).collect::<String>());
            let meta = json!({ "name": display_name });
            let part2 = reqwest::multipart::Part::bytes(raw)
                .file_name(filename.to_string())
                .mime_str(mime)
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
            let form2 = reqwest::multipart::Form::new()
                .text("pinataMetadata", meta.to_string())
                .part("file", part2);
            let res2 = state.http_client
                .post("https://api.pinata.cloud/pinning/pinFileToIPFS")
                .bearer_auth(pinata_jwt)
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
            Ok(c)
        }
        Err(e) => Err((StatusCode::BAD_GATEWAY, format!("pinata upload failed: {e}"))),
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

    let cid = pin_to_ipfs(&state, &pinata_jwt, raw.clone(), &filename, &display_name, mime, pinata_group).await?;
    let cid = cid.as_str();

    // Shown on the metatron domain; the frontend's /deck/:cid rewrite goes to
    // GET /uploads/file/:cid, which only serves files we stored.
    let url = format!("{}/deck/{cid}", crate::email::frontend_url());
    let visibility = "public";
    let cid_out: Option<String> = Some(cid.to_string());

    // Decks never expire, on any plan (free founders keep theirs up; decided 2026-10-21).
    let deck_expires_at: Option<chrono::DateTime<Utc>> = None;

    sqlx::query(
        r#"
        INSERT INTO profiles (user_id, pitch_deck_url, deck_expires_at, deck_upload_count, deck_uploaded_at)
        VALUES ($1, $2, $3, 1, now())
        ON CONFLICT (user_id) DO UPDATE SET
            pitch_deck_url = EXCLUDED.pitch_deck_url,
            deck_expires_at = EXCLUDED.deck_expires_at,
            deck_uploaded_at = now(),
            deck_cover_url = NULL,
            deck_pages = NULL,
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

    let import = is_pdf && can_import_deck(&authed_user);
    let (extracted, extraction_error, pitch) = if import {
        read_deck(&state, id, &raw).await?
    } else {
        (None, None, None)
    };

    let mut body = json!({
        "url": url,
        "visibility": visibility,
        "cid": cid_out,
        "deck_expires_at": deck_expires_at.map(|d| d.to_rfc3339()),
        "extracted": extracted,
        "pitch": pitch,
    });
    if let Some(ref err) = extraction_error {
        body.as_object_mut()
            .expect("object")
            .insert("extraction_error".into(), json!(err));
    }
    if is_pdf && !import {
        // Uploaded, but not imported: that needs Basic or Pro.
        body.as_object_mut().expect("object").insert("read_skipped".into(), json!(DECK_IMPORT_NEEDS_PLAN));
    }

    let snap_state = Arc::clone(&state);
    let snap_uid = id;
    tokio::spawn(async move {
        snapshot_user_context(snap_state, snap_uid).await;
    });
    // The deck may have given us the company website: look for the logo there.
    let logo_state = Arc::clone(&state);
    tokio::spawn(async move {
        refresh_logo_from_website(logo_state, id).await;
    });
    if is_pdf {
        let cover_state = Arc::clone(&state);
        tokio::spawn(async move {
            if let Err(e) = make_deck_cover(&cover_state, id, &raw).await {
                tracing::warn!("deck cover for {id}: {e}");
            }
        });
    }

    Ok((StatusCode::CREATED, Json(body)).into_response())
}

/// Anyone can upload a deck, but Kevin importing it (a Gemini call each time)
/// is part of Basic and Pro.
fn can_import_deck(user: &crate::identity::AuthedUser) -> bool {
    user.is_basic || user.is_pro || user.is_admin
}

const DECK_IMPORT_NEEDS_PLAN: &str = "Importing your deck with Kevin is part of Basic and Pro.";

/// Has Gemini read a PDF deck and copies what it found into the profile and
/// pitch. Returns (extracted fields, why it failed, updated pitch).
async fn read_deck(
    state: &Arc<AppState>,
    id: Uuid,
    raw: &[u8],
) -> Result<(Option<JsonValue>, Option<String>, Option<PitchResponse>), (StatusCode, String)> {
    let Some(api_key) = state.ai_api_key.as_deref().filter(|k| !k.trim().is_empty()) else {
        return Ok((None, Some("GEMINI_API_KEY not configured".into()), None));
    };
    match ai::extract_pitch_from_deck_pdf(&state.http_client, api_key, raw, state.gemini_model.as_str()).await {
        Ok((v, usage)) => {
            crate::cost::record_llm_usage(
                &state.db,
                Some(id),
                None,
                None,
                "pitch_extraction",
                "gemini",
                state.gemini_model.as_str(),
                usage.input_tokens,
                usage.output_tokens,
            )
            .await;
            let mut pitch = None;
            // Reading a deck refreshes every profile and pitch field the deck
            // covers (fields it doesn't mention keep what the founder wrote).
            match apply_deck_extraction(&state.db, id, &v, true).await {
                Ok(pid) => {
                    let org_id = ensure_user_org(&state.db, id)
                        .await
                        .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "db error".into()))?;
                    match pitch_response_for_org_pitch(&state.db, org_id, pid).await {
                        Ok(p) => pitch = Some(p),
                        Err(e) => tracing::error!("pitch_response after deck extraction: {e}"),
                    }
                }
                Err(e) => tracing::error!("apply_deck_extraction: {e}"),
            }
            Ok((Some(v), None, pitch))
        }
        Err(e) => {
            tracing::error!("deck extraction failed for user {id}: {}", e.chars().take(300).collect::<String>());
            Ok((None, Some(e), None))
        }
    }
}

/// The founder's current deck as (url, PDF bytes), fetched back from IPFS.
async fn fetch_own_deck(state: &AppState, id: Uuid) -> Result<(String, Vec<u8>), (StatusCode, String)> {
    let url: Option<String> = sqlx::query_scalar("SELECT pitch_deck_url FROM profiles WHERE user_id = $1")
        .bind(id)
        .fetch_optional(&state.db)
        .await
        .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "db error".into()))?
        .flatten();
    let url = url.filter(|u| !u.trim().is_empty()).ok_or((StatusCode::NOT_FOUND, "No deck to read. Upload one first.".into()))?;
    // Our own decks are served at <frontend>/deck/<cid>; external links can't be re-read.
    let cid = url
        .rsplit_once("/deck/")
        .map(|(_, c)| c.trim_end_matches('/').to_string())
        .filter(|c| c.len() >= 32 && c.chars().all(|ch| ch.is_ascii_alphanumeric()))
        .ok_or((StatusCode::BAD_REQUEST, "Kevin can only re-read decks uploaded here. Upload it again.".into()))?;

    let res = state
        .http_client
        .get(format!("{}/{cid}", ipfs_gateway_base(state)))
        .send()
        .await
        .map_err(|e| (StatusCode::BAD_GATEWAY, format!("could not fetch deck: {e}")))?;
    if !res.status().is_success() {
        return Err((StatusCode::BAD_GATEWAY, format!("could not fetch deck: {}", res.status())));
    }
    let raw = res.bytes().await.map_err(|e| (StatusCode::BAD_GATEWAY, format!("could not fetch deck: {e}")))?;
    if !raw.starts_with(b"%PDF") {
        return Err((StatusCode::BAD_REQUEST, "Kevin can only read PDF decks. Upload a PDF.".into()));
    }
    Ok((url, raw.to_vec()))
}

/// Renders the deck's first page as a JPEG (poppler's `pdftoppm`; ~120 KB vs
/// ~700 KB as PNG, which matters on mobile data), pins it to IPFS and saves
/// it with the page count. Returns (cover url, pages).
async fn make_deck_cover(state: &AppState, user_id: Uuid, pdf: &[u8]) -> Result<(String, Option<i32>), String> {
    let jwt = state
        .pinata_jwt
        .as_deref()
        .filter(|v| !v.trim().is_empty())
        .ok_or("file storage not configured")?
        .to_string();
    let dir = std::env::temp_dir().join(format!("deck-cover-{}", Uuid::new_v4()));
    tokio::fs::create_dir_all(&dir).await.map_err(|e| e.to_string())?;
    let pdf_path = dir.join("deck.pdf");
    let result = async {
        tokio::fs::write(&pdf_path, pdf).await.map_err(|e| e.to_string())?;
        let out = tokio::process::Command::new("pdftoppm")
            .args(["-f", "1", "-l", "1", "-jpeg", "-jpegopt", "quality=80", "-scale-to", "1280", "-singlefile"])
            .arg(&pdf_path)
            .arg(dir.join("cover"))
            .output()
            .await
            .map_err(|e| format!("pdftoppm: {e}"))?;
        if !out.status.success() {
            return Err(format!("pdftoppm: {}", String::from_utf8_lossy(&out.stderr).chars().take(200).collect::<String>()));
        }
        let jpg = tokio::fs::read(dir.join("cover.jpg")).await.map_err(|e| e.to_string())?;
        let pages = tokio::process::Command::new("pdfinfo")
            .arg(&pdf_path)
            .output()
            .await
            .ok()
            .and_then(|o| {
                String::from_utf8_lossy(&o.stdout)
                    .lines()
                    .find_map(|l| l.strip_prefix("Pages:").and_then(|v| v.trim().parse::<i32>().ok()))
            });
        let cid = pin_to_ipfs(state, &jwt, jpg, "cover.jpg", "deck cover", "image/jpeg", None)
            .await
            .map_err(|(_, m)| m)?;
        Ok((cid, pages))
    }
    .await;
    let _ = tokio::fs::remove_dir_all(&dir).await;
    let (cid, pages) = result?;
    let cover = format!("{}/media/{cid}", crate::email::frontend_url());
    sqlx::query("UPDATE profiles SET deck_cover_url = $2, deck_pages = $3 WHERE user_id = $1")
        .bind(user_id)
        .bind(&cover)
        .bind(pages)
        .execute(&state.db)
        .await
        .map_err(|e| e.to_string())?;
    Ok((cover, pages))
}

/// Makes the cover for a deck uploaded before covers existed.
async fn deck_cover(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
) -> Result<Json<JsonValue>, (StatusCode, String)> {
    let authed_user = require_user(&state, bearer.token()).await?;
    if !authed_user.role.eq_ignore_ascii_case("STARTUP") {
        return Err((StatusCode::FORBIDDEN, "wrong role for this resource".into()));
    }
    let (_, raw) = fetch_own_deck(&state, authed_user.id).await?;
    let (cover, pages) = make_deck_cover(&state, authed_user.id, &raw).await.map_err(|e| {
        tracing::warn!("deck cover for {}: {e}", authed_user.id);
        (StatusCode::BAD_GATEWAY, "Couldn't make a cover for this deck.".into())
    })?;
    Ok(Json(json!({ "deck_cover_url": cover, "deck_pages": pages })))
}

/// Has Kevin read the founder's current deck again, e.g. after a failed read.
async fn reimport_pitch_deck(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
) -> Result<Json<JsonValue>, (StatusCode, String)> {
    let authed_user = require_user(&state, bearer.token()).await?;
    if !authed_user.role.eq_ignore_ascii_case("STARTUP") {
        return Err((StatusCode::FORBIDDEN, "wrong role for this resource".into()));
    }
    if !can_import_deck(&authed_user) {
        return Err((StatusCode::PAYMENT_REQUIRED, DECK_IMPORT_NEEDS_PLAN.into()));
    }
    let id = authed_user.id;
    let (url, raw) = fetch_own_deck(&state, id).await?;

    let (extracted, extraction_error, pitch) = read_deck(&state, id, &raw).await?;
    let mut body = json!({ "url": url, "extracted": extracted, "pitch": pitch });
    if let Some(err) = extraction_error {
        body.as_object_mut().expect("object").insert("extraction_error".into(), json!(err));
    } else {
        let snap_state = Arc::clone(&state);
        tokio::spawn(async move { snapshot_user_context(snap_state, id).await });
    }
    Ok(Json(body))
}

/// Removes the deck from the profile. The pitch sections Kevin filled in stay.
/// The file stays pinned: IPFS is public, so unpinning wouldn't remove it.
async fn delete_pitch_deck(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
) -> Result<StatusCode, (StatusCode, String)> {
    let authed_user = require_user(&state, bearer.token()).await?;
    if !authed_user.role.eq_ignore_ascii_case("STARTUP") {
        return Err((StatusCode::FORBIDDEN, "wrong role for this resource".into()));
    }
    sqlx::query(
        "UPDATE profiles SET pitch_deck_url = NULL, deck_expires_at = NULL, deck_cover_url = NULL, deck_pages = NULL, \
         deck_uploaded_at = NULL, updated_at = now() WHERE user_id = $1",
    )
        .bind(authed_user.id)
        .execute(&state.db)
        .await
        .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "db error".into()))?;
    let snap_state = Arc::clone(&state);
    let uid = authed_user.id;
    tokio::spawn(async move { snapshot_user_context(snap_state, uid).await });
    Ok(StatusCode::NO_CONTENT)
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

const DECK_STAGES: [&str; 8] = [
    "idea", "pre-seed", "seed", "series-a", "series-b", "series-c", "growth", "profitable",
];

/// Stage slug as used by the profile form (`frontend/lib/stages.ts`).
fn deck_stage(v: &JsonValue) -> Option<String> {
    let s = ev_str(v, "stage")?.to_lowercase().replace([' ', '_'], "-");
    DECK_STAGES.contains(&s.as_str()).then_some(s)
}

/// Sector tags joined the way the profile form stores them ("FinTech, Payments").
fn deck_sectors(v: &JsonValue) -> Option<String> {
    let tags: Vec<String> = v
        .get("sectors")?
        .as_array()?
        .iter()
        .filter_map(|t| t.as_str().map(str::trim))
        .filter(|t| !t.is_empty())
        .take(4)
        .map(str::to_string)
        .collect();
    (!tags.is_empty()).then(|| tags.join(", "))
}

/// ISO 3166-1 alpha-2 code (profiles.country is CHAR(2)).
fn deck_country_code(v: &JsonValue) -> Option<String> {
    let c = ev_str(v, "country_code")?.to_uppercase();
    (c.len() == 2 && c.chars().all(|ch| ch.is_ascii_uppercase())).then_some(c)
}

/// SQL for one text column: with `$2` (overwrite) true the deck value replaces the
/// current one (kept when the deck has nothing for it); otherwise the deck value
/// only fills a blank.
fn fill_col(col: &str, param: &str) -> String {
    format!(
        "{col} = CASE WHEN $2 THEN COALESCE({param}::text, {col}::text) \
         ELSE COALESCE(NULLIF(TRIM({col}::text), ''), {param}::text) END"
    )
}

/// Applies Kevin's deck extraction to the founder's profile (company name, one-liner,
/// stage, sectors, country, website, deck text) and to their pitch — updating the
/// existing pitch rather than creating another one. `overwrite = false` fills only
/// empty fields (a new upload); `true` refreshes every field the deck covers
/// ("Fill from my deck"). Returns the pitch id.
async fn apply_deck_extraction(
    db: &sqlx::PgPool,
    user_id: Uuid,
    extracted: &JsonValue,
    overwrite: bool,
) -> Result<Uuid, sqlx::Error> {
    let company = ev_str(extracted, "company_name").or_else(|| ev_str(extracted, "company"));
    let one_liner = ev_str(extracted, "one_liner");
    let stage = deck_stage(extracted);
    let sectors = deck_sectors(extracted);
    let deck_text = ev_str(extracted, "full_text");

    sqlx::query("INSERT INTO profiles (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING")
        .bind(user_id)
        .execute(db)
        .await?;
    let profile_sql = format!(
        "UPDATE profiles SET {}, {}, {}, {}, {}, {}, deck_text = COALESCE($9, deck_text), updated_at = now() \
         WHERE user_id = $1",
        fill_col("company_name", "$3"),
        fill_col("one_liner", "$4"),
        fill_col("stage", "$5"),
        fill_col("sector", "$6"),
        fill_col("country", "$7"),
        fill_col("website", "$8"),
    );
    sqlx::query(&profile_sql)
        .bind(user_id)
        .bind(overwrite)
        .bind(&company)
        .bind(&one_liner)
        .bind(&stage)
        .bind(&sectors)
        .bind(deck_country_code(extracted))
        .bind(ev_str(extracted, "website"))
        .bind(&deck_text)
        .execute(db)
        .await?;

    // The founder's current pitch is the newest one (same order as GET /pitches).
    let org_id = ensure_user_org(db, user_id).await?;
    let existing: Option<Uuid> = sqlx::query_scalar(
        "SELECT id FROM pitches WHERE organization_id = $1 ORDER BY created_at DESC LIMIT 1",
    )
    .bind(org_id)
    .fetch_optional(db)
    .await?;
    // No pitch yet: create it, then the update below also fills stage and sector.
    let pitch_id = match existing {
        Some(id) => id,
        None => insert_pitch_from_extracted(db, user_id, extracted).await?,
    };

    let pitch_sql = format!(
        "UPDATE pitches SET \
         title = CASE WHEN $2 THEN COALESCE($3, title) \
                 ELSE COALESCE(NULLIF(NULLIF(TRIM(title), ''), 'Untitled pitch'), $3) END, \
         {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, \
         team_members = CASE \
             WHEN $2 THEN COALESCE($15, team_members) \
             WHEN team_members IS NULL OR team_members = '[]'::jsonb THEN COALESCE($15, team_members) \
             ELSE team_members END, \
         updated_at = now() \
         WHERE id = $1",
        fill_col("description", "$4"),
        fill_col("problem", "$5"),
        fill_col("solution", "$6"),
        fill_col("market_size", "$7"),
        fill_col("business_model", "$8"),
        fill_col("traction", "$9"),
        fill_col("funding_ask", "$10"),
        fill_col("use_of_funds", "$11"),
        fill_col("incorporation_country", "$12"),
        fill_col("stage", "$13"),
        fill_col("sector", "$14"),
    );
    sqlx::query(&pitch_sql)
        .bind(pitch_id)
        .bind(overwrite)
        .bind(&company)
        .bind(&one_liner)
        .bind(ev_str(extracted, "problem"))
        .bind(ev_str(extracted, "solution"))
        .bind(ev_str(extracted, "market_size").or_else(|| ev_str(extracted, "market size")))
        .bind(ev_str(extracted, "business_model"))
        .bind(ev_str(extracted, "traction"))
        .bind(ev_str(extracted, "funding_ask").or_else(|| ev_str(extracted, "funding ask")))
        .bind(ev_str(extracted, "use_of_funds").or_else(|| ev_str(extracted, "use of funds")))
        .bind(ev_str(extracted, "incorporation_country"))
        .bind(&stage)
        .bind(&sectors)
        .bind(normalize_team_members(extracted))
        .execute(db)
        .await?;

    Ok(pitch_id)
}

const MAX_SERVED_BYTES: usize = 64 * 1024 * 1024;
const MAX_LOGO_BYTES: usize = 2 * 1024 * 1024;

fn ipfs_gateway_base(state: &AppState) -> String {
    let gw = state.pinata_gateway.as_deref().unwrap_or("gateway.pinata.cloud").trim_end_matches('/');
    let host = gw.trim_start_matches("https://").trim_start_matches("http://");
    format!("https://{host}/ipfs")
}

/// GET /uploads/file/:cid — what {FRONTEND_URL}/deck/<cid> and /media/<cid>
/// rewrite to. Serves only files metatron stored (a founder's deck or a user's
/// logo), and only PDFs and raster images, so nobody can get arbitrary IPFS
/// content (e.g. an HTML page) served from the app's own domain.
async fn serve_ipfs_file(State(state): State<Arc<AppState>>, Path(cid): Path<String>) -> Response {
    let not_found = || (StatusCode::NOT_FOUND, "Not found").into_response();
    // CIDv0 (Qm…) and CIDv1 (bafy…) are plain alphanumerics.
    if cid.len() < 32 || cid.len() > 100 || !cid.chars().all(|c| c.is_ascii_alphanumeric()) {
        return not_found();
    }
    let known: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM profiles WHERE pitch_deck_url LIKE '%/' || $1 OR deck_cover_url LIKE '%/' || $1) \
             OR EXISTS(SELECT 1 FROM users WHERE logo_url LIKE '%/' || $1)",
    )
    .bind(&cid)
    .fetch_one(&state.db)
    .await
    .unwrap_or(false);
    if !known {
        return not_found();
    }

    let upstream = match state
        .http_client
        .get(format!("{}/{cid}", ipfs_gateway_base(&state)))
        .timeout(std::time::Duration::from_secs(90))
        .send()
        .await
    {
        Ok(r) if r.status().is_success() => r,
        Ok(r) => {
            tracing::warn!("serve_file: gateway {} for {cid}", r.status());
            return (StatusCode::BAD_GATEWAY, "File unavailable").into_response();
        }
        Err(e) => {
            tracing::warn!("serve_file: gateway error for {cid}: {e}");
            return (StatusCode::BAD_GATEWAY, "File unavailable").into_response();
        }
    };
    let bytes = match upstream.bytes().await {
        Ok(b) if b.len() <= MAX_SERVED_BYTES => b,
        _ => return (StatusCode::BAD_GATEWAY, "File unavailable").into_response(),
    };

    let (mime, is_pdf) = if bytes.starts_with(b"%PDF") {
        ("application/pdf", true)
    } else if let Some((_, mime)) = crate::net::sniff_image(&bytes) {
        (mime, false)
    } else {
        return (StatusCode::UNSUPPORTED_MEDIA_TYPE, "Unsupported file").into_response();
    };

    let mut builder = Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, mime)
        .header("X-Content-Type-Options", "nosniff")
        // A CID's content never changes.
        .header(header::CACHE_CONTROL, "public, max-age=31536000, immutable");
    if is_pdf {
        builder = builder.header(header::CONTENT_DISPOSITION, "inline; filename=\"pitch-deck.pdf\"");
    } else {
        builder = builder.header("Content-Security-Policy", "default-src 'none'; img-src 'self'; sandbox");
    }
    builder.body(Body::from(bytes)).unwrap_or_else(|_| not_found())
}

/// Stores a logo image on IPFS and records it on the user.
async fn store_logo(
    state: &AppState,
    user_id: Uuid,
    bytes: Vec<u8>,
    ext: &str,
    mime: &str,
    source: &str,
) -> Result<String, (StatusCode, String)> {
    let jwt = state
        .pinata_jwt
        .as_deref()
        .filter(|v| !v.trim().is_empty())
        .ok_or((StatusCode::SERVICE_UNAVAILABLE, "File storage isn't configured.".to_string()))?
        .to_string();
    let filename = format!("{}.{}", Uuid::new_v4(), ext);
    let cid = pin_to_ipfs(state, &jwt, bytes, &filename, &format!("logo-{user_id}.{ext}"), mime, None).await?;
    let url = format!("{}/media/{cid}", crate::email::frontend_url());
    sqlx::query("UPDATE users SET logo_url = $1, logo_source = $2 WHERE id = $3")
        .bind(&url)
        .bind(source)
        .bind(user_id)
        .execute(&state.db)
        .await
        .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "db error".to_string()))?;
    Ok(url)
}

/// The website a user's logo should come from: their own website field, else
/// their email's company domain.
async fn logo_site_for(state: &AppState, user_id: Uuid) -> Option<String> {
    let row: Option<(String, Option<String>)> = sqlx::query_as(
        r#"SELECT u.email,
                  COALESCE(NULLIF(TRIM(p.website), ''), NULLIF(TRIM(ip.website), ''), NULLIF(TRIM(cp.website), ''))
           FROM users u
           LEFT JOIN profiles p ON p.user_id = u.id
           LEFT JOIN investor_profiles ip ON ip.user_id = u.id
           LEFT JOIN connector_profiles cp ON cp.user_id = u.id
           WHERE u.id = $1"#,
    )
    .bind(user_id)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();
    let (email, website) = row?;
    crate::logo::logo_source_site(website.as_deref(), &email)
}

/// Looks for the user's logo on their website and stores it — unless they
/// uploaded one themselves. Called in the background after a profile save or a
/// deck upload; safe to call repeatedly.
pub async fn refresh_logo_from_website(state: Arc<AppState>, user_id: Uuid) {
    let source: Option<Option<String>> = sqlx::query_scalar("SELECT logo_source FROM users WHERE id = $1")
        .bind(user_id)
        .fetch_optional(&state.db)
        .await
        .ok()
        .flatten();
    if source.flatten().as_deref() == Some("upload") {
        return;
    }
    let Some(site) = logo_site_for(&state, user_id).await else { return };
    match crate::logo::find_logo(&site).await {
        Ok((bytes, ext, mime)) => {
            if let Err((_, e)) = store_logo(&state, user_id, bytes, ext, mime, "website").await {
                tracing::warn!("refresh_logo_from_website: store failed for {user_id}: {e}");
            }
        }
        Err(e) => tracing::info!("refresh_logo_from_website: none for {user_id} on {site}: {e}"),
    }
}

/// POST /uploads/logo — the user's own logo (PNG, JPG, WebP or GIF, up to 2 MB).
async fn upload_logo(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
    mut multipart: Multipart,
) -> Result<Json<JsonValue>, (StatusCode, String)> {
    let user = require_user(&state, bearer.token()).await?;
    let mut bytes: Option<Vec<u8>> = None;
    while let Some(field) = multipart.next_field().await.map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))? {
        if field.name() == Some("file") {
            let data = field.bytes().await.map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;
            if data.len() > MAX_LOGO_BYTES {
                return Err((StatusCode::PAYLOAD_TOO_LARGE, "Logos can be up to 2 MB.".into()));
            }
            bytes = Some(data.to_vec());
            break;
        }
    }
    let bytes = bytes.ok_or((StatusCode::BAD_REQUEST, "Choose an image to upload.".to_string()))?;
    let (ext, mime) = crate::net::sniff_image(&bytes)
        .filter(|(ext, _)| *ext != "ico")
        .ok_or((StatusCode::UNSUPPORTED_MEDIA_TYPE, "Upload a PNG, JPG or WebP image.".to_string()))?;
    let url = store_logo(&state, user.id, bytes, ext, mime, "upload").await?;
    Ok(Json(json!({ "logo_url": url, "logo_source": "upload" })))
}

/// POST /uploads/logo/from-website — look for the logo on the user's website
/// (or email domain) now. Replaces a previous website logo, and also an
/// uploaded one, since the user asked for it explicitly.
async fn logo_from_website(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
) -> Result<Json<JsonValue>, (StatusCode, String)> {
    let user = require_user(&state, bearer.token()).await?;
    let site = logo_site_for(&state, user.id).await.ok_or((
        StatusCode::NOT_FOUND,
        "Add your website first, then we can look for your logo there.".to_string(),
    ))?;
    let host = crate::logo::display_host(&site);
    let (bytes, ext, mime) = crate::logo::find_logo(&site)
        .await
        .map_err(|_| (StatusCode::NOT_FOUND, format!("We couldn't find a logo on {host}. Upload yours instead.")))?;
    let url = store_logo(&state, user.id, bytes, ext, mime, "website").await?;
    Ok(Json(json!({ "logo_url": url, "logo_source": "website", "site": host })))
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

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
        .route("/pitch-deck/refill", post(refill_from_deck))
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

    if let Err(resp) = check_deck_upload_allowed(&state, id, authed_user.is_basic, authed_user.is_pro).await {
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

    // Shown on the metatron domain; the frontend's /deck/:cid rewrite proxies the
    // file from the IPFS gateway (next.config.mjs).
    let url = format!("{}/deck/{cid}", crate::email::frontend_url());
    let visibility = "public";
    let cid_out: Option<String> = Some(cid.to_string());

    let deck_expires_at: Option<chrono::DateTime<Utc>> = if authed_user.is_basic || authed_user.is_pro {
        None
    } else {
        Some(Utc::now() + ChronoDuration::days(14))
    };

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
                    extracted = Some(v.clone());
                    // A new upload only fills fields the founder hasn't filled in yet;
                    // "Fill from my deck" (refill_from_deck) is the explicit full refresh.
                    match apply_deck_extraction(&state.db, id, &v, false).await {
                        Ok(pid) => {
                            let org_id = ensure_user_org(&state.db, id).await.map_err(|_| {
                                (StatusCode::INTERNAL_SERVER_ERROR, "db error".into())
                            })?;
                            match pitch_response_for_org_pitch(&state.db, org_id, pid).await {
                                Ok(p) => pitch = Some(p),
                                Err(e) => {
                                    tracing::error!("pitch_response after deck extraction: {e}");
                                }
                            }
                        }
                        Err(e) => {
                            tracing::error!("apply_deck_extraction: {e}");
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
        "deck_expires_at": deck_expires_at.map(|d| d.to_rfc3339()),
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
    is_basic: bool,
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

    if !is_basic && !is_pro && deck_count >= 1 {
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

/// True for addresses a server-side fetch must never reach (loopback, private,
/// link-local, CGNAT, unique-local) — the deck link is user-supplied.
fn is_internal_ip(ip: std::net::IpAddr) -> bool {
    match ip {
        std::net::IpAddr::V4(v) => {
            let o = v.octets();
            v.is_loopback()
                || v.is_private()
                || v.is_link_local()
                || v.is_unspecified()
                || v.is_broadcast()
                || (o[0] == 100 && (o[1] & 0xc0) == 64)
        }
        std::net::IpAddr::V6(v) => {
            let s0 = v.segments()[0];
            v.is_loopback() || v.is_unspecified() || (s0 & 0xfe00) == 0xfc00 || (s0 & 0xffc0) == 0xfe80
        }
    }
}

/// Downloads the founder's deck (an IPFS upload or a link they pasted) for Kevin to
/// read. https only, no internal addresses, PDFs only. Errors are user-facing.
async fn fetch_deck_pdf(deck_url: &str) -> Result<Vec<u8>, String> {
    let url = reqwest::Url::parse(deck_url).map_err(|_| "Your deck link isn't a valid web address.".to_string())?;
    if url.scheme() != "https" {
        return Err("Kevin can only read decks from secure (https) links.".into());
    }
    let host = url.host_str().ok_or("Your deck link isn't a valid web address.")?.to_string();
    let port = url.port_or_known_default().unwrap_or(443);
    let addrs: Vec<_> = tokio::net::lookup_host((host.as_str(), port))
        .await
        .map_err(|_| "Kevin couldn't reach your deck link.".to_string())?
        .collect();
    if addrs.is_empty() || addrs.iter().any(|a| is_internal_ip(a.ip())) {
        return Err("Kevin couldn't reach your deck link.".into());
    }

    // Follow ordinary hosting redirects (e.g. file-sharing links), but only to
    // https hostnames — never to a raw IP or localhost.
    let policy = reqwest::redirect::Policy::custom(|attempt| {
        let ok = attempt.url().scheme() == "https"
            && attempt.url().host_str().is_some_and(|h| {
                h != "localhost" && !h.starts_with('[') && h.parse::<std::net::IpAddr>().is_err()
            });
        if attempt.previous().len() >= 5 || !ok {
            attempt.stop()
        } else {
            attempt.follow()
        }
    });
    let client = reqwest::Client::builder()
        .redirect(policy)
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|_| "Kevin couldn't download your deck.".to_string())?;
    let resp = client
        .get(url)
        .send()
        .await
        .map_err(|_| "Kevin couldn't download your deck.".to_string())?;
    if !resp.status().is_success() {
        return Err(format!("Kevin couldn't download your deck (HTTP {}).", resp.status().as_u16()));
    }
    if resp.content_length().is_some_and(|n| n as usize > MAX_UPLOAD_BYTES) {
        return Err("Your deck is too large for Kevin to read.".into());
    }
    let bytes = resp
        .bytes()
        .await
        .map_err(|_| "Kevin couldn't download your deck.".to_string())?;
    if bytes.len() > MAX_UPLOAD_BYTES {
        return Err("Your deck is too large for Kevin to read.".into());
    }
    if !bytes.starts_with(b"%PDF") {
        return Err("Kevin can only read PDF decks. Upload your deck as a PDF, or link directly to a PDF file.".into());
    }
    Ok(bytes.to_vec())
}

/// "Fill from my deck": Kevin re-reads the deck already on the founder's profile and
/// refreshes every profile and pitch field the deck covers.
async fn refill_from_deck(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
) -> Result<axum::response::Response, (StatusCode, String)> {
    let authed_user = require_user(&state, bearer.token()).await?;
    if !authed_user.role.eq_ignore_ascii_case("STARTUP") {
        return Err((StatusCode::FORBIDDEN, "wrong role for this resource".into()));
    }
    let id = authed_user.id;

    let deck_url: Option<String> = sqlx::query_scalar::<_, Option<String>>(
        "SELECT pitch_deck_url FROM profiles WHERE user_id = $1",
    )
    .bind(id)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "db error".to_string()))?
    .flatten()
    .filter(|u| !u.trim().is_empty());
    let deck_url = deck_url.ok_or((StatusCode::BAD_REQUEST, "Add your pitch deck first.".to_string()))?;

    let api_key = state
        .ai_api_key
        .as_deref()
        .filter(|k| !k.trim().is_empty())
        .ok_or((StatusCode::SERVICE_UNAVAILABLE, "Deck reading isn't configured.".to_string()))?;

    let raw = fetch_deck_pdf(deck_url.trim())
        .await
        .map_err(|e| (StatusCode::UNPROCESSABLE_ENTITY, e))?;

    let (v, usage) = ai::extract_pitch_from_deck_pdf(&state.http_client, api_key, &raw, state.gemini_model.as_str())
        .await
        .map_err(|e| {
            tracing::warn!("refill_from_deck: extraction failed for {id}: {}", e.chars().take(300).collect::<String>());
            (StatusCode::BAD_GATEWAY, "Kevin couldn't read your deck. Please try again.".to_string())
        })?;
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

    let pitch_id = apply_deck_extraction(&state.db, id, &v, true).await.map_err(|e| {
        tracing::error!("refill_from_deck: apply failed for {id}: {e}");
        (StatusCode::INTERNAL_SERVER_ERROR, "db error".to_string())
    })?;
    let org_id = ensure_user_org(&state.db, id)
        .await
        .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "db error".to_string()))?;
    let pitch = pitch_response_for_org_pitch(&state.db, org_id, pitch_id).await.ok();

    let snap_state = Arc::clone(&state);
    tokio::spawn(async move {
        snapshot_user_context(snap_state, id).await;
    });

    Ok((StatusCode::OK, Json(json!({ "pitch": pitch }))).into_response())
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

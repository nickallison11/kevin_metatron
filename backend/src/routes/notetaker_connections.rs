use std::sync::Arc;

use axum::{
    extract::{Path, State},
    http::StatusCode,
    routing::{get, post},
    Json, Router,
};
use axum_extra::{
    headers::{authorization::Bearer, Authorization},
    TypedHeader,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::types::Json as SqlxJson;
use uuid::Uuid;

use crate::crypto;
use crate::identity::require_user;
use crate::routes::calls::analyze_transcript;
use crate::state::AppState;

/// Lets founders and investors paste in a personal API key for a meeting
/// note-taker (Fireflies, Fathom, tl;dv) instead of manually uploading audio.
/// A background task (see `start_notetaker_sync_task`) periodically pulls
/// new transcripts for every connected user and scores them the same way
/// as a manual upload.
pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/status", get(list_connections))
        .route("/:provider", post(connect).delete(disconnect))
        .route("/:provider/sync", post(sync_now))
}

fn internal(e: impl std::fmt::Display) -> (StatusCode, String) {
    tracing::error!("{e}");
    (StatusCode::INTERNAL_SERVER_ERROR, "internal error".to_string())
}

const PROVIDERS: [&str; 3] = ["fireflies", "fathom", "tldv"];

fn valid_provider(p: &str) -> bool {
    PROVIDERS.contains(&p)
}

#[derive(Serialize)]
struct ConnectionStatus {
    provider: String,
    connected: bool,
    connected_at: Option<DateTime<Utc>>,
    last_synced_at: Option<DateTime<Utc>>,
    last_sync_error: Option<String>,
}

async fn list_connections(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
) -> Result<Json<Vec<ConnectionStatus>>, (StatusCode, String)> {
    let user = require_user(&state, bearer.token()).await?;

    let rows: Vec<(String, DateTime<Utc>, Option<DateTime<Utc>>, Option<String>)> = sqlx::query_as(
        "SELECT provider, connected_at, last_synced_at, last_sync_error \
         FROM meeting_notetaker_connections WHERE user_id = $1",
    )
    .bind(user.id)
    .fetch_all(&state.db)
    .await
    .map_err(internal)?;

    let mut by_provider: std::collections::HashMap<String, (DateTime<Utc>, Option<DateTime<Utc>>, Option<String>)> =
        std::collections::HashMap::new();
    for (p, c, s, e) in rows {
        by_provider.insert(p, (c, s, e));
    }

    let out = PROVIDERS
        .iter()
        .map(|p| match by_provider.get(*p) {
            Some((connected_at, last_synced_at, last_sync_error)) => ConnectionStatus {
                provider: p.to_string(),
                connected: true,
                connected_at: Some(*connected_at),
                last_synced_at: *last_synced_at,
                last_sync_error: last_sync_error.clone(),
            },
            None => ConnectionStatus {
                provider: p.to_string(),
                connected: false,
                connected_at: None,
                last_synced_at: None,
                last_sync_error: None,
            },
        })
        .collect();

    Ok(Json(out))
}

#[derive(Deserialize)]
struct ConnectBody {
    api_key: String,
}

async fn connect(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
    Path(provider): Path<String>,
    Json(body): Json<ConnectBody>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let user = require_user(&state, bearer.token()).await?;
    if !valid_provider(&provider) {
        return Err((StatusCode::BAD_REQUEST, "unknown provider".to_string()));
    }
    let api_key = body.api_key.trim().to_string();
    if api_key.is_empty() {
        return Err((StatusCode::BAD_REQUEST, "api_key required".to_string()));
    }

    validate_key(&state.http_client, &provider, &api_key)
        .await
        .map_err(|e| (StatusCode::BAD_REQUEST, format!("Couldn't verify this key: {e}")))?;

    let encrypted = crypto::encrypt(&state.encryption_key, &api_key).map_err(internal)?;

    sqlx::query(
        r#"
        INSERT INTO meeting_notetaker_connections (user_id, provider, api_key)
        VALUES ($1, $2, $3)
        ON CONFLICT (user_id, provider)
        DO UPDATE SET api_key = $3, connected_at = now(), last_sync_error = NULL, last_synced_at = NULL
        "#,
    )
    .bind(user.id)
    .bind(&provider)
    .bind(&encrypted)
    .execute(&state.db)
    .await
    .map_err(internal)?;

    // Best-effort first sync so the user sees results immediately rather than
    // waiting for the next background cycle. A failure here doesn't undo the
    // connection — it'll retry on the next scheduled sync.
    let imported = sync_provider(&state, user.id, &provider, &api_key)
        .await
        .unwrap_or(0);

    Ok(Json(json!({ "connected": true, "imported": imported })))
}

async fn disconnect(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
    Path(provider): Path<String>,
) -> Result<StatusCode, (StatusCode, String)> {
    let user = require_user(&state, bearer.token()).await?;
    sqlx::query("DELETE FROM meeting_notetaker_connections WHERE user_id = $1 AND provider = $2")
        .bind(user.id)
        .bind(&provider)
        .execute(&state.db)
        .await
        .map_err(internal)?;
    Ok(StatusCode::NO_CONTENT)
}

async fn sync_now(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
    Path(provider): Path<String>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let user = require_user(&state, bearer.token()).await?;
    if !valid_provider(&provider) {
        return Err((StatusCode::BAD_REQUEST, "unknown provider".to_string()));
    }

    let encrypted: Option<String> = sqlx::query_scalar(
        "SELECT api_key FROM meeting_notetaker_connections WHERE user_id = $1 AND provider = $2",
    )
    .bind(user.id)
    .bind(&provider)
    .fetch_optional(&state.db)
    .await
    .map_err(internal)?;
    let Some(encrypted) = encrypted else {
        return Err((StatusCode::NOT_FOUND, "not connected".to_string()));
    };
    let api_key = crypto::decrypt(&state.encryption_key, &encrypted).map_err(internal)?;

    match sync_provider(&state, user.id, &provider, &api_key).await {
        Ok(imported) => Ok(Json(json!({ "imported": imported }))),
        Err(e) => Err((StatusCode::BAD_GATEWAY, e)),
    }
}

// ---------------------------------------------------------------------------
// Provider-specific fetch + validate
// ---------------------------------------------------------------------------

struct FetchedTranscript {
    external_id: String,
    title: String,
    transcript_text: String,
    source_url: Option<String>,
}

async fn validate_key(client: &reqwest::Client, provider: &str, api_key: &str) -> Result<(), String> {
    match provider {
        "fireflies" => {
            let res = client
                .post("https://api.fireflies.ai/graphql")
                .bearer_auth(api_key)
                .json(&json!({ "query": "{ user { user_id } }" }))
                .send()
                .await
                .map_err(|e| e.to_string())?;
            if !res.status().is_success() {
                return Err(format!("Fireflies returned {}", res.status()));
            }
            let body: Value = res.json().await.map_err(|e| e.to_string())?;
            if body.get("errors").is_some() {
                return Err("Fireflies rejected this key".to_string());
            }
            Ok(())
        }
        "fathom" => {
            let res = client
                .get("https://api.fathom.ai/external/v1/meetings")
                .header("X-Api-Key", api_key)
                .query(&[("limit", "1")])
                .send()
                .await
                .map_err(|e| e.to_string())?;
            if !res.status().is_success() {
                return Err(format!("Fathom returned {}", res.status()));
            }
            Ok(())
        }
        "tldv" => {
            let res = client
                .get("https://pasta.tldv.io/v1alpha1/meetings")
                .header("x-api-key", api_key)
                .send()
                .await
                .map_err(|e| e.to_string())?;
            if !res.status().is_success() {
                return Err(format!("tl;dv returned {}", res.status()));
            }
            Ok(())
        }
        _ => Err("unknown provider".to_string()),
    }
}

async fn fetch_recent(
    client: &reqwest::Client,
    provider: &str,
    api_key: &str,
    since: Option<DateTime<Utc>>,
) -> Result<Vec<FetchedTranscript>, String> {
    match provider {
        "fireflies" => fetch_fireflies(client, api_key, since).await,
        "fathom" => fetch_fathom(client, api_key, since).await,
        "tldv" => fetch_tldv(client, api_key).await,
        _ => Err("unknown provider".to_string()),
    }
}

async fn fetch_fireflies(
    client: &reqwest::Client,
    api_key: &str,
    since: Option<DateTime<Utc>>,
) -> Result<Vec<FetchedTranscript>, String> {
    let list_query = json!({
        "query": "query Transcripts($limit: Int, $fromDate: DateTime) { transcripts(limit: $limit, fromDate: $fromDate) { id title date } }",
        "variables": { "limit": 20, "fromDate": since.map(|d| d.to_rfc3339()) }
    });
    let res = client
        .post("https://api.fireflies.ai/graphql")
        .bearer_auth(api_key)
        .json(&list_query)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let body: Value = res.json().await.map_err(|e| e.to_string())?;
    let list = body["data"]["transcripts"].as_array().cloned().unwrap_or_default();

    let mut out = Vec::new();
    for item in list {
        let Some(id) = item["id"].as_str() else { continue };
        let title = item["title"].as_str().unwrap_or("Untitled call").to_string();

        let detail_query = json!({
            "query": "query T($id: String!) { transcript(id: $id) { title video_url sentences { speaker_name text } } }",
            "variables": { "id": id }
        });
        let detail_res = client
            .post("https://api.fireflies.ai/graphql")
            .bearer_auth(api_key)
            .json(&detail_query)
            .send()
            .await
            .map_err(|e| e.to_string())?;
        let detail: Value = detail_res.json().await.map_err(|e| e.to_string())?;
        let t = &detail["data"]["transcript"];
        let sentences = t["sentences"].as_array().cloned().unwrap_or_default();
        let transcript_text = sentences
            .iter()
            .map(|s| {
                format!(
                    "{}: {}",
                    s["speaker_name"].as_str().unwrap_or("Speaker"),
                    s["text"].as_str().unwrap_or("")
                )
            })
            .collect::<Vec<_>>()
            .join("\n");
        if transcript_text.trim().is_empty() {
            continue;
        }

        out.push(FetchedTranscript {
            external_id: id.to_string(),
            title,
            transcript_text,
            source_url: t["video_url"].as_str().map(str::to_string),
        });
    }
    Ok(out)
}

async fn fetch_fathom(
    client: &reqwest::Client,
    api_key: &str,
    since: Option<DateTime<Utc>>,
) -> Result<Vec<FetchedTranscript>, String> {
    let mut req = client
        .get("https://api.fathom.ai/external/v1/meetings")
        .header("X-Api-Key", api_key)
        .query(&[("include_transcript", "true"), ("include_summary", "false")]);
    if let Some(since) = since {
        req = req.query(&[("created_after", since.to_rfc3339())]);
    }
    let res = req.send().await.map_err(|e| e.to_string())?;
    let body: Value = res.json().await.map_err(|e| e.to_string())?;
    let items = body["items"].as_array().cloned().unwrap_or_default();

    let mut out = Vec::new();
    for item in items {
        let Some(recording_id) = item["recording_id"].as_u64() else { continue };
        let title = item["title"].as_str().unwrap_or("Untitled call").to_string();
        let segments = item["transcript"].as_array().cloned().unwrap_or_default();
        let transcript_text = segments
            .iter()
            .filter_map(|s| s["text"].as_str())
            .collect::<Vec<_>>()
            .join("\n");
        if transcript_text.trim().is_empty() {
            continue;
        }
        let source_url = item["url"]
            .as_str()
            .or_else(|| item["meeting_url"].as_str())
            .map(str::to_string);

        out.push(FetchedTranscript {
            external_id: recording_id.to_string(),
            title,
            transcript_text,
            source_url,
        });
    }
    Ok(out)
}

async fn fetch_tldv(client: &reqwest::Client, api_key: &str) -> Result<Vec<FetchedTranscript>, String> {
    let res = client
        .get("https://pasta.tldv.io/v1alpha1/meetings")
        .header("x-api-key", api_key)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let body: Value = res.json().await.map_err(|e| e.to_string())?;
    let results = body["results"].as_array().cloned().unwrap_or_default();

    let mut out = Vec::new();
    for item in results {
        let Some(id) = item["id"].as_str() else { continue };
        let title = item["name"].as_str().unwrap_or("Untitled call").to_string();

        let transcript_res = client
            .get(format!("https://pasta.tldv.io/v1alpha1/meetings/{id}/transcript"))
            .header("x-api-key", api_key)
            .send()
            .await
            .map_err(|e| e.to_string())?;
        let transcript_body: Value = transcript_res.json().await.map_err(|e| e.to_string())?;
        let segments = transcript_body["data"].as_array().cloned().unwrap_or_default();
        let transcript_text = segments
            .iter()
            .map(|s| {
                format!(
                    "{}: {}",
                    s["speaker"].as_str().unwrap_or("Speaker"),
                    s["text"].as_str().unwrap_or("")
                )
            })
            .collect::<Vec<_>>()
            .join("\n");
        if transcript_text.trim().is_empty() {
            continue;
        }

        out.push(FetchedTranscript {
            external_id: id.to_string(),
            title,
            transcript_text,
            source_url: None,
        });
    }
    Ok(out)
}

/// Fetches new transcripts, scores each with the same pipeline as a manual
/// upload, and inserts them into `call_recordings`. Returns how many were
/// newly imported. Updates `last_synced_at`/`last_sync_error` regardless of
/// outcome so `sync_now` and the background task share one code path.
async fn sync_provider(
    state: &AppState,
    user_id: Uuid,
    provider: &str,
    api_key: &str,
) -> Result<usize, String> {
    let since: Option<DateTime<Utc>> = sqlx::query_scalar::<_, Option<DateTime<Utc>>>(
        "SELECT last_synced_at FROM meeting_notetaker_connections WHERE user_id = $1 AND provider = $2",
    )
    .bind(user_id)
    .bind(provider)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| e.to_string())?
    .flatten();

    let fetch_result = fetch_recent(&state.http_client, provider, api_key, since).await;

    let items = match fetch_result {
        Ok(items) => items,
        Err(e) => {
            let _ = sqlx::query(
                "UPDATE meeting_notetaker_connections SET last_sync_error = $1 WHERE user_id = $2 AND provider = $3",
            )
            .bind(&e)
            .bind(user_id)
            .bind(provider)
            .execute(&state.db)
            .await;
            return Err(e);
        }
    };

    let mut imported = 0usize;
    for item in items {
        let exists: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM call_recordings WHERE source = $1 AND external_id = $2)",
        )
        .bind(provider)
        .bind(&item.external_id)
        .fetch_one(&state.db)
        .await
        .map_err(|e| e.to_string())?;
        if exists {
            continue;
        }

        let analysis = analyze_transcript(state, &item.transcript_text).await;
        let call_id = Uuid::new_v4();
        let insert = sqlx::query(
            r#"
            INSERT INTO call_recordings (id, user_id, original_filename, stored_path, transcript, analysis, source, external_id)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            ON CONFLICT (source, external_id) WHERE external_id IS NOT NULL DO NOTHING
            "#,
        )
        .bind(call_id)
        .bind(user_id)
        .bind(&item.title)
        .bind(item.source_url.as_deref())
        .bind(&item.transcript_text)
        .bind(SqlxJson(analysis))
        .bind(provider)
        .bind(&item.external_id)
        .execute(&state.db)
        .await
        .map_err(|e| e.to_string())?;

        if insert.rows_affected() > 0 {
            imported += 1;
        }
    }

    let _ = sqlx::query(
        "UPDATE meeting_notetaker_connections SET last_synced_at = now(), last_sync_error = NULL WHERE user_id = $1 AND provider = $2",
    )
    .bind(user_id)
    .bind(provider)
    .execute(&state.db)
    .await;

    Ok(imported)
}

/// Background task: every 30 minutes, syncs every connected user/provider
/// pair. Mirrors the pattern in `cleanup.rs` (`start_cleanup_task` etc).
pub fn start_notetaker_sync_task(state: Arc<AppState>) {
    tokio::task::spawn(async move {
        loop {
            let connections: Vec<(Uuid, String, String)> = sqlx::query_as(
                "SELECT user_id, provider, api_key FROM meeting_notetaker_connections",
            )
            .fetch_all(&state.db)
            .await
            .unwrap_or_default();

            for (user_id, provider, encrypted) in connections {
                let Ok(api_key) = crypto::decrypt(&state.encryption_key, &encrypted) else {
                    tracing::warn!("notetaker sync: failed to decrypt key for user {user_id} ({provider})");
                    continue;
                };
                match sync_provider(&state, user_id, &provider, &api_key).await {
                    Ok(n) if n > 0 => {
                        tracing::info!("notetaker sync: imported {n} new call(s) for user {user_id} ({provider})");
                    }
                    Ok(_) => {}
                    Err(e) => {
                        tracing::warn!("notetaker sync failed for user {user_id} ({provider}): {e}");
                    }
                }
            }

            tokio::time::sleep(std::time::Duration::from_secs(1_800)).await;
        }
    });
}

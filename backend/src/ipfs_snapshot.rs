use std::sync::Arc;

use serde_json::json;
use uuid::Uuid;

use crate::state::AppState;

/// Snapshot the user's full profile + pitch data to Pinata v3 as a JSON file.
/// Stores the resulting CID and URL in profiles.context_cid / context_ipfs_url.
/// Runs best-effort: all errors are logged, never propagated.
pub async fn snapshot_user_context(state: Arc<AppState>, user_id: Uuid) {
    let pinata_jwt = match state.pinata_jwt.as_deref() {
        Some(v) if !v.trim().is_empty() => v.to_string(),
        _ => return, // Pinata not configured — skip silently
    };

    let pinata_gateway = state
        .pinata_gateway
        .as_deref()
        .unwrap_or("gateway.pinata.cloud")
        .trim_end_matches('/')
        .to_string();

    // --- Fetch profile ---
    let profile: Option<SnapshotProfile> = match sqlx::query_as::<_, SnapshotProfile>(
        r#"
        SELECT company_name, one_liner, stage, sector, country::text AS country,
               website, pitch_deck_url
        FROM profiles WHERE user_id = $1
        "#,
    )
    .bind(user_id)
    .fetch_optional(&state.db)
    .await
    {
        Ok(r) => r,
        Err(e) => {
            tracing::warn!("ipfs_snapshot: profile fetch failed for {user_id}: {e}");
            return;
        }
    };

    // --- Fetch pitches ---
    let pitches: Vec<SnapshotPitch> = match sqlx::query_as::<_, SnapshotPitch>(
        r#"
        SELECT title, description, problem, solution, market_size,
               business_model, traction, funding_ask, use_of_funds,
               team_size, incorporation_country
        FROM pitches WHERE created_by = $1
        ORDER BY created_at DESC LIMIT 10
        "#,
    )
    .bind(user_id)
    .fetch_all(&state.db)
    .await
    {
        Ok(r) => r,
        Err(e) => {
            tracing::warn!("ipfs_snapshot: pitches fetch failed for {user_id}: {e}");
            vec![]
        }
    };

    // --- Fetch last 10 text memories as a summary ---
    let memories: Vec<String> = match sqlx::query_scalar(
        r#"
        SELECT content FROM (
            SELECT content, created_at FROM kevin_text_memories
            WHERE user_id = $1
            ORDER BY created_at DESC LIMIT 10
        ) sub ORDER BY sub.created_at ASC
        "#,
    )
    .bind(user_id)
    .fetch_all(&state.db)
    .await
    {
        Ok(r) => r,
        Err(_) => vec![],
    };

    let memory_summary = memories.join(" | ");

    // --- Build snapshot JSON ---
    let profile_json = profile.as_ref().map(|p| {
        json!({
            "company_name": p.company_name,
            "one_liner": p.one_liner,
            "stage": p.stage,
            "sector": p.sector,
            "country": p.country,
            "website": p.website,
            "pitch_deck_url": p.pitch_deck_url,
        })
    });

    let pitches_json: Vec<serde_json::Value> = pitches
        .iter()
        .map(|p| {
            json!({
                "title": p.title,
                "description": p.description,
                "problem": p.problem,
                "solution": p.solution,
                "market_size": p.market_size,
                "business_model": p.business_model,
                "traction": p.traction,
                "funding_ask": p.funding_ask,
                "use_of_funds": p.use_of_funds,
                "team_size": p.team_size,
                "incorporation_country": p.incorporation_country,
            })
        })
        .collect();

    let snapshot = json!({
        "version": "1",
        "platform": "metatron",
        "user_id": user_id.to_string(),
        "generated_at": chrono::Utc::now().to_rfc3339(),
        "profile": profile_json,
        "pitches": pitches_json,
        "memory_summary": if memory_summary.is_empty() { None } else { Some(memory_summary) },
    });

    let snapshot_bytes = match serde_json::to_vec_pretty(&snapshot) {
        Ok(b) => b,
        Err(e) => {
            tracing::warn!("ipfs_snapshot: JSON serialise failed for {user_id}: {e}");
            return;
        }
    };

    let filename = format!("{}-context.json", user_id);
    let display_name = format!("metatron-context-{user_id}.json");

    let file_part = match reqwest::multipart::Part::bytes(snapshot_bytes)
        .file_name(filename)
        .mime_str("application/json")
    {
        Ok(p) => p,
        Err(e) => {
            tracing::warn!("ipfs_snapshot: part build failed: {e}");
            return;
        }
    };

    let group_id = state.pinata_group_free.clone(); // context snapshots go in free group
    let mut form = reqwest::multipart::Form::new()
        .text("name", display_name)
        .text("network", "public")
        .part("file", file_part);
    if let Some(ref gid) = group_id {
        form = form.text("group_id", gid.clone());
    }

    let res = match state
        .http_client
        .post("https://uploads.pinata.cloud/v3/files")
        .bearer_auth(&pinata_jwt)
        .multipart(form)
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => {
            tracing::warn!("ipfs_snapshot: pinata upload failed for {user_id}: {e}");
            return;
        }
    };

    if !res.status().is_success() {
        let status = res.status();
        let body = res.text().await.unwrap_or_default();
        tracing::warn!(
            "ipfs_snapshot: pinata returned {} for {user_id}: {}",
            status,
            body.chars().take(300).collect::<String>()
        );
        return;
    }

    let j: serde_json::Value = match res.json().await {
        Ok(v) => v,
        Err(e) => {
            tracing::warn!("ipfs_snapshot: pinata parse failed for {user_id}: {e}");
            return;
        }
    };

    let cid = match j.pointer("/data/cid").and_then(|v| v.as_str()) {
        Some(c) => c.to_string(),
        None => {
            tracing::warn!("ipfs_snapshot: missing data.cid for {user_id}");
            return;
        }
    };

    let url = format!("https://{pinata_gateway}/ipfs/{cid}");

    if let Err(e) = sqlx::query(
        r#"
        UPDATE profiles SET context_cid = $1, context_ipfs_url = $2, updated_at = now()
        WHERE user_id = $3
        "#,
    )
    .bind(&cid)
    .bind(&url)
    .bind(user_id)
    .execute(&state.db)
    .await
    {
        tracing::warn!("ipfs_snapshot: DB update failed for {user_id}: {e}");
        return;
    }

    tracing::info!("ipfs_snapshot: pinned context for user {} → {}", user_id, cid);
}

#[derive(sqlx::FromRow)]
struct SnapshotProfile {
    company_name: Option<String>,
    one_liner: Option<String>,
    stage: Option<String>,
    sector: Option<String>,
    country: Option<String>,
    website: Option<String>,
    pitch_deck_url: Option<String>,
}

#[derive(sqlx::FromRow)]
struct SnapshotPitch {
    title: String,
    description: Option<String>,
    problem: Option<String>,
    solution: Option<String>,
    market_size: Option<String>,
    business_model: Option<String>,
    traction: Option<String>,
    funding_ask: Option<String>,
    use_of_funds: Option<String>,
    team_size: Option<i32>,
    incorporation_country: Option<String>,
}

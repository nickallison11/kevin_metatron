//! Weekly cross-user learning job for Kevin. Mines existing outcome data
//! (match reasoning vs. request rate, call analysis, recurring chat themes)
//! into `kevin_insights` — the auto-generated counterpart to the
//! admin-authored `kevin_knowledge` table, injected into every
//! conversation's context by `build_context()` in `kevin.rs`.
//!
//! Triggered by a plain KVM2 crontab entry hitting this endpoint directly
//! (`curl -X POST -H "x-cron-secret: ..." http://localhost:4000/cron/kevin-learning`)
//! — unlike `weekly_matches.rs`, this job has no email step, so it doesn't
//! need a Vercel cron + Next.js API route in front of it.

use std::sync::Arc;

use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};

use crate::ai;
use crate::state::AppState;

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/kevin-learning", post(run_kevin_learning))
        .route("/usage-report", get(usage_report))
}

fn verify_cron(state: &AppState, headers: &HeaderMap) -> Result<(), (StatusCode, String)> {
    let expected = match state.cron_secret.as_deref() {
        Some(s) if !s.is_empty() => s,
        _ => {
            return Err((StatusCode::SERVICE_UNAVAILABLE, "CRON_SECRET not configured".into()))
        }
    };
    let got = headers
        .get("x-cron-secret")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    if got != expected {
        return Err((StatusCode::UNAUTHORIZED, "invalid cron secret".into()));
    }
    Ok(())
}

fn internal(e: impl std::fmt::Display) -> (StatusCode, String) {
    tracing::error!("kevin_learning: {e}");
    (StatusCode::INTERNAL_SERVER_ERROR, "internal error".to_string())
}

/// Below this many data points, a section is skipped entirely rather than
/// asking the LLM to generalize from noise. metatron is still invite-only
/// with limited volume, so this matters more than it will later.
const MIN_EVIDENCE: usize = 5;

#[derive(Serialize)]
struct LearningSummary {
    insights_written: usize,
}

async fn run_kevin_learning(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<LearningSummary>, (StatusCode, String)> {
    verify_cron(&state, &headers)?;

    let evidence = gather_evidence(&state).await.map_err(internal)?;

    if evidence.trim().is_empty() {
        tracing::info!("kevin_learning: not enough evidence yet, skipping this run");
        return Ok(Json(LearningSummary { insights_written: 0 }));
    }

    let insights = synthesize_insights(&state, &evidence).await.map_err(internal)?;
    let written = store_insights(&state, insights).await.map_err(internal)?;

    Ok(Json(LearningSummary { insights_written: written }))
}

/// Mines existing tables into a compact, anonymized text summary for the LLM
/// synthesis step. No names/emails — patterns, reasoning text, and counts
/// only. Each section is independently gated on MIN_EVIDENCE.
async fn gather_evidence(state: &AppState) -> Result<String, String> {
    let mut sections = Vec::new();

    // Match reasoning vs. request rate: did the founder/investor act on it?
    // (kevin_matches.intro_requested_at is set when the user clicks Connect
    // on a match card — a direct, unambiguous "this was compelling" signal.)
    let match_rows: Vec<(String, i32, bool)> = sqlx::query_as(
        r#"
        SELECT reasoning, score, (intro_requested_at IS NOT NULL) AS requested
        FROM kevin_matches
        WHERE reasoning IS NOT NULL
        ORDER BY generated_at DESC
        LIMIT 300
        "#,
    )
    .fetch_all(&state.db)
    .await
    .map_err(|e| format!("match evidence: {e}"))?;

    if match_rows.len() >= MIN_EVIDENCE {
        let requested = match_rows.iter().filter(|(_, _, r)| *r).count();
        let sample: Vec<String> = match_rows
            .iter()
            .take(40)
            .map(|(reasoning, score, requested)| {
                format!("score={score} requested={requested}: {reasoning}")
            })
            .collect();
        sections.push(format!(
            "## Match reasoning vs. whether the user requested an intro\n{}/{} sampled matches led to a Connect request.\n\n{}",
            requested,
            match_rows.len(),
            sample.join("\n---\n")
        ));
    }

    // Call analysis: what's actually showing up in real founder/investor
    // calls right now.
    let call_rows: Vec<(Option<String>, Option<String>)> = sqlx::query_as(
        r#"
        SELECT analysis->>'summary', analysis->>'investor_sentiment'
        FROM call_recordings
        WHERE analysis IS NOT NULL
        ORDER BY created_at DESC
        LIMIT 100
        "#,
    )
    .fetch_all(&state.db)
    .await
    .map_err(|e| format!("call evidence: {e}"))?;

    if call_rows.len() >= MIN_EVIDENCE {
        let sample: Vec<String> = call_rows
            .iter()
            .filter_map(|(summary, sentiment)| {
                summary.as_ref().map(|s| {
                    format!("sentiment={}: {s}", sentiment.as_deref().unwrap_or("unknown"))
                })
            })
            .take(40)
            .collect();
        sections.push(format!(
            "## Recent call analysis summaries ({} calls)\n{}",
            call_rows.len(),
            sample.join("\n---\n")
        ));
    }

    // Recurring chat themes per role — what each user type keeps asking Kevin.
    let chat_rows: Vec<(String, String)> = sqlx::query_as(
        r#"
        SELECT u.role::text, kct.content
        FROM kevin_chat_turns kct
        JOIN users u ON u.id = kct.user_id
        WHERE kct.role = 'user'
        ORDER BY kct.created_at DESC
        LIMIT 300
        "#,
    )
    .fetch_all(&state.db)
    .await
    .map_err(|e| format!("chat evidence: {e}"))?;

    if chat_rows.len() >= MIN_EVIDENCE {
        let sample: Vec<String> = chat_rows
            .iter()
            .take(60)
            .map(|(role, content)| format!("[{role}] {content}"))
            .collect();
        sections.push(format!(
            "## Recent questions asked to Kevin, by role ({} messages)\n{}",
            chat_rows.len(),
            sample.join("\n")
        ));
    }

    Ok(sections.join("\n\n"))
}

#[derive(Deserialize)]
struct SynthesizedInsight {
    title: String,
    body: String,
    role_target: String,
    evidence_count: i32,
}

#[derive(Deserialize)]
struct SynthesisResponse {
    insights: Vec<SynthesizedInsight>,
}

async fn synthesize_insights(
    state: &AppState,
    evidence: &str,
) -> Result<Vec<SynthesizedInsight>, String> {
    let Some(ref key) = state.ai_api_key else {
        return Ok(Vec::new());
    };

    let system = "You are Kevin's learning engine for metatron, a platform connecting founders, \
investors, and connectors. You'll be given anonymized evidence mined from real platform activity: \
match reasoning vs. whether users acted on it, call analysis summaries, and recurring chat questions. \
Find genuinely generalizable patterns — not restatements of individual data points. Each insight must \
be backed by multiple consistent examples in the evidence, not a single anecdote. Return JSON: \
{\"insights\": [{\"title\": string, \"body\": string (2-3 sentences, actionable), \
\"role_target\": \"all\" | \"STARTUP\" | \"INVESTOR\" | \"INTERMEDIARY\", \
\"evidence_count\": number of examples in the evidence that support this}]}. \
Return at most 5 insights. If the evidence doesn't support any confident generalization, return an \
empty insights array — do not force weak patterns.";

    let prompt = format!("Evidence:\n\n{evidence}");

    let value = ai::complete_json_object(
        &state.http_client,
        "gemini",
        key,
        &state.gemini_model,
        system,
        &prompt,
    )
    .await?;

    let parsed: SynthesisResponse =
        serde_json::from_value(value).map_err(|e| format!("synthesis parse: {e}"))?;

    Ok(parsed.insights)
}

/// Replaces (doesn't accumulate) kevin_insights on each run — truncate then
/// reinsert, same idea as kevin_text_memories' prune step — so stale
/// patterns don't linger once the underlying data no longer supports them.
async fn store_insights(state: &AppState, insights: Vec<SynthesizedInsight>) -> Result<usize, String> {
    let insights: Vec<SynthesizedInsight> = insights
        .into_iter()
        .filter(|i| i.evidence_count as usize >= MIN_EVIDENCE)
        .collect();

    let mut tx = state.db.begin().await.map_err(|e| e.to_string())?;

    sqlx::query("DELETE FROM kevin_insights")
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

    for insight in &insights {
        sqlx::query(
            r#"
            INSERT INTO kevin_insights (title, body, role_target, evidence_count)
            VALUES ($1, $2, $3, $4)
            "#,
        )
        .bind(&insight.title)
        .bind(&insight.body)
        .bind(&insight.role_target)
        .bind(insight.evidence_count)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    }

    tx.commit().await.map_err(|e| e.to_string())?;

    Ok(insights.len())
}

/// How far back model_usage counts look — matches the weekly cadence
/// everything else in this file runs on.
const USAGE_WINDOW_DAYS: i32 = 7;

#[derive(Serialize)]
struct TierCount {
    role: String,
    tier: String,
    count: i64,
}

#[derive(Serialize)]
struct ModelUsageCount {
    tier: String,
    provider: String,
    model: String,
    count: i64,
}

#[derive(Serialize)]
struct UsageReport {
    subscriber_counts: Vec<TierCount>,
    /// Model usage over the last USAGE_WINDOW_DAYS days.
    model_usage: Vec<ModelUsageCount>,
}

/// Read-only reporting endpoint for the e2e monitor: subscriber counts per
/// role+tier, and which models actually served Kevin chat replies per tier
/// over the last week (see kevin_model_usage, written from
/// run_kevin_with_tools in kevin.rs).
async fn usage_report(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<UsageReport>, (StatusCode, String)> {
    verify_cron(&state, &headers)?;

    let subscriber_counts: Vec<TierCount> = sqlx::query_as::<_, (String, String, i64)>(
        r#"
        SELECT role::text,
               CASE WHEN is_pro THEN 'pro' WHEN is_basic THEN 'basic' ELSE 'free' END AS tier,
               COUNT(*)
        FROM users
        GROUP BY role, tier
        ORDER BY role, tier
        "#,
    )
    .fetch_all(&state.db)
    .await
    .map_err(internal)?
    .into_iter()
    .map(|(role, tier, count)| TierCount { role, tier, count })
    .collect();

    let model_usage: Vec<ModelUsageCount> = sqlx::query_as::<_, (String, String, String, i64)>(
        r#"
        SELECT subscription_tier, provider, model, COUNT(*)
        FROM kevin_model_usage
        WHERE created_at > now() - make_interval(days => $1)
        GROUP BY subscription_tier, provider, model
        ORDER BY subscription_tier, COUNT(*) DESC
        "#,
    )
    .bind(USAGE_WINDOW_DAYS)
    .fetch_all(&state.db)
    .await
    .map_err(internal)?
    .into_iter()
    .map(|(tier, provider, model, count)| ModelUsageCount { tier, provider, model, count })
    .collect();

    Ok(Json(UsageReport { subscriber_counts, model_usage }))
}

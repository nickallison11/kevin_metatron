use std::sync::Arc;

use chrono::Datelike;

use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use uuid::Uuid;

use crate::ai;
use crate::state::AppState;

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route(
            "/eligible-for-weekly-matches",
            get(eligible_for_weekly_matches),
        )
        .route("/:user_id/weekly-matches", get(weekly_matches_for_user))
        .route("/email-log", post(insert_email_log))
        .route("/webhook-event", post(handle_webhook_event))
}

fn verify_cron(state: &AppState, headers: &HeaderMap) -> Result<(), (StatusCode, String)> {
    let expected = match state.cron_secret.as_deref() {
        Some(s) if !s.is_empty() => s,
        _ => {
            return Err((
                StatusCode::SERVICE_UNAVAILABLE,
                "CRON_SECRET not configured".into(),
            ))
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

#[derive(Serialize)]
struct EligibleFounder {
    user_id: Uuid,
    email: String,
    timezone: Option<String>,
    is_basic: bool,
}

async fn eligible_for_weekly_matches(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<Vec<EligibleFounder>>, (StatusCode, String)> {
    verify_cron(&state, &headers)?;

    let rows = sqlx::query_as::<_, (Uuid, String, Option<String>, bool)>(
        r#"
        SELECT u.id, u.email, p.timezone, u.is_basic
        FROM users u
        JOIN email_preferences ep ON ep.user_id = u.id
        LEFT JOIN profiles p ON p.user_id = u.id
        WHERE u.role = 'STARTUP'
          AND ep.weekly_matches = TRUE
          AND ep.unsubscribed_all = FALSE
          AND EXISTS (
              SELECT 1 FROM pitches pt WHERE pt.user_id = u.id
          )
          AND NOT EXISTS (
              SELECT 1 FROM email_send_log esl
              WHERE esl.user_id = u.id
                AND esl.email_type = 'weekly_matches_founder'
                AND esl.sent_at > NOW() - INTERVAL '5 days'
          )
        "#,
    )
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("eligible query: {e}");
        (StatusCode::INTERNAL_SERVER_ERROR, "db error".into())
    })?;

    let founders: Vec<EligibleFounder> = rows
        .into_iter()
        .map(|(user_id, email, timezone, is_basic)| EligibleFounder {
            user_id,
            email,
            timezone,
            is_basic,
        })
        .collect();

    Ok(Json(founders))
}

#[derive(Serialize)]
struct WeeklyMatchItem {
    id: Uuid,
    firm_name: Option<String>,
    angel_score: Option<i32>,
    sector_overlap: bool,
    stage_overlap: bool,
    why_blurb: Option<String>,
    deep_link: String,
}

#[derive(Serialize)]
struct WeeklyMatchesResponse {
    tier: String,
    eligible: bool,
    matches: Vec<WeeklyMatchItem>,
    snapshot_id: Option<Uuid>,
}

async fn weekly_matches_for_user(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(user_id): Path<Uuid>,
) -> Result<Json<WeeklyMatchesResponse>, (StatusCode, String)> {
    verify_cron(&state, &headers)?;

    let user_row = sqlx::query_as::<_, (bool,)>(
        "SELECT is_basic FROM users WHERE id = $1 AND role = 'STARTUP'",
    )
    .bind(user_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("weekly_matches user lookup: {e}");
        (StatusCode::INTERNAL_SERVER_ERROR, "db error".into())
    })?;

    let is_basic = match user_row {
        Some((b,)) => b,
        None => {
            return Err((StatusCode::NOT_FOUND, "user not found or not a founder".into()));
        }
    };

    let tier = if is_basic { "basic" } else { "free" };
    let limit: i64 = if is_basic { 5 } else { 1 };

    let candidates = sqlx::query_as::<_, (Uuid, Option<String>, Option<i32>, Option<String>, Option<String>, Option<String>, Option<String>, Option<String>)>(
        r#"
        SELECT km.id, COALESCE(km.display_name, ip.firm_name) AS firm_name,
               ip.angel_score,
               ip.sector AS investor_sector,
               ip.stage_preference AS investor_stage,
               p.sector AS founder_sector,
               p.stage AS founder_stage,
               km.why_blurb
        FROM kevin_matches km
        LEFT JOIN investor_profiles ip ON ip.user_id = km.matched_user_id
        LEFT JOIN profiles p ON p.user_id = km.for_user_id
        WHERE km.for_user_id = $1
          AND km.match_type = 'investor'
          AND km.intro_requested_at IS NULL
        ORDER BY COALESCE(ip.angel_score, 0) DESC, km.score DESC
        LIMIT 20
        "#,
    )
    .bind(user_id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("weekly_matches candidates: {e}");
        (StatusCode::INTERNAL_SERVER_ERROR, "db error".into())
    })?;

    if candidates.len() < 3 {
        return Ok(Json(WeeklyMatchesResponse {
            tier: tier.into(),
            eligible: false,
            matches: vec![],
            snapshot_id: None,
        }));
    }

    let mut items = Vec::new();
    for (km_id, firm_name, angel_score, inv_sector, inv_stage, f_sector, f_stage, existing_blurb) in
        candidates.iter().take(limit as usize)
    {
        let sector_overlap = match (inv_sector.as_deref(), f_sector.as_deref()) {
            (Some(a), Some(b)) if !a.is_empty() && !b.is_empty() => {
                a.to_lowercase().contains(&b.to_lowercase())
                    || b.to_lowercase().contains(&a.to_lowercase())
            }
            _ => false,
        };
        let stage_overlap = match (inv_stage.as_deref(), f_stage.as_deref()) {
            (Some(a), Some(b)) if !a.is_empty() && !b.is_empty() => {
                a.to_lowercase().contains(&b.to_lowercase())
                    || b.to_lowercase().contains(&a.to_lowercase())
            }
            _ => false,
        };

        let blurb = if let Some(ref b) = existing_blurb {
            if !b.trim().is_empty() {
                Some(b.clone())
            } else {
                generate_why_blurb(&state, *km_id, firm_name.as_deref(), f_sector.as_deref())
                    .await
            }
        } else {
            generate_why_blurb(&state, *km_id, firm_name.as_deref(), f_sector.as_deref()).await
        };

        items.push(WeeklyMatchItem {
            id: *km_id,
            firm_name: firm_name.clone(),
            angel_score: *angel_score,
            sector_overlap,
            stage_overlap,
            why_blurb: blurb,
            deep_link: format!("/startup/matches?focus={}", km_id),
        });
    }

    let week_of = {
        let now = chrono::Utc::now().date_naive();
        let weekday = now.weekday().num_days_from_monday();
        now - chrono::Duration::days(weekday as i64)
    };

    let matches_json = serde_json::to_value(&items).unwrap_or(json!([]));

    let snapshot_id = sqlx::query_scalar::<_, Uuid>(
        r#"
        INSERT INTO weekly_match_snapshots (user_id, week_of, matches)
        VALUES ($1, $2, $3)
        ON CONFLICT (user_id, week_of) DO UPDATE SET matches = $3, created_at = NOW()
        RETURNING id
        "#,
    )
    .bind(user_id)
    .bind(week_of)
    .bind(&matches_json)
    .fetch_one(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("weekly_match_snapshots upsert: {e}");
        (StatusCode::INTERNAL_SERVER_ERROR, "db error".into())
    })?;

    Ok(Json(WeeklyMatchesResponse {
        tier: tier.into(),
        eligible: true,
        matches: items,
        snapshot_id: Some(snapshot_id),
    }))
}

async fn generate_why_blurb(
    state: &AppState,
    km_id: Uuid,
    firm_name: Option<&str>,
    founder_sector: Option<&str>,
) -> Option<String> {
    let api_key = state.ai_api_key.as_deref()?;

    let prompt = format!(
        "In 1-2 short sentences, explain why {} would be a good investor match for a {} startup. Be specific but concise. No bullet points.",
        firm_name.unwrap_or("this investor"),
        founder_sector.unwrap_or("technology"),
    );

    let result = ai::complete_chat(
        &state.http_client,
        "gemini",
        api_key,
        &state.gemini_model,
        "You are a concise startup-investor matchmaker. Respond with only the blurb text.",
        vec![("user".into(), prompt)],
    )
    .await;

    match result {
        Ok(text) => {
            let trimmed = text.trim().to_string();
            let _ = sqlx::query("UPDATE kevin_matches SET why_blurb = $1 WHERE id = $2")
                .bind(&trimmed)
                .bind(km_id)
                .execute(&state.db)
                .await;
            Some(trimmed)
        }
        Err(e) => {
            tracing::warn!("why_blurb generation failed for {km_id}: {e}");
            None
        }
    }
}

#[derive(Deserialize)]
struct EmailLogBody {
    user_id: Uuid,
    email_type: String,
    resend_message_id: Option<String>,
    match_snapshot_id: Option<Uuid>,
}

async fn insert_email_log(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<EmailLogBody>,
) -> Result<StatusCode, (StatusCode, String)> {
    verify_cron(&state, &headers)?;

    sqlx::query(
        r#"
        INSERT INTO email_send_log (user_id, email_type, resend_message_id, match_snapshot_id)
        VALUES ($1, $2, $3, $4)
        "#,
    )
    .bind(body.user_id)
    .bind(&body.email_type)
    .bind(body.resend_message_id.as_deref())
    .bind(body.match_snapshot_id)
    .execute(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("email_send_log insert: {e}");
        (StatusCode::INTERNAL_SERVER_ERROR, "db error".into())
    })?;

    Ok(StatusCode::CREATED)
}

#[derive(Deserialize)]
struct WebhookEventBody {
    resend_message_id: String,
    column: String,
}

async fn handle_webhook_event(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<WebhookEventBody>,
) -> Result<StatusCode, (StatusCode, String)> {
    verify_cron(&state, &headers)?;

    let allowed = ["opened_at", "clicked_at", "bounced_at", "unsubscribed_at"];
    if !allowed.contains(&body.column.as_str()) {
        return Err((StatusCode::BAD_REQUEST, "invalid column".into()));
    }

    let sql = format!(
        "UPDATE email_send_log SET {} = NOW() WHERE resend_message_id = $1 AND {} IS NULL",
        body.column, body.column
    );
    sqlx::query(&sql)
        .bind(&body.resend_message_id)
        .execute(&state.db)
        .await
        .map_err(|e| {
            tracing::error!("webhook_event update: {e}");
            (StatusCode::INTERNAL_SERVER_ERROR, "db error".into())
        })?;

    Ok(StatusCode::OK)
}

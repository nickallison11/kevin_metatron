use std::sync::Arc;

use chrono::Datelike;

use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    routing::{get, post},
    Json, Router,
};
use jsonwebtoken::{encode, Header as JwtHeader};
use serde::{Deserialize, Serialize};
use serde_json::json;
use uuid::Uuid;

use crate::ai;
use crate::auth::Claims;
use crate::routes::unsubscribe::generate_token;
use crate::state::AppState;

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/eligible-for-weekly-matches", get(eligible_for_weekly_matches))
        .route("/eligible-for-weekly-matches-investors", get(eligible_for_weekly_matches_investors))
        .route("/eligible-for-monthly-summary", get(eligible_for_monthly_summary))
        .route("/eligible-for-monthly-summary-investors", get(eligible_for_monthly_summary_investors))
        .route("/:user_id/weekly-matches", get(weekly_matches_for_user))
        .route("/:user_id/weekly-matches-investor", get(weekly_matches_for_investor))
        .route("/:user_id/refresh-matches", post(refresh_matches))
        .route("/:user_id/monthly-summary", get(monthly_summary_for_user))
        .route("/:user_id/monthly-summary-investor", get(monthly_summary_for_investor))
        .route("/email-log", post(insert_email_log))
        .route("/webhook-event", post(handle_webhook_event))
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

// ── Eligible lists ──────────────────────────────────────────────────────────

#[derive(Serialize)]
struct EligibleFounder {
    user_id: Uuid,
    email: String,
    timezone: Option<String>,
    is_basic: bool,
    unsubscribe_token: String,
}

async fn eligible_for_weekly_matches(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<Vec<EligibleFounder>>, (StatusCode, String)> {
    verify_cron(&state, &headers)?;

    let rows = sqlx::query_as::<_, (Uuid, String, bool)>(
        r#"
        SELECT u.id, u.email, u.is_basic
        FROM users u
        JOIN email_preferences ep ON ep.user_id = u.id
        WHERE u.role = 'STARTUP'
          AND ep.weekly_matches = TRUE
          AND ep.unsubscribed_all = FALSE
          AND EXISTS (SELECT 1 FROM pitches pt WHERE pt.created_by = u.id)
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

    let founders = rows
        .into_iter()
        .map(|(user_id, email, is_basic)| {
            let unsubscribe_token =
                generate_token(&state.unsubscribe_secret, user_id, "weekly_matches_founder");
            EligibleFounder { user_id, email, timezone: None, is_basic, unsubscribe_token }
        })
        .collect();

    Ok(Json(founders))
}

#[derive(Serialize)]
struct EligibleInvestor {
    user_id: Uuid,
    email: String,
    is_basic: bool,
    unsubscribe_token: String,
}

async fn eligible_for_weekly_matches_investors(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<Vec<EligibleInvestor>>, (StatusCode, String)> {
    verify_cron(&state, &headers)?;

    let rows = sqlx::query_as::<_, (Uuid, String, bool)>(
        r#"
        SELECT u.id, u.email, u.is_basic
        FROM users u
        JOIN email_preferences ep ON ep.user_id = u.id
        WHERE u.role = 'INVESTOR'
          AND ep.weekly_matches = TRUE
          AND ep.unsubscribed_all = FALSE
          AND EXISTS (SELECT 1 FROM investor_profiles ip WHERE ip.user_id = u.id)
          AND NOT EXISTS (
              SELECT 1 FROM email_send_log esl
              WHERE esl.user_id = u.id
                AND esl.email_type = 'weekly_matches_investor'
                AND esl.sent_at > NOW() - INTERVAL '5 days'
          )
        "#,
    )
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("eligible investors query: {e}");
        (StatusCode::INTERNAL_SERVER_ERROR, "db error".into())
    })?;

    let investors = rows
        .into_iter()
        .map(|(user_id, email, is_basic)| {
            let unsubscribe_token =
                generate_token(&state.unsubscribe_secret, user_id, "weekly_matches_investor");
            EligibleInvestor { user_id, email, is_basic, unsubscribe_token }
        })
        .collect();

    Ok(Json(investors))
}

async fn eligible_for_monthly_summary(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<Vec<EligibleFounder>>, (StatusCode, String)> {
    verify_cron(&state, &headers)?;

    let rows = sqlx::query_as::<_, (Uuid, String, bool)>(
        r#"
        SELECT u.id, u.email, u.is_basic
        FROM users u
        JOIN email_preferences ep ON ep.user_id = u.id
        WHERE u.role = 'STARTUP'
          AND ep.weekly_matches = TRUE
          AND ep.unsubscribed_all = FALSE
          AND NOT EXISTS (
              SELECT 1 FROM email_send_log esl
              WHERE esl.user_id = u.id
                AND esl.email_type = 'monthly_summary_founder'
                AND esl.sent_at > NOW() - INTERVAL '20 days'
          )
          AND EXISTS (
              SELECT 1 FROM kevin_matches km
              WHERE km.for_user_id = u.id
                AND km.weekly_email_sent_at >= date_trunc('month', NOW() - INTERVAL '1 month')
                AND km.weekly_email_sent_at <  date_trunc('month', NOW())
          )
        "#,
    )
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("eligible monthly query: {e}");
        (StatusCode::INTERNAL_SERVER_ERROR, "db error".into())
    })?;

    let founders = rows
        .into_iter()
        .map(|(user_id, email, is_basic)| {
            let unsubscribe_token =
                generate_token(&state.unsubscribe_secret, user_id, "monthly_summary_founder");
            EligibleFounder { user_id, email, timezone: None, is_basic, unsubscribe_token }
        })
        .collect();

    Ok(Json(founders))
}

async fn eligible_for_monthly_summary_investors(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<Vec<EligibleInvestor>>, (StatusCode, String)> {
    verify_cron(&state, &headers)?;

    let rows = sqlx::query_as::<_, (Uuid, String, bool)>(
        r#"
        SELECT u.id, u.email, u.is_basic
        FROM users u
        JOIN email_preferences ep ON ep.user_id = u.id
        WHERE u.role = 'INVESTOR'
          AND ep.weekly_matches = TRUE
          AND ep.unsubscribed_all = FALSE
          AND NOT EXISTS (
              SELECT 1 FROM email_send_log esl
              WHERE esl.user_id = u.id
                AND esl.email_type = 'monthly_summary_investor'
                AND esl.sent_at > NOW() - INTERVAL '20 days'
          )
          AND EXISTS (
              SELECT 1 FROM kevin_matches km
              WHERE km.for_user_id = u.id
                AND km.weekly_email_sent_at >= date_trunc('month', NOW() - INTERVAL '1 month')
                AND km.weekly_email_sent_at <  date_trunc('month', NOW())
          )
        "#,
    )
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("eligible monthly investors query: {e}");
        (StatusCode::INTERNAL_SERVER_ERROR, "db error".into())
    })?;

    let investors = rows
        .into_iter()
        .map(|(user_id, email, is_basic)| {
            let unsubscribe_token =
                generate_token(&state.unsubscribe_secret, user_id, "monthly_summary_investor");
            EligibleInvestor { user_id, email, is_basic, unsubscribe_token }
        })
        .collect();

    Ok(Json(investors))
}

// ── Refresh match pool ──────────────────────────────────────────────────────

#[derive(Serialize)]
struct RefreshResult {
    recycled: i64,
    generate_triggered: bool,
}

async fn refresh_matches(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(user_id): Path<Uuid>,
) -> Result<Json<RefreshResult>, (StatusCode, String)> {
    verify_cron(&state, &headers)?;

    let (role, is_basic, is_pro): (String, bool, bool) = sqlx::query_as(
        "SELECT role::text, COALESCE(is_basic, false), COALESCE(is_pro, false) FROM users WHERE id = $1",
    )
    .bind(user_id)
    .fetch_one(&state.db)
    .await
    .map_err(|_| (StatusCode::NOT_FOUND, "user not found".into()))?;

    let match_type = if role == "INVESTOR" { "investor_founder" } else { "founder_investor" };
    let limit = if role == "INVESTOR" {
        if is_basic || is_pro { state.investor_match_limit_basic } else { state.investor_match_limit_free }
    } else {
        if is_basic || is_pro { state.match_limit_basic } else { state.match_limit_free }
    };

    // Count currently unsent matches
    let unsent: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM kevin_matches WHERE for_user_id = $1 AND match_type = $2 AND weekly_email_sent_at IS NULL AND intro_requested_at IS NULL",
    )
    .bind(user_id)
    .bind(match_type)
    .fetch_one(&state.db)
    .await
    .unwrap_or(0);

    // Recycle matches sent more than 28 days ago so they can resurface
    let recycled: i64 = if unsent < limit {
        sqlx::query(
            "UPDATE kevin_matches SET weekly_email_sent_at = NULL WHERE for_user_id = $1 AND match_type = $2 AND weekly_email_sent_at < NOW() - INTERVAL '28 days' AND intro_requested_at IS NULL",
        )
        .bind(user_id)
        .bind(match_type)
        .execute(&state.db)
        .await
        .map(|r| r.rows_affected() as i64)
        .unwrap_or(0)
    } else {
        0
    };

    let unsent_after_recycle = unsent + recycled;

    // If still low, trigger the AI generation endpoint with a short-lived internal JWT
    let generate_triggered = if unsent_after_recycle < limit {
        let exp = (chrono::Utc::now() + chrono::Duration::seconds(120)).timestamp() as usize;
        let claims = Claims { sub: user_id.to_string(), role: role.clone(), exp };
        let token = encode(&JwtHeader::default(), &claims, &state.jwt_encoding)
            .unwrap_or_default();

        if !token.is_empty() {
            let _ = state
                .http_client
                .post("http://127.0.0.1:4000/kevin-matches")
                .header("Authorization", format!("Bearer {}", token))
                .send()
                .await;
            true
        } else {
            false
        }
    } else {
        false
    };

    Ok(Json(RefreshResult { recycled, generate_triggered }))
}

// ── Weekly matches ──────────────────────────────────────────────────────────

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
        None => return Err((StatusCode::NOT_FOUND, "user not found or not a founder".into())),
    };

    let tier = if is_basic { "basic" } else { "free" };
    let limit: i64 = if is_basic { state.match_limit_basic } else { state.match_limit_free };

    let candidates = sqlx::query_as::<_, (Uuid, Option<String>, i32, Option<String>, Option<String>, Option<String>, Option<String>, Option<String>)>(
        r#"
        SELECT km.id, COALESCE(km.display_name, ip.firm_name) AS firm_name,
               km.score AS angel_score,
               array_to_string(ip.sectors, ',') AS investor_sector,
               array_to_string(ip.stages, ',') AS investor_stage,
               p.sector AS founder_sector,
               p.stage AS founder_stage,
               km.why_blurb
        FROM kevin_matches km
        LEFT JOIN investor_profiles ip ON ip.user_id = km.matched_user_id
        LEFT JOIN profiles p ON p.user_id = km.for_user_id
        WHERE km.for_user_id = $1
          AND km.match_type = 'founder_investor'
          AND km.intro_requested_at IS NULL
          AND km.weekly_email_sent_at IS NULL
        ORDER BY km.score DESC
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

    if candidates.is_empty() {
        return Ok(Json(WeeklyMatchesResponse {
            tier: tier.into(),
            eligible: false,
            matches: vec![],
            snapshot_id: None,
        }));
    }

    let mut items = Vec::new();
    let mut sent_ids: Vec<Uuid> = Vec::new();

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
                generate_why_blurb(&state, *km_id, firm_name.as_deref(), f_sector.as_deref()).await
            }
        } else {
            generate_why_blurb(&state, *km_id, firm_name.as_deref(), f_sector.as_deref()).await
        };

        sent_ids.push(*km_id);
        items.push(WeeklyMatchItem {
            id: *km_id,
            firm_name: firm_name.clone(),
            angel_score: Some(*angel_score),
            sector_overlap,
            stage_overlap,
            why_blurb: blurb,
            deep_link: format!("/startup/matches?focus={}", km_id),
        });
    }

    // Mark these matches as sent so they won't repeat next week
    let _ = sqlx::query(
        "UPDATE kevin_matches SET weekly_email_sent_at = NOW() WHERE id = ANY($1)",
    )
    .bind(&sent_ids)
    .execute(&state.db)
    .await;

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

#[derive(Serialize)]
struct InvestorWeeklyMatchItem {
    id: Uuid,
    company_name: Option<String>,
    sector: Option<String>,
    stage: Option<String>,
    angel_score: Option<i32>,
    sector_overlap: bool,
    stage_overlap: bool,
    why_blurb: Option<String>,
    deep_link: String,
}

#[derive(Serialize)]
struct InvestorWeeklyMatchesResponse {
    tier: String,
    eligible: bool,
    matches: Vec<InvestorWeeklyMatchItem>,
    snapshot_id: Option<Uuid>,
}

async fn weekly_matches_for_investor(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(user_id): Path<Uuid>,
) -> Result<Json<InvestorWeeklyMatchesResponse>, (StatusCode, String)> {
    verify_cron(&state, &headers)?;

    let user_row = sqlx::query_as::<_, (bool, Option<Vec<String>>, Option<Vec<String>>)>(
        r#"SELECT u.is_basic, ip.sectors, ip.stages
           FROM users u
           LEFT JOIN investor_profiles ip ON ip.user_id = u.id
           WHERE u.id = $1 AND u.role = 'INVESTOR'"#,
    )
    .bind(user_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("weekly_matches_investor user lookup: {e}");
        (StatusCode::INTERNAL_SERVER_ERROR, "db error".into())
    })?;

    let (is_basic, inv_sectors, inv_stages) = match user_row {
        Some(r) => r,
        None => return Err((StatusCode::NOT_FOUND, "user not found or not an investor".into())),
    };

    let tier = if is_basic { "basic" } else { "free" };
    let limit: i64 =
        if is_basic { state.investor_match_limit_basic } else { state.investor_match_limit_free };

    let candidates = sqlx::query_as::<_, (Uuid, Option<String>, Option<String>, Option<String>, Option<String>, Option<i32>)>(
        r#"
        SELECT km.id,
               COALESCE(km.display_name, p.company_name) AS company_name,
               p.sector AS founder_sector,
               p.stage AS founder_stage,
               km.why_blurb,
               a.score AS angel_score
        FROM kevin_matches km
        LEFT JOIN profiles p ON p.user_id = km.matched_user_id
        LEFT JOIN angel_scores a ON a.founder_user_id = km.matched_user_id
        WHERE km.for_user_id = $1
          AND km.match_type = 'investor_founder'
          AND km.intro_requested_at IS NULL
          AND km.weekly_email_sent_at IS NULL
        ORDER BY a.score DESC NULLS LAST
        LIMIT 20
        "#,
    )
    .bind(user_id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("weekly_matches_investor candidates: {e}");
        (StatusCode::INTERNAL_SERVER_ERROR, "db error".into())
    })?;

    if candidates.is_empty() {
        return Ok(Json(InvestorWeeklyMatchesResponse {
            tier: tier.into(),
            eligible: false,
            matches: vec![],
            snapshot_id: None,
        }));
    }

    let inv_sectors_str = inv_sectors.as_ref().map(|s| s.join(",")).unwrap_or_default();
    let inv_stages_str = inv_stages.as_ref().map(|s| s.join(",")).unwrap_or_default();

    let mut items = Vec::new();
    let mut sent_ids: Vec<Uuid> = Vec::new();

    for (km_id, company_name, f_sector, f_stage, why_blurb, angel_score) in
        candidates.iter().take(limit as usize)
    {
        let sector_overlap = match (f_sector.as_deref(), inv_sectors_str.as_str()) {
            (Some(a), b) if !a.is_empty() && !b.is_empty() => {
                b.to_lowercase().contains(&a.to_lowercase())
                    || a.to_lowercase().contains(&b.to_lowercase())
            }
            _ => false,
        };
        let stage_overlap = match (f_stage.as_deref(), inv_stages_str.as_str()) {
            (Some(a), b) if !a.is_empty() && !b.is_empty() => {
                b.to_lowercase().contains(&a.to_lowercase())
                    || a.to_lowercase().contains(&b.to_lowercase())
            }
            _ => false,
        };

        sent_ids.push(*km_id);
        items.push(InvestorWeeklyMatchItem {
            id: *km_id,
            company_name: company_name.clone(),
            sector: f_sector.clone(),
            stage: f_stage.clone(),
            angel_score: *angel_score,
            sector_overlap,
            stage_overlap,
            why_blurb: why_blurb.clone(),
            deep_link: format!("/investor/deal-flow?focus={}", km_id),
        });
    }

    // Mark these matches as sent
    let _ = sqlx::query(
        "UPDATE kevin_matches SET weekly_email_sent_at = NOW() WHERE id = ANY($1)",
    )
    .bind(&sent_ids)
    .execute(&state.db)
    .await;

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
        tracing::error!("weekly_match_snapshots investor upsert: {e}");
        (StatusCode::INTERNAL_SERVER_ERROR, "db error".into())
    })?;

    Ok(Json(InvestorWeeklyMatchesResponse {
        tier: tier.into(),
        eligible: true,
        matches: items,
        snapshot_id: Some(snapshot_id),
    }))
}

// ── Monthly summary ─────────────────────────────────────────────────────────

#[derive(Serialize)]
struct MonthlySummaryItem {
    id: Uuid,
    firm_name: Option<String>,
    angel_score: Option<i32>,
    sector_overlap: bool,
    stage_overlap: bool,
    why_blurb: Option<String>,
    deep_link: String,
}

#[derive(Serialize)]
struct MonthlySummaryResponse {
    tier: String,
    eligible: bool,
    month_name: String,
    total_this_month: i64,
    matches: Vec<MonthlySummaryItem>,
    snapshot_id: Option<Uuid>,
}

async fn monthly_summary_for_user(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(user_id): Path<Uuid>,
) -> Result<Json<MonthlySummaryResponse>, (StatusCode, String)> {
    verify_cron(&state, &headers)?;

    let user_row = sqlx::query_as::<_, (bool,)>(
        "SELECT is_basic FROM users WHERE id = $1 AND role = 'STARTUP'",
    )
    .bind(user_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("monthly_summary user lookup: {e}");
        (StatusCode::INTERNAL_SERVER_ERROR, "db error".into())
    })?;

    let is_basic = match user_row {
        Some((b,)) => b,
        None => return Err((StatusCode::NOT_FOUND, "user not found or not a founder".into())),
    };

    let tier = if is_basic { "basic" } else { "free" };
    let limit: i64 = if is_basic { state.match_limit_basic } else { state.match_limit_free };

    let now = chrono::Utc::now();
    let first_of_last_month = chrono::NaiveDate::from_ymd_opt(
        if now.month() == 1 { now.year() - 1 } else { now.year() },
        if now.month() == 1 { 12 } else { now.month() - 1 },
        1,
    )
    .unwrap_or_default();
    let first_of_this_month =
        chrono::NaiveDate::from_ymd_opt(now.year(), now.month(), 1).unwrap_or_default();

    let month_name = first_of_last_month.format("%B %Y").to_string();

    let total_this_month: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM kevin_matches WHERE for_user_id = $1 AND match_type = 'founder_investor' AND weekly_email_sent_at >= $2 AND weekly_email_sent_at < $3",
    )
    .bind(user_id)
    .bind(first_of_last_month)
    .bind(first_of_this_month)
    .fetch_one(&state.db)
    .await
    .unwrap_or(0);

    if total_this_month == 0 {
        return Ok(Json(MonthlySummaryResponse {
            tier: tier.into(),
            eligible: false,
            month_name,
            total_this_month: 0,
            matches: vec![],
            snapshot_id: None,
        }));
    }

    let candidates = sqlx::query_as::<_, (Uuid, Option<String>, i32, Option<String>, Option<String>, Option<String>, Option<String>, Option<String>)>(
        r#"
        SELECT km.id, COALESCE(km.display_name, ip.firm_name) AS firm_name,
               km.score AS angel_score,
               array_to_string(ip.sectors, ',') AS investor_sector,
               array_to_string(ip.stages, ',') AS investor_stage,
               p.sector AS founder_sector,
               p.stage AS founder_stage,
               km.why_blurb
        FROM kevin_matches km
        LEFT JOIN investor_profiles ip ON ip.user_id = km.matched_user_id
        LEFT JOIN profiles p ON p.user_id = km.for_user_id
        WHERE km.for_user_id = $1
          AND km.match_type = 'founder_investor'
          AND km.weekly_email_sent_at >= $2
          AND km.weekly_email_sent_at < $3
        ORDER BY km.score DESC
        LIMIT $4
        "#,
    )
    .bind(user_id)
    .bind(first_of_last_month)
    .bind(first_of_this_month)
    .bind(limit)
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("monthly_summary candidates: {e}");
        (StatusCode::INTERNAL_SERVER_ERROR, "db error".into())
    })?;

    let mut items = Vec::new();
    for (km_id, firm_name, angel_score, inv_sector, inv_stage, f_sector, f_stage, existing_blurb) in &candidates {
        let sector_overlap = match (inv_sector.as_deref(), f_sector.as_deref()) {
            (Some(a), Some(b)) if !a.is_empty() && !b.is_empty() => {
                a.to_lowercase().contains(&b.to_lowercase()) || b.to_lowercase().contains(&a.to_lowercase())
            }
            _ => false,
        };
        let stage_overlap = match (inv_stage.as_deref(), f_stage.as_deref()) {
            (Some(a), Some(b)) if !a.is_empty() && !b.is_empty() => {
                a.to_lowercase().contains(&b.to_lowercase()) || b.to_lowercase().contains(&a.to_lowercase())
            }
            _ => false,
        };
        let blurb = if let Some(ref b) = existing_blurb {
            if !b.trim().is_empty() { Some(b.clone()) } else { None }
        } else {
            None
        };
        items.push(MonthlySummaryItem {
            id: *km_id,
            firm_name: firm_name.clone(),
            angel_score: Some(*angel_score),
            sector_overlap,
            stage_overlap,
            why_blurb: blurb,
            deep_link: format!("/startup/matches?focus={}", km_id),
        });
    }

    let snapshot_id = sqlx::query_scalar::<_, Uuid>(
        r#"
        INSERT INTO weekly_match_snapshots (user_id, week_of, matches)
        VALUES ($1, $2, $3)
        ON CONFLICT (user_id, week_of) DO UPDATE SET matches = $3, created_at = NOW()
        RETURNING id
        "#,
    )
    .bind(user_id)
    .bind(first_of_last_month)
    .bind(serde_json::to_value(&items).unwrap_or(json!([])))
    .fetch_one(&state.db)
    .await
    .ok();

    Ok(Json(MonthlySummaryResponse {
        tier: tier.into(),
        eligible: true,
        month_name,
        total_this_month,
        matches: items,
        snapshot_id,
    }))
}

#[derive(Serialize)]
struct InvestorMonthlySummaryItem {
    id: Uuid,
    company_name: Option<String>,
    sector: Option<String>,
    stage: Option<String>,
    angel_score: Option<i32>,
    sector_overlap: bool,
    stage_overlap: bool,
    why_blurb: Option<String>,
    deep_link: String,
}

#[derive(Serialize)]
struct InvestorMonthlySummaryResponse {
    tier: String,
    eligible: bool,
    month_name: String,
    total_this_month: i64,
    matches: Vec<InvestorMonthlySummaryItem>,
    snapshot_id: Option<Uuid>,
}

async fn monthly_summary_for_investor(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(user_id): Path<Uuid>,
) -> Result<Json<InvestorMonthlySummaryResponse>, (StatusCode, String)> {
    verify_cron(&state, &headers)?;

    let user_row = sqlx::query_as::<_, (bool, Option<Vec<String>>, Option<Vec<String>>)>(
        r#"SELECT u.is_basic, ip.sectors, ip.stages
           FROM users u
           LEFT JOIN investor_profiles ip ON ip.user_id = u.id
           WHERE u.id = $1 AND u.role = 'INVESTOR'"#,
    )
    .bind(user_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("monthly_summary_investor user lookup: {e}");
        (StatusCode::INTERNAL_SERVER_ERROR, "db error".into())
    })?;

    let (is_basic, inv_sectors, inv_stages) = match user_row {
        Some(r) => r,
        None => return Err((StatusCode::NOT_FOUND, "user not found or not an investor".into())),
    };

    let tier = if is_basic { "basic" } else { "free" };
    let limit: i64 =
        if is_basic { state.investor_match_limit_basic } else { state.investor_match_limit_free };

    let now = chrono::Utc::now();
    let first_of_last_month = chrono::NaiveDate::from_ymd_opt(
        if now.month() == 1 { now.year() - 1 } else { now.year() },
        if now.month() == 1 { 12 } else { now.month() - 1 },
        1,
    )
    .unwrap_or_default();
    let first_of_this_month =
        chrono::NaiveDate::from_ymd_opt(now.year(), now.month(), 1).unwrap_or_default();

    let month_name = first_of_last_month.format("%B %Y").to_string();

    let total_this_month: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM kevin_matches WHERE for_user_id = $1 AND match_type = 'investor_founder' AND weekly_email_sent_at >= $2 AND weekly_email_sent_at < $3",
    )
    .bind(user_id)
    .bind(first_of_last_month)
    .bind(first_of_this_month)
    .fetch_one(&state.db)
    .await
    .unwrap_or(0);

    if total_this_month == 0 {
        return Ok(Json(InvestorMonthlySummaryResponse {
            tier: tier.into(),
            eligible: false,
            month_name,
            total_this_month: 0,
            matches: vec![],
            snapshot_id: None,
        }));
    }

    let inv_sectors_str = inv_sectors.as_ref().map(|s| s.join(",")).unwrap_or_default();
    let inv_stages_str = inv_stages.as_ref().map(|s| s.join(",")).unwrap_or_default();

    let candidates = sqlx::query_as::<_, (Uuid, Option<String>, Option<String>, Option<String>, Option<String>, Option<i32>)>(
        r#"
        SELECT km.id,
               COALESCE(km.display_name, p.company_name) AS company_name,
               p.sector AS founder_sector,
               p.stage AS founder_stage,
               km.why_blurb,
               a.score AS angel_score
        FROM kevin_matches km
        LEFT JOIN profiles p ON p.user_id = km.matched_user_id
        LEFT JOIN angel_scores a ON a.founder_user_id = km.matched_user_id
        WHERE km.for_user_id = $1
          AND km.match_type = 'investor_founder'
          AND km.weekly_email_sent_at >= $2
          AND km.weekly_email_sent_at < $3
        ORDER BY a.score DESC NULLS LAST
        LIMIT $4
        "#,
    )
    .bind(user_id)
    .bind(first_of_last_month)
    .bind(first_of_this_month)
    .bind(limit)
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("monthly_summary_investor candidates: {e}");
        (StatusCode::INTERNAL_SERVER_ERROR, "db error".into())
    })?;

    let mut items = Vec::new();
    for (km_id, company_name, f_sector, f_stage, why_blurb, angel_score) in &candidates {
        let sector_overlap = match (f_sector.as_deref(), inv_sectors_str.as_str()) {
            (Some(a), b) if !a.is_empty() && !b.is_empty() => {
                b.to_lowercase().contains(&a.to_lowercase()) || a.to_lowercase().contains(&b.to_lowercase())
            }
            _ => false,
        };
        let stage_overlap = match (f_stage.as_deref(), inv_stages_str.as_str()) {
            (Some(a), b) if !a.is_empty() && !b.is_empty() => {
                b.to_lowercase().contains(&a.to_lowercase()) || a.to_lowercase().contains(&b.to_lowercase())
            }
            _ => false,
        };
        items.push(InvestorMonthlySummaryItem {
            id: *km_id,
            company_name: company_name.clone(),
            sector: f_sector.clone(),
            stage: f_stage.clone(),
            angel_score: *angel_score,
            sector_overlap,
            stage_overlap,
            why_blurb: why_blurb.clone(),
            deep_link: format!("/investor/deal-flow?focus={}", km_id),
        });
    }

    let snapshot_id = sqlx::query_scalar::<_, Uuid>(
        r#"
        INSERT INTO weekly_match_snapshots (user_id, week_of, matches)
        VALUES ($1, $2, $3)
        ON CONFLICT (user_id, week_of) DO UPDATE SET matches = $3, created_at = NOW()
        RETURNING id
        "#,
    )
    .bind(user_id)
    .bind(first_of_last_month)
    .bind(serde_json::to_value(&items).unwrap_or(json!([])))
    .fetch_one(&state.db)
    .await
    .ok();

    Ok(Json(InvestorMonthlySummaryResponse {
        tier: tier.into(),
        eligible: true,
        month_name,
        total_this_month,
        matches: items,
        snapshot_id,
    }))
}

// ── Shared helpers ──────────────────────────────────────────────────────────

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
        Ok((text, usage)) => {
            crate::cost::record_llm_usage(
                &state.db,
                None,
                None,
                None,
                "match_why_blurb",
                "gemini",
                &state.gemini_model,
                usage.input_tokens,
                usage.output_tokens,
            )
            .await;
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

// ── Email log & webhook ─────────────────────────────────────────────────────

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

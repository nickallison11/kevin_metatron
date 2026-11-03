use std::sync::Arc;

use chrono::Datelike;

use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    routing::{get, post},
    Json, Router,
};
use jsonwebtoken::{encode, Header as JwtHeader};
use serde::{Deserialize, Serialize};
use serde_json::json;
use uuid::Uuid;

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
        .route("/:user_id/rescore-matches", post(rescore_matches))
        .route("/:user_id/monthly-summary", get(monthly_summary_for_user))
        .route("/:user_id/monthly-summary-investor", get(monthly_summary_for_investor))
        .route("/email-log", post(insert_email_log))
        .route("/webhook-event", post(handle_webhook_event))
        .route("/bounce-report", get(bounce_report))
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
    /// ISO-2 country code from the founder's profile, used by the calling
    /// cron to gate the send to the founder's own local Monday 8am rather
    /// than a single fixed UTC time. None (no country set) falls back to
    /// UTC in that gating logic.
    country: Option<String>,
    is_basic: bool,
    unsubscribe_token: String,
}

async fn eligible_for_weekly_matches(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<Vec<EligibleFounder>>, (StatusCode, String)> {
    verify_cron(&state, &headers)?;

    let rows = sqlx::query_as::<_, (Uuid, String, bool, Option<String>)>(
        r#"
        SELECT u.id, u.email, u.is_basic, p.country
        FROM users u
        JOIN email_preferences ep ON ep.user_id = u.id
        LEFT JOIN profiles p ON p.user_id = u.id
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
        .map(|(user_id, email, is_basic, country)| {
            let unsubscribe_token =
                generate_token(&state.unsubscribe_secret, user_id, "weekly_matches_founder");
            EligibleFounder { user_id, email, country, is_basic, unsubscribe_token }
        })
        .collect();

    Ok(Json(founders))
}

#[derive(Serialize)]
struct EligibleInvestor {
    user_id: Uuid,
    email: String,
    /// ISO-2 country code from the investor's profile; same purpose as
    /// EligibleFounder::country.
    country: Option<String>,
    is_basic: bool,
    unsubscribe_token: String,
}

async fn eligible_for_weekly_matches_investors(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<Vec<EligibleInvestor>>, (StatusCode, String)> {
    verify_cron(&state, &headers)?;

    let rows = sqlx::query_as::<_, (Uuid, String, bool, Option<String>)>(
        r#"
        SELECT u.id, u.email, u.is_basic, ip.country
        FROM users u
        JOIN email_preferences ep ON ep.user_id = u.id
        JOIN investor_profiles ip ON ip.user_id = u.id
        WHERE u.role = 'INVESTOR'
          AND ep.weekly_matches = TRUE
          AND ep.unsubscribed_all = FALSE
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
        .map(|(user_id, email, is_basic, country)| {
            let unsubscribe_token =
                generate_token(&state.unsubscribe_secret, user_id, "weekly_matches_investor");
            EligibleInvestor { user_id, email, country, is_basic, unsubscribe_token }
        })
        .collect();

    Ok(Json(investors))
}

async fn eligible_for_monthly_summary(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<Vec<EligibleFounder>>, (StatusCode, String)> {
    verify_cron(&state, &headers)?;

    let rows = sqlx::query_as::<_, (Uuid, String, bool, Option<String>)>(
        r#"
        SELECT u.id, u.email, u.is_basic, p.country
        FROM users u
        JOIN email_preferences ep ON ep.user_id = u.id
        LEFT JOIN profiles p ON p.user_id = u.id
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
        .map(|(user_id, email, is_basic, country)| {
            let unsubscribe_token =
                generate_token(&state.unsubscribe_secret, user_id, "monthly_summary_founder");
            EligibleFounder { user_id, email, country, is_basic, unsubscribe_token }
        })
        .collect();

    Ok(Json(founders))
}

async fn eligible_for_monthly_summary_investors(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<Vec<EligibleInvestor>>, (StatusCode, String)> {
    verify_cron(&state, &headers)?;

    let rows = sqlx::query_as::<_, (Uuid, String, bool, Option<String>)>(
        r#"
        SELECT u.id, u.email, u.is_basic, ip.country
        FROM users u
        JOIN email_preferences ep ON ep.user_id = u.id
        LEFT JOIN investor_profiles ip ON ip.user_id = u.id
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
        .map(|(user_id, email, is_basic, country)| {
            let unsubscribe_token =
                generate_token(&state.unsubscribe_secret, user_id, "monthly_summary_investor");
            EligibleInvestor { user_id, email, country, is_basic, unsubscribe_token }
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
    let (limit_free, limit_basic, limit_pro) = if role == "INVESTOR" {
        (state.investor_match_limit_free, state.investor_match_limit_basic, state.investor_match_limit_pro)
    } else {
        (state.match_limit_free, state.match_limit_basic, state.match_limit_pro)
    };
    let limit = if is_pro {
        if limit_pro == 0 { i64::MAX } else { limit_pro }
    } else if is_basic {
        limit_basic
    } else {
        limit_free
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
            let self_url = format!("http://127.0.0.1:{}/kevin-matches", state.port);
            if let Err(e) = state
                .http_client
                .post(&self_url)
                .header("Authorization", format!("Bearer {}", token))
                .header(super::kevin_matches::WEEKLY_RUN_HEADER, "1")
                .send()
                .await
            {
                tracing::warn!("refresh_matches: self-call to {self_url} failed: {e}");
            }
            true
        } else {
            false
        }
    } else {
        false
    };

    Ok(Json(RefreshResult { recycled, generate_triggered }))
}

/// One-off: Kevin re-scores the matches this person already has with the
/// current scoring guide (scores and reasons only; dates, sent flags and
/// intro history stay). Returns the re-scored matches.
async fn rescore_matches(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(user_id): Path<Uuid>,
) -> Result<(StatusCode, String), (StatusCode, String)> {
    verify_cron(&state, &headers)?;
    let secret = state.cron_secret.clone().unwrap_or_default();
    let role: String = sqlx::query_scalar("SELECT role::text FROM users WHERE id = $1")
        .bind(user_id)
        .fetch_one(&state.db)
        .await
        .map_err(|_| (StatusCode::NOT_FOUND, "user not found".into()))?;

    let exp = (chrono::Utc::now() + chrono::Duration::seconds(600)).timestamp() as usize;
    let claims = Claims { sub: user_id.to_string(), role, exp };
    let token = encode(&JwtHeader::default(), &claims, &state.jwt_encoding)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let res = state
        .http_client
        .post(format!("http://127.0.0.1:{}/kevin-matches", state.port))
        .header("Authorization", format!("Bearer {token}"))
        .header(super::kevin_matches::RESCORE_HEADER, secret)
        .send()
        .await
        .map_err(|e| (StatusCode::BAD_GATEWAY, e.to_string()))?;
    let status = StatusCode::from_u16(res.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
    Ok((status, res.text().await.unwrap_or_default()))
}

// ── Weekly matches ──────────────────────────────────────────────────────────

#[derive(Serialize)]
struct WeeklyMatchItem {
    id: Uuid,
    firm_name: Option<String>,
    /// Kevin's match score (0-100), shown as "% fit".
    fit_score: i32,
    /// Kevin's reason, written to the founder.
    reason: Option<String>,
    deep_link: String,
    /// Shown in an earlier digest ("Still worth a look").
    repeat: bool,
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

    let user_row = sqlx::query_as::<_, (bool, bool)>(
        "SELECT is_basic, COALESCE(is_pro, false) FROM users WHERE id = $1 AND role = 'STARTUP'",
    )
    .bind(user_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("weekly_matches user lookup: {e}");
        (StatusCode::INTERNAL_SERVER_ERROR, "db error".into())
    })?;

    let (is_basic, is_pro) = match user_row {
        Some((b, p)) => (b, p),
        None => return Err((StatusCode::NOT_FOUND, "user not found or not a founder".into())),
    };

    let tier = if is_pro { "pro" } else if is_basic { "basic" } else { "free" };
    let limit: i64 = if is_pro {
        if state.match_limit_pro == 0 { i64::MAX } else { state.match_limit_pro }
    } else if is_basic {
        state.match_limit_basic
    } else {
        state.match_limit_free
    };

    let candidates = sqlx::query_as::<_, (Uuid, Option<String>, i32, Option<String>, bool)>(
        r#"
        SELECT km.id, COALESCE(km.display_name, ip.firm_name) AS firm_name,
               km.score, km.reasoning, km.first_sent_at IS NOT NULL
        FROM kevin_matches km
        LEFT JOIN investor_profiles ip ON ip.user_id = km.matched_user_id
        WHERE km.for_user_id = $1
          AND km.match_type = 'founder_investor'
          AND km.intro_requested_at IS NULL
          AND km.weekly_email_sent_at IS NULL
        ORDER BY (km.first_sent_at IS NOT NULL), km.score DESC
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

    for (km_id, firm_name, score, reasoning, repeat) in candidates.iter().take(limit as usize) {
        sent_ids.push(*km_id);
        items.push(WeeklyMatchItem {
            id: *km_id,
            firm_name: firm_name.clone(),
            fit_score: *score,
            reason: reasoning.clone().filter(|r| !r.trim().is_empty()),
            repeat: *repeat,
            deep_link: format!("/startup/matches?focus={}", km_id),
        });
    }

    // Mark these matches as sent so they won't repeat next week
    let _ = sqlx::query(
        "UPDATE kevin_matches SET weekly_email_sent_at = NOW(), first_sent_at = COALESCE(first_sent_at, NOW()) WHERE id = ANY($1)",
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
    /// Kevin's match score (0-100), shown as "% fit".
    fit_score: i32,
    /// The founder's Angel Score.
    angel_score: Option<i32>,
    /// Kevin's reason, written to the investor.
    reason: Option<String>,
    deep_link: String,
    /// Shown in an earlier digest ("Still worth a look").
    repeat: bool,
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

    let user_row = sqlx::query_as::<_, (bool, bool)>(
        "SELECT u.is_basic, COALESCE(u.is_pro, false) FROM users u WHERE u.id = $1 AND u.role = 'INVESTOR'",
    )
    .bind(user_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("weekly_matches_investor user lookup: {e}");
        (StatusCode::INTERNAL_SERVER_ERROR, "db error".into())
    })?;

    let (is_basic, is_pro) = match user_row {
        Some(r) => r,
        None => return Err((StatusCode::NOT_FOUND, "user not found or not an investor".into())),
    };

    let tier = if is_pro { "pro" } else if is_basic { "basic" } else { "free" };
    let limit: i64 = if is_pro {
        if state.investor_match_limit_pro == 0 { i64::MAX } else { state.investor_match_limit_pro }
    } else if is_basic {
        state.investor_match_limit_basic
    } else {
        state.investor_match_limit_free
    };

    let candidates = sqlx::query_as::<_, (Uuid, Option<String>, Option<String>, Option<String>, i32, Option<i32>, Option<String>, bool)>(
        r#"
        SELECT km.id,
               COALESCE(km.display_name, p.company_name) AS company_name,
               p.sector AS founder_sector,
               p.stage AS founder_stage,
               km.score,
               a.score AS angel_score,
               km.reasoning,
               km.first_sent_at IS NOT NULL
        FROM kevin_matches km
        LEFT JOIN profiles p ON p.user_id = km.matched_user_id
        LEFT JOIN angel_scores a ON a.founder_user_id = km.matched_user_id
        WHERE km.for_user_id = $1
          AND km.match_type = 'investor_founder'
          AND km.intro_requested_at IS NULL
          AND km.weekly_email_sent_at IS NULL
        ORDER BY (km.first_sent_at IS NOT NULL), km.score DESC
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

    let mut items = Vec::new();
    let mut sent_ids: Vec<Uuid> = Vec::new();

    for (km_id, company_name, f_sector, f_stage, score, angel_score, reasoning, repeat) in
        candidates.iter().take(limit as usize)
    {
        sent_ids.push(*km_id);
        items.push(InvestorWeeklyMatchItem {
            id: *km_id,
            company_name: company_name.clone(),
            sector: f_sector.clone(),
            stage: f_stage.clone(),
            fit_score: *score,
            angel_score: *angel_score,
            reason: reasoning.clone().filter(|r| !r.trim().is_empty()),
            repeat: *repeat,
            deep_link: format!("/investor/deal-flow?focus={}", km_id),
        });
    }

    // Mark these matches as sent
    let _ = sqlx::query(
        "UPDATE kevin_matches SET weekly_email_sent_at = NOW(), first_sent_at = COALESCE(first_sent_at, NOW()) WHERE id = ANY($1)",
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

/// Last month's activity, shown as four numbers at the top of the report.
#[derive(Serialize, Default)]
struct MonthStats {
    /// Matches Kevin made for the person last month (first time, not repeats).
    new_matches: i64,
    /// Intro requests the person sent or received.
    intros: i64,
    intros_accepted: i64,
    /// Founder: views of their deck. Investor: decks they viewed.
    deck_views: i64,
}

#[derive(Serialize)]
struct MonthlyMatchItem {
    id: Uuid,
    name: Option<String>,
    /// Kevin's match score (0-100), shown as "% fit".
    fit_score: i32,
    /// The founder's Angel Score (investor reports only).
    angel_score: Option<i32>,
    /// Kevin's reason, written to the reader.
    reason: Option<String>,
    deep_link: String,
}

#[derive(Serialize)]
struct MonthlySummaryResponse {
    tier: String,
    eligible: bool,
    month_name: String,
    payments_enabled: bool,
    stats: MonthStats,
    matches: Vec<MonthlyMatchItem>,
    snapshot_id: Option<Uuid>,
}

async fn monthly_summary_for_user(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(user_id): Path<Uuid>,
) -> Result<Json<MonthlySummaryResponse>, (StatusCode, String)> {
    verify_cron(&state, &headers)?;
    monthly_report(&state, user_id, "STARTUP").await.map(Json)
}

async fn monthly_summary_for_investor(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(user_id): Path<Uuid>,
) -> Result<Json<MonthlySummaryResponse>, (StatusCode, String)> {
    verify_cron(&state, &headers)?;
    monthly_report(&state, user_id, "INVESTOR").await.map(Json)
}

/// Last month's report for a founder (`STARTUP`) or an investor: the four
/// activity numbers and the top 3 matches by fit.
async fn monthly_report(
    state: &AppState,
    user_id: Uuid,
    role: &str,
) -> Result<MonthlySummaryResponse, (StatusCode, String)> {
    let investor = role == "INVESTOR";
    let (is_basic, is_pro) = sqlx::query_as::<_, (bool, bool)>(
        "SELECT is_basic, COALESCE(is_pro, false) FROM users WHERE id = $1 AND role::text = $2",
    )
    .bind(user_id)
    .bind(role)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("monthly_report user lookup: {e}");
        (StatusCode::INTERNAL_SERVER_ERROR, "db error".into())
    })?
    .ok_or((StatusCode::NOT_FOUND, "user not found".into()))?;
    let tier = if is_pro { "pro" } else if is_basic { "basic" } else { "free" };

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
    let match_type = if investor { "investor_founder" } else { "founder_investor" };
    let deck_column = if investor { "viewer_user_id" } else { "startup_user_id" };

    let stats = sqlx::query_as::<_, (i64, i64, i64, i64)>(&format!(
        r#"
        SELECT
          (SELECT COUNT(*) FROM kevin_matches
            WHERE for_user_id = $1 AND match_type = $2
              AND first_matched_at >= $3 AND first_matched_at < $4),
          (SELECT COUNT(*) FROM connections
            WHERE (from_user_id = $1 OR to_user_id = $1)
              AND COALESCE(requested_at, created_at) >= $3 AND COALESCE(requested_at, created_at) < $4),
          (SELECT COUNT(*) FROM connections
            WHERE (from_user_id = $1 OR to_user_id = $1)
              AND accepted_at >= $3 AND accepted_at < $4),
          (SELECT COUNT(*) FROM deck_views
            WHERE {deck_column} = $1 AND viewed_at >= $3 AND viewed_at < $4)
        "#
    ))
    .bind(user_id)
    .bind(match_type)
    .bind(first_of_last_month)
    .bind(first_of_this_month)
    .fetch_one(&state.db)
    .await
    .map(|(new_matches, intros, intros_accepted, deck_views)| MonthStats {
        new_matches,
        intros,
        intros_accepted,
        deck_views,
    })
    .unwrap_or_default();

    let rows = sqlx::query_as::<_, (Uuid, Option<String>, i32, Option<i32>, Option<String>)>(
        r#"
        SELECT km.id,
               COALESCE(km.display_name, ip.firm_name, p.company_name),
               km.score,
               a.score,
               km.reasoning
        FROM kevin_matches km
        LEFT JOIN investor_profiles ip ON ip.user_id = km.matched_user_id
        LEFT JOIN profiles p ON p.user_id = km.matched_user_id
        LEFT JOIN angel_scores a ON a.founder_user_id = km.matched_user_id AND $5
        WHERE km.for_user_id = $1
          AND km.match_type = $2
          AND km.weekly_email_sent_at >= $3
          AND km.weekly_email_sent_at < $4
        ORDER BY km.score DESC
        LIMIT 3
        "#,
    )
    .bind(user_id)
    .bind(match_type)
    .bind(first_of_last_month)
    .bind(first_of_this_month)
    .bind(investor)
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("monthly_report matches: {e}");
        (StatusCode::INTERNAL_SERVER_ERROR, "db error".into())
    })?;

    let matches: Vec<MonthlyMatchItem> = rows
        .into_iter()
        .map(|(id, name, fit_score, angel_score, reasoning)| MonthlyMatchItem {
            id,
            name,
            fit_score,
            angel_score,
            reason: reasoning.filter(|r| !r.trim().is_empty()),
            deep_link: if investor {
                format!("/investor/deal-flow?focus={id}")
            } else {
                format!("/startup/matches?focus={id}")
            },
        })
        .collect();

    let active = stats.new_matches + stats.intros + stats.intros_accepted + stats.deck_views > 0;
    if !active {
        return Ok(MonthlySummaryResponse {
            tier: tier.into(),
            eligible: false,
            month_name,
            payments_enabled: state.payments_enabled,
            stats,
            matches: vec![],
            snapshot_id: None,
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
    .bind(serde_json::to_value(&matches).unwrap_or(json!([])))
    .fetch_one(&state.db)
    .await
    .ok();

    Ok(MonthlySummaryResponse {
        tier: tier.into(),
        eligible: true,
        month_name,
        payments_enabled: state.payments_enabled,
        stats,
        matches,
        snapshot_id,
    })
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
    bounce_type: Option<String>,
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

    if body.column == "bounced_at" {
        let bounce_type = body.bounce_type.as_deref().unwrap_or("");
        let _ = sqlx::query("UPDATE email_send_log SET bounce_type = $2 WHERE resend_message_id = $1")
            .bind(&body.resend_message_id)
            .bind(bounce_type)
            .execute(&state.db)
            .await;

        // Only Transient bounces (mailbox full, greylisting, content filter) are worth
        // retrying — a Permanent bounce (bad address) will just bounce again and only
        // costs sender reputation.
        if bounce_type.eq_ignore_ascii_case("transient") {
            retry_bounced_email_as_plaintext(&state, &body.resend_message_id).await;
        }
    }

    Ok(StatusCode::OK)
}

#[derive(sqlx::FromRow)]
struct BouncedEmailRow {
    recipient_email: Option<String>,
    subject: Option<String>,
    plaintext_body: Option<String>,
}

/// Fires once per bounced message: re-sends the already-computed plaintext
/// body (no HTML at all) to the same recipient, then stamps
/// `plaintext_resent_at` so a second bounce webhook for the same message
/// can't trigger a duplicate resend.
async fn retry_bounced_email_as_plaintext(state: &AppState, resend_message_id: &str) {
    let Ok(Some(row)) = sqlx::query_as::<_, BouncedEmailRow>(
        r#"SELECT recipient_email, subject, plaintext_body FROM email_send_log
           WHERE resend_message_id = $1 AND plaintext_resent_at IS NULL"#,
    )
    .bind(resend_message_id)
    .fetch_optional(&state.db)
    .await
    else {
        return;
    };

    let (Some(to), Some(subject), Some(text)) =
        (row.recipient_email, row.subject, row.plaintext_body)
    else {
        return;
    };
    if to.trim().is_empty() || text.trim().is_empty() {
        return;
    }

    crate::email::send_plaintext_email(
        &state.http_client,
        state.resend_api_key.as_deref(),
        &state.email_from,
        &to,
        &subject,
        &text,
    )
    .await;

    let _ = sqlx::query("UPDATE email_send_log SET plaintext_resent_at = NOW() WHERE resend_message_id = $1")
        .bind(resend_message_id)
        .execute(&state.db)
        .await;
}

#[derive(Deserialize)]
struct BounceReportParams {
    days: Option<i64>,
}

#[derive(Serialize, sqlx::FromRow)]
struct BounceReportRow {
    email_type: String,
    bounce_type: Option<String>,
    count: i64,
    plaintext_resent_count: i64,
}

/// Cron-secret gated summary of `email_send_log` bounces, grouped by email
/// type and bounce classification, for the daily e2e monitor report.
async fn bounce_report(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(params): Query<BounceReportParams>,
) -> Result<Json<Vec<BounceReportRow>>, (StatusCode, String)> {
    verify_cron(&state, &headers)?;

    let days = params.days.unwrap_or(30).clamp(1, 365) as i32;

    let rows = sqlx::query_as::<_, BounceReportRow>(
        r#"
        SELECT
            email_type,
            bounce_type,
            COUNT(*) AS count,
            COUNT(*) FILTER (WHERE plaintext_resent_at IS NOT NULL) AS plaintext_resent_count
        FROM email_send_log
        WHERE bounced_at IS NOT NULL
          AND sent_at >= NOW() - make_interval(days => $1)
        GROUP BY email_type, bounce_type
        ORDER BY count DESC
        "#,
    )
    .bind(days)
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("bounce_report query: {e}");
        (StatusCode::INTERNAL_SERVER_ERROR, "db error".into())
    })?;

    Ok(Json(rows))
}

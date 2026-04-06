use std::sync::Arc;

use axum::{
    extract::State,
    routing::get,
    Json, Router,
};
use axum_extra::{
    headers::{authorization::Bearer, Authorization},
    TypedHeader,
};
use chrono::{Days, NaiveDate};
use serde::Serialize;
use sqlx::PgPool;
use uuid::Uuid;

use crate::identity::require_role;
use crate::state::AppState;

pub fn router() -> Router<Arc<AppState>> {
    Router::new().route("/matches", get(get_startup_matches))
}

#[derive(Serialize)]
struct StartupMatchItem {
    investor_user_id: Uuid,
    firm_name: Option<String>,
    bio: Option<String>,
    investment_thesis: Option<String>,
    ticket_size_min: Option<i64>,
    ticket_size_max: Option<i64>,
    sectors: Option<Vec<String>>,
    stages: Option<Vec<String>>,
    week_limit: i64,
    matches_used: i64,
    week_resets_at: NaiveDate,
}

#[derive(Serialize)]
struct StartupMatchesResponse {
    matches: Vec<StartupMatchItem>,
}

fn weekly_limit_for_tier(tier: Option<&str>) -> i64 {
    let t = tier
        .map(|s| s.trim().to_ascii_lowercase())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "free".to_string());
    match t.as_str() {
        "free" => 1,
        "basic" | "monthly" | "annual" => 10,
        "pro" => 999,
        _ => 1,
    }
}

async fn week_bounds(pool: &PgPool) -> Result<(NaiveDate, NaiveDate), sqlx::Error> {
    let week_start: NaiveDate = sqlx::query_scalar(
        r#"SELECT (DATE_TRUNC('week', NOW() AT TIME ZONE 'UTC'))::DATE"#,
    )
    .fetch_one(pool)
    .await?;

    let week_resets_at = week_start
        .checked_add_days(Days::new(7))
        .unwrap_or(week_start);

    Ok((week_start, week_resets_at))
}

#[derive(sqlx::FromRow)]
struct ProfileRow {
    sector: Option<String>,
    stage: Option<String>,
}

#[derive(sqlx::FromRow)]
struct MatchRow {
    investor_user_id: Uuid,
    firm_name: Option<String>,
    bio: Option<String>,
    investment_thesis: Option<String>,
    ticket_size_min: Option<i64>,
    ticket_size_max: Option<i64>,
    sectors: Option<Vec<String>>,
    stages: Option<Vec<String>>,
}

async fn get_startup_matches(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
) -> Result<Json<StartupMatchesResponse>, (axum::http::StatusCode, String)> {
    let authed = require_role(&state, bearer.token(), &["STARTUP"]).await?;

    let tier: Option<String> = sqlx::query_scalar(
        "SELECT subscription_tier FROM users WHERE id = $1",
    )
    .bind(authed.id)
    .fetch_one(&state.db)
    .await
    .map_err(|_| {
        (
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            "internal error".to_string(),
        )
    })?;

    let week_limit = weekly_limit_for_tier(tier.as_deref());

    let profile = sqlx::query_as::<_, ProfileRow>(
        "SELECT sector, stage FROM profiles WHERE user_id = $1",
    )
    .bind(authed.id)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| {
        (
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            "internal error".to_string(),
        )
    })?;

    let (sector, stage) = profile
        .map(|p| (p.sector, p.stage))
        .unwrap_or((None, None));

    let (week_start, week_resets_at) = week_bounds(&state.db)
        .await
        .map_err(|_| {
            (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                "internal error".to_string(),
            )
        })?;

    let count_this_week: i64 = sqlx::query_scalar(
        r#"
        SELECT COUNT(*)::BIGINT FROM investor_matches
        WHERE startup_user_id = $1 AND week_start = $2
        "#,
    )
    .bind(authed.id)
    .bind(week_start)
    .fetch_one(&state.db)
    .await
    .map_err(|_| {
        (
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            "internal error".to_string(),
        )
    })?;

    let slots = week_limit.saturating_sub(count_this_week);

    if slots > 0 {
        let new_investor_ids: Vec<Uuid> = sqlx::query_scalar(
            r#"
            SELECT u.id
            FROM users u
            JOIN investor_profiles ip ON ip.user_id = u.id
            WHERE u.role = 'INVESTOR'
              AND u.id NOT IN (
                SELECT investor_user_id FROM investor_matches
                WHERE startup_user_id = $1
              )
              AND (ip.sectors IS NULL OR ip.sectors = '{}' OR $2::text IS NULL OR $2 = ANY(ip.sectors))
              AND (ip.stages IS NULL OR ip.stages = '{}' OR $3::text IS NULL OR $3 = ANY(ip.stages))
            ORDER BY RANDOM()
            LIMIT $4
            "#,
        )
        .bind(authed.id)
        .bind(&sector)
        .bind(&stage)
        .bind(slots)
        .fetch_all(&state.db)
        .await
        .map_err(|_| {
            (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                "internal error".to_string(),
            )
        })?;

        for investor_id in new_investor_ids {
            sqlx::query(
                r#"
                INSERT INTO investor_matches (startup_user_id, investor_user_id, week_start)
                VALUES ($1, $2, $3)
                ON CONFLICT (startup_user_id, investor_user_id, week_start) DO NOTHING
                "#,
            )
            .bind(authed.id)
            .bind(investor_id)
            .bind(week_start)
            .execute(&state.db)
            .await
            .map_err(|_| {
                (
                    axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                    "internal error".to_string(),
                )
            })?;
        }
    }

    let rows: Vec<MatchRow> = sqlx::query_as::<_, MatchRow>(
        r#"
        SELECT
          im.investor_user_id,
          ip.firm_name,
          ip.bio,
          ip.investment_thesis,
          ip.ticket_size_min,
          ip.ticket_size_max,
          ip.sectors,
          ip.stages
        FROM investor_matches im
        JOIN investor_profiles ip ON ip.user_id = im.investor_user_id
        WHERE im.startup_user_id = $1 AND im.week_start = $2
        ORDER BY im.matched_at
        "#,
    )
    .bind(authed.id)
    .bind(week_start)
    .fetch_all(&state.db)
    .await
    .map_err(|_| {
        (
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            "internal error".to_string(),
        )
    })?;

    let matches_used: i64 = rows.len() as i64;

    let matches = rows
        .into_iter()
        .map(|r| StartupMatchItem {
            investor_user_id: r.investor_user_id,
            firm_name: r.firm_name,
            bio: r.bio,
            investment_thesis: r.investment_thesis,
            ticket_size_min: r.ticket_size_min,
            ticket_size_max: r.ticket_size_max,
            sectors: r.sectors,
            stages: r.stages,
            week_limit,
            matches_used,
            week_resets_at,
        })
        .collect();

    Ok(Json(StartupMatchesResponse { matches }))
}

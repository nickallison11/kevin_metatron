//! Founders review investors (the mirror of startup ratings in `ratings.rs`).
//! Mounted under /investor-profile (see investor_profile::router) so production
//! nginx, which forwards a fixed list of path prefixes to the backend, already
//! routes it:
//!   GET  /investor-profile/public/:investor_id          profile + rating summary + reviews
//!   POST /investor-profile/public/:investor_id/review   founder posts/updates their review
//!   GET  /investor-profile/review-summaries             avg + count per investor (directory cards)

use std::sync::Arc;

use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use axum_extra::{
    headers::{authorization::Bearer, Authorization},
    TypedHeader,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::identity::require_user;
use crate::state::AppState;

fn internal<E: std::fmt::Display>(e: E) -> (StatusCode, String) {
    tracing::error!("investor_ratings: {e}");
    (StatusCode::INTERNAL_SERVER_ERROR, "Something went wrong".to_string())
}

#[derive(Serialize, sqlx::FromRow)]
pub struct InvestorPublicProfile {
    pub user_id: Uuid,
    pub firm_name: Option<String>,
    pub bio: Option<String>,
    pub investment_thesis: Option<String>,
    pub sectors: Option<Vec<String>>,
    pub stages: Option<Vec<String>>,
    pub ticket_size_min: Option<i64>,
    pub ticket_size_max: Option<i64>,
    pub country: Option<String>,
    pub website: Option<String>,
    pub logo_url: Option<String>,
}

#[derive(Serialize, sqlx::FromRow, Default)]
pub struct RatingSummary {
    pub review_count: i64,
    pub avg_stars: Option<f64>,
    pub pct_responded_fast: Option<f64>,
    pub pct_useful_feedback: Option<f64>,
    pub pct_founder_friendly: Option<f64>,
    pub pct_would_pitch_again: Option<f64>,
}

#[derive(Serialize, sqlx::FromRow)]
pub struct InvestorReview {
    pub id: Uuid,
    pub overall_stars: i16,
    pub responded_fast: bool,
    pub useful_feedback: bool,
    pub founder_friendly: bool,
    pub would_pitch_again: bool,
    pub comment: Option<String>,
    pub created_at: chrono::DateTime<chrono::Utc>,
    /// "Verified founder · Seed · FinTech" — the reviewer's name is never shown.
    pub reviewer_label: String,
    pub is_mine: bool,
}

#[derive(Serialize)]
pub struct InvestorDetail {
    pub profile: InvestorPublicProfile,
    pub summary: RatingSummary,
    pub reviews: Vec<InvestorReview>,
    /// The viewer is a founder who has connected with this investor.
    pub can_review: bool,
    /// Kevin's fit score for this founder, when they're matched.
    pub fit_score: Option<i32>,
    /// The viewer already asked this investor for an intro.
    pub intro_requested: bool,
}

/// A founder may review an investor once they've actually connected: an
/// accepted connection or an accepted Kevin intro, in either direction.
async fn has_connected(state: &AppState, founder: Uuid, investor: Uuid) -> bool {
    sqlx::query_scalar::<_, bool>(
        r#"SELECT EXISTS(
               SELECT 1 FROM connections c
               WHERE c.status = 'accepted'
                 AND ((c.from_user_id = $1 AND c.to_user_id = $2) OR (c.from_user_id = $2 AND c.to_user_id = $1)))
           OR EXISTS(
               SELECT 1 FROM kevin_matches km
               WHERE km.intro_accepted_at IS NOT NULL
                 AND ((km.for_user_id = $1 AND km.matched_user_id = $2) OR (km.for_user_id = $2 AND km.matched_user_id = $1)))"#,
    )
    .bind(founder)
    .bind(investor)
    .fetch_one(&state.db)
    .await
    .unwrap_or(false)
}

async fn load_detail(state: &AppState, investor_id: Uuid, viewer: Uuid, viewer_role: &str) -> Result<InvestorDetail, (StatusCode, String)> {
    let profile = sqlx::query_as::<_, InvestorPublicProfile>(
        r#"SELECT u.id AS user_id, ip.firm_name, ip.bio, ip.investment_thesis, ip.sectors, ip.stages,
                  ip.ticket_size_min, ip.ticket_size_max, ip.country, ip.website, u.logo_url
           FROM users u JOIN investor_profiles ip ON ip.user_id = u.id
           WHERE u.id = $1 AND u.role = 'INVESTOR'"#,
    )
    .bind(investor_id)
    .fetch_optional(&state.db)
    .await
    .map_err(internal)?
    .ok_or((StatusCode::NOT_FOUND, "Investor not found".to_string()))?;

    let summary = sqlx::query_as::<_, RatingSummary>(
        r#"SELECT COUNT(*) AS review_count,
                  AVG(overall_stars)::float8 AS avg_stars,
                  (100.0 * AVG(responded_fast::int))::float8 AS pct_responded_fast,
                  (100.0 * AVG(useful_feedback::int))::float8 AS pct_useful_feedback,
                  (100.0 * AVG(founder_friendly::int))::float8 AS pct_founder_friendly,
                  (100.0 * AVG(would_pitch_again::int))::float8 AS pct_would_pitch_again
           FROM investor_ratings WHERE investor_user_id = $1"#,
    )
    .bind(investor_id)
    .fetch_one(&state.db)
    .await
    .map_err(internal)?;

    let reviews = sqlx::query_as::<_, InvestorReview>(
        r#"SELECT r.id, r.overall_stars, r.responded_fast, r.useful_feedback, r.founder_friendly,
                  r.would_pitch_again, r.comment, r.created_at,
                  CONCAT_WS(' · ', 'Verified founder',
                      NULLIF(INITCAP(REPLACE(p.stage, '-', ' ')), ''),
                      NULLIF(TRIM(SPLIT_PART(p.sector, ',', 1)), '')) AS reviewer_label,
                  (r.reviewer_user_id = $2) AS is_mine
           FROM investor_ratings r
           LEFT JOIN profiles p ON p.user_id = r.reviewer_user_id
           WHERE r.investor_user_id = $1
           ORDER BY r.updated_at DESC
           LIMIT 50"#,
    )
    .bind(investor_id)
    .bind(viewer)
    .fetch_all(&state.db)
    .await
    .map_err(internal)?;

    let is_founder = viewer_role.eq_ignore_ascii_case("STARTUP");
    let can_review = is_founder && has_connected(state, viewer, investor_id).await;

    let fit_score: Option<i32> = if is_founder {
        sqlx::query_scalar("SELECT score FROM kevin_matches WHERE for_user_id = $1 AND matched_user_id = $2 ORDER BY generated_at DESC LIMIT 1")
            .bind(viewer)
            .bind(investor_id)
            .fetch_optional(&state.db)
            .await
            .map_err(internal)?
    } else {
        None
    };

    let intro_requested: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM connections WHERE from_user_id = $1 AND to_user_id = $2 AND connection_type IN ('connect', 'intro_request'))",
    )
    .bind(viewer)
    .bind(investor_id)
    .fetch_one(&state.db)
    .await
    .unwrap_or(false);

    Ok(InvestorDetail { profile, summary, reviews, can_review, fit_score, intro_requested })
}

/// GET /investor-profile/public/:investor_id
pub async fn get_investor_public(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
    Path(investor_id): Path<Uuid>,
) -> Result<Json<InvestorDetail>, (StatusCode, String)> {
    let viewer = require_user(&state, bearer.token()).await?;
    Ok(Json(load_detail(&state, investor_id, viewer.id, &viewer.role).await?))
}

#[derive(Deserialize)]
pub struct ReviewBody {
    pub overall_stars: i16,
    #[serde(default)]
    pub responded_fast: bool,
    #[serde(default)]
    pub useful_feedback: bool,
    #[serde(default)]
    pub founder_friendly: bool,
    #[serde(default)]
    pub would_pitch_again: bool,
    #[serde(default)]
    pub comment: Option<String>,
}

/// POST /investor-profile/public/:investor_id/review — create or update the
/// founder's review. Only founders who've connected with the investor.
pub async fn post_investor_review(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
    Path(investor_id): Path<Uuid>,
    Json(body): Json<ReviewBody>,
) -> Result<Json<InvestorDetail>, (StatusCode, String)> {
    let viewer = require_user(&state, bearer.token()).await?;
    if !viewer.role.eq_ignore_ascii_case("STARTUP") {
        return Err((StatusCode::FORBIDDEN, "Only founders can review investors.".to_string()));
    }
    if !(1..=5).contains(&body.overall_stars) {
        return Err((StatusCode::BAD_REQUEST, "Pick a star rating from 1 to 5.".to_string()));
    }
    if !has_connected(&state, viewer.id, investor_id).await {
        return Err((StatusCode::FORBIDDEN, "You can review investors once you've connected with them.".to_string()));
    }
    let comment = body.comment.as_deref().map(str::trim).filter(|c| !c.is_empty()).map(|c| c.chars().take(1000).collect::<String>());

    sqlx::query(
        r#"INSERT INTO investor_ratings
               (investor_user_id, reviewer_user_id, overall_stars, responded_fast, useful_feedback,
                founder_friendly, would_pitch_again, comment)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (investor_user_id, reviewer_user_id) DO UPDATE SET
               overall_stars = EXCLUDED.overall_stars,
               responded_fast = EXCLUDED.responded_fast,
               useful_feedback = EXCLUDED.useful_feedback,
               founder_friendly = EXCLUDED.founder_friendly,
               would_pitch_again = EXCLUDED.would_pitch_again,
               comment = EXCLUDED.comment,
               updated_at = now()"#,
    )
    .bind(investor_id)
    .bind(viewer.id)
    .bind(body.overall_stars)
    .bind(body.responded_fast)
    .bind(body.useful_feedback)
    .bind(body.founder_friendly)
    .bind(body.would_pitch_again)
    .bind(&comment)
    .execute(&state.db)
    .await
    .map_err(internal)?;

    Ok(Json(load_detail(&state, investor_id, viewer.id, &viewer.role).await?))
}

#[derive(Serialize, sqlx::FromRow)]
pub struct ReviewSummaryRow {
    pub investor_user_id: Uuid,
    pub review_count: i64,
    pub avg_stars: Option<f64>,
}

/// GET /investor-profile/review-summaries — for the Browse Investors cards.
pub async fn review_summaries(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
) -> Result<Json<Vec<ReviewSummaryRow>>, (StatusCode, String)> {
    let _viewer = require_user(&state, bearer.token()).await?;
    let rows = sqlx::query_as::<_, ReviewSummaryRow>(
        r#"SELECT investor_user_id, COUNT(*) AS review_count, AVG(overall_stars)::float8 AS avg_stars
           FROM investor_ratings GROUP BY investor_user_id"#,
    )
    .fetch_all(&state.db)
    .await
    .map_err(internal)?;
    Ok(Json(rows))
}

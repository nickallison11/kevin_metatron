use std::sync::Arc;

use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    routing::{get, put},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::email;
use crate::identity::{require_reviewer, require_user_optional};
use crate::state::AppState;

use super::angel_score::{redact_breakdown_if_free, AngelScore};
use super::unsubscribe::{generate_token, verify_token};

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/startups", get(list_startups))
        .route("/startups/:startup_user_id", get(get_startup).post(submit_rating))
        .route("/verify", put(verify_rating))
}

fn internal(e: impl std::fmt::Display) -> (StatusCode, String) {
    tracing::error!("ratings: {e}");
    (StatusCode::INTERNAL_SERVER_ERROR, "internal error".to_string())
}

const PLATFORM_WEIGHT_INVESTOR: f64 = 1.0;
const PLATFORM_WEIGHT_CONNECTOR: f64 = 0.8;
const PLATFORM_WEIGHT_FOUNDER: f64 = 0.6;
const REVIEWER_WEIGHT: f64 = 0.4;
const ANON_WEIGHT: f64 = 0.15;
const MIN_ACCOUNT_AGE_DAYS: i64 = 7;
const ANON_VERIFY_WINDOW_DAYS: i64 = 14;

fn bearer_token(headers: &HeaderMap) -> Option<&str> {
    headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
}

fn email_domain(email: &str) -> Option<String> {
    email.rsplit_once('@').map(|(_, d)| d.to_lowercase())
}

fn ip_hash(state: &AppState, ip: &str) -> String {
    let data = format!("startup_ratings_ip:{}:{}", state.unsubscribe_secret, ip);
    hex::encode(Sha256::digest(data.as_bytes()))
}

fn client_ip(headers: &HeaderMap) -> String {
    headers
        .get("x-forwarded-for")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.split(',').next())
        .map(|v| v.trim().to_string())
        .unwrap_or_else(|| "unknown".to_string())
}

// ---------------------------------------------------------------------
// Public directory listing
// ---------------------------------------------------------------------

#[derive(Deserialize)]
struct ListQuery {
    sector: Option<String>,
    stage: Option<String>,
    country: Option<String>,
    sort: Option<String>,
    page: Option<i64>,
    page_size: Option<i64>,
}

#[derive(Serialize, sqlx::FromRow)]
struct StartupPublicSummary {
    user_id: Uuid,
    company_name: Option<String>,
    one_liner: Option<String>,
    stage: Option<String>,
    sector: Option<String>,
    country: Option<String>,
    pitch_deck_url: Option<String>,
    angel_score: Option<i32>,
    community_score: Option<f64>,
    rating_count: i64,
}

async fn list_startups(
    State(state): State<Arc<AppState>>,
    Query(q): Query<ListQuery>,
) -> Result<Json<Vec<StartupPublicSummary>>, (StatusCode, String)> {
    let page = q.page.unwrap_or(1).max(1);
    let page_size = q.page_size.unwrap_or(24).clamp(1, 100);
    let offset = (page - 1) * page_size;
    let sort = q.sort.as_deref().unwrap_or("newest");

    let rows = sqlx::query_as::<_, StartupPublicSummary>(
        r#"
        SELECT
            p.user_id,
            p.company_name,
            p.one_liner,
            p.stage,
            p.sector,
            p.country::text AS country,
            CASE WHEN p.deck_expires_at IS NOT NULL AND p.deck_expires_at <= NOW() THEN NULL
                 ELSE p.pitch_deck_url END AS pitch_deck_url,
            a.score AS angel_score,
            c.community_score::float8 AS community_score,
            COALESCE(c.rating_count, 0) AS rating_count
        FROM profiles p
        INNER JOIN users u ON u.id = p.user_id
        LEFT JOIN angel_scores a ON a.founder_user_id = p.user_id
        LEFT JOIN startup_community_scores c ON c.startup_user_id = p.user_id
        WHERE u.role = 'STARTUP'
          AND p.is_publicly_listed = TRUE
          AND ($1::text IS NULL OR p.sector = $1)
          AND ($2::text IS NULL OR p.stage = $2)
          AND ($3::text IS NULL OR p.country::text = $3)
        ORDER BY
            CASE WHEN $4 = 'community_score' THEN c.community_score END DESC NULLS LAST,
            CASE WHEN $4 = 'angel_score' THEN a.score END DESC NULLS LAST,
            p.updated_at DESC NULLS LAST,
            p.created_at DESC
        LIMIT $5 OFFSET $6
        "#,
    )
    .bind(&q.sector)
    .bind(&q.stage)
    .bind(&q.country)
    .bind(sort)
    .bind(page_size)
    .bind(offset)
    .fetch_all(&state.db)
    .await
    .map_err(internal)?;

    // Angel Score sub-scores are never returned by this row shape at all
    // (only the overall `score`), so anonymous viewers already get the
    // free-tier-equivalent view -- nothing further to redact here.
    Ok(Json(rows))
}

// ---------------------------------------------------------------------
// Public startup detail
// ---------------------------------------------------------------------

#[derive(Serialize, sqlx::FromRow)]
struct StartupProfilePublic {
    user_id: Uuid,
    company_name: Option<String>,
    one_liner: Option<String>,
    stage: Option<String>,
    sector: Option<String>,
    country: Option<String>,
    website: Option<String>,
    pitch_deck_url: Option<String>,
}

#[derive(Serialize, sqlx::FromRow)]
struct CommunityScoreSummary {
    rating_count: i64,
    community_score: Option<f64>,
    avg_team_score: Option<f64>,
    avg_market_score: Option<f64>,
    avg_traction_score: Option<f64>,
    avg_product_score: Option<f64>,
}

#[derive(Serialize, sqlx::FromRow)]
struct PublicReviewRow {
    id: Uuid,
    tier: String,
    overall_stars: i16,
    team_score: Option<i16>,
    market_score: Option<i16>,
    traction_score: Option<i16>,
    product_score: Option<i16>,
    comment: Option<String>,
    created_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Serialize)]
struct StartupDetailResponse {
    profile: StartupProfilePublic,
    angel_score: Option<AngelScore>,
    community_score: Option<CommunityScoreSummary>,
    reviews: Vec<PublicReviewRow>,
}

async fn get_startup(
    State(state): State<Arc<AppState>>,
    Path(startup_user_id): Path<Uuid>,
) -> Result<Json<StartupDetailResponse>, (StatusCode, String)> {
    let profile = sqlx::query_as::<_, StartupProfilePublic>(
        r#"
        SELECT p.user_id, p.company_name, p.one_liner, p.stage, p.sector,
               p.country::text AS country, p.website,
               CASE WHEN p.deck_expires_at IS NOT NULL AND p.deck_expires_at <= NOW() THEN NULL
                    ELSE p.pitch_deck_url END AS pitch_deck_url
        FROM profiles p
        INNER JOIN users u ON u.id = p.user_id
        WHERE p.user_id = $1 AND u.role = 'STARTUP' AND p.is_publicly_listed = TRUE
        "#,
    )
    .bind(startup_user_id)
    .fetch_optional(&state.db)
    .await
    .map_err(internal)?
    .ok_or((StatusCode::NOT_FOUND, "startup not found".to_string()))?;

    let angel_score = sqlx::query_as::<_, AngelScore>(
        "SELECT founder_user_id, score, team_score, market_score, traction_score, pitch_score, reasoning, generated_at \
         FROM angel_scores WHERE founder_user_id = $1",
    )
    .bind(startup_user_id)
    .fetch_optional(&state.db)
    .await
    .map_err(internal)?
    .map(|s| redact_breakdown_if_free(s, false, false));

    let community_score = sqlx::query_as::<_, CommunityScoreSummary>(
        r#"
        SELECT rating_count, community_score::float8 AS community_score,
               avg_team_score::float8 AS avg_team_score,
               avg_market_score::float8 AS avg_market_score,
               avg_traction_score::float8 AS avg_traction_score,
               avg_product_score::float8 AS avg_product_score
        FROM startup_community_scores WHERE startup_user_id = $1
        "#,
    )
    .bind(startup_user_id)
    .fetch_optional(&state.db)
    .await
    .map_err(internal)?;

    let reviews = sqlx::query_as::<_, PublicReviewRow>(
        r#"
        SELECT id, tier, overall_stars, team_score, market_score, traction_score, product_score, comment, created_at
        FROM startup_ratings
        WHERE startup_user_id = $1
          AND is_flagged = FALSE
          AND (tier != 'anonymous' OR verified_at IS NOT NULL OR created_at > NOW() - make_interval(days => $2))
        ORDER BY created_at DESC
        LIMIT 50
        "#,
    )
    .bind(startup_user_id)
    .bind(ANON_VERIFY_WINDOW_DAYS as i32)
    .fetch_all(&state.db)
    .await
    .map_err(internal)?;

    Ok(Json(StartupDetailResponse {
        profile,
        angel_score,
        community_score,
        reviews,
    }))
}

// ---------------------------------------------------------------------
// Rating submission
// ---------------------------------------------------------------------

#[derive(Deserialize)]
struct SubmitRatingRequest {
    overall_stars: i16,
    team_score: Option<i16>,
    market_score: Option<i16>,
    traction_score: Option<i16>,
    product_score: Option<i16>,
    comment: Option<String>,
    /// Required only when submitting with no bearer token at all.
    name: Option<String>,
    email: Option<String>,
}

#[derive(Serialize, sqlx::FromRow)]
struct PublicRatingDto {
    id: Uuid,
    tier: String,
    overall_stars: i16,
    team_score: Option<i16>,
    market_score: Option<i16>,
    traction_score: Option<i16>,
    product_score: Option<i16>,
    comment: Option<String>,
    created_at: chrono::DateTime<chrono::Utc>,
}

fn validate_stars(v: i16) -> Result<(), (StatusCode, String)> {
    if !(1..=5).contains(&v) {
        return Err((StatusCode::BAD_REQUEST, "scores must be between 1 and 5".to_string()));
    }
    Ok(())
}

enum Identity {
    Platform { user_id: Uuid, role: String, created_at: chrono::DateTime<chrono::Utc> },
    Reviewer { id: Uuid, email: String, created_at: chrono::DateTime<chrono::Utc> },
    Anonymous { name: String, email: String },
}

async fn resolve_identity(
    state: &AppState,
    headers: &HeaderMap,
    body: &SubmitRatingRequest,
) -> Result<Identity, (StatusCode, String)> {
    if let Some(token) = bearer_token(headers) {
        if let Some(user) = require_user_optional(state, Some(token)).await? {
            let created_at: chrono::DateTime<chrono::Utc> =
                sqlx::query_scalar("SELECT created_at FROM users WHERE id = $1")
                    .bind(user.id)
                    .fetch_one(&state.db)
                    .await
                    .map_err(internal)?;
            return Ok(Identity::Platform { user_id: user.id, role: user.role, created_at });
        }

        let reviewer = require_reviewer(state, token).await?;
        return Ok(Identity::Reviewer {
            id: reviewer.id,
            email: reviewer.email,
            created_at: reviewer.created_at,
        });
    }

    let name = body
        .name
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or((StatusCode::BAD_REQUEST, "name is required".to_string()))?;
    let email = body
        .email
        .as_deref()
        .map(str::trim)
        .filter(|s| s.contains('@'))
        .ok_or((StatusCode::BAD_REQUEST, "a valid email is required".to_string()))?;

    Ok(Identity::Anonymous { name: name.to_string(), email: email.to_lowercase() })
}

async fn submit_rating(
    State(state): State<Arc<AppState>>,
    Path(startup_user_id): Path<Uuid>,
    headers: HeaderMap,
    Json(body): Json<SubmitRatingRequest>,
) -> Result<Json<PublicRatingDto>, (StatusCode, String)> {
    validate_stars(body.overall_stars)?;
    for s in [body.team_score, body.market_score, body.traction_score, body.product_score]
        .into_iter()
        .flatten()
    {
        validate_stars(s)?;
    }
    if let Some(c) = &body.comment {
        if c.chars().count() > 500 {
            return Err((StatusCode::BAD_REQUEST, "comment must be 500 characters or fewer".to_string()));
        }
    }

    let owner_email: Option<String> = sqlx::query_scalar(
        "SELECT u.email FROM profiles p JOIN users u ON u.id = p.user_id \
         WHERE p.user_id = $1 AND u.role = 'STARTUP' AND p.is_publicly_listed = TRUE",
    )
    .bind(startup_user_id)
    .fetch_optional(&state.db)
    .await
    .map_err(internal)?;
    let owner_email = owner_email.ok_or((StatusCode::NOT_FOUND, "startup not found".to_string()))?;
    let owner_domain = email_domain(&owner_email);

    let identity = resolve_identity(&state, &headers, &body).await?;

    let mut is_flagged = false;
    let mut flag_reason: Option<&'static str> = None;

    let rating_id: Uuid = match &identity {
        Identity::Platform { user_id, role, created_at } => {
            if *user_id == startup_user_id {
                return Err((StatusCode::FORBIDDEN, "cannot rate your own startup".to_string()));
            }
            let base = match role.as_str() {
                "INVESTOR" => PLATFORM_WEIGHT_INVESTOR,
                "INTERMEDIARY" => PLATFORM_WEIGHT_CONNECTOR,
                _ => PLATFORM_WEIGHT_FOUNDER,
            };
            let account_age_days = (chrono::Utc::now() - *created_at).num_days();
            let weight = if account_age_days < MIN_ACCOUNT_AGE_DAYS { ANON_WEIGHT } else { base };

            let id: Uuid = sqlx::query_scalar(
                r#"
                INSERT INTO startup_ratings (
                    startup_user_id, platform_user_id, tier, overall_stars,
                    team_score, market_score, traction_score, product_score, comment, weight
                ) VALUES ($1, $2, 'platform', $3, $4, $5, $6, $7, $8, $9::float8)
                ON CONFLICT (startup_user_id, platform_user_id) DO UPDATE SET
                    overall_stars = EXCLUDED.overall_stars,
                    team_score = EXCLUDED.team_score,
                    market_score = EXCLUDED.market_score,
                    traction_score = EXCLUDED.traction_score,
                    product_score = EXCLUDED.product_score,
                    comment = EXCLUDED.comment,
                    weight = EXCLUDED.weight,
                    updated_at = now()
                RETURNING id
                "#,
            )
            .bind(startup_user_id)
            .bind(user_id)
            .bind(body.overall_stars)
            .bind(body.team_score)
            .bind(body.market_score)
            .bind(body.traction_score)
            .bind(body.product_score)
            .bind(&body.comment)
            .bind(weight)
            .fetch_one(&state.db)
            .await
            .map_err(internal)?;

            id
        }
        Identity::Reviewer { id: reviewer_id, email, created_at } => {
            if owner_domain.as_deref() == email_domain(email).as_deref() {
                is_flagged = true;
                flag_reason = Some("email_domain_matches_owner");
            }
            let account_age_days = (chrono::Utc::now() - *created_at).num_days();
            let weight = if account_age_days < MIN_ACCOUNT_AGE_DAYS { ANON_WEIGHT } else { REVIEWER_WEIGHT };

            let id: Uuid = sqlx::query_scalar(
                r#"
                INSERT INTO startup_ratings (
                    startup_user_id, reviewer_account_id, tier, overall_stars,
                    team_score, market_score, traction_score, product_score, comment, weight,
                    is_flagged, flag_reason
                ) VALUES ($1, $2, 'reviewer', $3, $4, $5, $6, $7, $8, $9::float8, $10, $11)
                ON CONFLICT (startup_user_id, reviewer_account_id) DO UPDATE SET
                    overall_stars = EXCLUDED.overall_stars,
                    team_score = EXCLUDED.team_score,
                    market_score = EXCLUDED.market_score,
                    traction_score = EXCLUDED.traction_score,
                    product_score = EXCLUDED.product_score,
                    comment = EXCLUDED.comment,
                    weight = EXCLUDED.weight,
                    is_flagged = EXCLUDED.is_flagged,
                    flag_reason = EXCLUDED.flag_reason,
                    updated_at = now()
                RETURNING id
                "#,
            )
            .bind(startup_user_id)
            .bind(reviewer_id)
            .bind(body.overall_stars)
            .bind(body.team_score)
            .bind(body.market_score)
            .bind(body.traction_score)
            .bind(body.product_score)
            .bind(&body.comment)
            .bind(weight)
            .bind(is_flagged)
            .bind(flag_reason)
            .fetch_one(&state.db)
            .await
            .map_err(internal)?;

            id
        }
        Identity::Anonymous { name, email } => {
            if owner_domain.as_deref() == email_domain(email).as_deref() {
                is_flagged = true;
                flag_reason = Some("email_domain_matches_owner");
            }

            let ip = client_ip(&headers);
            let ip_h = ip_hash(&state, &ip);

            let recent: i64 = sqlx::query_scalar(
                r#"
                SELECT COUNT(*) FROM startup_ratings
                WHERE anon_ip_hash = $1 AND startup_user_id = $2
                  AND created_at > NOW() - INTERVAL '24 hours'
                  AND anon_email IS DISTINCT FROM $3
                "#,
            )
            .bind(&ip_h)
            .bind(startup_user_id)
            .bind(email)
            .fetch_one(&state.db)
            .await
            .map_err(internal)?;
            if recent > 0 {
                return Err((StatusCode::TOO_MANY_REQUESTS, "too many anonymous reviews from this network today".to_string()));
            }

            let verification_token = Uuid::new_v4().to_string();

            let id: Uuid = sqlx::query_scalar(
                r#"
                INSERT INTO startup_ratings (
                    startup_user_id, anon_email, anon_name, anon_ip_hash, tier, overall_stars,
                    team_score, market_score, traction_score, product_score, comment, weight,
                    verification_token, verified_at, is_flagged, flag_reason
                ) VALUES ($1, $2, $3, $4, 'anonymous', $5, $6, $7, $8, $9, $10, $11::float8, $12, NULL, $13, $14)
                ON CONFLICT (startup_user_id, anon_email) DO UPDATE SET
                    anon_name = EXCLUDED.anon_name,
                    anon_ip_hash = EXCLUDED.anon_ip_hash,
                    overall_stars = EXCLUDED.overall_stars,
                    team_score = EXCLUDED.team_score,
                    market_score = EXCLUDED.market_score,
                    traction_score = EXCLUDED.traction_score,
                    product_score = EXCLUDED.product_score,
                    comment = EXCLUDED.comment,
                    weight = EXCLUDED.weight,
                    verification_token = EXCLUDED.verification_token,
                    verified_at = NULL,
                    is_flagged = EXCLUDED.is_flagged,
                    flag_reason = EXCLUDED.flag_reason,
                    updated_at = now()
                RETURNING id
                "#,
            )
            .bind(startup_user_id)
            .bind(email)
            .bind(name)
            .bind(&ip_h)
            .bind(body.overall_stars)
            .bind(body.team_score)
            .bind(body.market_score)
            .bind(body.traction_score)
            .bind(body.product_score)
            .bind(&body.comment)
            .bind(ANON_WEIGHT)
            .bind(&verification_token)
            .bind(is_flagged)
            .bind(flag_reason)
            .fetch_one(&state.db)
            .await
            .map_err(internal)?;

            let company_name: Option<String> =
                sqlx::query_scalar("SELECT company_name FROM profiles WHERE user_id = $1")
                    .bind(startup_user_id)
                    .fetch_optional(&state.db)
                    .await
                    .map_err(internal)?
                    .flatten();
            let startup_name = company_name.unwrap_or_else(|| "this startup".to_string());

            let confirm_token = generate_token(&state.unsubscribe_secret, id, "review_verify");
            let verify_url = format!("{}/ratings/verify?token={}", state.frontend_url, confirm_token);
            let http_client = state.http_client.clone();
            let api_key = state.resend_api_key.clone();
            let from = state.email_from.clone();
            let to = email.clone();
            tokio::spawn(async move {
                email::send_review_verification_email(
                    &http_client,
                    api_key.as_deref(),
                    &from,
                    &to,
                    &startup_name,
                    &verify_url,
                )
                .await;
            });

            id
        }
    };

    let out = sqlx::query_as::<_, PublicRatingDto>(
        "SELECT id, tier, overall_stars, team_score, market_score, traction_score, product_score, comment, created_at \
         FROM startup_ratings WHERE id = $1",
    )
    .bind(rating_id)
    .fetch_one(&state.db)
    .await
    .map_err(internal)?;

    Ok(Json(out))
}

// ---------------------------------------------------------------------
// Anonymous-tier email confirmation
// ---------------------------------------------------------------------

#[derive(Deserialize)]
struct VerifyRequest {
    token: String,
}

async fn verify_rating(
    State(state): State<Arc<AppState>>,
    Json(body): Json<VerifyRequest>,
) -> Result<StatusCode, (StatusCode, String)> {
    let (rating_id, email_type) = verify_token(&state.unsubscribe_secret, &body.token)
        .ok_or((StatusCode::BAD_REQUEST, "invalid or expired link".to_string()))?;
    if email_type != "review_verify" {
        return Err((StatusCode::BAD_REQUEST, "invalid link".to_string()));
    }

    sqlx::query(
        "UPDATE startup_ratings SET verified_at = COALESCE(verified_at, now()) WHERE id = $1 AND tier = 'anonymous'",
    )
    .bind(rating_id)
    .execute(&state.db)
    .await
    .map_err(internal)?;

    Ok(StatusCode::OK)
}

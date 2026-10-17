use std::sync::Arc;

use axum::{
    extract::State,
    routing::{get, put},
    Json, Router,
};
use axum_extra::{
    headers::{authorization::Bearer, Authorization},
    TypedHeader,
};
use serde::{Deserialize, Serialize};

use crate::identity::{require_role, require_user, AuthedUser};
use crate::ipfs_snapshot::snapshot_user_context;
use crate::state::AppState;
use uuid::Uuid;

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/", get(get_profile).put(put_profile))
        .route("/founders/all", get(list_founders))
        .route("/public-listing", put(put_public_listing))
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ProfileDto {
    pub company_name: Option<String>,
    pub one_liner: Option<String>,
    pub stage: Option<String>,
    pub sector: Option<String>,
    pub country: Option<String>,
    pub website: Option<String>,
    pub pitch_deck_url: Option<String>,
    pub ipfs_visibility: Option<String>,
    /// RFC3339 timestamp when the uploaded deck link expires (deck hosting window).
    #[serde(default)]
    pub deck_expires_at: Option<String>,
    /// Number of times the founder has uploaded a deck (free tier limited to one).
    #[serde(default)]
    pub deck_upload_count: i32,
    /// IPFS gateway URL for the latest JSON context snapshot (profile + pitches + memory summary).
    #[serde(default)]
    pub context_ipfs_url: Option<String>,
    /// Public startup directory listing -- opt-out, defaults TRUE.
    #[serde(default = "default_true")]
    pub is_publicly_listed: bool,
    /// Company logo ({FRONTEND_URL}/media/<cid>); read-only here, set via /uploads/logo*.
    #[serde(default)]
    pub logo_url: Option<String>,
    /// 'website' (found automatically) or 'upload'.
    #[serde(default)]
    pub logo_source: Option<String>,
}

fn default_true() -> bool {
    true
}

// Matches the `is_publicly_listed BOOLEAN NOT NULL DEFAULT TRUE` column --
// a founder with no profile row yet is opted in by default, same as one
// who has saved a profile without touching the toggle.
impl Default for ProfileDto {
    fn default() -> Self {
        ProfileDto {
            company_name: None,
            one_liner: None,
            stage: None,
            sector: None,
            country: None,
            website: None,
            pitch_deck_url: None,
            ipfs_visibility: None,
            deck_expires_at: None,
            deck_upload_count: 0,
            context_ipfs_url: None,
            is_publicly_listed: true,
            logo_url: None,
            logo_source: None,
        }
    }
}

async fn get_profile(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
) -> Result<Json<ProfileDto>, (axum::http::StatusCode, String)> {
    let AuthedUser { id, .. } =
        require_role(&state, bearer.token(), &["STARTUP"]).await?;
    fetch_profile(&state, id).await
}

async fn fetch_profile(
    state: &AppState,
    user_id: uuid::Uuid,
) -> Result<Json<ProfileDto>, (axum::http::StatusCode, String)> {
    let row = sqlx::query_as::<_, ProfileRow>(
        r#"
        SELECT p.company_name, p.one_liner, p.stage, p.sector, p.country::text as country,
               p.website, p.pitch_deck_url, p.ipfs_visibility,
               p.deck_expires_at::text as deck_expires_at,
               COALESCE(p.deck_upload_count, 0)::int as deck_upload_count,
               p.context_ipfs_url, COALESCE(p.is_publicly_listed, TRUE) as is_publicly_listed,
               u.logo_url, u.logo_source
        FROM users u LEFT JOIN profiles p ON p.user_id = u.id
        WHERE u.id = $1
        "#,
    )
    .bind(user_id)
    .fetch_optional(&state.db)
    .await
    .map_err(internal)?;

    Ok(Json(row.map(Into::into).unwrap_or_default()))
}

#[derive(sqlx::FromRow)]
struct ProfileRow {
    company_name: Option<String>,
    one_liner: Option<String>,
    stage: Option<String>,
    sector: Option<String>,
    country: Option<String>,
    website: Option<String>,
    pitch_deck_url: Option<String>,
    ipfs_visibility: Option<String>,
    deck_expires_at: Option<String>,
    deck_upload_count: i32,
    context_ipfs_url: Option<String>,
    is_publicly_listed: bool,
    logo_url: Option<String>,
    logo_source: Option<String>,
}

impl From<ProfileRow> for ProfileDto {
    fn from(r: ProfileRow) -> Self {
        ProfileDto {
            company_name: r.company_name,
            one_liner: r.one_liner,
            stage: r.stage,
            sector: r.sector,
            country: r.country,
            website: r.website,
            pitch_deck_url: r.pitch_deck_url,
            ipfs_visibility: r.ipfs_visibility,
            deck_expires_at: r.deck_expires_at,
            deck_upload_count: r.deck_upload_count,
            context_ipfs_url: r.context_ipfs_url,
            is_publicly_listed: r.is_publicly_listed,
            logo_url: r.logo_url,
            logo_source: r.logo_source,
        }
    }
}

#[derive(Deserialize)]
struct PublicListingRequest {
    is_publicly_listed: bool,
}

// Kept separate from `put_profile`'s upsert so a client that omits this
// field on a normal profile save can't silently flip it back to the
// column's DB default.
async fn put_public_listing(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
    Json(body): Json<PublicListingRequest>,
) -> Result<Json<ProfileDto>, (axum::http::StatusCode, String)> {
    let AuthedUser { id, .. } = require_role(&state, bearer.token(), &["STARTUP"]).await?;

    sqlx::query(
        r#"
        INSERT INTO profiles (user_id, is_publicly_listed)
        VALUES ($1, $2)
        ON CONFLICT (user_id) DO UPDATE SET
            is_publicly_listed = EXCLUDED.is_publicly_listed,
            updated_at = now()
        "#,
    )
    .bind(id)
    .bind(body.is_publicly_listed)
    .execute(&state.db)
    .await
    .map_err(internal)?;

    fetch_profile(&state, id).await
}

async fn put_profile(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
    Json(body): Json<ProfileDto>,
) -> Result<Json<ProfileDto>, (axum::http::StatusCode, String)> {
    let AuthedUser { id, .. } =
        require_role(&state, bearer.token(), &["STARTUP"]).await?;

    let country = body.country.as_ref().and_then(|c| {
        let s: String = c
            .chars()
            .filter(|ch| ch.is_ascii_alphabetic())
            .take(2)
            .collect();
        if s.len() == 2 {
            Some(s.to_uppercase())
        } else {
            None
        }
    });

    sqlx::query(
        r#"
        INSERT INTO profiles (
            user_id, company_name, one_liner, stage, sector, country, website, pitch_deck_url
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (user_id) DO UPDATE SET
            company_name = EXCLUDED.company_name,
            one_liner = EXCLUDED.one_liner,
            stage = EXCLUDED.stage,
            sector = EXCLUDED.sector,
            country = EXCLUDED.country,
            website = EXCLUDED.website,
            pitch_deck_url = EXCLUDED.pitch_deck_url,
            updated_at = now()
        "#,
    )
    .bind(id)
    .bind(&body.company_name)
    .bind(&body.one_liner)
    .bind(&body.stage)
    .bind(&body.sector)
    .bind(&country)
    .bind(&body.website)
    .bind(&body.pitch_deck_url)
    .execute(&state.db)
    .await
    .map_err(internal)?;

    let out = fetch_profile(&state, id).await?;
    let snap_state = Arc::clone(&state);
    tokio::spawn(async move {
        snapshot_user_context(snap_state, id).await;
    });
    // A new or changed website: look for the company logo there (never
    // replaces a logo the founder uploaded).
    if out.logo_source.as_deref() != Some("upload") && body.website.as_deref().is_some_and(|w| !w.trim().is_empty()) {
        let logo_state = Arc::clone(&state);
        tokio::spawn(async move {
            crate::routes::uploads::refresh_logo_from_website(logo_state, id).await;
        });
    }
    Ok(out)
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct FounderPublicDto {
    pub user_id: Uuid,
    pub company_name: Option<String>,
    pub one_liner: Option<String>,
    pub stage: Option<String>,
    pub sector: Option<String>,
    pub country: Option<String>,
    pub pitch_deck_url: Option<String>,
}

async fn list_founders(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
) -> Result<Json<Vec<FounderPublicDto>>, (axum::http::StatusCode, String)> {
    let _u = require_user(&state, bearer.token()).await?;
    let sql = r#"
        SELECT
            p.user_id,
            p.company_name,
            p.one_liner,
            p.stage,
            p.sector,
            p.country::text AS country,
            p.pitch_deck_url
        FROM profiles p
        INNER JOIN users u ON u.id = p.user_id
        WHERE u.role = 'STARTUP'
        ORDER BY p.updated_at DESC NULLS LAST, p.created_at DESC
        "#;

    let rows = sqlx::query_as::<_, FounderPublicDto>(sql)
        .fetch_all(&state.db)
        .await
        .map_err(internal)?;

    Ok(Json(rows))
}

fn internal<E: std::fmt::Debug>(_e: E) -> (axum::http::StatusCode, String) {
    (
        axum::http::StatusCode::INTERNAL_SERVER_ERROR,
        "internal error".to_string(),
    )
}

//! The signed-up founder's own details and company links, each of which adds
//! fixed points to their Angel Score, plus facts about their deck for the
//! Startup Profile deck panel.

use std::sync::Arc;

use axum::{extract::State, http::StatusCode, routing::get, Json, Router};
use axum_extra::{
    headers::{authorization::Bearer, Authorization},
    TypedHeader,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::identity::require_role;
use crate::state::AppState;

pub fn router() -> Router<Arc<AppState>> {
    Router::new().route("/", get(get_extras).patch(patch_extras))
}

/// (id, Angel Score points). The card shows each missing one as "+ Your LinkedIn +6".
const BOOSTS: [(&str, i32); 5] = [("name", 3), ("linkedin", 6), ("company_linkedin", 4), ("x", 2), ("github", 2)];

#[derive(sqlx::FromRow)]
struct Row {
    first_name: Option<String>,
    last_name: Option<String>,
    linkedin_url: Option<String>,
    company_linkedin_url: Option<String>,
    company_x_url: Option<String>,
    company_github_url: Option<String>,
    deck_cover_url: Option<String>,
    deck_pages: Option<i32>,
    deck_uploaded_at: Option<chrono::DateTime<chrono::Utc>>,
}

fn set(v: &Option<String>) -> bool {
    v.as_deref().is_some_and(|s| !s.trim().is_empty())
}

impl Row {
    fn filled(&self, id: &str) -> bool {
        match id {
            "name" => set(&self.first_name) || set(&self.last_name),
            "linkedin" => set(&self.linkedin_url),
            "company_linkedin" => set(&self.company_linkedin_url),
            "x" => set(&self.company_x_url),
            "github" => set(&self.company_github_url),
            _ => false,
        }
    }
    fn bonus(&self) -> i32 {
        BOOSTS.iter().filter(|(id, _)| self.filled(id)).map(|(_, p)| p).sum()
    }
}

async fn load(db: &sqlx::PgPool, user_id: Uuid) -> Result<Row, sqlx::Error> {
    sqlx::query_as::<_, Row>(
        r#"
        SELECT u.first_name, u.last_name, u.linkedin_url,
               p.company_linkedin_url, p.company_x_url, p.company_github_url,
               p.deck_cover_url, p.deck_pages, p.deck_uploaded_at
        FROM users u LEFT JOIN profiles p ON p.user_id = u.id
        WHERE u.id = $1
        "#,
    )
    .bind(user_id)
    .fetch_one(db)
    .await
}

/// Points the founder's filled-in links add to the Angel Score.
pub(crate) async fn profile_bonus(db: &sqlx::PgPool, user_id: Uuid) -> i32 {
    load(db, user_id).await.map(|r| r.bonus()).unwrap_or(0)
}

/// Re-applies the link points to a stored Angel Score (no Gemini call).
async fn refresh_angel_score(db: &sqlx::PgPool, user_id: Uuid, bonus: i32) {
    if let Err(e) = sqlx::query(
        "UPDATE angel_scores SET score = LEAST(100, COALESCE(base_score, score) + $2) WHERE founder_user_id = $1",
    )
    .bind(user_id)
    .bind(bonus)
    .execute(db)
    .await
    {
        tracing::error!("refresh_angel_score: {e}");
    }
}

#[derive(Serialize)]
struct Boost {
    id: &'static str,
    points: i32,
}

#[derive(Serialize)]
struct ExtrasResponse {
    founder_name: Option<String>,
    founder_linkedin: Option<String>,
    company_linkedin: Option<String>,
    company_x: Option<String>,
    company_github: Option<String>,
    /// Links not filled in yet, with the points each would add.
    missing: Vec<Boost>,
    deck_cover_url: Option<String>,
    deck_pages: Option<i32>,
    deck_uploaded_at: Option<chrono::DateTime<chrono::Utc>>,
    angel_score: Option<i32>,
    /// What the score reaches once every link is filled in.
    angel_potential: Option<i32>,
}

async fn respond(state: &AppState, user_id: Uuid) -> Result<Json<ExtrasResponse>, (StatusCode, String)> {
    let r = load(&state.db, user_id).await.map_err(internal)?;
    let scores: Option<(i32, Option<i32>)> =
        sqlx::query_as("SELECT score, base_score FROM angel_scores WHERE founder_user_id = $1")
            .bind(user_id)
            .fetch_optional(&state.db)
            .await
            .map_err(internal)?;
    let all: i32 = BOOSTS.iter().map(|(_, p)| p).sum();
    let name = [r.first_name.as_deref(), r.last_name.as_deref()]
        .into_iter()
        .flatten()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join(" ");
    Ok(Json(ExtrasResponse {
        founder_name: (!name.is_empty()).then_some(name),
        missing: BOOSTS
            .iter()
            .filter(|(id, _)| !r.filled(id))
            .map(|(id, points)| Boost { id, points: *points })
            .collect(),
        angel_score: scores.map(|s| s.0),
        angel_potential: scores.map(|(score, base)| (base.unwrap_or(score) + all).min(100)),
        founder_linkedin: r.linkedin_url,
        company_linkedin: r.company_linkedin_url,
        company_x: r.company_x_url,
        company_github: r.company_github_url,
        deck_cover_url: r.deck_cover_url,
        deck_pages: r.deck_pages,
        deck_uploaded_at: r.deck_uploaded_at,
    }))
}

async fn get_extras(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
) -> Result<Json<ExtrasResponse>, (StatusCode, String)> {
    let user = require_role(&state, bearer.token(), &["STARTUP"]).await?;
    respond(&state, user.id).await
}

#[derive(Deserialize)]
struct PatchBody {
    /// One of the BOOSTS ids.
    field: String,
    /// Empty clears it.
    value: String,
}

/// A link as https://…, on the expected site. None = invalid.
fn normalize_link(raw: &str, hosts: &[&str]) -> Option<String> {
    let v = raw.trim();
    let url = if v.starts_with("http://") || v.starts_with("https://") {
        v.to_string()
    } else {
        format!("https://{v}")
    };
    let host = url.split("://").nth(1)?.split(['/', '?', '#']).next()?.to_ascii_lowercase();
    let host = host.trim_start_matches("www.");
    let ok = hosts.iter().any(|h| host == *h || host.ends_with(&format!(".{h}")));
    (ok && url.len() <= 300 && !url.contains(char::is_whitespace)).then_some(url)
}

async fn patch_extras(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
    Json(body): Json<PatchBody>,
) -> Result<Json<ExtrasResponse>, (StatusCode, String)> {
    let user = require_role(&state, bearer.token(), &["STARTUP"]).await?;
    let value = body.value.trim();
    let bad = |what: &str| (StatusCode::BAD_REQUEST, format!("That doesn't look like a {what} link."));

    match body.field.as_str() {
        "name" => {
            let name: String = value.chars().take(120).collect();
            let (first, last) = match name.split_once(' ') {
                Some((f, l)) => (f.trim().to_string(), l.trim().to_string()),
                None => (name.clone(), String::new()),
            };
            sqlx::query("UPDATE users SET first_name = NULLIF($2, ''), last_name = NULLIF($3, '') WHERE id = $1")
                .bind(user.id)
                .bind(first)
                .bind(last)
                .execute(&state.db)
                .await
                .map_err(internal)?;
        }
        "linkedin" => {
            let v = if value.is_empty() { None } else { Some(normalize_link(value, &["linkedin.com"]).ok_or_else(|| bad("LinkedIn"))?) };
            sqlx::query("UPDATE users SET linkedin_url = $2 WHERE id = $1")
                .bind(user.id)
                .bind(v)
                .execute(&state.db)
                .await
                .map_err(internal)?;
        }
        field @ ("company_linkedin" | "x" | "github") => {
            let (column, hosts, label): (&str, &[&str], &str) = match field {
                "company_linkedin" => ("company_linkedin_url", &["linkedin.com"], "LinkedIn"),
                "x" => ("company_x_url", &["x.com", "twitter.com"], "X"),
                _ => ("company_github_url", &["github.com"], "GitHub"),
            };
            let v = if value.is_empty() { None } else { Some(normalize_link(value, hosts).ok_or_else(|| bad(label))?) };
            // `column` comes from the fixed match above, never from the request.
            sqlx::query(&format!(
                "INSERT INTO profiles (user_id, {column}) VALUES ($1, $2)
                 ON CONFLICT (user_id) DO UPDATE SET {column} = EXCLUDED.{column}, updated_at = now()"
            ))
            .bind(user.id)
            .bind(v)
            .execute(&state.db)
            .await
            .map_err(internal)?;
        }
        _ => return Err((StatusCode::BAD_REQUEST, "Unknown field.".into())),
    }

    let bonus = profile_bonus(&state.db, user.id).await;
    refresh_angel_score(&state.db, user.id, bonus).await;
    respond(&state, user.id).await
}

fn internal(e: sqlx::Error) -> (StatusCode, String) {
    tracing::error!("founder_extras: {e}");
    (StatusCode::INTERNAL_SERVER_ERROR, "internal error".into())
}

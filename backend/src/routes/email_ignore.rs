use std::sync::Arc;

use axum::{
    extract::{Query, State},
    http::{HeaderMap, StatusCode},
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};

use crate::state::AppState;

/// Internal endpoints used by the n8n Email Monitor workflow to check/add
/// senders that should never trigger a Kevin-drafted reply (newsletters,
/// outreach platforms — not real founder/investor/connector deal flow).
pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/check", get(check_ignored))
        .route("/add", post(add_ignored))
}

fn authorized(state: &AppState, headers: &HeaderMap) -> bool {
    let Some(expected) = state
        .internal_automation_token
        .as_deref()
        .filter(|s| !s.is_empty())
    else {
        return false;
    };
    headers
        .get("x-internal-token")
        .and_then(|v| v.to_str().ok())
        == Some(expected)
}

/// Splits a sender address into (full address, address with any `+tag` local-part
/// suffix stripped, domain) — all lowercased. `+tag` stripping matches how
/// Substack-style newsletter platforms vary the local part per campaign while
/// keeping the same underlying sender.
///
/// Accepts either a bare address or a full "Display Name <addr@domain>" header
/// value (what IMAP `from` fields actually contain) and extracts the bracketed
/// address in the latter case.
fn normalize_sender(sender: &str) -> Option<(String, String, String)> {
    let raw = sender.trim();
    let addr = match (raw.find('<'), raw.rfind('>')) {
        (Some(start), Some(end)) if end > start => &raw[start + 1..end],
        _ => raw,
    };
    let s = addr.trim().to_ascii_lowercase();
    let (local, domain) = s.split_once('@')?;
    let local_no_plus = local.split('+').next().unwrap_or(local);
    Some((s.clone(), format!("{local_no_plus}@{domain}"), domain.to_string()))
}

#[derive(Deserialize)]
struct CheckQuery {
    sender: String,
}

#[derive(Serialize)]
struct CheckResponse {
    ignored: bool,
    matched_pattern: Option<String>,
}

async fn check_ignored(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(q): Query<CheckQuery>,
) -> Result<Json<CheckResponse>, StatusCode> {
    if !authorized(&state, &headers) {
        return Err(StatusCode::UNAUTHORIZED);
    }

    let Some((full, prefix_form, domain)) = normalize_sender(&q.sender) else {
        return Ok(Json(CheckResponse {
            ignored: false,
            matched_pattern: None,
        }));
    };

    let row: Option<(String,)> = sqlx::query_as(
        r#"
        SELECT pattern FROM email_monitor_ignore_list
        WHERE (match_type = 'email' AND pattern = $1)
           OR (match_type = 'prefix' AND pattern = $2)
           OR (match_type = 'domain' AND pattern = $3)
        LIMIT 1
        "#,
    )
    .bind(&full)
    .bind(&prefix_form)
    .bind(&domain)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(CheckResponse {
        ignored: row.is_some(),
        matched_pattern: row.map(|(p,)| p),
    }))
}

#[derive(Deserialize)]
struct AddBody {
    pattern: String,
    match_type: String,
    reason: Option<String>,
}

async fn add_ignored(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<AddBody>,
) -> Result<StatusCode, StatusCode> {
    if !authorized(&state, &headers) {
        return Err(StatusCode::UNAUTHORIZED);
    }

    let match_type = body.match_type.to_ascii_lowercase();
    if !matches!(match_type.as_str(), "domain" | "email" | "prefix") {
        return Err(StatusCode::BAD_REQUEST);
    }

    let pattern = body.pattern.trim().to_ascii_lowercase();
    if pattern.is_empty() {
        return Err(StatusCode::BAD_REQUEST);
    }

    sqlx::query(
        r#"
        INSERT INTO email_monitor_ignore_list (pattern, match_type, reason)
        VALUES ($1, $2, $3)
        ON CONFLICT (pattern, match_type) DO NOTHING
        "#,
    )
    .bind(&pattern)
    .bind(&match_type)
    .bind(body.reason.as_deref())
    .execute(&state.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(StatusCode::CREATED)
}

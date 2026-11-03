//! Sign-in for AI apps that connect to Kevin over MCP (see mcp.rs), as the
//! MCP spec asks: OAuth 2.1 with discovery documents, dynamic client
//! registration and PKCE. The app registers itself, sends the user to
//! /mcp-auth/authorize, which hands over to the website's approve page; once
//! the user allows it, the app swaps the code for tokens that reach only that
//! user's data. Users see and disconnect their apps on Connect Kevin.

use std::sync::Arc;

use axum::{
    extract::{Path, Query, RawQuery, State},
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Redirect, Response},
    routing::{delete, get, post},
    Form, Json, Router,
};
use axum_extra::{
    headers::{authorization::Bearer, Authorization},
    TypedHeader,
};
use base64::Engine;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use uuid::Uuid;

use crate::identity::require_user;
use crate::state::AppState;

const ACCESS_TOKEN_SECS: i64 = 3600;
const REFRESH_TOKEN_DAYS: i64 = 90;
const CODE_SECS: i64 = 300;

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/.well-known/oauth-protected-resource", get(protected_resource))
        .route("/.well-known/oauth-protected-resource/mcp", get(protected_resource))
        .route("/.well-known/oauth-authorization-server", get(authorization_server))
        .route("/mcp-auth/register", post(register))
        .route("/mcp-auth/authorize", get(authorize))
        .route("/mcp-auth/client", get(client_info))
        .route("/mcp-auth/approve", post(approve))
        .route("/mcp-auth/token", post(token))
        .route("/mcp-auth/connections", get(connections))
        .route("/mcp-auth/connections/:client_id", delete(disconnect))
}

/// This server's public address, from the request: dev and prod run the
/// same code behind different API domains.
pub(crate) fn base_url(headers: &HeaderMap) -> String {
    let host = headers
        .get("x-forwarded-host")
        .or_else(|| headers.get(header::HOST))
        .and_then(|v| v.to_str().ok())
        .unwrap_or("localhost:4000");
    let local = host.starts_with("localhost") || host.starts_with("127.0.0.1");
    format!("{}://{host}", if local { "http" } else { "https" })
}

fn sha256_hex(s: &str) -> String {
    hex::encode(Sha256::digest(s.as_bytes()))
}

fn random_token(prefix: &str) -> String {
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    format!("{prefix}{}", base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes))
}

fn oauth_error(status: StatusCode, error: &str, description: &str) -> Response {
    (status, Json(json!({ "error": error, "error_description": description }))).into_response()
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

async fn protected_resource(headers: HeaderMap) -> Json<Value> {
    let base = base_url(&headers);
    Json(json!({
        "resource": format!("{base}/mcp"),
        "authorization_servers": [base],
        "bearer_methods_supported": ["header"],
        "resource_name": "Kevin from metatron"
    }))
}

async fn authorization_server(headers: HeaderMap) -> Json<Value> {
    let base = base_url(&headers);
    Json(json!({
        "issuer": base,
        "authorization_endpoint": format!("{base}/mcp-auth/authorize"),
        "token_endpoint": format!("{base}/mcp-auth/token"),
        "registration_endpoint": format!("{base}/mcp-auth/register"),
        "response_types_supported": ["code"],
        "grant_types_supported": ["authorization_code", "refresh_token"],
        "code_challenge_methods_supported": ["S256"],
        "token_endpoint_auth_methods_supported": ["none"],
        "scopes_supported": ["kevin"]
    }))
}

// ---------------------------------------------------------------------------
// Client registration
// ---------------------------------------------------------------------------

fn redirect_uri_allowed(uri: &str) -> bool {
    let Ok(url) = reqwest::Url::parse(uri) else { return false };
    match url.scheme() {
        "https" => true,
        "http" => matches!(url.host_str(), Some("localhost") | Some("127.0.0.1")),
        _ => false,
    }
}

async fn register(State(state): State<Arc<AppState>>, Json(body): Json<Value>) -> Response {
    let redirect_uris: Vec<String> = body["redirect_uris"]
        .as_array()
        .map(|a| a.iter().filter_map(|v| v.as_str()).map(str::to_string).collect())
        .unwrap_or_default();
    if redirect_uris.is_empty() || !redirect_uris.iter().all(|u| redirect_uri_allowed(u)) {
        return oauth_error(StatusCode::BAD_REQUEST, "invalid_redirect_uri", "redirect_uris must be https (or http on localhost)");
    }
    let client_name: String = body["client_name"]
        .as_str()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("AI app")
        .chars()
        .take(100)
        .collect();
    let client_id = random_token("mcpc_");

    let saved = sqlx::query("INSERT INTO mcp_clients (client_id, client_name, redirect_uris) VALUES ($1, $2, $3)")
        .bind(&client_id)
        .bind(&client_name)
        .bind(&redirect_uris)
        .execute(&state.db)
        .await;
    if let Err(e) = saved {
        tracing::error!("mcp client registration failed: {e}");
        return oauth_error(StatusCode::INTERNAL_SERVER_ERROR, "server_error", "could not register");
    }

    (
        StatusCode::CREATED,
        Json(json!({
            "client_id": client_id,
            "client_id_issued_at": chrono::Utc::now().timestamp(),
            "client_name": client_name,
            "redirect_uris": redirect_uris,
            "grant_types": ["authorization_code", "refresh_token"],
            "response_types": ["code"],
            "token_endpoint_auth_method": "none"
        })),
    )
        .into_response()
}

// ---------------------------------------------------------------------------
// Authorization: the website's approve page does the user-facing part
// ---------------------------------------------------------------------------

async fn authorize(State(state): State<Arc<AppState>>, RawQuery(query): RawQuery) -> Redirect {
    Redirect::to(&format!(
        "{}/connect/authorize?{}",
        state.frontend_url,
        query.unwrap_or_default()
    ))
}

#[derive(Deserialize)]
struct ClientQuery {
    client_id: String,
    redirect_uri: String,
}

/// The app's name for the approve page, if the client and redirect are valid.
async fn client_info(State(state): State<Arc<AppState>>, Query(q): Query<ClientQuery>) -> Response {
    match load_client(&state, &q.client_id).await {
        Some((name, uris)) if uris.contains(&q.redirect_uri) => Json(json!({ "client_name": name })).into_response(),
        Some(_) => oauth_error(StatusCode::BAD_REQUEST, "invalid_request", "redirect_uri doesn't match this app"),
        None => oauth_error(StatusCode::BAD_REQUEST, "invalid_client", "unknown app"),
    }
}

async fn load_client(state: &AppState, client_id: &str) -> Option<(String, Vec<String>)> {
    sqlx::query_as("SELECT client_name, redirect_uris FROM mcp_clients WHERE client_id = $1")
        .bind(client_id)
        .fetch_optional(&state.db)
        .await
        .ok()
        .flatten()
}

#[derive(Deserialize)]
struct ApproveRequest {
    client_id: String,
    redirect_uri: String,
    code_challenge: Option<String>,
    code_challenge_method: Option<String>,
    state: Option<String>,
    scope: Option<String>,
    allow: bool,
}

/// The signed-in user allowed (or refused) the app: where to send them back.
async fn approve(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
    Json(req): Json<ApproveRequest>,
) -> Response {
    let user = match require_user(&state, bearer.token()).await {
        Ok(u) => u,
        Err(e) => return e.into_response(),
    };
    let Some((_, uris)) = load_client(&state, &req.client_id).await else {
        return oauth_error(StatusCode::BAD_REQUEST, "invalid_client", "unknown app");
    };
    if !uris.contains(&req.redirect_uri) {
        return oauth_error(StatusCode::BAD_REQUEST, "invalid_request", "redirect_uri doesn't match this app");
    }
    let Ok(mut back) = reqwest::Url::parse(&req.redirect_uri) else {
        return oauth_error(StatusCode::BAD_REQUEST, "invalid_request", "bad redirect_uri");
    };

    let challenge = req.code_challenge.as_deref().map(str::trim).unwrap_or("");
    let method_ok = req.code_challenge_method.as_deref().unwrap_or("S256") == "S256";
    if !req.allow {
        back.query_pairs_mut().append_pair("error", "access_denied");
    } else if challenge.is_empty() || !method_ok {
        back.query_pairs_mut()
            .append_pair("error", "invalid_request")
            .append_pair("error_description", "PKCE with S256 is required");
    } else {
        let code = random_token("mcpcode_");
        let saved = sqlx::query(
            r#"INSERT INTO mcp_auth_codes (code_hash, client_id, user_id, redirect_uri, code_challenge, scope, expires_at)
               VALUES ($1, $2, $3, $4, $5, $6, now() + make_interval(secs => $7))"#,
        )
        .bind(sha256_hex(&code))
        .bind(&req.client_id)
        .bind(user.id)
        .bind(&req.redirect_uri)
        .bind(challenge)
        .bind(req.scope.as_deref().unwrap_or(""))
        .bind(CODE_SECS as f64)
        .execute(&state.db)
        .await;
        if let Err(e) = saved {
            tracing::error!("mcp auth code insert failed: {e}");
            return oauth_error(StatusCode::INTERNAL_SERVER_ERROR, "server_error", "could not approve");
        }
        back.query_pairs_mut().append_pair("code", &code);
    }
    if let Some(s) = req.state.as_deref().filter(|s| !s.is_empty()) {
        back.query_pairs_mut().append_pair("state", s);
    }
    Json(json!({ "redirect": back.to_string() })).into_response()
}

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

async fn issue_tokens(state: &AppState, client_id: &str, user_id: Uuid, scope: &str) -> Result<Value, sqlx::Error> {
    let access = random_token("mka_");
    let refresh = random_token("mkr_");
    sqlx::query(
        r#"INSERT INTO mcp_tokens (token_hash, kind, client_id, user_id, scope, expires_at) VALUES
             ($1, 'access', $3, $4, $5, now() + make_interval(secs => $6)),
             ($2, 'refresh', $3, $4, $5, now() + make_interval(days => $7))"#,
    )
    .bind(sha256_hex(&access))
    .bind(sha256_hex(&refresh))
    .bind(client_id)
    .bind(user_id)
    .bind(scope)
    .bind(ACCESS_TOKEN_SECS as f64)
    .bind(REFRESH_TOKEN_DAYS as i32)
    .execute(&state.db)
    .await?;
    Ok(json!({
        "access_token": access,
        "token_type": "Bearer",
        "expires_in": ACCESS_TOKEN_SECS,
        "refresh_token": refresh,
        "scope": scope
    }))
}

async fn token(State(state): State<Arc<AppState>>, Form(form): Form<HashMap<String, String>>) -> Response {
    let field = |k: &str| form.get(k).map(|s| s.trim()).filter(|s| !s.is_empty());
    let Some(client_id) = field("client_id") else {
        return oauth_error(StatusCode::BAD_REQUEST, "invalid_request", "client_id is required");
    };

    let issued = match field("grant_type") {
        Some("authorization_code") => {
            let (Some(code), Some(verifier), Some(redirect_uri)) =
                (field("code"), field("code_verifier"), field("redirect_uri"))
            else {
                return oauth_error(StatusCode::BAD_REQUEST, "invalid_request", "code, code_verifier and redirect_uri are required");
            };
            // Mark the code used in the same step, so it works once only.
            let row: Option<(String, Uuid, String, String, String)> = sqlx::query_as(
                r#"UPDATE mcp_auth_codes SET used_at = now()
                    WHERE code_hash = $1 AND used_at IS NULL AND expires_at > now()
                    RETURNING client_id, user_id, redirect_uri, code_challenge, scope"#,
            )
            .bind(sha256_hex(code))
            .fetch_optional(&state.db)
            .await
            .ok()
            .flatten();
            let Some((code_client, user_id, code_redirect, challenge, scope)) = row else {
                return oauth_error(StatusCode::BAD_REQUEST, "invalid_grant", "code is invalid or expired");
            };
            let computed = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
            if code_client != client_id || code_redirect != redirect_uri || computed != challenge {
                return oauth_error(StatusCode::BAD_REQUEST, "invalid_grant", "code doesn't match this request");
            }
            issue_tokens(&state, client_id, user_id, &scope).await
        }
        Some("refresh_token") => {
            let Some(refresh) = field("refresh_token") else {
                return oauth_error(StatusCode::BAD_REQUEST, "invalid_request", "refresh_token is required");
            };
            // Refresh tokens rotate: the old one stops working.
            let row: Option<(Uuid, String)> = sqlx::query_as(
                r#"UPDATE mcp_tokens SET revoked_at = now()
                    WHERE token_hash = $1 AND kind = 'refresh' AND client_id = $2
                      AND revoked_at IS NULL AND expires_at > now()
                    RETURNING user_id, scope"#,
            )
            .bind(sha256_hex(refresh))
            .bind(client_id)
            .fetch_optional(&state.db)
            .await
            .ok()
            .flatten();
            let Some((user_id, scope)) = row else {
                return oauth_error(StatusCode::BAD_REQUEST, "invalid_grant", "refresh_token is invalid or expired");
            };
            issue_tokens(&state, client_id, user_id, &scope).await
        }
        _ => return oauth_error(StatusCode::BAD_REQUEST, "unsupported_grant_type", "use authorization_code or refresh_token"),
    };

    match issued {
        Ok(body) => ([(header::CACHE_CONTROL, "no-store")], Json(body)).into_response(),
        Err(e) => {
            tracing::error!("mcp token issue failed: {e}");
            oauth_error(StatusCode::INTERNAL_SERVER_ERROR, "server_error", "could not issue tokens")
        }
    }
}

/// The user a valid access token belongs to.
pub(crate) async fn user_for_access_token(state: &AppState, token: &str) -> Option<Uuid> {
    sqlx::query_scalar(
        r#"UPDATE mcp_tokens SET last_used_at = now()
            WHERE token_hash = $1 AND kind = 'access' AND revoked_at IS NULL AND expires_at > now()
            RETURNING user_id"#,
    )
    .bind(sha256_hex(token))
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten()
}

// ---------------------------------------------------------------------------
// Connected apps, for Connect Kevin
// ---------------------------------------------------------------------------

#[derive(Serialize, sqlx::FromRow)]
struct Connection {
    client_id: String,
    client_name: String,
    connected_at: chrono::DateTime<chrono::Utc>,
    last_used_at: Option<chrono::DateTime<chrono::Utc>>,
}

async fn connections(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
) -> Result<Json<Vec<Connection>>, (StatusCode, String)> {
    let user = require_user(&state, bearer.token()).await?;
    let rows = sqlx::query_as(
        r#"SELECT c.client_id, c.client_name, MIN(t.created_at) AS connected_at, MAX(t.last_used_at) AS last_used_at
             FROM mcp_tokens t JOIN mcp_clients c ON c.client_id = t.client_id
            WHERE t.user_id = $1 AND t.kind = 'refresh' AND t.revoked_at IS NULL AND t.expires_at > now()
            GROUP BY c.client_id, c.client_name
            ORDER BY MIN(t.created_at)"#,
    )
    .bind(user.id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(rows))
}

async fn disconnect(
    State(state): State<Arc<AppState>>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
    Path(client_id): Path<String>,
) -> Result<StatusCode, (StatusCode, String)> {
    let user = require_user(&state, bearer.token()).await?;
    sqlx::query("UPDATE mcp_tokens SET revoked_at = now() WHERE user_id = $1 AND client_id = $2 AND revoked_at IS NULL")
        .bind(user.id)
        .bind(&client_id)
        .execute(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(StatusCode::NO_CONTENT)
}

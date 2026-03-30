use std::sync::Arc;

use axum::{
    extract::{Path, Query, State},
    response::Redirect,
    routing::get,
    Router,
};
use serde::Deserialize;
use serde_json::Value;

use crate::auth;
use crate::settings::OAuthProviderConfig;
use crate::state::AppState;

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/oauth/:provider/authorize", get(authorize))
        .route("/oauth/:provider/callback", get(callback))
}

#[derive(Deserialize)]
struct OAuthCallbackQuery {
    code: Option<String>,
    state: Option<String>,
    // OAuth providers redirect back with `error` when the user denies consent, etc.
    error: Option<String>,
}

#[derive(Clone, Debug)]
struct ProviderSpec {
    auth_url: &'static str,
    token_url: &'static str,
    userinfo_url: &'static str,
    scope: &'static str,
}

fn provider_spec(provider: &str) -> Option<ProviderSpec> {
    match provider {
        "google" => Some(ProviderSpec {
            auth_url: "https://accounts.google.com/o/oauth2/v2/auth",
            token_url: "https://oauth2.googleapis.com/token",
            userinfo_url: "https://openidconnect.googleapis.com/v1/userinfo",
            scope: "openid email profile",
        }),
        "linkedin" => Some(ProviderSpec {
            auth_url: "https://www.linkedin.com/oauth/v2/authorization",
            token_url: "https://www.linkedin.com/oauth/v2/accessToken",
            userinfo_url: "https://api.linkedin.com/v2/userinfo",
            scope: "openid email profile",
        }),
        "github" => Some(ProviderSpec {
            auth_url: "https://github.com/login/oauth/authorize",
            token_url: "https://github.com/login/oauth/access_token",
            userinfo_url: "https://api.github.com/user",
            scope: "user:email",
        }),
        _ => None,
    }
}

fn percent_encode(input: &str) -> String {
    // RFC 3986 unreserved: ALPHA / DIGIT / "-" / "." / "_" / "~"
    let mut out = String::new();
    for b in input.as_bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                out.push(*b as char)
            }
            _ => out.push_str(&format!("%{:02X}", b)),
        }
    }
    out
}

fn provider_config<'a>(
    state: &'a AppState,
    provider: &str,
) -> Option<&'a OAuthProviderConfig> {
    match provider {
        "google" => state.oauth_google.as_ref(),
        "linkedin" => state.oauth_linkedin.as_ref(),
        "github" => state.oauth_github.as_ref(),
        _ => None,
    }
}

async fn authorize(
    State(state): State<Arc<AppState>>,
    Path(provider): Path<String>,
) -> Result<Redirect, (axum::http::StatusCode, String)> {
    let provider_lc = provider.to_ascii_lowercase();
    let spec = provider_spec(&provider_lc).ok_or((
        axum::http::StatusCode::BAD_REQUEST,
        "unknown oauth provider".to_string(),
    ))?;

    let cfg = provider_config(&state, &provider_lc).ok_or((
        axum::http::StatusCode::BAD_REQUEST,
        format!("oauth provider not configured: {}", provider_lc),
    ))?;

    let csrf_state = auth::issue_oauth_state(&state, &provider_lc).map_err(|_| {
        (
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            "could not issue oauth state".to_string(),
        )
    })?;

    let redirect_uri = format!(
        "{}/auth/oauth/{}/callback",
        state.public_base_url, provider_lc
    );

    let authorization_url = format!(
        "{}?client_id={}&redirect_uri={}&response_type=code&scope={}&state={}",
        spec.auth_url,
        percent_encode(&cfg.client_id),
        percent_encode(&redirect_uri),
        percent_encode(spec.scope),
        percent_encode(&csrf_state),
    );

    // 302 redirect handled by Redirect::to()
    Ok(Redirect::to(&authorization_url))
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
}

async fn callback(
    State(state): State<Arc<AppState>>,
    Path(provider): Path<String>,
    Query(q): Query<OAuthCallbackQuery>,
) -> Result<Redirect, (axum::http::StatusCode, String)> {
    let provider_lc = provider.to_ascii_lowercase();
    let spec = provider_spec(&provider_lc).ok_or((
        axum::http::StatusCode::BAD_REQUEST,
        "unknown oauth provider".to_string(),
    ))?;

    let cfg = provider_config(&state, &provider_lc).ok_or((
        axum::http::StatusCode::BAD_REQUEST,
        format!("oauth provider not configured: {}", provider_lc),
    ))?;

    let frontend_base = state.frontend_url.trim_end_matches('/');

    if q.error.is_some() {
        let redirect = format!("{}/login?error=oauth_failed", frontend_base);
        return Ok(Redirect::to(&redirect));
    }

    let code = match q.code.as_deref() {
        Some(c) => c,
        None => {
            let redirect = format!("{}/login?error=oauth_failed", frontend_base);
            return Ok(Redirect::to(&redirect));
        }
    };

    let state_param = match q.state.as_deref() {
        Some(s) => s,
        None => {
            let redirect = format!("{}/login?error=oauth_failed", frontend_base);
            return Ok(Redirect::to(&redirect));
        }
    };

    auth::verify_oauth_state(&state, state_param, &provider_lc).map_err(|_| {
        (
            axum::http::StatusCode::UNAUTHORIZED,
            "invalid oauth state".to_string(),
        )
    })?;

    let redirect_uri = format!(
        "{}/auth/oauth/{}/callback",
        state.public_base_url, provider_lc
    );

    // 1) Exchange code => access token
    let access_token = match provider_lc.as_str() {
        "github" => {
            let resp = state
                .http_client
                .post(spec.token_url)
                .header("Accept", "application/json")
                .form(&[
                    ("client_id", cfg.client_id.as_str()),
                    ("client_secret", cfg.client_secret.as_str()),
                    ("code", code),
                    ("redirect_uri", redirect_uri.as_str()),
                ])
                .send()
                .await
                .map_err(|_| {
                    (
                        axum::http::StatusCode::BAD_GATEWAY,
                        "token exchange failed".to_string(),
                    )
                })?;

            let tr: TokenResponse = resp
                .json()
                .await
                .map_err(|_| {
                    (
                        axum::http::StatusCode::BAD_GATEWAY,
                        "token exchange parse failed".to_string(),
                    )
                })?;
            tr.access_token
        }
        _ => {
            let grant_type = "authorization_code";
            let resp = state
                .http_client
                .post(spec.token_url)
                .form(&[
                    ("grant_type", grant_type),
                    ("code", code),
                    ("redirect_uri", redirect_uri.as_str()),
                    ("client_id", cfg.client_id.as_str()),
                    ("client_secret", cfg.client_secret.as_str()),
                ])
                .send()
                .await
                .map_err(|_| {
                    (
                        axum::http::StatusCode::BAD_GATEWAY,
                        "token exchange failed".to_string(),
                    )
                })?;

            let tr: TokenResponse = resp
                .json()
                .await
                .map_err(|_| {
                    (
                        axum::http::StatusCode::BAD_GATEWAY,
                        "token exchange parse failed".to_string(),
                    )
                })?;
            tr.access_token
        }
    };

    // 2) Fetch user identity and link/create oauth user
    let (provider_uid, email_opt) = match provider_lc.as_str() {
        "google" => {
            let resp = state
                .http_client
                .get(spec.userinfo_url)
                .bearer_auth(&access_token)
                .send()
                .await
                .map_err(|_| {
                    (
                        axum::http::StatusCode::BAD_GATEWAY,
                        "userinfo fetch failed".to_string(),
                    )
                })?;
            let v: Value = resp.json().await.map_err(|_| {
                (
                    axum::http::StatusCode::BAD_GATEWAY,
                    "userinfo parse failed".to_string(),
                )
            })?;
            let provider_uid = v
                .get("sub")
                .and_then(|s| s.as_str())
                .ok_or((
                    axum::http::StatusCode::BAD_GATEWAY,
                    "userinfo missing sub".to_string(),
                ))?
                .to_string();
            let email_opt = v.get("email").and_then(|s| s.as_str()).map(|s| s.to_string());
            (provider_uid, email_opt)
        }
        "linkedin" => {
            let resp = state
                .http_client
                .get(spec.userinfo_url)
                .bearer_auth(&access_token)
                .send()
                .await
                .map_err(|_| {
                    (
                        axum::http::StatusCode::BAD_GATEWAY,
                        "userinfo fetch failed".to_string(),
                    )
                })?;
            let v: Value = resp.json().await.map_err(|_| {
                (
                    axum::http::StatusCode::BAD_GATEWAY,
                    "userinfo parse failed".to_string(),
                )
            })?;

            let provider_uid = v
                .get("id")
                .or_else(|| v.get("sub"))
                .and_then(|s| s.as_str())
                .ok_or((
                    axum::http::StatusCode::BAD_GATEWAY,
                    "userinfo missing id".to_string(),
                ))?
                .to_string();

            let email_opt = v
                .get("emailAddress")
                .or_else(|| v.get("email"))
                .and_then(|s| s.as_str())
                .map(|s| s.to_string());

            (provider_uid, email_opt)
        }
        "github" => {
            // Primary call to /user + secondary call to /user/emails.
            let user_resp = state
                .http_client
                .get(spec.userinfo_url)
                .bearer_auth(&access_token)
                .header("User-Agent", "metatron-platform")
                .send()
                .await
                .map_err(|_| {
                    (
                        axum::http::StatusCode::BAD_GATEWAY,
                        "github user fetch failed".to_string(),
                    )
                })?;

            let user_status = user_resp.status();
            let user_body = user_resp.text().await.map_err(|_| {
                (
                    axum::http::StatusCode::BAD_GATEWAY,
                    "github user parse read failed".to_string(),
                )
            })?;
            let user_v: Value = serde_json::from_str(&user_body).map_err(|_| {
                let snippet: String = user_body.chars().take(500).collect();
                (
                    axum::http::StatusCode::BAD_GATEWAY,
                    format!(
                        "github user parse failed: status={}, body={}",
                        user_status, snippet
                    ),
                )
            })?;

            let provider_uid = user_v
                .get("id")
                .and_then(|v| v.as_u64())
                .map(|id| id.to_string())
                .or_else(|| user_v.get("login").and_then(|s| s.as_str()).map(|s| s.to_string()))
                .ok_or((
                    axum::http::StatusCode::BAD_GATEWAY,
                    "github user missing id/login".to_string(),
                ))?;

            let emails_resp = state
                .http_client
                .get("https://api.github.com/user/emails")
                .bearer_auth(&access_token)
                .header("User-Agent", "metatron-platform")
                .send()
                .await
                .map_err(|_| {
                    (
                        axum::http::StatusCode::BAD_GATEWAY,
                        "github emails fetch failed".to_string(),
                    )
                })?;

            #[derive(Deserialize)]
            struct GithubEmail {
                email: String,
                primary: bool,
                verified: bool,
            }

            let emails_status = emails_resp.status();
            let emails_body = emails_resp.text().await.map_err(|_| {
                (
                    axum::http::StatusCode::BAD_GATEWAY,
                    "github emails parse read failed".to_string(),
                )
            })?;
            let emails: Vec<GithubEmail> =
                serde_json::from_str(&emails_body).map_err(|_| {
                    let snippet: String = emails_body.chars().take(500).collect();
                    (
                        axum::http::StatusCode::BAD_GATEWAY,
                        format!(
                            "github emails parse failed: status={}, body={}",
                            emails_status, snippet
                        ),
                    )
                })?;

            let primary_verified = emails
                .iter()
                .find(|e| e.primary && e.verified)
                .map(|e| e.email.clone());
            let verified_fallback = emails
                .iter()
                .find(|e| e.verified)
                .map(|e| e.email.clone());

            (provider_uid, primary_verified.or(verified_fallback))
        }
        _ => {
            return Err((
                axum::http::StatusCode::BAD_REQUEST,
                "unsupported provider".to_string(),
            ));
        }
    };

    let email_ref = email_opt.as_deref();
    let (user_id, is_new) = auth::find_or_create_oauth_user(
        &state.db,
        &provider_lc,
        &provider_uid,
        email_ref,
        &access_token,
    )
    .await
    .map_err(|_| {
        (
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            "oauth user link failed".to_string(),
        )
    })?;

    // Issue a platform JWT (need the role for frontend redirects).
    let role: String = sqlx::query_scalar("SELECT role::text FROM users WHERE id = $1")
        .bind(user_id)
        .fetch_one(&state.db)
        .await
        .map_err(|_| {
            (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                "could not load user role".to_string(),
            )
        })?;

    let jwt = auth::issue_jwt(&state, user_id, &role).map_err(|_| {
        (
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            "could not issue jwt".to_string(),
        )
    })?;

    let frontend_base = state.frontend_url.trim_end_matches('/');
    let new_str = if is_new { "true" } else { "false" };
    let redirect = format!(
        "{}/auth/callback?token={}&new={}",
        frontend_base,
        percent_encode(&jwt),
        new_str
    );

    Ok(Redirect::to(&redirect))
}


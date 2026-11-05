//! The refresh token travels as an HttpOnly cookie, so page scripts can't
//! read it. Access tokens stay in the JSON body (20-minute Bearer tokens).
//!
//! Handlers keep returning `refresh_token` in their JSON; `middleware`
//! copies it into the cookie and, for browser requests (they send `Origin`),
//! removes it from the body. Scripts and tests without `Origin` still get it
//! in the body.

use axum::body::Body;
use axum::extract::Request;
use axum::http::{header, HeaderMap, HeaderValue};
use axum::middleware::Next;
use axum::response::Response;
use serde_json::Value;

use crate::auth::SESSION_MAX_SECS;
use crate::state::AppState;

pub const NAME: &str = "metatron_rt";

/// Set by a handler to keep `refresh_token` in a browser's JSON body; the
/// middleware removes it before the response leaves.
pub const KEEP_BODY_HEADER: &str = "x-metatron-keep-refresh";

fn cookie(value: &str, max_age: i64) -> HeaderValue {
    // Host-only on the API host; Strict, so other sites can never send it.
    HeaderValue::from_str(&format!(
        "{NAME}={value}; HttpOnly; Secure; SameSite=Strict; Path=/auth; Max-Age={max_age}"
    ))
    .unwrap_or_else(|_| HeaderValue::from_static(""))
}

pub fn set(value: &str) -> HeaderValue {
    cookie(value, SESSION_MAX_SECS)
}

pub fn clear() -> HeaderValue {
    cookie("", 0)
}

pub fn read(headers: &HeaderMap) -> Option<String> {
    headers
        .get_all(header::COOKIE)
        .iter()
        .filter_map(|v| v.to_str().ok())
        .flat_map(|v| v.split(';'))
        .filter_map(|p| p.trim().strip_prefix(&format!("{NAME}=")).map(str::to_string))
        .find(|v| !v.is_empty())
}

/// Only our own frontend may use the cookie (other metatron.id subdomains
/// are same-site and would otherwise send it too).
pub fn origin_allowed(state: &AppState, headers: &HeaderMap) -> bool {
    let Some(origin) = headers.get(header::ORIGIN).and_then(|v| v.to_str().ok()) else {
        return false;
    };
    origin == state.frontend_url || origin == "http://localhost:3000"
}

pub async fn middleware(req: Request, next: Next) -> Response {
    let from_browser = req.headers().contains_key(header::ORIGIN);
    let mut res = next.run(req).await;
    let keep_body = res.headers_mut().remove(KEEP_BODY_HEADER).is_some_and(|v| v == "1");

    let is_json = res
        .headers()
        .get(header::CONTENT_TYPE)
        .map(|v| v.as_bytes().starts_with(b"application/json"))
        .unwrap_or(false);
    if !is_json {
        return res;
    }
    let (mut parts, body) = res.into_parts();
    let Ok(bytes) = axum::body::to_bytes(body, 1024 * 1024).await else {
        return Response::from_parts(parts, Body::empty());
    };
    let Ok(mut value) = serde_json::from_slice::<Value>(&bytes) else {
        return Response::from_parts(parts, Body::from(bytes));
    };
    let Some(token) = value.get("refresh_token").and_then(|v| v.as_str()).map(str::to_string) else {
        return Response::from_parts(parts, Body::from(bytes));
    };

    parts.headers.append(header::SET_COOKIE, set(&token));
    if from_browser && !keep_body {
        if let Some(obj) = value.as_object_mut() {
            obj.remove("refresh_token");
        }
    }
    parts.headers.remove(header::CONTENT_LENGTH);
    let body = serde_json::to_vec(&value).unwrap_or_default();
    Response::from_parts(parts, Body::from(body))
}

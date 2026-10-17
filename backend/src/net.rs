//! Server-side fetching of user-supplied URLs (deck links, company websites).
//! Every such fetch goes through `safe_get`: http(s) only, no internal
//! addresses, redirects only to public hostnames, and a hard size cap.

use std::net::IpAddr;
use std::time::Duration;

/// True for addresses a server-side fetch must never reach (loopback, private,
/// link-local, CGNAT, unique-local).
pub fn is_internal_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v) => {
            let o = v.octets();
            v.is_loopback()
                || v.is_private()
                || v.is_link_local()
                || v.is_unspecified()
                || v.is_broadcast()
                || (o[0] == 100 && (o[1] & 0xc0) == 64)
        }
        IpAddr::V6(v) => {
            let s0 = v.segments()[0];
            v.is_loopback() || v.is_unspecified() || (s0 & 0xfe00) == 0xfc00 || (s0 & 0xffc0) == 0xfe80
        }
    }
}

pub struct Fetched {
    pub bytes: Vec<u8>,
    /// URL after redirects (for resolving relative links in a fetched page).
    pub final_url: reqwest::Url,
    pub content_type: String,
}

/// GETs a public URL. `allow_http` permits plain http (company websites);
/// deck links stay https-only. Errors are short and user-facing.
pub async fn safe_get(url: &str, max_bytes: usize, allow_http: bool) -> Result<Fetched, String> {
    let url = reqwest::Url::parse(url).map_err(|_| "That isn't a valid web address.".to_string())?;
    let scheme_ok = url.scheme() == "https" || (allow_http && url.scheme() == "http");
    if !scheme_ok {
        return Err("Only secure (https) links can be read.".into());
    }
    let host = url.host_str().ok_or("That isn't a valid web address.")?.to_string();
    let port = url.port_or_known_default().unwrap_or(443);
    let addrs: Vec<_> = tokio::net::lookup_host((host.as_str(), port))
        .await
        .map_err(|_| "Couldn't reach that address.".to_string())?
        .collect();
    if addrs.is_empty() || addrs.iter().any(|a| is_internal_ip(a.ip())) {
        return Err("Couldn't reach that address.".into());
    }

    // Follow ordinary redirects, but only to public hostnames — never a raw IP
    // or localhost.
    let policy = reqwest::redirect::Policy::custom(move |attempt| {
        let scheme = attempt.url().scheme();
        let ok = (scheme == "https" || (allow_http && scheme == "http"))
            && attempt.url().host_str().is_some_and(|h| {
                h != "localhost" && !h.starts_with('[') && h.parse::<IpAddr>().is_err()
            });
        if attempt.previous().len() >= 5 || !ok {
            attempt.stop()
        } else {
            attempt.follow()
        }
    });
    let client = reqwest::Client::builder()
        .redirect(policy)
        .timeout(Duration::from_secs(30))
        .user_agent("metatron-bot/1.0 (+https://platform.metatron.id)")
        .build()
        .map_err(|_| "Couldn't download that.".to_string())?;
    let resp = client.get(url).send().await.map_err(|_| "Couldn't download that.".to_string())?;
    if !resp.status().is_success() {
        return Err(format!("Couldn't download that (HTTP {}).", resp.status().as_u16()));
    }
    if resp.content_length().is_some_and(|n| n as usize > max_bytes) {
        return Err("That file is too large.".into());
    }
    let final_url = resp.url().clone();
    let content_type = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_ascii_lowercase();
    let bytes = resp.bytes().await.map_err(|_| "Couldn't download that.".to_string())?;
    if bytes.len() > max_bytes {
        return Err("That file is too large.".into());
    }
    Ok(Fetched { bytes: bytes.to_vec(), final_url, content_type })
}

/// Raster image formats we accept for logos and serve back. SVG is never
/// accepted: it can carry script.
pub fn sniff_image(bytes: &[u8]) -> Option<(&'static str, &'static str)> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some(("png", "image/png"))
    } else if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some(("jpg", "image/jpeg"))
    } else if bytes.len() > 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some(("webp", "image/webp"))
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        Some(("gif", "image/gif"))
    } else if bytes.starts_with(&[0, 0, 1, 0]) {
        Some(("ico", "image/x-icon"))
    } else {
        None
    }
}

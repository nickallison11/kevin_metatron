//! Finding a company's logo on its own website, so users don't have to
//! upload one. Order of preference: the site's apple-touch-icon (usually a
//! clean 180px square), then the largest declared <link rel="icon">, then the
//! conventional /apple-touch-icon.png and /favicon.ico. Raster formats only.

use crate::net::{safe_get, sniff_image};

const MAX_PAGE_BYTES: usize = 1024 * 1024;
const MAX_ICON_BYTES: usize = 1024 * 1024;

/// Free email / personal domains: a logo from these would be Gmail's, not the user's.
const PERSONAL_DOMAINS: &[&str] = &[
    "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "msn.com",
    "yahoo.com", "ymail.com", "icloud.com", "me.com", "mac.com", "aol.com", "proton.me",
    "protonmail.com", "gmx.com", "gmx.net", "gmx.de", "web.de", "mail.com", "zoho.com",
    "yandex.com", "yandex.ru", "qq.com", "163.com", "telkomsa.net", "mweb.co.za",
    "webmail.co.za", "vodamail.co.za",
];

/// A website to look for a logo on: the user's own website if they gave one,
/// otherwise their email's domain when it's a company domain.
pub fn logo_source_site(website: Option<&str>, email: &str) -> Option<String> {
    if let Some(w) = website.map(str::trim).filter(|w| !w.is_empty()) {
        return Some(if w.starts_with("http://") || w.starts_with("https://") { w.to_string() } else { format!("https://{w}") });
    }
    let domain = email.rsplit_once('@')?.1.trim().to_ascii_lowercase();
    if domain.is_empty() || PERSONAL_DOMAINS.contains(&domain.as_str()) || domain.ends_with(".local") {
        return None;
    }
    Some(format!("https://{domain}"))
}

/// Bare host for messages ("We couldn't find a logo on acme.com").
pub fn display_host(site: &str) -> String {
    reqwest::Url::parse(site)
        .ok()
        .and_then(|u| u.host_str().map(|h| h.trim_start_matches("www.").to_string()))
        .unwrap_or_else(|| site.to_string())
}

/// Value of `name="…"` / `name='…'` inside one tag (tag already lowercased
/// for matching; values are read from the original-case tag at the same offsets).
fn attr<'a>(tag_lower: &str, tag: &'a str, name: &str) -> Option<&'a str> {
    let key = format!("{name}=");
    let mut from = 0;
    while let Some(pos) = tag_lower[from..].find(&key) {
        let start = from + pos;
        // Must be a whole attribute name (preceded by whitespace).
        if start > 0 && !tag_lower.as_bytes()[start - 1].is_ascii_whitespace() {
            from = start + key.len();
            continue;
        }
        let v = start + key.len();
        let quote = tag.as_bytes().get(v).copied()?;
        if quote == b'"' || quote == b'\'' {
            let end = tag[v + 1..].find(quote as char)? + v + 1;
            return Some(&tag[v + 1..end]);
        }
        let end = tag[v..].find(|c: char| c.is_ascii_whitespace() || c == '>').map(|e| e + v).unwrap_or(tag.len());
        return Some(&tag[v..end]);
    }
    None
}

/// Icon candidates declared in the page's <link> tags, best first.
fn declared_icons(html: &str) -> Vec<String> {
    let lower = html.to_ascii_lowercase();
    let mut found: Vec<(u32, String)> = Vec::new();
    let mut from = 0;
    while let Some(pos) = lower[from..].find("<link") {
        let start = from + pos;
        let end = lower[start..].find('>').map(|e| start + e + 1).unwrap_or(lower.len());
        from = end;
        let (tl, t) = (&lower[start..end], &html[start..end]);
        let Some(rel) = attr(tl, t, "rel").map(str::to_ascii_lowercase) else { continue };
        let Some(href) = attr(tl, t, "href") else { continue };
        if href.to_ascii_lowercase().ends_with(".svg") || attr(tl, t, "type").is_some_and(|ty| ty.contains("svg")) {
            continue;
        }
        let size: u32 = attr(tl, t, "sizes")
            .and_then(|s| s.split(|c: char| c == 'x' || c == 'X').next()?.trim().parse().ok())
            .unwrap_or(0);
        let rank = if rel.contains("apple-touch-icon") {
            100_000 + size
        } else if rel.split_whitespace().any(|r| r == "icon") {
            size.max(1)
        } else {
            continue;
        };
        found.push((rank, href.trim().to_string()));
    }
    found.sort_by(|a, b| b.0.cmp(&a.0));
    found.into_iter().map(|(_, h)| h).collect()
}

/// Tries to find a usable logo on `site`. Returns the image bytes, file
/// extension and MIME type, or a short reason.
pub async fn find_logo(site: &str) -> Result<(Vec<u8>, &'static str, &'static str), String> {
    let page = safe_get(site, MAX_PAGE_BYTES, true).await?;
    let base = page.final_url.clone();
    let html = String::from_utf8_lossy(&page.bytes);

    let mut candidates: Vec<reqwest::Url> = declared_icons(&html)
        .into_iter()
        .filter_map(|h| base.join(&h).ok())
        .collect();
    for fallback in ["/apple-touch-icon.png", "/favicon.ico"] {
        if let Ok(u) = base.join(fallback) {
            candidates.push(u);
        }
    }

    for url in candidates.into_iter().take(6) {
        let Ok(icon) = safe_get(url.as_str(), MAX_ICON_BYTES, true).await else { continue };
        if let Some((ext, mime)) = sniff_image(&icon.bytes) {
            // Skip 16px favicons when they're PNGs we can measure; a blurry logo
            // is worse than asking the user to upload one.
            if mime == "image/png" && icon.bytes.len() > 24 {
                let w = u32::from_be_bytes([icon.bytes[16], icon.bytes[17], icon.bytes[18], icon.bytes[19]]);
                if w < 48 {
                    continue;
                }
            }
            return Ok((icon.bytes, ext, mime));
        }
    }
    Err("No logo found".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prefers_apple_touch_icon_then_largest_icon() {
        let html = r#"<head><link rel="icon" href="/fav-32.png" sizes="32x32"><link rel="icon" sizes="192x192" href="/fav-192.png"><link rel='apple-touch-icon' href='/apple.png'><link rel="icon" href="/logo.svg" type="image/svg+xml"><link rel="stylesheet" href="/a.css"></head>"#;
        assert_eq!(declared_icons(html), vec!["/apple.png", "/fav-192.png", "/fav-32.png"]);
    }

    #[test]
    fn email_domain_used_only_for_company_domains() {
        assert_eq!(logo_source_site(None, "nick@kopanocapital.com").as_deref(), Some("https://kopanocapital.com"));
        assert_eq!(logo_source_site(None, "someone@gmail.com"), None);
        assert_eq!(logo_source_site(Some("acme.io"), "x@gmail.com").as_deref(), Some("https://acme.io"));
    }
}

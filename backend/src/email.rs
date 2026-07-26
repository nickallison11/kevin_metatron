use reqwest::Client;
use serde_json::json;

/// Derives a plaintext fallback from one of our own HTML templates (not a
/// general-purpose HTML parser — relies on the tag vocabulary `shell_html`
/// and friends actually emit). Keeps links readable as "label (href)" since
/// plaintext clients can't render the anchor.
fn html_to_text(html: &str) -> String {
    let mut with_links = String::with_capacity(html.len());
    let mut rest = html;
    while let Some(a_start) = rest.find("<a ") {
        with_links.push_str(&rest[..a_start]);
        let after_a = &rest[a_start..];
        let Some(tag_end) = after_a.find('>') else {
            with_links.push_str(after_a);
            rest = "";
            break;
        };
        let open_tag = &after_a[..=tag_end];
        let href = open_tag
            .find("href=\"")
            .and_then(|i| {
                let start = i + 6;
                open_tag[start..].find('"').map(|end| &open_tag[start..start + end])
            })
            .unwrap_or("");
        let after_open = &after_a[tag_end + 1..];
        let Some(close_idx) = after_open.find("</a>") else {
            with_links.push_str(after_a);
            rest = "";
            break;
        };
        let label = &after_open[..close_idx];
        if href.is_empty() || href == label {
            with_links.push_str(label);
        } else {
            with_links.push_str(label);
            with_links.push_str(" (");
            with_links.push_str(href);
            with_links.push(')');
        }
        rest = &after_open[close_idx + 4..];
    }
    with_links.push_str(rest);

    let mut normalized = with_links;
    for tag in ["<br>", "<br/>", "<br />", "</p>", "</div>", "</h1>", "</h2>", "</h3>", "</li>"] {
        normalized = normalized.replace(tag, "\n");
    }

    let mut text = String::with_capacity(normalized.len());
    let mut in_tag = false;
    for c in normalized.chars() {
        match c {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => text.push(c),
            _ => {}
        }
    }

    let decoded = text
        .replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'");

    decoded
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .collect::<Vec<_>>()
        .join("\n\n")
}

pub async fn send_email_with_headers(
    http_client: &Client,
    api_key: Option<&str>,
    from: &str,
    to: &str,
    subject: &str,
    html: &str,
    headers: serde_json::Value,
) -> Option<String> {
    let api_key = match api_key {
        Some(v) if !v.trim().is_empty() => v.trim(),
        _ => {
            tracing::warn!("email: RESEND_API_KEY missing; skipping email to {}", to);
            return None;
        }
    };

    if to.trim().is_empty() {
        tracing::warn!("email: empty recipient; skipping subject '{}'", subject);
        return None;
    }

    let payload = json!({
        "from": from,
        "to": [to],
        "subject": subject,
        "html": html,
        "text": html_to_text(html),
        "headers": headers
    });

    match http_client
        .post("https://api.resend.com/emails")
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(&payload)
        .send()
        .await
    {
        Ok(resp) => {
            if resp.status().is_success() {
                let body: serde_json::Value = resp.json().await.unwrap_or_default();
                body.get("id").and_then(|v| v.as_str()).map(|s| s.to_string())
            } else {
                let status = resp.status();
                let body = resp.text().await.unwrap_or_default();
                tracing::warn!(
                    "email: resend failed status={} to={} subject='{}' body={}",
                    status, to, subject,
                    body.chars().take(300).collect::<String>()
                );
                None
            }
        }
        Err(e) => {
            tracing::warn!("email: resend request error to={} subject='{}': {}", to, subject, e);
            None
        }
    }
}

pub async fn send_email(
    http_client: &Client,
    api_key: Option<&str>,
    from: &str,
    to: &str,
    subject: &str,
    html: &str,
) {
    let api_key = match api_key {
        Some(v) if !v.trim().is_empty() => v.trim(),
        _ => {
            tracing::warn!("email: RESEND_API_KEY missing; skipping email to {}", to);
            return;
        }
    };

    if to.trim().is_empty() {
        tracing::warn!("email: empty recipient; skipping subject '{}'", subject);
        return;
    }

    let payload = json!({
        "from": from,
        "to": [to],
        "subject": subject,
        "html": html,
        "text": html_to_text(html)
    });

    match http_client
        .post("https://api.resend.com/emails")
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(&payload)
        .send()
        .await
    {
        Ok(resp) => {
            if !resp.status().is_success() {
                let status = resp.status();
                let body = resp.text().await.unwrap_or_default();
                tracing::warn!(
                    "email: resend failed status={} to={} subject='{}' body={}",
                    status,
                    to,
                    subject,
                    body.chars().take(300).collect::<String>()
                );
            }
        }
        Err(e) => {
            tracing::warn!(
                "email: resend request error to={} subject='{}': {}",
                to,
                subject,
                e
            );
        }
    }
}

/// A recipient counts as known-deliverable once they have at least one prior
/// tracked send that never bounced. Brand-new recipients (zero prior sends)
/// and anyone with a bounce on record get the plaintext-only version instead
/// of rich HTML — the riskiest send is the very first one to an address we
/// have no delivery history for, so that's the one that stays lightweight
/// until there's positive evidence the address is good.
async fn is_known_deliverable(db: &sqlx::PgPool, user_id: uuid::Uuid) -> bool {
    let counts = sqlx::query_as::<_, (i64, i64)>(
        r#"SELECT COUNT(*), COUNT(*) FILTER (WHERE bounced_at IS NOT NULL)
           FROM email_send_log WHERE user_id = $1"#,
    )
    .bind(user_id)
    .fetch_one(db)
    .await;

    match counts {
        Ok((total, bounced)) => total > 0 && bounced == 0,
        Err(_) => false,
    }
}

/// Like `send_email`, but also logs the send to `email_send_log` (recipient,
/// subject, resend_message_id, and the derived plaintext body) so a later
/// bounce webhook can find the row and — for transient bounces — retry with
/// the stored plaintext body via `send_plaintext_email`.
///
/// Sends plaintext-only, regardless of `html`, until `is_known_deliverable`
/// confirms this recipient has a clean send on record.
pub async fn send_tracked_email(
    http_client: &Client,
    api_key: Option<&str>,
    from: &str,
    to: &str,
    subject: &str,
    html: &str,
    db: &sqlx::PgPool,
    user_id: uuid::Uuid,
    email_type: &str,
) {
    let text = html_to_text(html);
    let send_rich = is_known_deliverable(db, user_id).await;

    let message_id = if send_rich {
        send_email_with_headers(http_client, api_key, from, to, subject, html, json!({})).await
    } else {
        send_plaintext_email(http_client, api_key, from, to, subject, &text).await
    };

    if let Err(e) = sqlx::query(
        r#"INSERT INTO email_send_log
            (user_id, email_type, resend_message_id, recipient_email, subject, plaintext_body, sent_as_html)
           VALUES ($1, $2, $3, $4, $5, $6, $7)"#,
    )
    .bind(user_id)
    .bind(email_type)
    .bind(message_id.as_deref())
    .bind(to)
    .bind(subject)
    .bind(&text)
    .bind(send_rich)
    .execute(db)
    .await
    {
        tracing::warn!("email_send_log insert failed for {email_type}: {e}");
    }
}

/// Sends a plaintext-only email (no `html` field at all) via Resend. Used to
/// retry a transiently-bounced rich-HTML send with a lighter version that's
/// less likely to trip the same content/size filter.
pub async fn send_plaintext_email(
    http_client: &Client,
    api_key: Option<&str>,
    from: &str,
    to: &str,
    subject: &str,
    text: &str,
) -> Option<String> {
    let api_key = match api_key {
        Some(v) if !v.trim().is_empty() => v.trim(),
        _ => {
            tracing::warn!("email: RESEND_API_KEY missing; skipping plaintext retry to {}", to);
            return None;
        }
    };

    if to.trim().is_empty() {
        tracing::warn!("email: empty recipient; skipping plaintext retry subject '{}'", subject);
        return None;
    }

    let payload = json!({
        "from": from,
        "to": [to],
        "subject": subject,
        "text": text
    });

    match http_client
        .post("https://api.resend.com/emails")
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(&payload)
        .send()
        .await
    {
        Ok(resp) => {
            if resp.status().is_success() {
                let body: serde_json::Value = resp.json().await.unwrap_or_default();
                body.get("id").and_then(|v| v.as_str()).map(|s| s.to_string())
            } else {
                let status = resp.status();
                let body = resp.text().await.unwrap_or_default();
                tracing::warn!(
                    "email: plaintext retry failed status={} to={} subject='{}' body={}",
                    status,
                    to,
                    subject,
                    body.chars().take(300).collect::<String>()
                );
                None
            }
        }
        Err(e) => {
            tracing::warn!(
                "email: plaintext retry request error to={} subject='{}': {}",
                to,
                subject,
                e
            );
            None
        }
    }
}

fn shell_html(title: &str, body: &str) -> String {
    format!(
        r#"
<div style="margin:0;padding:0;background:#0a0a0f;color:#e8e8ed;font-family:'DM Sans',Arial,sans-serif;">
  <div style="max-width:620px;margin:0 auto;padding:28px 20px;">
    <div style="background:#16161f;border:1px solid rgba(255,255,255,0.06);border-radius:12px;padding:24px;">
      <div style="margin-bottom:18px;">
        <img src="https://metatron.id/metatron-logo.png" alt="metatron" style="max-width:160px;width:100%;height:auto;display:block;" />
      </div>
      <h1 style="margin:0 0 12px 0;font-size:22px;line-height:1.2;color:#e8e8ed;">{title}</h1>
      {body}
      <p style="margin:18px 0 0 0;font-size:12px;color:#8888a0;">Questions? Reply to this email. - The metatron team</p>
    </div>
  </div>
</div>
"#
    )
}

/// The "Kevin found a strong match" proactive nudge, shared by all roles/tiers.
pub fn high_value_match_html(
    match_label: &str,
    score: i32,
    reasoning: Option<&str>,
    matches_href: &str,
) -> String {
    let esc = |s: &str| {
        s.replace('&', "&amp;")
            .replace('<', "&lt;")
            .replace('>', "&gt;")
            .replace('"', "&quot;")
    };
    let reasoning_html = reasoning
        .map(|r| {
            format!(
                r#"<p style="margin:0 0 16px 0;color:#8888a0;font-size:14px;line-height:1.5;">{}</p>"#,
                esc(r)
            )
        })
        .unwrap_or_default();
    shell_html(
        "Kevin found a strong match for you",
        &format!(
            r#"<p style="margin:0 0 10px 0;font-size:16px;color:#e8e8ed;">{}</p>
<p style="margin:0 0 16px 0;"><span style="display:inline-block;background:rgba(108,92,231,0.2);color:#6c5ce7;font-family:'JetBrains Mono',monospace;font-size:13px;padding:4px 10px;border-radius:6px;">{}% fit</span></p>
{}
<p style="margin:0;"><a href="{}" style="color:#6c5ce7;">View it on metatron &rarr;</a></p>"#,
            esc(match_label),
            score,
            reasoning_html,
            matches_href
        ),
    )
}

/// Internal notification when a user registers with `?invite=…` (e.g. deals inbox).
pub fn founder_invite_signup_notification_html(
    signup_email: &str,
    user_id: &str,
    role_display: &str,
    invite_code: &str,
    timestamp_iso: &str,
) -> String {
    let esc = |s: &str| {
        s.replace('&', "&amp;")
            .replace('<', "&lt;")
            .replace('>', "&gt;")
            .replace('"', "&quot;")
    };
    let admin_profile_url = format!("https://platform.metatron.id/admin/users/{user_id}");
    shell_html(
        "Invite signup",
        &format!(
            r#"<p style="margin:0 0 14px 0;font-size:14px;color:#e8e8ed;">Someone signed up using an invite link.</p>
<table style="font-size:14px;color:#e8e8ed;line-height:1.7;border-collapse:collapse;">
<tr><td style="padding:6px 14px 6px 0;font-family:ui-monospace,monospace;color:#8888a0;vertical-align:top;white-space:nowrap;">Email</td><td>{}</td></tr>
<tr><td style="padding:6px 14px 6px 0;font-family:ui-monospace,monospace;color:#8888a0;vertical-align:top;">Role</td><td>{}</td></tr>
<tr><td style="padding:6px 14px 6px 0;font-family:ui-monospace,monospace;color:#8888a0;vertical-align:top;">Invite</td><td>{}</td></tr>
<tr><td style="padding:6px 14px 6px 0;font-family:ui-monospace,monospace;color:#8888a0;vertical-align:top;">Time (UTC)</td><td>{}</td></tr>
</table>
<p style="margin:18px 0 0 0;font-size:14px;">
  <a href="{}" style="display:inline-block;background:#6c5ce7;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:12px;font-weight:600;">View profile in admin →</a>
</p>"#,
            esc(signup_email),
            esc(role_display),
            esc(invite_code),
            esc(timestamp_iso),
            esc(&admin_profile_url),
        ),
    )
}

/// Subjects for waitlist flow — keep in sync with `metatron-landing` when that repo defines them.
pub const WAITLIST_CONFIRMATION_SUBJECT: &str = "You're on the metatron waitlist";
pub const WAITLIST_ADMIN_SUBJECT: &str = "New metatron waitlist signup";

pub fn waitlist_confirmation_html(name: &str, startup_name: &str, tier: &str) -> String {
    let esc = |s: &str| {
        s.replace('&', "&amp;")
            .replace('<', "&lt;")
            .replace('>', "&gt;")
            .replace('"', "&quot;")
    };
    shell_html(
        "You're on the list",
        &format!(
            r#"<p style="margin:0 0 14px 0;font-size:14px;color:#e8e8ed;">Hi {},</p>
<p style="margin:0 0 14px 0;font-size:14px;color:#e8e8ed;">Thanks for joining the metatron waitlist for <strong>{}</strong>.</p>
<p style="margin:0 0 14px 0;font-size:14px;color:#e8e8ed;">We've recorded your interest in <strong>{}</strong>. We'll email you when it's your turn to get access.</p>
<p style="margin:0 0 14px 0;font-size:14px;color:#e8e8ed;">In the meantime, you can explore <a href="https://metatron.id" style="color:#6c5ce7;text-decoration:none;">metatron.id</a> and follow updates from the team.</p>
<p style="margin:0 0 0 0;font-size:14px;color:#e8e8ed;">— metatron</p>"#,
            esc(name),
            esc(startup_name),
            esc(tier),
        ),
    )
}

pub fn waitlist_admin_notification_html(
    name: &str,
    startup_name: &str,
    email: &str,
    tier: &str,
    user_agent: Option<&str>,
    referrer: Option<&str>,
) -> String {
    let esc = |s: &str| {
        s.replace('&', "&amp;")
            .replace('<', "&lt;")
            .replace('>', "&gt;")
            .replace('"', "&quot;")
    };
    let ua = user_agent.map(esc).unwrap_or_else(|| "—".to_string());
    let ref_html = referrer.map(esc).unwrap_or_else(|| "—".to_string());
    shell_html(
        "New waitlist signup",
        &format!(
            r#"<p style="margin:0 0 14px 0;font-size:14px;color:#e8e8ed;">Someone submitted the landing waitlist form.</p>
<table style="font-size:14px;color:#e8e8ed;line-height:1.7;border-collapse:collapse;">
<tr><td style="padding:6px 14px 6px 0;font-family:ui-monospace,monospace;color:#8888a0;vertical-align:top;white-space:nowrap;">Name</td><td>{}</td></tr>
<tr><td style="padding:6px 14px 6px 0;font-family:ui-monospace,monospace;color:#8888a0;vertical-align:top;">Startup</td><td>{}</td></tr>
<tr><td style="padding:6px 14px 6px 0;font-family:ui-monospace,monospace;color:#8888a0;vertical-align:top;">Email</td><td>{}</td></tr>
<tr><td style="padding:6px 14px 6px 0;font-family:ui-monospace,monospace;color:#8888a0;vertical-align:top;">Tier</td><td>{}</td></tr>
<tr><td style="padding:6px 14px 6px 0;font-family:ui-monospace,monospace;color:#8888a0;vertical-align:top;">User-Agent</td><td style="word-break:break-all;">{}</td></tr>
<tr><td style="padding:6px 14px 6px 0;font-family:ui-monospace,monospace;color:#8888a0;vertical-align:top;">Referrer</td><td style="word-break:break-all;">{}</td></tr>
</table>"#,
            esc(name),
            esc(startup_name),
            esc(email),
            esc(tier),
            ua,
            ref_html,
        ),
    )
}

pub fn welcome_email_html(role: &str) -> String {
    let body = match role {
        "INVESTOR" => r#"
<p style="margin:0 0 12px 0;font-size:14px;color:#e8e8ed;">Your account is ready. Here's what you can do as a free investor:</p>
<ul style="margin:0 0 14px 18px;padding:0;color:#e8e8ed;font-size:14px;line-height:1.6;">
  <li>Build your investor profile with thesis, sectors, stages, and ticket size</li>
  <li>Browse Kevin-matched founders aligned with your thesis</li>
  <li>Request warm intros to founders you want to meet</li>
  <li>Chat with Kevin, your AI deal-flow co-pilot</li>
</ul>
<p style="margin:0 0 8px 0;font-size:14px;color:#e8e8ed;">Ready to unlock more?</p>
<p style="margin:0 0 14px 0;font-size:14px;">
  <a href="https://platform.metatron.id/pricing" style="color:#6c5ce7;text-decoration:none;">View Free → Basic plans</a>
</p>
<ul style="margin:0 0 0 18px;padding:0;color:#e8e8ed;font-size:14px;line-height:1.6;">
  <li>Unlimited match feed (vs. 1/week on Free)</li>
  <li>Pipeline stage management</li>
  <li>Investment memo generation</li>
  <li>Public investor profile on metatron</li>
</ul>
"#,
        "INTERMEDIARY" => r#"
<p style="margin:0 0 12px 0;font-size:14px;color:#e8e8ed;">Your account is ready. Here's what you can do as a free connector:</p>
<ul style="margin:0 0 14px 18px;padding:0;color:#e8e8ed;font-size:14px;line-height:1.6;">
  <li>Import your founder & investor network via CSV</li>
  <li>Enrich contacts with AI to surface intro opportunities</li>
  <li>Get credited for warm intros that lead to deals</li>
  <li>Chat with Kevin, your AI network co-pilot</li>
</ul>
<p style="margin:0 0 8px 0;font-size:14px;color:#e8e8ed;">Ready to unlock more?</p>
<p style="margin:0 0 14px 0;font-size:14px;">
  <a href="https://platform.metatron.id/pricing" style="color:#6c5ce7;text-decoration:none;">View Free → Basic plans</a>
</p>
<ul style="margin:0 0 0 18px;padding:0;color:#e8e8ed;font-size:14px;line-height:1.6;">
  <li>Unlimited contact imports & enrichments</li>
  <li>Referral and introduction tracking</li>
  <li>IPFS-anchored network ownership</li>
</ul>
"#,
        _ => r#"
<p style="margin:0 0 12px 0;font-size:14px;color:#e8e8ed;">Your account is ready. Here's what you can do as a free founder:</p>
<ul style="margin:0 0 14px 18px;padding:0;color:#e8e8ed;font-size:14px;line-height:1.6;">
  <li>Build your founder profile with company details, stage, and sector</li>
  <li>Share your pitch deck link with investors</li>
  <li>Chat with Kevin, your AI fundraising co-pilot</li>
</ul>
<p style="margin:0 0 8px 0;font-size:14px;color:#e8e8ed;">Ready to unlock more?</p>
<p style="margin:0 0 14px 0;font-size:14px;">
  <a href="https://platform.metatron.id/pricing" style="color:#6c5ce7;text-decoration:none;">View Free → Basic plans</a>
</p>
<ul style="margin:0 0 0 18px;padding:0;color:#e8e8ed;font-size:14px;line-height:1.6;">
  <li>Private &amp; public IPFS pitch deck storage</li>
  <li>Call intelligence (upload recordings for AI analysis)</li>
  <li>Full contact card sharing on investor intros</li>
  <li>Pitches management</li>
</ul>
"#,
    };
    shell_html("Welcome to metatron", body)
}

pub fn pro_activated_email_html(plan_name: &str, period_end: &str, amount_paid: &str) -> String {
    shell_html(
        &format!("{} activated", plan_name),
        &format!(
            r#"
<p style="margin:0 0 12px 0;font-size:14px;color:#e8e8ed;">Thank you for subscribing to <strong>{plan_name}</strong>. Here's what's now unlocked:</p>
<ul style="margin:0 0 14px 18px;padding:0;color:#e8e8ed;font-size:14px;line-height:1.6;">
  <li>IPFS pitch deck storage (public or private)</li>
  <li>Call intelligence - upload recordings for transcription and AI analysis</li>
  <li>Full pitch management</li>
  <li>Full contact card shared on investor introductions</li>
  <li>Priority Kevin AI responses</li>
</ul>
<p style="margin:0 0 8px 0;font-size:14px;color:#e8e8ed;">Coming soon for Pro members:</p>
<ul style="margin:0 0 14px 18px;padding:0;color:#e8e8ed;font-size:14px;line-height:1.6;">
  <li>startup_name.metatron.id custom subdomain with your own AI agent</li>
  <li>Custom AI backend (Claude, GPT-4, Gemini)</li>
  <li>Custom system prompt and knowledge base</li>
  <li>Embeddable widget for your own website</li>
  <li>On-chain pitch verification and NFT-anchored profile</li>
</ul>
<p style="margin:0 0 6px 0;font-size:13px;color:#8888a0;">Subscription details:</p>
<p style="margin:0 0 0 0;font-size:13px;color:#e8e8ed;">Period end: {period_end}<br/>Amount paid: {amount_paid}</p>
<p style="margin:14px 0 0 0;font-size:14px;">
  <a href="https://platform.metatron.id" style="color:#6c5ce7;text-decoration:none;">Open platform</a> ·
  <a href="mailto:support@metatron.id" style="color:#6c5ce7;text-decoration:none;">Support</a>
</p>
"#
        ),
    )
}

pub fn subscription_invoice_email_html(
    plan_name: &str,
    period_start: &str,
    period_end: &str,
    amount_paid: &str,
    reference: Option<&str>,
) -> String {
    let reference_row = match reference {
        Some(r) if !r.trim().is_empty() => format!("<br/>Reference: {r}"),
        _ => String::new(),
    };
    shell_html(
        &format!("Your metatron {plan_name} subscription has renewed"),
        &format!(
            r#"
<p style="margin:0 0 12px 0;font-size:14px;color:#e8e8ed;">Your <strong>{plan_name}</strong> subscription has renewed. Here's your receipt:</p>
<p style="margin:0 0 6px 0;font-size:13px;color:#8888a0;">Invoice:</p>
<p style="margin:0 0 0 0;font-size:13px;color:#e8e8ed;">Billing period: {period_start} – {period_end}<br/>Amount paid: {amount_paid}{reference_row}</p>
<p style="margin:14px 0 0 0;font-size:14px;">
  <a href="https://platform.metatron.id" style="color:#6c5ce7;text-decoration:none;">Open platform</a> ·
  <a href="mailto:support@metatron.id" style="color:#6c5ce7;text-decoration:none;">Support</a>
</p>
"#
        ),
    )
}

pub fn subscription_cancelled_email_html(period_end: &str) -> String {
    shell_html(
        "Your metatron subscription has been cancelled",
        &format!(
            r#"
<p style="margin:0 0 12px 0;font-size:14px;color:#e8e8ed;">Your metatron subscription has been set to cancel at the end of your current billing period.</p>
<p style="margin:0 0 12px 0;font-size:13px;color:#e8e8ed;">You will retain full access until: <strong>{period_end}</strong></p>
<p style="margin:0 0 12px 0;font-size:14px;color:#e8e8ed;">After that date your account will revert to the free tier.</p>
<p style="margin:0 0 0 0;font-size:14px;">
  <a href="https://platform.metatron.id/pricing" style="color:#6c5ce7;text-decoration:none;">Resubscribe</a> ·
  <a href="mailto:support@metatron.id" style="color:#6c5ce7;text-decoration:none;">Support</a>
</p>
"#,
            period_end = period_end
        ),
    )
}

pub fn renewal_reminder_email_html(expiry_date: &str, role: &str) -> String {
    let (heading, bullets) = match role.to_ascii_uppercase().as_str() {
        "INVESTOR" => (
            "Keep your deal flow running with Kevin:",
            r#"<li>Weekly founder matches curated to your thesis and ticket size</li>
  <li>Kevin introductions handled end-to-end</li>
  <li>Access to call intelligence and pitch analysis</li>
  <li>Full contact details shared on every introduction</li>"#,
        ),
        "CONNECTOR" => (
            "Keep your network active with Kevin:",
            r#"<li>Weekly matches connecting your founders with the right investors</li>
  <li>Kevin introductions managed across your network</li>
  <li>Full contact sharing on every intro</li>
  <li>Enriched network contact management</li>"#,
        ),
        _ => (
            "Keep your momentum with Kevin:",
            r#"<li>Weekly investor matches tailored to your stage and sector</li>
  <li>Kevin introductions sent on your behalf</li>
  <li>Your pitch deck stays live and discoverable</li>
  <li>Full profile visibility to matched investors</li>"#,
        ),
    };
    shell_html(
        "Your metatron subscription is expiring soon",
        &format!(
            r#"
<p style="margin:0 0 12px 0;font-size:14px;color:#e8e8ed;">Your metatron subscription renews in 3 days.</p>
<p style="margin:0 0 12px 0;font-size:13px;color:#e8e8ed;">Expiry date: {expiry_date}</p>
<p style="margin:0 0 12px 0;font-size:14px;">
  <a href="https://platform.metatron.id/pricing" style="color:#6c5ce7;text-decoration:none;">Renew your subscription</a>
</p>
<p style="margin:0 0 8px 0;font-size:14px;color:#e8e8ed;">{heading}</p>
<ul style="margin:0 0 0 18px;padding:0;color:#e8e8ed;font-size:14px;line-height:1.6;">
  {bullets}
</ul>
"#
        ),
    )
}

pub fn deck_expiry_7_days_html() -> String {
    shell_html(
        "Your pitch deck expires in 7 days",
        r#"
<p style="margin:0 0 12px 0;font-size:14px;color:#e8e8ed;">Your free pitch deck on metatron IPFS storage will expire in <strong>7 days</strong>.</p>
<p style="margin:0 0 12px 0;font-size:14px;color:#e8e8ed;">After expiry, your deck link will stop working and investors will no longer be able to view it through the platform.</p>
<p style="margin:0 0 16px 0;font-size:14px;">
  <a href="https://platform.metatron.id/pricing" style="display:inline-block;background:#6c5ce7;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:12px;font-weight:600;">Upgrade to Basic — keep your deck live →</a>
</p>
<p style="margin:0 0 0 0;font-size:13px;color:#8888a0;">Basic includes permanent IPFS storage, unlimited re-uploads, and Kevin re-extraction on every update.</p>
"#,
    )
}

pub fn deck_expiry_1_day_html() -> String {
    shell_html(
        "Investors are looking — your deck goes dark tomorrow",
        r#"
<p style="margin:0 0 12px 0;font-size:14px;color:#e8e8ed;">Kevin has been matching you with investors this week. Tomorrow your pitch deck link goes dead — and anyone Kevin sends your way will hit a blank page.</p>
<p style="margin:0 0 12px 0;font-size:14px;color:#e8e8ed;">Upgrading to Basic keeps your deck live permanently, so every intro Kevin makes can actually land.</p>
<p style="margin:0 0 16px 0;font-size:14px;">
  <a href="https://platform.metatron.id/pricing" style="display:inline-block;background:#6c5ce7;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:12px;font-weight:600;">Upgrade Plan — keep your deck live →</a>
</p>
<p style="margin:0 0 0 0;font-size:13px;color:#8888a0;">Basic includes permanent IPFS storage, unlimited re-uploads, and Kevin re-extraction on every update.</p>
"#,
    )
}

pub fn deck_expired_html() -> String {
    shell_html(
        "Your pitch deck has expired",
        r#"
<p style="margin:0 0 12px 0;font-size:14px;color:#e8e8ed;">Your free pitch deck on metatron has expired and your deck link is no longer active.</p>
<p style="margin:0 0 12px 0;font-size:14px;color:#e8e8ed;">Upgrade to Basic to re-upload your deck and keep it permanently live for investors.</p>
<p style="margin:0 0 16px 0;font-size:14px;">
  <a href="https://platform.metatron.id/pricing" style="display:inline-block;background:#6c5ce7;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:12px;font-weight:600;">Upgrade Plan →</a>
</p>
<p style="margin:0 0 0 0;font-size:13px;color:#8888a0;">Questions? Reply to this email — we're happy to help.</p>
"#,
    )
}

pub fn email_changed_notice_html(new_email: &str) -> String {
    shell_html(
        "Your metatron email has been changed",
        &format!(
            r#"
<p style="margin:0 0 12px 0;font-size:14px;color:#e8e8ed;">This is a confirmation that your metatron account email was changed to:</p>
<p style="margin:0 0 12px 0;font-size:14px;color:#e8e8ed;"><strong>{new_email}</strong></p>
<p style="margin:0 0 0 0;font-size:14px;color:#e8e8ed;">If you did not make this change, contact support immediately at <a href="mailto:support@metatron.id" style="color:#6c5ce7;text-decoration:none;">support@metatron.id</a>.</p>
"#
        ),
    )
}

fn password_reset_email_html(token_hex: &str) -> String {
    let reset_url = format!(
        "https://platform.metatron.id/auth/reset-password?token={}",
        token_hex
    );
    shell_html(
        "Reset your metatron password",
        &format!(
            r#"
<p style="margin:0 0 16px 0;font-size:14px;color:#e8e8ed;">We received a request to reset your metatron password. Use the button below to choose a new password.</p>
<p style="margin:0 0 20px 0;">
  <a href="{reset_url}" style="display:inline-block;background:#6c5ce7;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:12px 20px;border-radius:12px;">Reset password</a>
</p>
<p style="margin:0 0 0 0;font-size:13px;color:#8888a0;">This link expires in 1 hour. If you didn't request this, ignore this email.</p>
"#,
            reset_url = reset_url,
        ),
    )
}

/// Plain-text outbound email (e.g. Kevin replies via Resend).
pub async fn send_kevin_email_reply(
    http_client: &Client,
    api_key: &str,
    from_email: &str,
    to_email: &str,
    subject: &str,
    body: &str,
) {
    let api_key = api_key.trim();
    if api_key.is_empty() {
        tracing::warn!("send_kevin_email_reply: RESEND_API_KEY missing; skipping to {}", to_email);
        return;
    }
    if to_email.trim().is_empty() {
        tracing::warn!("send_kevin_email_reply: empty recipient");
        return;
    }

    let payload = json!({
        "from": from_email,
        "to": [to_email],
        "subject": subject,
        "text": body
    });

    match http_client
        .post("https://api.resend.com/emails")
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(&payload)
        .send()
        .await
    {
        Ok(resp) => {
            if !resp.status().is_success() {
                let status = resp.status();
                let body = resp.text().await.unwrap_or_default();
                tracing::warn!(
                    "send_kevin_email_reply: resend failed status={} to={} subject='{}' body={}",
                    status,
                    to_email,
                    subject,
                    body.chars().take(300).collect::<String>()
                );
            }
        }
        Err(e) => {
            tracing::warn!(
                "send_kevin_email_reply: request error to={} subject='{}': {}",
                to_email,
                subject,
                e
            );
        }
    }
}

pub async fn send_password_reset_email(
    http_client: &Client,
    api_key: Option<&str>,
    from: &str,
    to_email: &str,
    token_hex: &str,
) {
    let html = password_reset_email_html(token_hex);
    send_email(
        http_client,
        api_key,
        from,
        to_email,
        "Reset your metatron password",
        &html,
    )
    .await;
}

pub fn intro_investor_email_html(
    investor_name: &str,
    company_name: &str,
    one_liner: &str,
    stage: &str,
    sector: &str,
    reasoning: &str,
    deck_url: Option<&str>,
) -> String {
    let deck_block = match deck_url {
        Some(url) if !url.is_empty() => format!(
            r#"<p style="margin:16px 0 0 0;">
              <a href="{url}" style="display:inline-block;background:#6c5ce7;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:12px;font-weight:600;font-size:14px;">View pitch deck →</a>
            </p>"#
        ),
        _ => String::new(),
    };

    shell_html(
        &format!("{} — a founder Kevin thinks you should meet", company_name),
        &format!(
            r#"
<p style="margin:0 0 12px 0;font-size:14px;color:#e8e8ed;">Hi {investor_name},</p>
<p style="margin:0 0 16px 0;font-size:14px;color:#e8e8ed;">I've been tracking <strong>{company_name}</strong> and I think you two should connect.</p>

<div style="margin:0 0 20px 0;padding:14px 18px;background:rgba(108,92,231,0.08);border-left:3px solid #6c5ce7;border-radius:0 8px 8px 0;">
  <p style="margin:0 0 6px 0;font-size:11px;font-family:ui-monospace,monospace;text-transform:uppercase;letter-spacing:0.12em;color:#8888a0;">Why I made this match</p>
  <p style="margin:0;font-size:14px;color:#e8e8ed;line-height:1.6;">{reasoning}</p>
</div>

<table style="width:100%;border-collapse:collapse;margin:0 0 16px 0;">
  <tr><td style="padding:6px 14px 6px 0;font-size:12px;font-family:ui-monospace,monospace;color:#8888a0;white-space:nowrap;vertical-align:top;">Company</td><td style="font-size:14px;color:#e8e8ed;padding:6px 0;">{company_name}</td></tr>
  <tr><td style="padding:6px 14px 6px 0;font-size:12px;font-family:ui-monospace,monospace;color:#8888a0;white-space:nowrap;vertical-align:top;">About</td><td style="font-size:14px;color:#e8e8ed;padding:6px 0;">{one_liner}</td></tr>
  <tr><td style="padding:6px 14px 6px 0;font-size:12px;font-family:ui-monospace,monospace;color:#8888a0;white-space:nowrap;vertical-align:top;">Stage</td><td style="font-size:14px;color:#e8e8ed;padding:6px 0;">{stage}</td></tr>
  <tr><td style="padding:6px 14px 6px 0;font-size:12px;font-family:ui-monospace,monospace;color:#8888a0;white-space:nowrap;vertical-align:top;">Sector</td><td style="font-size:14px;color:#e8e8ed;padding:6px 0;">{sector}</td></tr>
</table>

{deck_block}

<div style="margin:24px 0 0 0;border-top:1px solid rgba(255,255,255,0.06);padding-top:16px;">
  <p style="margin:0;font-size:14px;color:#e8e8ed;">Reply directly to this email to connect — I've already vetted this match.</p>
  <p style="margin:12px 0 0 0;font-size:14px;color:#8888a0;">— Kevin<br/>metatron · The intelligence layer between founders and capital.</p>
</div>
"#
        ),
    )
}

pub fn intro_founder_confirmation_html(
    investor_name: &str,
    company_name: &str,
    reasoning: &str,
    investor_channels: &str,
) -> String {
    let _ = company_name;
    shell_html(
        &format!("Kevin has introduced you to {}", investor_name),
        &format!(
            r#"
<p style="margin:0 0 12px 0;font-size:14px;color:#e8e8ed;">Your introduction to <strong>{investor_name}</strong> has been sent.</p>

<div style="margin:0 0 20px 0;padding:14px 18px;background:rgba(108,92,231,0.08);border-left:3px solid #6c5ce7;border-radius:0 8px 8px 0;">
  <p style="margin:0 0 6px 0;font-size:11px;font-family:ui-monospace,monospace;text-transform:uppercase;letter-spacing:0.12em;color:#8888a0;">What Kevin told them</p>
  <p style="margin:0;font-size:14px;color:#e8e8ed;line-height:1.6;">{reasoning}</p>
</div>

<p style="margin:0 0 12px 0;font-size:14px;color:#e8e8ed;">They've been notified via {investor_channels} and will reach out if they're interested. I'll keep you posted.</p>
<p style="margin:0 0 20px 0;font-size:14px;color:#e8e8ed;">In the meantime, make sure your profile and pitch deck are up to date so they have everything they need.</p>

<p style="margin:0 0 24px 0;">
  <a href="https://platform.metatron.id/startup/profile" style="display:inline-block;background:#6c5ce7;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:12px;font-weight:600;font-size:14px;">Update your profile →</a>
</p>

<p style="margin:0;font-size:14px;color:#8888a0;">— Kevin<br/>metatron · The intelligence layer between founders and capital.</p>
"#
        ),
    )
}

pub fn deck_viewed_html(investor_name: &str, company_name: &str) -> String {
    shell_html(
        &format!("{} viewed your pitch deck", investor_name),
        &format!(
            r#"
<p style="margin:0 0 16px 0;font-size:14px;color:#e8e8ed;"><strong>{investor_name}</strong> just viewed your pitch deck for <strong>{company_name}</strong>.</p>

<div style="margin:0 0 20px 0;padding:14px 18px;background:rgba(108,92,231,0.08);border-left:3px solid #6c5ce7;border-radius:0 8px 8px 0;">
  <p style="margin:0;font-size:14px;color:#e8e8ed;line-height:1.6;">They're actively reviewing your raise — keep the momentum going. If they're interested, you'll hear from them via the metatron messaging centre shortly.</p>
</div>

<p style="margin:0 0 24px 0;">
  <a href="https://platform.metatron.id/startup/matches" style="display:inline-block;background:#6c5ce7;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:12px;font-weight:600;font-size:14px;">View your matches →</a>
</p>

<p style="margin:0;font-size:14px;color:#8888a0;">— Kevin<br/>metatron · The intelligence layer between founders and capital.</p>
"#
        ),
    )
}

pub fn intro_accepted_founder_html(
    investor_name: &str,
    company_name: &str,
    investor_email: &str,
) -> String {
    shell_html(
        &format!("{} is interested in {}!", investor_name, company_name),
        &format!(
            r#"
<p style="margin:0 0 16px 0;font-size:14px;color:#e8e8ed;">Great news! <strong>{investor_name}</strong> has reviewed your pitch and wants to connect.</p>

<div style="margin:0 0 20px 0;padding:14px 18px;background:rgba(108,92,231,0.08);border-left:3px solid #6c5ce7;border-radius:0 8px 8px 0;">
  <p style="margin:0 0 6px 0;font-size:11px;font-family:ui-monospace,monospace;text-transform:uppercase;letter-spacing:0.12em;color:#8888a0;">Their contact</p>
  <p style="margin:0;font-size:14px;color:#e8e8ed;">{investor_email}</p>
</div>

<p style="margin:0 0 20px 0;font-size:14px;color:#e8e8ed;">You can also message them directly via the metatron messaging centre.</p>

<p style="margin:0 0 24px 0;">
  <a href="https://platform.metatron.id/startup/matches" style="display:inline-block;background:#6c5ce7;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:12px;font-weight:600;font-size:14px;">Open messaging centre →</a>
</p>

<p style="margin:0;font-size:14px;color:#8888a0;">— Kevin<br/>metatron · The intelligence layer between founders and capital.</p>
"#
        ),
    )
}

pub fn intro_accepted_investor_html(
    investor_name: &str,
    company_name: &str,
    founder_email: &str,
    deck_url: Option<&str>,
) -> String {
    let deck_block = match deck_url {
        Some(url) if !url.is_empty() => format!(
            r#"<p style="margin:10px 0 0 0;"><a href="{url}" style="display:inline-block;background:#6c5ce7;color:#ffffff;text-decoration:none;padding:8px 16px;border-radius:10px;font-weight:600;font-size:13px;">View pitch deck →</a></p>"#
        ),
        _ => String::new(),
    };
    shell_html(
        &format!("You're connected with {}", company_name),
        &format!(
            r#"
<p style="margin:0 0 16px 0;font-size:14px;color:#e8e8ed;">Hi {investor_name}, you expressed interest in <strong>{company_name}</strong> via metatron. Here are their contact details.</p>

<div style="margin:0 0 20px 0;padding:14px 18px;background:rgba(108,92,231,0.08);border-left:3px solid #6c5ce7;border-radius:0 8px 8px 0;">
  <p style="margin:0 0 6px 0;font-size:11px;font-family:ui-monospace,monospace;text-transform:uppercase;letter-spacing:0.12em;color:#8888a0;">Founder contact</p>
  <p style="margin:0 0 2px 0;font-size:14px;color:#e8e8ed;">{founder_email}</p>
  {deck_block}
</div>

<p style="margin:0 0 20px 0;font-size:14px;color:#e8e8ed;">You can also message them directly via the metatron messaging centre.</p>

<p style="margin:0 0 24px 0;">
  <a href="https://platform.metatron.id/investor/matches" style="display:inline-block;background:#6c5ce7;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:12px;font-weight:600;font-size:14px;">Open messaging centre →</a>
</p>

<p style="margin:0;font-size:14px;color:#8888a0;">— Kevin<br/>metatron · The intelligence layer between founders and capital.</p>
"#
        ),
    )
}

pub fn intro_passed_html(investor_name: &str, pass_message: &str) -> String {
    let escaped = pass_message.replace('\n', "<br>");
    shell_html(
        &format!("An update from {}", investor_name),
        &format!(
            r#"
<p style="margin:0 0 20px 0;font-size:14px;color:#e8e8ed;line-height:1.7;">{escaped}</p>
<p style="margin:0 0 20px 0;font-size:14px;color:#e8e8ed;">Kevin will keep working to find the right investors for your raise.</p>
<p style="margin:0 0 24px 0;">
  <a href="https://platform.metatron.id/startup/matches" style="display:inline-block;background:#6c5ce7;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:12px;font-weight:600;font-size:14px;">View your matches →</a>
</p>
<p style="margin:0;font-size:14px;color:#8888a0;">— Kevin<br/>metatron · The intelligence layer between founders and capital.</p>
"#
        ),
    )
}


pub fn kevin_intro_suggestion_email_html(
    investor_name: &str,
    fit_reason: &str,
    draft_message: &str,
) -> String {
    let dashboard_url = "https://platform.metatron.id/startup/matches";
    shell_html(
        "Kevin found a match — ready to send?",
        &format!(
            r#"
<p style="margin:0 0 20px 0;font-size:14px;color:#e8e8ed;line-height:1.7;">Kevin identified <strong style="color:#ffffff;">{investor_name}</strong> as a strong fit for your raise.</p>

<div style="background:#1e1e2e;border:1px solid #3d3d5c;border-radius:12px;padding:16px 20px;margin:0 0 20px 0;">
  <p style="margin:0 0 8px 0;font-size:12px;color:#8888a0;text-transform:uppercase;letter-spacing:0.05em;">Why Kevin thinks you match</p>
  <p style="margin:0;font-size:14px;color:#e8e8ed;line-height:1.7;">{fit_reason}</p>
</div>

<div style="background:#1e1e2e;border:1px solid #3d3d5c;border-radius:12px;padding:16px 20px;margin:0 0 24px 0;">
  <p style="margin:0 0 8px 0;font-size:12px;color:#8888a0;text-transform:uppercase;letter-spacing:0.05em;">Kevin's draft intro message</p>
  <p style="margin:0;font-size:14px;color:#e8e8ed;line-height:1.7;white-space:pre-wrap;">{draft_message}</p>
</div>

<p style="margin:0 0 24px 0;">
  <a href="{dashboard_url}" style="display:inline-block;background:#6c5ce7;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:12px;font-weight:600;font-size:14px;">Review &amp; approve in dashboard →</a>
</p>

<p style="margin:0;font-size:14px;color:#8888a0;">— Kevin<br/>metatron · The intelligence layer between founders and capital.</p>
"#
        ),
    )
}

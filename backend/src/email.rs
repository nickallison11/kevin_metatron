use reqwest::Client;
use serde_json::json;

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
        "html": html
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

fn shell_html(title: &str, body: &str) -> String {
    format!(
        r#"
<div style="margin:0;padding:0;background:#0a0a0f;color:#e8e8ed;font-family:'DM Sans',Arial,sans-serif;">
  <div style="max-width:620px;margin:0 auto;padding:28px 20px;">
    <div style="background:#16161f;border:1px solid rgba(255,255,255,0.06);border-radius:12px;padding:24px;">
      <div style="margin-bottom:18px;">
        <img src="https://metatron.id/wp-content/uploads/2026/03/metatron-_Logo.png" alt="metatron" style="height:42px;display:block;" />
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

pub fn welcome_email_html() -> String {
    shell_html(
        "Welcome to metatron",
        r#"
<p style="margin:0 0 12px 0;font-size:14px;color:#e8e8ed;">Your account is ready. Here's what you can do as a free founder:</p>
<ul style="margin:0 0 14px 18px;padding:0;color:#e8e8ed;font-size:14px;line-height:1.6;">
  <li>Build your founder profile with company details, stage, and sector</li>
  <li>Share your pitch deck link with investors</li>
  <li>Chat with Kevin, your AI fundraising co-pilot</li>
</ul>
<p style="margin:0 0 8px 0;font-size:14px;color:#e8e8ed;">Ready to unlock more?</p>
<p style="margin:0 0 14px 0;font-size:14px;">
  <a href="https://platform.metatron.id/pricing" style="color:#6c5ce7;text-decoration:none;">View Free → Pro plans</a>
</p>
<ul style="margin:0 0 0 18px;padding:0;color:#e8e8ed;font-size:14px;line-height:1.6;">
  <li>Private &amp; public IPFS pitch deck storage</li>
  <li>Call intelligence (upload recordings for AI analysis)</li>
  <li>Full contact card sharing on investor intros</li>
  <li>Pitches management</li>
</ul>
"#,
    )
}

pub fn pro_activated_email_html(period_end: &str, amount_paid: &str) -> String {
    shell_html(
        "Pro activated",
        &format!(
            r#"
<p style="margin:0 0 12px 0;font-size:14px;color:#e8e8ed;">Thank you for subscribing. Here's what's now unlocked:</p>
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

pub fn subscription_cancelled_email_html(period_end: &str) -> String {
    shell_html(
        "Your Pro subscription has been cancelled",
        &format!(
            r#"
<p style="margin:0 0 12px 0;font-size:14px;color:#e8e8ed;">Your metatron Pro subscription has been set to cancel at the end of your current billing period.</p>
<p style="margin:0 0 12px 0;font-size:13px;color:#e8e8ed;">You will retain full Pro access until: <strong>{period_end}</strong></p>
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

pub fn renewal_reminder_email_html(expiry_date: &str) -> String {
    shell_html(
        "Your Pro subscription is expiring soon",
        &format!(
            r#"
<p style="margin:0 0 12px 0;font-size:14px;color:#e8e8ed;">Your metatron Pro subscription renews in 3 days.</p>
<p style="margin:0 0 12px 0;font-size:13px;color:#e8e8ed;">Expiry date: {expiry_date}</p>
<p style="margin:0 0 12px 0;font-size:14px;">
  <a href="https://platform.metatron.id/pricing" style="color:#6c5ce7;text-decoration:none;">Renew your Pro plan</a>
</p>
<p style="margin:0 0 8px 0;font-size:14px;color:#e8e8ed;">If not renewed, you'll lose access to:</p>
<ul style="margin:0 0 0 18px;padding:0;color:#e8e8ed;font-size:14px;line-height:1.6;">
  <li>IPFS deck storage (public/private)</li>
  <li>Call intelligence analysis</li>
  <li>Full pitch management features</li>
  <li>Full contact card sharing on intros</li>
</ul>
"#
        ),
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


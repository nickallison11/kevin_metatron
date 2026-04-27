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


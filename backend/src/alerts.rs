//! Alerts for the team: emails Nick when something needs a person to act,
//! starting with the Gemini prepaid credits running out (Google has no API to
//! read the balance, so the first "credits are depleted" error is the signal).

use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

const ALERT_TO: &str = "nick.allison@metatrondao.io";
/// At most one Gemini alert per backend in this window, however many calls fail.
const GEMINI_ALERT_EVERY: Duration = Duration::from_secs(6 * 60 * 60);

struct AlertConfig {
    client: reqwest::Client,
    resend_api_key: Option<String>,
    from: String,
    env_label: &'static str,
}

static CONFIG: OnceLock<AlertConfig> = OnceLock::new();
static LAST_GEMINI_ALERT: Mutex<Option<Instant>> = Mutex::new(None);

/// Called once at startup.
pub fn init(client: reqwest::Client, resend_api_key: Option<String>, from: String, frontend_url: &str) {
    let env_label = if frontend_url.contains("dev.") || frontend_url.contains("localhost") {
        "dev"
    } else {
        "production"
    };
    let _ = CONFIG.set(AlertConfig { client, resend_api_key, from, env_label });
}

/// Emails Nick the first time in a month that Free users' AI spend passes the
/// budget (`cost::FREE_AI_BUDGET_USD`). The `budget_alerts` row keeps it to
/// one email per month per environment.
pub async fn free_budget_reached(db: &sqlx::PgPool, spend_usd: f64) {
    let period = format!("free-ai-{}", chrono::Utc::now().format("%Y-%m"));
    let inserted = sqlx::query("INSERT INTO budget_alerts (period) VALUES ($1) ON CONFLICT DO NOTHING")
        .bind(&period)
        .execute(db)
        .await
        .map(|r| r.rows_affected() == 1)
        .unwrap_or(false);
    if !inserted {
        return;
    }
    let Some(cfg) = CONFIG.get() else { return };
    tracing::warn!("alert: Free AI budget reached (${spend_usd:.2} this month)");
    let subject = format!("Free users hit the ${:.0} AI budget ({})", crate::cost::FREE_AI_BUDGET_USD, cfg.env_label);
    let html = format!(
        r#"<p style="margin:0 0 12px 0;font-size:14px;color:#e8e8ed;">Free users' AI spend this month is <strong>${spend:.2}</strong> on the <strong>{env}</strong> backend, past the ${budget:.0} budget.</p>
<p style="margin:0 0 12px 0;font-size:14px;color:#e8e8ed;">Free users now get 5 Kevin messages a day instead of 20, until the month ends. Paid users aren't affected.</p>
<p style="margin:0;font-size:13px;color:#8888a0;">You'll get this at most once a month.</p>"#,
        spend = spend_usd,
        env = cfg.env_label,
        budget = crate::cost::FREE_AI_BUDGET_USD,
    );
    crate::email::send_email(&cfg.client, cfg.resend_api_key.as_deref(), &cfg.from, ALERT_TO, &subject, &html).await;
}

/// Pass the body of any failed Gemini response. If it says the prepaid
/// credits are used up, emails an alert (throttled).
pub fn check_gemini_error(body: &str) {
    let b = body.to_ascii_lowercase();
    if !(b.contains("prepayment credits are depleted") || b.contains("credits are depleted")) {
        return;
    }
    {
        let mut last = LAST_GEMINI_ALERT.lock().unwrap_or_else(|e| e.into_inner());
        if last.is_some_and(|t| t.elapsed() < GEMINI_ALERT_EVERY) {
            return;
        }
        *last = Some(Instant::now());
    }
    let Some(cfg) = CONFIG.get() else { return };
    tracing::error!("alert: Gemini prepaid credits are depleted");
    let subject = format!("Action needed: Gemini credits have run out ({})", cfg.env_label);
    let html = format!(
        r#"<p style="margin:0 0 12px 0;font-size:14px;color:#e8e8ed;">Google's Gemini API is refusing requests because the prepaid credits are used up. Seen on the <strong>{env}</strong> backend.</p>
<p style="margin:0 0 12px 0;font-size:14px;color:#e8e8ed;">Until they're topped up, Kevin can't read pitch decks, chat, score startups or generate matches.</p>
<p style="margin:0 0 12px 0;font-size:14px;color:#e8e8ed;">Top up at <a href="https://aistudio.google.com/" style="color:#a99cf5;">AI Studio</a> → Billing. Turning on auto-reload there stops this happening again.</p>
<p style="margin:0;font-size:13px;color:#8888a0;">You'll get at most one of these every 6 hours per backend.</p>"#,
        env = cfg.env_label
    );
    tokio::spawn(async move {
        crate::email::send_email(&cfg.client, cfg.resend_api_key.as_deref(), &cfg.from, ALERT_TO, &subject, &html).await;
    });
}

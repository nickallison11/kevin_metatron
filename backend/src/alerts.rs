//! Alerts for the team: emails Nick when something needs a person to act —
//! an AI provider's credits running out, a model being removed, a rejected
//! key, or Free users passing the monthly AI budget. Most providers have no
//! API to read the balance, so the first failed request is the signal; the
//! daily e2e monitor checks the ones that do.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

const ALERT_TO: &str = "nick.allison@metatrondao.io";
/// At most one alert per provider and problem in this window, however many calls fail.
const ALERT_EVERY: Duration = Duration::from_secs(6 * 60 * 60);

struct AlertConfig {
    client: reqwest::Client,
    resend_api_key: Option<String>,
    from: String,
    env_label: &'static str,
}

static CONFIG: OnceLock<AlertConfig> = OnceLock::new();

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

/// Pass the body of any failed Gemini response. Kept for the call sites that
/// don't have the HTTP status to hand.
pub fn check_gemini_error(body: &str) {
    check_provider_error("gemini", 0, body);
}

#[derive(Clone, Copy, PartialEq, Eq, Hash)]
enum Problem {
    OutOfCredits,
    ModelGone,
    KeyRejected,
}

fn classify(status: u16, body: &str) -> Option<Problem> {
    let b = body.to_ascii_lowercase();
    let credits = [
        "credits are depleted",      // Gemini
        "credit balance is too low", // Anthropic
        "requires more credits",     // OpenRouter
        "insufficient_quota",        // OpenAI
        "exceeded your current quota",
    ];
    if status == 402 || credits.iter().any(|c| b.contains(c)) {
        return Some(Problem::OutOfCredits);
    }
    if b.contains("no longer available") || (status == 404 && b.contains("model")) {
        return Some(Problem::ModelGone);
    }
    let bad_key = ["invalid x-api-key", "invalid api key", "api key not valid", "incorrect api key"];
    if status == 401 || bad_key.iter().any(|k| b.contains(k)) {
        return Some(Problem::KeyRejected);
    }
    None
}

static LAST_ALERT: Mutex<Option<HashMap<(String, Problem), Instant>>> = Mutex::new(None);

/// Pass the status (0 if unknown) and body of any failed AI provider response
/// ("gemini", "anthropic", "openrouter", "openai"). If it's something a
/// person has to fix — credits used up, a model the provider has removed, a
/// rejected key — emails Nick, at most once per provider and problem every
/// 6 hours. Rate limits and one-off server errors are ignored.
pub fn check_provider_error(provider: &str, status: u16, body: &str) {
    let Some(problem) = classify(status, body) else { return };
    {
        let mut guard = LAST_ALERT.lock().unwrap_or_else(|e| e.into_inner());
        let last = guard.get_or_insert_with(HashMap::new);
        let key = (provider.to_string(), problem);
        if last.get(&key).is_some_and(|t| t.elapsed() < ALERT_EVERY) {
            return;
        }
        last.insert(key, Instant::now());
    }
    let Some(cfg) = CONFIG.get() else { return };

    let (name, billing_url, affects) = match provider {
        "gemini" => (
            "Gemini",
            "https://aistudio.google.com/",
            "reading pitch decks, Free and simple Kevin chat, Angel Scores and matches",
        ),
        "anthropic" => (
            "Anthropic (Claude)",
            "https://console.anthropic.com/settings/billing",
            "Basic and Pro Kevin chat (Basic falls back to Gemini; Pro sees \"Kevin is temporarily unavailable\")",
        ),
        "openrouter" => (
            "OpenRouter",
            "https://openrouter.ai/settings/credits",
            "Pro Kevin chat (Hermes, Kimi). It falls back to Claude, which costs more",
        ),
        "openai" => (
            "OpenAI",
            "https://platform.openai.com/settings/organization/billing",
            "features that call OpenAI",
        ),
        _ => (provider, "", "the features that use it"),
    };
    let (subject_problem, what, fix) = match problem {
        Problem::OutOfCredits => (
            "credits have run out",
            format!("{name} is refusing requests because the account's credits are used up or too low."),
            if billing_url.is_empty() {
                "Top up the account.".to_string()
            } else {
                format!(
                    r#"Top up at <a href="{billing_url}" style="color:#a99cf5;">{billing_url}</a>. Turning on auto top-up there stops this happening again."#
                )
            },
        ),
        Problem::ModelGone => (
            "a model is no longer available",
            format!("{name} says a model Kevin uses no longer exists."),
            "The model name needs changing in the backend code.".to_string(),
        ),
        Problem::KeyRejected => (
            "the API key was rejected",
            format!("{name} rejected the API key."),
            "Check the key in the backend's .env file.".to_string(),
        ),
    };
    let detail = body
        .chars()
        .take(400)
        .collect::<String>()
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;");
    tracing::error!("alert: {name} {subject_problem}");
    let subject = format!("Action needed: {name} {subject_problem} ({})", cfg.env_label);
    let html = format!(
        r#"<p style="margin:0 0 12px 0;font-size:14px;color:#e8e8ed;">{what} Seen on the <strong>{env}</strong> backend.</p>
<p style="margin:0 0 12px 0;font-size:14px;color:#e8e8ed;">Affected: {affects}.</p>
<p style="margin:0 0 12px 0;font-size:14px;color:#e8e8ed;">{fix}</p>
<p style="margin:0 0 12px 0;font-size:12px;color:#8888a0;font-family:monospace;">{detail}</p>
<p style="margin:0;font-size:13px;color:#8888a0;">You'll get at most one of these every 6 hours per problem and backend.</p>"#,
        env = cfg.env_label
    );
    tokio::spawn(async move {
        crate::email::send_email(&cfg.client, cfg.resend_api_key.as_deref(), &cfg.from, ALERT_TO, &subject, &html).await;
    });
}

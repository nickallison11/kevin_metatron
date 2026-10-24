//! Platform-wide LLM spend tracking. Every call site that hits an LLM
//! provider (Kevin chat, Angel Score, Call Intelligence analysis, match
//! ranking, the weekly learning job, Kevin's memory summarize/embed) funnels
//! through `record_llm_usage` here, so spend lives in one table
//! (`llm_usage`) regardless of which of the ~9 call sites produced it.
//!
//! Pricing changes over time and per-provider — this table is the single
//! place to update rates, not scattered across call sites. Sourced
//! 2026-07-25; Gemini rates updated 2026-10-24. Revisit if a model's actual
//! bill drifts from what this reports.

use std::sync::Mutex;
use std::time::{Duration, Instant};

use sqlx::PgPool;
use uuid::Uuid;

/// Monthly AI budget for all Free users together. Past it, Free users drop
/// from 20 to 5 Kevin messages a day until the month ends, and Nick is emailed.
pub const FREE_AI_BUDGET_USD: f64 = 100.0;
const FREE_SPEND_CACHE: Duration = Duration::from_secs(5 * 60);
static FREE_SPEND: Mutex<Option<(Instant, bool)>> = Mutex::new(None);

/// True once this calendar month's (UTC) Free-tier AI spend passes
/// `FREE_AI_BUDGET_USD`. Re-checked at most every 5 minutes.
pub async fn free_budget_exceeded(db: &PgPool) -> bool {
    let cached = *FREE_SPEND.lock().unwrap_or_else(|e| e.into_inner());
    if let Some((at, over)) = cached {
        if at.elapsed() < FREE_SPEND_CACHE {
            return over;
        }
    }
    let spend: f64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(cost_usd), 0)::float8 FROM llm_usage
         WHERE subscription_tier = 'free' AND created_at >= date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'",
    )
    .fetch_one(db)
    .await
    .unwrap_or(0.0);
    let over = spend >= FREE_AI_BUDGET_USD;
    *FREE_SPEND.lock().unwrap_or_else(|e| e.into_inner()) = Some((Instant::now(), over));
    if over {
        crate::alerts::free_budget_reached(db, spend).await;
    }
    over
}

/// (input $ per million tokens, output $ per million tokens).
fn pricing_per_million(provider: &str, model: &str) -> Option<(f64, f64)> {
    match (provider, model) {
        ("gemini", "gemini-2.5-flash") => Some((0.30, 2.50)),
        ("gemini", "gemini-2.5-flash-lite") => Some((0.10, 0.40)),
        ("gemini", "text-embedding-004") | ("gemini", "gemini-embedding-001") => {
            Some((0.15, 0.0))
        }
        ("anthropic", "claude-haiku-4-5-20251001") => Some((1.00, 5.00)),
        ("anthropic", "claude-sonnet-4-6") => Some((3.00, 15.00)),
        ("anthropic", "claude-opus-4-5-20251101") => Some((5.00, 25.00)),
        ("openrouter", "nousresearch/hermes-4-70b") => Some((0.13, 0.40)),
        ("openrouter", "moonshotai/kimi-k3") => Some((3.00, 15.00)),
        // NadirClaw is local — we don't observe what it costs on our side.
        ("nadirclaw", _) => None,
        _ => None,
    }
}

fn compute_cost(provider: &str, model: &str, input_tokens: i32, output_tokens: i32) -> Option<f64> {
    let (in_price, out_price) = pricing_per_million(provider, model)?;
    let cost = (input_tokens as f64 / 1_000_000.0) * in_price
        + (output_tokens as f64 / 1_000_000.0) * out_price;
    Some(cost)
}

/// Records one LLM call's usage + computed cost. Fire-and-forget — never
/// blocks or fails the caller's actual work on a logging hiccup.
///
/// `user_id`/`role`/`subscription_tier` are `None` for batch jobs not tied
/// to a single user (e.g. the weekly learning synthesis).
pub async fn record_llm_usage(
    db: &PgPool,
    user_id: Option<Uuid>,
    role: Option<&str>,
    subscription_tier: Option<&str>,
    feature: &str,
    provider: &str,
    model: &str,
    input_tokens: i32,
    output_tokens: i32,
) {
    let cost_usd = compute_cost(provider, model, input_tokens, output_tokens);

    let _ = sqlx::query(
        r#"
        INSERT INTO llm_usage
            (user_id, role, subscription_tier, feature, provider, model, input_tokens, output_tokens, cost_usd)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        "#,
    )
    .bind(user_id)
    .bind(role)
    .bind(subscription_tier)
    .bind(feature)
    .bind(provider)
    .bind(model)
    .bind(input_tokens)
    .bind(output_tokens)
    .bind(cost_usd)
    .execute(db)
    .await;
}

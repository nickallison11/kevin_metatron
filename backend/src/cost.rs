//! Platform-wide LLM spend tracking. Every call site that hits an LLM
//! provider (Kevin chat, Angel Score, Call Intelligence analysis, match
//! ranking, the weekly learning job, Kevin's memory summarize/embed) funnels
//! through `record_llm_usage` here, so spend lives in one table
//! (`llm_usage`) regardless of which of the ~9 call sites produced it.
//!
//! Pricing changes over time and per-provider — this table is the single
//! place to update rates, not scattered across call sites. Sourced
//! 2026-07-25; revisit if a model's actual bill drifts from what this
//! reports.

use sqlx::PgPool;
use uuid::Uuid;

/// (input $ per million tokens, output $ per million tokens).
fn pricing_per_million(provider: &str, model: &str) -> Option<(f64, f64)> {
    match (provider, model) {
        ("gemini", "gemini-2.5-flash") => Some((0.15, 1.25)),
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

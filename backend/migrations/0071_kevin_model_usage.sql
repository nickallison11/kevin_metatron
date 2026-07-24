-- Tracks which model actually answered each Kevin chat turn, so the daily
-- e2e report can show model mix per subscription tier (Hermes/Kimi vs.
-- Haiku/Sonnet/Opus/Gemini fallback rates). Written fire-and-forget from
-- run_kevin_with_tools alongside the existing kevin_chat_context persist.
CREATE TABLE kevin_model_usage (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    subscription_tier TEXT NOT NULL,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_kevin_model_usage_created_at ON kevin_model_usage (created_at DESC);
CREATE INDEX idx_kevin_model_usage_tier_provider ON kevin_model_usage (subscription_tier, provider, model);

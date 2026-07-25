-- Broadens yesterday's Kevin-chat-only kevin_model_usage into platform-wide
-- LLM spend tracking: Angel Score, Call Intelligence analysis, match
-- ranking, the weekly learning job, and Kevin's memory summarize/embed
-- calls all separately hit an LLM and none of it was tracked before this.
ALTER TABLE kevin_model_usage RENAME TO llm_usage;

-- Nullable: batch jobs (the weekly learning synthesis) aren't "for" one
-- user in the role/tier sense the original Kevin-chat-only design assumed.
ALTER TABLE llm_usage ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE llm_usage ALTER COLUMN role DROP NOT NULL;
ALTER TABLE llm_usage ALTER COLUMN subscription_tier DROP NOT NULL;

ALTER TABLE llm_usage ADD COLUMN feature TEXT NOT NULL DEFAULT 'kevin_chat';
ALTER TABLE llm_usage ADD COLUMN input_tokens INTEGER;
ALTER TABLE llm_usage ADD COLUMN output_tokens INTEGER;
ALTER TABLE llm_usage ADD COLUMN cost_usd NUMERIC(10,6);

CREATE INDEX idx_llm_usage_feature ON llm_usage (feature, created_at DESC);

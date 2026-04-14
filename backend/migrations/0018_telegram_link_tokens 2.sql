CREATE TABLE IF NOT EXISTS telegram_link_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code VARCHAR(6) NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Only one unused token per 6-digit code at a time (allows reuse after use or expiry).
CREATE UNIQUE INDEX IF NOT EXISTS telegram_link_tokens_code_active
    ON telegram_link_tokens (code)
    WHERE used_at IS NULL;

CREATE INDEX IF NOT EXISTS telegram_link_tokens_user_idx ON telegram_link_tokens (user_id);

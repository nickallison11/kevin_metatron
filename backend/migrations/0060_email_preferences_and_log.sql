CREATE TABLE IF NOT EXISTS email_preferences (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    weekly_matches BOOLEAN NOT NULL DEFAULT TRUE,
    instant_alerts BOOLEAN NOT NULL DEFAULT FALSE,
    unsubscribed_all BOOLEAN NOT NULL DEFAULT FALSE,
    last_updated TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS weekly_match_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    week_of DATE NOT NULL,
    matches JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, week_of)
);
CREATE INDEX IF NOT EXISTS weekly_match_snapshots_user_idx ON weekly_match_snapshots (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS email_send_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    email_type TEXT NOT NULL,
    sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resend_message_id TEXT,
    match_snapshot_id UUID REFERENCES weekly_match_snapshots(id),
    opened_at TIMESTAMPTZ,
    clicked_at TIMESTAMPTZ,
    unsubscribed_at TIMESTAMPTZ,
    bounced_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS email_send_log_user_type_idx ON email_send_log (user_id, email_type, sent_at DESC);
CREATE INDEX IF NOT EXISTS email_send_log_resend_id_idx ON email_send_log (resend_message_id);

ALTER TABLE kevin_matches ADD COLUMN IF NOT EXISTS why_blurb TEXT;

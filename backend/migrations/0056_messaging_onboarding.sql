CREATE TABLE IF NOT EXISTS messaging_onboarding (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    channel TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'awaiting_email',
    email TEXT,
    role TEXT,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    token TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    token_expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '24 hours',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(channel, channel_id)
);

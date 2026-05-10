CREATE TABLE IF NOT EXISTS waitlist_signups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    startup_name TEXT NOT NULL,
    email TEXT NOT NULL,
    tier TEXT NOT NULL DEFAULT 'Basic / Pro',
    user_agent TEXT,
    referrer TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS waitlist_signups_email_idx ON waitlist_signups (LOWER(email));
CREATE INDEX IF NOT EXISTS waitlist_signups_created_idx ON waitlist_signups (created_at DESC);

-- Users who asked to be told when a paid plan launches (while payments are off).
CREATE TABLE IF NOT EXISTS plan_interest (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    plan TEXT NOT NULL CHECK (plan IN ('basic', 'pro')),
    source TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    notified_at TIMESTAMPTZ,
    UNIQUE (user_id, plan)
);

-- What users tell Kevin in conversation about how intros went and what they
-- do or don't want. Saved by Kevin's record_feedback tool; read back into
-- Kevin's context so he remembers it, and later into match scoring.
CREATE TABLE IF NOT EXISTS kevin_feedback (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- The match or intro counterpart it's about; NULL for a general preference.
    about_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    kind TEXT NOT NULL CHECK (kind IN ('intro_outcome', 'preference')),
    outcome TEXT,
    reason TEXT,
    detail TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'chat',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kevin_feedback_user ON kevin_feedback (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_kevin_feedback_about ON kevin_feedback (about_user_id);

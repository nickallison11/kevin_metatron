CREATE TABLE kevin_intro_suggestions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    for_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    matched_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    fit_score FLOAT NOT NULL,
    fit_reason TEXT NOT NULL,
    draft_message TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    actioned_at TIMESTAMPTZ,
    UNIQUE(for_user_id, matched_user_id)
);

CREATE INDEX idx_kevin_intro_suggestions_user ON kevin_intro_suggestions (for_user_id, status);

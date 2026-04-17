CREATE TABLE angel_scores (
    founder_user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    score INTEGER NOT NULL,
    team_score INTEGER,
    market_score INTEGER,
    traction_score INTEGER,
    pitch_score INTEGER,
    reasoning TEXT,
    generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE kevin_matches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    for_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    matched_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    match_type TEXT NOT NULL,
    score INTEGER NOT NULL,
    reasoning TEXT,
    generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(for_user_id, matched_user_id, match_type)
);

CREATE INDEX idx_kevin_matches_for_user ON kevin_matches (for_user_id, generated_at DESC);

CREATE TABLE investor_pipeline (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    investor_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    founder_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    stage TEXT NOT NULL DEFAULT 'watching',
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (investor_user_id, founder_user_id)
);

CREATE INDEX idx_investor_pipeline_investor ON investor_pipeline (investor_user_id);

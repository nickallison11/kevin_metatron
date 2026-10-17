-- Public startup ratings ("Community Score"). Three mutually-exclusive
-- reviewer identity tiers -- platform account, reviewer-only account, or an
-- identified-but-no-account submitter -- enforced by the CHECK below.
-- `weight` is captured at submission time (not recomputed later) so past
-- aggregates don't silently shift if the weight constants change; it's only
-- recalculated when a rating is edited (re-upserted).
CREATE TABLE startup_ratings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    startup_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    platform_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    reviewer_account_id UUID REFERENCES reviewer_accounts(id) ON DELETE CASCADE,
    anon_email TEXT,
    anon_name TEXT,
    anon_ip_hash TEXT,

    tier TEXT NOT NULL CHECK (tier IN ('platform', 'reviewer', 'anonymous')),

    overall_stars SMALLINT NOT NULL CHECK (overall_stars BETWEEN 1 AND 5),
    team_score SMALLINT CHECK (team_score BETWEEN 1 AND 5),
    market_score SMALLINT CHECK (market_score BETWEEN 1 AND 5),
    traction_score SMALLINT CHECK (traction_score BETWEEN 1 AND 5),
    product_score SMALLINT CHECK (product_score BETWEEN 1 AND 5),
    comment TEXT CHECK (comment IS NULL OR char_length(comment) <= 500),

    weight NUMERIC(3,2) NOT NULL,

    verified_at TIMESTAMPTZ,
    verification_token TEXT,

    is_flagged BOOLEAN NOT NULL DEFAULT FALSE,
    flag_reason TEXT,
    moderated_at TIMESTAMPTZ,
    moderated_by UUID REFERENCES users(id),

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT startup_ratings_one_identity CHECK (
        (tier = 'platform'  AND platform_user_id IS NOT NULL AND reviewer_account_id IS NULL AND anon_email IS NULL) OR
        (tier = 'reviewer'  AND reviewer_account_id IS NOT NULL AND platform_user_id IS NULL AND anon_email IS NULL) OR
        (tier = 'anonymous' AND anon_email IS NOT NULL AND platform_user_id IS NULL AND reviewer_account_id IS NULL)
    ),
    -- One rating per identity per startup, editable not stackable. Postgres
    -- treats multiple NULLs as distinct, so these three constraints don't
    -- collide with each other across tiers.
    CONSTRAINT startup_ratings_unique_platform UNIQUE (startup_user_id, platform_user_id),
    CONSTRAINT startup_ratings_unique_reviewer UNIQUE (startup_user_id, reviewer_account_id),
    CONSTRAINT startup_ratings_unique_anon UNIQUE (startup_user_id, anon_email)
);

CREATE INDEX IF NOT EXISTS startup_ratings_startup_idx ON startup_ratings (startup_user_id) WHERE is_flagged = FALSE;
CREATE INDEX IF NOT EXISTS startup_ratings_flagged_idx ON startup_ratings (is_flagged) WHERE is_flagged = TRUE;
CREATE INDEX IF NOT EXISTS startup_ratings_ip_recent_idx ON startup_ratings (anon_ip_hash, startup_user_id, created_at);

-- Founders review investors they've connected with (the mirror of startup_ratings).
-- One review per founder per investor; editable. Tags are what the review form
-- offers as one-tap chips; the profile shows the share of reviewers who picked each.
CREATE TABLE IF NOT EXISTS investor_ratings (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    investor_user_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reviewer_user_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    overall_stars     SMALLINT NOT NULL CHECK (overall_stars BETWEEN 1 AND 5),
    responded_fast    BOOLEAN NOT NULL DEFAULT FALSE,
    useful_feedback   BOOLEAN NOT NULL DEFAULT FALSE,
    founder_friendly  BOOLEAN NOT NULL DEFAULT FALSE,
    would_pitch_again BOOLEAN NOT NULL DEFAULT FALSE,
    comment           TEXT CHECK (comment IS NULL OR char_length(comment) <= 1000),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (investor_user_id, reviewer_user_id)
);

CREATE INDEX IF NOT EXISTS investor_ratings_investor_idx ON investor_ratings (investor_user_id);

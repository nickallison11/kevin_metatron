CREATE TABLE IF NOT EXISTS investor_matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  startup_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  investor_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  matched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  week_start DATE NOT NULL,
  UNIQUE(startup_user_id, investor_user_id, week_start)
);
CREATE INDEX IF NOT EXISTS investor_matches_startup_week_idx ON investor_matches(startup_user_id, week_start);

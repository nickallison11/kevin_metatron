ALTER TABLE investor_profiles
  ADD COLUMN IF NOT EXISTS investor_tier TEXT NOT NULL DEFAULT 'free';

CREATE TABLE IF NOT EXISTS investment_memos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    investor_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    founder_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(investor_user_id, founder_user_id)
);
CREATE INDEX IF NOT EXISTS idx_investment_memos_investor ON investment_memos(investor_user_id);

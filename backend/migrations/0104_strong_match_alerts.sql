-- Kevin writes two reasons per match: `reasoning` for the person the match is
-- for, `intro_reasoning` for the other side (used in intro messages).
ALTER TABLE kevin_matches ADD COLUMN IF NOT EXISTS intro_reasoning TEXT;
-- Stage, sector, region and ticket size all fit (required for a strong-match alert).
ALTER TABLE kevin_matches ADD COLUMN IF NOT EXISTS hard_fit BOOLEAN;
ALTER TABLE users ADD COLUMN IF NOT EXISTS strong_match_alert_at TIMESTAMPTZ;

-- Founder-side reasons so far were written to the investor: keep them for intros.
UPDATE kevin_matches SET intro_reasoning = reasoning
 WHERE match_type = 'founder_investor' AND intro_reasoning IS NULL;

-- When Kevin first made the match (generated_at changes on every re-score),
-- and when it first went out in a weekly digest (weekly_email_sent_at is
-- cleared when an old match is shown again).
ALTER TABLE kevin_matches ADD COLUMN IF NOT EXISTS first_matched_at TIMESTAMPTZ;
ALTER TABLE kevin_matches ADD COLUMN IF NOT EXISTS first_sent_at TIMESTAMPTZ;

-- Best dates we have for existing matches.
UPDATE kevin_matches
   SET first_matched_at = LEAST(generated_at, COALESCE(weekly_email_sent_at, generated_at))
 WHERE first_matched_at IS NULL;
-- (Matches already queued to be shown again can't be told apart from
-- never-sent ones; they count as new once more.)
UPDATE kevin_matches
   SET first_sent_at = weekly_email_sent_at
 WHERE first_sent_at IS NULL AND weekly_email_sent_at IS NOT NULL;

ALTER TABLE kevin_matches ALTER COLUMN first_matched_at SET DEFAULT NOW();
ALTER TABLE kevin_matches ALTER COLUMN first_matched_at SET NOT NULL;

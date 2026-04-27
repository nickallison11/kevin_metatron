ALTER TABLE kevin_matches ADD COLUMN IF NOT EXISTS deck_viewed_at TIMESTAMPTZ;
ALTER TABLE kevin_matches ADD COLUMN IF NOT EXISTS intro_accepted_at TIMESTAMPTZ;
ALTER TABLE kevin_matches ADD COLUMN IF NOT EXISTS intro_passed_at TIMESTAMPTZ;
ALTER TABLE investor_profiles ADD COLUMN IF NOT EXISTS pass_message_template TEXT;

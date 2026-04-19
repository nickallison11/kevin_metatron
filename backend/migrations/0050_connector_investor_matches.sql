-- Allow connector network contacts as kevin match candidates
ALTER TABLE kevin_matches
  ALTER COLUMN matched_user_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS contact_id UUID REFERENCES connector_network_contacts(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS display_name TEXT,
  ADD COLUMN IF NOT EXISTS display_one_liner TEXT,
  ADD COLUMN IF NOT EXISTS display_sector TEXT,
  ADD COLUMN IF NOT EXISTS display_stage TEXT,
  ADD COLUMN IF NOT EXISTS display_country TEXT;

-- Replace the single unique constraint with two partial indexes
ALTER TABLE kevin_matches
  DROP CONSTRAINT kevin_matches_for_user_id_matched_user_id_match_type_key;

CREATE UNIQUE INDEX kevin_matches_user_unique
  ON kevin_matches (for_user_id, matched_user_id, match_type)
  WHERE matched_user_id IS NOT NULL;

CREATE UNIQUE INDEX kevin_matches_contact_unique
  ON kevin_matches (for_user_id, contact_id, match_type)
  WHERE contact_id IS NOT NULL;

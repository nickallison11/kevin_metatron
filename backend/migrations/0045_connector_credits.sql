ALTER TABLE connector_profiles
  ADD COLUMN IF NOT EXISTS enrichment_credits INTEGER NOT NULL DEFAULT 0;

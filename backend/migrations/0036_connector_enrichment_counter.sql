ALTER TABLE connector_profiles
    ADD COLUMN IF NOT EXISTS enrichments_this_month INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS enrichments_month_start DATE;

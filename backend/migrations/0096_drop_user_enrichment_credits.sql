-- Founder enrichment credits (0094) were dropped the same day: importing a
-- deck with Kevin is simply part of Basic and Pro.
ALTER TABLE users DROP COLUMN IF EXISTS enrichment_credits;

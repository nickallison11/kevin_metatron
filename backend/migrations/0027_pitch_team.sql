ALTER TABLE pitches
  ADD COLUMN IF NOT EXISTS team_size integer,
  ADD COLUMN IF NOT EXISTS incorporation_country text,
  ADD COLUMN IF NOT EXISTS team_members jsonb;

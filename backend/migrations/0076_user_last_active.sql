-- Backs real idle-timeout enforcement (as opposed to the refresh token's
-- sliding 30-day absolute cap, which has no activity signal at all).
-- DEFAULT now() backfills existing rows as "active as of migration time" so
-- nobody is retroactively logged out the moment this ships.
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMPTZ NOT NULL DEFAULT now();

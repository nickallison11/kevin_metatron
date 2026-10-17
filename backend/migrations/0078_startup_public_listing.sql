-- Public startup directory opt-out flag. Defaults TRUE (opt-out, not
-- opt-in) so existing founders are listed immediately; they can turn it
-- off in settings.
ALTER TABLE profiles
    ADD COLUMN IF NOT EXISTS is_publicly_listed BOOLEAN NOT NULL DEFAULT TRUE;

CREATE INDEX IF NOT EXISTS profiles_publicly_listed_idx ON profiles (is_publicly_listed);

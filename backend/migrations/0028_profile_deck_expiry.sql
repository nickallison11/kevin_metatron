ALTER TABLE profiles ADD COLUMN IF NOT EXISTS deck_expires_at timestamptz;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS deck_upload_count integer NOT NULL DEFAULT 0;

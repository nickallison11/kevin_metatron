ALTER TABLE connector_profiles
    ADD COLUMN IF NOT EXISTS connector_tier TEXT NOT NULL DEFAULT 'free',
    ADD COLUMN IF NOT EXISTS ipfs_cid TEXT,
    ADD COLUMN IF NOT EXISTS ipfs_updated_at TIMESTAMPTZ;

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS ipfs_visibility TEXT NOT NULL DEFAULT 'private';

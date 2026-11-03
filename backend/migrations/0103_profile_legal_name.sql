-- The registered company name (e.g. "Acme (Pty) Ltd"), kept apart from the
-- startup name investors see.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS legal_name TEXT;

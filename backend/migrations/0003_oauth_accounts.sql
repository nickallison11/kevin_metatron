-- Allow OAuth users who have no password
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;

-- OAuth provider accounts linked to platform users
CREATE TABLE oauth_accounts (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider     TEXT NOT NULL,
    provider_uid TEXT NOT NULL,
    access_token TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (provider, provider_uid)
);


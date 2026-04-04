-- Extend existing investor_profiles (0001) with platform fields
ALTER TABLE investor_profiles
    ADD COLUMN IF NOT EXISTS firm_name TEXT,
    ADD COLUMN IF NOT EXISTS bio TEXT,
    ADD COLUMN IF NOT EXISTS investment_thesis TEXT,
    ADD COLUMN IF NOT EXISTS ticket_size_min BIGINT,
    ADD COLUMN IF NOT EXISTS ticket_size_max BIGINT,
    ADD COLUMN IF NOT EXISTS country TEXT,
    ADD COLUMN IF NOT EXISTS is_accredited BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS connector_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    organisation TEXT,
    bio TEXT,
    speciality TEXT,
    country TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS connections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    from_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    to_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    connection_type TEXT NOT NULL DEFAULT 'follow',
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(from_user_id, to_user_id)
);

CREATE INDEX IF NOT EXISTS connections_from_user_idx ON connections (from_user_id);
CREATE INDEX IF NOT EXISTS connections_to_user_idx ON connections (to_user_id);

ALTER TABLE introductions
    ADD COLUMN IF NOT EXISTS broker_user_id UUID REFERENCES users(id);

CREATE TABLE IF NOT EXISTS referrals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    referrer_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    email TEXT,
    referred_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS referrals_referrer_idx ON referrals (referrer_user_id);

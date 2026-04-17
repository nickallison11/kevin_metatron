-- Connector-managed introductions (brokered between two people in the connector's network)
CREATE TABLE IF NOT EXISTS connector_introductions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    connector_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    person_a_name TEXT NOT NULL,
    person_a_email TEXT,
    person_b_name TEXT NOT NULL,
    person_b_email TEXT,
    notes TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_connector_intros_user ON connector_introductions(connector_user_id);

-- referrals exists from 0011_role_profiles.sql; align with connector referral program
ALTER TABLE referrals ADD COLUMN IF NOT EXISTS referred_email TEXT;
UPDATE referrals SET referred_email = email WHERE referred_email IS NULL AND email IS NOT NULL;

ALTER TABLE referrals ADD COLUMN IF NOT EXISTS credits_awarded INTEGER NOT NULL DEFAULT 0;

ALTER TABLE connector_profiles ADD COLUMN IF NOT EXISTS referral_code TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS connector_profiles_referral_code_uq
    ON connector_profiles (referral_code)
    WHERE referral_code IS NOT NULL;

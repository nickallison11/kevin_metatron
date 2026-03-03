-- Core users and organizations

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    country_code CHAR(2) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TYPE user_role AS ENUM ('STARTUP', 'INVESTOR', 'INTERMEDIARY', 'ADMIN');

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role user_role NOT NULL,
    organization_id UUID REFERENCES organizations(id),
    jurisdiction_country CHAR(2),
    is_accredited BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Profiles

CREATE TABLE startup_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) UNIQUE,
    organization_id UUID NOT NULL REFERENCES organizations(id),
    sector TEXT,
    stage TEXT,
    headline TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE investor_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) UNIQUE,
    organization_id UUID REFERENCES organizations(id),
    min_check_size NUMERIC,
    max_check_size NUMERIC,
    sectors TEXT[],
    stages TEXT[],
    geographies TEXT[],
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE intermediary_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) UNIQUE,
    specializations TEXT[],
    geographies TEXT[],
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Pitches and versions

CREATE TABLE pitches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    created_by UUID NOT NULL REFERENCES users(id),
    title TEXT NOT NULL,
    description TEXT,
    sector TEXT,
    stage TEXT,
    target_raise NUMERIC,
    currency CHAR(3) DEFAULT 'USD',
    jurisdiction_country CHAR(2),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE pitch_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pitch_id UUID NOT NULL REFERENCES pitches(id) ON DELETE CASCADE,
    version_number INTEGER NOT NULL,
    storage_url TEXT NOT NULL,
    storage_hash TEXT NOT NULL,
    onchain_record_address TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (pitch_id, version_number)
);

-- Pools and eligibility

CREATE TABLE funding_pools (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    description TEXT,
    target_size NUMERIC,
    currency CHAR(3) DEFAULT 'USD',
    sectors TEXT[],
    stages TEXT[],
    geographies TEXT[],
    min_ticket NUMERIC,
    max_ticket NUMERIC,
    accepts_fiat BOOLEAN DEFAULT TRUE,
    accepts_stablecoin BOOLEAN DEFAULT FALSE,
    stablecoin_mint_address TEXT,
    onchain_manifest_address TEXT,
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE pool_memberships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pool_id UUID NOT NULL REFERENCES funding_pools(id) ON DELETE CASCADE,
    investor_user_id UUID NOT NULL REFERENCES users(id),
    committed_amount NUMERIC,
    currency CHAR(3) DEFAULT 'USD',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (pool_id, investor_user_id)
);

CREATE TYPE pool_pitch_status AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

CREATE TABLE pool_pitch_eligibility (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pool_id UUID NOT NULL REFERENCES funding_pools(id) ON DELETE CASCADE,
    pitch_id UUID NOT NULL REFERENCES pitches(id) ON DELETE CASCADE,
    status pool_pitch_status NOT NULL DEFAULT 'PENDING',
    decided_by UUID REFERENCES users(id),
    decided_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (pool_id, pitch_id)
);

-- KYC / AML

CREATE TYPE kyc_status AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED');

CREATE TABLE kyc_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) UNIQUE,
    provider_name TEXT,
    provider_reference TEXT,
    status kyc_status NOT NULL DEFAULT 'PENDING',
    last_checked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TYPE aml_status AS ENUM ('PENDING', 'CLEAR', 'FLAGGED');

CREATE TABLE aml_screenings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    provider_name TEXT,
    provider_reference TEXT,
    status aml_status NOT NULL DEFAULT 'PENDING',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Investments

CREATE TYPE investment_currency_type AS ENUM ('FIAT', 'STABLECOIN');
CREATE TYPE investment_status AS ENUM ('INTENT', 'PENDING', 'CONFIRMED', 'CANCELLED');

CREATE TABLE investment_commitments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pool_id UUID NOT NULL REFERENCES funding_pools(id),
    pitch_id UUID REFERENCES pitches(id),
    investor_user_id UUID NOT NULL REFERENCES users(id),
    amount NUMERIC NOT NULL,
    currency CHAR(3) DEFAULT 'USD',
    currency_type investment_currency_type NOT NULL,
    status investment_status NOT NULL DEFAULT 'INTENT',
    onchain_tx_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- Where a founder stands on the way to funding, as Kevin last assessed it in
-- chat, and what's missing to reach the next stage.
CREATE TABLE IF NOT EXISTS founder_readiness (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    stage TEXT NOT NULL CHECK (stage IN ('build', 'accelerator', 'angels', 'seed', 'series_a', 'series_b', 'growth')),
    summary TEXT NOT NULL,
    gaps TEXT[] NOT NULL DEFAULT '{}',
    next_steps TEXT[] NOT NULL DEFAULT '{}',
    assessed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Incubators, accelerators, bootcamps and scale-up programmes Kevin can
-- recommend. Grows on its own: found by Kevin's web search (unverified),
-- reported by founders who did them, or added by connectors. Verified once
-- two founders report doing it, or a connector adds it.
CREATE TABLE IF NOT EXISTS programmes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    url TEXT,
    kind TEXT NOT NULL DEFAULT 'other' CHECK (kind IN ('incubator', 'accelerator', 'bootcamp', 'scaleup', 'other')),
    stages TEXT[] NOT NULL DEFAULT '{}',
    sectors TEXT[] NOT NULL DEFAULT '{}',
    location TEXT,
    summary TEXT,
    status TEXT NOT NULL DEFAULT 'unverified' CHECK (status IN ('unverified', 'verified', 'removed')),
    source TEXT NOT NULL CHECK (source IN ('search', 'founder', 'connector')),
    added_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_programmes_name ON programmes (LOWER(name));

-- A founder saying they did a programme, and whether it helped.
CREATE TABLE IF NOT EXISTS programme_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    programme_id UUID NOT NULL REFERENCES programmes(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    helpful BOOLEAN,
    detail TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (programme_id, user_id)
);

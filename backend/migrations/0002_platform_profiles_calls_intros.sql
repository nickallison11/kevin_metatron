-- Founder platform profile (distinct from legacy startup_profiles)
CREATE TABLE profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    company_name TEXT,
    one_liner TEXT,
    stage TEXT,
    sector TEXT,
    country CHAR(2),
    website TEXT,
    pitch_deck_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE call_recordings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    original_filename TEXT NOT NULL,
    stored_path TEXT NOT NULL,
    mime_type TEXT,
    transcript TEXT,
    analysis JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX call_recordings_user_id_idx ON call_recordings (user_id);

CREATE TABLE introductions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    investor_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    startup_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'PENDING',
    note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX introductions_investor_idx ON introductions (investor_user_id);
CREATE INDEX introductions_startup_idx ON introductions (startup_user_id);

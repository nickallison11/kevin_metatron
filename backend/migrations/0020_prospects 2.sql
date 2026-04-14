CREATE TABLE prospects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    linkedin_url TEXT,
    role TEXT,
    status TEXT NOT NULL CHECK (status IN ('contacted', 'responded', 'onboarded', 'declined')),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX prospects_status_idx ON prospects (status);
CREATE INDEX prospects_created_idx ON prospects (created_at DESC);

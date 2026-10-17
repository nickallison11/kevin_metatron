-- Lightweight "reviewer-only" accounts: exist solely to leave public startup
-- ratings, no dashboard, no onboarding. Deliberately decoupled from `users`
-- (no FK, no user_role enum value) so this never entangles with
-- founder/investor/connector routing. Magic-link auth only -- no
-- password_hash column.
CREATE TABLE reviewer_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL UNIQUE,
    name TEXT,
    email_verified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS reviewer_accounts_email_idx ON reviewer_accounts (LOWER(email));

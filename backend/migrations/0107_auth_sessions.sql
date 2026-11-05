-- One row per signed-in device. Refresh tokens rotate; the session they
-- belong to carries the sign-in time (30-day cap) and the device's own last
-- activity (7-day idle limit).
CREATE TABLE IF NOT EXISTS auth_sessions (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    started_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_active_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_id ON auth_sessions (user_id);

ALTER TABLE refresh_tokens
    ADD COLUMN IF NOT EXISTS session_id UUID REFERENCES auth_sessions(id) ON DELETE CASCADE;

-- Live tokens become sessions that start now, so nobody is signed out on
-- deploy; the 30 days count from here. Tokens without a session are dead.
INSERT INTO auth_sessions (id, user_id, started_at, last_active_at)
SELECT rt.id, rt.user_id, NOW(), u.last_active_at
  FROM refresh_tokens rt
  JOIN users u ON u.id = rt.user_id
 WHERE rt.revoked_at IS NULL AND rt.expires_at > NOW() AND rt.session_id IS NULL
ON CONFLICT (id) DO NOTHING;
UPDATE refresh_tokens
   SET session_id = id
 WHERE revoked_at IS NULL AND expires_at > NOW() AND session_id IS NULL;

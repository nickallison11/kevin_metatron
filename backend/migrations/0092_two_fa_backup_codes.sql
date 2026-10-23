-- One-time 2FA backup codes. Only a SHA-256 hash of each code is stored; the
-- codes themselves are shown to the user once, when they're generated.
CREATE TABLE IF NOT EXISTS two_fa_backup_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code_hash TEXT NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS two_fa_backup_codes_user_hash_idx
    ON two_fa_backup_codes (user_id, code_hash);

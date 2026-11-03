-- A new email address waits here until the user enters the code sent to it.
CREATE TABLE IF NOT EXISTS email_change_requests (
    user_id    UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    new_email  TEXT NOT NULL,
    code_hash  TEXT NOT NULL,
    attempts   INT NOT NULL DEFAULT 0,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

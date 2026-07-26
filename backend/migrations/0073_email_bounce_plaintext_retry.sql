ALTER TABLE email_send_log
    ADD COLUMN IF NOT EXISTS recipient_email TEXT,
    ADD COLUMN IF NOT EXISTS subject TEXT,
    ADD COLUMN IF NOT EXISTS plaintext_body TEXT,
    ADD COLUMN IF NOT EXISTS bounce_type TEXT,
    ADD COLUMN IF NOT EXISTS plaintext_resent_at TIMESTAMPTZ;

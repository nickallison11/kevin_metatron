-- WhatsApp/Telegram sign-up: confirm the email address with a 6-digit code
-- before the account is created.
ALTER TABLE messaging_onboarding
    ADD COLUMN IF NOT EXISTS email_code TEXT,
    ADD COLUMN IF NOT EXISTS email_code_expires_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS email_code_attempts INT NOT NULL DEFAULT 0;

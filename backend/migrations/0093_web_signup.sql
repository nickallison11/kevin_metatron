-- Home-page sign-up: the visitor picks founder or investor, gives an email,
-- a mobile number and WhatsApp or Telegram, then confirms the email with a
-- 6-digit code. The account is only created once the code checks out.
CREATE TABLE IF NOT EXISTS signup_pending (
    email TEXT PRIMARY KEY,
    phone TEXT NOT NULL,
    channel TEXT NOT NULL CHECK (channel IN ('whatsapp', 'telegram')),
    role TEXT NOT NULL CHECK (role IN ('founder', 'investor')),
    referral_code TEXT,
    code TEXT NOT NULL,
    code_expires_at TIMESTAMPTZ NOT NULL,
    code_attempts INT NOT NULL DEFAULT 0,
    last_sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- "Something else" answers from the sign-up flow: what people want Kevin to
-- do that he doesn't yet. No account is created for these.
CREATE TABLE IF NOT EXISTS signup_interest (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL,
    note TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- phone_number: digits with country code, no '+'. preferred_channel: the app
-- picked at sign-up ('whatsapp' or 'telegram'). channel_connected_at: when the
-- user first reached Kevin on that app, which ticks off the dashboard checklist.
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_number TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS preferred_channel TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS channel_connected_at TIMESTAMPTZ;

-- Existing accounts that already use Kevin on their phone count as connected,
-- so they don't get the first-message welcome.
UPDATE users SET channel_connected_at = now()
WHERE channel_connected_at IS NULL
  AND (whatsapp_number IS NOT NULL OR telegram_id IS NOT NULL);

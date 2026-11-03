-- WhatsApp links to an account only when the user sends Kevin a one-time
-- code from that number, so nobody can claim a number they don't own.
CREATE TABLE IF NOT EXISTS whatsapp_link_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code VARCHAR(8) NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_link_codes_code_active
    ON whatsapp_link_codes (code)
    WHERE used_at IS NULL;

CREATE INDEX IF NOT EXISTS whatsapp_link_codes_user_idx ON whatsapp_link_codes (user_id);

-- Numbers typed in at sign-up or on the web that never messaged Kevin were
-- never proven; drop them so they link with a code like everyone else.
UPDATE users SET whatsapp_number = NULL
WHERE whatsapp_number IS NOT NULL AND channel_connected_at IS NULL;

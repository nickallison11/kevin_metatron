-- Each user's current WhatsApp/Telegram conversation with Kevin, so he keeps
-- its history and tools there the same way as in web chat. A new
-- conversation starts after 6 hours without a message.
CREATE TABLE IF NOT EXISTS kevin_messaging_sessions (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    session_id UUID NOT NULL,
    last_message_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

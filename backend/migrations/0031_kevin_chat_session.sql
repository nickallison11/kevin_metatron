ALTER TABLE kevin_chat_turns ADD COLUMN IF NOT EXISTS session_id uuid;
CREATE INDEX IF NOT EXISTS kevin_chat_turns_session ON kevin_chat_turns (session_id);

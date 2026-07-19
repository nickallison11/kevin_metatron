-- Structured, provider-agnostic conversation memory for the Kevin web chat
-- widget. kevin_chat_turns (existing) stores plain display text for the
-- history sidebar only; this table stores the actual tool_call/tool_result
-- blocks so a follow-up turn can see real prior tool output instead of just
-- the assistant's paraphrased summary of it.
--
-- One row per logical provider message. `role`:
--   'user'      — the human's message (blocks: one text block)
--   'assistant' — Kevin's turn (blocks: text and/or tool_call blocks)
--   'tool'      — tool execution results (blocks: one or more tool_result
--                 blocks) — modeled as its own role here even though
--                 Anthropic/Gemini put these on a 'user'-role message at
--                 the wire level; conversion happens per-provider in
--                 kevin_context.rs.
CREATE TABLE kevin_chat_context (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    seq INTEGER NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'tool')),
    blocks JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (session_id, seq)
);

CREATE INDEX idx_kevin_chat_context_session ON kevin_chat_context (session_id, seq);

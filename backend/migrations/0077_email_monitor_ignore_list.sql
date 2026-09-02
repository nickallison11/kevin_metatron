-- Backs the n8n Email Monitor workflow's ignore-list nodes (Check Ignore
-- List / Add Sender To Ignore List), which hit /internal/email-ignore/*.
-- The route code (backend/src/routes/email_ignore.rs) shipped without this
-- table, so every check_ignored/add_ignored call 500'd — and since the n8n
-- "Check Ignore List" HTTP node has no error handling, that killed the whole
-- workflow execution right after IMAP had already marked the message read,
-- silently dropping inbound mail with zero classification/notify/label.
CREATE TABLE IF NOT EXISTS email_monitor_ignore_list (
    id BIGSERIAL PRIMARY KEY,
    pattern TEXT NOT NULL,
    match_type TEXT NOT NULL,
    reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (pattern, match_type)
);

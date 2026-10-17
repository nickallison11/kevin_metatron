-- Append-only deck-view log (mirrors email_send_log's event-log shape,
-- 0060_email_preferences_and_log.sql). One row per view, not a current-
-- state column, so founders can see a real history of who viewed their
-- deck and when.
CREATE TABLE deck_views (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    startup_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    viewer_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    viewer_ip_hash TEXT,
    source TEXT NOT NULL DEFAULT 'directory',
    viewed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS deck_views_startup_idx ON deck_views (startup_user_id, viewed_at DESC);

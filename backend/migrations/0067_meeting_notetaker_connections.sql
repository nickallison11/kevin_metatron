-- call_recordings.stored_path was NOT NULL, assuming every row came from a
-- manual upload. Notetaker-sourced recordings have no local file — store the
-- provider's transcript/video URL there instead, and tag the source so the
-- UI can distinguish "you uploaded this" from "imported from Fireflies".
ALTER TABLE call_recordings ALTER COLUMN stored_path DROP NOT NULL;
ALTER TABLE call_recordings ADD COLUMN source TEXT NOT NULL DEFAULT 'upload'
    CHECK (source IN ('upload', 'fireflies', 'fathom', 'tldv'));
ALTER TABLE call_recordings ADD COLUMN external_id TEXT;

-- One row per user per connected note-taker. api_key is encrypted at rest
-- with the same AES-256-GCM helper (crypto::encrypt) already used for
-- users.custom_ai_api_key.
CREATE TABLE meeting_notetaker_connections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider TEXT NOT NULL CHECK (provider IN ('fireflies', 'fathom', 'tldv')),
    api_key TEXT NOT NULL,
    connected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_synced_at TIMESTAMPTZ,
    last_sync_error TEXT,
    UNIQUE (user_id, provider)
);

-- Prevents a re-synced/re-listed transcript from becoming a duplicate
-- call_recordings row.
CREATE UNIQUE INDEX idx_call_recordings_source_external_id
    ON call_recordings (source, external_id)
    WHERE external_id IS NOT NULL;

ALTER TABLE connections
    ADD COLUMN IF NOT EXISTS requested_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS declined_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS connections_to_user_pending_idx
    ON connections (to_user_id)
    WHERE accepted_at IS NULL AND declined_at IS NULL;

-- Backfill from kevin_matches.intro_*_at. Idempotent via ON CONFLICT.
INSERT INTO connections (from_user_id, to_user_id, connection_type, status,
                         requested_at, accepted_at, declined_at, created_at)
SELECT
    km.for_user_id,
    km.matched_user_id,
    'connect'::text,
    CASE
        WHEN km.intro_accepted_at IS NOT NULL THEN 'accepted'
        WHEN km.intro_passed_at IS NOT NULL THEN 'declined'
        ELSE 'pending'
    END,
    km.intro_requested_at,
    km.intro_accepted_at,
    km.intro_passed_at,
    COALESCE(km.intro_requested_at, NOW())
FROM kevin_matches km
WHERE km.matched_user_id IS NOT NULL
  AND km.intro_requested_at IS NOT NULL
ON CONFLICT (from_user_id, to_user_id) DO UPDATE SET
    requested_at = COALESCE(connections.requested_at, EXCLUDED.requested_at),
    accepted_at  = COALESCE(connections.accepted_at,  EXCLUDED.accepted_at),
    declined_at  = COALESCE(connections.declined_at,  EXCLUDED.declined_at),
    status = CASE
        WHEN COALESCE(connections.accepted_at, EXCLUDED.accepted_at) IS NOT NULL THEN 'accepted'
        WHEN COALESCE(connections.declined_at, EXCLUDED.declined_at) IS NOT NULL THEN 'declined'
        ELSE 'pending'
    END;

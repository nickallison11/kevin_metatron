-- Auto-generated counterpart to kevin_knowledge: same shape (title, body,
-- role_target) so it plugs into the same build_context() injection point,
-- but populated by the weekly kevin-learning cron job mining outcome data
-- (introductions, kevin_matches, call_recordings, chat turns) instead of
-- being admin-authored. evidence_count records how many data points backed
-- each insight, so low-confidence patterns can be filtered at generation time.
CREATE TABLE kevin_insights (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    role_target TEXT NOT NULL DEFAULT 'all',
    evidence_count INTEGER NOT NULL,
    generated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

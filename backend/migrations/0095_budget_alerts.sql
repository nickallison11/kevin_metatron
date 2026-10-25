-- One row per budget alert sent (e.g. 'free-ai-2026-10'), so the email goes
-- out once per month however many backends or restarts notice it.
CREATE TABLE IF NOT EXISTS budget_alerts (
    period TEXT PRIMARY KEY,
    sent_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

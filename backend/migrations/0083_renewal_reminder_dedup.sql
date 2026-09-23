-- Dedup guard for the subscription renewal-reminder email. Unlike the
-- one-time deck-expiry flags, a subscription renews repeatedly, so a plain
-- boolean would only ever fire once, ever. Instead this stores the exact
-- subscription_period_end the reminder was last sent for -- the query only
-- sends again once period_end has actually advanced to a new cycle.
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS renewal_reminder_sent_for TIMESTAMPTZ;

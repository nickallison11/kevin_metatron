-- Backfill is_basic for accounts created via SQL after migration 0053 ran.
-- The sync_is_basic trigger only fires on UPDATE, not INSERT, so direct SQL
-- inserts leave is_basic at the FALSE default even for active basic subscribers.
UPDATE users
SET is_basic = TRUE
WHERE subscription_status = 'active'
  AND subscription_period_end IS NOT NULL
  AND subscription_period_end > NOW()
  AND subscription_plan = 'basic'
  AND is_basic = FALSE;

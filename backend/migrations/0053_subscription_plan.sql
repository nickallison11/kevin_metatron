-- Add subscription_plan to store plan level separately from billing period
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS subscription_plan TEXT NOT NULL DEFAULT 'free';

-- Add is_basic flag
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_basic BOOLEAN NOT NULL DEFAULT FALSE;

-- Backfill: all current active subscribers are on Basic (only plan available)
UPDATE users
SET subscription_plan = 'basic'
WHERE subscription_status = 'active'
AND subscription_period_end > NOW();

-- Update sync_is_pro to only fire for Pro plan
CREATE OR REPLACE FUNCTION sync_is_pro()
RETURNS TRIGGER AS $$
BEGIN
  NEW.is_pro := (
    NEW.subscription_status = 'active'
    AND NEW.subscription_period_end IS NOT NULL
    AND NEW.subscription_period_end > NOW()
    AND NEW.subscription_plan = 'pro'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create sync_is_basic trigger
CREATE OR REPLACE FUNCTION sync_is_basic()
RETURNS TRIGGER AS $$
BEGIN
  NEW.is_basic := (
    NEW.subscription_status = 'active'
    AND NEW.subscription_period_end IS NOT NULL
    AND NEW.subscription_period_end > NOW()
    AND NEW.subscription_plan = 'basic'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_is_basic ON users;
CREATE TRIGGER trg_sync_is_basic
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION sync_is_basic();

-- Backfill is_basic for current active subscribers
UPDATE users
SET is_basic = TRUE
WHERE subscription_status = 'active'
AND subscription_period_end > NOW()
AND subscription_plan = 'basic';

-- Current subscribers are Basic not Pro — reset is_pro
UPDATE users SET is_pro = FALSE WHERE is_pro = TRUE;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS subscription_tier TEXT NOT NULL DEFAULT 'free',
  ADD COLUMN IF NOT EXISTS subscription_status TEXT NOT NULL DEFAULT 'inactive',
  ADD COLUMN IF NOT EXISTS subscription_period_end TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sphere_subscription_id TEXT,
  ADD COLUMN IF NOT EXISTS pending_payment_nonce TEXT;

CREATE OR REPLACE FUNCTION sync_is_pro()
RETURNS TRIGGER AS $$
BEGIN
  NEW.is_pro := (
    NEW.subscription_status = 'active'
    AND NEW.subscription_period_end IS NOT NULL
    AND NEW.subscription_period_end > NOW()
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_is_pro ON users;
CREATE TRIGGER trg_sync_is_pro
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION sync_is_pro();

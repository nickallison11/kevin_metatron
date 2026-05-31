ALTER TABLE nowpayments_pending
    ADD COLUMN IF NOT EXISTS plan_level TEXT NOT NULL DEFAULT 'basic';

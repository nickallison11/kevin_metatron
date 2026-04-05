ALTER TABLE users
  ADD COLUMN IF NOT EXISTS paystack_subscription_code TEXT,
  ADD COLUMN IF NOT EXISTS paystack_email_token TEXT;

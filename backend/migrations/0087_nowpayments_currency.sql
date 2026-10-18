-- Currency a NowPayments invoice was priced in ("USD" or "EUR"), so the
-- confirmation records the invoice in the currency the customer saw.
ALTER TABLE nowpayments_pending
    ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'USD';

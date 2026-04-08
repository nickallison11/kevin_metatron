ALTER TABLE pitches
  ADD COLUMN IF NOT EXISTS problem text,
  ADD COLUMN IF NOT EXISTS solution text,
  ADD COLUMN IF NOT EXISTS market_size text,
  ADD COLUMN IF NOT EXISTS business_model text,
  ADD COLUMN IF NOT EXISTS traction text,
  ADD COLUMN IF NOT EXISTS funding_ask text,
  ADD COLUMN IF NOT EXISTS use_of_funds text;

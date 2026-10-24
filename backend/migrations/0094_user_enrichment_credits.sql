-- Enrichment credits for founders and investors (connectors keep theirs on
-- connector_profiles). A Free founder spends one to have Kevin read a deck;
-- Basic and Pro don't need them. Bought later through Stripe; until then
-- they're granted by hand.
ALTER TABLE users ADD COLUMN IF NOT EXISTS enrichment_credits INTEGER NOT NULL DEFAULT 0;

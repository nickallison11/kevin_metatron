-- Logos for every user (founder company, investor firm, connector): pulled from
-- their website / email domain first, or uploaded. Stored on IPFS and shown via
-- {FRONTEND_URL}/media/<cid>. logo_source: 'website' | 'upload'.
ALTER TABLE users ADD COLUMN IF NOT EXISTS logo_url TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS logo_source TEXT;

-- Investors and connectors had nowhere to put a website (founders use profiles.website).
ALTER TABLE investor_profiles ADD COLUMN IF NOT EXISTS website TEXT;
ALTER TABLE connector_profiles ADD COLUMN IF NOT EXISTS website TEXT;
ALTER TABLE connector_profiles ADD COLUMN IF NOT EXISTS linkedin_url TEXT;

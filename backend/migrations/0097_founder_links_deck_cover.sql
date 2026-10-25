-- The signed-up founder's own LinkedIn (their name already lives in
-- users.first_name / last_name).
ALTER TABLE users ADD COLUMN IF NOT EXISTS linkedin_url TEXT;

-- Company links, and facts about the uploaded deck: a PNG of its first page
-- ({FRONTEND_URL}/media/<cid>), its page count and when it was uploaded.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS company_linkedin_url TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS company_x_url TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS company_github_url TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS deck_cover_url TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS deck_pages INTEGER;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS deck_uploaded_at TIMESTAMPTZ;

-- Angel Score = Gemini's assessment (base_score) plus fixed points for each
-- founder/company link filled in, capped at 100. `score` stays the number
-- everything else reads.
ALTER TABLE angel_scores ADD COLUMN IF NOT EXISTS base_score INTEGER;
UPDATE angel_scores SET base_score = score WHERE base_score IS NULL;

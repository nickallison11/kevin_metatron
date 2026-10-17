-- Single source of truth for the weighted Community Score formula --
-- computed on read, not maintained via trigger (rating volume will be low
-- enough that this is cheap, and it avoids a trigger-consistency bug class).
-- Excludes flagged rows and anonymous-tier rows that haven't been email-
-- verified within 14 days of submission (still stored for audit/moderation,
-- just excluded from the public aggregate until/unless confirmed).
CREATE VIEW startup_community_scores AS
SELECT
    startup_user_id,
    COUNT(*) AS rating_count,
    ROUND((SUM(overall_stars * weight) / NULLIF(SUM(weight), 0))::numeric, 2) AS community_score,
    ROUND(AVG(team_score)::numeric, 2) AS avg_team_score,
    ROUND(AVG(market_score)::numeric, 2) AS avg_market_score,
    ROUND(AVG(traction_score)::numeric, 2) AS avg_traction_score,
    ROUND(AVG(product_score)::numeric, 2) AS avg_product_score
FROM startup_ratings
WHERE is_flagged = FALSE
  AND (tier != 'anonymous' OR verified_at IS NOT NULL OR created_at > NOW() - make_interval(days => 14))
GROUP BY startup_user_id;

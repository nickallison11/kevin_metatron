-- Decks no longer expire on any plan: clear existing expiry dates so
-- previously expired free decks are visible to investors again.
UPDATE profiles SET deck_expires_at = NULL WHERE deck_expires_at IS NOT NULL;

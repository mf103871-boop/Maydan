-- Preserve historical claims, including multiple old mode trials. New real
-- gameplay reservations share one trial across a game's local/online modes.
ALTER TABLE rewarded_match_claims ADD COLUMN game_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS rewarded_claims_game_trial
ON rewarded_match_claims(environment, user_id, game_key)
WHERE game_key IS NOT NULL AND source='trial' AND state IN ('reserved','committed');

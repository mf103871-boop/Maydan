-- A room claims the free match at its first valid start, never while waiting.
-- Account and device claims are inserted in one D1 batch; a second room cannot
-- race the same allowance. Old claims expire after one day (rooms live <= 6h).
CREATE TABLE IF NOT EXISTS online_room_trial_claims (user_id TEXT NOT NULL, game TEXT NOT NULL, claim_id TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (user_id, game));
CREATE INDEX IF NOT EXISTS online_room_trial_claims_created ON online_room_trial_claims (created_at);

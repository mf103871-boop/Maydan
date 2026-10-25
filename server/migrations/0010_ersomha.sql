-- Private drawing history is account scoped; lease fencing prevents two rooms
-- from exposing competing choices to the same account. Keep every SQL statement
-- on one line for D1 exec and the local migration adapter.
CREATE TABLE IF NOT EXISTS ersomha_leases (account_hash TEXT PRIMARY KEY, room_key TEXT NOT NULL, lease_token TEXT NOT NULL, fence INTEGER NOT NULL DEFAULT 1, expires_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS ersomha_leases_expiry ON ersomha_leases(expires_at);
CREATE TABLE IF NOT EXISTS ersomha_seen (account_hash TEXT NOT NULL, family_id TEXT NOT NULL, concept_id TEXT NOT NULL, exposure_id TEXT NOT NULL, seen_at INTEGER NOT NULL, seen_count INTEGER NOT NULL DEFAULT 1, PRIMARY KEY(account_hash,family_id));
CREATE INDEX IF NOT EXISTS ersomha_seen_concept ON ersomha_seen(account_hash,concept_id);
CREATE INDEX IF NOT EXISTS ersomha_seen_exposure ON ersomha_seen(exposure_id);

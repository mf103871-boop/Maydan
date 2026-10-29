-- Permanent Mafia progression receipts are independent of the 30-day replay.
-- Policy versions are data, never part of the exactly-once event identity.
CREATE TABLE IF NOT EXISTS mafia_progress_events (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  match_key TEXT NOT NULL,
  event_kind TEXT NOT NULL CHECK(event_kind = 'match_completed'),
  event_id TEXT NOT NULL,
  event_schema_version INTEGER NOT NULL CHECK(event_schema_version = 1),
  reward_policy_version INTEGER CHECK(reward_policy_version IS NULL OR reward_policy_version = 1),
  source TEXT NOT NULL CHECK(source IN ('live','legacy')),
  event_digest TEXT NOT NULL CHECK(length(event_digest) = 64),
  role_id TEXT NOT NULL,
  initial_faction TEXT NOT NULL CHECK(initial_faction IN ('town','mafia','shadow')),
  faction TEXT NOT NULL CHECK(faction IN ('town','mafia','shadow')),
  won INTEGER NOT NULL CHECK(won IN (0,1)),
  draw INTEGER NOT NULL CHECK(draw IN (0,1)),
  forfeited INTEGER NOT NULL CHECK(forfeited IN (0,1)),
  visibility TEXT CHECK(visibility IS NULL OR visibility IN ('public','private')),
  started_at INTEGER CHECK(started_at IS NULL OR started_at > 0),
  finished_at INTEGER NOT NULL CHECK(finished_at > 0),
  utc_day INTEGER NOT NULL CHECK(utc_day >= 0),
  status TEXT NOT NULL CHECK(status IN ('pending','processed')),
  claim_token TEXT NOT NULL,
  participation_granted INTEGER NOT NULL CHECK(participation_granted IN (0,1)),
  xp_awarded INTEGER NOT NULL CHECK(xp_awarded >= 0),
  exclusion_reason TEXT,
  processed_at INTEGER,
  PRIMARY KEY(user_id,match_key,event_kind),
  CHECK(won + draw <= 1),
  CHECK((status = 'pending' AND processed_at IS NULL) OR (status = 'processed' AND processed_at > 0)),
  CHECK(source != 'legacy' OR (reward_policy_version IS NULL AND participation_granted = 0 AND xp_awarded = 0))
);
CREATE INDEX IF NOT EXISTS mafia_progress_private_quota ON mafia_progress_events(user_id,utc_day,visibility,participation_granted,status);
CREATE TABLE IF NOT EXISTS mafia_player_progress (
  user_id TEXT NOT NULL PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  total_xp INTEGER NOT NULL DEFAULT 0 CHECK(total_xp >= 0),
  rewarded_matches INTEGER NOT NULL DEFAULT 0 CHECK(rewarded_matches >= 0),
  legacy_matches INTEGER NOT NULL DEFAULT 0 CHECK(legacy_matches >= 0),
  updated_at INTEGER NOT NULL CHECK(updated_at > 0)
);
CREATE TABLE IF NOT EXISTS mafia_role_progress (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id TEXT NOT NULL,
  qualified_matches INTEGER NOT NULL DEFAULT 0 CHECK(qualified_matches >= 0),
  wins INTEGER NOT NULL DEFAULT 0 CHECK(wins >= 0),
  draws INTEGER NOT NULL DEFAULT 0 CHECK(draws >= 0),
  legacy_matches INTEGER NOT NULL DEFAULT 0 CHECK(legacy_matches >= 0),
  updated_at INTEGER NOT NULL CHECK(updated_at > 0),
  PRIMARY KEY(user_id,role_id),
  CHECK(wins + draws <= qualified_matches)
);

-- Experimental ranked policy is isolated to the preview and never authorizes
-- activation in production. Existing match leases also reserve queued accounts.
CREATE TABLE IF NOT EXISTS mafia_ranked_seasons (
  id TEXT PRIMARY KEY,
  starts_at INTEGER NOT NULL,
  ends_at INTEGER NOT NULL CHECK(ends_at>starts_at),
  ruleset_version INTEGER NOT NULL CHECK(ruleset_version=1),
  rating_model TEXT NOT NULL CHECK(rating_model='preview-elo-1'),
  reward_policy INTEGER NOT NULL CHECK(reward_policy=1),
  status TEXT NOT NULL CHECK(status IN ('open','closing','closed')),
  closed_at INTEGER,
  close_token TEXT
);
INSERT OR IGNORE INTO mafia_ranked_seasons(id,starts_at,ends_at,ruleset_version,rating_model,reward_policy,status)
VALUES('preview-2026-01',1793318400000,1798156800000,1,'preview-elo-1',1,'open');
CREATE TABLE IF NOT EXISTS mafia_ranked_queue (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  season_id TEXT NOT NULL REFERENCES mafia_ranked_seasons(id),
  seat_id TEXT NOT NULL,
  match_seat_id TEXT,
  token_hash TEXT NOT NULL CHECK(length(token_hash)=64),
  queue_revision TEXT NOT NULL,
  session_id TEXT NOT NULL,
  joined_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  match_key TEXT,
  room_code TEXT,
  status TEXT NOT NULL CHECK(status IN ('queued','assigned'))
);
CREATE INDEX IF NOT EXISTS mafia_ranked_waiting ON mafia_ranked_queue(season_id,status,expires_at,joined_at);
CREATE TABLE IF NOT EXISTS mafia_ranked_understanding (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  policy_version INTEGER NOT NULL CHECK(policy_version=1),
  confirmed_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS mafia_ranked_matches (
  match_key TEXT PRIMARY KEY,
  season_id TEXT NOT NULL REFERENCES mafia_ranked_seasons(id),
  room_code TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('creating','playing','completed','aborted')),
  settled_at INTEGER,
  event_digest TEXT,
  settle_token TEXT
);
CREATE INDEX IF NOT EXISTS mafia_ranked_pending ON mafia_ranked_matches(status,created_at);
CREATE TABLE IF NOT EXISTS mafia_ranked_ratings (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  season_id TEXT NOT NULL REFERENCES mafia_ranked_seasons(id),
  rating INTEGER NOT NULL DEFAULT 1000 CHECK(rating BETWEEN 0 AND 3000),
  games INTEGER NOT NULL DEFAULT 0 CHECK(games>=0),
  wins INTEGER NOT NULL DEFAULT 0,
  forfeits INTEGER NOT NULL DEFAULT 0,
  cooldown_until INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(user_id,season_id)
);
CREATE TABLE IF NOT EXISTS mafia_ranked_receipts (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  match_key TEXT NOT NULL REFERENCES mafia_ranked_matches(match_key),
  season_id TEXT NOT NULL REFERENCES mafia_ranked_seasons(id),
  before_rating INTEGER NOT NULL,
  delta INTEGER NOT NULL,
  after_rating INTEGER NOT NULL,
  faction TEXT NOT NULL CHECK(faction IN ('town','mafia')),
  won INTEGER NOT NULL CHECK(won IN (0,1)),
  forfeited INTEGER NOT NULL CHECK(forfeited IN (0,1)),
  processed_at INTEGER NOT NULL,
  PRIMARY KEY(user_id,match_key)
);
CREATE TABLE IF NOT EXISTS mafia_ranked_season_snapshot (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  season_id TEXT NOT NULL REFERENCES mafia_ranked_seasons(id),
  rating INTEGER NOT NULL,
  games INTEGER NOT NULL,
  wins INTEGER NOT NULL,
  placement INTEGER NOT NULL,
  closed_at INTEGER NOT NULL,
  PRIMARY KEY(user_id,season_id)
);
-- A failed invariant rolls back the whole D1 batch rather than half an award.
CREATE TABLE IF NOT EXISTS mafia_ranked_atomic_guard (id TEXT PRIMARY KEY,value INTEGER NOT NULL CHECK(value=1));

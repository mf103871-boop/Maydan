-- Optional club metadata reuses the existing group and membership authorities.
CREATE TABLE IF NOT EXISTS mafia_clubs (
  group_id TEXT PRIMARY KEY REFERENCES social_groups(id) ON DELETE CASCADE,
  motto TEXT NOT NULL,
  created_at INTEGER NOT NULL CHECK(created_at>0),
  revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0)
);
CREATE TABLE IF NOT EXISTS mafia_club_credits (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  match_key TEXT NOT NULL,
  group_id TEXT NOT NULL REFERENCES social_groups(id) ON DELETE CASCADE,
  finished_at INTEGER NOT NULL,
  credited_at INTEGER NOT NULL,
  PRIMARY KEY(user_id,match_key)
);
CREATE INDEX IF NOT EXISTS mafia_club_credit_group ON mafia_club_credits(group_id,finished_at,user_id);
CREATE TABLE IF NOT EXISTS mafia_tournaments (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES social_groups(id) ON DELETE CASCADE,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  starts_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  locked_at INTEGER,
  closed_at INTEGER,
  state TEXT NOT NULL CHECK(state IN ('registration','locked','closed','cancelled')),
  revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0),
  template_json TEXT NOT NULL,
  client_id TEXT NOT NULL,
  creation_hash TEXT NOT NULL,
  UNIQUE(group_id,client_id)
);
CREATE INDEX IF NOT EXISTS mafia_tournament_group ON mafia_tournaments(group_id,created_at);
CREATE TABLE IF NOT EXISTS mafia_tournament_members (
  tournament_id TEXT NOT NULL REFERENCES mafia_tournaments(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at INTEGER NOT NULL,
  PRIMARY KEY(tournament_id,user_id)
);
CREATE TABLE IF NOT EXISTS mafia_tournament_matches (
  tournament_id TEXT NOT NULL REFERENCES mafia_tournaments(id) ON DELETE CASCADE,
  match_key TEXT NOT NULL UNIQUE,
  event_digest TEXT NOT NULL,
  finished_at INTEGER NOT NULL,
  accepted_at INTEGER NOT NULL,
  PRIMARY KEY(tournament_id,match_key)
);
CREATE TABLE IF NOT EXISTS mafia_tournament_points (
  tournament_id TEXT NOT NULL REFERENCES mafia_tournaments(id) ON DELETE CASCADE,
  match_key TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  points INTEGER NOT NULL CHECK(points BETWEEN 0 AND 3),
  PRIMARY KEY(tournament_id,match_key,user_id),
  FOREIGN KEY(tournament_id,match_key) REFERENCES mafia_tournament_matches(tournament_id,match_key) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS mafia_tournament_awards (
  tournament_id TEXT NOT NULL REFERENCES mafia_tournaments(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  points INTEGER NOT NULL CHECK(points>=0),
  place INTEGER NOT NULL CHECK(place>=1),
  awarded_at INTEGER NOT NULL,
  PRIMARY KEY(tournament_id,user_id)
);

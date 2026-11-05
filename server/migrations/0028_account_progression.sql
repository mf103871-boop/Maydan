-- Cross-game account progression. Legacy stats and Mafia role progress stay separate.
ALTER TABLE player_sessions ADD COLUMN progression_reward_version INTEGER;

CREATE TABLE IF NOT EXISTS player_progression (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  total_xp INTEGER NOT NULL CHECK(total_xp >= 0),
  qualified_matches INTEGER NOT NULL CHECK(qualified_matches >= 0),
  hosted_sessions INTEGER NOT NULL CHECK(hosted_sessions >= 0),
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS game_mastery (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game TEXT NOT NULL CHECK(game IN ('ersomha','mafia')),
  completed INTEGER NOT NULL CHECK(completed > 0),
  PRIMARY KEY(user_id,game)
);
CREATE TABLE IF NOT EXISTS progression_events (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL,
  source TEXT NOT NULL CHECK(source IN ('local','online')),
  game TEXT NOT NULL,
  reward_rule_version INTEGER NOT NULL CHECK(reward_rule_version > 0),
  ruleset_version INTEGER NOT NULL CHECK(ruleset_version > 0),
  finished_at INTEGER NOT NULL,
  not_before INTEGER NOT NULL CHECK(not_before >= finished_at),
  xp_awarded INTEGER NOT NULL CHECK(xp_awarded >= 0),
  xp_after INTEGER CHECK(xp_after >= xp_awarded),
  mastery_delta INTEGER NOT NULL CHECK(mastery_delta IN (0,1)),
  exclusion_reason TEXT CHECK(exclusion_reason IN ('local_daily_cap')),
  claim_token TEXT NOT NULL,
  PRIMARY KEY(user_id,event_id)
);
CREATE INDEX IF NOT EXISTS progression_events_local_day ON progression_events(user_id,source,finished_at,xp_awarded);
CREATE TABLE IF NOT EXISTS progression_cosmetic_grants (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL,
  level INTEGER NOT NULL CHECK(level BETWEEN 1 AND 100),
  event_id TEXT NOT NULL,
  granted_at INTEGER NOT NULL,
  PRIMARY KEY(user_id,item_id),
  FOREIGN KEY(user_id,event_id) REFERENCES progression_events(user_id,event_id) ON DELETE CASCADE
);

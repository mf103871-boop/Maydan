-- Earned licenses outlive Plus and the 30-day replay. They contain no roster,
-- chat, choices or gameplay rights; deletion of the account removes them.
CREATE TABLE IF NOT EXISTS mafia_achievements (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  achievement_id TEXT NOT NULL,
  earned_at INTEGER NOT NULL CHECK(earned_at > 0),
  earned_match_key TEXT NOT NULL,
  PRIMARY KEY(user_id,achievement_id)
);
CREATE INDEX IF NOT EXISTS mafia_achievement_match ON mafia_achievements(user_id,earned_match_key);
CREATE TABLE IF NOT EXISTS mafia_cosmetic_grants (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL,
  source TEXT NOT NULL CHECK(source = 'mafia_achievement'),
  achievement_id TEXT NOT NULL,
  granted_at INTEGER NOT NULL CHECK(granted_at > 0),
  revoked_at INTEGER CHECK(revoked_at IS NULL OR revoked_at > 0),
  PRIMARY KEY(user_id,item_id),
  FOREIGN KEY(user_id,achievement_id) REFERENCES mafia_achievements(user_id,achievement_id) ON DELETE CASCADE
);

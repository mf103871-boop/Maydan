-- Only the terminal tutorial status is synchronized. Decisions, dialogue,
-- checkpoints, roles and clocks remain on the player's device.
CREATE TABLE mafia_tutorial_status (
  user_id TEXT NOT NULL PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  scenario_version INTEGER NOT NULL CHECK(scenario_version > 0),
  ruleset_version INTEGER NOT NULL CHECK(ruleset_version > 0),
  status TEXT NOT NULL CHECK(status IN ('skipped', 'completed')),
  updated_at INTEGER NOT NULL CHECK(updated_at > 0)
);

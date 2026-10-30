-- Publish immutable reviewed evidence separately from the existing v1 season.
-- Existing seasons keep the exact v1 policy unless a future binding is created.
CREATE TABLE IF NOT EXISTS mafia_rating_policies (
  id TEXT PRIMARY KEY CHECK(length(id)=64),
  policy_json TEXT NOT NULL CHECK(json_valid(policy_json)),
  report_json TEXT NOT NULL CHECK(json_valid(report_json)),
  report_sha256 TEXT NOT NULL CHECK(length(report_sha256)=64),
  dataset_sha256 TEXT NOT NULL CHECK(length(dataset_sha256)=64),
  status TEXT NOT NULL CHECK(status='reviewed-supplied-evidence'),
  created_at INTEGER NOT NULL,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS mafia_ranked_season_policy (
  season_id TEXT PRIMARY KEY REFERENCES mafia_ranked_seasons(id),
  policy_id TEXT NOT NULL REFERENCES mafia_rating_policies(id),
  linked_at INTEGER NOT NULL,
  linked_by TEXT REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS mafia_ranked_season_policy_id ON mafia_ranked_season_policy(policy_id);

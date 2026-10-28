-- Cosmetic preferences are private; only the server's effective projection is public.
CREATE TABLE IF NOT EXISTS plus_cosmetics (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  selection_json TEXT NOT NULL DEFAULT '{}',
  revision INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS plus_setup_presets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  game TEXT NOT NULL,
  schema_version INTEGER NOT NULL DEFAULT 1,
  settings_json TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS plus_setup_presets_owner ON plus_setup_presets(user_id,updated_at,id);

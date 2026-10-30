-- A chosen historical representative is independent of the secret live role.
CREATE TABLE IF NOT EXISTS mafia_profile_preferences (
  user_id TEXT NOT NULL PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  visibility TEXT NOT NULL DEFAULT 'private' CHECK(visibility IN ('private','friends','public')),
  representative_role_id TEXT,
  revision INTEGER NOT NULL DEFAULT 0 CHECK(revision >= 0),
  updated_at INTEGER NOT NULL CHECK(updated_at > 0)
);

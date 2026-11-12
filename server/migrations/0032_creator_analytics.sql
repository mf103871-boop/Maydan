-- No identity or creator grant is seeded. A separately verified user ID may be
-- granted access by an authorized operator; client email is never an authority.
CREATE TABLE IF NOT EXISTS creator_access (user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)), created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS creator_presence (user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, last_seen_at INTEGER NOT NULL, pulse_id TEXT NOT NULL, game TEXT CHECK(game IS NULL OR game IN ('badeeha','beep','mamnoo','jabeen','fabraka','meenfina','ersomha','mafia')), mode TEXT NOT NULL CHECK(mode IN ('none','local','online')), screen TEXT NOT NULL CHECK(screen IN ('home','friends','store','profile','settings','creator','game-setup','game-lobby','game-playing','game-results')), membership_verified INTEGER NOT NULL CHECK(membership_verified IN (0,1)));
CREATE INDEX IF NOT EXISTS creator_presence_seen ON creator_presence(last_seen_at);
CREATE TABLE IF NOT EXISTS creator_daily_users (day TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, hour_bits INTEGER NOT NULL CHECK(hour_bits BETWEEN 0 AND 16777215), PRIMARY KEY(day,user_id));
CREATE INDEX IF NOT EXISTS creator_daily_users_account ON creator_daily_users(user_id);
CREATE TABLE IF NOT EXISTS creator_daily (day TEXT PRIMARY KEY, unique_players INTEGER NOT NULL DEFAULT 0, peak_online INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS creator_hourly (day TEXT NOT NULL, hour INTEGER NOT NULL CHECK(hour BETWEEN 0 AND 23), unique_players INTEGER NOT NULL DEFAULT 0, peak_online INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(day,hour));
CREATE TABLE IF NOT EXISTS creator_state (id INTEGER PRIMARY KEY CHECK(id=1), started_at INTEGER, last_sample_at INTEGER NOT NULL DEFAULT 0, last_sample_bucket TEXT, sample_id TEXT, sampled_online INTEGER NOT NULL DEFAULT 0, peak_online INTEGER NOT NULL DEFAULT 0, last_cleanup_at INTEGER NOT NULL DEFAULT 0, cleanup_id TEXT, capacity_limited_at INTEGER);
CREATE INDEX IF NOT EXISTS creator_registered_accounts_created ON users(created_at);

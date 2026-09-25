-- Social data uses the existing account IDs. Cleanup is explicit, matching accounts.
CREATE TABLE IF NOT EXISTS social_profiles (user_id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, last_active_at INTEGER NOT NULL DEFAULT 0, online_until INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS social_friendships (id TEXT NOT NULL UNIQUE, user_low TEXT NOT NULL, user_high TEXT NOT NULL, requester_id TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('pending','accepted')), created_at INTEGER NOT NULL, accepted_at INTEGER, PRIMARY KEY(user_low,user_high), CHECK(user_low < user_high), CHECK(requester_id = user_low OR requester_id = user_high));
CREATE INDEX IF NOT EXISTS social_friendships_high ON social_friendships(user_high,status);
CREATE TABLE IF NOT EXISTS social_blocks (blocker_id TEXT NOT NULL, blocked_id TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(blocker_id,blocked_id), CHECK(blocker_id != blocked_id));
CREATE INDEX IF NOT EXISTS social_blocks_reverse ON social_blocks(blocked_id,blocker_id);
CREATE TABLE IF NOT EXISTS social_conversations (id TEXT PRIMARY KEY, user_low TEXT NOT NULL, user_high TEXT NOT NULL, created_at INTEGER NOT NULL, UNIQUE(user_low,user_high), CHECK(user_low < user_high));
CREATE INDEX IF NOT EXISTS social_conversations_high ON social_conversations(user_high);
CREATE TABLE IF NOT EXISTS social_messages (seq INTEGER PRIMARY KEY AUTOINCREMENT, conversation_id TEXT NOT NULL, sender_id TEXT NOT NULL, client_id TEXT NOT NULL, text TEXT NOT NULL, original_hash TEXT NOT NULL, created_at INTEGER NOT NULL, edited_at INTEGER, deleted_at INTEGER, UNIQUE(sender_id,client_id));
CREATE INDEX IF NOT EXISTS social_messages_conversation_seq ON social_messages(conversation_id,seq);
CREATE INDEX IF NOT EXISTS social_messages_sender_created ON social_messages(sender_id,created_at);
CREATE TABLE IF NOT EXISTS social_reads (conversation_id TEXT NOT NULL, user_id TEXT NOT NULL, last_read_seq INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL, PRIMARY KEY(conversation_id,user_id));
CREATE TABLE IF NOT EXISTS social_reports (id TEXT PRIMARY KEY, reporter_id TEXT NOT NULL, reported_id TEXT NOT NULL, message_seq INTEGER, message_text TEXT, reason TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS social_reports_reported_created ON social_reports(reported_id,created_at);
CREATE TABLE IF NOT EXISTS social_limits (user_id TEXT NOT NULL, kind TEXT NOT NULL, window_start INTEGER NOT NULL, count INTEGER NOT NULL, PRIMARY KEY(user_id,kind));

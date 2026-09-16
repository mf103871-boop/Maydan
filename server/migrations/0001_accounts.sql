-- ترحيل 0001: جداول الحسابات و«ميدان بلس».
-- كل جملة في سطر واحد: D1 `exec` يقسم المدخل على الأسطر، فالجملة متعددة الأسطر تفشل هناك.
-- الحذف المتسلسل يُنفَّذ في الكود (deleteUser) لأن D1 لا يفعّل PRAGMA foreign_keys افتراضيًا.
CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT, email TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS identities (provider TEXT NOT NULL, subject TEXT NOT NULL, user_id TEXT NOT NULL, email TEXT, refresh_token TEXT, created_at INTEGER NOT NULL, PRIMARY KEY (provider, subject));
CREATE INDEX IF NOT EXISTS identities_user ON identities (user_id);
CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, secret_hash TEXT NOT NULL, client TEXT, created_at INTEGER NOT NULL, last_seen INTEGER NOT NULL, expires_at INTEGER NOT NULL, revoked_at INTEGER, replaced_by TEXT);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions (user_id);
CREATE TABLE IF NOT EXISTS auth_codes (code_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, client TEXT NOT NULL, expires_at INTEGER NOT NULL, used_at INTEGER);
CREATE TABLE IF NOT EXISTS subscriptions (source TEXT NOT NULL, external_id TEXT NOT NULL, user_id TEXT NOT NULL, product TEXT, status TEXT, until INTEGER NOT NULL DEFAULT 0, will_renew INTEGER NOT NULL DEFAULT 0, environment TEXT, occurred_at INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL, PRIMARY KEY (source, external_id));
CREATE INDEX IF NOT EXISTS subscriptions_user ON subscriptions (user_id);
CREATE TABLE IF NOT EXISTS trials (user_id TEXT NOT NULL, game TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (user_id, game));
CREATE TABLE IF NOT EXISTS webhook_events (id TEXT PRIMARY KEY, received_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS paddle_customers (user_id TEXT PRIMARY KEY, customer_id TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL);

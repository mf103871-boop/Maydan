-- Durable single-flight reservation. No expiry: a timed-out POST may have
-- created a billable transaction. Only confirmed provider state releases it.
CREATE TABLE IF NOT EXISTS paddle_checkouts (environment TEXT NOT NULL CHECK (environment IN ('sandbox', 'production')), user_id TEXT NOT NULL, attempt_id TEXT NOT NULL UNIQUE, plan TEXT NOT NULL, price_id TEXT NOT NULL, state TEXT NOT NULL, transaction_id TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (environment, user_id));
CREATE TABLE IF NOT EXISTS account_deletions (user_id TEXT PRIMARY KEY, attempt_id TEXT NOT NULL, created_at INTEGER NOT NULL);

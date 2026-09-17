-- Keep every legacy mapping intact. Its environment was never recorded, so do
-- not relabel it as production or sandbox. The application verifies a legacy ID
-- against the selected Paddle account before adopting it into this new table.
CREATE TABLE IF NOT EXISTS paddle_customers_scoped (environment TEXT NOT NULL CHECK (environment IN ('sandbox', 'production')), user_id TEXT NOT NULL, customer_id TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (environment, user_id), UNIQUE (environment, customer_id));

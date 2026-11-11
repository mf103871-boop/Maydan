-- Permanent licenses are separate from subscription access and cosmetic choices.
-- A provider adapter must verify each paid/refund event before these rows exist.
CREATE TABLE IF NOT EXISTS plus_commerce_events (
  provider TEXT NOT NULL,
  environment TEXT NOT NULL,
  event_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  external_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK(event_type IN ('paid','refunded','revoked')),
  payload_hash TEXT NOT NULL,
  occurred_at INTEGER NOT NULL CHECK(occurred_at > 0),
  processed_at INTEGER NOT NULL CHECK(processed_at > 0),
  PRIMARY KEY(provider,environment,event_id)
);
CREATE INDEX IF NOT EXISTS plus_commerce_event_owner ON plus_commerce_events(user_id,processed_at);
CREATE TABLE IF NOT EXISTS plus_commerce_orders (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  environment TEXT NOT NULL,
  external_id TEXT NOT NULL,
  kind TEXT CHECK(kind IS NULL OR kind IN ('purchase','subscription')),
  offer_id TEXT,
  product_id TEXT,
  item_ids_json TEXT NOT NULL DEFAULT '[]',
  paid_start INTEGER,
  paid_end INTEGER,
  billing_interval TEXT CHECK(billing_interval IS NULL OR billing_interval IN ('monthly','yearly')),
  amount_minor INTEGER,
  currency TEXT,
  identity_hash TEXT,
  status TEXT NOT NULL CHECK(status IN ('paid','refunded','revoked')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(provider,environment,external_id)
);
CREATE INDEX IF NOT EXISTS plus_commerce_order_owner ON plus_commerce_orders(user_id,created_at,id);
CREATE TABLE IF NOT EXISTS plus_monthly_windows (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  order_id TEXT NOT NULL REFERENCES plus_commerce_orders(id) ON DELETE CASCADE,
  window_index INTEGER NOT NULL CHECK(window_index >= 0 AND window_index < 12),
  due_at INTEGER NOT NULL CHECK(due_at > 0),
  drop_id TEXT,
  item_id TEXT,
  granted_at INTEGER,
  revoked_at INTEGER,
  UNIQUE(order_id,window_index)
);
CREATE INDEX IF NOT EXISTS plus_monthly_window_due ON plus_monthly_windows(granted_at,revoked_at,due_at,id);
CREATE TABLE IF NOT EXISTS plus_inventory_grants (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK(source_type IN ('store','monthly')),
  source_id TEXT NOT NULL,
  order_id TEXT NOT NULL REFERENCES plus_commerce_orders(id) ON DELETE CASCADE,
  granted_at INTEGER NOT NULL CHECK(granted_at > 0),
  revoked_at INTEGER,
  UNIQUE(user_id,item_id,source_type,source_id)
);
CREATE INDEX IF NOT EXISTS plus_inventory_owner ON plus_inventory_grants(user_id,revoked_at,item_id);

-- Design Studio: existing accounts own access; drafts and snapshots never grant roles.
CREATE TABLE IF NOT EXISTS design_draft (id TEXT PRIMARY KEY CHECK(id='main'),document_json TEXT,revision INTEGER NOT NULL DEFAULT 0,updated_by TEXT,updated_at INTEGER NOT NULL DEFAULT 0);
INSERT OR IGNORE INTO design_draft(id) VALUES('main');
CREATE TABLE IF NOT EXISTS design_versions (id TEXT PRIMARY KEY,name TEXT NOT NULL,document_json TEXT NOT NULL,document_hash TEXT NOT NULL,schema_version INTEGER NOT NULL,registry_version INTEGER NOT NULL,source_revision INTEGER NOT NULL,created_by TEXT NOT NULL,created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS design_publication (id TEXT PRIMARY KEY CHECK(id='main'),version_id TEXT,revision INTEGER NOT NULL DEFAULT 0,updated_by TEXT,updated_at INTEGER NOT NULL DEFAULT 0);
INSERT OR IGNORE INTO design_publication(id) VALUES('main');
CREATE TABLE IF NOT EXISTS design_previews (user_id TEXT PRIMARY KEY,version_id TEXT NOT NULL,updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS design_assets (id TEXT PRIMARY KEY,object_key TEXT NOT NULL UNIQUE,name TEXT NOT NULL,mime TEXT NOT NULL,width INTEGER NOT NULL,height INTEGER NOT NULL,byte_length INTEGER NOT NULL,sha256 TEXT NOT NULL,created_by TEXT NOT NULL,created_at INTEGER NOT NULL,ready_at INTEGER,published_at INTEGER);
CREATE TABLE IF NOT EXISTS design_version_assets (version_id TEXT NOT NULL,asset_id TEXT NOT NULL,PRIMARY KEY(version_id,asset_id));
CREATE TABLE IF NOT EXISTS design_actions (seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,actor_id TEXT NOT NULL,action TEXT NOT NULL,version_id TEXT,previous_version_id TEXT,draft_revision INTEGER,published_revision INTEGER,created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS design_versions_created ON design_versions(created_at,id);
CREATE INDEX IF NOT EXISTS design_assets_created ON design_assets(created_at,id);

-- Stickers are immutable catalogue references. Old clients retain readable text.
ALTER TABLE social_messages ADD COLUMN sticker_id TEXT;
ALTER TABLE social_messages ADD COLUMN sticker_version INTEGER;
ALTER TABLE social_reports ADD COLUMN sticker_id TEXT;
ALTER TABLE social_reports ADD COLUMN sticker_version INTEGER;
-- SQLite cannot extend a CHECK in place. Preserve sequence numbers, tombstones,
-- idempotency keys and the high-water mark even when the newest row was deleted.
CREATE TABLE social_group_messages_plus (seq INTEGER PRIMARY KEY AUTOINCREMENT,group_id TEXT NOT NULL,sender_id TEXT NOT NULL,client_id TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN ('text','voice','room_invite','sticker')),text TEXT NOT NULL,attachment_id TEXT,room_invite_id TEXT,original_hash TEXT NOT NULL,created_at INTEGER NOT NULL,edited_at INTEGER,deleted_at INTEGER,sticker_id TEXT,sticker_version INTEGER,UNIQUE(sender_id,client_id));
INSERT INTO social_group_messages_plus(seq,group_id,sender_id,client_id,kind,text,attachment_id,room_invite_id,original_hash,created_at,edited_at,deleted_at) SELECT seq,group_id,sender_id,client_id,kind,text,attachment_id,room_invite_id,original_hash,created_at,edited_at,deleted_at FROM social_group_messages;
INSERT INTO sqlite_sequence(name,seq) SELECT 'social_group_messages_plus',seq FROM sqlite_sequence WHERE name='social_group_messages' AND NOT EXISTS(SELECT 1 FROM sqlite_sequence WHERE name='social_group_messages_plus');
UPDATE sqlite_sequence SET seq=MAX(seq,COALESCE((SELECT seq FROM sqlite_sequence WHERE name='social_group_messages'),0)) WHERE name='social_group_messages_plus';
DROP TABLE social_group_messages;
ALTER TABLE social_group_messages_plus RENAME TO social_group_messages;
CREATE INDEX social_group_messages_group ON social_group_messages(group_id,seq);

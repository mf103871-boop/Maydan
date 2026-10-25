-- Optional creation identity for clients retrying a lost acknowledgement.
-- Existing groups and older clients retain NULL identities and their old IDs.
ALTER TABLE social_groups ADD COLUMN creator_id TEXT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE social_groups ADD COLUMN creation_client_id TEXT;
ALTER TABLE social_groups ADD COLUMN creation_hash TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS social_groups_creation ON social_groups(creator_id,creation_client_id) WHERE creation_client_id IS NOT NULL;

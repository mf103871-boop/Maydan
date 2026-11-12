-- Current and earlier terms acceptances. No IP, device fingerprint or birth date.
-- Account deletion must call termsDeleteStatements; do not rely on FK settings.
CREATE TABLE IF NOT EXISTS legal_terms_acceptances (user_id TEXT NOT NULL, terms_version TEXT NOT NULL, document_hash TEXT NOT NULL, locale TEXT NOT NULL CHECK(locale IN ('ar','en')), accepted_at INTEGER NOT NULL CHECK(accepted_at>0), PRIMARY KEY(user_id,terms_version), FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE);

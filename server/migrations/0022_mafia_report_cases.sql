-- Extend the existing Mafia evidence and social moderation queue; decisions and
-- sanctions remain in moderation_actions/moderation_report_decisions.
ALTER TABLE mafia_reports ADD COLUMN request_hash TEXT;
ALTER TABLE mafia_reports ADD COLUMN category TEXT NOT NULL DEFAULT 'other' CHECK(category IN ('harassment','cheating','disruption','inappropriate','other'));
ALTER TABLE mafia_reports ADD COLUMN match_id INTEGER;
ALTER TABLE mafia_reports ADD COLUMN review_started_at INTEGER;
ALTER TABLE mafia_reports ADD COLUMN reviewer_id TEXT;
CREATE INDEX IF NOT EXISTS mafia_report_owner ON mafia_reports(reporter_id,created_at);

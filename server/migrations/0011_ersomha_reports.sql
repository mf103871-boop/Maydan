-- Private evidence is copied only when a participant reports a drawing.
-- It follows social_reports retention and account deletion, not public assets.
CREATE TABLE IF NOT EXISTS ersomha_drawing_reports (
  report_id TEXT PRIMARY KEY,
  request_hash TEXT NOT NULL,
  reporter_id TEXT NOT NULL,
  reported_id TEXT NOT NULL,
  room_code TEXT NOT NULL,
  match_id TEXT NOT NULL,
  turn INTEGER NOT NULL,
  evidence_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ersomha_drawing_reports_users ON ersomha_drawing_reports(reporter_id, reported_id);
CREATE INDEX IF NOT EXISTS ersomha_drawing_reports_created ON ersomha_drawing_reports(created_at);

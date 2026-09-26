-- ترحيل 0006: تشديدات مراجعة 26 سبتمبر 2026.
-- ربط رمز الدخول لمرة واحدة بالمتصفح الذي بدأ التدفق (بصمة محاولة يحملها العميل وحده).
CREATE TABLE IF NOT EXISTS auth_code_attempts (code_hash TEXT PRIMARY KEY, attempt_hash TEXT NOT NULL, expires_at INTEGER NOT NULL);
-- فهارس لمسح التنظيف اليومي وعدّ بلاغات المُبلِّغ.
CREATE INDEX IF NOT EXISTS sessions_expires ON sessions (expires_at);
CREATE INDEX IF NOT EXISTS sessions_revoked ON sessions (revoked_at);
CREATE INDEX IF NOT EXISTS webhook_events_received ON webhook_events (received_at);
CREATE INDEX IF NOT EXISTS social_reports_reporter_created ON social_reports (reporter_id, created_at);
CREATE INDEX IF NOT EXISTS social_messages_created ON social_messages (created_at);

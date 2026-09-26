// تنظيف دوري (Cron Trigger): الجلسات المنتهية أو المبطلة قديمًا، رموز الدخول
// المنتهية، وسجل أحداث webhooks القديم، وصفوف حجز الحذف العالقة، والرسائل والبلاغات
// الأقدم من نافذة الاحتفاظ. لا يمسّ المستخدمين ولا الاشتراكات.
import { run, DELETION_STALE_MS } from './db.mjs';

export const SESSION_RETENTION_MS = 30 * 86_400_000;   // بعد الانتهاء/الإبطال
export const WEBHOOK_RETENTION_MS = 90 * 86_400_000;   // نافذة منع التكرار أطول بكثير من إعادة إرسال المزوّدين
// الاحتفاظ بالمحادثات والبلاغات: سنة افتراضيًا، ويضبطها المالك عبر متغيّرات البيئة
// SOCIAL_MESSAGE_RETENTION_DAYS وSOCIAL_REPORT_RETENTION_DAYS (٣٠ يومًا حدًّا أدنى).
const days = (value, fallback) => Math.max(30, Number(value) || fallback) * 86_400_000;
export const messageRetentionMs = (env) => days(env.SOCIAL_MESSAGE_RETENTION_DAYS, 365);
export const reportRetentionMs = (env) => days(env.SOCIAL_REPORT_RETENTION_DAYS, 365);

export async function cleanup(env, now = Date.now()) {
  if (!env.DB) return { skipped: true };
  const count = (result) => (result && result.meta && Number.isFinite(result.meta.changes) ? result.meta.changes : 0);
  const sessions = await run(env, 'DELETE FROM sessions WHERE expires_at < ? OR (revoked_at IS NOT NULL AND revoked_at < ?)', now - SESSION_RETENTION_MS, now - SESSION_RETENTION_MS);
  const codes = await run(env, 'DELETE FROM auth_codes WHERE expires_at < ?', now - 3_600_000);
  await run(env, 'DELETE FROM auth_code_attempts WHERE expires_at < ?', now - 3_600_000);
  const events = await run(env, 'DELETE FROM webhook_events WHERE received_at < ?', now - WEBHOOK_RETENTION_MS);
  const deletions = await run(env, 'DELETE FROM account_deletions WHERE created_at < ?', now - DELETION_STALE_MS);
  const messages = await run(env, 'DELETE FROM social_messages WHERE created_at < ?', now - messageRetentionMs(env));
  const reports = await run(env, 'DELETE FROM social_reports WHERE created_at < ?', now - reportRetentionMs(env));
  return { sessions: count(sessions), authCodes: count(codes), webhookEvents: count(events),
    staleDeletions: count(deletions), messages: count(messages), reports: count(reports) };
}

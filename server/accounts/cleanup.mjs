// تنظيف دوري (Cron Trigger): الجلسات المنتهية أو المبطلة قديمًا، رموز الدخول
// المنتهية، وسجل أحداث webhooks القديم. لا يمسّ المستخدمين ولا الاشتراكات.
import { run } from './db.mjs';

export const SESSION_RETENTION_MS = 30 * 86_400_000;   // بعد الانتهاء/الإبطال
export const WEBHOOK_RETENTION_MS = 90 * 86_400_000;   // نافذة منع التكرار أطول بكثير من إعادة إرسال المزوّدين

export async function cleanup(env, now = Date.now()) {
  if (!env.DB) return { skipped: true };
  const sessions = await run(env, 'DELETE FROM sessions WHERE expires_at < ? OR (revoked_at IS NOT NULL AND revoked_at < ?)', now - SESSION_RETENTION_MS, now - SESSION_RETENTION_MS);
  const codes = await run(env, 'DELETE FROM auth_codes WHERE expires_at < ?', now - 3_600_000);
  const events = await run(env, 'DELETE FROM webhook_events WHERE received_at < ?', now - WEBHOOK_RETENTION_MS);
  const count = (result) => (result && result.meta && Number.isFinite(result.meta.changes) ? result.meta.changes : 0);
  return { sessions: count(sessions), authCodes: count(codes), webhookEvents: count(events) };
}

import { fail } from '../room-model.mjs';

export function isModerator(env, userId) {
  return [env.MODERATOR_USER_IDS, env.MODERATOR_ADDITIONAL_USER_IDS]
    .flatMap(value => String(value || '').split(',')).map(id => id.trim())
    .filter(id => /^[A-Za-z0-9_-]{1,80}$/.test(id)).includes(userId);
}
export async function assertModeratorSession(env, actor, now = Date.now()) {
  if (!isModerator(env, actor.userId)) fail('FORBIDDEN', 403);
  const clock = "MAX(?,CAST(ROUND((julianday('now')-2440587.5)*86400000) AS INTEGER))";
  const current = await env.DB.prepare(`SELECT 1 FROM sessions s JOIN users u ON u.id=s.user_id
    WHERE s.id=? AND s.user_id=? AND s.expires_at>${clock} AND (s.revoked_at IS NULL OR s.revoked_at>${clock})
    AND NOT EXISTS(SELECT 1 FROM account_deletions WHERE user_id=s.user_id)
    AND NOT EXISTS(SELECT 1 FROM moderation_suspensions WHERE user_id=s.user_id)`)
    .bind(actor.sessionId, actor.userId, now, now).first();
  if (!current) fail('AUTH_EXPIRED', 401);
}
export const suspensionOf = async (env, userId) => env.DB && userId ? env.DB.prepare(
  'SELECT reason,created_at AS since FROM moderation_suspensions WHERE user_id=?').bind(userId).first() : null;
export async function assertNotSuspended(env, userId) {
  if (await suspensionOf(env,userId)) fail('ACCOUNT_SUSPENDED',403);
}
export const liveAccountSql = alias => `EXISTS(SELECT 1 FROM users u WHERE u.id=${alias}
  AND NOT EXISTS(SELECT 1 FROM moderation_suspensions s WHERE s.user_id=u.id))
  AND NOT EXISTS(SELECT 1 FROM account_deletions d WHERE d.user_id=${alias})`;
export const approvedImageSql = (alias,kind) => `EXISTS(SELECT 1 FROM moderation_image_approvals ma
  WHERE ma.user_id=${alias}.user_id AND ma.kind='${kind}' AND ma.version=${alias}.${kind}_version AND ma.hidden_at IS NULL)`;

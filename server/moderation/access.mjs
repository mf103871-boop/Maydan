import { fail } from '../room-model.mjs';

export function isModerator(env, userId) {
  return String(env.MODERATOR_USER_IDS || '').split(',').map(id => id.trim())
    .filter(id => /^[A-Za-z0-9_-]{1,80}$/.test(id)).includes(userId);
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

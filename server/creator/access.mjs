import { fail } from '../room-model.mjs';
import { liveAccountSql } from '../moderation/access.mjs';

export function missingCreatorSchema(error) {
  for (let current=error,depth=0;current && depth<5;current=current.cause,depth++) {
    if (/\bno such table:\s*(?:main\.)?creator_(?:access|presence|daily_users|daily|hourly|state)\b/i.test(String(current.message||''))) return true;
  }
  return false;
}
export const collectionEnabled = env => env.CREATOR_ANALYTICS_ENABLED !== '0';
const disabled = () => ({enabled:false,analytics:false,presence:false,heartbeatSeconds:30,onlineWindowSeconds:90});
export async function getCreatorCapabilities(env,userId) {
  if (!env.DB || !userId || !collectionEnabled(env)) return disabled();
  try {
    const row = await env.DB.prepare(`SELECT EXISTS(SELECT 1 FROM creator_access c WHERE c.user_id=u.id AND c.enabled=1) AS enabled
      FROM users u WHERE u.id=? AND ${liveAccountSql('u.id')}`).bind(userId).first();
    if (!row) return disabled();
    return {enabled:row.enabled===1,analytics:row.enabled===1,presence:true,heartbeatSeconds:30,onlineWindowSeconds:90};
  } catch (error) { if (missingCreatorSchema(error)) return disabled(); throw error; }
}
// D1 may wait after the request captured `now`. Authorization must use the
// statement's clock, including milliseconds: whole-second rounding would still
// accept a session revoked later within that same second. Keep the bound time
// as a lower limit so deterministic future-time tests remain conservative.
const freshSqlClock = "MAX(?,CAST(strftime('%s','now') AS INTEGER)*1000+CAST(substr(strftime('%f','now'),4,3) AS INTEGER))";
export const actorPredicate = `EXISTS(SELECT 1 FROM sessions auth WHERE auth.id=? AND auth.user_id=? AND auth.secret_hash=? AND auth.expires_at>${freshSqlClock}
  AND (auth.revoked_at IS NULL OR auth.revoked_at>${freshSqlClock}) AND ${liveAccountSql('auth.user_id')})`;
export const actorArgs = (actor,now) => [actor.sessionId,actor.userId,actor.secretHash,now,now];
export async function assertCurrentActor(env,actor,now=Date.now(),creator=false) {
  if(!actor?.secretHash)fail('AUTH_EXPIRED',401);
  let row;
  try {
    row = await env.DB.prepare(`SELECT expires_at,revoked_at,secret_hash${creator?',EXISTS(SELECT 1 FROM creator_access c WHERE c.user_id=s.user_id AND c.enabled=1) AS creator_enabled':''}
      FROM sessions s WHERE s.id=? AND ${actorPredicate}`).bind(actor.sessionId,...actorArgs(actor,now)).first();
  } catch(error) { if (creator && missingCreatorSchema(error)) fail('CREATOR_UNAVAILABLE',503); throw error; }
  // Recheck after the await too. This closes sub-millisecond differences between
  // SQLite and the Worker clock without rounding a real revocation into grace.
  const checkedAt=Math.max(now,Date.now());
  if (!row || row.expires_at<=checkedAt || row.revoked_at!=null && row.revoked_at<=checkedAt) fail('AUTH_EXPIRED',401);
  if (creator && !row.creator_enabled) fail('FORBIDDEN',403);
  return {expiresAt:row.expires_at,revokedAt:row.revoked_at??null,secretHash:row.secret_hash};
}

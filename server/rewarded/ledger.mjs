import { subscriptionsOf } from '../accounts/db.mjs';
import { premiumActive, premiumOf } from '../accounts/entitlements.mjs';
import { liveAccountSql } from '../moderation/access.mjs';
import { fail } from '../room-model.mjs';
import { rewardedEnvironment, rewardedLedgerEnvironment, rewardedPreviewUserHash } from './settings.mjs';

export { rewardedEnvironment } from './settings.mjs';

export const rewardedOffers = Object.freeze([
  Object.freeze({ id: 'badeeha-demo', game: 'badeeha', mode: 'local', label: 'بديهة · فئة المعاينة' }),
  Object.freeze({ id: 'meenfina-demo', game: 'meenfina', mode: 'online', label: 'مين فينا · غرفة المعاينة' }),
]);
export const rewardedOffer = id => rewardedOffers.find(offer => offer.id === id) || null;
export const rewardedMatchId = value => typeof value === 'string' && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/.test(value);
export function requireRewardedOffer(env, offer) {
  const environment = rewardedEnvironment(env);
  if (!environment || !rewardedOffer(offer)) fail('REWARDED_UNAVAILABLE', 404);
  return environment;
}

function accountCondition(alias, environment) {
  const live = liveAccountSql(alias);
  if (environment === 'local') return live;
  return live + ` AND EXISTS(SELECT 1 FROM identities i WHERE i.user_id=${alias} AND i.provider IN ('apple','google'))`;
}

export async function assertRewardedAccount(env, userId) {
  const environment = rewardedEnvironment(env);
  if (!environment) fail('REWARDED_UNAVAILABLE', 404);
  if (environment === 'ios-preview' && await rewardedPreviewUserHash(userId) !== env.REWARDED_PREVIEW_USER_SHA256) {
    fail('REWARDED_ACCOUNT', 403);
  }
  const valid = typeof userId === 'string' && await env.DB.prepare(
    `WITH account(user_id) AS (VALUES(?)) SELECT 1 FROM account a WHERE ${accountCondition('a.user_id', environment)}`
  ).bind(userId).first();
  if (!valid) fail('REWARDED_ACCOUNT', 403);
}

export async function rewardedPlus(env, userId, now) {
  return premiumActive(premiumOf(await subscriptionsOf(env, userId), now, env), now);
}

// The eligibility read and reservation execute in one D1 write statement. A
// reserved claim hides its resource from every other device until commit/release.
export const availableTicketSql = (env = 'q.environment', user = 'q.user_id', offer = 'q.offer') => `SELECT a.id
  FROM rewarded_attempts a WHERE a.environment=${env} AND a.user_id=${user} AND a.offer=${offer}
  AND a.state='verified' AND NOT EXISTS(SELECT 1 FROM rewarded_match_claims c
    WHERE c.ticket_id=a.id AND c.state IN ('reserved','committed'))
  ORDER BY a.verified_at, a.id LIMIT 1`;
const trialExists = `EXISTS(SELECT 1 FROM rewarded_match_claims c
  WHERE c.environment=q.environment AND c.user_id=q.user_id AND c.offer=q.offer
  AND c.source='trial' AND c.state IN ('reserved','committed'))`;
const reservedExists = `EXISTS(SELECT 1 FROM rewarded_match_claims c
  WHERE c.environment=q.environment AND c.user_id=q.user_id AND c.offer=q.offer
  AND c.source IN ('trial','ticket') AND c.state='reserved')`;
const query = `WITH q(environment,user_id,offer) AS (VALUES(?,?,?))`;

export async function rewardedAccess(env, userId, offer, now = Date.now()) {
  const environment = requireRewardedOffer(env, offer);
  if (await rewardedPlus(env, userId, now)) return 'plus';
  const row = await env.DB.prepare(`${query} SELECT CASE
    WHEN ${reservedExists} THEN 'busy'
    WHEN NOT ${trialExists} THEN 'trial'
    WHEN (${availableTicketSql()}) IS NOT NULL THEN 'ticket'
    ELSE 'required' END AS access FROM q`).bind(environment, userId, offer).first();
  return row.access;
}

function claimEnvironment(env, { offer, userId, matchId }, active = true) {
  const environment = active ? requireRewardedOffer(env, offer) : rewardedLedgerEnvironment(env);
  if (!environment || !rewardedOffer(offer)) fail('REWARDED_UNAVAILABLE', 404);
  if (!userId || !rewardedMatchId(matchId)) fail('INVALID');
  return environment;
}

export async function rewardedMatchClaim(env, claim) {
  const environment = claimEnvironment(env, claim, false);
  return env.DB.prepare(`SELECT match_id AS matchId,source,state FROM rewarded_match_claims
    WHERE match_id=? AND environment=? AND user_id=? AND offer=?`)
    .bind(claim.matchId, environment, claim.userId, claim.offer).first();
}

async function claimRewardedMatch(env, claim, state, now) {
  const environment = claimEnvironment(env, claim);
  const { userId, offer, matchId } = claim;
  await assertRewardedAccount(env, userId);
  const prior = await rewardedMatchClaim(env, claim);
  if (prior && prior.state !== 'released') return prior;
  if (prior) fail('REWARDED_BUSY', 409);

  const plus = await rewardedPlus(env, userId, now);
  await env.DB.prepare(`${query}, candidate AS (
    SELECT q.*, CASE WHEN ?=1 THEN 'plus'
      WHEN ${reservedExists} THEN NULL WHEN NOT ${trialExists} THEN 'trial'
      ELSE 'ticket' END AS source, (${availableTicketSql()}) AS ticket_id FROM q
    WHERE ${accountCondition('q.user_id', environment)}
  ) INSERT OR IGNORE INTO rewarded_match_claims (match_id,environment,user_id,offer,source,ticket_id,state,updated_at)
    SELECT ?,environment,user_id,offer,source,CASE WHEN source='ticket' THEN ticket_id END,?,?
    FROM candidate WHERE source IS NOT NULL AND (source<>'ticket' OR ticket_id IS NOT NULL)`)
    .bind(environment, userId, offer, Number(plus), matchId, state, now).run();
  const found = await rewardedMatchClaim(env, claim);
  if (found && found.state !== 'released') return found;
  if (found || (await rewardedAccess(env, userId, offer, now)) === 'busy') fail('REWARDED_BUSY', 409);
  fail('REWARDED_REQUIRED', 403);
}

export const reserveRewardedMatch = (env, claim, now = Date.now()) => claimRewardedMatch(env, claim, 'reserved', now);

export async function startRewardedLocalMatch(env, claim, now = Date.now()) {
  if (rewardedOffer(claim.offer)?.mode !== 'local') fail('REWARDED_UNAVAILABLE', 404);
  // The client has already prepared and persisted this match ID. A single D1
  // write confirms the start without leaving a local reservation stranded.
  const result = await claimRewardedMatch(env, claim, 'committed', now);
  if (result.state !== 'committed') fail('REWARDED_BUSY', 409);
  return result;
}

export async function commitRewardedMatch(env, claim, now = Date.now()) {
  const environment = claimEnvironment(env, claim, false);
  await env.DB.prepare(`UPDATE rewarded_match_claims SET state='committed',updated_at=?
    WHERE match_id=? AND environment=? AND user_id=? AND offer=? AND state='reserved'`)
    .bind(now, claim.matchId, environment, claim.userId, claim.offer).run();
  const result = await rewardedMatchClaim(env, claim);
  if (!result && !await env.DB.prepare('SELECT 1 FROM users WHERE id=?').bind(claim.userId).first()) {
    return { matchId: claim.matchId, source: null, state: 'erased' };
  }
  if (result?.state !== 'committed') fail('REWARDED_BUSY', 409);
  return result;
}

export async function releaseRewardedMatch(env, claim, now = Date.now()) {
  const environment = claimEnvironment(env, claim, false);
  // A tombstone also fences a reserve that timed out before its outcome was known.
  await env.DB.prepare(`INSERT INTO rewarded_match_claims (match_id,environment,user_id,offer,state,updated_at)
    SELECT ?,?,?,?,'released',? WHERE EXISTS(SELECT 1 FROM users WHERE id=?)
    ON CONFLICT(match_id) DO UPDATE SET state='released',updated_at=excluded.updated_at
    WHERE rewarded_match_claims.environment=excluded.environment AND rewarded_match_claims.user_id=excluded.user_id
      AND rewarded_match_claims.offer=excluded.offer AND rewarded_match_claims.state='reserved'`)
    .bind(claim.matchId, environment, claim.userId, claim.offer, now, claim.userId).run();
  return rewardedMatchClaim(env, claim);
}

import { randomHex } from '../accounts/jwt.mjs';
import { sha256 } from '../protocol.mjs';
import { liveAccountSql } from '../moderation/access.mjs';
import { fail } from '../room-model.mjs';
import { assertRewardedAccount, availableTicketSql, requireRewardedOffer, rewardedAccess } from './ledger.mjs';
import { hostedRewardedSettings, matchesRewardedUnit, SAMPLE_IOS_REWARDED_UNIT, rewardedEnvironment } from './settings.mjs';
import { gameplayOfferById } from '../../src/shared/account/gameplay-policy.mjs';

export { SAMPLE_IOS_REWARDED_UNIT } from './settings.mjs';
export const REWARDED_ITEM = 'match ticket';
export const LOCAL_REWARDED_UNIT = 'local-simulation';
const ATTEMPT_MS = 15 * 60_000;
const CALLBACK_LAG_MS = 24 * 60 * 60_000;
const CLOCK_SKEW_MS = 60_000;

export async function rewardedGroup(userId) {
  const hash = await sha256(`rewarded-preview-v1:${userId}`);
  return parseInt(hash.slice(0, 2), 16) < 128 ? 'A' : 'B';
}

export const rewardedTransport = (env, environment) =>
  environment === 'local' && env.REWARDED_LOCAL_NATIVE !== '1' ? 'simulation' : 'native';

export function rewardedAdsAvailable(env, environment, group, client) {
  if (env.REWARDED_ADS_ENABLED !== '1' || group !== 'B' || rewardedEnvironment(env) !== environment) return false;
  if (rewardedTransport(env, environment) === 'simulation') return true;
  return client === 'ios' && (environment === 'local' || hostedRewardedSettings(env, environment) !== null);
}

export async function rewardedStatus(env, userId, offer, client, now = Date.now()) {
  const environment = requireRewardedOffer(env, offer);
  await assertRewardedAccount(env, userId);
  // The single owner of the hosted beta can always test an ad without
  // changing the account-derived production or loopback A/B assignment.
  const group = environment === 'ios-preview' || gameplayOfferById(offer) ? 'B' : await rewardedGroup(userId);
  const access = await rewardedAccess(env, userId, offer, now);
  const pending = await env.DB.prepare(`SELECT expires_at FROM rewarded_attempts
    WHERE environment=? AND user_id=? AND state='pending' AND expires_at>? LIMIT 1`).bind(environment, userId, now).first();
  return { offer, group, access, adsAvailable: rewardedAdsAvailable(env, environment, group, client),
    attempt: pending ? 'pending' : null, attemptExpiresAt: pending?.expires_at ?? null };
}

export async function issueRewardedAttempt(env, userId, offer, client, now = Date.now()) {
  const environment = requireRewardedOffer(env, offer);
  const status = await rewardedStatus(env, userId, offer, client, now);
  if (!status.adsAvailable) fail('REWARDED_UNAVAILABLE', 404);
  if (status.attempt) fail('REWARDED_PENDING', 409);
  if (status.access !== 'required') fail('REWARDED_ALREADY_PLAYABLE', 409);

  const attemptId = crypto.randomUUID();
  const customData = randomHex(32);
  const customHash = await sha256(customData);
  const expiresAt = now + ATTEMPT_MS;
  const mode = rewardedTransport(env, environment);
  const adUnit = environment === 'local'
    ? (mode === 'simulation' ? LOCAL_REWARDED_UNIT : SAMPLE_IOS_REWARDED_UNIT)
    : hostedRewardedSettings(env, environment).unit;
  // Recheck entitlement-sensitive rows at the actual write. Concurrent clients
  // may both have seen no pending attempt, but only one can insert a new row.
  const { meta } = await env.DB.prepare(`WITH q(environment,user_id,offer) AS (VALUES(?,?,?))
    INSERT INTO rewarded_attempts (id,environment,user_id,offer,custom_hash,ad_unit,reward_item,state,created_at,expires_at)
    SELECT ?,environment,user_id,offer,?,?,?,'pending',?,? FROM q
    WHERE ${liveAccountSql('q.user_id')}
      AND NOT EXISTS(SELECT 1 FROM rewarded_attempts a WHERE a.environment=q.environment AND a.user_id=q.user_id
        AND a.state='pending' AND a.expires_at>?)
      AND (${availableTicketSql()}) IS NULL
      AND NOT EXISTS(SELECT 1 FROM rewarded_match_claims c WHERE c.environment=q.environment AND c.user_id=q.user_id
        AND c.offer=q.offer AND c.state='reserved' AND c.source IN ('trial','ticket'))`)
    .bind(environment, userId, offer, attemptId, customHash, adUnit, REWARDED_ITEM, now, expiresAt, now).run();
  if (!meta.changes) fail('REWARDED_PENDING', 409);
  return { attemptId, customData, expiresAt, adUnit: mode === 'simulation' ? null : adUnit, mode };
}

export async function cancelRewardedAttempt(env, environment, userId, attemptId) {
  await env.DB.prepare(`UPDATE rewarded_attempts SET state='cancelled'
    WHERE id=? AND environment=? AND user_id=? AND state='pending'`).bind(attemptId, environment, userId).run();
}

export async function verifyRewardedAttempt(env, { environment, customHash, attemptId, userId, adUnit, rewardItem, timestamp, transactionId }, now = Date.now()) {
  const query = environment === 'local'
    ? env.DB.prepare(`SELECT * FROM rewarded_attempts WHERE environment=? AND id=? AND user_id=?`).bind(environment, attemptId, userId)
    : env.DB.prepare(`SELECT * FROM rewarded_attempts WHERE environment=? AND custom_hash=?`).bind(environment, customHash);
  const attempt = await query.first();
  if (!attempt) fail('REWARDED_ATTEMPT', 404);

  if (!matchesRewardedUnit(adUnit, attempt.ad_unit) || rewardItem !== attempt.reward_item) fail('REWARDED_REWARD', 400);
  if (attempt.state === 'verified' && attempt.transaction_id === transactionId) return { verified: true };
  if (attempt.state !== 'pending' || timestamp < attempt.created_at - CLOCK_SKEW_MS || timestamp > attempt.expires_at
    || timestamp > now + CLOCK_SKEW_MS || now - timestamp > CALLBACK_LAG_MS) fail('REWARDED_ATTEMPT', 409);

  await assertRewardedAccount(env, attempt.user_id);
  await env.DB.prepare(`UPDATE OR IGNORE rewarded_attempts SET state='verified', verified_at=?, transaction_id=?
    WHERE id=? AND state='pending' AND ${liveAccountSql('rewarded_attempts.user_id')}`)
    .bind(now, transactionId, attempt.id).run();
  const result = await query.first();
  if (result?.state !== 'verified' || result.transaction_id !== transactionId) fail('REWARDED_ATTEMPT', 409);
  return { verified: true };
}


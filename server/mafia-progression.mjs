// Server-owned events only. A receipt, both aggregates and its terminal state
// always commit in one D1 batch. Nothing reads replay history to invent rewards.
import { fail } from '../src/shared/room-primitives.mjs';
import { MAFIA_ROLES } from '../src/online/mafia-shared.js';
import { liveAccountSql } from './moderation/access.mjs';

export const MAFIA_PROGRESS_POLICY_VERSION = 1;
export const MAFIA_MASTERY_THRESHOLDS = Object.freeze([1, 5, 15, 40, 100]);
export const mafiaProgressEnabled = env => String(env?.MAFIA_PROGRESS_ENABLED) === '1';
export const mafiaProgressLevel = xp => {
  if (!Number.isSafeInteger(xp) || xp < 0) fail('INVALID',400);
  return { level: 1 + Math.floor(xp / 250), xpInLevel: xp % 250, xpPerLevel: 250 };
};
export const mafiaRoleMastery = count => {
  if (!Number.isSafeInteger(count) || count < 0) fail('INVALID',400);
  return MAFIA_MASTERY_THRESHOLDS.filter(threshold => count >= threshold).length;
};
const stmt = (env, sql, ...args) => env.DB.prepare(sql).bind(...args);
const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(value);
const validKey = value => typeof value === 'string' && /^[A-Za-z0-9:_-]{1,180}$/.test(value);
const time = value => Number.isSafeInteger(value) && value > 0;
const factions = ['town','mafia','shadow'];
const bad = condition => { if (condition) fail('MAFIA_PROGRESS_INVALID',400); };
const digest = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))))]
  .map(byte => byte.toString(16).padStart(2,'0')).join('');

function validated(event, legacy) {
  bad(!event || event.eventSchemaVersion !== 1 || event.eventKind !== 'match_completed'
    || event.source !== (legacy ? 'legacy' : 'live') || !validKey(event.key) || !validKey(event.eventId)
    || event.rulesetVersion !== 1 || !time(event.finishedAt) || !time(event.notBefore)
    || event.notBefore < event.finishedAt + 30_000 || typeof event.draw !== 'boolean'
    || event.technicalAbort === true || event.tutorial === true || event.observer === true
    || !Array.isArray(event.results) || !event.results.length || event.results.length > 12);
  if (legacy) {
    bad(event.rewardPolicyVersion !== null || (event.startedAt != null && (!time(event.startedAt) || event.startedAt > event.finishedAt))
      || (event.visibility != null && !['public','private'].includes(event.visibility)));
  } else {
    bad(event.rewardPolicyVersion !== MAFIA_PROGRESS_POLICY_VERSION || !time(event.startedAt) || event.startedAt >= event.finishedAt
      || !['public','private'].includes(event.visibility) || !['classic','shadow'].includes(event.mode)
      || !Number.isSafeInteger(event.capacity) || !Number.isSafeInteger(event.participantCount)
      || event.participantCount < (event.mode === 'classic' ? 6 : 9) || event.participantCount > event.capacity
      || event.capacity < (event.mode === 'classic' ? 6 : 9) || event.capacity > (event.mode === 'classic' ? 8 : 12)
      || event.results.length > event.participantCount);
  }
  const users = new Set();
  const results = event.results.map(result => {
    bad(!result || !validId(result.userId) || users.has(result.userId) || !Object.hasOwn(MAFIA_ROLES,result.roleId)
      || !factions.includes(result.initialFaction) || MAFIA_ROLES[result.roleId].faction !== result.initialFaction
      || !factions.includes(result.faction) || typeof result.won !== 'boolean' || typeof result.forfeited !== 'boolean'
      || (event.draw && result.won) || result.observer === true || result.spectator === true
      || (result.eliminatedAt != null && !time(result.eliminatedAt)));
    users.add(result.userId);
    return { userId:result.userId, roleId:result.roleId, initialFaction:result.initialFaction, faction:result.faction,
      won:result.won, forfeited:result.forfeited, eliminatedAt:result.eliminatedAt ?? null };
  });
  return { eventSchemaVersion:1,eventKind:'match_completed',source:legacy?'legacy':'live',key:event.key,eventId:event.eventId,
    rewardPolicyVersion:legacy?null:MAFIA_PROGRESS_POLICY_VERSION,rulesetVersion:1,
    startedAt:event.startedAt ?? null,finishedAt:event.finishedAt,notBefore:event.notBefore,
    visibility:event.visibility ?? null,mode:event.mode ?? null,capacity:event.capacity ?? null,
    participantCount:event.participantCount ?? null,draw:event.draw,results };
}

// Async only for SHA-256. Callers must execute the complete returned list in ONE
// DB.batch, including legacy importers. A fresh claim token owns only receipts
// inserted by this batch; it never reclaims an old pending/processed receipt.
// Legacy counters deliberately do not advance qualified matches, wins or XP.
export async function mafiaProgressStatements(env, input, { claimToken = crypto.randomUUID(), legacy = false, now = Date.now() } = {}) {
  if (!mafiaProgressEnabled(env)) fail('MAFIA_PROGRESS_DISABLED',503);
  if (!env.DB) fail('MAFIA_PROGRESS_UNAVAILABLE',503);
  const event = validated(input,legacy);
  bad(!validKey(claimToken) || !time(now));
  if (event.notBefore > now) fail('MAFIA_PROGRESS_PENDING',503);
  const eventDigest = await digest(event), day = Math.floor(event.finishedAt / 86_400_000) * 86_400_000;
  const statements = [];
  for (const result of event.results) {
    const id = result.userId;
    // The private cap is the first three grants atomically committed for this
    // user's FINISH UTC day, not globally ordered match completion timestamps.
    const eligible = !legacy && !result.forfeited;
    const quota = `SELECT COUNT(*) FROM mafia_progress_events q WHERE q.user_id=? AND q.utc_day=?
      AND q.source='live' AND q.visibility='private' AND q.participation_granted=1 AND q.status='processed'`;
    const conflict = legacy ? 'ON CONFLICT(user_id,match_key,event_kind) DO NOTHING'
      : `ON CONFLICT(user_id,match_key,event_kind) DO UPDATE SET event_digest=CASE
          WHEN mafia_progress_events.event_digest=excluded.event_digest THEN mafia_progress_events.event_digest ELSE NULL END`;
    // A conflicting digest violates NOT NULL and rolls back the ENTIRE batch,
    // rather than partially rewarding some players before detecting a conflict.
    statements.push(stmt(env,`INSERT INTO mafia_progress_events(user_id,match_key,event_kind,event_id,event_schema_version,
      reward_policy_version,source,event_digest,role_id,initial_faction,faction,won,draw,forfeited,visibility,started_at,finished_at,utc_day,status,claim_token,
      participation_granted,xp_awarded,exclusion_reason,processed_at)
      SELECT ?,?,'match_completed',?,1,?,?,?,?,?,?,?,?,?,?,?,?,?,'pending',?,
        CASE WHEN ?=1 AND (?!='private' OR (${quota})<3) THEN 1 ELSE 0 END,0,?,NULL
      WHERE ${liveAccountSql('?')} ${conflict}`,
    id,event.key,event.eventId,event.rewardPolicyVersion,event.source,eventDigest,result.roleId,result.initialFaction,result.faction,
    result.won?1:0,event.draw?1:0,result.forfeited?1:0,event.visibility,event.startedAt,event.finishedAt,day,claimToken,
    eligible?1:0,event.visibility,id,day,legacy?'legacy':result.forfeited?'forfeited':null,id,id));
    const owned = `user_id=? AND match_key=? AND event_kind='match_completed' AND status='pending' AND claim_token=? AND event_digest=? AND ${liveAccountSql('mafia_progress_events.user_id')}`;
    const args = [id,event.key,claimToken,eventDigest];
    statements.push(stmt(env,`UPDATE mafia_progress_events SET xp_awarded=CASE WHEN participation_granted=1 THEN
      CASE WHEN visibility='private' THEN 50 ELSE 50+? END ELSE 0 END,
      exclusion_reason=CASE WHEN source='live' AND exclusion_reason IS NULL AND participation_granted=0 THEN 'private_daily_cap' ELSE exclusion_reason END
      WHERE ${owned}`,result.won?20:event.draw?10:0,...args));
    statements.push(stmt(env,`INSERT INTO mafia_player_progress(user_id,total_xp,rewarded_matches,legacy_matches,updated_at)
      SELECT user_id,xp_awarded,participation_granted,source='legacy',? FROM mafia_progress_events
      WHERE ${owned} AND (participation_granted=1 OR source='legacy')
      ON CONFLICT(user_id) DO UPDATE SET total_xp=mafia_player_progress.total_xp+excluded.total_xp,
        rewarded_matches=mafia_player_progress.rewarded_matches+excluded.rewarded_matches,
        legacy_matches=mafia_player_progress.legacy_matches+excluded.legacy_matches,updated_at=MAX(mafia_player_progress.updated_at,excluded.updated_at)`,now,...args));
    statements.push(stmt(env,`INSERT INTO mafia_role_progress(user_id,role_id,qualified_matches,wins,draws,legacy_matches,updated_at)
      SELECT user_id,role_id,participation_granted,participation_granted*?,participation_granted*?,source='legacy',?
      FROM mafia_progress_events WHERE ${owned} AND (participation_granted=1 OR source='legacy')
      ON CONFLICT(user_id,role_id) DO UPDATE SET qualified_matches=mafia_role_progress.qualified_matches+excluded.qualified_matches,
        wins=mafia_role_progress.wins+excluded.wins,draws=mafia_role_progress.draws+excluded.draws,
        legacy_matches=mafia_role_progress.legacy_matches+excluded.legacy_matches,updated_at=MAX(mafia_role_progress.updated_at,excluded.updated_at)`,
    result.won?1:0,event.draw?1:0,now,...args));
    statements.push(stmt(env,`UPDATE mafia_progress_events SET status='processed',processed_at=? WHERE ${owned}`,now,...args));
  }
  return statements;
}

export async function persistMafiaProgress(env, event) {
  // Unmarked old matches may still be archived; they cannot acquire a policy
  // retrospectively. Their optional XP0 import has its own reviewed entrypoint.
  if (event?.rewardPolicyVersion == null) return { status:'legacy-unrewarded' };
  // Disabling the feature pauses already-promised rewards. Throwing keeps the
  // durable outbox head; resolving here would silently discard an earned grant.
  const statements = await mafiaProgressStatements(env,event);
  await env.DB.batch(statements);
  return { status:'processed' };
}

export function mafiaProgressDeleteStatements(env, id) {
  return ['mafia_progress_events','mafia_player_progress','mafia_role_progress'].map(table => stmt(env,`DELETE FROM ${table} WHERE user_id=?`,id));
}

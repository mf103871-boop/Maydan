import { fail } from '../src/shared/room-primitives.mjs';
import { PROGRESSION_FRAMES } from '../src/profiles/progression-catalog.js';
import { liveAccountSql } from './moderation/access.mjs';

export const ACCOUNT_REWARD_VERSION = 1;
export const accountProgressionEnabled = env => String(env?.ACCOUNT_PROGRESSION_ENABLED) === '1';
const stmt = (env, sql, ...args) => env.DB.prepare(sql).bind(...args);
const UTC_DAY = 86_400_000;
const MAX_LEVEL = 100;
const MASTERY_THRESHOLDS = Object.freeze([1, 3, 6, 10, 15, 25, 40, 60, 85, 120]);
const MASTERY_GAMES = Object.freeze(['ersomha', 'mafia']);
const LOCAL_XP = 12;
const LOCAL_DAILY_GRANTS = 3;
const xpAtLevel = level => {
  const completed = level - 1;
  return completed * 100 + 5 * completed * (completed - 1) / 2;
};
const FRAME_MILESTONES = JSON.stringify(PROGRESSION_FRAMES.map(({ id, level }) => ({ id, level, threshold: xpAtLevel(level) })));

export function accountLevel(totalXp) {
  let level = 1;
  while (level < MAX_LEVEL && totalXp >= xpAtLevel(level + 1)) level++;
  const overflow = level === MAX_LEVEL ? totalXp - xpAtLevel(MAX_LEVEL) : 0;
  return {
    level,
    xpIntoLevel: level < MAX_LEVEL ? totalXp - xpAtLevel(level) : overflow,
    xpForNextLevel: level < MAX_LEVEL ? xpAtLevel(level + 1) - xpAtLevel(level) : null,
    postMaxMilestones: Math.floor(overflow / 1000),
  };
}

// Persist this decision at match start. Never read today's curve or settings
// to price an old match; existing rooms and unmarked results get no new XP.
export function onlineRewardPlan(room) {
  if (room.game === 'mafia') {
    if ((room.protocol || 1) < 2 || (room.rulesetVersion || 1) !== 1) return null;
    return { version: ACCOUNT_REWARD_VERSION, rulesetVersion: 1, baseXp: room.settings?.mode === 'shadow' ? 65 : 55,
      winXp: room.settings?.visibility === 'public' ? 10 : 0, mastery: true };
  }
  if (!['meenfina', 'fabraka', 'badeeha', 'ersomha'].includes(room.game)
    || !Number.isInteger(room.rounds) || room.rounds <= 0) return null;
  const competitiveDrawing = room.game === 'ersomha' && room.settings?.mode === 'competitive';
  return { version: ACCOUNT_REWARD_VERSION, rulesetVersion: 1, baseXp: 25 + Math.min(room.rounds * 2, 20),
    winXp: competitiveDrawing ? 8 : 0, mastery: room.game === 'ersomha' };
}
export const LOCAL_REWARD_PLAN = Object.freeze({
  version: ACCOUNT_REWARD_VERSION, rulesetVersion: 1, baseXp: LOCAL_XP, winXp: 0, mastery: false,
});

// Appended to the SAME D1 batch as the canonical player event and legacy
// achievements. No public endpoint accepts reward commands. A fresh claim
// selects only the newly inserted receipt, even after a commit-before-reply
// crash. The key is independent of the reward-rule version.
export function accountRewardStatements(env, { userId, eventId, source, game, finishedAt, notBefore, plan, now = Date.now() }) {
  if (!plan) return [];
  if (plan.version !== ACCOUNT_REWARD_VERSION || plan.rulesetVersion !== 1
    || !Number.isInteger(plan.baseXp) || plan.baseXp < 1 || plan.baseXp > 65
    || !Number.isInteger(plan.winXp) || plan.winXp < 0 || plan.winXp > 10
    || typeof plan.mastery !== 'boolean' || (plan.mastery && !MASTERY_GAMES.includes(game))
    || (source === 'local' && plan !== LOCAL_REWARD_PLAN)
    || (source === 'online' && !Number.isSafeInteger(finishedAt))
    || (game === 'mafia' && (!Number.isSafeInteger(notBefore) || notBefore < finishedAt + 30_000))) fail('INVALID', 400);
  if (notBefore > now) fail('ACCOUNT_PROGRESSION_PENDING', 503);

  const claim = crypto.randomUUID();
  const own = 'user_id=? AND event_id=? AND claim_token=?';
  const key = [userId, eventId, claim];
  const eligible = `(e.source!='local' OR (SELECT COUNT(*) FROM progression_events previous
    WHERE previous.user_id=e.user_id AND previous.source='local' AND previous.xp_awarded>0
      AND previous.finished_at >= (e.created_at / ${UTC_DAY}) * ${UTC_DAY}
      AND previous.finished_at < ((e.created_at / ${UTC_DAY}) + 1) * ${UTC_DAY}) < ${LOCAL_DAILY_GRANTS})`;
  return [
    stmt(env, `INSERT INTO progression_events
      (user_id,event_id,source,game,reward_rule_version,ruleset_version,finished_at,not_before,xp_awarded,mastery_delta,exclusion_reason,claim_token)
      SELECT e.user_id,e.event_id,e.source,e.game,?,?,e.created_at,COALESCE(?,e.created_at),
        CASE WHEN ${eligible} THEN ? + CASE WHEN e.won=1 THEN ? ELSE 0 END ELSE 0 END,?,
        CASE WHEN ${eligible} THEN NULL ELSE 'local_daily_cap' END,?
      FROM player_events e WHERE e.user_id=? AND e.event_id=? AND e.source=? AND e.game=?
        AND e.created_at=COALESCE(?,e.created_at) AND COALESCE(?,e.created_at)<=? AND ${liveAccountSql('e.user_id')}
      ON CONFLICT(user_id,event_id) DO NOTHING`,
    plan.version, plan.rulesetVersion, notBefore ?? null, plan.baseXp, plan.winXp, Number(plan.mastery), claim,
    userId, eventId, source, game, finishedAt ?? null, notBefore ?? null, now),
    stmt(env, `INSERT INTO player_progression(user_id,total_xp,qualified_matches,hosted_sessions,updated_at)
      SELECT user_id,xp_awarded,source='online',source='local',? FROM progression_events WHERE ${own} AND xp_awarded>0
      ON CONFLICT(user_id) DO UPDATE SET total_xp=player_progression.total_xp+excluded.total_xp,
        qualified_matches=player_progression.qualified_matches+excluded.qualified_matches,
        hosted_sessions=player_progression.hosted_sessions+excluded.hosted_sessions,
        updated_at=MAX(player_progression.updated_at,excluded.updated_at)`, now, ...key),
    ...(plan.mastery ? [stmt(env, `INSERT INTO game_mastery(user_id,game,completed)
      SELECT user_id,game,mastery_delta FROM progression_events WHERE ${own} AND mastery_delta=1 AND xp_awarded>0
      ON CONFLICT(user_id,game) DO UPDATE SET completed=game_mastery.completed+excluded.completed`, ...key)] : []),
    stmt(env, `UPDATE progression_events SET xp_after=COALESCE((SELECT total_xp FROM player_progression p
      WHERE p.user_id=progression_events.user_id),0) WHERE ${own}`, ...key),
    stmt(env, `INSERT INTO progression_cosmetic_grants(user_id,item_id,level,event_id,granted_at)
      SELECT e.user_id,json_extract(frame.value,'$.id'),json_extract(frame.value,'$.level'),e.event_id,?
      FROM progression_events e CROSS JOIN json_each(?) frame
      WHERE e.user_id=? AND e.event_id=? AND e.claim_token=? AND e.xp_awarded>0
        AND e.xp_after >= json_extract(frame.value,'$.threshold')
      ON CONFLICT(user_id,item_id) DO NOTHING`, now, FRAME_MILESTONES, ...key),
  ];
}

const grantsSql = alias => `SELECT item_id,level,granted_at FROM progression_cosmetic_grants WHERE user_id=${alias}`;
export const progressionGrantUnionSql = alias => `SELECT item_id,NULL AS achievement_id,granted_at,'progression' AS source,item_id AS source_id,NULL AS order_id
  FROM (${grantsSql(alias)})`;
export const progressionCosmeticSql = (alias, id) => `EXISTS(SELECT 1 FROM (${grantsSql(alias)}) WHERE item_id='${id.replaceAll("'", "''")}')`;

export async function progressionFor(env, viewerId, targetId) {
  if (!accountProgressionEnabled(env)) return undefined;
  const self = viewerId === targetId;
  // Match existing profile access, at the same SQL snapshot as progress.
  const row = await stmt(env, `SELECT COALESCE(p.total_xp,0) total_xp,p.qualified_matches,p.hosted_sessions${self ? `,
    (SELECT json_group_array(json_object('game',m.game,'completed',m.completed)) FROM game_mastery m WHERE m.user_id=u.id) AS mastery,
    (SELECT json_group_array(json_object('itemId',g.item_id,'level',g.level,'grantedAt',g.granted_at,'source','progression'))
      FROM (${grantsSql('u.id')}) g) AS owned` : ''}
    FROM users u LEFT JOIN player_progression p ON p.user_id=u.id WHERE u.id=? AND ${liveAccountSql('u.id')} AND ${liveAccountSql('?')}
      AND NOT EXISTS(SELECT 1 FROM social_blocks b WHERE (b.blocker_id=? AND b.blocked_id=u.id) OR (b.blocker_id=u.id AND b.blocked_id=?))`,
  targetId, viewerId, viewerId, viewerId, viewerId).first();
  if (!row) fail('NOT_FOUND', 404);
  const level = accountLevel(row.total_xp);
  if (!self) return { level: level.level };
  const owned = JSON.parse(row.owned || '[]').sort((a, b) => a.level - b.level);
  const mastery = JSON.parse(row.mastery || '[]').map(({ game, completed }) => ({ game, completed,
    grade: MASTERY_THRESHOLDS.filter(threshold => completed >= threshold).length, maxGrade: MASTERY_THRESHOLDS.length }));
  const next = PROGRESSION_FRAMES.find(frame => !owned.some(item => item.itemId === frame.id));
  return { ...level, totalXp: row.total_xp, qualifiedMatches: row.qualified_matches || 0, hostedSessions: row.hosted_sessions || 0,
    owned, mastery, nextReward: next ? { itemId: next.id, level: next.level } : null };
}

export async function progressionReceipt(env, userId, eventId, now = Date.now()) {
  if (!accountProgressionEnabled(env) || !/^(?:online|local):[a-f0-9-]{36}$/.test(eventId)) fail('NOT_FOUND', 404);
  const row = await stmt(env, `SELECT source,game,finished_at,xp_awarded,xp_after,exclusion_reason,reward_rule_version,ruleset_version
    FROM progression_events WHERE user_id=? AND event_id=? AND not_before<=? AND xp_after IS NOT NULL
    AND ${liveAccountSql('progression_events.user_id')}`, userId, eventId, now).first();
  if (!row) return { status: 'pending', eventId };
  const level = accountLevel(row.xp_after);
  const next = PROGRESSION_FRAMES.find(frame => frame.level > level.level || row.xp_after === 0);
  return { status: 'settled', eventId, source: row.source, game: row.game, finishedAt: row.finished_at,
    awardedXp: row.xp_awarded, totalXp: row.xp_after, ...level,
    nextReward: next ? { itemId: next.id, level: next.level } : null,
    reason: row.exclusion_reason, rewardRuleVersion: row.reward_rule_version, rulesetVersion: row.ruleset_version };
}

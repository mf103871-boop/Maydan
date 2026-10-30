import { MAFIA_ACHIEVEMENT_LIST, getMafiaAchievement } from '../src/profiles/mafia-catalog.js';
import { getCosmetic } from '../src/plus/catalog.js';
import { liveAccountSql } from './moderation/access.mjs';

const stmt = (env, sql, ...args) => env.DB.prepare(sql).bind(...args);
const all = async (env, sql, ...args) => (await stmt(env, sql, ...args).all()).results || [];
const catalog = JSON.stringify(MAFIA_ACHIEVEMENT_LIST.map(({ id, metric, target, faction, cosmeticItemId }) => ({ id, metric, target, faction: faction || null, cosmeticItemId })));
const qualified = alias => `${alias}.source='live' AND ${alias}.reward_policy_version=1 AND ${alias}.participation_granted=1 AND ${alias}.forfeited=0`;

// Only the pending receipt inserted by this command may award anything. These
// statements must be appended before its processed update in the SAME DB.batch.
export function mafiaAchievementStatements(env, { userId, matchKey, claimToken, eventDigest, now }) {
  const owned = `receipt.user_id=? AND receipt.match_key=? AND receipt.event_kind='match_completed'
    AND receipt.status='pending' AND receipt.claim_token=? AND receipt.event_digest=?
    AND ${qualified('receipt')} AND ${liveAccountSql('receipt.user_id')}`;
  const args = [userId, matchKey, claimToken, eventDigest];
  const history = `${qualified('q')} AND q.user_id=receipt.user_id AND (q.status='processed'
    OR (q.status='pending' AND q.match_key=receipt.match_key AND q.claim_token=receipt.claim_token AND q.event_digest=receipt.event_digest))`;
  const metric = `CASE json_extract(a.value,'$.metric')
    WHEN 'qualified' THEN (SELECT COUNT(*) FROM mafia_progress_events q WHERE ${history})
    WHEN 'faction_win' THEN (SELECT COUNT(*) FROM mafia_progress_events q WHERE ${history} AND q.won=1 AND q.faction=json_extract(a.value,'$.faction'))
    WHEN 'roles' THEN (SELECT COUNT(DISTINCT role_id) FROM mafia_progress_events q WHERE ${history})
    WHEN 'factions' THEN (SELECT COUNT(DISTINCT faction) FROM mafia_progress_events q WHERE ${history}) ELSE 0 END`;
  return [
    stmt(env, `INSERT OR IGNORE INTO mafia_achievements(user_id,achievement_id,earned_at,earned_match_key)
      SELECT receipt.user_id,json_extract(a.value,'$.id'),?,receipt.match_key
      FROM mafia_progress_events receipt CROSS JOIN json_each(?) a
      WHERE ${owned} AND ${metric}>=json_extract(a.value,'$.target')`, now, catalog, ...args),
    stmt(env, `INSERT OR IGNORE INTO mafia_cosmetic_grants(user_id,item_id,source,achievement_id,granted_at,revoked_at)
      SELECT receipt.user_id,json_extract(a.value,'$.cosmeticItemId'),'mafia_achievement',earned.achievement_id,?,NULL
      FROM mafia_progress_events receipt CROSS JOIN json_each(?) a
      JOIN mafia_achievements earned ON earned.user_id=receipt.user_id AND earned.achievement_id=json_extract(a.value,'$.id')
      WHERE ${owned} AND earned.earned_match_key=receipt.match_key AND json_extract(a.value,'$.cosmeticItemId') IS NOT NULL`, now, catalog, ...args),
  ];
}

export function mafiaCosmeticGrantSql(userAlias, itemId, now = Date.now()) {
  const achievement = MAFIA_ACHIEVEMENT_LIST.find(value => value.cosmeticItemId === itemId);
  if (!achievement || !getCosmetic(itemId, { now })) return '0';
  // Both strings are code-owned catalog values, not request/SQL identifiers.
  return `EXISTS(SELECT 1 FROM mafia_cosmetic_grants g WHERE g.user_id=${userAlias}
    AND g.item_id='${itemId}' AND g.source='mafia_achievement' AND g.achievement_id='${achievement.id}' AND g.revoked_at IS NULL)`;
}
function grantView(row, now) {
  const achievement = getMafiaAchievement(row.achievement_id), item = getCosmetic(row.item_id, { now });
  return achievement?.cosmeticItemId === row.item_id && item ? { itemId: item.id, source: 'mafia_achievement', achievementId: achievement.id, grantedAt: row.granted_at } : null;
}
export async function readMafiaCosmeticGrants(env, userId, now = Date.now()) {
  if (!env.DB || !userId) return [];
  const rows = await all(env, `SELECT g.* FROM mafia_cosmetic_grants g WHERE g.user_id=? AND g.revoked_at IS NULL AND ${liveAccountSql('g.user_id')} ORDER BY g.granted_at,g.item_id`, userId);
  return rows.map(row => grantView(row, now)).filter(Boolean);
}
export async function readMafiaAchievements(env, userId, now = Date.now()) {
  if (!env.DB || !userId) return { earned: [], grants: [] };
  const [rows, grants] = await Promise.all([
    all(env, `SELECT achievement_id,earned_at FROM mafia_achievements WHERE user_id=? AND ${liveAccountSql('mafia_achievements.user_id')} ORDER BY earned_at,achievement_id`, userId),
    readMafiaCosmeticGrants(env, userId, now),
  ]);
  return { earned: rows.filter(row => getMafiaAchievement(row.achievement_id)).map(row => ({ id: row.achievement_id, earnedAt: row.earned_at })), grants };
}
export async function readMafiaRewardAchievements(env, userId, matchKey, now = Date.now()) {
  if (!env.DB || !userId || typeof matchKey !== 'string') return { achievements: [], grants: [] };
  const rows = await all(env, `SELECT achievement_id,earned_at FROM mafia_achievements WHERE user_id=? AND earned_match_key=? AND ${liveAccountSql('mafia_achievements.user_id')} ORDER BY achievement_id`, userId, matchKey);
  const achievements = rows.map(row => { const item = getMafiaAchievement(row.achievement_id); return item ? { id: item.id, label: item.label, description: item.description, earnedAt: row.earned_at } : null; }).filter(Boolean);
  const ids = new Set(achievements.map(item => item.id));
  const grants = (await readMafiaCosmeticGrants(env, userId, now)).filter(row => ids.has(row.achievementId)).map(row => { const item = getCosmetic(row.itemId, { now }); return { ...row, label: item.label, kind: item.kind }; });
  return { achievements, grants };
}

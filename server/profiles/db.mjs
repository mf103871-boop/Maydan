import { fail } from '../room-model.mjs';
import { ensureProfile as ensureSocialProfile } from '../social/db.mjs';
import { ACHIEVEMENTS } from '../../src/profiles/catalog.js';
import { earnedState, imageUrl, publicName, gameOf, EMPTY_STATS } from './model.mjs';

const stmt = (env, sql, ...args) => env.DB.prepare(sql).bind(...args);
const first = (env, sql, ...args) => stmt(env, sql, ...args).first();
const all = async (env, sql, ...args) => (await stmt(env, sql, ...args).all()).results || [];
const changed = result => Number(result?.meta?.changes || 0) > 0;
const live = alias => `EXISTS(SELECT 1 FROM users u WHERE u.id=${alias}) AND NOT EXISTS(SELECT 1 FROM account_deletions d WHERE d.user_id=${alias})`;
const noBlock = (viewer, target) => `NOT EXISTS(SELECT 1 FROM social_blocks b WHERE (b.blocker_id=${viewer} AND b.blocked_id=${target}) OR (b.blocked_id=${viewer} AND b.blocker_id=${target}))`;
const FRIEND_COUNT = `SELECT COUNT(*) FROM social_friendships f WHERE (f.user_low=p.user_id OR f.user_high=p.user_id) AND f.status='accepted' AND ${live('f.user_low')} AND ${live('f.user_high')} AND ${noBlock('f.user_low','f.user_high')}`;
const bumpIfChanged = (env,userId,now=Date.now()) => stmt(env, `UPDATE player_profiles SET revision=revision+1,updated_at=?
  WHERE user_id=? AND changes()>0 AND ${live('player_profiles.user_id')}`,now,userId);
export const isLiveAccount = (env, id) => first(env, `SELECT id FROM users WHERE id=? AND ${live('users.id')}`, id);

// Pure SQL snapshots can be appended to a friendship/stat/profile write batch.
// Awards are permanent, even when a later edit or unfriend lowers the metric.
export function profileAchievementStatements(env, userId, now = Date.now()) {
  const metrics = {
    member: '1', profileComplete: "CASE WHEN trim(p.bio)!='' AND (p.avatar_version IS NOT NULL OR p.avatar_preset!='spark') THEN 1 ELSE 0 END",
    friendCount: `(${FRIEND_COUNT})`,
    localSessions: 'COALESCE((SELECT local_sessions FROM player_stats s WHERE s.user_id=p.user_id),0)',
    onlineMatches: 'COALESCE((SELECT online_matches FROM player_stats s WHERE s.user_id=p.user_id),0)',
    onlineWins: 'COALESCE((SELECT online_wins FROM player_stats s WHERE s.user_id=p.user_id),0)',
    onlineDraws: 'COALESCE((SELECT online_draws FROM player_stats s WHERE s.user_id=p.user_id),0)',
    distinctGames: '(SELECT COUNT(DISTINCT game) FROM player_events e WHERE e.user_id=p.user_id)',
  };
  for (const a of ACHIEVEMENTS) if (!(a.metric in metrics)) throw new Error(`Unknown achievement metric: ${a.metric}`);
  const catalog = JSON.stringify(ACHIEVEMENTS.map(({id,metric,target})=>({id,metric,target})));
  const metric = Object.entries(metrics).map(([key,expression]) => `WHEN '${key}' THEN ${expression}`).join(' ');
  return [stmt(env, `INSERT OR IGNORE INTO player_achievements(user_id,achievement_id,earned_at)
    SELECT p.user_id,json_extract(a.value,'$.id'),? FROM player_profiles p CROSS JOIN json_each(?) a
    WHERE p.user_id=? AND ${live('p.user_id')} AND CASE json_extract(a.value,'$.metric') ${metric} ELSE 0 END>=json_extract(a.value,'$.target')`,
    now,catalog,userId),bumpIfChanged(env,userId,now)];
}
export async function ensurePlayerProfile(env, userId, now = Date.now()) {
  await ensureSocialProfile(env, userId, now);
  await env.DB.batch([
    stmt(env, `INSERT OR IGNORE INTO player_profiles(user_id,created_at,updated_at) SELECT ?,?,? WHERE ${live('?')}`, userId, now, now, userId, userId),
    ...profileAchievementStatements(env, userId, now),
  ]);
  const row = await first(env, `SELECT p.* FROM player_profiles p WHERE user_id=? AND ${live('p.user_id')}`, userId);
  if (!row) fail('NOT_FOUND', 404);
  return row;
}
export async function awardProfileAchievements(env, userId, now = Date.now()) {
  await env.DB.batch(profileAchievementStatements(env, userId, now));
}
const readStats = row => ({ localSessions: Number(row.local_sessions) || 0, onlineMatches: Number(row.online_matches) || 0,
  onlineWins: Number(row.online_wins) || 0, onlineDraws: Number(row.online_draws) || 0, distinctGames: Number(row.distinct_games) || 0 });
function view(row, viewerId, records, now) {
  let featured; try { featured = JSON.parse(row.featured_badges); } catch { featured = []; }
  const relationship = row.user_id === viewerId ? 'self' : row.friend_status === 'accepted' ? 'friend' : row.friend_status === 'pending' ?
    (row.requester_id === viewerId ? 'pending_outgoing' : 'pending_incoming') : 'none';
  const profile = { id: row.user_id, name: publicName(row.name), code: row.code, bio: row.bio, theme: row.theme,
    avatarPreset: row.avatar_preset, avatarUrl: imageUrl(row.user_id,'avatar',row.avatar_version), coverUrl: imageUrl(row.user_id,'cover',row.cover_version),
    stats: readStats(row), friendCount: row.friend_count, relationship, requestId: row.friend_status === 'pending' ? row.request_id : null,
    selectedTitle: row.selected_title, featuredBadges: Array.isArray(featured) ? featured : [],
    createdAt: row.account_created_at, updatedAt: row.updated_at, revision: row.revision };
  Object.assign(profile, earnedState({ stats: profile.stats, friendCount: profile.friendCount, profile }, records));
  if (!profile.earnedTitles.includes(profile.selectedTitle)) profile.selectedTitle = null;
  profile.featuredBadges = profile.featuredBadges.filter(id => profile.earnedBadges.includes(id));
  if (relationship === 'friend' || relationship === 'self') {
    profile.lastActiveAt = row.last_active_at;
    profile.online = row.online_until > now && row.last_active_at > now - 45_000;
  }
  return profile;
}
const PROFILE_SELECT = `SELECT p.*,u.name,u.created_at AS account_created_at,s.code,s.last_active_at,s.online_until,
  f.status AS friend_status,f.requester_id,f.id AS request_id,
  st.local_sessions,st.online_matches,st.online_wins,st.online_draws,
  (SELECT COUNT(DISTINCT game) FROM player_events e WHERE e.user_id=p.user_id) AS distinct_games,
  (SELECT json_group_array(achievement_id) FROM player_achievements a WHERE a.user_id=p.user_id) AS earned_ids,
  (${FRIEND_COUNT}) AS friend_count FROM player_profiles p JOIN users u ON u.id=p.user_id
  JOIN social_profiles s ON s.user_id=p.user_id LEFT JOIN player_stats st ON st.user_id=p.user_id
  LEFT JOIN social_friendships f ON (f.user_low=? AND f.user_high=p.user_id) OR (f.user_high=? AND f.user_low=p.user_id)`;
export async function profileFor(env, viewerId, targetId, now = Date.now()) {
  const visible = await first(env, `SELECT u.id FROM users u WHERE u.id=? AND ${live('u.id')} AND ${noBlock('?','u.id')}`, targetId, viewerId, viewerId);
  if (!visible || !(await isLiveAccount(env, viewerId))) fail('NOT_FOUND', 404);
  await ensurePlayerProfile(env, targetId, now);
  const row = await first(env, `${PROFILE_SELECT} WHERE p.user_id=? AND ${live('p.user_id')} AND ${noBlock('?','p.user_id')} AND ${live('?')}`,
    viewerId, viewerId, targetId, viewerId, viewerId, viewerId, viewerId);
  if (!row) fail('NOT_FOUND', 404);
  const earned = JSON.parse(row.earned_ids || '[]').map(achievement_id=>({achievement_id}));
  return view(row, viewerId, earned, now);
}
export async function searchProfiles(env, viewerId, query, now = Date.now()) {
  const code = query.toUpperCase(); const pattern = `%${query.replace(/[\\%_]/g,'\\$&')}%`;
  const rows = await all(env, `${PROFILE_SELECT} WHERE p.user_id!=? AND ${live('p.user_id')} AND ${noBlock('?','p.user_id')} AND ${live('?')}
    AND (s.code=? OR (?=0 AND u.name NOT LIKE '%@%' AND u.name LIKE ? ESCAPE '\\'))
    ORDER BY CASE WHEN s.code=? THEN 0 ELSE 1 END,u.name COLLATE NOCASE,p.user_id LIMIT 20`,
  viewerId, viewerId, viewerId, viewerId, viewerId, viewerId, viewerId, code, /^MDN-[A-F0-9]{10}$/.test(code) ? 1 : 0, pattern, code);
  return rows.map(row => {
    const profile = view(row, viewerId, [], now);
    const { id,name,code,theme,avatarPreset,avatarUrl,relationship,requestId,online,lastActiveAt } = profile;
    return { id,name,code,theme,avatarPreset,avatarUrl,relationship,requestId,...(online === undefined ? {} : { online,lastActiveAt }) };
  });
}
function mutationGuard(revision) { return revision === null ? { sql: '', args: [] } : { sql: ' AND revision=?', args: [revision] }; }
async function checkMutation(env, userId, result) {
  if (changed(result)) return;
  if (!(await isLiveAccount(env, userId))) fail('NOT_FOUND', 404);
  fail('CONFLICT', 409);
}
export async function patchProfile(env, userId, patch, revision = null, now = Date.now()) {
  const mapping = { bio:'bio',theme:'theme',avatarPreset:'avatar_preset',selectedTitle:'selected_title',featuredBadges:'featured_badges' };
  const assignments = []; const args = []; const mutation = crypto.randomUUID();
  for (const [key,column] of Object.entries(mapping)) if (key in patch) { assignments.push(`${column}=?`); args.push(key === 'featuredBadges' ? JSON.stringify(patch[key]) : patch[key]); }
  if ('avatarPreset' in patch) assignments.push('avatar_version=NULL');
  assignments.push('revision=revision+1','updated_at=?','last_mutation=?'); args.push(now,mutation,userId);
  const guard = mutationGuard(revision);
  const statements = [stmt(env, `UPDATE player_profiles SET ${assignments.join(',')} WHERE user_id=? AND ${live('player_profiles.user_id')}${guard.sql}`, ...args,...guard.args)];
  if ('name' in patch) statements.push(stmt(env, `UPDATE users SET name=?,updated_at=? WHERE id=?
    AND EXISTS(SELECT 1 FROM player_profiles p WHERE p.user_id=users.id AND p.last_mutation=?)`, patch.name,now,userId,mutation));
  if ('avatarPreset' in patch) statements.push(stmt(env, `DELETE FROM player_images WHERE user_id=? AND kind='avatar'
    AND EXISTS(SELECT 1 FROM player_profiles p WHERE p.user_id=player_images.user_id AND p.last_mutation=?)`, userId,mutation));
  statements.push(...profileAchievementStatements(env,userId,now));
  const result = await env.DB.batch(statements);
  await checkMutation(env,userId,result[0]);
}
export async function setImage(env, userId, kind, image, revision = null, now = Date.now()) {
  if (!['avatar','cover'].includes(kind)) fail('INVALID',400);
  const mutation = crypto.randomUUID(); const guard = mutationGuard(revision);
  const result = await env.DB.batch([
    stmt(env, `UPDATE player_profiles SET ${kind}_version=?,revision=revision+1,updated_at=?,last_mutation=?
      WHERE user_id=? AND ${live('player_profiles.user_id')}${guard.sql}`, image?.version || null,now,mutation,userId,...guard.args),
    image ? stmt(env, `INSERT INTO player_images(user_id,kind,version,data_base64,width,height,byte_length,updated_at)
      SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM player_profiles p WHERE p.user_id=? AND p.last_mutation=?)
      ON CONFLICT(user_id,kind) DO UPDATE SET version=excluded.version,data_base64=excluded.data_base64,width=excluded.width,
        height=excluded.height,byte_length=excluded.byte_length,updated_at=excluded.updated_at`,
    userId,kind,image.version,image.base64,image.width,image.height,image.bytes.length,now,userId,mutation)
      : stmt(env, `DELETE FROM player_images WHERE user_id=? AND kind=? AND EXISTS(SELECT 1 FROM player_profiles p WHERE p.user_id=player_images.user_id AND p.last_mutation=?)`,userId,kind,mutation),
    ...profileAchievementStatements(env,userId,now),
  ]);
  await checkMutation(env,userId,result[0]);
}
export const currentImage = (env,userId,kind,version) => first(env, `SELECT i.data_base64,i.byte_length FROM player_images i
  JOIN player_profiles p ON p.user_id=i.user_id WHERE i.user_id=? AND i.kind=? AND i.version=?
  AND CASE WHEN i.kind='avatar' THEN p.avatar_version ELSE p.cover_version END=i.version AND ${live('i.user_id')}`,userId,kind,version);

export async function profileSummaries(env,userIds) {
  const ids=[...new Set(userIds)].filter(id=>typeof id==='string' && /^[A-Za-z0-9_-]{1,80}$/.test(id));
  const result=new Map();
  for(let start=0;start<ids.length;start+=80) {
    const batch=ids.slice(start,start+80);
    const rows=await all(env,`SELECT p.user_id,p.avatar_preset,p.theme,p.avatar_version,p.selected_title,p.revision
      FROM player_profiles p WHERE p.user_id IN (${batch.map(()=>'?').join(',')}) AND ${live('p.user_id')}`, ...batch);
    for(const row of rows) result.set(row.user_id,{avatarPreset:row.avatar_preset,theme:row.theme,
      avatarUrl:imageUrl(row.user_id,'avatar',row.avatar_version),selectedTitle:row.selected_title,revision:row.revision});
  }
  return result;
}

function recountStats(env,userId) {
  return stmt(env, `INSERT INTO player_stats(user_id,local_sessions,online_matches,online_wins,online_draws)
    SELECT ?,COALESCE(SUM(source='local'),0),COALESCE(SUM(source='online'),0),COALESCE(SUM(source='online' AND won=1),0),COALESCE(SUM(source='online' AND draw=1),0)
    FROM player_events WHERE user_id=? HAVING ${live('?')}
    ON CONFLICT(user_id) DO UPDATE SET local_sessions=excluded.local_sessions,online_matches=excluded.online_matches,online_wins=excluded.online_wins,online_draws=excluded.online_draws
    WHERE player_stats.local_sessions!=excluded.local_sessions OR player_stats.online_matches!=excluded.online_matches
      OR player_stats.online_wins!=excluded.online_wins OR player_stats.online_draws!=excluded.online_draws`,userId,userId,userId,userId);
}
export async function recordOnlineResult(env,{userId,eventId,game,won,draw,finishedAt}) {
  if (!['meenfina','fabraka'].includes(game) || typeof eventId !== 'string' || !/^online:[A-Za-z0-9:_-]{1,170}$/.test(eventId)
    || typeof won !== 'boolean' || typeof draw !== 'boolean' || (won && draw) || (game==='meenfina' && (won || draw))
    || !Number.isSafeInteger(finishedAt) || finishedAt<=0 || finishedAt>Date.now()+60_000) fail('INVALID',400);
  if (!(await isLiveAccount(env,userId))) return false;
  try { await ensurePlayerProfile(env,userId); } catch (error) { if(error.code==='NOT_FOUND') return false; throw error; }
  const result = await env.DB.batch([
    stmt(env, `INSERT OR IGNORE INTO player_events(user_id,event_id,source,game,won,draw,created_at) SELECT ?,?,'online',?,?,?,? WHERE ${live('?')}`,
      userId,eventId,game,won?1:0,draw?1:0,finishedAt,userId,userId),
    recountStats(env,userId),bumpIfChanged(env,userId), ...profileAchievementStatements(env,userId),
  ]);
  return changed(result[0]);
}
export async function startLocalSession(env,userId,game,now=Date.now()) {
  gameOf(game); const id=crypto.randomUUID(); const day=Math.floor(now/86_400_000)*86_400_000;
  const result=await stmt(env, `INSERT INTO player_sessions(id,user_id,game,started_at) SELECT ?,?,?,? WHERE ${live('?')}
    AND (SELECT COUNT(*) FROM player_sessions WHERE user_id=? AND started_at>=? AND started_at<?)<24`,id,userId,game,now,userId,userId,userId,day,day+86_400_000).run();
  if(!changed(result)) fail('RATE_LIMIT',429);
  return id;
}
export async function completeLocalSession(env,userId,id,now=Date.now()) {
  const session=await first(env,`SELECT * FROM player_sessions WHERE id=? AND user_id=? AND ${live('player_sessions.user_id')}`,id,userId);
  if(!session) fail('NOT_FOUND',404);
  if(now-session.started_at<30_000) fail('SESSION_TOO_SHORT',409);
  const eventId=`local:${id}`; const day=Math.floor(now/86_400_000)*86_400_000;
  const result=await env.DB.batch([
    stmt(env, `INSERT OR IGNORE INTO player_events(user_id,event_id,source,game,created_at)
      SELECT user_id,?,'local',game,? FROM player_sessions WHERE id=? AND user_id=? AND completed_at IS NULL
      AND started_at<=? AND ${live('player_sessions.user_id')}
      AND (SELECT COUNT(*) FROM player_events e WHERE e.user_id=? AND source='local' AND created_at>=? AND created_at<?)<24`,eventId,now,id,userId,now-30_000,userId,day,day+86_400_000),
    stmt(env, `UPDATE player_sessions SET completed_at=COALESCE(completed_at,(SELECT created_at FROM player_events WHERE user_id=? AND event_id=?)) WHERE id=? AND user_id=?`,userId,eventId,id,userId),
    recountStats(env,userId),bumpIfChanged(env,userId,now),...profileAchievementStatements(env,userId,now),
  ]);
  if(!changed(result[0]) && !(await first(env,'SELECT event_id FROM player_events WHERE user_id=? AND event_id=?',userId,eventId))) {
    if(!(await isLiveAccount(env,userId))) fail('NOT_FOUND',404);
    fail('RATE_LIMIT',429);
  }
  return { counted: changed(result[0]) };
}
export function profileDeleteStatements(env,userId) {
  return ['player_images','player_profiles','player_stats','player_events','player_sessions','player_achievements']
    .map(table=>stmt(env,`DELETE FROM ${table} WHERE user_id=?`,userId));
}

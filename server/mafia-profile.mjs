import { fail } from './room-model.mjs';
import { all, first, stmt, changed } from './lamma/common.mjs';
import { liveAccountSql } from './moderation/access.mjs';
import { mafiaMediaLease, noMafiaMediaLeaseSql } from './mafia-access.mjs';
import { mafiaProgressEnabled, mafiaProgressLevel, mafiaRoleMastery, MAFIA_PROGRESS_POLICY_VERSION, MAFIA_MASTERY_THRESHOLDS } from './mafia-progression.mjs';
import { readMafiaAchievements, readMafiaRewardAchievements } from './mafia-achievements.mjs';
import { MAFIA_ROLES, MAFIA_FACTIONS, MAFIA_ROLE_GUIDE_VERSION, MAFIA_RULESET_VERSION } from '../src/online/mafia-shared.js';

const DAY=86_400_000, validKey=value=>typeof value==='string'&&/^[A-Za-z0-9:_-]{1,180}$/.test(value);
const noObserverSql=(expression,now)=>`NOT EXISTS(SELECT 1 FROM mafia_observer_memberships mo WHERE mo.user_id=${expression} AND mo.expires_at>${Math.floor(now)})`;
export const noMafiaProfileLeaseSql=(expression,now=Date.now())=>`${noMafiaMediaLeaseSql(expression,now)} AND ${noObserverSql(expression,now)}`;
export async function mafiaProfileLocked(env,id,now=Date.now()) {
  return Boolean(await mafiaMediaLease(env,id,now)||await first(env,'SELECT 1 FROM mafia_observer_memberships WHERE user_id=? AND expires_at>?',id,now));
}
async function assertUnlocked(env,id,now) {if(await mafiaProfileLocked(env,id,now))fail('MAFIA_SOCIAL_LOCKED',409);}

export function mafiaPublicCatalog(env) {
  return {catalogVersion:MAFIA_ROLE_GUIDE_VERSION,rulesetVersion:MAFIA_RULESET_VERSION,enabled:mafiaProgressEnabled(env),
    roles:Object.values(MAFIA_ROLES),factions:MAFIA_FACTIONS,progression:{policyVersion:MAFIA_PROGRESS_POLICY_VERSION,
      xpPerLevel:mafiaProgressLevel(0).xpPerLevel,masteryThresholds:MAFIA_MASTERY_THRESHOLDS,
      public:{completionXp:50,winBonusXp:20,drawBonusXp:10},private:{completionXp:50,dailyRewardedMatches:3,bonusXp:0},representativeQualifiedMatches:1}};
}

const noBlock=`NOT EXISTS(SELECT 1 FROM social_blocks b WHERE (b.blocker_id=viewer.id AND b.blocked_id=target.id) OR (b.blocked_id=viewer.id AND b.blocker_id=target.id))`;
const friends=`EXISTS(SELECT 1 FROM social_friendships f WHERE f.status='accepted' AND ((f.user_low=viewer.id AND f.user_high=target.id) OR (f.user_high=viewer.id AND f.user_low=target.id)))`;
async function authorizedProgressRow(env,viewerId,targetId,now) {
  // The read authorization and aggregates share one SQL snapshot. A public
  // read never returns account IDs, current matches, receipts or raw outcomes.
  return first(env,`SELECT COALESCE(p.visibility,'private') AS visibility,p.representative_role_id AS representativeRoleId,
    COALESCE(p.revision,0) AS revision,COALESCE(s.total_xp,0) AS totalXp,COALESCE(s.rewarded_matches,0) AS rewardedMatches,
    COALESCE(s.legacy_matches,0) AS legacyMatches,
    (SELECT json_group_array(json_object('roleId',r.role_id,'qualifiedMatches',r.qualified_matches,'wins',r.wins,'draws',r.draws,'legacyMatches',r.legacy_matches))
      FROM mafia_role_progress r WHERE r.user_id=target.id) AS roles
    FROM users target JOIN users viewer ON viewer.id=?
    LEFT JOIN mafia_profile_preferences p ON p.user_id=target.id LEFT JOIN mafia_player_progress s ON s.user_id=target.id
    WHERE target.id=? AND ${liveAccountSql('target.id')} AND ${liveAccountSql('viewer.id')} AND ${noBlock}
      AND ${noMafiaProfileLeaseSql('viewer.id',now)} AND ${noMafiaProfileLeaseSql('target.id',now)}
      AND (viewer.id=target.id OR p.visibility='public' OR (p.visibility='friends' AND ${friends}))`,viewerId,targetId);
}
function projection(row,owner) {
  const records=new Map(JSON.parse(row.roles||'[]').map(role=>[role.roleId,role]));
  const roles=Object.keys(MAFIA_ROLES).map(roleId=>{
    const role=records.get(roleId)||{qualifiedMatches:0,wins:0,draws:0,legacyMatches:0};
    return {roleId,qualifiedMatches:role.qualifiedMatches,wins:role.wins,draws:role.draws,legacyMatches:role.legacyMatches,
      mastery:mafiaRoleMastery(role.qualifiedMatches),representativeUnlocked:role.qualifiedMatches>=1};
  });
  const representativeRoleId=roles.some(role=>role.roleId===row.representativeRoleId&&role.representativeUnlocked)?row.representativeRoleId:null;
  return {available:true,progress:{totalXp:row.totalXp,...mafiaProgressLevel(row.totalXp),rewardedMatches:row.rewardedMatches,legacyMatches:row.legacyMatches},
    roles,preferences:{...(owner?{visibility:row.visibility}:{}),representativeRoleId},...(owner?{revision:row.revision,preferencesLocked:false}:{})};
}
export async function readMafiaProgress(env,viewerId,targetId=viewerId,now=Date.now()) {
  if(!mafiaProgressEnabled(env)||!env.DB)return {available:false};
  const unavailable=async()=>viewerId===targetId&&await mafiaProfileLocked(env,viewerId,Date.now())?{available:false,preferencesLocked:true}:{available:false};
  let row=await authorizedProgressRow(env,viewerId,targetId,now);if(!row)return unavailable();
  const awards=await readMafiaAchievements(env,targetId);
  // Recheck after the separate award lookup: a block, privacy edit or new lease
  // must invalidate data assembled before that change.
  row=await authorizedProgressRow(env,viewerId,targetId,Date.now());if(!row)return unavailable();
  return {...projection(row,viewerId===targetId),achievements:awards.earned,...(viewerId===targetId?{grants:awards.grants}:{})};
}

export async function patchMafiaPreferences(env,id,body,now=Date.now()) {
  if(!mafiaProgressEnabled(env))fail('MAFIA_PROGRESS_DISABLED',503);
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>!['revision','visibility','representativeRoleId'].includes(key))
    ||!Number.isSafeInteger(body.revision)||body.revision<0||(!Object.hasOwn(body,'visibility')&&!Object.hasOwn(body,'representativeRoleId')))fail('INVALID',400);
  if(Object.hasOwn(body,'visibility')&&!['private','friends','public'].includes(body.visibility))fail('INVALID',400);
  if(Object.hasOwn(body,'representativeRoleId')&&body.representativeRoleId!==null&&!Object.hasOwn(MAFIA_ROLES,body.representativeRoleId))fail('INVALID',400);
  await assertUnlocked(env,id,now);
  const current=await first(env,`SELECT visibility,representative_role_id AS representativeRoleId,revision FROM mafia_profile_preferences WHERE user_id=?`,id)
    ||{visibility:'private',representativeRoleId:null,revision:0};
  if(current.revision!==body.revision)fail('CONFLICT',409);
  const visibility=body.visibility??current.visibility,roleId=Object.hasOwn(body,'representativeRoleId')?body.representativeRoleId:current.representativeRoleId;
  if(roleId&&!await first(env,'SELECT 1 FROM mafia_role_progress WHERE user_id=? AND role_id=? AND qualified_matches>=1',id,roleId))fail('MAFIA_ROLE_LOCKED',409);
  const result=await stmt(env,`INSERT INTO mafia_profile_preferences(user_id,visibility,representative_role_id,revision,updated_at)
    SELECT ?,?,?,1,? WHERE ${liveAccountSql('?')} AND ${noMafiaProfileLeaseSql('?',now)}
      AND COALESCE((SELECT revision FROM mafia_profile_preferences WHERE user_id=?),0)=?
      AND (? IS NULL OR EXISTS(SELECT 1 FROM mafia_role_progress WHERE user_id=? AND role_id=? AND qualified_matches>=1))
    ON CONFLICT(user_id) DO UPDATE SET visibility=excluded.visibility,representative_role_id=excluded.representative_role_id,
      revision=mafia_profile_preferences.revision+1,updated_at=excluded.updated_at WHERE mafia_profile_preferences.revision=?`,
    id,visibility,roleId,now,id,id,id,id,id,body.revision,roleId,id,roleId,body.revision).run();
  if(!changed(result)) {
    if(!await first(env,`SELECT id FROM users WHERE id=? AND ${liveAccountSql('users.id')}`,id))fail('NOT_FOUND',404);
    await assertUnlocked(env,id,Date.now());fail('CONFLICT',409);
  }
  return readMafiaProgress(env,id,id,Date.now());
}

const rewardReceiptRow=(env,id,matchKey,now)=>first(env,`SELECT match_key AS matchKey,xp_awarded AS xpAwarded,participation_granted AS participationGranted,
    exclusion_reason AS exclusionReason,finished_at AS finishedAt,role_id AS roleId,initial_faction AS initialFaction,faction,won,draw,forfeited,
    reward_policy_version AS rewardPolicyVersion FROM mafia_progress_events
    WHERE user_id=? AND match_key=? AND event_kind='match_completed' AND status='processed' AND finished_at<=?
      AND ${liveAccountSql('mafia_progress_events.user_id')} AND ${noMafiaProfileLeaseSql('mafia_progress_events.user_id',now)}`,id,matchKey,now-30_000);
export async function readMafiaReward(env,id,matchKey,now=Date.now()) {
  if(!validKey(matchKey))fail('INVALID',400);
  if(!mafiaProgressEnabled(env))return {available:false,status:'pending'};
  if(await mafiaProfileLocked(env,id,now))return {status:'pending'};
  let receipt=await rewardReceiptRow(env,id,matchKey,now);
  if(!receipt)return {status:'pending'};
  const awards=await readMafiaRewardAchievements(env,id,matchKey);
  if(await mafiaProfileLocked(env,id,Date.now()))return {status:'pending'};
  // A deletion also removes leases: the unlocked check alone cannot authorize
  // a receipt selected before deletion/suspension during the award lookup.
  receipt=await rewardReceiptRow(env,id,matchKey,Date.now());if(!receipt)return {status:'pending'};
  return {status:'processed',...receipt,participationGranted:receipt.participationGranted===1,won:receipt.won===1,draw:receipt.draw===1,forfeited:receipt.forfeited===1,
    achievements:awards.achievements,grants:awards.grants};
}

function historyCursor(value,id,now) {
  if(!value)return null;
  try {
    if(value.length>2048)throw 0;
    const cursor=JSON.parse(atob(value));
    if(cursor.v!==1||cursor.owner!==id||!Number.isSafeInteger(cursor.at)||cursor.at<=0||cursor.at>now||now-cursor.at>15*60_000
      ||!Number.isSafeInteger(cursor.finishedAt)||cursor.finishedAt<=0||cursor.finishedAt>cursor.at||!validKey(cursor.matchKey))throw 0;
    return cursor;
  } catch {fail('INVALID',400);}
}
export async function readMafiaHistory(env,id,searchParams,now=Date.now()) {
  const rawLimit=searchParams.get('limit'),limit=rawLimit==null?50:Number(rawLimit);
  if(rawLimit!=null&&(!/^[1-9]\d*$/.test(rawLimit)||!Number.isSafeInteger(limit)||limit>50))fail('INVALID',400);
  const cursor=historyCursor(searchParams.get('cursor'),id,now),at=cursor?.at??now;
  const rows=await all(env,`SELECT match_key AS matchKey,role_id AS roleId,faction,initial_faction AS initialFaction,won,draw,forfeited,finished_at AS finishedAt
    FROM mafia_results WHERE user_id=? AND finished_at>? AND finished_at<=?${cursor?' AND (finished_at<? OR (finished_at=? AND match_key<?))':''}
    ORDER BY finished_at DESC,match_key DESC LIMIT ?`,id,now-30*DAY,at,...(cursor?[cursor.finishedAt,cursor.finishedAt,cursor.matchKey]:[]),limit+1);
  const matches=rows.slice(0,limit),last=matches.at(-1);
  const stats=await all(env,'SELECT role_id AS roleId,faction,COUNT(*) AS matches,SUM(won) AS wins,SUM(draw) AS draws FROM mafia_results WHERE user_id=? AND finished_at>? AND finished_at<=? GROUP BY role_id,faction',id,now-30*DAY,at);
  // Preserve the existing history contract (observers cannot read it), while
  // invalidating snapshots assembled before a new observation/deletion/suspension.
  const permission=await first(env,`SELECT ${liveAccountSql('?')} AS live,
    EXISTS(SELECT 1 FROM mafia_observer_memberships WHERE user_id=? AND expires_at>?) AS observing`,id,id,id,Date.now());
  if(!permission?.live)fail('NOT_FOUND',404);
  if(permission.observing)fail('MAFIA_OBSERVER_ACTIVE',409);
  return {matches,stats,retentionDays:30,nextCursor:rows.length>limit?btoa(JSON.stringify({v:1,owner:id,at,finishedAt:last.finishedAt,matchKey:last.matchKey})):null};
}

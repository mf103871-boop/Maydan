import { fail } from './room-model.mjs';
import { json, readJson, sha256 } from './protocol.mjs';
import { requireSession } from './accounts/session.mjs';
import { all, first, stmt, changed, ident, member, admin, cleanText } from './lamma/common.mjs';
import { userId, clientIdOf } from './social/model.mjs';
import { liveAccountSql } from './moderation/access.mjs';
import { publicName } from './profiles/model.mjs';
import { noMafiaProfileLeaseSql } from './mafia-profile.mjs';
import { MAFIA_COMMUNITY_SEASON as season, MAFIA_CLUB_MISSION as mission, MAFIA_TOURNAMENT_TEMPLATE as template } from '../src/online/mafia-community-shared.js';

export const mafiaCommunityEnabled = env => String(env.APP_ORIGIN)==='https://maydan-mafia-preview.mf103871.workers.dev' && String(env.MAFIA_ENABLED)==='1' && String(env.MAFIA_COMMUNITY_ENABLED)==='1';
const qualified = alias => `${alias}.source='live' AND ${alias}.reward_policy_version=1 AND ${alias}.status='processed' AND ${alias}.participation_granted=1 AND ${alias}.forfeited=0`;
// Registration belongs to the membership that created it. Leaving/rejoining
// must not revive an old seat in a roster that has already been frozen.
const registeredMember = (group,user,registeredAt) => `${member(group,user)} AND EXISTS(SELECT 1 FROM social_group_members membership_epoch WHERE membership_epoch.group_id=${group} AND membership_epoch.user_id=${user} AND membership_epoch.left_at IS NULL AND membership_epoch.joined_at<=${registeredAt})`;
const actorSql = (actor, now=Date.now()) => `${liveAccountSql(ident(actor.userId))} AND ${noMafiaProfileLeaseSql(ident(actor.userId),now)} AND EXISTS(SELECT 1 FROM sessions s WHERE s.id='${actor.sessionId}' AND s.user_id=${ident(actor.userId)} AND s.expires_at>${now} AND (s.revoked_at IS NULL OR s.revoked_at>${now}))`;
async function assertActor(env,actor) {
  if(!/^[a-f0-9]{16}$/.test(actor.sessionId||'')||!await first(env,`SELECT 1 AS ok WHERE ${actorSql(actor)}`))fail('MAFIA_SOCIAL_LOCKED',409);
}
function fields(body,allowed) { if(!body||Array.isArray(body)||typeof body!=='object'||Object.keys(body).some(key=>!allowed.includes(key)))fail('INVALID',400); }
function revision(body) { if(!Number.isSafeInteger(body.revision)||body.revision<0)fail('INVALID',400); return body.revision; }
const matchKey=value=>{if(typeof value!=='string'||!/^[A-Za-z0-9:_-]{1,180}$/.test(value))fail('INVALID',400);return value;};
function grantStatements(env,actor,achievementId,itemId,earnedKey,condition,now) {
  const owned=`user_id=${ident(actor.userId)} AND achievement_id='${achievementId}'`;
  return [stmt(env,`INSERT OR IGNORE INTO mafia_achievements(user_id,achievement_id,earned_at,earned_match_key) SELECT ?,?,?,? WHERE ${actorSql(actor,now)} AND (${condition})`,actor.userId,achievementId,now,earnedKey),
    stmt(env,`INSERT OR IGNORE INTO mafia_cosmetic_grants(user_id,item_id,source,achievement_id,granted_at,revoked_at) SELECT ?,?,'mafia_achievement',?,?,NULL WHERE EXISTS(SELECT 1 FROM mafia_achievements WHERE ${owned}) AND ${actorSql(actor,now)}`,actor.userId,itemId,achievementId,now)];
}
async function seasonView(env,actor) {
  const row=await first(env,`SELECT (SELECT COUNT(*) FROM mafia_progress_events q WHERE q.user_id=? AND ${qualified('q')} AND q.visibility='public' AND q.finished_at>=? AND q.finished_at<?) AS completed,EXISTS(SELECT 1 FROM mafia_achievements WHERE user_id=? AND achievement_id=?) AS claimed WHERE ${actorSql(actor)}`,actor.userId,season.startsAt,season.endsAt,actor.userId,season.achievementId);
  if(!row)fail('MAFIA_SOCIAL_LOCKED',409);
  return {...season,completed:row.completed,claimed:Boolean(row.claimed),free:true,cosmeticOnly:true,canClaim:row.completed>=season.target&&!row.claimed};
}
async function claimSeason(env,actor) {
  const now=Date.now(),condition=`(SELECT COUNT(*) FROM mafia_progress_events q WHERE q.user_id=${ident(actor.userId)} AND ${qualified('q')} AND q.visibility='public' AND q.finished_at>=${season.startsAt} AND q.finished_at<${season.endsAt})>=${season.target}`;
  await env.DB.batch(grantStatements(env,actor,season.achievementId,season.itemId,`community:${season.id}`,condition,now));
  const view=await seasonView(env,actor);if(!view.claimed)fail('MAFIA_REWARD_LOCKED',409);return {season:view};
}
async function listClubs(env,actor) {
  const row=await first(env,`SELECT (SELECT json_group_array(json_object('id',x.id,'name',x.name,'role',x.role,'motto',x.motto,'clubCreatedAt',x.clubCreatedAt,'revision',x.revision)) FROM
    (SELECT g.id,g.name,gm.role,c.motto,c.created_at AS clubCreatedAt,COALESCE(c.revision,0) AS revision FROM social_groups g JOIN social_group_members gm ON gm.group_id=g.id AND gm.user_id=? LEFT JOIN mafia_clubs c ON c.group_id=g.id WHERE ${member('g.id',ident(actor.userId))} ORDER BY g.updated_at DESC,g.id LIMIT 50) x) AS groups WHERE ${actorSql(actor)}`,actor.userId);
  if(!row)fail('MAFIA_SOCIAL_LOCKED',409);return {groups:JSON.parse(row.groups||'[]')};
}
async function clubView(env,actor,g) {
  const currentCredit=`cc.group_id=c.group_id AND EXISTS(SELECT 1 FROM social_group_members m WHERE m.group_id=cc.group_id AND m.user_id=cc.user_id AND m.left_at IS NULL AND m.joined_at<=cc.finished_at AND ${liveAccountSql('m.user_id')})`;
  // The projection and all mutable authorization share this final SQL snapshot.
  const row=await first(env,`SELECT c.*,sg.name,gm.role,gm.joined_at,
    (SELECT COUNT(*) FROM mafia_club_credits cc WHERE ${currentCredit}) AS total,
    (SELECT COUNT(*) FROM mafia_club_credits cc WHERE ${currentCredit} AND cc.user_id=gm.user_id) AS own,
    EXISTS(SELECT 1 FROM mafia_achievements a WHERE a.user_id=gm.user_id AND a.achievement_id=?) AS claimed,
    (SELECT json_group_array(json_object('id',t.id,'title',t.title,'startsAt',t.starts_at,'state',t.state,'revision',t.revision)) FROM (SELECT * FROM mafia_tournaments WHERE group_id=? ORDER BY created_at DESC,id DESC LIMIT 20) t) AS tournaments
    FROM mafia_clubs c JOIN social_groups sg ON sg.id=c.group_id JOIN social_group_members gm ON gm.group_id=c.group_id AND gm.user_id=? WHERE c.group_id=? AND ${member('c.group_id',ident(actor.userId))} AND ${actorSql(actor)}`,mission.achievementId,g,actor.userId,g);
  if(!row)fail('NOT_FOUND',404);
  return {club:{groupId:g,name:row.name,motto:row.motto,createdAt:row.created_at,revision:row.revision,role:row.role},mission:{...mission,total:row.total,own:row.own,claimed:Boolean(row.claimed),canClaim:row.total>=mission.target&&row.own>=mission.ownTarget&&!row.claimed},tournaments:JSON.parse(row.tournaments||'[]')};
}
async function setClub(env,actor,g,body) {
  fields(body,['motto','revision']);revision(body);const motto=cleanText(body.motto,100),now=Date.now();
  const result=await env.DB.batch([stmt(env,`INSERT INTO mafia_clubs(group_id,motto,created_at,revision) SELECT ?,?,?,1 WHERE ?=0 AND ${admin(ident(g),ident(actor.userId))} AND ${actorSql(actor,now)} ON CONFLICT(group_id) DO NOTHING`,g,motto,now,body.revision),
    stmt(env,`UPDATE mafia_clubs SET motto=?,revision=revision+1 WHERE group_id=? AND revision=? AND ?>0 AND ${admin(ident(g),ident(actor.userId))} AND ${actorSql(actor,now)}`,motto,g,body.revision,body.revision)]);
  if(!result.some(changed))fail('CONFLICT',409);return clubView(env,actor,g);
}
async function creditClub(env,actor,g) {
  const now=Date.now();
  // One account/match may support one club only. Credit starts at membership and
  // club creation; changing groups never imports a former club's old receipts.
  await stmt(env,`INSERT OR IGNORE INTO mafia_club_credits(user_id,match_key,group_id,finished_at,credited_at)
    SELECT q.user_id,q.match_key,c.group_id,q.finished_at,? FROM mafia_progress_events q
    JOIN mafia_clubs c ON c.group_id=? JOIN social_group_members gm ON gm.group_id=c.group_id AND gm.user_id=q.user_id
    WHERE q.user_id=? AND ${qualified('q')} AND q.visibility='public' AND gm.left_at IS NULL AND q.finished_at>=MAX(gm.joined_at,c.created_at)
      AND NOT EXISTS(SELECT 1 FROM mafia_club_credits old WHERE old.user_id=q.user_id AND old.match_key=q.match_key)
      AND ${member('c.group_id',ident(actor.userId))} AND ${actorSql(actor,now)} ORDER BY q.finished_at,q.match_key LIMIT 500`,now,g,actor.userId).run();
  const condition=`EXISTS(SELECT 1 FROM mafia_clubs c WHERE c.group_id=${ident(g)} AND ${member('c.group_id',ident(actor.userId))}
    AND (SELECT COUNT(*) FROM mafia_club_credits cc JOIN social_group_members gm ON gm.group_id=cc.group_id AND gm.user_id=cc.user_id WHERE cc.group_id=c.group_id AND gm.left_at IS NULL AND gm.joined_at<=cc.finished_at AND ${liveAccountSql('gm.user_id')})>=${mission.target}
    AND (SELECT COUNT(*) FROM mafia_club_credits cc JOIN social_group_members gm ON gm.group_id=cc.group_id AND gm.user_id=cc.user_id WHERE cc.group_id=c.group_id AND cc.user_id=${ident(actor.userId)} AND gm.left_at IS NULL AND gm.joined_at<=cc.finished_at)>=${mission.ownTarget})`;
  await env.DB.batch(grantStatements(env,actor,mission.achievementId,mission.itemId,`community:club:${g}`,condition,now));
  return clubView(env,actor,g);
}
async function tournamentRow(env,actor,id,manage=false) {
  const row=await first(env,`SELECT t.* FROM mafia_tournaments t WHERE t.id=? AND ${manage?admin('t.group_id',ident(actor.userId)):member('t.group_id',ident(actor.userId))} AND ${actorSql(actor)}`,id);
  if(!row)fail('NOT_FOUND',404);return row;
}
async function tournamentView(env,actor,id) {
  const row=await first(env,`SELECT t.*,gm.role,
    (SELECT json_group_array(json_object('userId',roster.user_id,'name',roster.name,'joinedAt',roster.joined_at,'points',roster.points,'place',roster.place)) FROM
      (SELECT tm.user_id,tm.joined_at,roster_user.name,COALESCE((SELECT SUM(p.points) FROM mafia_tournament_points p WHERE p.tournament_id=tm.tournament_id AND p.user_id=tm.user_id),0) AS points,a.place
       FROM mafia_tournament_members tm JOIN mafia_tournaments roster_t ON roster_t.id=tm.tournament_id
       LEFT JOIN users roster_user ON roster_user.id=tm.user_id AND ${member('roster_t.group_id','tm.user_id')}
       LEFT JOIN mafia_tournament_awards a ON a.tournament_id=tm.tournament_id AND a.user_id=tm.user_id
       WHERE tm.tournament_id=? AND ${liveAccountSql('tm.user_id')} ORDER BY points DESC,tm.joined_at,tm.user_id) roster) AS members,
    (SELECT json_group_array(json_object('matchKey',m.match_key,'finishedAt',m.finished_at)) FROM (SELECT * FROM mafia_tournament_matches WHERE tournament_id=? ORDER BY finished_at,match_key) m) AS matches
    FROM mafia_tournaments t JOIN social_group_members gm ON gm.group_id=t.group_id AND gm.user_id=? WHERE t.id=? AND ${member('t.group_id',ident(actor.userId))} AND ${actorSql(actor)}`,id,id,actor.userId,id);
  if(!row)fail('NOT_FOUND',404);
  return {tournament:{id,groupId:row.group_id,title:row.title,startsAt:row.starts_at,lockedAt:row.locked_at,closedAt:row.closed_at,state:row.state,revision:row.revision,template:JSON.parse(row.template_json),role:row.role},members:JSON.parse(row.members||'[]').map(entry=>({...entry,name:typeof entry.name==='string'?publicName(entry.name):null})),matches:JSON.parse(row.matches||'[]')};
}
async function createTournament(env,actor,g,body) {
  fields(body,['title','startsAt','clientId']);const title=cleanText(body.title,60),clientId=clientIdOf(body.clientId),now=Date.now();
  if(!Number.isSafeInteger(body.startsAt)||body.startsAt<=0)fail('INVALID',400);
  const hash=await sha256(JSON.stringify({title,startsAt:body.startsAt,template})),id=crypto.randomUUID();
  const prior=await first(env,`SELECT id,creation_hash FROM mafia_tournaments WHERE group_id=? AND client_id=? AND ${admin('mafia_tournaments.group_id',ident(actor.userId))} AND ${actorSql(actor)}`,g,clientId);
  if(prior){if(prior.creation_hash!==hash)fail('CONFLICT',409);await tournamentRow(env,actor,prior.id,true);return tournamentView(env,actor,prior.id);}
  if(body.startsAt<now+15*60_000||body.startsAt>now+7*86_400_000)fail('INVALID',400);
  await stmt(env,`INSERT OR IGNORE INTO mafia_tournaments(id,group_id,created_by,title,starts_at,created_at,state,template_json,client_id,creation_hash) SELECT ?,?,?,?,?,?,'registration',?,?,? WHERE EXISTS(SELECT 1 FROM mafia_clubs WHERE group_id=?) AND ${admin(ident(g),ident(actor.userId))} AND ${actorSql(actor,now)} AND (SELECT COUNT(*) FROM mafia_tournaments WHERE group_id=? AND state IN ('registration','locked'))<3`,id,g,actor.userId,title,body.startsAt,now,JSON.stringify(template),clientId,hash,g,g).run();
  const current=await first(env,`SELECT id,creation_hash FROM mafia_tournaments WHERE group_id=? AND client_id=? AND ${admin('mafia_tournaments.group_id',ident(actor.userId))} AND ${actorSql(actor)}`,g,clientId);
  if(!current)fail('TOURNAMENT_LIMIT',409);if(current.creation_hash!==hash)fail('CONFLICT',409);return tournamentView(env,actor,current.id);
}
async function registerTournament(env,actor,id,remove) {
  const now=Date.now(),row=await tournamentRow(env,actor,id);
  if(row.state!=='registration'||now>=row.starts_at)fail('TOURNAMENT_LOCKED',409);
  const guard=`EXISTS(SELECT 1 FROM mafia_tournaments t WHERE t.id=${ident(id)} AND t.state='registration' AND t.starts_at>${now} AND ${member('t.group_id',ident(actor.userId))}) AND ${actorSql(actor,now)}`;
  if(remove)await stmt(env,`DELETE FROM mafia_tournament_members WHERE tournament_id=? AND user_id=? AND ${guard}`,id,actor.userId).run();
  else await stmt(env,`INSERT OR IGNORE INTO mafia_tournament_members(tournament_id,user_id,joined_at) SELECT ?,?,? WHERE ${guard} AND (SELECT COUNT(*) FROM mafia_tournament_members WHERE tournament_id=?)<8`,id,actor.userId,now,id).run();
  const view=await tournamentView(env,actor,id);if(!remove&&!view.members.some(x=>x.userId===actor.userId))fail('FULL',409);return view;
}
async function changeTournament(env,actor,id,body) {
  fields(body,['revision','action']);revision(body);const now=Date.now(),row=await tournamentRow(env,actor,id,true);
  if(body.action==='close'&&row.state==='closed'||body.action==='cancel'&&row.state==='cancelled')return tournamentView(env,actor,id);
  if(row.revision!==body.revision)fail('CONFLICT',409);
  const manage=`${admin('mafia_tournaments.group_id',ident(actor.userId))} AND ${actorSql(actor,now)}`;
  let sql;
  if(body.action==='lock')sql=`UPDATE mafia_tournaments SET state='locked',locked_at=${now},revision=revision+1 WHERE id=? AND revision=? AND state='registration' AND starts_at>${now} AND (SELECT COUNT(*) FROM mafia_tournament_members tm WHERE tm.tournament_id=mafia_tournaments.id)=8 AND NOT EXISTS(SELECT 1 FROM mafia_tournament_members tm WHERE tm.tournament_id=mafia_tournaments.id AND NOT (${registeredMember('mafia_tournaments.group_id','tm.user_id','tm.joined_at')})) AND ${manage}`;
  else if(body.action==='cancel')sql=`UPDATE mafia_tournaments SET state='cancelled',closed_at=${now},revision=revision+1 WHERE id=? AND revision=? AND state IN ('registration','locked') AND ${manage}`;
  else if(body.action==='close')sql=`UPDATE mafia_tournaments SET state='closed',closed_at=${now},revision=revision+1 WHERE id=? AND revision=? AND state='locked' AND (SELECT COUNT(*) FROM mafia_tournament_matches WHERE tournament_id=mafia_tournaments.id)=3 AND (SELECT COUNT(*) FROM mafia_tournament_members tm WHERE tm.tournament_id=mafia_tournaments.id)=8 AND NOT EXISTS(SELECT 1 FROM mafia_tournament_members tm WHERE tm.tournament_id=mafia_tournaments.id AND NOT (${registeredMember('mafia_tournaments.group_id','tm.user_id','tm.joined_at')})) AND ${manage}`;
  else fail('INVALID',400);
  const statements=[stmt(env,sql,id,body.revision)];
  if(body.action==='close')statements.push(stmt(env,`INSERT OR IGNORE INTO mafia_tournament_awards(tournament_id,user_id,points,place,awarded_at) SELECT ?,p.user_id,p.points,DENSE_RANK() OVER (ORDER BY p.points DESC),? FROM (SELECT user_id,SUM(points) AS points FROM mafia_tournament_points WHERE tournament_id=? GROUP BY user_id HAVING COUNT(*)=3) p WHERE EXISTS(SELECT 1 FROM mafia_tournaments WHERE id=? AND state='closed' AND closed_at=?) AND ${actorSql(actor,now)}`,id,now,id,id,now));
  const result=await env.DB.batch(statements);if(!changed(result[0])){
    const current=await tournamentRow(env,actor,id,true);
    if(body.action==='close'&&current.state==='closed')return tournamentView(env,actor,id);
    fail('TOURNAMENT_UNAVAILABLE',409);
  }
  return tournamentView(env,actor,id);
}
async function addTournamentMatch(env,actor,id,body) {
  fields(body,['matchKey']);const key=matchKey(body.matchKey),row=await tournamentRow(env,actor,id,true),now=Date.now();
  const prior=await first(env,'SELECT tournament_id FROM mafia_tournament_matches WHERE match_key=?',key);
  if(prior?.tournament_id===id)return tournamentView(env,actor,id);
  if(row.state!=='locked'||now<row.starts_at)fail('TOURNAMENT_LOCKED',409);
  const history=await first(env,'SELECT h.summary,h.ruleset_version,h.finished_at FROM mafia_history h WHERE h.match_key=? AND h.finished_at<=? AND h.finished_at>? AND EXISTS(SELECT 1 FROM mafia_results own WHERE own.match_key=h.match_key AND own.user_id=?)',key,now-30_000,now-30*86_400_000,actor.userId);
  let summary;try{summary=JSON.parse(history?.summary);}catch{fail('TOURNAMENT_MATCH_INVALID',409);}
  if(!history||history.ruleset_version!==1||summary.mode!=='classic'||summary.settings?.capacity!==8||summary.settings?.visibility!=='private'||summary.settings?.voiceMode!=='off'||!Number.isSafeInteger(summary.startedAt)||summary.startedAt<Math.max(row.locked_at,row.starts_at)||summary.startedAt>=history.finished_at||summary.reveal?.players?.length!==8)fail('TOURNAMENT_MATCH_INVALID',409);
  const receipts=await all(env,"SELECT user_id,event_digest,started_at,finished_at,won,draw,forfeited FROM mafia_progress_events WHERE match_key=? AND source='live' AND reward_policy_version=1 AND status='processed' AND visibility='private'",key);
  const roster=await all(env,'SELECT user_id FROM mafia_tournament_members WHERE tournament_id=?',id),rosterIds=roster.map(r=>r.user_id).sort(),receiptIds=receipts.map(r=>r.user_id).sort();
  if(rosterIds.length!==8||JSON.stringify(rosterIds)!==JSON.stringify(receiptIds)||receipts.some(r=>r.forfeited||r.started_at!==summary.startedAt||r.finished_at!==history.finished_at)||new Set(receipts.map(r=>r.event_digest)).size!==1)fail('TOURNAMENT_MATCH_INVALID',409);
  const digest=receipts[0].event_digest;
  const guard=`EXISTS(SELECT 1 FROM mafia_tournaments t WHERE t.id=${ident(id)} AND t.state='locked' AND t.revision=${row.revision} AND ${admin('t.group_id',ident(actor.userId))}) AND ${actorSql(actor,now)}
    AND (SELECT COUNT(*) FROM mafia_tournament_members tm WHERE tm.tournament_id=${ident(id)})=8
    AND NOT EXISTS(SELECT 1 FROM mafia_tournament_members tm JOIN mafia_tournaments t ON t.id=tm.tournament_id WHERE t.id=${ident(id)} AND NOT (${registeredMember('t.group_id','tm.user_id','tm.joined_at')}))
    AND (SELECT COUNT(*) FROM mafia_tournament_matches WHERE tournament_id=${ident(id)})<3
    AND EXISTS(SELECT 1 FROM mafia_history h WHERE h.match_key=? AND h.summary=? AND h.ruleset_version=1 AND h.finished_at=? AND EXISTS(SELECT 1 FROM mafia_results own WHERE own.match_key=h.match_key AND own.user_id=${ident(actor.userId)}))
    AND (SELECT COUNT(*) FROM mafia_progress_events q JOIN mafia_tournament_members tm ON tm.user_id=q.user_id AND tm.tournament_id=${ident(id)} WHERE q.match_key=? AND q.event_digest=? AND q.source='live' AND q.reward_policy_version=1 AND q.status='processed' AND q.visibility='private' AND q.forfeited=0 AND q.started_at=${summary.startedAt} AND q.finished_at=?)=8`;
  await env.DB.batch([stmt(env,`INSERT OR IGNORE INTO mafia_tournament_matches(tournament_id,match_key,event_digest,finished_at,accepted_at) SELECT ?,?,?,?,? WHERE ${guard}`,id,key,digest,history.finished_at,now,key,history.summary,history.finished_at,key,digest,history.finished_at),
    stmt(env,`INSERT OR IGNORE INTO mafia_tournament_points(tournament_id,match_key,user_id,points) SELECT ?,q.match_key,q.user_id,CASE WHEN q.won=1 THEN 3 WHEN q.draw=1 THEN 1 ELSE 0 END FROM mafia_progress_events q JOIN mafia_tournament_members tm ON tm.tournament_id=? AND tm.user_id=q.user_id WHERE q.match_key=? AND q.event_digest=? AND EXISTS(SELECT 1 FROM mafia_tournament_matches m WHERE m.tournament_id=? AND m.match_key=q.match_key AND m.event_digest=q.event_digest) AND ${actorSql(actor,now)}`,id,id,key,digest,id)]);
  const accepted=await first(env,'SELECT tournament_id FROM mafia_tournament_matches WHERE match_key=?',key);if(accepted?.tournament_id!==id)fail('TOURNAMENT_MATCH_INVALID',409);
  return tournamentView(env,actor,id);
}
export async function routeMafiaCommunity(request,env,url=new URL(request.url),charge) {
  const path=url.pathname;if(!path.startsWith('/api/mafia/community'))return null;
  if(!mafiaCommunityEnabled(env))fail('MAFIA_COMMUNITY_DISABLED',503);
  const {user,session}=await requireSession(env,request,{rotate:false}),actor={userId:user.id,sessionId:session.id};
  if(charge)await charge(request.method==='GET'?'profileRead':'socialWrite','RATE_LIMIT',user.id);await assertActor(env,actor);
  const method=request.method,body=()=>readJson(request,4096);let m;
  if(path==='/api/mafia/community'&&method==='GET')return json({enabled:true,season:await seasonView(env,actor),...await listClubs(env,actor)});
  if(path==='/api/mafia/community/season/claim'&&method==='POST'){fields(await body(),[]);return json(await claimSeason(env,actor));}
  if((m=/^\/api\/mafia\/community\/clubs\/([A-Za-z0-9_-]{1,80})(?:\/(credit|tournaments))?$/.exec(path))){
    const g=userId(m[1]);if(!m[2]&&method==='GET')return json(await clubView(env,actor,g));
    if(!m[2]&&method==='PUT')return json(await setClub(env,actor,g,await body()));
    if(m[2]==='credit'&&method==='POST'){fields(await body(),[]);return json(await creditClub(env,actor,g));}
    if(m[2]==='tournaments'&&method==='POST')return json(await createTournament(env,actor,g,await body()));
  }
  if((m=/^\/api\/mafia\/community\/tournaments\/([A-Za-z0-9_-]{1,80})(?:\/(registration|matches))?$/.exec(path))){
    const id=userId(m[1]);if(!m[2]&&method==='GET')return json(await tournamentView(env,actor,id));
    if(!m[2]&&method==='PATCH')return json(await changeTournament(env,actor,id,await body()));
    if(m[2]==='registration'&&['PUT','DELETE'].includes(method)){if(method==='PUT')fields(await body(),[]);return json(await registerTournament(env,actor,id,method==='DELETE'));}
    if(m[2]==='matches'&&method==='POST')return json(await addTournamentMatch(env,actor,id,await body()));
  }
  fail('NOT_FOUND',404);
}
export function mafiaCommunityDeleteStatements(env,id) {
  // Loss of a frozen participant cancels a running event, rather than letting a
  // changed roster inherit its result. Closed recognition for others survives.
  return [stmt(env,"UPDATE mafia_tournaments SET state='cancelled',closed_at=?,revision=revision+1 WHERE state IN ('registration','locked') AND id IN (SELECT tournament_id FROM mafia_tournament_members WHERE user_id=?)",Date.now(),id),
    ...['mafia_tournament_awards','mafia_tournament_points','mafia_tournament_members','mafia_club_credits'].map(table=>stmt(env,`DELETE FROM ${table} WHERE user_id=?`,id)),
    stmt(env,'UPDATE mafia_tournaments SET created_by=NULL WHERE created_by=?',id)];
}

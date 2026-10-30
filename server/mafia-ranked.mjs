import { all,first,run,stmt } from './lamma/common.mjs';
import { fail } from './room-model.mjs';
import { liveAccountSql,isModerator } from './moderation/access.mjs';
import { json,readJson,credentials,sha256 } from './protocol.mjs';
import { requireMafiaEnabled } from './mafia-access.mjs';
import { requireMafiaNewMatches,mafiaAcceptsNewMatches } from './mafia-ruleset-policy.mjs';
import { rankedBand } from './mafia-ranked-rating.mjs';
import { ratingDeltasForPolicy,canonicalMafiaRatingValue } from './mafia-rating-policy.mjs';
import { resolveMafiaSeasonRatingPolicy } from './mafia-rating-policy-store.mjs';
import { notifyUsers } from './social/realtime.mjs';
import { MAFIA_MATCHMAKING_POLICY,rankedMatchingStatus,selectRankedGroup } from './mafia-matchmaking.mjs';

const QUEUE_MS=120000,COORDINATOR='mafia-ranked-preview-v1';
export const mafiaPreviewOnly=env=>String(env.APP_ORIGIN||'')==='https://maydan-mafia-preview.mf103871.workers.dev';
export const mafiaRankedEnabled=env=>mafiaPreviewOnly(env)&&String(env.MAFIA_RANKED_ENABLED)==='1';
const marks=values=>values.map(()=>'?').join(',');
const nowSessionSql=`EXISTS(SELECT 1 FROM sessions s WHERE s.id=? AND s.user_id=? AND s.expires_at>? AND (s.revoked_at IS NULL OR s.revoked_at>?) AND ${liveAccountSql('s.user_id')})`;
const actorArgs=(actor,now)=>[actor.sessionId,actor.userId,now,now];
const queueKey=season=>`ranked:queue:${season}`;
const queueAvailableSql=(alias,now)=>`NOT EXISTS(SELECT 1 FROM mafia_seats ms WHERE ms.user_id=${alias}.user_id AND ms.expires_at>${now})
  AND NOT EXISTS(SELECT 1 FROM mafia_observer_memberships mo WHERE mo.user_id=${alias}.user_id AND mo.expires_at>${now})
  AND NOT EXISTS(SELECT 1 FROM mafia_media_leases mm WHERE mm.user_id=${alias}.user_id AND mm.expires_at>${now})
  AND NOT EXISTS(SELECT 1 FROM social_call_participants cp WHERE cp.user_id=${alias}.user_id AND cp.state='active')
  AND (SELECT COUNT(*) FROM mafia_progress_events pe WHERE pe.user_id=${alias}.user_id AND pe.status='processed' AND pe.source='live' AND pe.reward_policy_version=1 AND pe.visibility='public' AND pe.participation_granted=1 AND pe.forfeited=0)>=10
  AND (EXISTS(SELECT 1 FROM mafia_tutorial_status ts WHERE ts.user_id=${alias}.user_id AND ts.status='completed' AND ts.ruleset_version=1) OR EXISTS(SELECT 1 FROM mafia_ranked_understanding ku WHERE ku.user_id=${alias}.user_id AND ku.policy_version=1))`;
const roomPost=(env,code,endpoint,body)=>env.ROOMS.get(env.ROOMS.idFromName(code)).fetch(new Request(`https://internal/${endpoint}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}));
const guard=(env,id,sql,...args)=>stmt(env,`INSERT INTO mafia_ranked_atomic_guard(id,value) VALUES(?,CASE WHEN (${sql}) THEN 1 ELSE 0 END)`,id,...args);
async function requireActor(env,actor,now=Date.now()){if(!await first(env,`SELECT 1 WHERE ${nowSessionSql}`,...actorArgs(actor,now)))fail('AUTH',401);}
async function openSeason(env,now){return first(env,"SELECT * FROM mafia_ranked_seasons WHERE status='open' AND starts_at<=? AND ends_at>? ORDER BY starts_at DESC LIMIT 1",now,now);}
async function eligibility(env,id,season,now){
  const row=await first(env,`SELECT
    (SELECT COUNT(*) FROM mafia_progress_events e WHERE e.user_id=? AND e.status='processed' AND e.source='live' AND e.reward_policy_version=1 AND e.visibility='public' AND e.participation_granted=1 AND e.forfeited=0) AS publicMatches,
    (EXISTS(SELECT 1 FROM mafia_tutorial_status t WHERE t.user_id=? AND t.status='completed' AND t.ruleset_version=1) OR EXISTS(SELECT 1 FROM mafia_ranked_understanding k WHERE k.user_id=? AND k.policy_version=1)) AS understands,
    COALESCE((SELECT cooldown_until FROM mafia_ranked_ratings WHERE user_id=? AND season_id=?),0) AS cooldownUntil`,id,id,id,id,season?.id||'');
  return {publicMatches:row.publicMatches,requiredMatches:10,understands:Boolean(row.understands),cooldownUntil:row.cooldownUntil,eligible:Boolean(season&&row.publicMatches>=10&&row.understands&&row.cooldownUntil<=now)};
}
async function sweep(env,now){
  await env.DB.batch([
    stmt(env,`DELETE FROM mafia_ranked_queue WHERE status='queued' AND (expires_at<=? OR NOT ${liveAccountSql('mafia_ranked_queue.user_id')} OR NOT EXISTS(SELECT 1 FROM mafia_ranked_seasons z WHERE z.id=mafia_ranked_queue.season_id AND z.status='open' AND z.ends_at>?) OR NOT EXISTS(SELECT 1 FROM sessions s WHERE s.id=mafia_ranked_queue.session_id AND s.user_id=mafia_ranked_queue.user_id AND s.expires_at>? AND (s.revoked_at IS NULL OR s.revoked_at>?)))`,now,now,now,now),
    stmt(env,"DELETE FROM mafia_match_leases WHERE match_id='queue' AND room_key LIKE 'ranked:queue:%' AND (expires_at<=? OR NOT EXISTS(SELECT 1 FROM mafia_ranked_queue q WHERE q.user_id=mafia_match_leases.user_id AND q.status='queued' AND q.expires_at>?))",now,now),
    stmt(env,"DELETE FROM mafia_ranked_queue WHERE status='assigned' AND NOT EXISTS(SELECT 1 FROM mafia_ranked_matches m WHERE m.match_key=mafia_ranked_queue.match_key AND m.status IN ('creating','playing'))"),
  ]);
}
async function ownState(env,actor,now=Date.now()){
  const season=await openSeason(env,now),held=await first(env,"SELECT season_id,seat_id,match_seat_id,queue_revision,joined_at,expires_at,match_key,room_code,status FROM mafia_ranked_queue WHERE user_id=? AND (status='assigned' OR expires_at>?)",actor.userId,now);
  const current=season||await first(env,'SELECT * FROM mafia_ranked_seasons ORDER BY starts_at DESC LIMIT 1');
  const effectivePolicy=current?await resolveMafiaSeasonRatingPolicy(env,current):null;
  const rating=current&&await first(env,'SELECT rating,games,wins,forfeits,cooldown_until AS cooldownUntil FROM mafia_ranked_ratings WHERE user_id=? AND season_id=?',actor.userId,current.id);
  const r=rating||{rating:1000,games:0,wins:0,forfeits:0,cooldownUntil:0};
  const state={available:true,experimental:true,calibrated:false,canManageSeasons:isModerator(env,actor.userId),season:current?{id:current.id,status:current.status,endsAt:current.ends_at,rulesetVersion:1,ratingModel:effectivePolicy.model,rewardPolicyVersion:1}:null,
    eligibility:await eligibility(env,actor.userId,season,now),rating:{...r,provisional:r.games<10,placementRemaining:Math.max(0,10-r.games),band:rankedBand(r.rating,r.games)},
    matchmaking:rankedMatchingStatus(held?.joined_at,now),
    queue:held?{status:held.status,revision:held.queue_revision,seatId:held.status==='assigned'?held.match_seat_id:held.seat_id,clientSeatId:held.seat_id,joinedAt:held.joined_at,expiresAt:held.expires_at,code:held.room_code||null}:null,
    waiting:season?(await first(env,"SELECT COUNT(*) AS n FROM mafia_ranked_queue WHERE season_id=? AND status='queued' AND expires_at>?",season.id,now)).n:0};
  await requireActor(env,actor,Date.now());return state;
}
async function enqueue(env,actor,body,now){
  const season=await openSeason(env,now);if(!season)fail('MAFIA_RANKED_CLOSED',409);
  const allowed=await eligibility(env,actor.userId,season,now);if(!allowed.eligible)fail(allowed.cooldownUntil>now?'MAFIA_RANKED_COOLDOWN':'MAFIA_RANKED_ELIGIBILITY',409);
  const input=await credentials(body),current=await first(env,'SELECT * FROM mafia_ranked_queue WHERE user_id=?',actor.userId);
  if(current){if(current.seat_id!==input.id||current.token_hash!==input.tokenHash)fail('MAFIA_ACTIVE_ELSEWHERE',409);return;}
  requireMafiaNewMatches(env);
  if(await first(env,"SELECT 1 FROM social_call_participants WHERE user_id=? AND state='active'",actor.userId))fail('MAFIA_RANKED_CALL_ACTIVE',409);
  const free=`NOT EXISTS(SELECT 1 FROM mafia_seats WHERE user_id=? AND expires_at>?) AND NOT EXISTS(SELECT 1 FROM mafia_observer_memberships WHERE user_id=? AND expires_at>?) AND NOT EXISTS(SELECT 1 FROM mafia_media_leases WHERE user_id=? AND expires_at>?) AND NOT EXISTS(SELECT 1 FROM mafia_match_leases WHERE user_id=? AND expires_at>?) AND NOT EXISTS(SELECT 1 FROM social_call_participants WHERE user_id=? AND state='active')`;
  const stamp=crypto.randomUUID(),lease=queueKey(season.id);
  await env.DB.batch([
    stmt(env,`INSERT INTO mafia_match_leases(user_id,room_key,match_id,expires_at,updated_at) SELECT ?,?,'queue',?,? WHERE ${nowSessionSql} AND ${free} ON CONFLICT(user_id) DO UPDATE SET room_key=excluded.room_key,match_id=excluded.match_id,expires_at=excluded.expires_at,updated_at=excluded.updated_at WHERE mafia_match_leases.expires_at<=?`,actor.userId,lease,now+QUEUE_MS,now,...actorArgs(actor,now),...Array.from({length:4},()=>[actor.userId,now]).flat(),actor.userId,now),
    stmt(env,`INSERT INTO mafia_ranked_queue(user_id,season_id,seat_id,token_hash,queue_revision,session_id,joined_at,expires_at,status) SELECT ?,?,?,?,?,?,?,?,'queued' WHERE EXISTS(SELECT 1 FROM mafia_match_leases WHERE user_id=? AND room_key=? AND match_id='queue' AND updated_at=?) AND ${nowSessionSql}`,actor.userId,season.id,input.id,input.tokenHash,crypto.randomUUID(),actor.sessionId,now,now+QUEUE_MS,actor.userId,lease,now,...actorArgs(actor,now)),
    guard(env,stamp,'SELECT COUNT(*)=1 FROM mafia_ranked_queue WHERE user_id=? AND seat_id=? AND token_hash=?',actor.userId,input.id,input.tokenHash),
    stmt(env,'DELETE FROM mafia_ranked_atomic_guard WHERE id=?',stamp),
  ]);
}
async function cancel(env,actor,body){
  if(typeof body.seatId!=='string'||typeof body.revision!=='string')fail('INVALID');
  const stamp=crypto.randomUUID();
  await env.DB.batch([
    stmt(env,`DELETE FROM mafia_match_leases WHERE user_id=? AND match_id='queue' AND EXISTS(SELECT 1 FROM mafia_ranked_queue q WHERE q.user_id=? AND q.seat_id=? AND q.queue_revision=? AND q.status='queued' AND mafia_match_leases.room_key='ranked:queue:'||q.season_id) AND ${nowSessionSql}`,actor.userId,actor.userId,body.seatId,body.revision,...actorArgs(actor,Date.now())),
    stmt(env,`DELETE FROM mafia_ranked_queue WHERE user_id=? AND seat_id=? AND queue_revision=? AND status='queued' AND ${nowSessionSql}`,actor.userId,body.seatId,body.revision,...actorArgs(actor,Date.now())),
    stmt(env,'DELETE FROM mafia_ranked_atomic_guard WHERE id=?',stamp),
  ]);
}
async function heartbeat(env,actor,body,now){
  const input=await credentials(body);
  await env.DB.batch([
    stmt(env,`UPDATE mafia_ranked_queue SET expires_at=?,session_id=? WHERE user_id=? AND seat_id=? AND token_hash=? AND status='queued' AND expires_at>? AND EXISTS(SELECT 1 FROM mafia_ranked_seasons z WHERE z.id=mafia_ranked_queue.season_id AND z.status='open' AND z.ends_at>?) AND ${nowSessionSql}`,now+QUEUE_MS,actor.sessionId,actor.userId,input.id,input.tokenHash,now,now,...actorArgs(actor,now)),
    stmt(env,"UPDATE mafia_match_leases SET expires_at=?,updated_at=? WHERE user_id=? AND match_id='queue' AND EXISTS(SELECT 1 FROM mafia_ranked_queue q WHERE q.user_id=mafia_match_leases.user_id AND q.seat_id=? AND q.token_hash=? AND q.status='queued' AND q.expires_at=? AND mafia_match_leases.room_key='ranked:queue:'||q.season_id)",now+QUEUE_MS,now,actor.userId,input.id,input.tokenHash,now+QUEUE_MS),
  ]);
}
async function dispatch(env,now){
  const active=await all(env,"SELECT * FROM mafia_ranked_matches WHERE status='playing' ORDER BY created_at LIMIT 2");
  for(const match of active){
    const response=await roomPost(env,match.room_code,'mafia-ranked-status',{key:match.match_key});
    if(!response.ok)fail('MAFIA_RANKED_UNAVAILABLE',503);
    const state=await response.json();
    if(state.status==='aborted'||state.status==='missing'&&match.created_at+180000<=now)await env.DB.batch([
      stmt(env,"UPDATE mafia_ranked_matches SET status='aborted' WHERE match_key=? AND status='playing' AND event_digest IS NULL",match.match_key),
      stmt(env,"DELETE FROM mafia_match_leases WHERE room_key=? AND EXISTS(SELECT 1 FROM mafia_ranked_matches WHERE match_key=? AND status='aborted')",match.match_key,match.match_key),
      stmt(env,"DELETE FROM mafia_ranked_queue WHERE match_key=? AND EXISTS(SELECT 1 FROM mafia_ranked_matches WHERE match_key=? AND status='aborted')",match.match_key,match.match_key),
    ]);
  }
  let pending=await first(env,"SELECT * FROM mafia_ranked_matches WHERE status='creating' ORDER BY created_at LIMIT 1");
  if(!pending){
    if(!mafiaAcceptsNewMatches(env))return;
    // The preview deliberately permits only one ranked room at a time. This is
    // an admission limit, not a measured provider or production capacity claim.
    if(await first(env,"SELECT 1 FROM mafia_ranked_matches WHERE status='playing' LIMIT 1"))return;
    const season=await openSeason(env,now);if(!season)return;
    const candidates=await all(env,`SELECT q.*,COALESCE(r.rating,1000) AS rating,COALESCE(r.games,0) AS rating_games FROM mafia_ranked_queue q JOIN sessions s ON s.id=q.session_id AND s.user_id=q.user_id JOIN mafia_match_leases l ON l.user_id=q.user_id LEFT JOIN mafia_ranked_ratings r ON r.user_id=q.user_id AND r.season_id=q.season_id WHERE q.status='queued' AND q.season_id=? AND q.expires_at>? AND s.expires_at>? AND (s.revoked_at IS NULL OR s.revoked_at>?) AND ${liveAccountSql('q.user_id')} AND l.room_key=? AND l.match_id='queue' AND l.expires_at>? AND COALESCE(r.cooldown_until,0)<=? AND ${queueAvailableSql('q',now)} ORDER BY q.joined_at,q.user_id LIMIT ${MAFIA_MATCHMAKING_POLICY.candidateLimit}`,season.id,now,now,now,queueKey(season.id),now,now);
    const candidateIds=JSON.stringify(candidates.map(row=>row.user_id));
    const blocks=await all(env,'SELECT blocker_id,blocked_id FROM social_blocks WHERE blocker_id IN (SELECT value FROM json_each(?)) AND blocked_id IN (SELECT value FROM json_each(?))',candidateIds,candidateIds);
    const matched=selectRankedGroup(candidates,blocks,now);if(!matched)return;
    const selected=matched.members,at=Date.now();
    const selectedEvidence=JSON.stringify(selected.map(row=>({userId:row.user_id,seatId:row.seat_id,tokenHash:row.token_hash,revision:row.queue_revision,sessionId:row.session_id,rating:row.rating,games:row.rating_games})));
    // Ratings, blocks, eligibility and every activity/session owner are checked
    // again inside the same transaction that transfers the queue reservations.
    // JSON parameters keep the bounded64candidate query below D1 bind limits.
    const assignmentValid=`SELECT (SELECT COUNT(*) FROM mafia_ranked_queue q
      JOIN json_each(?) expected ON q.user_id=json_extract(expected.value,'$.userId')
      JOIN sessions s ON s.id=q.session_id AND s.user_id=q.user_id
      JOIN mafia_match_leases l ON l.user_id=q.user_id
      LEFT JOIN mafia_ranked_ratings r ON r.user_id=q.user_id AND r.season_id=q.season_id
      WHERE q.status='queued' AND q.season_id=? AND q.expires_at>${at}
        AND q.seat_id=json_extract(expected.value,'$.seatId') AND q.token_hash=json_extract(expected.value,'$.tokenHash')
        AND q.queue_revision=json_extract(expected.value,'$.revision') AND q.session_id=json_extract(expected.value,'$.sessionId')
        AND s.expires_at>${at} AND (s.revoked_at IS NULL OR s.revoked_at>${at}) AND ${liveAccountSql('q.user_id')}
        AND l.room_key=? AND l.match_id='queue' AND l.expires_at>${at}
        AND COALESCE(r.rating,1000)=json_extract(expected.value,'$.rating') AND COALESCE(r.games,0)=json_extract(expected.value,'$.games') AND COALESCE(r.cooldown_until,0)<=${at}
        AND ${queueAvailableSql('q',at)})=8
      AND EXISTS(SELECT 1 FROM mafia_ranked_seasons z WHERE z.id=? AND z.status='open' AND z.starts_at<=${at} AND z.ends_at>${at})
      AND NOT EXISTS(SELECT 1 FROM mafia_ranked_matches rm WHERE rm.status IN ('creating','playing'))
      AND NOT EXISTS(SELECT 1 FROM social_blocks b WHERE b.blocker_id IN (SELECT json_extract(value,'$.userId') FROM json_each(?)) AND b.blocked_id IN (SELECT json_extract(value,'$.userId') FROM json_each(?)))`;
    const matchKey=crypto.randomUUID(),words=new Uint32Array(1);crypto.getRandomValues(words);const code=String(100000+words[0]%900000),stamp=crypto.randomUUID();
    await env.DB.batch([
      guard(env,`${stamp}:admission`,assignmentValid,selectedEvidence,season.id,queueKey(season.id),season.id,selectedEvidence,selectedEvidence),
      stmt(env,"INSERT INTO mafia_ranked_matches(match_key,season_id,room_code,created_at,status) VALUES(?,?,?,?,'creating')",matchKey,season.id,code,at),
      ...selected.map(row=>stmt(env,"UPDATE mafia_ranked_queue SET status='assigned',match_key=?,room_code=?,expires_at=?,match_seat_id=? WHERE user_id=? AND seat_id=? AND queue_revision=? AND status='queued' AND expires_at>?",matchKey,code,at+QUEUE_MS,crypto.randomUUID().replaceAll('-',''),row.user_id,row.seat_id,row.queue_revision,at)),
      ...selected.map(row=>stmt(env,"UPDATE mafia_match_leases SET room_key=?,match_id='1',expires_at=?,updated_at=? WHERE user_id=? AND room_key=? AND match_id='queue' AND expires_at>?",matchKey,at+180000,at,row.user_id,queueKey(season.id),at)),
      guard(env,stamp,"SELECT COUNT(*)=8 FROM mafia_ranked_queue q JOIN mafia_match_leases l ON l.user_id=q.user_id WHERE q.match_key=? AND q.status='assigned' AND l.room_key=? AND l.expires_at>?",matchKey,matchKey,at),
      stmt(env,'DELETE FROM mafia_ranked_atomic_guard WHERE id=?',stamp),
      stmt(env,'DELETE FROM mafia_ranked_atomic_guard WHERE id=?',`${stamp}:admission`),
    ]);
    pending={match_key:matchKey,season_id:season.id,room_code:code,created_at:at};
  }
  const rows=await all(env,'SELECT user_id,match_seat_id AS seat_id,token_hash,session_id FROM mafia_ranked_queue WHERE match_key=? ORDER BY match_seat_id',pending.match_key);
  if(pending.created_at+180000<=now){
    const response=await roomPost(env,pending.room_code,'mafia-ranked-status',{key:pending.match_key});
    if(!response.ok)fail('MAFIA_RANKED_UNAVAILABLE',503);
    const state=await response.json();
    if(state.status==='pending'||state.status==='playing'){await run(env,"UPDATE mafia_ranked_matches SET status='playing' WHERE match_key=? AND status='creating'",pending.match_key);return;}
    if(state.status==='missing'||state.status==='aborted'){await abortCreating(env,pending);return;}
  }
  if(rows.length!==8){await abortCreating(env,pending);return;}
  const response=await roomPost(env,pending.room_code,'mafia-ranked-create',{key:pending.match_key,seasonId:pending.season_id,code:pending.room_code,createdAt:pending.created_at,seats:rows});
  if(!response.ok){
    const error=await response.json();if(['COLLISION','AUTH','MAFIA_ACTIVE_ELSEWHERE','MAFIA_BLOCKED'].includes(error.error)){await abortCreating(env,pending);return;}fail(error.error||'MAFIA_RANKED_UNAVAILABLE',503);
  }
  await run(env,"UPDATE mafia_ranked_matches SET status='playing' WHERE match_key=? AND status='creating'",pending.match_key);
}
async function abortCreating(env,match){
  const response=await roomPost(env,match.room_code,'mafia-ranked-abort-lobby',{key:match.match_key});
  if(!response.ok)fail('MAFIA_RANKED_UNAVAILABLE',503);
  if(!(await response.json()).safe){await run(env,"UPDATE mafia_ranked_matches SET status='playing' WHERE match_key=? AND status='creating'",match.match_key);return;}
  await env.DB.batch([
  stmt(env,"UPDATE mafia_ranked_matches SET status='aborted' WHERE match_key=? AND status='creating'",match.match_key),
  stmt(env,"DELETE FROM mafia_match_leases WHERE room_key=? AND EXISTS(SELECT 1 FROM mafia_ranked_matches WHERE match_key=? AND status='aborted')",match.match_key,match.match_key),
  stmt(env,"DELETE FROM mafia_seats WHERE room_key=? AND EXISTS(SELECT 1 FROM mafia_ranked_matches WHERE match_key=? AND status='aborted')",match.match_key,match.match_key),
  stmt(env,"DELETE FROM mafia_ranked_queue WHERE match_key=? AND EXISTS(SELECT 1 FROM mafia_ranked_matches WHERE match_key=? AND status='aborted')",match.match_key,match.match_key),
]);}

// Called only by the existing Room namespace's private coordinator endpoint.
// All queue mutations are serialized in one DO. D1 conditions remain authority
// against concurrent ordinary room/observer admissions and account deletion.
export async function rankedCoordinator(env,{operation,actor,body={}}){
  if(!mafiaRankedEnabled(env))return json({available:false});requireMafiaEnabled(env);
  const now=Date.now();await requireActor(env,actor,now);await sweep(env,now);
  if(operation==='join')await enqueue(env,actor,body,now);
  else if(operation==='status')await heartbeat(env,actor,body,now);
  else if(operation==='cancel')await cancel(env,actor,body);
  else fail('NOT_FOUND',404);
  if(operation!=='cancel')await dispatch(env,Date.now());
  if(operation==='join'||operation==='cancel')try{await notifyUsers(env,[actor.userId],{type:'refresh',reason:'mafia-activity'});}catch{/* Existing periodic state reads recover a lost wakeup. */}
  return json(await ownState(env,actor));
}

export async function routeMafiaRanked(request,env,url,actor){
  if(!url.pathname.startsWith('/api/mafia/ranked'))return null;
  if(!mafiaRankedEnabled(env))return json({available:false});
  const path=url.pathname,now=Date.now();await requireActor(env,actor,now);
  if(path==='/api/mafia/ranked'&&request.method==='GET')return json(await ownState(env,actor,now));
  if(path==='/api/mafia/ranked/understanding'&&request.method==='POST'){
    const body=await readJson(request);if(JSON.stringify(body.answers)!=='[1,0,2]')fail('MAFIA_RANKED_UNDERSTANDING',409);
    await run(env,`INSERT INTO mafia_ranked_understanding(user_id,policy_version,confirmed_at) SELECT ?,1,? WHERE ${nowSessionSql} ON CONFLICT(user_id) DO UPDATE SET confirmed_at=excluded.confirmed_at`,actor.userId,now,...actorArgs(actor,now));return json(await ownState(env,actor));
  }
  const queue=/^\/api\/mafia\/ranked\/queue\/(join|status|cancel)$/.exec(path);
  if(queue&&request.method==='POST')return env.ROOMS.get(env.ROOMS.idFromName(COORDINATOR)).fetch(new Request('https://internal/mafia-ranked-coordinator',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({operation:queue[1],actor,body:await readJson(request)})}));
  if(path==='/api/mafia/ranked/leaderboard'&&request.method==='GET'){
    if(await first(env,'SELECT 1 FROM mafia_match_leases WHERE user_id=? AND expires_at>?',actor.userId,now))fail('MAFIA_SOCIAL_LOCKED',409);
    const season=await first(env,'SELECT id,status FROM mafia_ranked_seasons ORDER BY starts_at DESC LIMIT 1');if(!season)return json({rows:[]});
    const rows=await all(env,season.status==='closed'?`SELECT user_id,rating,games,placement FROM mafia_ranked_season_snapshot r WHERE season_id=? AND ${liveAccountSql('r.user_id')} ORDER BY placement LIMIT 50`:`SELECT user_id,rating,games FROM mafia_ranked_ratings r WHERE season_id=? AND games>=10 AND ${liveAccountSql('r.user_id')} ORDER BY rating DESC,games DESC,user_id LIMIT 50`,season.id);
    const board=await Promise.all(rows.map(async(row,index)=>({place:row.placement||index+1,alias:(await sha256(`${season.id}:${row.user_id}`)).slice(0,8),rating:row.rating,games:row.games,band:rankedBand(row.rating,row.games),own:row.user_id===actor.userId})));
    const at=Date.now();
    if(!await first(env,`SELECT 1 WHERE ${nowSessionSql} AND NOT EXISTS(SELECT 1 FROM mafia_match_leases WHERE user_id=? AND expires_at>?) AND NOT EXISTS(SELECT 1 FROM mafia_observer_memberships WHERE user_id=? AND expires_at>?)`,...actorArgs(actor,at),actor.userId,at,actor.userId,at))fail('MAFIA_SOCIAL_LOCKED',409);
    return json({seasonId:season.id,experimental:true,calibrated:false,rows:board});
  }
  if(path==='/api/mafia/ranked/season/close'&&request.method==='POST'){
    if(!isModerator(env,actor.userId))fail('NOT_FOUND',404);const body=await readJson(request);return json(await closeRankedSeason(env,actor,body.seasonId,now));
  }
  fail('NOT_FOUND',404);
}

export async function settleRankedMatch(env,event){
  if(!event?.ranked||!env.DB||event.notBefore>Date.now())return;
  const key=event.ranked.key,seasonId=event.ranked.seasonId;
  if(event.rulesetVersion!==1||event.mode!=='classic'||event.participantCount!==8||event.results.length!==8||event.results.some(r=>!['town','mafia'].includes(r.faction)))fail('MAFIA_RANKED_RESULT',503);
  const match=await first(env,'SELECT * FROM mafia_ranked_matches WHERE match_key=? AND season_id=?',key,seasonId);if(!match)fail('MAFIA_RANKED_RESULT',503);
  const digest=await sha256(JSON.stringify([event.key,event.results.map(r=>[r.userId,r.faction,!!r.won,!!r.forfeited]),!!event.draw]));
  if(match.event_digest){if(match.event_digest!==digest)fail('MAFIA_RANKED_CONFLICT',503);return;}
  const season=await first(env,'SELECT * FROM mafia_ranked_seasons WHERE id=?',seasonId);if(!season||season.status==='closed')fail('MAFIA_RANKED_CLOSED',503);
  const ids=event.results.map(r=>r.userId),ratings=await all(env,`SELECT * FROM mafia_ranked_ratings WHERE season_id=? AND user_id IN (${marks(ids)})`,seasonId,...ids),lookup=new Map(ratings.map(r=>[r.user_id,r]));
  const live=await all(env,`SELECT id FROM users WHERE id IN (${marks(ids)}) AND ${liveAccountSql('users.id')}`,...ids),eligible=new Set(live.map(r=>r.id));
  const policy=await resolveMafiaSeasonRatingPolicy(env,season);
  const policySHA256=await sha256(canonicalMafiaRatingValue(policy));
  if(event.ranked.ratingModel!==policy.model||(event.ranked.ratingPolicySHA256&&event.ranked.ratingPolicySHA256!==policySHA256)
    ||(policy.model!=='preview-elo-1'&&!event.ranked.ratingPolicySHA256))fail('MAFIA_RANKED_CONFLICT',503);
  const deltas=ratingDeltasForPolicy(event.results,lookup,policy,{draw:event.draw});
  const token=crypto.randomUUID(),stamp=crypto.randomUUID(),now=Date.now(),statements=[stmt(env,"UPDATE mafia_ranked_matches SET status='completed',settled_at=?,event_digest=?,settle_token=? WHERE match_key=? AND event_digest IS NULL AND status IN ('creating','playing') AND EXISTS(SELECT 1 FROM mafia_ranked_seasons WHERE id=? AND status IN ('open','closing'))",now,digest,token,key,seasonId)];
  const owns='EXISTS(SELECT 1 FROM mafia_ranked_matches WHERE match_key=? AND event_digest=? AND settle_token=?)';
  for(const result of event.results){
    if(!eligible.has(result.userId))continue;
    const row=lookup.get(result.userId)||{rating:1000,games:0,wins:0,forfeits:0},delta=deltas.get(result.userId);
    const args=[key,digest,token],id=result.userId;
    statements.push(stmt(env,`INSERT INTO mafia_ranked_ratings(user_id,season_id,rating,games,wins,forfeits,cooldown_until,updated_at) SELECT ?,?,?,1,?,?,?,? WHERE ${owns} AND ${liveAccountSql('?')} ON CONFLICT(user_id,season_id) DO UPDATE SET rating=excluded.rating,games=mafia_ranked_ratings.games+1,wins=mafia_ranked_ratings.wins+excluded.wins,forfeits=mafia_ranked_ratings.forfeits+excluded.forfeits,cooldown_until=MAX(mafia_ranked_ratings.cooldown_until,excluded.cooldown_until),updated_at=excluded.updated_at WHERE mafia_ranked_ratings.games=? AND mafia_ranked_ratings.rating=?`,id,seasonId,row.rating+delta,result.won&&!result.forfeited?1:0,result.forfeited?1:0,result.forfeited?now+15*60000:0,now,...args,id,id,row.games,row.rating));
    statements.push(guard(env,`${stamp}:${id}`,`SELECT NOT (${owns}) OR NOT (${liveAccountSql('?')}) OR EXISTS(SELECT 1 FROM mafia_ranked_ratings WHERE user_id=? AND season_id=? AND games=? AND rating=?)`,...args,id,id,id,seasonId,row.games+1,row.rating+delta));
    statements.push(stmt(env,`INSERT OR IGNORE INTO mafia_ranked_receipts(user_id,match_key,season_id,before_rating,delta,after_rating,faction,won,forfeited,processed_at) SELECT ?,?,?,?,?,?,?,?,?,? WHERE ${owns} AND ${liveAccountSql('?')}`,id,key,seasonId,row.rating,delta,row.rating+delta,result.faction,result.won?1:0,result.forfeited?1:0,now,...args,id,id));
    statements.push(stmt(env,'DELETE FROM mafia_ranked_atomic_guard WHERE id=?',`${stamp}:${id}`));
  }
  statements.push(stmt(env,`DELETE FROM mafia_ranked_queue WHERE match_key=? AND ${owns}`,key,key,digest,token));
  await env.DB.batch(statements);
  const final=await first(env,'SELECT event_digest FROM mafia_ranked_matches WHERE match_key=?',key);if(final?.event_digest!==digest)fail('MAFIA_RANKED_RETRY',503);
  try{await notifyUsers(env,ids,{type:'refresh',reason:'mafia-activity'});}catch{/* Wakeup is advisory. */}
}

export async function rankedRoomCommitted(env,room){
  if(!room.ranked||!env.DB)return;
  // A technical abort never invents a rating result. Normal END stays pending
  // until the shared durable outbox has atomically settled its rating receipt.
  if(room.technicalAbort||room.phase==='closed'&&!room.outcome){await env.DB.batch([
    stmt(env,"UPDATE mafia_ranked_matches SET status='aborted' WHERE match_key=? AND status IN ('creating','playing')",room.ranked.key),
    stmt(env,"DELETE FROM mafia_ranked_queue WHERE match_key=?",room.ranked.key),
  ]);}
}
export async function closeRankedSeason(env,actor,seasonId,now=Date.now()){
  if(typeof seasonId!=='string'||!isModerator(env,actor.userId))fail('NOT_FOUND',404);
  const season=await first(env,'SELECT * FROM mafia_ranked_seasons WHERE id=?',seasonId);if(!season)fail('NOT_FOUND',404);if(season.status==='closed')return {closed:true,seasonId,alreadyClosed:true};
  if(now<season.ends_at)fail('MAFIA_RANKED_SEASON_ACTIVE',409);
  await run(env,`UPDATE mafia_ranked_seasons SET status='closing' WHERE id=? AND status='open' AND ${nowSessionSql}`,seasonId,...actorArgs(actor,now));
  if(await first(env,"SELECT 1 FROM mafia_ranked_matches WHERE season_id=? AND status IN ('creating','playing') LIMIT 1",seasonId))fail('MAFIA_RANKED_DRAINING',409);
  const token=crypto.randomUUID();
  await env.DB.batch([
    stmt(env,`UPDATE mafia_ranked_seasons SET status='closed',closed_at=?,close_token=? WHERE id=? AND status='closing' AND ${nowSessionSql} AND NOT EXISTS(SELECT 1 FROM mafia_ranked_matches WHERE season_id=? AND status IN ('creating','playing'))`,now,token,seasonId,...actorArgs(actor,now),seasonId),
    stmt(env,`INSERT OR IGNORE INTO mafia_ranked_season_snapshot(user_id,season_id,rating,games,wins,placement,closed_at) SELECT r.user_id,r.season_id,r.rating,r.games,r.wins,ROW_NUMBER() OVER(ORDER BY r.rating DESC,r.games DESC,r.user_id),? FROM mafia_ranked_ratings r WHERE season_id=? AND games>=10 AND ${liveAccountSql('r.user_id')} AND EXISTS(SELECT 1 FROM mafia_ranked_seasons WHERE id=? AND close_token=?)`,now,seasonId,seasonId,token),
    stmt(env,`INSERT OR IGNORE INTO mafia_achievements(user_id,achievement_id,earned_at,earned_match_key) SELECT user_id,'mafia_ranked_preview_season',?,? FROM mafia_ranked_season_snapshot x WHERE season_id=? AND ${liveAccountSql('x.user_id')} AND EXISTS(SELECT 1 FROM mafia_ranked_seasons WHERE id=? AND close_token=?)`,now,`season:${seasonId}`,seasonId,seasonId,token),
    stmt(env,`INSERT OR IGNORE INTO mafia_cosmetic_grants(user_id,item_id,source,achievement_id,granted_at,revoked_at) SELECT x.user_id,'sahra.frame','mafia_achievement','mafia_ranked_preview_season',?,NULL FROM mafia_ranked_season_snapshot x JOIN mafia_achievements a ON a.user_id=x.user_id AND a.achievement_id='mafia_ranked_preview_season' WHERE x.season_id=? AND ${liveAccountSql('x.user_id')} AND EXISTS(SELECT 1 FROM mafia_ranked_seasons WHERE id=? AND close_token=?)`,now,seasonId,seasonId,token),
  ]);
  const closed=await first(env,"SELECT 1 FROM mafia_ranked_seasons WHERE id=? AND status='closed'",seasonId);if(!closed)fail('MAFIA_RANKED_RETRY',503);return {closed:true,seasonId};
}
export function mafiaRankedDeleteStatements(env,id){return ['mafia_ranked_queue','mafia_ranked_ratings','mafia_ranked_receipts','mafia_ranked_season_snapshot','mafia_ranked_understanding'].map(table=>stmt(env,`DELETE FROM ${table} WHERE user_id=?`,id));}

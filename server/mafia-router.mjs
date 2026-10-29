import { requireSession } from './accounts/session.mjs';
import { credentials, json, readJson, sha256 } from './protocol.mjs';
import { fail } from './room-model.mjs';
import { all, first, run, stmt } from './lamma/common.mjs';
import { mafiaEnabled, requireMafiaEnabled } from './mafia-access.mjs';
import { requireMafiaNewMatches } from './mafia-ruleset-policy.mjs';
import { MAFIA_PROTOCOL } from '../src/online/shared.js';
import { listMafiaDirectory, DIRECTORY_KEY } from './mafia-directory.mjs';
import { mafiaPublicCatalog,readMafiaProgress,patchMafiaPreferences,readMafiaReward,readMafiaHistory } from './mafia-profile.mjs';

const roomFetch=(env,code,endpoint,body)=>env.ROOMS.get(env.ROOMS.idFromName(code)).fetch(new Request(`https://internal/${code}/${endpoint}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}));
export async function routeMafia(request,env,url,charge) {
  const path=url.pathname,method=request.method;
  if(path==='/api/rooms/public/stream'&&method==='GET'&&request.headers.get('upgrade')?.toLowerCase()==='websocket'){
    if(charge)await charge('socket');
    return env.ROOMS.get(env.ROOMS.idFromName(DIRECTORY_KEY)).fetch(new Request('https://internal/mafia-directory-socket',{headers:request.headers}));
  }
  const observe=/^\/api\/rooms\/(\d{6})\/observe(?:\/(leave|promote))?$/.exec(path);
  const voice=/^\/api\/rooms\/(\d{6})\/voice$/.exec(path);
  const report=/^\/api\/rooms\/(\d{6})\/mafia-report$/.exec(path);
  const block=/^\/api\/rooms\/(\d{6})\/mafia-block$/.exec(path);
  const profile=/^\/api\/profiles\/([A-Za-z0-9_-]{1,80})\/mafia$/.exec(path);
  const reward=/^\/api\/me\/mafia\/rewards\/([^/]+)$/.exec(path);
  if(!voice&&!report&&!block&&!observe&&!profile&&!reward&&!['/api/rooms/public','/api/matchmaking/join','/api/mafia/history','/api/mafia/capabilities','/api/mafia/catalog','/api/me/mafia/progress','/api/me/mafia/preferences'].includes(path))return null;
  if(path==='/api/mafia/capabilities'&&method==='GET')return json({enabled:mafiaEnabled(env),capabilities:{mafia:MAFIA_PROTOCOL}});
  if(path==='/api/mafia/catalog'&&method==='GET'){if(charge)await charge('profileRead');return json(mafiaPublicCatalog(env));}
  const {user,session}=await requireSession(env,request,{rotate:false});
  if(charge)await charge(method==='GET'||voice?'socialRead':'socialWrite','RATE_LIMIT',user.id);
  if(path==='/api/me/mafia/progress'&&method==='GET')return json(await readMafiaProgress(env,user.id));
  if(profile&&method==='GET')return json(await readMafiaProgress(env,user.id,profile[1]));
  if(path==='/api/me/mafia/preferences'&&method==='PATCH')return json(await patchMafiaPreferences(env,user.id,await readJson(request,4096)));
  if(reward&&method==='GET'){
    let key;try{key=decodeURIComponent(reward[1]);}catch{fail('INVALID',400);}
    return json(await readMafiaReward(env,user.id,key));
  }
  if(observe&&method==='POST')return roomFetch(env,observe[1],`mafia-observe-${observe[2]||'join'}`,{...await readJson(request),accountUserId:user.id,accountSessionId:session.id,accountExpiresAt:Math.min(session.expires_at,session.revoked_at??Number.MAX_SAFE_INTEGER)});
  if(path==='/api/rooms/public'&&method==='GET') {
    if(await first(env,'SELECT 1 FROM mafia_observer_memberships WHERE user_id=? AND expires_at>?',user.id,Date.now()))fail('MAFIA_OBSERVER_ACTIVE',409);
    if(url.searchParams.get('game')&&url.searchParams.get('game')!=='mafia')fail('GAME');
    const page=mafiaEnabled(env)&&env.DB?await listMafiaDirectory(env,user.id,Object.fromEntries(url.searchParams)):{rooms:[],nextCursor:null,serverNow:Date.now()};
    return json({enabled:mafiaEnabled(env),...page,capabilities:{mafia:MAFIA_PROTOCOL}});
  }
  if(path==='/api/matchmaking/join'&&method==='POST') {
    requireMafiaEnabled(env); const body=await readJson(request);await credentials(body);
    if(body.capabilities?.mafia!==MAFIA_PROTOCOL)fail('UPDATE_REQUIRED',409);
    if(body.game&&body.game!=='mafia'||body.mode&&!['all','classic','shadow'].includes(body.mode)||body.community&&body.community!=='ar'||body.voiceMode&&!['all','off','optional'].includes(body.voiceMode))fail('INVALID');
    if(await first(env,'SELECT 1 FROM mafia_observer_memberships WHERE user_id=? AND expires_at>?',user.id,Date.now()))fail('MAFIA_ACTIVE_ELSEWHERE',409);
    // The room (not this eventually consistent directory) owns admission. A
    // previously committed idempotent join is returned even if its reply was lost.
    const held=await first(env,'SELECT room_code,seat_id FROM mafia_seats WHERE user_id=? AND expires_at>?',user.id,Date.now());
    if(held) {
      if(held.seat_id!==body.id)fail('MAFIA_ACTIVE_ELSEWHERE',409);
      return roomFetch(env,held.room_code,'join',{...body,accountUserId:user.id});
    }
    requireMafiaNewMatches(env);
    const {rooms}=await listMafiaDirectory(env,user.id,{mode:body.mode,voice:body.voiceMode,status:'waiting'},Date.now(),{joinable:true});
    for(const candidate of rooms.filter(room=>!room.full).slice(0,8)) {
      const response=await roomFetch(env,candidate.code,'join',{...body,accountUserId:user.id,matchmaking:true});
      if(response.ok)return response;
      const error=await response.clone().json();
      // A room this account was removed from does not end the search.
      if(!['FULL','FULL_MAFIA','STARTED','NOT_FOUND','MAFIA_BLOCKED','BANNED','NAME_TAKEN'].includes(error.error))return response;
    }
    fail('MAFIA_NO_ROOMS',409);
  }
  if(voice&&method==='POST') return roomFetch(env,voice[1],'mafia-voice',{...await readJson(request),accountUserId:user.id,accountSessionId:session.id});
  if(block&&method==='POST'){const body=await readJson(request);return roomFetch(env,block[1],body.scope==='observer'?'mafia-observe-block':'mafia-block',{...body,accountUserId:user.id,accountSessionId:session.id});}
  if(report&&method==='POST') {
    const body=await readJson(request);
    if(typeof body.reason!=='string'||!body.reason.trim()||body.reason.length>1000||typeof body.clientId!=='string'||!/^[a-zA-Z0-9_-]{1,80}$/.test(body.clientId))fail('INVALID');
    const response=await roomFetch(env,report[1],'mafia-evidence',{accountUserId:user.id,accountSessionId:session.id,...(body.scope==='observer'?{scope:'observer',id:body.id,token:body.token}:{}),targetId:body.targetId,messageId:body.messageId,matchId:body.matchId});
    if(!response.ok)return response;
    const evidence=await response.json();
    const id=await sha256(`mafia-report:${user.id}:${body.clientId}`);
    const previous=await first(env,'SELECT reported_id,room_code,reason FROM mafia_reports WHERE id=?',id);
    if(previous&&(previous.reported_id!==evidence.reportedUserId||previous.room_code!==report[1]||previous.reason!==body.reason.trim()))fail('CONFLICT',409);
    const now=Date.now(),messageText=`مافيا ميدان — غرفة ${report[1]}\n${(evidence.messages||[]).filter(m=>m.playerId===body.targetId).map(m=>m.text).join('\n').slice(0,6000)}`;
    await env.DB.batch([
      stmt(env,'INSERT OR IGNORE INTO mafia_reports(id,reporter_id,reported_id,room_code,match_key,reason,evidence,created_at) VALUES(?,?,?,?,?,?,?,?)',id,user.id,evidence.reportedUserId,report[1],evidence.matchKey,body.reason.trim(),JSON.stringify(evidence),now),
      stmt(env,'INSERT OR IGNORE INTO social_reports(id,reporter_id,reported_id,message_seq,message_text,reason,created_at) VALUES(?,?,?,NULL,?,?,?)',id,user.id,evidence.reportedUserId,messageText,body.reason.trim(),now),
    ]);
    return json({ok:true,reportId:id});
  }
  if(path==='/api/mafia/history'&&method==='GET') {
    if(await first(env,'SELECT 1 FROM mafia_observer_memberships WHERE user_id=? AND expires_at>?',user.id,Date.now()))fail('MAFIA_OBSERVER_ACTIVE',409);
    return json(await readMafiaHistory(env,user.id,url.searchParams));
  }
  fail('NOT_FOUND',404);
}

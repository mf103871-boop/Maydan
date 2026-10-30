import { requireSession } from './accounts/session.mjs';
import { credentials, json, readJson } from './protocol.mjs';
import { fail } from './room-model.mjs';
import { first } from './lamma/common.mjs';
import { mafiaEnabled, requireMafiaEnabled } from './mafia-access.mjs';
import { requireMafiaNewMatches } from './mafia-ruleset-policy.mjs';
import { MAFIA_PROTOCOL } from '../src/online/shared.js';
import { listMafiaDirectory, DIRECTORY_KEY } from './mafia-directory.mjs';
import { mafiaPublicCatalog,readMafiaProgress,patchMafiaPreferences,readMafiaReward,readMafiaHistory } from './mafia-profile.mjs';
import { saveMafiaReportCase,ownMafiaReportCases,ownMafiaReportCase } from './mafia-report-cases.mjs';
import { readMafiaReview } from './mafia-review.mjs';
import { routeMafiaRanked,mafiaRankedEnabled,mafiaPreviewOnly } from './mafia-ranked.mjs';
import { routeMafiaCommunity } from './mafia-community.mjs';

const roomFetch=(env,code,endpoint,body)=>env.ROOMS.get(env.ROOMS.idFromName(code)).fetch(new Request(`https://internal/${code}/${endpoint}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}));
export async function routeMafia(request,env,url,charge) {
  const community=await routeMafiaCommunity(request,env,url,charge);if(community)return community;
  const path=url.pathname,method=request.method;
  const capabilities={mafia:MAFIA_PROTOCOL,ranked:mafiaRankedEnabled(env),mafiaCommunity:mafiaPreviewOnly(env)&&String(env.MAFIA_COMMUNITY_ENABLED)==='1',experimentalRoles:mafiaPreviewOnly(env)&&String(env.MAFIA_EXPERIMENTAL_ROLES_ENABLED)==='1'};
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
  const ownReport=/^\/api\/me\/mafia\/reports\/([a-f0-9]{64})$/.exec(path);
  const review=/^\/api\/mafia\/history\/([^/]+)$/.exec(path);
  if(!path.startsWith('/api/mafia/ranked')&&!voice&&!report&&!block&&!observe&&!profile&&!reward&&!ownReport&&!review&&!['/api/rooms/public','/api/matchmaking/join','/api/mafia/history','/api/mafia/capabilities','/api/mafia/catalog','/api/me/mafia/progress','/api/me/mafia/preferences','/api/me/mafia/reports'].includes(path))return null;
  if(path==='/api/mafia/capabilities'&&method==='GET')return json({enabled:mafiaEnabled(env),capabilities});
  if(path==='/api/mafia/catalog'&&method==='GET'){if(charge)await charge('profileRead');return json(mafiaPublicCatalog(env));}
  const {user,session}=await requireSession(env,request,{rotate:false});
  if(charge)await charge(method==='GET'||voice?'socialRead':'socialWrite','RATE_LIMIT',user.id);
  const actor={userId:user.id,sessionId:session.id};
  if(path.startsWith('/api/mafia/ranked'))return await routeMafiaRanked(request,env,url,actor);
  if(review&&method==='GET'){
    let key;try{key=decodeURIComponent(review[1]);}catch{fail('INVALID',400);}
    return json(await readMafiaReview(env,user.id,key));
  }
  if(path==='/api/me/mafia/reports'&&method==='GET')return json(await ownMafiaReportCases(env,actor,{before:url.searchParams.has('before')?Number(url.searchParams.get('before')):Number.MAX_SAFE_INTEGER,limit:url.searchParams.has('limit')?Number(url.searchParams.get('limit')):20}));
  if(ownReport&&method==='GET')return json(await ownMafiaReportCase(env,actor,ownReport[1]));
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
    return json({enabled:mafiaEnabled(env),...page,capabilities});
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
    return json(await saveMafiaReportCase(env,actor,report[1],await readJson(request)));
  }
  if(path==='/api/mafia/history'&&method==='GET') {
    if(await first(env,'SELECT 1 FROM mafia_observer_memberships WHERE user_id=? AND expires_at>?',user.id,Date.now()))fail('MAFIA_OBSERVER_ACTIVE',409);
    return json(await readMafiaHistory(env,user.id,url.searchParams));
  }
  fail('NOT_FOUND',404);
}

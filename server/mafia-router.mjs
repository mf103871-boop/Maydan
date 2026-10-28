import { requireSession } from './accounts/session.mjs';
import { credentials, json, readJson, sha256 } from './protocol.mjs';
import { fail } from './room-model.mjs';
import { all, first, run, stmt } from './lamma/common.mjs';
import { mafiaEnabled, requireMafiaEnabled } from './mafia-access.mjs';
import { MAFIA_PROTOCOL } from '../src/online/shared.js';

const roomFetch=(env,code,endpoint,body)=>env.ROOMS.get(env.ROOMS.idFromName(code)).fetch(new Request(`https://internal/${code}/${endpoint}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}));
async function directory(env,mode,userId,now=Date.now()) {
  if(!mafiaEnabled(env)||!env.DB)return [];
  // Discovery should offer rooms the account can actually join. The room
  // repeats this check atomically; this advisory list never reserves a seat.
  return all(env,`SELECT room_code AS code,'mafia' AS game,mode,capacity,players,ready,host_name AS hostName,expires_at AS expiresAt FROM mafia_public_rooms r WHERE expires_at>? AND players<capacity AND NOT EXISTS(SELECT 1 FROM mafia_seats s JOIN social_blocks b ON (b.blocker_id=? AND b.blocked_id=s.user_id) OR (b.blocked_id=? AND b.blocker_id=s.user_id) WHERE s.room_key=r.room_key AND s.expires_at>?)${mode?' AND mode=?':''} ORDER BY players DESC,updated_at DESC LIMIT 40`,now,userId,userId,now,...(mode?[mode]:[]));
}
export async function routeMafia(request,env,url,charge) {
  const path=url.pathname,method=request.method;
  const voice=/^\/api\/rooms\/(\d{6})\/voice$/.exec(path);
  const report=/^\/api\/rooms\/(\d{6})\/mafia-report$/.exec(path);
  const block=/^\/api\/rooms\/(\d{6})\/mafia-block$/.exec(path);
  if(!voice&&!report&&!block&&!['/api/rooms/public','/api/matchmaking/join','/api/mafia/history','/api/mafia/capabilities'].includes(path))return null;
  if(path==='/api/mafia/capabilities'&&method==='GET')return json({enabled:mafiaEnabled(env),capabilities:{mafia:MAFIA_PROTOCOL}});
  const {user,session}=await requireSession(env,request,{rotate:false});
  if(charge)await charge(method==='GET'||voice?'socialRead':'socialWrite','RATE_LIMIT',user.id);
  if(path==='/api/rooms/public'&&method==='GET') {
    if(url.searchParams.get('game')&&url.searchParams.get('game')!=='mafia')fail('GAME');
    const mode=url.searchParams.get('mode'); if(mode&&!['classic','shadow'].includes(mode))fail('INVALID');
    return json({enabled:mafiaEnabled(env),rooms:await directory(env,mode,user.id),capabilities:{mafia:MAFIA_PROTOCOL}});
  }
  if(path==='/api/matchmaking/join'&&method==='POST') {
    requireMafiaEnabled(env); const body=await readJson(request);await credentials(body);
    if(body.capabilities?.mafia!==MAFIA_PROTOCOL)fail('UPDATE_REQUIRED',409);
    if(body.game&&body.game!=='mafia'||body.mode&&!['classic','shadow'].includes(body.mode))fail('INVALID');
    // The room (not this eventually consistent directory) owns admission. A
    // previously committed idempotent join is returned even if its reply was lost.
    const held=await first(env,'SELECT room_code,seat_id FROM mafia_seats WHERE user_id=? AND expires_at>?',user.id,Date.now());
    if(held) {
      if(held.seat_id!==body.id)fail('MAFIA_ACTIVE_ELSEWHERE',409);
      return roomFetch(env,held.room_code,'join',{...body,accountUserId:user.id});
    }
    const rooms=await directory(env,body.mode,user.id);
    for(const candidate of rooms.slice(0,8)) {
      const response=await roomFetch(env,candidate.code,'join',{...body,accountUserId:user.id,matchmaking:true});
      if(response.ok)return response;
      const error=await response.clone().json();
      // A room this account was removed from does not end the search.
      if(!['FULL','FULL_MAFIA','STARTED','NOT_FOUND','MAFIA_BLOCKED','BANNED','NAME_TAKEN'].includes(error.error))return response;
    }
    fail('MAFIA_NO_ROOMS',409);
  }
  if(voice&&method==='POST') return roomFetch(env,voice[1],'mafia-voice',{...await readJson(request),accountUserId:user.id,accountSessionId:session.id});
  if(block&&method==='POST') return roomFetch(env,block[1],'mafia-block',{...await readJson(request),accountUserId:user.id});
  if(report&&method==='POST') {
    const body=await readJson(request);
    if(typeof body.reason!=='string'||!body.reason.trim()||body.reason.length>1000||typeof body.clientId!=='string'||!/^[a-zA-Z0-9_-]{1,80}$/.test(body.clientId))fail('INVALID');
    const response=await roomFetch(env,report[1],'mafia-evidence',{accountUserId:user.id,targetId:body.targetId,messageId:body.messageId,matchId:body.matchId});
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
    const matches=await all(env,'SELECT match_key AS matchKey,role_id AS roleId,faction,initial_faction AS initialFaction,won,draw,forfeited,finished_at AS finishedAt FROM mafia_results WHERE user_id=? AND finished_at>? ORDER BY finished_at DESC LIMIT 50',user.id,Date.now()-30*86400000);
    const stats=await all(env,'SELECT role_id AS roleId,faction,COUNT(*) AS matches,SUM(won) AS wins,SUM(draw) AS draws FROM mafia_results WHERE user_id=? GROUP BY role_id,faction',user.id);
    return json({matches,stats,retentionDays:30});
  }
  fail('NOT_FOUND',404);
}

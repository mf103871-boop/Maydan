import { matchResults } from './mafia-model.mjs';
import { stmt } from './lamma/common.mjs';
import { liveAccountSql } from './moderation/access.mjs';

export function prepareMafiaResult(room,now=Date.now()) {
  // A match that finished over text during a voice outage is a real result.
  if(room.phase!=='over'||!room.matchId||room.technicalAbort||!room.participants?.length)return null;
  const key=`${room.mafiaKey}:${room.matchId}`;
  const results=matchResults(room);
  // A game summary contains the public end-of-match reveal, never private chat.
  const summary=JSON.stringify({mode:room.settings.mode,outcome:room.outcome,history:room.history,reveal:{players:results,events:room.audit}});
  return {key,roomCode:room.code,rulesetVersion:room.rulesetVersion||1,finishedAt:now,...((room.protocol||1)>=2?{notBefore:now+30000}:{}),summary,draw:room.outcome?.faction==='draw',results:results.map(r=>({...r,userId:room.members.find(m=>m.id===r.playerId)?.accountUserId})).filter(r=>r.userId)};
}
export async function persistMafiaResult(env,event) {
  if(!env.DB||!event||event.notBefore>Date.now())return;
  const {key,summary,finishedAt:now}=event;
  const ids=[...new Set(event.results.map(result=>result.userId))];
  await env.DB.batch([
    // A delayed outbox must not resurrect a replay after participant deletion.
    // Other players keep their own independent result rows below.
    stmt(env,`INSERT OR IGNORE INTO mafia_history(match_key,room_code,ruleset_version,finished_at,summary) SELECT ?,?,?,?,? WHERE (SELECT COUNT(*) FROM users WHERE id IN (${ids.map(()=>'?').join(',')||'NULL'}))=?`,key,event.roomCode,event.rulesetVersion,now,summary,...ids,ids.length),
    ...event.results.flatMap(result=>{
      const id=result.userId;
      return [stmt(env,`INSERT OR IGNORE INTO mafia_results(user_id,match_key,role_id,initial_faction,faction,won,draw,forfeited,finished_at) SELECT ?,?,?,?,?,?,?,?,? WHERE ${liveAccountSql('?')}`,id,key,result.roleId,result.initialFaction,result.faction,result.won?1:0,event.draw?1:0,result.forfeited?1:0,now,id,id)];
    }),
  ]);
}
export function mafiaDeleteStatements(env,id) {
  return [
    stmt(env,'DELETE FROM mafia_history WHERE match_key IN (SELECT match_key FROM mafia_results WHERE user_id=?)',id),
    ...['mafia_results','mafia_seats','mafia_media_leases','mafia_match_leases','mafia_observer_memberships'].map(table=>stmt(env,`DELETE FROM ${table} WHERE user_id=?`,id)),
    stmt(env,'DELETE FROM mafia_reports WHERE reporter_id=? OR reported_id=?',id,id),
  ];
}

import { matchResults } from './mafia-model.mjs';
import { stmt } from './lamma/common.mjs';
import { liveAccountSql } from './moderation/access.mjs';
import { mafiaProgressDeleteStatements } from './mafia-progression.mjs';
import { mafiaRankedDeleteStatements } from './mafia-ranked.mjs';
import { mafiaRatingPolicyDeleteStatements } from './mafia-rating-policy-store.mjs';
import { mafiaCommunityDeleteStatements } from './mafia-community.mjs';

// Old envelopes have no participantCount. Their archived reveal is the only
// evidence that a filtered result list still covers every original seat.
function completeParticipantAccounts(event, accountIds) {
  let players;
  try { players=JSON.parse(event.summary)?.reveal?.players; } catch { return false; }
  if(!Array.isArray(players)||!players.length||players.length>12)return false;
  const seats=players.map(player=>player?.playerId),resultSeats=event.results.map(result=>result.playerId);
  return seats.every(id=>typeof id==='string'&&id.length>0)&&new Set(seats).size===seats.length
    &&(event.participantCount==null||event.participantCount===seats.length)
    &&accountIds.length===seats.length&&resultSeats.length===seats.length
    &&new Set(resultSeats).size===seats.length&&resultSeats.every(id=>seats.includes(id));
}

export function prepareMafiaResult(room,now=Date.now()) {
  // A match that finished over text during a voice outage is a real result.
  if(room.phase!=='over'||!room.matchId||room.technicalAbort||!room.participants?.length)return null;
  const key=`${room.mafiaKey}:${room.matchId}`;
  const results=matchResults(room);
  // A policy is issued only by the start transition. Restoring an older match,
  // or enabling progression halfway through it, must never manufacture rewards.
  const marker=room.statsMatch;
  const metadata={eventSchemaVersion:1,eventKind:'match_completed',source:'live',rewardPolicyVersion:marker?.rewardPolicyVersion??null};
  // A game summary contains the public end-of-match reveal, never private chat.
  // Include the policy marker so a legacy importer cannot reserve a zero-XP
  // receipt while an eligible live event is still waiting in the durable outbox.
  const summary=JSON.stringify({...metadata,mode:room.settings.mode,startedAt:room.startedAt??marker?.startedAt,
    settings:{capacity:room.settings.capacity,voiceMode:room.settings.voiceMode,visibility:room.settings.visibility},
    outcome:room.outcome,history:room.history,reveal:{players:results,events:room.audit}});
  return {...metadata,key,eventId:marker?.eventId||null,roomCode:room.code,rulesetVersion:room.rulesetVersion||1,
    startedAt:marker?.startedAt??room.startedAt??null,finishedAt:now,...((room.protocol||1)>=2||metadata.rewardPolicyVersion===1?{notBefore:now+30000}:{}),
    mode:room.settings.mode,visibility:room.settings.visibility,capacity:room.settings.capacity,participantCount:room.participants.length,
    ...(room.ranked?{ranked:{key:room.ranked.key,seasonId:room.ranked.seasonId,ratingModel:room.ranked.ratingModel,...(room.ranked.ratingPolicySHA256?{ratingPolicySHA256:room.ranked.ratingPolicySHA256}:{})}}:{}),
    summary,draw:room.outcome?.faction==='draw',results:results.map(r=>({...r,
      // Pre-marker matches retain archive compatibility only. A known mapping
      // never falls back to a later account attached to the same seat.
      userId:marker?.accounts?marker.accounts[r.playerId]:room.members.find(m=>m.id===r.playerId)?.accountUserId,
    })).filter(r=>r.userId)};
}
export async function persistMafiaResult(env,event) {
  if(!env.DB||!event||event.notBefore>Date.now())return;
  const {key,summary,finishedAt:now}=event;
  const ids=[...new Set(event.results.map(result=>result.userId))];
  const allParticipantsKnown=completeParticipantAccounts(event,ids);
  await env.DB.batch([
    // A delayed outbox must not resurrect a replay after participant deletion.
    // Other players keep their own independent result rows below.
    stmt(env,`INSERT OR IGNORE INTO mafia_history(match_key,room_code,ruleset_version,finished_at,summary) SELECT ?,?,?,?,? WHERE ${allParticipantsKnown?`(SELECT COUNT(*) FROM users participant WHERE participant.id IN (${ids.map(()=>'?').join(',')}) AND ${liveAccountSql('participant.id')})=?`:'0'}`,key,event.roomCode,event.rulesetVersion,now,summary,...(allParticipantsKnown?[...ids,ids.length]:[])),
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
    ...mafiaCommunityDeleteStatements(env,id),
    ...mafiaProgressDeleteStatements(env,id),
    ...mafiaRankedDeleteStatements(env,id),
    ...mafiaRatingPolicyDeleteStatements(env,id),
  ];
}

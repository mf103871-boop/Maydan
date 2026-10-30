import { first } from './lamma/common.mjs';
import { fail } from './room-model.mjs';
import { liveAccountSql } from './moderation/access.mjs';
import { MAFIA_ROLES } from '../src/online/mafia-shared.js';

const DAY=86400000,MAX_SUMMARY=524288,MAX_EVENTS=500;
const factions=new Set(['town','mafia','shadow']);
const eventTypes=new Set(['roles','night_action','attack_vote','shield_used','converted','verdict_votes','eliminated','nomination_vote','extended']);
const integer=(value,max=Number.MAX_SAFE_INTEGER)=>Number.isSafeInteger(value)&&value>=0&&value<=max;
const keyValid=value=>typeof value==='string'&&/^[A-Za-z0-9:_-]{1,180}$/.test(value);
const record=value=>value&&typeof value==='object'&&!Array.isArray(value);

// This is a new projection, never a raw archive response. Seat numbers are local
// to the match; account/room/seat IDs, names, messages and media never leave here.
export function projectMafiaReview(row) {
  if(!row||!integer(row.finishedAt)||row.finishedAt<=0||row.rulesetVersion!==1||typeof row.summary!=='string'||row.summary.length>MAX_SUMMARY||new TextEncoder().encode(row.summary).length>MAX_SUMMARY)return null;
  let summary;try{summary=JSON.parse(row.summary);}catch{return null;}
  const rawPlayers=summary?.reveal?.players,rawEvents=summary?.reveal?.events;
  if(!record(summary)||!Array.isArray(rawPlayers)||rawPlayers.length<1||rawPlayers.length>12||!Array.isArray(rawEvents)||rawEvents.length>5000
    ||!['town','mafia','shadow','draw'].includes(summary.outcome?.faction))return null;
  const seats=new Map(),players=[];
  for(const [index,player] of rawPlayers.entries()) {
    if(!record(player)||typeof player.playerId!=='string'||!player.playerId||player.playerId.length>100||seats.has(player.playerId)
      ||!Object.hasOwn(MAFIA_ROLES,player.roleId)||!factions.has(player.initialFaction)||!factions.has(player.faction))return null;
    const seat=index+1;seats.set(player.playerId,seat);
    players.push({seat,roleId:player.roleId,initialFaction:player.initialFaction,faction:player.faction,won:player.won===true,forfeited:player.forfeited===true});
  }
  const allowed=rawEvents.filter(event=>record(event)&&eventTypes.has(event.type)&&integer(event.at)&&event.at<=row.finishedAt);
  const startedAt=allowed.reduce((at,event)=>Math.min(at,event.at),row.finishedAt),events=[];
  for(const event of allowed) {
    if(['attack_vote','nomination_vote'].includes(event.type)&&event.targetId!=null&&!seats.has(event.targetId))continue;
    const projected={type:event.type,round:integer(event.round,10000)?event.round:0,elapsedSeconds:Math.min(43200,Math.floor((event.at-startedAt)/1000))};
    if(seats.has(event.playerId))projected.actorSeat=seats.get(event.playerId);
    if(seats.has(event.targetId))projected.targetSeat=seats.get(event.targetId);
    if(Array.isArray(event.targetIds))projected.targetSeats=[...new Set(event.targetIds.map(id=>seats.get(id)).filter(Boolean))].slice(0,12);
    if(seats.has(event.recruiterId))projected.recruiterSeat=seats.get(event.recruiterId);
    if(seats.has(event.nomineeId))projected.nomineeSeat=seats.get(event.nomineeId);
    if(Object.hasOwn(MAFIA_ROLES,event.roleId))projected.roleId=event.roleId;
    if(['forfeit','night','verdict'].includes(event.reason))projected.reason=event.reason;
    if(event.type==='verdict_votes'&&record(event.votes))projected.votes=[...seats].flatMap(([id,seat])=>
      Object.hasOwn(event.votes,id)&&typeof event.votes[id]==='boolean'?[{seat,approve:event.votes[id]}]:[]);
    events.push(projected);
  }
  return {available:true,rulesetVersion:1,finishedAt:row.finishedAt,outcome:summary.outcome.faction,players,
    events:events.slice(-MAX_EVENTS),earlierEventsOmitted:Math.max(0,events.length-MAX_EVENTS),retentionDays:30};
}

function authorizedArchive(env,id,matchKey,now) {
  return first(env,`SELECT h.summary,h.finished_at AS finishedAt,h.ruleset_version AS rulesetVersion
    FROM mafia_history h JOIN mafia_results r ON r.match_key=h.match_key
    WHERE r.user_id=? AND h.match_key=? AND h.finished_at>? AND h.finished_at<=?
      AND ${liveAccountSql('r.user_id')}
      AND NOT EXISTS(SELECT 1 FROM mafia_observer_memberships o WHERE o.user_id=r.user_id AND o.expires_at>?)`,
    id,matchKey,now-30*DAY,now-30000,now);
}
export async function readMafiaReview(env,id,matchKey,now=Date.now()) {
  if(!keyValid(matchKey))fail('INVALID',400);
  if(!env.DB)return {available:false};
  const row=await authorizedArchive(env,id,matchKey,now),review=projectMafiaReview(row);
  if(!review)return {available:false};
  // Deleting any participant removes the shared archive. Recheck membership,
  // retention, observer lock and live account after assembling the projection.
  const final=await authorizedArchive(env,id,matchKey,Date.now());
  if(!final||final.summary!==row.summary||final.finishedAt!==row.finishedAt||final.rulesetVersion!==row.rulesetVersion)return {available:false};
  return review;
}

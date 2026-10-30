import { fail } from './room-model.mjs';
import { liveAccountSql } from './moderation/access.mjs';
import { all, first, run, stmt } from './lamma/common.mjs';
import { MAFIA_ROOMS_CEILING, MAFIA_VOICE_CEILING } from './mafia-limits.mjs';
import { updateMafiaDirectory as syncMafiaDirectory } from './mafia-directory.mjs';

export const MAFIA_LEASE_MS = 180_000;
export const mafiaEnabled = env => String(env.MAFIA_ENABLED || '') === '1';
export const mafiaPlaying = room => room?.game === 'mafia' && !['lobby','over','closed'].includes(room.phase);
export function requireMafiaEnabled(env) { if (!mafiaEnabled(env)) fail('MAFIA_DISABLED', 503); if (!env.DB) fail('MAFIA_UNAVAILABLE', 503); }
const placeholders = ids => ids.map(() => '?').join(',');
export async function mafiaMediaLease(env,id,now=Date.now()) {
  if (!env.DB) return null;
  try { return await first(env,'SELECT user_id,room_key,call_id,expires_at,updated_at FROM mafia_media_leases WHERE user_id=? AND expires_at>? UNION ALL SELECT user_id,room_key,NULL AS call_id,expires_at,updated_at FROM mafia_match_leases WHERE user_id=? AND expires_at>? LIMIT 1',id,now,id,now); }
  catch (error) { if (!mafiaEnabled(env) && /no such table.*mafia_(media|match)_leases/i.test(error.message)) return null; throw error; }
}
export async function assertSocialAllowed(env,id) { if (await mafiaMediaLease(env,id)) fail('MAFIA_SOCIAL_LOCKED',409); }
// Used inside the same D1 write as a public appearance change. A route-level
// check alone races with the room acquiring its live-match lease.
export const noMafiaMediaLeaseSql = (userExpression,now=Date.now()) => `NOT EXISTS(SELECT 1 FROM (SELECT user_id,expires_at FROM mafia_media_leases UNION ALL SELECT user_id,expires_at FROM mafia_match_leases) mml WHERE mml.user_id=${userExpression} AND mml.expires_at>${Math.floor(now)})`;
// Session revocation is different from a network loss. Wake the owning room
// even if the native SDK is the only remaining connection. The room checks D1
// itself, so delayed notifications cannot revoke another authorized session.
export async function recheckMafiaAuthorization(env,id) {
  if(!env.DB||!env.ROOMS)return;
  let rooms;try{rooms=await all(env,'SELECT room_code FROM mafia_seats WHERE user_id=? UNION SELECT room_code FROM mafia_observer_memberships WHERE user_id=?',id,id);}catch(error){if(!mafiaEnabled(env)&&/no such table.*mafia_/i.test(error.message))return;throw error;}
  for(const room of rooms){const response=await env.ROOMS.get(env.ROOMS.idFromName(room.room_code)).fetch(new Request('https://internal/mafia-session-revoked',{method:'POST'}));if(!response.ok&&response.status!==404)fail('MAFIA_VOICE_UNAVAILABLE',503);}
}
export async function leaveMafiaOnBlock(env,id,targetAccountUserId) {
  if(!env.DB||!env.ROOMS)return false;
  let rooms;try{rooms=await all(env,'SELECT room_code FROM mafia_seats WHERE user_id=? UNION SELECT room_code FROM mafia_observer_memberships WHERE user_id=?',id,id);}catch(error){if(!mafiaEnabled(env)&&/no such table.*mafia_/i.test(error.message))return false;throw error;}
  let left=false;for(const room of rooms){const response=await env.ROOMS.get(env.ROOMS.idFromName(room.room_code)).fetch(new Request('https://internal/mafia-block-account',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({accountUserId:id,targetAccountUserId})}));if(response.status===404)continue;if(!response.ok)fail('MAFIA_VOICE_UNAVAILABLE',503);left=Boolean((await response.json()).left)||left;}return left;
}
export async function removeMafiaAccount(env,id) {
  if(!env.DB||!env.ROOMS)return;
  let rooms;
  try {rooms=await all(env,'SELECT room_code FROM mafia_seats WHERE user_id=? UNION SELECT room_code FROM mafia_observer_memberships WHERE user_id=?',id,id);}
  catch(error){if(!mafiaEnabled(env)&&/no such table.*mafia_/i.test(error.message))return;throw error;}
  for(const room of rooms){const response=await env.ROOMS.get(env.ROOMS.idFromName(room.room_code)).fetch(new Request('https://internal/mafia-account-removed',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({accountUserId:id})}));if(!response.ok&&response.status!==404)fail('MAFIA_VOICE_UNAVAILABLE',503);}
}
export async function assertMafiaMembers(env,room,input) {
  if (!env.DB || !input?.accountUserId) fail('AUTH_REQUIRED',401);
  const id=input.accountUserId;
  if (!await first(env,`SELECT 1 WHERE ${liveAccountSql('?')}`,id,id)) fail('AUTH',401);
  const peers=room.members.filter(m=>!m.left&&m.accountUserId&&m.accountUserId!==id).map(m=>m.accountUserId);
  if (peers.length && await first(env,`SELECT 1 FROM social_blocks WHERE (blocker_id=? AND blocked_id IN (${placeholders(peers)})) OR (blocked_id=? AND blocker_id IN (${placeholders(peers)})) LIMIT 1`,id,...peers,id,...peers)) fail('MAFIA_BLOCKED',409);
}
export async function claimMafiaSeat(env,room,id,now=Date.now()) {
  const seat=room.members.find(m=>m.id===id&&!m.left); if(!seat?.accountUserId) fail('AUTH_REQUIRED',401);
  const media=await mafiaMediaLease(env,seat.accountUserId,now);
  if(media&&media.room_key!==room.mafiaKey)fail('MAFIA_ACTIVE_ELSEWHERE',409);
  await assertMafiaMembers(env,room,seat);
  await run(env,`INSERT INTO mafia_seats(user_id,room_key,room_code,seat_id,expires_at,updated_at) SELECT ?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM mafia_observer_memberships WHERE user_id=? AND expires_at>?) AND NOT EXISTS(SELECT 1 FROM mafia_match_leases WHERE user_id=? AND room_key!=? AND expires_at>?) AND NOT EXISTS(SELECT 1 FROM mafia_media_leases WHERE user_id=? AND room_key!=? AND expires_at>?) ON CONFLICT(user_id) DO UPDATE SET room_key=excluded.room_key,room_code=excluded.room_code,seat_id=excluded.seat_id,expires_at=excluded.expires_at,updated_at=excluded.updated_at WHERE mafia_seats.expires_at<=? OR (mafia_seats.room_key=excluded.room_key AND mafia_seats.seat_id=excluded.seat_id)`,seat.accountUserId,room.mafiaKey,room.code,id,now+MAFIA_LEASE_MS,now,seat.accountUserId,now,seat.accountUserId,room.mafiaKey,now,seat.accountUserId,room.mafiaKey,now,now);
  if(!await first(env,'SELECT 1 FROM mafia_seats WHERE user_id=? AND room_key=? AND seat_id=? AND expires_at>?',seat.accountUserId,room.mafiaKey,id,now)) fail('MAFIA_ACTIVE_ELSEWHERE',409);
}
export async function renewMafiaSeats(env,room,now=Date.now()) {
  const seats=room.members.filter(m=>!m.left&&m.accountUserId);
  if(seats.length) {
    const held=await all(env,`SELECT user_id,seat_id FROM mafia_seats WHERE room_key=? AND expires_at>? AND user_id IN (${placeholders(seats)})`,room.mafiaKey,now,...seats.map(m=>m.accountUserId));
    if(held.length!==seats.length||seats.some(m=>!held.some(h=>h.user_id===m.accountUserId&&h.seat_id===m.id))) fail('MAFIA_ACTIVE_ELSEWHERE',409);
    const live=await all(env,`SELECT id FROM users WHERE id IN (${placeholders(seats)}) AND ${liveAccountSql('users.id')}`,...seats.map(m=>m.accountUserId));
    if(live.length!==seats.length) fail('AUTH',401);
    await run(env,`UPDATE mafia_seats SET expires_at=?,updated_at=? WHERE room_key=? AND user_id IN (${placeholders(seats)})`,now+MAFIA_LEASE_MS,now,room.mafiaKey,...seats.map(m=>m.accountUserId));
  }
  room.mafiaRenewAt=now+30_000;
}
export const updateMafiaDirectory = syncMafiaDirectory;
export async function cleanupMafiaSeats(env,room) {
  // An observer-to-player promotion journals fresh credentials in the DO before
  // moving the D1 claim. Preserve that bounded claim across a failed DO commit,
  // so the same credentials can recover it instead of being silently released.
  const users=[...new Set([...room.members.filter(m=>!m.left).map(m=>m.accountUserId),...Object.values(room.observers||{}).filter(o=>o.promotion&&o.expiresAt>Date.now()).map(o=>o.accountUserId)])];
  await run(env,`DELETE FROM mafia_seats WHERE room_key=?${room.phase==='closed'||!users.length?'':` AND user_id NOT IN (${placeholders(users)})`}`,room.mafiaKey,...(room.phase==='closed'||!users.length?[]:users));
}
export async function activateMafiaMatchPrivacy(env,room,now=Date.now()) {
  if(!mafiaPlaying(room)||(room.mafiaPrivacyMatchId===room.matchId&&now<(room.mafiaPrivacyRenewAt||0)))return;
  const ids=room.members.filter(m=>!m.left&&room.participants.includes(m.id)).map(m=>m.accountUserId);
  if(!ids.length||ids.some(id=>!id))fail('AUTH_REQUIRED',401);
  const conflict=`NOT EXISTS(SELECT 1 FROM (SELECT user_id,room_key,expires_at FROM mafia_media_leases UNION ALL SELECT user_id,room_key,expires_at FROM mafia_match_leases) locked WHERE locked.user_id IN (${placeholders(ids)}) AND locked.room_key!=? AND locked.expires_at>?)`;
  await env.DB.batch(ids.map(id=>stmt(env,`INSERT INTO mafia_match_leases(user_id,room_key,match_id,expires_at,updated_at) SELECT ?,?,?,?,? WHERE ${conflict} ON CONFLICT(user_id) DO UPDATE SET room_key=excluded.room_key,match_id=excluded.match_id,expires_at=excluded.expires_at,updated_at=excluded.updated_at WHERE mafia_match_leases.room_key=excluded.room_key OR mafia_match_leases.expires_at<=?`,id,room.mafiaKey,String(room.matchId),now+MAFIA_LEASE_MS,now,...ids,room.mafiaKey,now,now)));
  const held=await all(env,'SELECT user_id FROM mafia_match_leases WHERE room_key=? AND match_id=? AND expires_at>?',room.mafiaKey,String(room.matchId),now);
  if(ids.some(id=>!held.some(row=>row.user_id===id)))fail('MAFIA_ACTIVE_ELSEWHERE',409);
  room.mafiaPrivacyMatchId=room.matchId;room.mafiaPrivacyRenewAt=now+30_000;
}
export async function releaseMafiaMatchPrivacy(env,room) {
  // A ranked assignment already owns its lease before the lobby is journaled.
  // Preserve it across that journal/start boundary and a recoverable failed
  // start; otherwise a second device could start social audio in the gap.
  const rankedLobby=room.ranked&&room.phase==='lobby'&&!room.technicalAbort;
  const ids=mafiaPlaying(room)||rankedLobby?room.members.filter(m=>!m.left&&(rankedLobby||room.participants.includes(m.id))).map(m=>m.accountUserId):[];
  await run(env,`DELETE FROM mafia_match_leases WHERE room_key=?${ids.length?` AND user_id NOT IN (${placeholders(ids)})`:''}`,room.mafiaKey,...ids);
  if(!ids.length){room.mafiaPrivacyRenewAt=0;room.mafiaPrivacyMatchId=null;}
}
export async function activateMafiaMedia(env,room,now=Date.now()) {
  if(room.settings.voiceMode==='off')return;
  const seats=room.members.filter(m=>!m.left&&(mafiaPlaying(room)?room.participants.includes(m.id):room.mafiaMedia?.lobbyAccounts?.includes(m.accountUserId)));
  const ids=seats.map(m=>m.accountUserId); if(!ids.length||ids.some(id=>!id)) fail('AUTH_REQUIRED',401);
  const maxRooms=Math.max(1,Math.min(MAFIA_ROOMS_CEILING,Math.floor(Number(env.MAFIA_MAX_ACTIVE_ROOMS)||1))),maxParticipants=Math.max(12,Math.min(MAFIA_VOICE_CEILING,Math.floor(Number(env.MAFIA_MAX_VOICE_PARTICIPANTS)||80)));
  await run(env,`INSERT INTO mafia_media_slots(room_key,call_id,capacity,updated_at) SELECT ?,?,?,? WHERE (SELECT COUNT(*) FROM mafia_media_slots WHERE room_key!=?)<? AND COALESCE((SELECT SUM(capacity) FROM mafia_media_slots WHERE room_key!=?),0)+?<=? ON CONFLICT(room_key) DO UPDATE SET call_id=excluded.call_id,capacity=excluded.capacity,updated_at=excluded.updated_at`,room.mafiaKey,room.mafiaMedia.callId,room.settings.capacity,now,room.mafiaKey,maxRooms,room.mafiaKey,room.settings.capacity,maxParticipants);
  if(!await first(env,'SELECT 1 FROM mafia_media_slots WHERE room_key=? AND call_id=? AND capacity=?',room.mafiaKey,room.mafiaMedia.callId,room.settings.capacity))fail('MAFIA_VOICE_CAPACITY',503);
  const conflict=`NOT EXISTS(SELECT 1 FROM mafia_media_leases WHERE user_id IN (${placeholders(ids)}) AND room_key!=? AND expires_at>?)`;
  // A connected provider participant can outlive its JWT. Only confirmed
  // revocation may release this lease; a short clock expiry is not sufficient.
  await env.DB.batch(ids.map(id=>stmt(env,`INSERT INTO mafia_media_leases(user_id,room_key,call_id,expires_at,updated_at) SELECT ?,?,?,?,? WHERE ${conflict} ON CONFLICT(user_id) DO UPDATE SET room_key=excluded.room_key,call_id=excluded.call_id,expires_at=excluded.expires_at,updated_at=excluded.updated_at WHERE mafia_media_leases.room_key=excluded.room_key OR mafia_media_leases.expires_at<=?`,id,room.mafiaKey,room.mafiaMedia.callId,Number.MAX_SAFE_INTEGER,now,...ids,room.mafiaKey,now,now)));
  const held=await all(env,`SELECT user_id FROM mafia_media_leases WHERE room_key=? AND call_id=? AND expires_at>?`,room.mafiaKey,room.mafiaMedia.callId,now);
  if(ids.some(id=>!held.some(r=>r.user_id===id))) fail('MAFIA_ACTIVE_ELSEWHERE',409);
}
export async function releaseMafiaMedia(env,room,{quarantineUntil=0}={}) {
  if(quarantineUntil>Date.now()) await run(env,'UPDATE mafia_media_leases SET expires_at=? WHERE room_key=?',quarantineUntil,room.mafiaKey);
  else await env.DB.batch([stmt(env,'DELETE FROM mafia_media_leases WHERE room_key=?',room.mafiaKey),stmt(env,'DELETE FROM mafia_media_slots WHERE room_key=?',room.mafiaKey)]);
}
export async function retainMafiaRevocations(env,room,removals,now=Date.now()) {
  const ids=[...new Set(removals.map(item=>item.identity))];
  if(!ids.length)return;
  // A text-only match can still inherit an actual social provider connection.
  // Its revocation needs indefinite ownership without reserving any new voice
  // capacity. A durable journal plus these rows survives an aborted start.
  const conflict=`NOT EXISTS(SELECT 1 FROM mafia_media_leases WHERE user_id IN (${placeholders(ids)}) AND room_key!=? AND expires_at>?)`;
  await env.DB.batch(ids.map(id=>stmt(env,`INSERT INTO mafia_media_leases(user_id,room_key,call_id,expires_at,updated_at) SELECT ?,?,?,?,? WHERE ${conflict} ON CONFLICT(user_id) DO UPDATE SET room_key=excluded.room_key,call_id=excluded.call_id,expires_at=excluded.expires_at,updated_at=excluded.updated_at WHERE mafia_media_leases.room_key=excluded.room_key OR mafia_media_leases.expires_at<=?`,id,room.mafiaKey,room.mafiaMedia.callId,Number.MAX_SAFE_INTEGER,now,...ids,room.mafiaKey,now,now)));
  const held=await all(env,'SELECT user_id FROM mafia_media_leases WHERE room_key=? AND call_id=? AND expires_at>?',room.mafiaKey,room.mafiaMedia.callId,now);
  if(ids.some(id=>!held.some(row=>row.user_id===id)))fail('MAFIA_ACTIVE_ELSEWHERE',409);
}
export async function refundMafiaTrial(env,room) {
  if(!room.trialStarted||!room.roomTrialClaim) return;
  const claim=room.roomTrialClaim;
  await env.DB.batch([
    stmt(env,"DELETE FROM trials WHERE game='mafia' AND user_id IN (SELECT user_id FROM online_room_trial_claims WHERE game='mafia' AND claim_id=?)",claim),
    stmt(env,"DELETE FROM online_room_trial_claims WHERE game='mafia' AND claim_id=?",claim),
  ]);
}
export async function cleanupMafia(env,now=Date.now(),reportRetention=365*86400000) {
  if(!env.DB) return;
  try { await env.DB.batch([stmt(env,'DELETE FROM mafia_results WHERE finished_at<?',now-30*86400000),stmt(env,'DELETE FROM mafia_history WHERE finished_at<?',now-30*86400000),stmt(env,'DELETE FROM mafia_reports WHERE created_at<?',now-reportRetention),stmt(env,'DELETE FROM mafia_seats WHERE expires_at<? AND NOT EXISTS(SELECT 1 FROM mafia_media_leases m WHERE m.user_id=mafia_seats.user_id)',now),stmt(env,'DELETE FROM mafia_media_leases WHERE expires_at<?',now),stmt(env,'DELETE FROM mafia_match_leases WHERE expires_at<?',now),stmt(env,'DELETE FROM mafia_observer_memberships WHERE expires_at<?',now),stmt(env,'DELETE FROM mafia_public_rooms WHERE expires_at<?',now)]); }
  catch(error) { if(mafiaEnabled(env)||!/no such table.*mafia_/i.test(error.message)) throw error; }
}

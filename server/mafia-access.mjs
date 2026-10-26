import { fail } from './room-model.mjs';
import { liveAccountSql } from './moderation/access.mjs';
import { all, first, run, stmt } from './lamma/common.mjs';

export const MAFIA_LEASE_MS = 180_000;
export const mafiaEnabled = env => String(env.MAFIA_ENABLED || '') === '1';
export const mafiaPlaying = room => room?.game === 'mafia' && !['lobby','over','closed'].includes(room.phase);
export function requireMafiaEnabled(env) { if (!mafiaEnabled(env)) fail('MAFIA_DISABLED', 503); if (!env.DB) fail('MAFIA_UNAVAILABLE', 503); }
const placeholders = ids => ids.map(() => '?').join(',');
export async function mafiaMediaLease(env,id,now=Date.now()) {
  if (!env.DB) return null;
  try { return await first(env,'SELECT * FROM mafia_media_leases WHERE user_id=? AND expires_at>?',id,now); }
  catch (error) { if (!mafiaEnabled(env) && /no such table.*mafia_media_leases/i.test(error.message)) return null; throw error; }
}
export async function assertSocialAllowed(env,id) { if (await mafiaMediaLease(env,id)) fail('MAFIA_SOCIAL_LOCKED',409); }
export async function leaveMafiaOnBlock(env,id,targetAccountUserId) {
  if(!env.DB||!env.ROOMS)return false;
  let seat;try{seat=await first(env,'SELECT room_code FROM mafia_seats WHERE user_id=?',id);}catch(error){if(!mafiaEnabled(env)&&/no such table.*mafia_/i.test(error.message))return false;throw error;}
  if(!seat)return false;
  const response=await env.ROOMS.get(env.ROOMS.idFromName(seat.room_code)).fetch(new Request('https://internal/mafia-block-account',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({accountUserId:id,targetAccountUserId})}));
  if(response.status===404)return false;if(!response.ok)fail('MAFIA_VOICE_UNAVAILABLE',503);return Boolean((await response.json()).left);
}
export async function removeMafiaAccount(env,id) {
  if(!env.DB||!env.ROOMS)return;
  let seat;
  try {seat=await first(env,'SELECT room_code FROM mafia_seats WHERE user_id=?',id);}
  catch(error){if(!mafiaEnabled(env)&&/no such table.*mafia_/i.test(error.message))return;throw error;}
  if(!seat)return;
  const response=await env.ROOMS.get(env.ROOMS.idFromName(seat.room_code)).fetch(new Request('https://internal/mafia-account-removed',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({accountUserId:id})}));
  if(!response.ok&&response.status!==404)fail('MAFIA_VOICE_UNAVAILABLE',503);
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
  await run(env,`INSERT INTO mafia_seats(user_id,room_key,room_code,seat_id,expires_at,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET room_key=excluded.room_key,room_code=excluded.room_code,seat_id=excluded.seat_id,expires_at=excluded.expires_at,updated_at=excluded.updated_at WHERE mafia_seats.expires_at<=? OR (mafia_seats.room_key=excluded.room_key AND mafia_seats.seat_id=excluded.seat_id)`,seat.accountUserId,room.mafiaKey,room.code,id,now+MAFIA_LEASE_MS,now,now);
  if(!await first(env,'SELECT 1 FROM mafia_seats WHERE user_id=? AND room_key=? AND seat_id=? AND expires_at>?',seat.accountUserId,room.mafiaKey,id,now)) fail('MAFIA_ACTIVE_ELSEWHERE',409);
}
export async function renewMafiaSeats(env,room,now=Date.now()) {
  const seats=room.members.filter(m=>!m.left&&m.accountUserId);
  if(seats.length) {
    const held=await all(env,`SELECT user_id,seat_id FROM mafia_seats WHERE room_key=? AND expires_at>? AND user_id IN (${placeholders(seats)})`,room.mafiaKey,now,...seats.map(m=>m.accountUserId));
    if(held.length!==seats.length||seats.some(m=>!held.some(h=>h.user_id===m.accountUserId&&h.seat_id===m.id))) fail('MAFIA_ACTIVE_ELSEWHERE',409);
    const live=await all(env,`SELECT id FROM users WHERE id IN (${placeholders(seats)}) AND ${liveAccountSql('users.id')}`,...seats.map(m=>m.accountUserId));
    if(live.length!==seats.length) fail('AUTH',401);
    await run(env,'UPDATE mafia_seats SET expires_at=?,updated_at=? WHERE room_key=?',now+MAFIA_LEASE_MS,now,room.mafiaKey);
  }
  room.mafiaRenewAt=now+30_000;
}
export async function updateMafiaDirectory(env,room,now=Date.now()) {
  const members=room.members.filter(m=>!m.left);
  if(room.phase!=='lobby'||room.settings.visibility!=='public'||!members.length) { await run(env,'DELETE FROM mafia_public_rooms WHERE room_key=?',room.mafiaKey); return; }
  const host=members.find(m=>m.id===room.hostId);
  await run(env,`INSERT INTO mafia_public_rooms(room_key,room_code,mode,capacity,players,ready,host_name,expires_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(room_key) DO UPDATE SET mode=excluded.mode,capacity=excluded.capacity,players=excluded.players,ready=excluded.ready,host_name=excluded.host_name,expires_at=excluded.expires_at,updated_at=excluded.updated_at`,room.mafiaKey,room.code,room.settings.mode,room.settings.capacity,members.length,members.filter(m=>m.ready).length,host?.name||'مضيف ميدان',Math.min(room.expiresAt,now+90_000),now);
}
export async function cleanupMafiaSeats(env,room) {
  const users=room.members.filter(m=>!m.left).map(m=>m.accountUserId);
  await run(env,`DELETE FROM mafia_seats WHERE room_key=?${room.phase==='closed'||!users.length?'':` AND user_id NOT IN (${placeholders(users)})`}`,room.mafiaKey,...(room.phase==='closed'||!users.length?[]:users));
}
export async function activateMafiaMedia(env,room,now=Date.now()) {
  const seats=room.members.filter(m=>room.participants.includes(m.id)&&!m.left);
  const ids=seats.map(m=>m.accountUserId); if(!ids.length||ids.some(id=>!id)) fail('AUTH_REQUIRED',401);
  const maxRooms=Math.max(1,Math.min(6,Math.floor(Number(env.MAFIA_MAX_ACTIVE_ROOMS)||1))),maxParticipants=Math.max(12,Math.min(80,Math.floor(Number(env.MAFIA_MAX_VOICE_PARTICIPANTS)||80)));
  await run(env,`INSERT INTO mafia_media_slots(room_key,call_id,capacity,updated_at) SELECT ?,?,?,? WHERE (SELECT COUNT(*) FROM mafia_media_slots WHERE room_key!=?)<? AND COALESCE((SELECT SUM(capacity) FROM mafia_media_slots WHERE room_key!=?),0)+?<=? ON CONFLICT(room_key) DO UPDATE SET call_id=excluded.call_id,capacity=excluded.capacity,updated_at=excluded.updated_at`,room.mafiaKey,room.mafiaMedia.callId,room.settings.capacity,now,room.mafiaKey,maxRooms,room.mafiaKey,room.settings.capacity,maxParticipants);
  if(!await first(env,'SELECT 1 FROM mafia_media_slots WHERE room_key=? AND call_id=?',room.mafiaKey,room.mafiaMedia.callId))fail('MAFIA_VOICE_CAPACITY',503);
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
  try { await env.DB.batch([stmt(env,'DELETE FROM mafia_results WHERE finished_at<?',now-30*86400000),stmt(env,'DELETE FROM mafia_history WHERE finished_at<?',now-30*86400000),stmt(env,'DELETE FROM mafia_reports WHERE created_at<?',now-reportRetention),stmt(env,'DELETE FROM mafia_seats WHERE expires_at<? AND NOT EXISTS(SELECT 1 FROM mafia_media_leases m WHERE m.user_id=mafia_seats.user_id)',now),stmt(env,'DELETE FROM mafia_media_leases WHERE expires_at<?',now),stmt(env,'DELETE FROM mafia_public_rooms WHERE expires_at<?',now)]); }
  catch(error) { if(mafiaEnabled(env)||!/no such table.*mafia_/i.test(error.message)) throw error; }
}

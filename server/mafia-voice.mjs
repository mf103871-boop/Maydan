import { fail } from './room-model.mjs';
import { voiceAudience, technicalAbort } from './mafia-model.mjs';
import { liveKitConfigured, providerRequest, gameConnection } from './lamma/provider.mjs';
import { all, first, run } from './lamma/common.mjs';
import { activateMafiaMedia, mafiaPlaying, mafiaMediaLease, releaseMafiaMedia, refundMafiaTrial } from './mafia-access.mjs';

// The durable journal is the authorization source. Provider failure never opens
// the next channel and a restarted object must finish its revocations first.
// Real Cloud control-plane revocations can exceed 700 ms even with low media
// latency. Two bounded attempts avoid false aborts without indefinite waits.
const REVOKE_ATTEMPTS=2, PROVIDER_TIMEOUT=1500;
const deleteKey=(ctx,key)=>ctx.storage.delete?ctx.storage.delete(key):ctx.storage.put(key,null);
const identityOf=(room,id)=>room.members.find(m=>m.id===id)?.accountUserId;
const audience=(room,id)=>voiceAudience(room,id)||{key:null,canSpeak:false,canListen:false};
const signature=room=>JSON.stringify([room.matchId,room.phaseId,room.phase,room.members.filter(m=>!m.left).map(m=>[m.id,audience(room,m.id)])]);
export function mafiaVoiceView(room,id) {
  const media=room.mafiaMedia, policy=audience(room,id);
  return {callId:media?.callId||null,mediaEpoch:media?.epoch||0,canPublish:!!policy.canSpeak&&!media?.failed,quiet:!policy.key||!policy.canListen||!!media?.failed};
}
async function revoke(env,item) {
  let last;
  for(let attempt=0;attempt<REVOKE_ATTEMPTS;attempt++) {
    try { await providerRequest(env,'RemoveParticipant',{room:item.room,identity:item.identity,revoke_token_ts:Math.max(item.cutoff,Math.floor(Date.now()/1000)+1)},{timeoutMs:PROVIDER_TIMEOUT,strictRevocation:true}); return; }
    catch(error) { last=error; }
  }
  throw last;
}
async function createChannel(env,name){let last;for(let i=0;i<REVOKE_ATTEMPTS;i++){try{return await providerRequest(env,'CreateRoom',{name,max_participants:12,empty_timeout:60,departure_timeout:10},{timeoutMs:PROVIDER_TIMEOUT});}catch(error){last=error;}}throw last;}
async function collectSocial(env,room,now) {
  const ids=room.members.filter(m=>room.participants.includes(m.id)&&!m.left).map(m=>m.accountUserId);
  if(!ids.length) return [];
  // Social leave commits before its retryable provider cleanup. A left row is
  // safe only once a confirmed cutoff is strictly later than that departure.
  // Keep the millisecond/second boundary inclusive to cover same-second tokens.
  const rows=await all(env,`SELECT c.id,c.room_name,p.user_id FROM social_calls c JOIN social_call_participants p ON p.call_id=c.id WHERE p.user_id IN (${ids.map(()=>'?').join(',')}) AND (p.state='active' OR (p.state='left' AND COALESCE(p.left_at,0)>=COALESCE(p.revoked_before,0)*1000))`,...ids);
  return rows.map(row=>({room:row.room_name,identity:row.user_id,socialCallId:row.id,cutoff:Math.floor(now/1000)+1}));
}
export async function prepareMafiaVoice(ctx,env,previous,candidate,now=Date.now()) {
  if(candidate.game!=='mafia')return;
  const playing=mafiaPlaying(candidate), wasPlaying=mafiaPlaying(previous);
  const pending=await ctx.storage.get('mafia:voice-transition');
  if(!playing&&!wasPlaying&&!candidate.mafiaMedia&&!pending) return;
  if(playing&&!wasPlaying&&previous?.matchId!==candidate.matchId)candidate.mafiaMedia=null;
  candidate.mafiaMedia ||= {callId:pending?.callId||crypto.randomUUID(),epoch:0,channels:{},devices:{},issued:[],signature:null,presence:{}};
  const media=candidate.mafiaMedia, nextSignature=signature(candidate);
  if(media.signature===nextSignature&&!pending) return;
  if(playing) {
    if(!liveKitConfigured(env)) fail('MAFIA_VOICE_UNAVAILABLE',503);
    await activateMafiaMedia(env,candidate,now);
  }
  const cutoff=Math.floor(now/1000)+1;
  const oldIssued=media.issued||[];
  const social=!wasPlaying&&playing?await collectSocial(env,candidate,now):[];
  const removals=[...(pending?.removals||[]),...oldIssued.map(i=>({room:i.room,identity:i.identity,cutoff})),...social];
  const unique=[...new Map(removals.map(i=>[`${i.room}:${i.identity}`,i])).values()];
  const journal={callId:media.callId,fromEpoch:media.epoch,toEpoch:media.epoch+1,removals:unique,createdAt:now};
  await ctx.storage.put('mafia:voice-transition',journal);
  try {
    // The complete durable revocation journal precedes D1 state changes. A
    // crash after marking a social participant left still retries its token.
    for(const item of unique.filter(i=>i.socialCallId))await run(env,"UPDATE social_call_participants SET state='left',left_at=?,revoked_before=? WHERE call_id=? AND user_id=?",now,item.cutoff,item.socialCallId,item.identity);
    const results=await Promise.allSettled(unique.map(item=>revoke(env,item)));
    if(results.some(r=>r.status==='rejected')) throw results.find(r=>r.status==='rejected').reason;
    media.epoch++; media.channels={}; media.issued=[]; media.signature=nextSignature; media.failed=false;media.quarantineUntil=0;
    // Opaque, fresh channel names each phase. A prior credential can never be
    // reused for a future night or discover a faction by its room name.
    if(playing) for(const m of candidate.members.filter(m=>!m.left)) {
      const a=audience(candidate,m.id); if(a.key&&a.canListen&&!media.channels[a.key]) media.channels[a.key]=`g-${crypto.randomUUID()}`;
    }
    const created=await Promise.allSettled(Object.values(media.channels).map(name=>createChannel(env,name)));
    if(created.some(r=>r.status==='rejected'))throw created.find(r=>r.status==='rejected').reason;
    await ctx.storage.put('mafia:voice-transition',{...journal,revoked:true,ready:true});
  } catch(error) {
    // No next credentials exist. An old live connection can outlast its token;
    // retain its account lock until a later alarm confirms provider revocation.
    technicalAbort(candidate,now,'voice_unavailable');
    console.error('[mafia-media] transition failed',JSON.stringify({kind:error?.name||'Error',providerStatus:error?.providerStatus||null,elapsedMs:Date.now()-now}));
    media.epoch++; media.failed=true;media.channels={};media.issued=[];media.signature=signature(candidate);
    media.quarantineUntil=Number.MAX_SAFE_INTEGER;
    await ctx.storage.put('mafia:voice-transition',{...journal,failed:true});
  }
}
export async function committedMafiaVoice(ctx,env,room) {
  if(room.game!=='mafia')return;
  if(mafiaPlaying(room)&&!room.mafiaMedia?.failed) {
    const accounts=room.members.filter(m=>!m.left&&room.participants.includes(m.id)).map(m=>m.accountUserId);
    if(accounts.length)await run(env,`DELETE FROM mafia_media_leases WHERE room_key=? AND user_id NOT IN (${accounts.map(()=>'?').join(',')})`,room.mafiaKey,...accounts);
  }
  if(!mafiaPlaying(room)) {
    await releaseMafiaMedia(env,room,{quarantineUntil:room.mafiaMedia?.quarantineUntil||0});
    if(room.technicalAbort&&room.reason==='voice_unavailable') await refundMafiaTrial(env,room);
  }
  if(!room.mafiaMedia?.failed)await deleteKey(ctx,'mafia:voice-transition');
}
export async function mafiaVoiceRequest(ctx,env,room,userId,body,now=Date.now()) {
  const seat=room.members.find(m=>!m.left&&m.accountUserId===userId);
  if(!seat||!room.participants.includes(seat.id))fail('NOT_FOUND',404);
  const media=room.mafiaMedia;
  if(!media||!mafiaPlaying(room)||media.failed)fail('CALL_UNAVAILABLE',409);
  if((body.callId&&body.callId!==media.callId)||(body.operation==='leave'&&body.callId!==media.callId))fail('STALE',409);
  const deviceId=body.deviceId;
  if(typeof deviceId!=='string'||!/^[A-Za-z0-9_-]{1,160}$/.test(deviceId))fail('INVALID');
  const voiceSessionId=body.voiceSessionId;
  if(typeof voiceSessionId!=='string'||!/^[A-Za-z0-9_-]{8,100}$/.test(voiceSessionId)||!['join','sync','leave'].includes(body.operation))fail('INVALID');
  const lease=await mafiaMediaLease(env,userId,now);
  if(!lease||lease.room_key!==room.mafiaKey||lease.call_id!==media.callId)fail('MAFIA_ACTIVE_ELSEWHERE',409);
  const oldDevice=media.devices[userId];
  if(oldDevice&&oldDevice!==deviceId)fail('MAFIA_VOICE_DEVICE',409);
  if(await ctx.storage.get('mafia:voice-transition'))fail('MAFIA_VOICE_TRANSITION',409);
  media.sessions||={};media.retiredSessions||={};const previousSession=media.sessions[userId];
  const retired=media.retiredSessions[userId]||[];
  if(body.operation==='leave'&&previousSession!==voiceSessionId)return {call:{id:media.callId,scope:'mafia',conversationId:room.code,status:'ended',voiceSessionId,mediaEpoch:media.epoch,canPublish:false},connection:null,voiceSessionId,mediaEpoch:media.epoch,canPublish:false,quiet:true,stale:true};
  if(body.operation!=='leave'&&previousSession!==voiceSessionId) {
    if(body.operation!=='join'||retired.includes(voiceSessionId))fail('MAFIA_VOICE_SESSION',409);
    if(retired.length>=128)fail('RATE_LIMIT',429);
    const issued=media.issued.filter(i=>i.identity===userId);
    if(previousSession&&issued.length) {
      await ctx.storage.put('mafia:voice-transition',{callId:media.callId,removals:issued.map(i=>({...i,cutoff:Math.floor(now/1000)+1})),createdAt:now});
      await Promise.all(issued.map(i=>revoke(env,{...i,cutoff:Math.floor(now/1000)+1})));
      media.issued=media.issued.filter(i=>i.identity!==userId);media.revokedUntil||={};media.revokedUntil[userId]=(Math.floor(Date.now()/1000)+2)*1000;
    }
    if(previousSession)media.retiredSessions[userId]=[...retired,previousSession];
    media.sessions[userId]=voiceSessionId;media.devices[userId]=deviceId;
    await ctx.storage.put('room',room);await deleteKey(ctx,'mafia:voice-transition');
  }
  media.presence||={};media.presence[userId]=now;media.presenceSavedAt||={};
  if(now-(media.presenceSavedAt[userId]||0)>=10_000){media.presenceSavedAt[userId]=now;await ctx.storage.put('room',room);}
  const policy=audience(room,seat.id),quiet=!policy.key||!policy.canListen;
  const canPublish=!!policy.canSpeak&&!body.listenOnly;
  const participants=quiet?[]:room.members.filter(m=>!m.left&&audience(room,m.id).key===policy.key&&audience(room,m.id).canListen).map(m=>({userId:m.accountUserId,seatId:m.id,name:m.name,state:'active',...(m.profile||{})}));
  const call={id:media.callId,scope:'mafia',conversationId:room.code,name:'مافيا ميدان',status:'active',mediaEpoch:media.epoch,canPublish,participants,voiceSessionId};
  const response={call,connection:null,mediaEpoch:media.epoch,canPublish,quiet,voiceSessionId};
  if(body.operation==='leave') {
    const issued=media.issued.filter(i=>i.identity===userId);
    await ctx.storage.put('mafia:voice-transition',{removals:issued.map(i=>({...i,cutoff:Math.floor(now/1000)+1})),createdAt:now});
    await Promise.all(issued.map(i=>revoke(env,{...i,cutoff:Math.floor(now/1000)+1})));
    media.issued=media.issued.filter(i=>i.identity!==userId); delete media.devices[userId];delete media.presence[userId];media.retiredSessions[userId]=[...retired,voiceSessionId];delete media.sessions[userId];media.revokedUntil||={};media.revokedUntil[userId]=(Math.floor(Date.now()/1000)+2)*1000;
    await ctx.storage.put('room',room); await deleteKey(ctx,'mafia:voice-transition');
    return {...response,quiet:true,canPublish:false,call:{...call,status:'ended',canPublish:false}};
  }
  media.devices[userId]=deviceId;
  if(!oldDevice)await ctx.storage.put('room',room);
  const channel=media.channels[policy.key];
  const issued=media.issued.find(i=>i.identity===userId&&i.room===channel);
  if(body.knownEpoch===media.epoch&&(quiet||issued&&issued.expiresAt>now+60_000&&issued.canPublish===canPublish))return {...response,unchanged:true};
  if(quiet) {await ctx.storage.put('room',room);return response;}
  if(!channel)fail('MAFIA_VOICE_TRANSITION',409);
  if(issued&&issued.canPublish!==canPublish) {
    await revoke(env,{...issued,cutoff:Math.floor(now/1000)+1});
    media.issued=media.issued.filter(i=>i!==issued);media.revokedUntil||={};media.revokedUntil[userId]=(Math.floor(now/1000)+2)*1000;
    await ctx.storage.put('room',room);
    // Fresh identity authorization waits past the inclusive revocation cutoff.
    fail('MAFIA_VOICE_TRANSITION',409);
  }
  if((media.revokedUntil?.[userId]||0)>now)fail('MAFIA_VOICE_TRANSITION',409);
  const entry={room:channel,identity:userId,expiresAt:now+300_000,canPublish};
  media.issued=media.issued.filter(i=>!(i.identity===userId&&i.room===channel));media.issued.push(entry);
  await ctx.storage.put('room',room); // durable authorization before token delivery
  return {...response,connection:{...await gameConnection(env,channel,userId,seat.name,canPublish),mediaEpoch:media.epoch,canPublish,voiceSessionId},expiresAt:entry.expiresAt};
}

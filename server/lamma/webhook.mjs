import { base64urlFromBytes,decodeJws,hmacSha256,safeEqual } from '../accounts/jwt.mjs';
import { fail } from '../room-model.mjs';
import { json } from '../protocol.mjs';
import { first,run,scopeAllowed,ident,unblocked } from './common.mjs';
import { callAction,finishCall,removeParticipantStatements } from './calls.mjs';
import { liveKitConfigured } from './provider.mjs';
import { wakeJobs } from './notifications.mjs';
export async function liveKitWebhook(request,env){
  if(request.method!=='POST')fail('METHOD',405);if(!liveKitConfigured(env))fail('CALLS_UNAVAILABLE',503);
  const token=request.headers.get('authorization')?.replace(/^Bearer\s+/i,'');let j;try{j=decodeJws(token);}catch{fail('AUTH',401);}
  const now=Math.floor(Date.now()/1000);
  if(j.header.alg!=='HS256'||j.payload.iss!==env.LIVEKIT_API_KEY||!Number.isFinite(j.payload.exp)||j.payload.exp<=now||j.payload.nbf>now+10||!safeEqual(base64urlFromBytes(j.signature),base64urlFromBytes(await hmacSha256(env.LIVEKIT_API_SECRET,j.signingInput))))fail('AUTH',401);
  const reader=request.body?.getReader();if(!reader)fail('INVALID',400);const chunks=[];let size=0;for(;;){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>65536){await reader.cancel();fail('INVALID',413);}chunks.push(value);}const bytes=new Uint8Array(size);let at=0;for(const c of chunks){bytes.set(c,at);at+=c.length;}
  const hash=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));let binary='';for(const b of hash)binary+=String.fromCharCode(b);
  if(!safeEqual(String(j.payload.sha256||''),btoa(binary)))fail('AUTH',401);
  let event;try{event=JSON.parse(new TextDecoder().decode(bytes));}catch{fail('INVALID',400);}
  const c=await first(env,'SELECT * FROM social_calls WHERE room_name=?',event.room?.name||'');if(!c)return json({ok:true});
  if(event.event==='room_finished'){await finishCall(env,c.id,'ended','1',{deferProvider:true});return json({ok:true});}
  const identity=event.participant?.identity;if(typeof identity!=='string'||!/^[A-Za-z0-9_-]{1,80}$/.test(identity))return json({ok:true});
  const p=await first(env,'SELECT * FROM social_call_participants WHERE call_id=? AND user_id=?',c.id,identity);
  if(event.event==='participant_joined'){
    let generation;try{generation=JSON.parse(event.participant.metadata||'{}').lammaJoinedAt;}catch{/* Invalid metadata cannot bind a provider SID. */}
    if(p&&(!Number.isSafeInteger(generation)||generation!==p.joined_at))return json({ok:true});
    const allowed=p?.state==='active'&&['ringing','active'].includes(c.status)&&await first(env,`SELECT 1 WHERE ${scopeAllowed(c.scope,ident(c.conversation_id),ident(identity))} AND NOT EXISTS(SELECT 1 FROM social_call_participants x WHERE x.call_id=${ident(c.id)} AND x.state='active' AND NOT (${unblocked('x.user_id',ident(identity))}))`);
    if(!allowed){await env.DB.batch(removeParticipantStatements(env,c,identity,Date.now(),p?`EXISTS(SELECT 1 FROM social_call_participants current WHERE current.call_id=${ident(c.id)} AND current.user_id=${ident(identity)} AND current.joined_at=${Number(p.joined_at)})`:'1'));await wakeJobs(env);}
    else await run(env,"UPDATE social_call_participants SET provider_sid=? WHERE call_id=? AND user_id=? AND state='active' AND joined_at=?",event.participant.sid||null,c.id,identity,generation);
  }
  if(event.event==='participant_left'&&p?.state==='active'&&p.provider_sid&&p.provider_sid===event.participant.sid)await callAction(env,identity,c.id,'leave',{}, {deferProvider:true,providerSid:p.provider_sid});
  return json({ok:true});
}

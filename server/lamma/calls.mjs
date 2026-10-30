import { fail } from '../room-model.mjs';
import { userId,clientIdOf } from '../social/model.mjs';
import { publicName } from '../profiles/model.mjs';
import { notifyUsers } from '../social/realtime.mjs';
import { all,first,stmt,run,changed,ident,scopeOf,requireScope,scopeAllowed,unblocked,recipients,admin } from './common.mjs';
import { job,pushJob,wakeJobs } from './notifications.mjs';
import { liveKitConfigured,connection,providerRequest } from './provider.mjs';
import { afterCommit } from './after-commit.mjs';
import { assertSocialAllowed, noMafiaMediaLeaseSql } from '../mafia-access.mjs';
const noConflict=(c,u)=>`NOT EXISTS(SELECT 1 FROM social_call_participants p WHERE p.call_id=${c} AND p.state='active' AND NOT (${unblocked('p.user_id',u)}))`;
function callView(c,participants,id){return {id:c.id,scope:c.scope,conversationId:c.conversation_id,initiatorId:c.initiator_id,status:c.status,createdAt:c.created_at,expiresAt:c.ring_until,participants:participants.map(p=>({userId:p.user_id,name:publicName(p.name),state:p.state,joinedAt:p.joined_at,leftAt:p.left_at,...(p.user_id===id?{deviceId:p.device_id}:{})}))};}
export async function notifyCall(env,callId,reason){const users=await all(env,'SELECT user_id FROM social_call_participants WHERE call_id=?',callId);
  // Each recipient still passes the current membership/block check, but twelve
  // members no longer add twelve serial database round trips before ringing.
  const allowed=await Promise.all(users.map(async row=>{try{await getCall(env,row.user_id,callId);return row.user_id;}catch{return null;}}));
  await notifyUsers(env,allowed.filter(Boolean),{type:'call',callId,reason});}
export async function getCall(env,id,callId){const c=await first(env,'SELECT * FROM social_calls WHERE id=?',userId(callId));if(!c)fail('NOT_FOUND',404);await requireScope(env,id,c.scope,c.conversation_id);if(!await first(env,`SELECT 1 WHERE ${noConflict(ident(callId),ident(id))} AND ${unblocked(ident(id),ident(c.initiator_id))}`))fail('CALL_UNAVAILABLE',409);const participants=await all(env,`SELECT p.user_id,p.state,p.device_id,p.joined_at,p.left_at,u.name FROM social_call_participants p JOIN users u ON u.id=p.user_id WHERE p.call_id=? AND ${unblocked('p.user_id',ident(id))}`,callId);return callView(c,participants,id);}
export async function listCalls(env,id,context){
  await sweepCalls(env,Date.now(),context);
  const actor=ident(id);
  // Bound the call set before joining its participants. All membership, account,
  // friendship and block predicates share the same fresh SQL snapshot; the old
  // thirty-call loop performed four serial lookups for every visible call.
  const rows=await all(env,`WITH visible_calls AS (
    SELECT listed_call.* FROM social_calls listed_call WHERE listed_call.status IN ('ringing','active')
    AND (listed_call.scope='group' OR EXISTS(SELECT 1 FROM social_call_participants own WHERE own.call_id=listed_call.id AND own.user_id=${actor}))
    AND ((listed_call.scope='group' AND ${scopeAllowed('group','listed_call.conversation_id',actor)}) OR (listed_call.scope='direct' AND ${scopeAllowed('direct','listed_call.conversation_id',actor)}))
    AND ${noConflict('listed_call.id',actor)} AND ${unblocked(actor,'listed_call.initiator_id')}
    ORDER BY listed_call.created_at DESC,listed_call.id LIMIT 30
  ) SELECT c.*,p.user_id AS participant_user_id,p.state AS participant_state,p.device_id AS participant_device_id,
    p.joined_at AS participant_joined_at,p.left_at AS participant_left_at,u.id AS participant_account_id,u.name AS participant_name
    FROM visible_calls c LEFT JOIN social_call_participants p ON p.call_id=c.id AND ${unblocked('p.user_id',actor)}
    LEFT JOIN users u ON u.id=p.user_id ORDER BY c.created_at DESC,c.id,p.user_id`);
  const calls=new Map();
  for(const row of rows){
    if(!calls.has(row.id))calls.set(row.id,{row,participants:[]});
    if(row.participant_user_id&&row.participant_account_id)calls.get(row.id).participants.push({user_id:row.participant_user_id,name:row.participant_name,
      state:row.participant_state,device_id:row.participant_device_id,joined_at:row.participant_joined_at,left_at:row.participant_left_at});
  }
  return {calls:[...calls.values()].map(c=>callView(c.row,c.participants,id))};
}
export async function startCall(env,id,body,context){
  await assertSocialAllowed(env,id);
  if(!liveKitConfigured(env))fail('CALLS_UNAVAILABLE',503);const scope=scopeOf(body.scope),conversationId=userId(body.conversationId),clientId=clientIdOf(body.clientId),deviceId=userId(body.deviceId);await requireScope(env,id,scope,conversationId);await sweepCalls(env,Date.now(),context);
  const prior=await first(env,'SELECT * FROM social_calls WHERE initiator_id=? AND client_id=?',id,clientId);if(prior){if(prior.scope!==scope||prior.conversation_id!==conversationId)fail('CONFLICT',409);return joinCall(env,id,prior.id,{deviceId},context);}
  const now=Date.now(),callId=crypto.randomUUID(),room=`lamma-${callId}`,ids=await recipients(env,scope,conversationId,id);if(ids.length<2)fail('CALL_UNAVAILABLE',409);
  const valid=`${scopeAllowed(scope,ident(conversationId),ident(id))} AND ${noMafiaMediaLeaseSql(ident(id),now)} AND NOT EXISTS(SELECT 1 FROM social_call_participants WHERE user_id=${ident(id)} AND state='active')`;
  const statements=[stmt(env,`INSERT OR IGNORE INTO social_calls(id,scope,conversation_id,initiator_id,client_id,status,created_at,ring_until,expires_at,room_name) SELECT ?,?,?,?,?,'ringing',?,?,?,? WHERE ${valid}`,callId,scope,conversationId,id,clientId,now,now+45000,now+45000,room),stmt(env,"INSERT OR IGNORE INTO social_call_participants(call_id,user_id,state,device_id,joined_at) SELECT ?,?,'active',?,? WHERE EXISTS(SELECT 1 FROM social_calls WHERE id=?)",callId,id,deviceId,now,callId)];
  for(const target of ids.filter(x=>x!==id)) {statements.push(stmt(env,`INSERT OR IGNORE INTO social_call_participants(call_id,user_id,state) SELECT ?,?,'invited' WHERE EXISTS(SELECT 1 FROM social_calls WHERE id=?) AND ${scopeAllowed(scope,ident(conversationId),ident(target))} AND ${unblocked(ident(id),ident(target))}`,callId,target,callId));statements.push(pushJob(env,callId,target,{category:'calls',actorId:id,scope,conversationId,callId,expiresAt:now+45000},`EXISTS(SELECT 1 FROM social_call_participants WHERE call_id=${ident(callId)} AND user_id=${ident(target)})`));}
  statements.push(job(env,`expire-${callId}`,'call_expire',{callId},null,now+45001,`EXISTS(SELECT 1 FROM social_calls WHERE id=${ident(callId)})`));
  await env.DB.batch(statements);if(!await first(env,'SELECT 1 FROM social_calls WHERE id=?',callId))fail('CALL_BUSY',409);
  try{await providerRequest(env,'CreateRoom',{name:room,max_participants:12,empty_timeout:60,departure_timeout:20,metadata:JSON.stringify({callId})});}catch(error){await finishCall(env,callId,'ended');throw error;}
  const current=await getCall(env,id,callId),own=current.participants.find(p=>p.userId===id);
  await assertSocialAllowed(env,id);
  const media=await connection(env,room,id,own?.name,own?.joinedAt);
  await afterCommit(context,()=>Promise.allSettled([notifyCall(env,callId,'ringing'),wakeJobs(env)]));
  return {call:current,connection:media};
}
export async function joinCall(env,id,callId,body,context){
  await assertSocialAllowed(env,id);
  if(!liveKitConfigured(env))fail('CALLS_UNAVAILABLE',503);const device=userId(body.deviceId);await sweepCalls(env,Date.now(),context);const c=await first(env,'SELECT * FROM social_calls WHERE id=?',userId(callId));if(!c||!['ringing','active'].includes(c.status))fail('CALL_UNAVAILABLE',409);await requireScope(env,id,c.scope,c.conversation_id);
  const old=await first(env,'SELECT * FROM social_call_participants WHERE call_id=? AND user_id=?',callId,id);if(old?.state==='active'&&old.device_id!==device)fail('CALL_ANSWERED',409);
  if(old?.revoked_before>Math.floor(Date.now()/1000))fail('CALL_RECONNECTING',409);
  if(await first(env,"SELECT 1 FROM social_jobs WHERE kind='lk_remove' AND json_extract(payload,'$.room')=?",c.room_name))fail('CALL_RECONNECTING',409);
  const now=Date.now(),guard=`EXISTS(SELECT 1 FROM social_calls c WHERE c.id=${ident(callId)} AND c.status IN ('ringing','active') AND c.expires_at>${now}) AND ${scopeAllowed(c.scope,ident(c.conversation_id),ident(id))} AND ${noMafiaMediaLeaseSql(ident(id),now)} AND ${noConflict(ident(callId),ident(id))} AND ${unblocked(ident(c.initiator_id),ident(id))} AND NOT EXISTS(SELECT 1 FROM social_call_participants x WHERE x.user_id=${ident(id)} AND x.state='active' AND x.call_id!=${ident(callId)}) ${c.scope==='direct'?`AND EXISTS(SELECT 1 FROM social_call_participants WHERE call_id=${ident(callId)} AND user_id=${ident(id)} AND (state='active' OR (state='invited' AND ${c.ring_until}>${now})))`:''}`;
  // A rejoin awaits a new provider SID. Delayed departure webhooks for the
  // previous connection must not terminate this newly authorized participation.
  const result=await env.DB.batch([stmt(env,`INSERT INTO social_call_participants(call_id,user_id,state,device_id,joined_at) SELECT ?,?,'active',?,? WHERE ${guard} ON CONFLICT(call_id,user_id) DO UPDATE SET state='active',device_id=excluded.device_id,provider_sid=CASE WHEN social_call_participants.state='active' THEN social_call_participants.provider_sid ELSE NULL END,joined_at=CASE WHEN social_call_participants.state='active' THEN social_call_participants.joined_at ELSE MAX(excluded.joined_at,COALESCE(social_call_participants.joined_at,0)+1) END,left_at=NULL WHERE social_call_participants.state!='active' OR social_call_participants.device_id=excluded.device_id`,callId,id,device,now),stmt(env,"UPDATE social_calls SET status='active',expires_at=? WHERE id=? AND status IN ('ringing','active') AND (SELECT COUNT(*) FROM social_call_participants WHERE call_id=? AND state='active')>=2",now+2*3600000,callId,callId)]);
  if(!changed(result[0]))fail('CALL_UNAVAILABLE',409);const current=await getCall(env,id,callId),own=current.participants.find(p=>p.userId===id);
  await assertSocialAllowed(env,id);
  const media=await connection(env,c.room_name,id,own?.name,own?.joinedAt);
  await afterCommit(context,()=>notifyCall(env,callId,'accepted'));
  return {call:current,connection:media};
}
export function removeParticipantStatements(env,c,id,now=Date.now(),guard='1') {
  return [stmt(env,`UPDATE social_call_participants SET state='left',left_at=? WHERE call_id=? AND user_id=? AND ${guard}`,now,c.id,id),
    job(env,`lk-remove-${c.id}-${id}-${now}`,'lk_remove',{room:c.room_name,identity:id},null,now,
      `EXISTS(SELECT 1 FROM social_call_participants WHERE call_id=${ident(c.id)} AND user_id=${ident(id)} AND state='left' AND left_at=${now}) AND ${guard}`)];
}
export async function finishCall(env,callId,status='ended',guard='1',{deferProvider=false,context}={}) {
  const c=await first(env,'SELECT * FROM social_calls WHERE id=?',callId);if(!c)return;
  const now=Date.now(),participants=await all(env,'SELECT user_id FROM social_call_participants WHERE call_id=?',callId);
  const result=await env.DB.batch([
    stmt(env,`UPDATE social_calls SET status=?,ended_at=? WHERE id=? AND status IN ('ringing','active') AND ${guard}`,status,now,callId),
    stmt(env,`UPDATE social_call_participants SET state='left',left_at=? WHERE call_id=? AND state IN ('invited','active') AND ${guard}`,now,callId),
    ...participants.map(p=>job(env,`lk-finish-remove-${callId}-${p.user_id}`,'lk_remove',{room:c.room_name,identity:p.user_id},null,now,guard)),
    job(env,`lk-delete-${callId}`,'lk_delete',{room:c.room_name},null,now,guard),
  ]);
  if(guard!=='1'&&!changed(result[0]))return;
  // Revocation and its retryable provider jobs are committed above. Opportunistic
  // expiry checks must not make a new call wait for unrelated LiveKit rooms to
  // disappear. Explicit leave/block operations keep their awaited cleanup path.
  const cleanup=async()=>{await wakeJobs(env);await notifyCall(env,callId,status);if(!deferProvider)await (await import('./jobs.mjs')).drainJobs(env,Date.now(),c.room_name);};
  if(typeof context?.waitUntil==='function')await afterCommit(context,cleanup);else await cleanup();
}
export async function callAction(env,id,callId,action,body={},options={}) {
  const c=await first(env,'SELECT * FROM social_calls WHERE id=?',userId(callId));if(!c)fail('NOT_FOUND',404);
  const own=await first(env,'SELECT * FROM social_call_participants WHERE call_id=? AND user_id=?',callId,id);if(!own)fail('NOT_FOUND',404);
  if(options.providerSid&&own.provider_sid!==options.providerSid)return {ok:true};
  // Optional for earlier clients. A supplied installation ID is checked again
  // inside every write so another device winning acceptance cannot be removed.
  const device=body.deviceId==null?null:userId(body.deviceId);
  if(device&&own.device_id&&own.device_id!==device)return {ok:true};
  const guard=(device?`EXISTS(SELECT 1 FROM social_call_participants claimed WHERE claimed.call_id=${ident(callId)} AND claimed.user_id=${ident(id)} AND (claimed.device_id IS NULL OR claimed.device_id=${ident(device)}))`:'1')+(options.providerSid?` AND EXISTS(SELECT 1 FROM social_call_participants current WHERE current.call_id=${ident(callId)} AND current.user_id=${ident(id)} AND current.provider_sid=${ident(options.providerSid)})`:'');
  if(action==='end') {
    await requireScope(env,id,c.scope,c.conversation_id);
    if(c.initiator_id!==id&&c.scope==='group'&&!await first(env,`SELECT 1 WHERE ${admin(ident(c.conversation_id),ident(id))}`))fail('NOT_FOUND',404);
    await finishCall(env,callId,'ended',guard,options);return {ok:true};
  }
  let result;
  if(action==='reject') result=await run(env,`UPDATE social_call_participants SET state='rejected',left_at=? WHERE call_id=? AND user_id=? AND state='invited' AND ${guard}`,Date.now(),callId,id);
  else [result]=await env.DB.batch(removeParticipantStatements(env,c,id,Date.now(),guard));
  if(!changed(result))return {ok:true};
  await wakeJobs(env);
  const counts=await first(env,"SELECT SUM(state='active') AS active,SUM(state='invited') AS invited FROM social_call_participants WHERE call_id=?",callId);
  if(!counts.active || c.scope==='direct'&&!counts.invited&&counts.active<2)await finishCall(env,callId,'ended','1',options);else await notifyCall(env,callId,action);
  if(!options.deferProvider)await (await import('./jobs.mjs')).drainJobs(env,Date.now(),c.room_name);return {ok:true};
}
export async function sweepCalls(env,now=Date.now(),context) {const rows=await all(env,"SELECT * FROM social_calls WHERE status IN ('ringing','active') AND (expires_at<=? OR NOT EXISTS(SELECT 1 FROM social_call_participants p WHERE p.call_id=social_calls.id AND p.state='active')) LIMIT 50",now);for(const c of rows){
  // Acceptance can renew a ringing call between the sweep read and its write.
  // Re-evaluate expiry inside the batch so that a late sweep cannot end it.
  const guard=`EXISTS(SELECT 1 FROM social_calls expired WHERE expired.id=${ident(c.id)} AND (expired.expires_at<=${Number(now)} OR NOT EXISTS(SELECT 1 FROM social_call_participants p WHERE p.call_id=expired.id AND p.state='active')))`;
  await finishCall(env,c.id,c.status==='ringing'?'missed':'ended',guard,{context});
}}
export async function revokeInvalidCalls(env,actorId=null,blockedId=null,{groupId,userIds}={}){
  const conditions=[],args=[];
  if(groupId){conditions.push("c.scope='group' AND c.conversation_id=?");args.push(userId(groupId));}
  const affected=[...new Set(userIds|| (actorId?[actorId]:[]))].map(userId);
  if(affected.length){conditions.push(`p.user_id IN (${affected.map(()=>'?').join(',')})`);args.push(...affected);}
  // Only scheduled maintenance uses the global sweep. A member action should
  // not wait on every unrelated LiveKit participant in the application.
  const rows=await all(env,`SELECT c.*,p.user_id FROM social_calls c JOIN social_call_participants p ON p.call_id=c.id WHERE c.status IN ('ringing','active') AND p.state='active'${conditions.length?' AND '+conditions.join(' AND '):''}`,...args);
  for(const c of rows){const allowed=await first(env,`SELECT 1 WHERE ${scopeAllowed(c.scope,ident(c.conversation_id),ident(c.user_id))}`);const blocked=actorId===c.user_id&&blockedId&&await first(env,"SELECT 1 FROM social_call_participants WHERE call_id=? AND user_id=? AND state='active'",c.id,blockedId);if(!allowed||blocked)await callAction(env,c.user_id,c.id,'leave');}
  await wakeJobs(env);
}

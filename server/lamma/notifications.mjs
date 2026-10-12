import { fail } from '../room-model.mjs';
import { signEs256 } from '../accounts/jwt.mjs';
import { userId } from '../social/model.mjs';
import { all, first, stmt, run, live, unblocked, friends, ident, scopeAllowed, requireScope, scopeOf } from './common.mjs';
function pushCredentials(env,environment) {
  if(!env.APPLE_BUNDLE_ID||!['production','sandbox'].includes(environment)) return null;
  const prefix=environment==='sandbox'?'APNS_SANDBOX_':'APNS_';
  const keyId=env[`${prefix}KEY_ID`],teamId=env[`${prefix}TEAM_ID`],privateKey=env[`${prefix}PRIVATE_KEY`];
  return keyId&&teamId&&privateKey?{keyId,teamId,privateKey}:null;
}
// The existing public capability describes production. Device registration
// reports its own environment; sandbox never borrows a production credential.
export const pushConfigured = (env,environment='production') => !!pushCredentials(env,environment);
export function job(env,id,kind,payload,user=null,now=Date.now(),condition='1') {
  return stmt(env,`INSERT OR IGNORE INTO social_jobs(id,kind,payload,user_id,created_at,due_at) SELECT ?,?,?,?,?,? WHERE ${condition}`,id,kind,JSON.stringify(payload),user,now,now);
}
export const pushJob = (env,key,user,payload,condition='1') => job(env,`push-${key}-${user}`,'push',payload,user,Date.now(),condition);
export async function wakeJobs(env) {
  if(env.SOCIAL_JOBS) try { await env.SOCIAL_JOBS.get(env.SOCIAL_JOBS.idFromName('lamma')).fetch(new Request('https://jobs.internal/wake',{method:'POST'})); } catch { /* cron retries durable jobs */ }
}
export async function preferences(env,id) {
  const r=await first(env,'SELECT * FROM social_preferences WHERE user_id=?',id);
  return {messages:r?!!r.messages:true,friendRequests:r?!!r.friend_requests:true,groupInvites:r?!!r.group_invites:true,calls:r?!!r.calls:true,previews:r?!!r.previews:false,sound:r?!!r.sound:true,
    mutedConversations:(await all(env,'SELECT scope,conversation_id AS conversationId FROM social_mutes WHERE user_id=?',id))};
}
export async function setPreferences(env,id,body) {
  const keys={messages:'messages',friendRequests:'friend_requests',groupInvites:'group_invites',calls:'calls',previews:'previews',sound:'sound'};
  if(Object.keys(body).some(k=>!(k in keys)&&k!=='mutedConversations')) fail('INVALID',400);
  for(const key of Object.keys(keys)) if(key in body && typeof body[key]!=='boolean') fail('INVALID',400);
  const current=await preferences(env,id), next={...current,...body};
  const statements=[stmt(env,`INSERT INTO social_preferences(user_id,messages,friend_requests,group_invites,calls,previews,sound) VALUES(?,?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET messages=excluded.messages,friend_requests=excluded.friend_requests,group_invites=excluded.group_invites,calls=excluded.calls,previews=excluded.previews,sound=excluded.sound`,id,...Object.keys(keys).map(k=>Number(next[k])))];
  if('mutedConversations' in body) {
    if(!Array.isArray(body.mutedConversations)||body.mutedConversations.length>100) fail('INVALID',400);
    statements.push(stmt(env,'DELETE FROM social_mutes WHERE user_id=?',id));
    for(const m of body.mutedConversations) {
      await requireScope(env,id,scopeOf(m.scope),userId(m.conversationId));
      statements.push(stmt(env,'INSERT OR IGNORE INTO social_mutes(user_id,scope,conversation_id) VALUES(?,?,?)',id,m.scope,m.conversationId));
    }
  }
  await env.DB.batch(statements); return preferences(env,id);
}
export async function registerDevice(env,id,sessionId,body) {
  const device=userId(body.deviceId), kind=body.kind, environment=body.environment==='development'?'sandbox':body.environment;
  if(!['apns','voip'].includes(kind)||!['sandbox','production'].includes(environment)||typeof body.token!=='string'||!/^[a-fA-F0-9]{32,512}$/.test(body.token)) fail('INVALID',400);
  if((await first(env,'SELECT COUNT(DISTINCT device_id) AS n FROM social_devices WHERE user_id=?',id)).n>=16 && !await first(env,'SELECT 1 FROM social_devices WHERE user_id=? AND device_id=?',id,device)) fail('RATE_LIMIT',429);
  await env.DB.batch([
    stmt(env,'DELETE FROM social_devices WHERE (token=? AND kind=? AND environment=? AND (user_id!=? OR device_id!=?)) OR (device_id=? AND user_id!=?)',body.token.toLowerCase(),kind,environment,id,device,device,id),
    stmt(env,`INSERT INTO social_devices(user_id,device_id,kind,environment,token,session_id,updated_at) SELECT ?,?,?,?,?,?,? WHERE ${live(ident(id))} ON CONFLICT(user_id,device_id,kind) DO UPDATE SET token=excluded.token,environment=excluded.environment,session_id=excluded.session_id,updated_at=excluded.updated_at WHERE COALESCE((SELECT created_at FROM sessions WHERE id=excluded.session_id),0)>=COALESCE((SELECT created_at FROM sessions WHERE id=social_devices.session_id),0)`,id,device,kind,environment,body.token.toLowerCase(),sessionId,Date.now()),
  ]);
  return {ok:true,configured:pushConfigured(env,environment)};
}
export const deleteDevice = (env,id,device) => run(env,'DELETE FROM social_devices WHERE user_id=? AND device_id=?',id,userId(device));
async function eligible(env,id,p) {
  const u=ident(id), actor=ident(p.actorId);
  if(!await first(env,`SELECT 1 WHERE ${live(u)} AND ${live(actor)} AND ${unblocked(u,actor)}`)) return false;
  if(p.category==='friendRequests') return !!await first(env,`SELECT 1 FROM social_friendships WHERE id=? AND requester_id=? AND status='pending' AND (user_low=? OR user_high=?)`,p.requestId,p.actorId,id,id);
  if(p.category==='groupInvites') return !!await first(env,`SELECT 1 FROM social_group_invites i WHERE i.id=? AND i.user_id=? AND i.status='pending' AND i.expires_at>? AND ${friends('i.inviter_id','i.user_id')} AND NOT EXISTS(SELECT 1 FROM social_group_members m WHERE m.group_id=i.group_id AND m.left_at IS NULL AND NOT (${unblocked('m.user_id',u)}))`,p.inviteId,id,Date.now());
  if(!['direct','group'].includes(p.scope)||!await first(env,`SELECT 1 WHERE ${scopeAllowed(p.scope,ident(p.conversationId),u)}`)) return false;
  if(p.clientId&&!p.messageSeq){const row=await first(env,`SELECT seq FROM ${p.scope==='group'?'social_group_messages':'social_messages'} WHERE sender_id=? AND client_id=? AND deleted_at IS NULL`,p.actorId,p.clientId);if(!row)return false;p.messageSeq=row.seq;}
  if(p.category==='calls') return !!await first(env,`SELECT 1 FROM social_calls c JOIN social_call_participants cp ON cp.call_id=c.id WHERE c.id=? AND c.status IN ('ringing','active') AND c.expires_at>? AND cp.user_id=? AND cp.state='invited' AND NOT EXISTS(SELECT 1 FROM social_call_participants a WHERE a.call_id=c.id AND a.state='active' AND NOT (${unblocked('a.user_id',u)}))`,p.callId,Date.now(),id);
  if(p.messageSeq) {
    if(p.scope==='group') return !!await first(env,`SELECT 1 FROM social_group_messages m JOIN social_group_members gm ON gm.group_id=m.group_id AND gm.user_id=? WHERE m.seq=? AND m.group_id=? AND m.deleted_at IS NULL AND m.seq>gm.visible_after_seq AND m.seq>gm.read_seq`,id,p.messageSeq,p.conversationId);
    return !!await first(env,'SELECT 1 FROM social_messages m WHERE m.seq=? AND m.conversation_id=? AND m.deleted_at IS NULL AND m.seq>COALESCE((SELECT last_read_seq FROM social_reads WHERE conversation_id=m.conversation_id AND user_id=?),0)',p.messageSeq,p.conversationId,id);
  }
  return true;
}
export async function deliverPush(env,row) {
  const p=JSON.parse(row.payload), id=row.user_id;
  if(!await eligible(env,id,p)) return 'done';
  let pref=await preferences(env,id);
  if(!pref[p.category]||pref.mutedConversations.some(m=>m.scope===p.scope&&m.conversationId===p.conversationId)) return 'done';
  const voip=p.category==='calls'&&p.scope==='direct';
  const devices=await all(env,`SELECT d.* FROM social_devices d JOIN sessions s ON s.id=d.session_id AND s.user_id=d.user_id WHERE d.user_id=? AND d.kind=? AND s.expires_at>? AND (s.revoked_at IS NULL OR s.revoked_at>?)`,id,voip?'voip':'apns',Date.now(),Date.now());
  const authorizations=new Map();
  let failed=false;
  for(const d of devices) {
    const credentials=pushCredentials(env,d.environment);
    // Absent configuration is unavailable, not a transient provider failure.
    // Keep the registration for future events, without replaying this old event.
    if(!credentials) continue;
    let auth=authorizations.get(d.environment);
    if(!auth) {
      try { auth=await signEs256({kid:credentials.keyId},{iss:credentials.teamId,iat:Math.floor(Date.now()/1000)},credentials.privateKey); }
      catch { failed=true;continue; }
      authorizations.set(d.environment,auth);
    }
    // Recheck after provider work: a queued event cannot bypass a recent block.
    if(!await eligible(env,id,p)) return 'done';
    pref=await preferences(env,id);
    if(!pref[p.category]||pref.mutedConversations.some(m=>m.scope===p.scope&&m.conversationId===p.conversationId))return 'done';
    if(!await first(env,'SELECT 1 FROM social_devices d JOIN sessions s ON s.id=d.session_id AND s.user_id=d.user_id WHERE d.user_id=? AND d.device_id=? AND d.kind=? AND d.environment=? AND d.token=? AND s.expires_at>? AND (s.revoked_at IS NULL OR s.revoked_at>?)',id,d.device_id,d.kind,d.environment,d.token,Date.now(),Date.now()))continue;
    let preview=null;
    if(pref.previews&&p.category==='messages'&&p.messageSeq){const m=await first(env,`SELECT kind,text FROM ${p.scope==='group'?'social_group_messages':'social_messages'} WHERE seq=? AND deleted_at IS NULL`,p.messageSeq);if(m?.kind==='text')preview=Array.from(m.text).slice(0,100).join('');}
    const body=voip?{aps:{},recipientId:id,callId:p.callId,scope:p.scope,conversationId:p.conversationId,callerName:'مكالمة ميدان',expiresAt:p.expiresAt}:{aps:{alert:{title:'ميدان',body:preview||(p.category==='calls'?'انضم للمكالمة الجماعية':p.category==='friendRequests'?'وصلك طلب صداقة':p.category==='groupInvites'?'وصلتك دعوة للمة':'وصلتك رسالة جديدة')},...(pref.sound?{sound:'default'}:{})},recipientId:id,eventId:row.id,category:p.category,scope:p.scope,conversationId:p.category==='groupInvites'?undefined:p.conversationId,groupId:p.scope==='group'?p.conversationId:undefined,requestId:p.requestId,callId:p.callId};
    let response;
    try { response=await fetch(`https://${d.environment==='sandbox'?'api.sandbox.push.apple.com':'api.push.apple.com'}/3/device/${d.token}`,{method:'POST',headers:{authorization:`bearer ${auth}`,'apns-topic':`${env.APPLE_BUNDLE_ID}${voip?'.voip':''}`,'apns-push-type':voip?'voip':'alert','apns-priority':'10','apns-expiration':voip?'0':String(Math.floor((row.created_at+86400000)/1000)),'apns-collapse-id':row.id.slice(-64),'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(10000)}); }
    catch { failed=true;continue; }
    if(response.status===410 || response.status===400 && ['BadDeviceToken','DeviceTokenNotForTopic'].includes((await response.json().catch(()=>({}))).reason)) await run(env,'DELETE FROM social_devices WHERE user_id=? AND device_id=? AND kind=? AND environment=? AND token=?',id,d.device_id,d.kind,d.environment,d.token);
    else if(!response.ok) failed=true;
  }
  return failed?'retry':'done';
}

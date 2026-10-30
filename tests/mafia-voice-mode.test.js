import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { startLocalServer } from '../server/local.mjs';
import { createUser } from '../server/accounts/db.mjs';
import { issueSession } from '../server/accounts/session.mjs';
import { newCredentials, RoomClient } from '../src/online/client.js';
import { MAFIA_PROTOCOL } from '../src/online/shared.js';
import { first,run } from '../server/lamma/common.mjs';
import { decodeJws } from '../server/accounts/jwt.mjs';
import { tick } from '../server/mafia-model.mjs';
const origin='http://localhost:3000';
class Socket extends WebSocket {constructor(url){super(url,{origin});}}
const until=async fn=>{for(let n=0;n<300;n++){if(fn())return;await new Promise(r=>setTimeout(r,10));}assert.fail('state timeout');};
async function setup(t,{provider=true}={}) {
  const app=await startLocalServer({port:0,vars:{MAFIA_ENABLED:'1',LIVEKIT_URL:provider?'wss://voice-mode-tests.livekit.cloud':'',LIVEKIT_API_KEY:provider?'fixture':'',LIVEKIT_API_SECRET:provider?'fixture-secret':'',MAFIA_MAX_ACTIVE_ROOMS:'1'}});
  const clients=[],calls=[],realFetch=globalThis.fetch;
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    if(String(url).includes('voice-mode-tests.livekit.cloud')){calls.push({method:new URL(url).pathname.split('/').at(-1),body:JSON.parse(options.body)});return Response.json({});}
    return realFetch(url,options);
  });
  t.after(async()=>{clients.forEach(c=>c.stop());await app.close();});
  const api=async(p,path,body)=>{const r=await fetch(app.url+path,{method:'POST',headers:{origin,authorization:`Bearer ${p.authorization}`,'content-type':'application/json'},body:JSON.stringify(body)});return {status:r.status,body:await r.json()};};
  async function group(voiceMode,count=6) {
    const people=[];for(let n=0;n<count;n++){const u=await createUser(app.env,{name:`اختبار ${n}`,email:`${crypto.randomUUID()}@example.test`}),s=await issueSession(app.env,u.id);people.push({...newCredentials(),accountId:u.id,authorization:s.token,name:u.name,avatar:0,game:'mafia',capabilities:{mafia:MAFIA_PROTOCOL},settings:{mode:'classic',capacity:6,visibility:'public',voiceMode}});}
    const created=await api(people[0],'/api/rooms',people[0]);assert.equal(created.status,201,JSON.stringify(created));const code=created.body.code;
    for(const p of people.slice(1))assert.equal((await api(p,`/api/rooms/${code}/join`,p)).status,200);
    const own=[];for(const p of people){const c=new RoomClient({server:app.url,code,session:{id:p.id,token:p.token},getAccountAuthorization:()=>`Bearer ${p.authorization}`,WebSocketImpl:Socket});clients.push(c);own.push(c);c.start();}
    await until(()=>own.every(c=>c.state?.members.filter(m=>m.connected).length===count));
    for(const c of own.slice(1))await c.command('ready',{ready:true});
    return {people,clients:own,code};
  }
  const voice=(g,n=0,extra={})=>api(g.people[n],`/api/rooms/${g.code}/voice`,{operation:'join',deviceId:`phone-${n}`,voiceSessionId:`session-${n}-fixture`,...extra});
  return {app,calls,api,group,voice};
}

test('text-only match needs no provider or media slot but retains account privacy lock',async t=>{
  const h=await setup(t,{provider:false}),g=await h.group('off');
  const item=h.app.rooms.get(g.code);
  // A cold lobby may retain the previous match's renewal hint in its durable
  // snapshot, even though post-commit cleanup already released the D1 rows.
  item.instance.room.mafiaPrivacyRenewAt=Date.now()+30000;item.instance.room.mafiaPrivacyMatchId=0;
  await g.clients[0].command('start');await until(()=>g.clients.every(c=>c.state.phase==='role'));
  assert.equal((await first(h.app.env,'SELECT COUNT(*) AS n FROM mafia_match_leases')).n,6);
  assert.equal((await first(h.app.env,'SELECT COUNT(*) AS n FROM mafia_media_slots')).n,0);
  assert.equal((await first(h.app.env,'SELECT COUNT(*) AS n FROM mafia_media_leases')).n,0);
  assert.equal((await h.voice(g)).body.error,'CALL_UNAVAILABLE');assert.equal(h.calls.length,0);
  assert.equal((await h.api(g.people[0],'/api/social/conversations/fake/messages',{text:'side channel',clientId:crypto.randomUUID()})).body.error,'MAFIA_SOCIAL_LOCKED');
});

test('optional lobby reserves on join, revokes old channel before roles and keeps one logical call',async t=>{
  const h=await setup(t),g=await h.group('optional');
  assert.equal((await first(h.app.env,'SELECT COUNT(*) AS n FROM mafia_media_slots')).n,0);
  const a=await h.voice(g);assert.equal(a.status,200,JSON.stringify(a));const old=decodeJws(a.body.connection.token).payload.video.room;
  assert.equal((await first(h.app.env,'SELECT COUNT(*) AS n FROM mafia_media_slots')).n,1);
  await g.clients[0].command('start');await until(()=>g.clients[0].state.phase==='role');
  assert.ok(h.calls.some(c=>c.method==='RemoveParticipant'&&c.body.room===old));
  const role=await h.voice(g,0,{operation:'sync'});assert.equal(role.status,200,JSON.stringify(role));assert.equal(role.body.call.id,a.body.call.id);assert.equal(role.body.quiet,true);assert.equal(role.body.connection,null);
  const item=h.app.rooms.get(g.code);await item.instance.serial(async()=>{const r=structuredClone(item.instance.room);r.deadlineAt=Date.now()-1;tick(r,Date.now());await item.instance.commit(r);});
  const day=await h.voice(g,0,{operation:'sync'});assert.equal(day.status,200,JSON.stringify(day));assert.notEqual(decodeJws(day.body.connection.token).payload.video.room,old);
});

test('lobby voice capacity is shared and disabling voice securely releases the slot',async t=>{
  const h=await setup(t),one=await h.group('optional',1),two=await h.group('optional',1);
  const a=await h.voice(one);assert.equal(a.status,200,JSON.stringify(a));
  const denied=await h.voice(two);assert.equal(denied.body.error,'MAFIA_VOICE_CAPACITY');
  assert.equal(h.app.rooms.get(two.code).instance.room.mafiaMedia,undefined,'a rejected bootstrap does not enroll or allocate a live call');
  await two.clients[0].command('chat',{channel:'public',text:'جاهز للعب',clientId:'capacity-denied-text'});
  await one.clients[0].command('settings',{settings:{...one.clients[0].state.settings,voiceMode:'off'}});
  assert.ok(h.calls.some(c=>c.method==='RemoveParticipant'));
  assert.equal((await first(h.app.env,'SELECT COUNT(*) AS n FROM mafia_media_slots')).n,0);
  assert.equal((await h.voice(one)).body.error,'CALL_UNAVAILABLE');
  await one.clients[0].command('settings',{settings:{...one.clients[0].state.settings,voiceMode:'optional'}});
  assert.equal((await first(h.app.env,'SELECT COUNT(*) AS n FROM mafia_media_slots')).n,0,'re-enabling the option requires a new join gesture before reserving voice');
  const retry=await h.voice(two);assert.equal(retry.status,200,JSON.stringify(retry));
  assert.equal(two.clients[0].state.settings.voiceMode,'optional');
});

test('resizing an active lobby must reserve its full new capacity and leave old settings on rejection',async t=>{
  const h=await setup(t);Object.assign(h.app.env,{MAFIA_MAX_ACTIVE_ROOMS:'2',MAFIA_MAX_VOICE_PARTICIPANTS:'12'});
  const one=await h.group('optional',1),two=await h.group('optional',1);
  assert.equal((await h.voice(one)).status,200);assert.equal((await h.voice(two)).status,200);
  await assert.rejects(one.clients[0].command('settings',{settings:{...one.clients[0].state.settings,capacity:8}}),{code:'MAFIA_VOICE_CAPACITY'});
  assert.equal(h.app.rooms.get(one.code).instance.room.settings.capacity,6);
  assert.equal((await first(h.app.env,'SELECT SUM(capacity) AS n FROM mafia_media_slots')).n,12);
});

test('retired lobby gestures cannot allocate capacity or reconnect after leaving',async t=>{
  const h=await setup(t),g=await h.group('optional',1),joined=await h.voice(g);
  assert.equal(joined.status,200);
  assert.equal((await h.voice(g,0,{operation:'leave',callId:joined.body.call.id})).status,200);
  const before=h.calls.length;
  assert.equal((await h.voice(g)).body.error,'MAFIA_VOICE_SESSION');
  assert.equal(h.calls.length,before);assert.equal((await first(h.app.env,'SELECT COUNT(*) AS n FROM mafia_media_slots')).n,0);
  assert.equal((await h.voice(g,0,{voiceSessionId:'replacement-session',callId:'old-other-call'})).body.error,'STALE');
  assert.equal((await first(h.app.env,'SELECT COUNT(*) AS n FROM mafia_media_slots')).n,0);
});

test('text-only failed social revocation retains ownership after abort until provider confirmation',async t=>{
  const h=await setup(t,{provider:false}),g=await h.group('off'),now=Date.now(),callId=crypto.randomUUID();
  await run(h.app.env,"INSERT INTO social_calls(id,scope,conversation_id,initiator_id,client_id,status,created_at,ring_until,expires_at,room_name) VALUES(?,'group','group-fixture',?,?,'active',?,?,?,'previous-social-room')",callId,g.people[0].accountId,crypto.randomUUID(),now,now+45000,now+3600000);
  await run(h.app.env,"INSERT INTO social_call_participants(call_id,user_id,state,device_id,joined_at) VALUES(?,?,'active','social-phone',?)",callId,g.people[0].accountId,now);
  await g.clients[0].command('start');
  const item=h.app.rooms.get(g.code);
  assert.equal(item.instance.room.phase,'over');assert.equal(item.instance.room.reason,'voice_unavailable');
  assert.ok(await item.storage.get('mafia:voice-transition'));
  assert.equal((await first(h.app.env,'SELECT COUNT(*) AS n FROM mafia_media_slots')).n,0,'revoking an existing connection does not allocate voice capacity');
  const lease=await first(h.app.env,'SELECT expires_at FROM mafia_media_leases WHERE user_id=?',g.people[0].accountId);
  assert.ok(lease.expires_at>now+86400000,'actual unrevoked media survives short privacy expiry and aborted start');
  const another=await h.api(g.people[0],'/api/rooms',{...g.people[0],...newCredentials()});
  assert.equal(another.body.error,'MAFIA_ACTIVE_ELSEWHERE');
  assert.equal((await h.api(g.people[0],'/api/social/messages',{text:'unsafe'})).body.error,'MAFIA_SOCIAL_LOCKED');
  Object.assign(h.app.env,{LIVEKIT_URL:'wss://voice-mode-tests.livekit.cloud',LIVEKIT_API_KEY:'fixture',LIVEKIT_API_SECRET:'fixture-secret'});
  await item.instance.serial(()=>item.instance.commit(structuredClone(item.instance.room)));
  assert.equal(await item.storage.get('mafia:voice-transition'),null);
  assert.equal(await first(h.app.env,'SELECT 1 FROM mafia_media_leases WHERE user_id=?',g.people[0].accountId),null);
  assert.equal((await first(h.app.env,'SELECT COUNT(*) AS n FROM mafia_match_leases')).n,0);
});

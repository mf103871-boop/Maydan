import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { startLocalServer } from '../server/local.mjs';
import { createUser } from '../server/accounts/db.mjs';
import { issueSession } from '../server/accounts/session.mjs';
import { newCredentials,RoomClient } from '../src/online/client.js';
import { decodeJws } from '../server/accounts/jwt.mjs';
import { tick,technicalAbort } from '../server/mafia-model.mjs';
import { first,run } from '../server/lamma/common.mjs';
import { mafiaDeleteStatements, persistMafiaResult } from '../server/mafia-results.mjs';
const ORIGIN='http://localhost:3000';
class BrowserSocket extends WebSocket {constructor(url){super(url,{origin:ORIGIN});}}
async function until(fn,label='state'){const end=Date.now()+5000;while(Date.now()<end){if(await fn())return;await new Promise(r=>setTimeout(r,10));}assert.fail(`Timed out ${label}`);}
async function setup(t,{enabled=true}={}) {
  const app=await startLocalServer({port:0,vars:{MAFIA_ENABLED:enabled?'1':'0',LIVEKIT_URL:'wss://mafia-tests.livekit.cloud',LIVEKIT_API_KEY:'fixture-key',LIVEKIT_API_SECRET:'fixture-secret'}});
  const clients=[],provider=[],nativeFetch=globalThis.fetch;let failRemovals=false;
  t.mock.method(globalThis,'fetch',async(url,options)=>{if(String(url).includes('mafia-tests.livekit.cloud')){const body=JSON.parse(options.body);provider.push({method:new URL(url).pathname.split('/').at(-1),body});return Response.json({}, {status:failRemovals&&String(url).endsWith('/RemoveParticipant')?503:200});}return nativeFetch(url,options);});
  t.after(async()=>{clients.forEach(c=>c.stop());await app.close();});
  async function user(n){const u=await createUser(app.env,{name:`لاعب ${n}`,email:`${crypto.randomUUID()}@example.test`}),s=await issueSession(app.env,u.id);return {...newCredentials(),accountId:u.id,authorization:s.token,name:u.name,avatar:n%4,game:'mafia',capabilities:{mafia:1},settings:{mode:'classic',capacity:8,visibility:'public'}};}
  async function api(p,path,body,method=body===undefined?'GET':'POST'){if(path.endsWith('/voice')&&body)body={voiceSessionId:`fixture-${body.deviceId}`,operation:'join',...body};const r=await fetch(app.url+path,{method,headers:{origin:ORIGIN,...(p?.authorization?{authorization:`Bearer ${p.authorization}`}:{ }),...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:r.status,body:await r.json()};}
  async function group(count=6){const people=[];for(let n=0;n<count;n++)people.push(await user(n));if(count>=9)people[0].settings={mode:'shadow',capacity:count,visibility:'public'};
    const created=await api(people[0],'/api/rooms',people[0]);assert.equal(created.status,201,JSON.stringify(created));const code=created.body.code;
    for(const p of people.slice(1))assert.equal((await api(p,`/api/rooms/${code}/join`,p)).status,200);
    for(const p of people){const c=new RoomClient({server:app.url,code,session:{id:p.id,token:p.token},getAccountAuthorization:()=>`Bearer ${p.authorization}`,WebSocketImpl:BrowserSocket});clients.push(c);c.start();}
    await until(()=>clients.every(c=>c.state?.members.filter(m=>m.connected).length===count),'all authenticated');
    for(const c of clients.slice(1))await c.command('ready',{ready:true});
    return {people,code,clients};
  }
  async function phase(code){const item=app.rooms.get(code);await item.instance.serial(async()=>{const r=structuredClone(item.instance.room);r.deadlineAt=Date.now()-1;tick(r,Date.now());await item.instance.commit(r);});return item.instance.room;}
  return {app,api,user,group,phase,clients,provider,failRemovals:(value=true)=>{failRemovals=value;}};
}
test('Mafia feature and account capability gates allocate no unauthorized seats',async t=>{
  const h=await setup(t,{enabled:false}),p=await h.user(0);
  assert.equal((await h.api(p,'/api/rooms',p)).body.error,'MAFIA_DISABLED');assert.equal(h.app.rooms.size,0);
  h.app.env.MAFIA_ENABLED='1';assert.equal((await h.api(p,'/api/rooms',{...p,capabilities:{}})).body.error,'UPDATE_REQUIRED');
  assert.equal((await h.api(null,'/api/rooms',p)).status,401);assert.equal(h.app.rooms.size,0);
  const created=await h.api(p,'/api/rooms',p);assert.equal(created.status,201,JSON.stringify(created));
  const stranger=await h.user(1);assert.equal((await h.api(null,`/api/rooms/${created.body.code}/join`,stranger)).body.error,'AUTH_REQUIRED');
  assert.equal(h.app.rooms.get(created.body.code).instance.room.members.length,1);
});
test('public matchmaking fills existing rooms, deduplicates retries and excludes blocked accounts',async t=>{
  const h=await setup(t),host=await h.user(0),guest=await h.user(1);
  assert.equal((await h.api(guest,'/api/matchmaking/join',guest)).body.error,'MAFIA_NO_ROOMS');
  const create=await h.api(host,'/api/rooms',host),code=create.body.code;
  const list=await h.api(guest,'/api/rooms/public?game=mafia');assert.equal(list.body.rooms[0].code,code);assert.equal(JSON.stringify(list).includes(host.accountId),false);
  const join=await h.api(guest,'/api/matchmaking/join',guest);assert.equal(join.status,200,JSON.stringify(join));
  assert.equal((await h.api(guest,'/api/matchmaking/join',guest)).body.code,code);assert.equal(h.app.rooms.get(code).instance.room.members.length,2);
  assert.equal((await h.api(guest,'/api/rooms',{...guest,...newCredentials()})).body.error,'MAFIA_ACTIVE_ELSEWHERE');
  const blocked=await h.user(2);await run(h.app.env,'INSERT INTO social_blocks(blocker_id,blocked_id,created_at) VALUES(?,?,?)',blocked.accountId,host.accountId,Date.now());
  assert.equal((await h.api(blocked,`/api/rooms/${code}/join`,blocked)).body.error,'MAFIA_BLOCKED');
  assert.equal((await first(h.app.env,'SELECT COUNT(*) AS n FROM trials')).n,0);
});
test('real six-client socket game keeps private actions private, isolates voice phases and fences devices',async t=>{
  const h=await setup(t),g=await h.group();await g.clients[0].command('start');await until(()=>g.clients.every(c=>c.state.phase==='role'));
  assert.equal((await first(h.app.env,"SELECT COUNT(*) AS n FROM trials WHERE game='mafia'")).n,1);
  await h.phase(g.code);await until(()=>g.clients.every(c=>c.state.phase==='opening'));
  const a=await h.api(g.people[0],`/api/rooms/${g.code}/voice`,{deviceId:'phone-a',operation:'join'});assert.equal(a.status,200,JSON.stringify(a));
  const grant=decodeJws(a.body.connection.token).payload;assert.equal(grant.video.canPublishData,false);assert.equal(grant.exp-grant.iat,300);assert.equal(grant.metadata,undefined);assert.match(grant.video.room,/^g-[a-f0-9-]+$/);
  assert.equal((await h.api(g.people[0],`/api/rooms/${g.code}/voice`,{deviceId:'phone-b',knownEpoch:a.body.mediaEpoch})).body.error,'MAFIA_VOICE_DEVICE');
  const refreshed=await h.api(g.people[0],`/api/rooms/${g.code}/voice`,{deviceId:'phone-a'});assert.equal(refreshed.status,200);
  await h.phase(g.code);await until(()=>g.clients.every(c=>c.state.phase==='night'));
  assert.ok(h.provider.some(p=>p.method==='RemoveParticipant'&&p.body.room===grant.video.room&&p.body.revoke_token_ts>=Math.floor(Date.now()/1000)));
  const room=h.app.rooms.get(g.code).instance.room,mafia=room.participants.find(id=>room.roleStates[id].faction==='mafia'),town=room.participants.find(id=>room.roleStates[id].faction==='town');
  const mi=g.people.findIndex(p=>p.id===mafia),ti=g.people.findIndex(p=>p.id===town),before=g.clients[ti].state;
  const muted=await h.api(g.people[ti],`/api/rooms/${g.code}/voice`,{deviceId:ti===0?'phone-a':'town-phone'});assert.equal(muted.body.quiet,true);assert.equal(muted.body.connection,null);
  await g.clients[mi].command('chat',{channel:'team',text:'خطة سرية',clientId:crypto.randomUUID()});await new Promise(r=>setTimeout(r,80));
  assert.strictEqual(g.clients[ti].state,before,'no empty state event reveals secret chat activity');
  assert.equal(JSON.stringify(g.clients[ti].state).includes('خطة سرية'),false);
  const secret=await h.api(g.people[mi],`/api/rooms/${g.code}/voice`,{deviceId:mi===0?'phone-a':'mafia-phone'});assert.equal(secret.status,200);assert.notEqual(decodeJws(secret.body.connection.token).payload.video.room,grant.video.room);
  assert.equal((await h.api(g.people[mi],`/api/rooms/${g.code}/voice`,{deviceId:mi===0?'phone-a':'mafia-phone',operation:'leave',callId:'old-match'})).body.error,'STALE');
  const send=await h.api(g.people[ti],'/api/social/conversations/fake/messages',{text:'side channel',clientId:crypto.randomUUID()});assert.equal(send.body.error,'MAFIA_SOCIAL_LOCKED');
});
test('failed provider revocation aborts without next secret grants and refunds only the room trial',async t=>{
  const h=await setup(t),g=await h.group();await g.clients[0].command('start');await h.phase(g.code);
  const call=await h.api(g.people[0],`/api/rooms/${g.code}/voice`,{deviceId:'phone-a'});assert.equal(call.status,200);
  const before=h.provider.filter(p=>p.method==='CreateRoom').length;h.failRemovals();await h.phase(g.code);
  const room=h.app.rooms.get(g.code).instance.room;assert.equal(room.phase,'over');assert.equal(room.technicalAbort,true);assert.equal(room.mafiaMedia.failed,true);
  assert.equal(h.provider.filter(p=>p.method==='CreateRoom').length,before);
  assert.equal((await first(h.app.env,"SELECT COUNT(*) AS n FROM trials WHERE game='mafia'")).n,0);
  assert.equal((await h.api(g.people[0],`/api/rooms/${g.code}/voice`,{deviceId:'phone-a'})).body.error,'CALL_UNAVAILABLE');
  assert.equal((await first(h.app.env,'SELECT COUNT(*) AS n FROM mafia_results')).n,0);
});
test('feature disable stops new starts but an existing match advances; report sees only viewer evidence',async t=>{
  const h=await setup(t),g=await h.group();await g.clients[0].command('start');h.app.env.MAFIA_ENABLED='0';await h.phase(g.code);
  await until(()=>g.clients.every(c=>c.state.phase==='opening'));
  assert.equal(h.app.rooms.get(g.code).instance.room.phase,'opening');
  await g.clients[1].command('chat',{channel:'public',text:'رسالة للنقاش',clientId:crypto.randomUUID()});
  const result=await h.api(g.people[0],`/api/rooms/${g.code}/mafia-report`,{clientId:crypto.randomUUID(),matchId:1,targetId:g.people[1].id,reason:'إزعاج'});assert.equal(result.status,200,JSON.stringify(result));
  const saved=await first(h.app.env,'SELECT evidence FROM mafia_reports');assert.equal(saved.evidence.includes('roleStates'),false);assert.equal(saved.evidence.includes('رسالة للنقاش'),true);
  const block=await h.api(g.people[0],`/api/rooms/${g.code}/mafia-block`,{targetId:g.people[1].id});assert.equal(block.status,200);assert.equal(h.app.rooms.get(g.code).instance.room.members.find(m=>m.id===g.people[0].id).left,true);assert.equal(h.app.rooms.get(g.code).instance.room.members.find(m=>m.id===g.people[1].id).left,false);
});
test('twelve real clients have distinct private faction channels and no citizen or spectator grants at night',async t=>{
  const h=await setup(t),g=await h.group(12);await g.clients[0].command('start');await h.phase(g.code);
  for(let i=0;i<g.people.length;i++)assert.equal((await h.api(g.people[i],`/api/rooms/${g.code}/voice`,{deviceId:`phone-${i}`})).status,200);
  const publicRooms=new Set(h.app.rooms.get(g.code).instance.room.mafiaMedia.issued.map(i=>i.room));assert.equal(publicRooms.size,1);
  await h.phase(g.code);await until(()=>g.clients.every(c=>c.state.phase==='night'));
  const room=h.app.rooms.get(g.code).instance.room,channels=new Map();
  for(let i=0;i<g.people.length;i++){
    const p=g.people[i],faction=room.roleStates[p.id].faction,response=await h.api(p,`/api/rooms/${g.code}/voice`,{deviceId:`phone-${i}`});assert.equal(response.status,200);
    if(faction==='town'){assert.equal(response.body.quiet,true);assert.equal(response.body.connection,null);assert.deepEqual(response.body.call.participants,[]);}
    else {const channel=decodeJws(response.body.connection.token).payload.video.room;if(channels.has(faction))assert.equal(channels.get(faction),channel);channels.set(faction,channel);assert.equal(publicRooms.has(channel),false);for(const member of response.body.call.participants){const account=g.people.find(p=>p.accountId===member.userId);assert.equal(room.roleStates[account.id].faction,faction);}}
  }
  assert.equal(channels.size,2);assert.notEqual(channels.get('mafia'),channels.get('shadow'));
  const outsider=await h.user(99);assert.equal((await h.api(outsider,`/api/rooms/${g.code}/voice`,{deviceId:'outside'})).status,404);
  assert.equal(h.provider.filter(p=>p.method==='RemoveParticipant').length,12);
});
test('generic social blocking leaves an active peer through the same provider revocation barrier',async t=>{
  const h=await setup(t),g=await h.group(),outside=await h.user(99);await g.clients[0].command('start');await h.phase(g.code);
  const voice=await h.api(g.people[0],`/api/rooms/${g.code}/voice`,{deviceId:'phone-a'});assert.equal(voice.status,200);
  const unrelated=await h.api(g.people[0],'/api/social/blocks',{userId:outside.accountId});assert.equal(unrelated.status,200);assert.equal(unrelated.body.gameLeft,undefined);
  const blocked=await h.api(g.people[0],'/api/social/blocks',{userId:g.people[1].accountId});assert.equal(blocked.status,200);assert.equal(blocked.body.gameLeft,true);
  const room=h.app.rooms.get(g.code).instance.room;assert.equal(room.members.find(m=>m.id===g.people[0].id).left,true);assert.equal(room.members.find(m=>m.id===g.people[1].id).left,false);
  assert.ok(h.provider.some(p=>p.method==='RemoveParticipant'&&p.body.identity===g.people[0].accountId));assert.equal(await first(h.app.env,'SELECT 1 FROM mafia_media_leases WHERE user_id=?',g.people[0].accountId),null);
});
test('journal failure precedes social mutations, and a retry removes only playing participants',async t=>{
  const h=await setup(t),g=await h.group(),other=await h.user(88),callId=crypto.randomUUID(),now=Date.now();
  await run(h.app.env,"INSERT INTO social_calls(id,scope,conversation_id,initiator_id,client_id,status,created_at,ring_until,expires_at,room_name) VALUES(?,'group','group-fixture',?,?,'active',?,?,?,'social-fixture-room')",callId,g.people[0].accountId,crypto.randomUUID(),now,now+45000,now+3600000);
  for(const id of [g.people[0].accountId,other.accountId])await run(h.app.env,"INSERT INTO social_call_participants(call_id,user_id,state,device_id,joined_at) VALUES(?,?,'active','social-phone',?)",callId,id,now);
  const item=h.app.rooms.get(g.code),original=item.storage.put.bind(item.storage);let failed=false;
  t.mock.method(item.storage,'put',async(key,value)=>{if(key==='mafia:voice-transition'&&!failed){failed=true;throw new Error('injected journal outage');}return original(key,value);});
  await assert.rejects(g.clients[0].command('start'),e=>e.code==='INTERNAL');
  assert.equal((await first(h.app.env,'SELECT state FROM social_call_participants WHERE call_id=? AND user_id=?',callId,g.people[0].accountId)).state,'active');
  assert.equal(h.provider.filter(p=>p.method==='RemoveParticipant').length,0);
  await g.clients[0].command('start');
  assert.equal((await first(h.app.env,'SELECT state FROM social_call_participants WHERE call_id=? AND user_id=?',callId,g.people[0].accountId)).state,'left');
  assert.equal((await first(h.app.env,'SELECT state FROM social_call_participants WHERE call_id=? AND user_id=?',callId,other.accountId)).state,'active');
  assert.equal(h.provider.filter(p=>p.method==='RemoveParticipant'&&p.body.identity===other.accountId).length,0);
});
test('revocation outage retains a fail-closed room slot until the durable retry succeeds',async t=>{
  const h=await setup(t),g=await h.group();await g.clients[0].command('start');await h.phase(g.code);
  await h.api(g.people[0],`/api/rooms/${g.code}/voice`,{deviceId:'phone'});h.failRemovals();await h.phase(g.code);
  const item=h.app.rooms.get(g.code);assert.ok(await item.storage.get('mafia:voice-transition'));
  assert.equal((await first(h.app.env,'SELECT COUNT(*) AS n FROM mafia_media_slots')).n,1);
  assert.ok((await first(h.app.env,'SELECT expires_at FROM mafia_media_leases')).expires_at>Date.now()+86400000);
  h.failRemovals(false);await item.instance.serial(()=>item.instance.commit(structuredClone(item.instance.room)));
  assert.equal((await first(h.app.env,'SELECT COUNT(*) AS n FROM mafia_media_slots')).n,0);
  assert.equal((await first(h.app.env,'SELECT COUNT(*) AS n FROM mafia_media_leases')).n,0);
  assert.equal(await item.storage.get('mafia:voice-transition'),null);
});
test('voice quota rejects new starts without spending the host trial',async t=>{
  const h=await setup(t),g=await h.group();await run(h.app.env,'INSERT INTO mafia_media_slots(room_key,call_id,capacity,updated_at) VALUES(?,?,?,?)','another-live-room','another-live-call',12,Date.now());
  await assert.rejects(g.clients[0].command('start'),e=>e.code==='MAFIA_VOICE_CAPACITY');
  assert.equal(h.app.rooms.get(g.code).instance.room.phase,'lobby');assert.equal((await first(h.app.env,"SELECT COUNT(*) AS n FROM trials WHERE game='mafia'")).n,0);
});
test('finished results survive a departed first player and a D1 write outage through durable outbox',async t=>{
  const h=await setup(t),g=await h.group();await g.clients[0].command('start');
  const item=h.app.rooms.get(g.code),original=h.app.env.DB.batch.bind(h.app.env.DB);let unavailable=true;
  t.mock.method(h.app.env.DB,'batch',async statements=>{if(unavailable&&statements.some(s=>s.sql.includes('INSERT OR IGNORE INTO mafia_history')))throw new Error('injected result outage');return original(statements);});
  await item.instance.serial(async()=>{const r=structuredClone(item.instance.room);r.members[0].left=true;r.phase='over';r.phaseId++;r.outcome={faction:'town',endedAt:Date.now(),reason:'faction'};r.winners=r.participants.filter(id=>r.roleStates[id].faction==='town');r.roleStates[r.members[0].id].forfeited=true;await item.instance.commit(r);});
  assert.equal((await item.storage.get('mafiaResultOutbox')).length,1);assert.equal((await first(h.app.env,'SELECT COUNT(*) AS n FROM mafia_results')).n,0);
  await item.instance.flushingStats;
  unavailable=false;await h.app.rehydrate(g.code);await h.app.rooms.get(g.code).instance.alarm();
  assert.equal((await first(h.app.env,'SELECT COUNT(*) AS n FROM mafia_results')).n,6);
  assert.equal((await item.storage.get('mafiaResultOutbox')).length,0);
  await h.app.env.DB.batch(mafiaDeleteStatements(h.app.env,g.people[0].accountId));
  assert.equal((await first(h.app.env,'SELECT COUNT(*) AS n FROM mafia_history')).n,0);
  assert.equal((await first(h.app.env,'SELECT COUNT(*) AS n FROM mafia_results')).n,5,'other players keep their result/stat rows');
  await run(h.app.env,'DELETE FROM users WHERE id=?',g.people[0].accountId);
  await persistMafiaResult(h.app.env,{key:'late-deleted-replay',roomCode:g.code,rulesetVersion:1,finishedAt:Date.now(),summary:'{}',draw:true,results:[{userId:g.people[0].accountId,playerId:g.people[0].id,roleId:'citizen',initialFaction:'town',faction:'town',won:false,forfeited:false}]});
  assert.equal((await first(h.app.env,'SELECT COUNT(*) AS n FROM mafia_history')).n,0,'a delayed outbox cannot recreate deleted replay');
});
test('a timed-out old leave or join cannot revoke or reclaim a newer same-device voice session',async t=>{
  const h=await setup(t),g=await h.group();await g.clients[0].command('start');
  const path=`/api/rooms/${g.code}/voice`,a=await h.api(g.people[0],path,{deviceId:'same-phone',voiceSessionId:'first-session',operation:'join'});assert.equal(a.status,200);
  const leave={deviceId:'same-phone',voiceSessionId:'first-session',operation:'leave',callId:a.body.call.id};assert.equal((await h.api(g.people[0],path,leave)).status,200);
  const b=await h.api(g.people[0],path,{deviceId:'same-phone',voiceSessionId:'second-session',operation:'join'});assert.equal(b.status,200);
  const late=await h.api(g.people[0],path,leave);assert.equal(late.body.stale,true);
  assert.equal(h.app.rooms.get(g.code).instance.room.mafiaMedia.sessions[g.people[0].accountId],'second-session');
  assert.equal((await h.api(g.people[0],path,{deviceId:'same-phone',voiceSessionId:'first-session',operation:'join'})).body.error,'MAFIA_VOICE_SESSION');
  assert.equal((await h.api(g.people[0],path,{deviceId:'same-phone',voiceSessionId:'first-session',operation:'sync'})).body.error,'MAFIA_VOICE_SESSION');
});

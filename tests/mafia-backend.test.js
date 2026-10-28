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
import { mafiaVoiceRequest } from '../server/mafia-voice.mjs';
const ORIGIN='http://localhost:3000';
class BrowserSocket extends WebSocket {constructor(url){super(url,{origin:ORIGIN});}}
async function until(fn,label='state'){const end=Date.now()+5000;while(Date.now()<end){if(await fn())return;await new Promise(r=>setTimeout(r,10));}assert.fail(`Timed out ${label}`);}
async function setup(t,{enabled=true}={}) {
  const app=await startLocalServer({port:0,vars:{MAFIA_ENABLED:enabled?'1':'0',LIVEKIT_URL:'wss://mafia-tests.livekit.cloud',LIVEKIT_API_KEY:'fixture-key',LIVEKIT_API_SECRET:'fixture-secret'}});
  const clients=[],provider=[],nativeFetch=globalThis.fetch;let failRemovals=false;
  t.mock.method(globalThis,'fetch',async(url,options)=>{if(String(url).includes('mafia-tests.livekit.cloud')){const body=JSON.parse(options.body);provider.push({method:new URL(url).pathname.split('/').at(-1),body});return Response.json({}, {status:failRemovals&&String(url).endsWith('/RemoveParticipant')?503:200});}return nativeFetch(url,options);});
  t.after(async()=>{clients.forEach(c=>c.stop());await app.close();});
  async function user(n){const u=await createUser(app.env,{name:`لاعب ${n}`,email:`${crypto.randomUUID()}@example.test`}),s=await issueSession(app.env,u.id);return {...newCredentials(),accountId:u.id,sessionId:s.id,authorization:s.token,name:u.name,avatar:n%4,game:'mafia',capabilities:{mafia:1},settings:{mode:'classic',capacity:8,visibility:'public'}};}
  async function api(p,path,body,method=body===undefined?'GET':'POST'){if(path.endsWith('/voice')&&body)body={voiceSessionId:`fixture-${body.deviceId}`,operation:'join',...body};const r=await fetch(app.url+path,{method,headers:{origin:ORIGIN,...(p?.authorization?{authorization:`Bearer ${p.authorization}`}:{ }),...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:r.status,body:r.status===204?null:await r.json()};}
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
test('public discovery is available to unrelated accounts, excludes private/full/blocked rooms and keeps joining free',async t=>{
  const h=await setup(t),host=await h.user(0),guest=await h.user(1),privateHost=await h.user(2),blockedPeer=await h.user(3);
  const create=await h.api(host,'/api/rooms',host),code=create.body.code;
  const hidden=await h.api(privateHost,'/api/rooms',{...privateHost,settings:{mode:'classic',capacity:8}});assert.equal(hidden.status,201);
  assert.equal(h.app.rooms.get(hidden.body.code).instance.room.settings.visibility,'private','backend compatibility default stays private');
  const path='/api/rooms/public?game=mafia&mode=classic';
  assert.equal((await h.api(null,path)).status,401);
  const rows=(await h.api(guest,path)).body.rooms;assert.deepEqual(rows.map(r=>r.code),[code]);assert.deepEqual(Object.keys(rows[0]).sort(),['capacity','code','expiresAt','game','hostName','mode','players','ready'].sort());
  assert.equal((await first(h.app.env,'SELECT COUNT(*) AS n FROM social_friendships')).n,0,'discovery does not require a friendship');
  assert.deepEqual((await h.api(guest,'/api/rooms/public?game=mafia&mode=shadow')).body.rooms,[]);
  assert.equal((await h.api(blockedPeer,`/api/rooms/${code}/join`,blockedPeer)).status,200);
  for(const [blocker,blocked]of [[guest,blockedPeer],[blockedPeer,guest]]){
    await run(h.app.env,'INSERT INTO social_blocks(blocker_id,blocked_id,created_at) VALUES(?,?,?)',blocker.accountId,blocked.accountId,Date.now());
    assert.deepEqual((await h.api(guest,path)).body.rooms,[],'a blocked peer, not only a blocked host, hides the room in either direction');
    assert.equal((await h.api(guest,'/api/matchmaking/join',guest)).body.error,'MAFIA_NO_ROOMS');
    assert.equal((await h.api(guest,`/api/rooms/${code}/join`,{...guest,matchmaking:true})).body.error,'MAFIA_BLOCKED');
    await run(h.app.env,'DELETE FROM social_blocks WHERE blocker_id=? AND blocked_id=?',blocker.accountId,blocked.accountId);
  }
  assert.equal((await h.api(guest,`/api/rooms/${hidden.body.code}/join`,{...guest,matchmaking:true})).body.error,'STARTED','a public card cannot fall through to a now-private room');
  assert.equal((await h.api(guest,`/api/rooms/${code}/join`,{...guest,matchmaking:true})).status,200);
  assert.equal((await first(h.app.env,'SELECT COUNT(*) AS n FROM trials')).n,0);
  for(let i=4;i<9;i++){const p=await h.user(i);assert.equal((await h.api(p,`/api/rooms/${code}/join`,p)).status,200);}
  const outside=await h.user(20);assert.deepEqual((await h.api(outside,path)).body.rooms,[],'full rooms are not advertised as joinable');
});
test('real six-client socket game keeps private actions private, isolates voice phases and fences devices',async t=>{
  const h=await setup(t),g=await h.group();await g.clients[0].command('start');await until(()=>g.clients.every(c=>c.state.phase==='role'));
  assert.equal((await first(h.app.env,"SELECT COUNT(*) AS n FROM trials WHERE game='mafia'")).n,0);
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
test('Mafia start revokes departed social grants until provider cleanup is proven past their leave timestamp',async t=>{
  const h=await setup(t),g=await h.group(),callId=crypto.randomUUID(),now=Date.now(),second=Math.floor(now/1000);
  await run(h.app.env,"INSERT INTO social_calls(id,scope,conversation_id,initiator_id,client_id,status,created_at,ring_until,expires_at,room_name) VALUES(?,'group','group-fixture',?,?,'ended',?,?,?,'departed-social-room')",callId,g.people[0].accountId,crypto.randomUUID(),now-60000,now-10000,now);
  const departures=[{person:g.people[0],leftAt:now,cutoff:0},{person:g.people[1],leftAt:now,cutoff:second+2},{person:g.people[2],leftAt:second*1000,cutoff:second},{person:g.people[3],leftAt:null,cutoff:0}];
  for(const {person,leftAt,cutoff}of departures)await run(h.app.env,"INSERT INTO social_call_participants(call_id,user_id,state,device_id,joined_at,left_at,revoked_before) VALUES(?,?,'left','social-phone',?,?,?)",callId,person.accountId,now-60000,leftAt,cutoff);
  await g.clients[0].command('start');
  const revoked=h.provider.filter(p=>p.method==='RemoveParticipant'&&p.body.room==='departed-social-room');
  assert.deepEqual(new Set(revoked.map(p=>p.body.identity)),new Set([g.people[0].accountId,g.people[2].accountId,g.people[3].accountId]));
  assert.ok(revoked.every(p=>p.body.revoke_token_ts>second));
  assert.equal(h.app.rooms.get(g.code).instance.room.phase,'role');
});
test('ordinary private commands authorize actor and peers from one live read without metadata writes or cross-request reuse',async t=>{
  const h=await setup(t),g=await h.group();await g.clients[0].command('start');await h.phase(g.code);await h.phase(g.code);
  await until(()=>g.clients.every(c=>c.state.phase==='night'));
  const index=g.clients.findIndex(c=>c.state.you.faction==='mafia'),actor=g.clients[index],target=g.people.find(p=>p.id!==g.people[index].id).id;
  const prepare=h.app.env.DB.prepare.bind(h.app.env.DB),sql=[];t.mock.method(h.app.env.DB,'prepare',text=>{sql.push(text);return prepare(text);});
  await actor.command('mafia_vote',{targetId:target});
  assert.equal(sql.filter(s=>/^SELECT .*sessions/.test(s)).length,1,'one live union read authorizes the actor and every socket/native binding');
  assert.equal(sql.filter(s=>/^(DELETE|INSERT|UPDATE).*mafia_/.test(s)).length,0,'no unchanged metadata writes enter the room queue');
  const previous=structuredClone(h.app.rooms.get(g.code).instance.room.killVotes);
  await run(h.app.env,'UPDATE sessions SET revoked_at=? WHERE user_id=?',Date.now()-1,g.people[index].accountId);
  await assert.rejects(actor.command('mafia_vote',{targetId:target}),e=>e.code==='AUTH');
  assert.deepEqual(h.app.rooms.get(g.code).instance.room.killVotes,previous,'revoked actor never mutates the command state');
});
test('metadata sync retries failed directory writes, resynchronizes on cold start and refreshes lobby expiry',async t=>{
  const h=await setup(t),g=await h.group(),prepare=h.app.env.DB.prepare.bind(h.app.env.DB);let failed=false;
  const oldReady=(await first(h.app.env,'SELECT ready FROM mafia_public_rooms')).ready;
  t.mock.method(h.app.env.DB,'prepare',sql=>{
    if(!failed&&sql.includes('INSERT INTO mafia_public_rooms'))return {bind:()=>({run:async()=>{failed=true;throw new Error('injected directory outage');}})};
    return prepare(sql);
  });
  await assert.rejects(g.clients[1].command('ready',{ready:false}),e=>e.code==='INTERNAL');
  assert.equal((await first(h.app.env,'SELECT ready FROM mafia_public_rooms')).ready,oldReady);
  let instance=h.app.rooms.get(g.code).instance;
  await instance.serial(()=>instance.commit(structuredClone(instance.room)));
  assert.equal((await first(h.app.env,'SELECT ready FROM mafia_public_rooms')).ready,oldReady-1,'failed sync is not cached as successful');
  await run(h.app.env,'DELETE FROM mafia_public_rooms');await h.app.rehydrate(g.code);instance=h.app.rooms.get(g.code).instance;
  await instance.serial(()=>instance.commit(structuredClone(instance.room)));
  const before=await first(h.app.env,'SELECT ready,expires_at FROM mafia_public_rooms');assert.equal(before.ready,oldReady-1,'cold object restores advisory metadata');
  const later=Date.now()+31_000;t.mock.method(Date,'now',()=>later);
  await instance.serial(()=>instance.commit(structuredClone(instance.room)));
  assert.ok((await first(h.app.env,'SELECT expires_at FROM mafia_public_rooms')).expires_at>before.expires_at,'unchanged public lobby does not expire');
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

for(const background of [false,true])test(`signout strictly revokes session-bound Mafia voice with ${background?'native audio and a closed':'a live'} socket`,async t=>{
  const h=await setup(t),g=await h.group();await g.clients[0].command('start');await h.phase(g.code);
  const person=g.people[0],path=`/api/rooms/${g.code}/voice`,voice=await h.api(person,path,{deviceId:'native-phone',accountSessionId:'untrusted-client-value'});
  assert.equal(voice.status,200);const item=h.app.rooms.get(g.code),channel=decodeJws(voice.body.connection.token).payload.video.room;
  assert.equal(item.instance.room.mafiaMedia.authSessions[person.accountId].id,person.sessionId,'the router replaces any client-supplied binding');
  assert.equal(JSON.stringify(voice.body).includes(person.sessionId),false,'account session identity is not exposed in media responses');
  if(background) {
    g.clients[0].stop();await until(()=>!item.instance.sockets().some(s=>item.instance.attachment(s).id===person.id));
    await item.instance.queue;assert.equal(item.instance.room.members.find(m=>m.id===person.id).connected,true,'valid native background voice retains ordinary seat presence');
  }
  const response=await h.api(person,'/api/auth/signout',{});assert.equal(response.status,204);
  assert.ok(h.provider.some(p=>p.method==='RemoveParticipant'&&p.body.identity===person.accountId&&p.body.room===channel&&p.body.revoke_token_ts>Math.floor(Date.now()/1000)));
  const room=item.instance.room,seat=room.members.find(m=>m.id===person.id);
  assert.equal(seat.connected,false);assert.equal(seat.left,false,'the 90-second return seat is retained');
  assert.equal(room.mafiaMedia.authSessions[person.accountId],undefined);assert.equal(room.mafiaMedia.devices[person.accountId],undefined);
  assert.equal(room.mafiaMedia.issued.some(i=>i.identity===person.accountId),false);assert.equal(await item.storage.get('mafia:voice-transition'),null);
  assert.equal(item.instance.stateFor(person.id).mafiaVoice.quiet,true);
});

test('an AUTH command preserves seat identity until revocation and cannot turn into native presence grace',async t=>{
  const h=await setup(t),g=await h.group();await g.clients[0].command('start');await h.phase(g.code);
  const p=g.people[0],item=h.app.rooms.get(g.code);await h.api(p,`/api/rooms/${g.code}/voice`,{deviceId:'native-phone'});
  const ws=item.instance.sockets().find(s=>item.instance.attachment(s).id===p.id);
  await run(h.app.env,'UPDATE sessions SET revoked_at=? WHERE id=?',Date.now()-1,p.sessionId);
  await assert.rejects(g.clients[0].command('chat',{channel:'public',text:'must not send',clientId:crypto.randomUUID()}),e=>e.code==='AUTH');
  await until(()=>h.provider.some(r=>r.method==='RemoveParticipant'&&r.body.identity===p.accountId));await item.instance.queue;
  assert.equal(item.instance.attachment(ws).id,p.id);assert.equal(item.instance.attachment(ws).revoked,true);
  assert.equal(item.instance.room.members.find(m=>m.id===p.id).connected,false);
  assert.equal(JSON.stringify(item.instance.stateFor(g.people[1].id)).includes('must not send'),false);
});

test('an unrelated session signout leaves the authorized native call and socket intact',async t=>{
  const h=await setup(t),g=await h.group();await g.clients[0].command('start');await h.phase(g.code);
  const p=g.people[0],path=`/api/rooms/${g.code}/voice`;await h.api(p,path,{deviceId:'native-phone'});
  const item=h.app.rooms.get(g.code),epoch=item.instance.room.mafiaMedia.epoch,removals=h.provider.filter(r=>r.method==='RemoveParticipant').length;
  const second=await issueSession(h.app.env,p.accountId);
  const attempt=await h.api({...p,authorization:second.token},path,{deviceId:'native-phone',operation:'sync'});assert.equal(attempt.body.error,'MAFIA_VOICE_SESSION','unrelated bearer cannot steal an existing media nonce');
  assert.equal((await h.api({...p,authorization:second.token},'/api/auth/signout',{})).status,204);
  assert.equal(item.instance.room.mafiaMedia.epoch,epoch);assert.equal(h.provider.filter(r=>r.method==='RemoveParticipant').length,removals);
  assert.equal(item.instance.room.mafiaMedia.authSessions[p.accountId].id,p.sessionId);assert.equal(item.instance.room.members.find(m=>m.id===p.id).connected,true);
  assert.equal((await h.api(p,path,{deviceId:'native-phone',operation:'sync',knownEpoch:epoch})).body.unchanged,true);
});

test('native session expiry schedules an exact alarm and revokes without waiting for voice presence expiry',async t=>{
  const h=await setup(t),g=await h.group();await g.clients[0].command('start');await h.phase(g.code);
  const p=g.people[0],item=h.app.rooms.get(g.code),expiresAt=Date.now()+10_000;
  await run(h.app.env,'UPDATE sessions SET expires_at=? WHERE id=?',expiresAt,p.sessionId);
  await h.api(p,`/api/rooms/${g.code}/voice`,{deviceId:'native-phone'});
  g.clients[0].stop();await until(()=>!item.instance.sockets().some(s=>item.instance.attachment(s).id===p.id));await item.instance.queue;
  assert.ok((await item.storage.getAlarm())<=expiresAt);assert.equal(item.instance.room.members.find(m=>m.id===p.id).connected,true);
  await h.app.rehydrate(g.code);const instance=h.app.rooms.get(g.code).instance;
  assert.equal(instance.room.mafiaMedia.authSessions[p.accountId].expiresAt,expiresAt,'binding survives object hibernation');
  t.mock.method(Date,'now',()=>expiresAt+1);await instance.alarm();
  assert.ok(h.provider.some(r=>r.method==='RemoveParticipant'&&r.body.identity===p.accountId));
  assert.equal(instance.room.members.find(m=>m.id===p.id).connected,false);assert.equal(instance.room.mafiaMedia.authSessions[p.accountId],undefined);
  assert.equal(instance.room.members.find(m=>m.id===p.id).left,false);
});

test('explicit bearer rotation transfers media binding, and revoking the retired bearer does not revoke its successor',async t=>{
  const h=await setup(t),g=await h.group();await g.clients[0].command('start');await h.phase(g.code);
  const p=g.people[0],path=`/api/rooms/${g.code}/voice`;await h.api(p,path,{deviceId:'native-phone'});
  const next=await issueSession(h.app.env,p.accountId);await run(h.app.env,'UPDATE sessions SET replaced_by=?,revoked_at=? WHERE id=?',next.id,Date.now()+300_000,p.sessionId);
  const sync=await h.api({...p,authorization:next.token},path,{deviceId:'native-phone',operation:'sync'});assert.equal(sync.status,200);
  const item=h.app.rooms.get(g.code),before=h.provider.filter(r=>r.method==='RemoveParticipant').length;
  assert.equal(item.instance.room.mafiaMedia.authSessions[p.accountId].id,next.id);
  assert.equal((await h.api(p,'/api/auth/signout',{})).status,204);assert.equal(h.provider.filter(r=>r.method==='RemoveParticipant').length,before);
  assert.equal(item.instance.room.members.find(m=>m.id===p.id).connected,true);assert.equal(item.instance.room.mafiaMedia.authSessions[p.accountId].id,next.id);
});

test('session revocation provider outage aborts and retains the durable journal and quarantined leases until cleanup succeeds',async t=>{
  const h=await setup(t),g=await h.group();await g.clients[0].command('start');await h.phase(g.code);
  const p=g.people[0],item=h.app.rooms.get(g.code);await h.api(p,`/api/rooms/${g.code}/voice`,{deviceId:'native-phone'});
  g.clients[0].stop();await until(()=>!item.instance.sockets().some(s=>item.instance.attachment(s).id===p.id));await item.instance.queue;
  h.failRemovals();const result=await h.api(p,'/api/auth/signout',{});assert.equal(result.status,503);
  assert.equal(item.instance.room.phase,'over');assert.equal(item.instance.room.mafiaMedia.failed,true);assert.ok(await item.storage.get('mafia:voice-transition'));
  assert.equal((await first(h.app.env,'SELECT COUNT(*) AS n FROM mafia_media_slots')).n,1);
  assert.equal((await first(h.app.env,'SELECT expires_at FROM mafia_media_leases WHERE user_id=?',p.accountId)).expires_at,Number.MAX_SAFE_INTEGER);
  assert.equal((await h.api(g.people[1],`/api/rooms/${g.code}/voice`,{deviceId:'other-phone'})).body.error,'CALL_UNAVAILABLE');
  h.failRemovals(false);await item.instance.serial(()=>item.instance.commit(structuredClone(item.instance.room)));
  assert.equal(await item.storage.get('mafia:voice-transition'),null);assert.equal((await first(h.app.env,'SELECT COUNT(*) AS n FROM mafia_media_leases')).n,0);
});

test('moderator suspension revokes native Mafia media immediately after its socket has closed',async t=>{
  const h=await setup(t),g=await h.group(),moderator=await h.user(99);h.app.env.MODERATOR_USER_IDS=moderator.accountId;
  await g.clients[0].command('start');await h.phase(g.code);const p=g.people[0],item=h.app.rooms.get(g.code);
  await h.api(p,`/api/rooms/${g.code}/voice`,{deviceId:'native-phone'});g.clients[0].stop();await until(()=>!item.instance.sockets().some(s=>item.instance.attachment(s).id===p.id));await item.instance.queue;
  const result=await h.api(moderator,'/api/moderation/actions',{action:'suspend_user',targetId:p.accountId,clientId:crypto.randomUUID(),reason:'test moderation suspension'});assert.equal(result.status,200,JSON.stringify(result));
  assert.ok(h.provider.some(r=>r.method==='RemoveParticipant'&&r.body.identity===p.accountId));assert.equal(item.instance.room.members.find(m=>m.id===p.id).connected,false);
  assert.equal(item.instance.room.mafiaMedia.authSessions[p.accountId],undefined);
});

test('ordinary action reconciles another revoked native peer before its command can be committed or acknowledged',async t=>{
  const h=await setup(t),g=await h.group();await g.clients[0].command('start');await h.phase(g.code);
  const item=h.app.rooms.get(g.code),peer=g.people[1];await h.api(peer,`/api/rooms/${g.code}/voice`,{deviceId:'peer-phone'});
  await run(h.app.env,'UPDATE sessions SET revoked_at=? WHERE id=?',Date.now()-1,peer.sessionId);
  let release,entered=false,settled=false;const barrier=new Promise(resolve=>{release=resolve;}),fetch=globalThis.fetch;
  t.mock.method(globalThis,'fetch',async(url,options)=>{if(String(url).includes('mafia-tests.livekit.cloud')&&String(url).endsWith('/RemoveParticipant')){entered=true;await barrier;}return fetch(url,options);});
  const pending=g.clients[0].command('chat',{channel:'public',text:'بعد الحاجز فقط',clientId:crypto.randomUUID()}).finally(()=>{settled=true;});
  try{await until(()=>entered,'provider barrier');assert.equal(settled,false);assert.equal(JSON.stringify(item.instance.room.chats).includes('بعد الحاجز فقط'),false);}
  finally{release();}
  await pending;assert.equal(settled,true);assert.equal(item.instance.room.members.find(m=>m.id===peer.id).connected,false);
  assert.ok(h.provider.some(r=>r.method==='RemoveParticipant'&&r.body.identity===peer.accountId));assert.equal(item.instance.room.mafiaMedia.authSessions[peer.accountId],undefined);
  assert.equal(JSON.stringify(item.instance.room.chats).includes('بعد الحاجز فقط'),true);
});

test('a failed live union read commits no action and a subsequent request performs its own authorization',async t=>{
  const h=await setup(t),g=await h.group();await g.clients[0].command('start');await h.phase(g.code);
  const item=h.app.rooms.get(g.code),prepare=h.app.env.DB.prepare.bind(h.app.env.DB);let fail=true,reads=0;
  t.mock.method(h.app.env.DB,'prepare',sql=>{if(sql.startsWith('SELECT id,user_id,expires_at,revoked_at FROM sessions')){reads++;if(fail){fail=false;return{bind:()=>({all:async()=>{throw new Error('injected live authorization outage');}})};}}return prepare(sql);});
  const body={channel:'public',text:'تحقق جديد',clientId:crypto.randomUUID()};
  await assert.rejects(g.clients[0].command('chat',body),e=>e.code==='INTERNAL');assert.equal(JSON.stringify(item.instance.room.chats).includes(body.text),false);
  await g.clients[0].command('chat',body);assert.equal(reads,2);assert.equal(item.instance.room.chats.public.filter(m=>m.clientId===body.clientId).length,1);
});

test('one read per private command preserves durable ordering through a concurrent burst',async t=>{
  const h=await setup(t),g=await h.group();await g.clients[0].command('start');await h.phase(g.code);await h.phase(g.code);await until(()=>g.clients.every(c=>c.state.phase==='night'));
  const actorIndex=g.clients.findIndex(c=>c.state.you.faction==='mafia'),actor=g.clients[actorIndex],targets=g.people.filter((_,i)=>i!==actorIndex).map(p=>p.id),prepare=h.app.env.DB.prepare.bind(h.app.env.DB);let reads=0;
  t.mock.method(h.app.env.DB,'prepare',sql=>{if(sql.startsWith('SELECT id,user_id,expires_at,revoked_at FROM sessions'))reads++;return prepare(sql);});
  const order=[],choices=Array.from({length:8},(_,i)=>targets[i%targets.length]);await Promise.all(choices.map((targetId,i)=>actor.command('mafia_vote',{targetId}).then(()=>order.push(i))));
  assert.equal(reads,8);assert.deepEqual(order,[0,1,2,3,4,5,6,7]);const item=h.app.rooms.get(g.code);
  assert.equal(item.instance.room.killVotes[g.people[actorIndex].id],choices.at(-1));assert.equal((await item.storage.get('room')).killVotes[g.people[actorIndex].id],choices.at(-1));
});

test('same-task authorization rejects expired rows and rereads when phase, audience or session set changes',async t=>{
  const h=await setup(t),g=await h.group();await g.clients[0].command('start');await h.phase(g.code);
  const instance=h.app.rooms.get(g.code).instance,proof=await instance.readMafiaSessions(instance.room),p=g.people[0];
  const actor=proof.sessions.find(s=>s.id===p.sessionId);assert.ok(instance.mafiaSessionValid(proof,p.sessionId,p.accountId));
  assert.equal(instance.mafiaSessionValid(proof,p.sessionId,p.accountId,actor.expires_at),undefined,'expiry is rechecked when consuming rows');
  const another=await issueSession(h.app.env,p.accountId),prepare=h.app.env.DB.prepare.bind(h.app.env.DB);let reads=0;
  t.mock.method(h.app.env.DB,'prepare',sql=>{if(sql.startsWith('SELECT id,user_id,expires_at,revoked_at FROM sessions'))reads++;return prepare(sql);});
  await instance.serial(async()=>{
    let candidate=structuredClone(instance.room);candidate.phaseId++;await instance.validateMafiaSessions(candidate,Date.now(),proof);assert.equal(reads,1);
    candidate=structuredClone(instance.room);candidate.members.find(m=>m.id===p.id).connected=false;await instance.validateMafiaSessions(candidate,Date.now(),proof);assert.equal(reads,2);
    candidate=structuredClone(instance.room);candidate.mafiaMedia.authSessions||={};candidate.mafiaMedia.authSessions[p.accountId]={id:another.id,expiresAt:another.expiresAt};await instance.validateMafiaSessions(candidate,Date.now(),proof);assert.equal(reads,3);
  });
});

test('ordinary action ignores a different revoked session of the same account and reactions still require a live actor',async t=>{
  const h=await setup(t),g=await h.group();await g.clients[0].command('start');await h.phase(g.code);
  const p=g.people[0],item=h.app.rooms.get(g.code);await h.api(p,`/api/rooms/${g.code}/voice`,{deviceId:'primary-phone'});
  const other=await issueSession(h.app.env,p.accountId);await run(h.app.env,'UPDATE sessions SET revoked_at=? WHERE id=?',Date.now()-1,other.id);
  const before=h.provider.filter(r=>r.method==='RemoveParticipant').length;await g.clients[0].command('chat',{channel:'public',text:'الجلسة الأصلية سليمة',clientId:crypto.randomUUID()});
  assert.equal(item.instance.room.mafiaMedia.authSessions[p.accountId].id,p.sessionId);assert.equal(h.provider.filter(r=>r.method==='RemoveParticipant').length,before);
  await run(h.app.env,'UPDATE sessions SET revoked_at=? WHERE id=?',Date.now()-1,p.sessionId);
  await assert.rejects(g.clients[0].command('react',{emoji:'👍'}),e=>e.code==='AUTH');
});

test('voice sync checks the live session and owned lease in one fresh read per request',async t=>{
  const h=await setup(t),g=await h.group();await g.clients[0].command('start');await h.phase(g.code);
  const p=g.people[0],item=h.app.rooms.get(g.code),path=`/api/rooms/${g.code}/voice`;
  const joined=await h.api(p,path,{deviceId:'phone'});assert.equal(joined.status,200);
  const now=Date.now(),body={deviceId:'phone',voiceSessionId:'fixture-phone',operation:'sync',knownEpoch:joined.body.mediaEpoch,accountSessionId:p.sessionId};
  const prepare=h.app.env.DB.prepare.bind(h.app.env.DB),sql=[];t.mock.method(h.app.env.DB,'prepare',s=>{sql.push(s);return prepare(s);});
  await item.instance.serial(async()=>{
    for(let n=0;n<3;n++)assert.equal((await mafiaVoiceRequest(item.ctx,h.app.env,item.instance.room,p.accountId,body,now)).unchanged,true);
    assert.equal(sql.length,3);assert.ok(sql.every(s=>s.includes('LEFT JOIN mafia_media_leases')),'one actual SQLite read per sync');
    const before=structuredClone(item.instance.room.mafiaMedia);
    await run(h.app.env,'UPDATE sessions SET revoked_at=? WHERE id=?',now,p.sessionId);
    await assert.rejects(mafiaVoiceRequest(item.ctx,h.app.env,item.instance.room,p.accountId,body,now),e=>e.code==='AUTH');
    assert.deepEqual(item.instance.room.mafiaMedia,before,'the previous successful read grants no cached authorization');
  });
});

test('voice JOIN preserves distinct authentication and lease failures without issuing or mutating a grant',async t=>{
  const h=await setup(t),g=await h.group();await g.clients[0].command('start');await h.phase(g.code);
  const p=g.people[0],peer=g.people[1],item=h.app.rooms.get(g.code),now=Date.now();
  const joined=await h.api(p,`/api/rooms/${g.code}/voice`,{deviceId:'phone'});assert.equal(joined.status,200);
  const body={deviceId:'phone',voiceSessionId:'fixture-phone',operation:'sync',knownEpoch:joined.body.mediaEpoch,accountSessionId:p.sessionId};
  const originalSession=await first(h.app.env,'SELECT * FROM sessions WHERE id=?',p.sessionId),lease=await first(h.app.env,'SELECT * FROM mafia_media_leases WHERE user_id=?',p.accountId);
  const cases=[
    {name:'absent session',body:{accountSessionId:'missing'},code:'AUTH'},
    {name:'another account session',body:{accountSessionId:peer.sessionId},code:'AUTH'},
    {name:'exact session expiry',sql:'UPDATE sessions SET expires_at=? WHERE id=?',args:[now,p.sessionId],code:'AUTH'},
    {name:'exact revocation cutoff',sql:'UPDATE sessions SET revoked_at=? WHERE id=?',args:[now,p.sessionId],code:'AUTH'},
    {name:'suspension',sql:'INSERT INTO moderation_suspensions VALUES(?,?,?,?,?)',args:[p.accountId,peer.accountId,'fixture',now,now],code:'AUTH'},
    {name:'account deletion',sql:'INSERT INTO account_deletions VALUES(?,?,?)',args:[p.accountId,'fixture',now],code:'AUTH'},
    {name:'missing own lease despite other live leases',sql:'DELETE FROM mafia_media_leases WHERE user_id=?',args:[p.accountId],code:'MAFIA_ACTIVE_ELSEWHERE'},
    {name:'exact lease expiry',sql:'UPDATE mafia_media_leases SET expires_at=? WHERE user_id=?',args:[now,p.accountId],code:'MAFIA_ACTIVE_ELSEWHERE'},
    {name:'different room lease',sql:'UPDATE mafia_media_leases SET room_key=? WHERE user_id=?',args:['another-room',p.accountId],code:'MAFIA_ACTIVE_ELSEWHERE'},
    {name:'different call lease',sql:'UPDATE mafia_media_leases SET call_id=? WHERE user_id=?',args:['another-call',p.accountId],code:'MAFIA_ACTIVE_ELSEWHERE'},
  ];
  await item.instance.serial(async()=>{
    for(const entry of cases){
      if(entry.sql)await run(h.app.env,entry.sql,...entry.args);
      const before=structuredClone(item.instance.room.mafiaMedia),providerCalls=h.provider.length;
      await assert.rejects(mafiaVoiceRequest(item.ctx,h.app.env,item.instance.room,p.accountId,{...body,...entry.body},now),e=>e.code===entry.code,entry.name);
      assert.deepEqual(item.instance.room.mafiaMedia,before,entry.name);assert.equal(h.provider.length,providerCalls,entry.name);
      await run(h.app.env,'UPDATE sessions SET expires_at=?,revoked_at=? WHERE id=?',originalSession.expires_at,originalSession.revoked_at,p.sessionId);
      await run(h.app.env,'DELETE FROM moderation_suspensions WHERE user_id=?',p.accountId);await run(h.app.env,'DELETE FROM account_deletions WHERE user_id=?',p.accountId);
      await run(h.app.env,'INSERT OR REPLACE INTO mafia_media_leases(user_id,room_key,call_id,expires_at,updated_at) VALUES(?,?,?,?,?)',p.accountId,lease.room_key,lease.call_id,lease.expires_at,lease.updated_at);
    }
    assert.equal((await mafiaVoiceRequest(item.ctx,h.app.env,item.instance.room,p.accountId,body,now)).unchanged,true);
    const prepare=h.app.env.DB.prepare.bind(h.app.env.DB),before=structuredClone(item.instance.room.mafiaMedia);
    t.mock.method(h.app.env.DB,'prepare',sql=>sql.includes('LEFT JOIN mafia_media_leases')?{bind:()=>({first:async()=>{throw new Error('fresh read unavailable');}})}:prepare(sql));
    await assert.rejects(mafiaVoiceRequest(item.ctx,h.app.env,item.instance.room,p.accountId,body,now),/fresh read unavailable/);
    assert.deepEqual(item.instance.room.mafiaMedia,before,'D1 failure never turns the prior grant into authority');
  });
});

test('unchanged Mafia voice skips only an identical durable alarm and preserves changed auth, phase and presence deadlines',async t=>{
  const h=await setup(t),g=await h.group();await g.clients[0].command('start');await h.phase(g.code);
  const p=g.people[0],item=h.app.rooms.get(g.code),path=`/api/rooms/${g.code}/voice`,now=Date.now();t.mock.method(Date,'now',()=>now);
  const joined=await h.api(p,path,{deviceId:'phone'});assert.equal(joined.status,200);
  const setAlarm=item.storage.setAlarm.bind(item.storage),getAlarm=item.storage.getAlarm.bind(item.storage),writes=[];let reads=0;
  t.mock.method(item.storage,'setAlarm',async at=>{writes.push(at);return setAlarm(at);});t.mock.method(item.storage,'getAlarm',async()=>{reads++;return getAlarm();});
  const body={deviceId:'phone',operation:'sync',knownEpoch:joined.body.mediaEpoch};
  for(let i=0;i<3;i++)assert.equal((await h.api(p,path,body)).body.unchanged,true);
  assert.equal(reads,3);assert.deepEqual(writes,[],'three heartbeats do not rewrite the exact same deadline');
  assert.equal((await h.api(p,path,{...body,operation:'join'})).body.unchanged,true);assert.equal(writes.length,1,'even an unchanged repeated join retains normal scheduling');
  await run(h.app.env,'UPDATE sessions SET expires_at=? WHERE id=?',now+10000,p.sessionId);assert.equal((await h.api(p,path,body)).body.unchanged,true);assert.equal(writes.at(-1),now+10000);
  await run(h.app.env,'UPDATE sessions SET expires_at=? WHERE id=?',now+20000,p.sessionId);assert.equal((await h.api(p,path,body)).body.unchanged,true);assert.equal(writes.at(-1),now+20000,'a later changed deadline is written too');
  await item.instance.serial(async()=>{
    item.instance.room.deadlineAt=now+5000;await item.instance.schedule({skipIdenticalMafiaAlarm:true});assert.equal(writes.at(-1),now+5000);
    const ws=item.instance.sockets().find(s=>item.instance.attachment(s).id===p.id),a=item.instance.attachment(ws);ws.serializeAttachment({...a,seenAt:now-41000});
    await item.instance.schedule({skipIdenticalMafiaAlarm:true});assert.equal(writes.at(-1),now+4000,'socket liveness still supplies the earliest deadline');
    const n=writes.length;await item.instance.schedule();assert.equal(writes.length,n+1,'normal scheduling is unchanged');
    const getter=item.storage.getAlarm;item.storage.getAlarm=undefined;try{await item.instance.schedule({skipIdenticalMafiaAlarm:true});assert.equal(writes.length,n+2,'adapters without getAlarm use normal scheduling');}finally{item.storage.getAlarm=getter;}
  });
});

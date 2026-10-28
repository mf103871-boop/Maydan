import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { startLocalServer } from '../server/local.mjs';
import { createUser, upsertSubscription, revokeSession } from '../server/accounts/db.mjs';
import { issueSession } from '../server/accounts/session.mjs';
import { RoomClient, newCredentials } from '../src/online/client.js';
import { GRACE_MS } from '../src/shared/account/config.js';
import { ROOM_REACTIONS } from '../src/online/shared.js';

const ORIGIN='http://localhost:3000';
class BrowserSocket extends WebSocket {constructor(url){super(url,{origin:ORIGIN});}}
async function until(fn){const end=Date.now()+5000;while(Date.now()<end){if(fn())return;await new Promise(r=>setTimeout(r,5));}assert.fail('Room state did not converge');}
async function setup(t,count=3) {
  const app=await startLocalServer({port:0}),clients=[],people=[];t.after(async()=>{clients.forEach(c=>c.stop());await app.close();});
  for(let n=0;n<count;n++){const user=await createUser(app.env,{name:`لاعب ${n}`,email:`${crypto.randomUUID()}@example.test`}),session=await issueSession(app.env,user.id);people.push({...newCredentials(),name:user.name,avatar:n%4,game:'fabraka',accountId:user.id,accountToken:session.token,accountSession:session.id,settings:{mode:'classic',rounds:3}});}
  async function api(person,path,body,method=body===undefined?'GET':'POST'){const r=await fetch(app.url+path,{method,headers:{origin:ORIGIN,authorization:`Bearer ${person.accountToken}`,...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:r.status,body:r.status===204?null:await r.json()};}
  async function grant(person,until=Date.now()+86400000,status='active'){await upsertSubscription(app.env,{source:'promo',external_id:`room-plus-${person.accountId}`,user_id:person.accountId,product:'plus.monthly',status,until,will_renew:false,environment:'promo',occurred_at:Date.now()});}
  async function open(){const created=await api(people[0],'/api/rooms',people[0]);assert.equal(created.status,201,JSON.stringify(created));const code=created.body.code;
    for(const person of people.slice(1))assert.equal((await api(person,`/api/rooms/${code}/join`,person)).status,200);
    for(const person of people){const c=new RoomClient({server:app.url,code,session:{id:person.id,token:person.token},getAccountAuthorization:()=>`Bearer ${person.accountToken}`,WebSocketImpl:BrowserSocket});clients.push(c);c.start();}
    await until(()=>clients.every(c=>c.state?.members.filter(m=>m.connected).length===count));
    return {code,room:app.rooms.get(code).instance};
  }
  return {app,clients,people,api,grant,open};
}

test('verified Plus lobby theme freezes across play and falls back at a new lobby after expiry',async t=>{
  const h=await setup(t),host=h.people[0];await h.grant(host);
  assert.equal((await h.api(host,'/api/me/cosmetics',{revision:0,selection:{roomThemeId:'sahra.roomTheme',frameId:'artist.frame'}},'PATCH')).status,200);
  const {room}=await h.open(),owner=h.clients[0];assert.equal(owner.state.appearance.themeId,'sahra.roomTheme');
  assert.equal(room.room.members[0].accountUserId,host.accountId,'optional-auth games retain real account identity');
  assert.equal(owner.state.members[0].profile.cosmetics.frameId,'artist.frame');assert.equal(JSON.stringify(owner.state).includes(host.accountId),false,'public profile carries no account ID');
  await owner.command('appearance',{themeId:'noir.roomTheme',accountAuthorization:`Bearer ${host.accountToken}`});
  await assert.rejects(h.clients[1].command('appearance',{themeId:null}),{code:'HOST_ONLY'});
  for(const c of h.clients.slice(1))await c.command('ready',{ready:true});await owner.command('start');assert.equal(room.room.phase,'write');
  await h.grant(host,Date.now()-GRACE_MS-1000,'expired');
  await room.serial(async()=>{const next=structuredClone(room.room);next.appearanceCheckedAt=0;await room.commit(next);});
  assert.equal(room.room.appearance.themeId,'noir.roomTheme','ongoing match keeps its visual snapshot');
  await assert.rejects(owner.command('appearance',{themeId:null}),{code:'PHASE'});
  // A completed-game fixture exercises the real restart command and safe boundary.
  await room.serial(async()=>{const next=structuredClone(room.room);next.phase='over';next.deadlineAt=null;await room.commit(next);});
  await until(()=>owner.state.phase==='over');await owner.command('restart');assert.equal(room.room.appearance,null);
  assert.equal((await h.api(host,'/api/me/cosmetics')).body.preferred.roomThemeId,'sahra.roomTheme','expiry never erases personal preferences');
});

test('host transfer re-evaluates the new owner and a free host cannot forge a theme',async t=>{
  const h=await setup(t),host=h.people[0];await h.grant(host);const {room,code}=await h.open();
  await h.clients[0].command('appearance',{themeId:'artist.roomTheme',accountAuthorization:`Bearer ${host.accountToken}`});
  assert.equal((await h.api(host,`/api/rooms/${code}/leave`,host)).status,200);
  await until(()=>h.clients[1].state?.hostId===h.people[1].id);assert.equal(room.room.appearance,null);
  await assert.rejects(h.clients[1].command('appearance',{themeId:'noir.roomTheme',accountAuthorization:`Bearer ${h.people[1].accountToken}`}),{code:'PLUS_REQUIRED'});
  await h.clients[1].command('appearance',{themeId:null});assert.equal(room.room.appearance,null);
  await h.grant(h.people[1]);await h.clients[1].command('appearance',{themeId:'noir.roomTheme',accountAuthorization:`Bearer ${h.people[1].accountToken}`});assert.equal(room.room.appearance.themeId,'noir.roomTheme');
});

test('premium reactions require live account plus entitlement and cannot borrow another bearer',async t=>{
  const h=await setup(t),host=h.people[0];await h.grant(host);const {room}=await h.open(),events=[];h.clients[1].subscribeReactions(e=>events.push(e));
  await h.clients[0].reactCosmetic('sahra.sticker.1');await until(()=>events.length===1);assert.equal(events[0].reactionId,'sahra.sticker.1');assert.equal(JSON.stringify(events).includes(host.accountId),false);
  await assert.rejects(h.clients[1].reactCosmetic('artist.sticker.1'),{code:'PLUS_REQUIRED'});
  await assert.rejects(h.clients[1].command('react',{reactionId:'artist.sticker.2',accountAuthorization:`Bearer ${host.accountToken}`}),{code:'AUTH'});
  await until(()=>h.clients[1].connectionStatus==='connected'||h.clients[1].stopped);assert.equal(events.length,1);
  // Fresh third seat can still send the unchanged free reaction set.
  await h.clients[2].react(ROOM_REACTIONS[0]);await until(()=>events.length===2);
  await revokeSession(h.app.env,host.accountSession,Date.now()-1);
  await assert.rejects(h.clients[0].command('appearance',{themeId:'noir.roomTheme',accountAuthorization:`Bearer ${host.accountToken}`}),e=>['AUTH','AUTH_EXPIRED'].includes(e.code));
  assert.equal(room.room.appearance,null);
  const fresh=await issueSession(h.app.env,host.accountId);host.accountToken=fresh.token;
  // Reconnect the same room seat, then refund: gameplay still works but paid sends stop.
  h.clients[0].start();await until(()=>h.clients[0].connectionStatus==='connected');await h.grant(host,Date.now()+86400000,'refunded');
  await assert.rejects(h.clients[0].reactCosmetic('noir.sticker.1'),{code:'PLUS_REQUIRED'});
  await h.clients[0].react(ROOM_REACTIONS[0]);
});


test('Plus stickers never bypass Mafia private-phase communication rules',async t=>{
  const h=await setup(t,6),host=h.people[0];await h.grant(host);
  Object.assign(h.app.env,{MAFIA_ENABLED:'1',LIVEKIT_URL:'wss://plus-mafia-fixture.livekit.cloud',LIVEKIT_API_KEY:'fixture-key',LIVEKIT_API_SECRET:'fixture-secret'});
  for(const person of h.people){person.game='mafia';person.capabilities={mafia:1};person.settings={mode:'classic',capacity:6,visibility:'private'};}
  const nativeFetch=globalThis.fetch;t.mock.method(globalThis,'fetch',async(url,options)=>String(url).includes('plus-mafia-fixture.livekit.cloud')?Response.json({}):nativeFetch(url,options));
  const {room}=await h.open(),events=[];h.clients[1].subscribeReactions(e=>events.push(e));
  await h.clients[0].reactCosmetic('noir.sticker.1');await until(()=>events.length===1);
  for(const c of h.clients.slice(1))await c.command('ready',{ready:true});await h.clients[0].command('start');assert.equal(room.room.phase,'role');
  await assert.rejects(h.clients[0].reactCosmetic('noir.sticker.2'),{code:'PRIVATE'});
  await assert.rejects(h.clients[0].react(ROOM_REACTIONS[0]),{code:'PRIVATE'});assert.equal(events.length,1);
});

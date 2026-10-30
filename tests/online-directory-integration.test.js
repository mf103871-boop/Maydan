import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { startLocalServer } from '../server/local.mjs';
import { createUser, deleteUser } from '../server/accounts/db.mjs';
import { issueSession } from '../server/accounts/session.mjs';
import { newCredentials, RoomClient } from '../src/online/client.js';
import { ROOM_CAPABILITIES } from '../src/online/shared.js';
import { listOnlineDirectory, cleanupOnlineDirectory } from '../server/online-directory.mjs';

const origin='http://localhost:3000';
class BrowserSocket extends WebSocket { constructor(url){super(url,{origin});} }
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(predicate,label){for(let n=0;n<350;n++){if(await predicate())return;await delay(10);}assert.fail(label);}
function badeehaSettings(){const categories=['c1','c2','c3','c4','c5','c6'],deck=Object.fromEntries(categories.map(id=>[id,[]]));for(let n=0;n<20;n++)deck[categories[n%6]].push({qid:`private-question-${n}`,p:200});return{mode:'standard',roundSize:20,timer:60,categories,deck};}
const seat=(name)=>({...newCredentials(),name,avatar:0,capabilities:ROOM_CAPABILITIES});
function creation(game,owner,visibility='public'){return{...owner,game,rounds:5,...(game==='badeeha'?{settings:badeehaSettings()}:{}),...(visibility?{directory:{visibility,name:`غرفة ${game}`}}:{})};}
async function setup(t,enabled=true){const app=await startLocalServer({port:0,vars:enabled?{ONLINE_PUBLIC_DIRECTORY_ENABLED:'1'}:{}});t.after(()=>app.close());const users=[];for(let n=0;n<7;n++){const user=await createUser(app.env,{name:`لاعب ${n}`,email:`${crypto.randomUUID()}@example.test`}),session=await issueSession(app.env,user.id);users.push({...user,token:session.token,sessionId:session.id});}return{app,users};}
async function request(app,path,{body,user,method=body?'POST':'GET'}={}){const response=await fetch(app.url+path,{method,headers:{origin,...(body?{'content-type':'application/json'}:{}),...(user?{authorization:`Bearer ${user.token}`}:{})},...(body?{body:JSON.stringify(body)}:{})});return{status:response.status,body:await response.json()};}
const list=(app,game,user,query='')=>request(app,`/api/online/rooms/public?game=${game}${query}`,{user});
const create=(app,input,user)=>request(app,'/api/rooms',{body:input,user});
const join=(app,code,input,user)=>request(app,`/api/rooms/${code}/join`,{body:input,user});
function connect(t,app,code,profile,user){const client=new RoomClient({server:app.url,code,session:profile,getAccountAuthorization:()=>user?`Bearer ${user.token}`:null,WebSocketImpl:BrowserSocket});t.after(()=>client.stop());client.start();return client;}

test('real local directory isolates four games, opts in explicitly and returns no account, seat or answer data',async t=>{
  const{app,users}=await setup(t);const created=[];
  for(const game of ['meenfina','fabraka','ersomha','badeeha']){const owner=seat('صاحب الغرفة'),result=await create(app,creation(game,owner),users[0]);assert.equal(result.status,201,JSON.stringify(result.body));created.push({game,owner,code:result.body.code});}
  const privateOwner=seat('ضيف خاص');assert.equal((await create(app,creation('meenfina',privateOwner,null))).status,201);
  for(const room of created){const page=await list(app,room.game,users[1]);assert.equal(page.status,200);assert.equal(page.body.rooms.length,1);const row=page.body.rooms[0];assert.equal(row.code,room.code);assert.equal(row.game,room.game);assert.equal(row.unit,room.game==='badeeha'?'teams':'players');assert.equal(row.players,1);assert.equal(row.status,'waiting');assert.equal(row.joinable,true);assert.deepEqual(Object.keys(row).sort(),['capacity','code','createdAt','full','game','joinable','minimum','players','roomName','status','unit']);const serialized=JSON.stringify(page.body);for(const secret of [room.owner.id,room.owner.token,users[0].id,'private-question-','tokenHash','member_user_ids','room_key'])assert.equal(serialized.includes(secret),false,`leaked ${secret}`);}
  assert.equal((await list(app,'mafia',users[1])).body.error,'GAME');
  assert.equal((await list(app,'meenfina')).status,401);
});

test('public creation and admission cannot forge an account; legacy private rooms keep guest code/seat flow',async t=>{
  const{app,users}=await setup(t);const owner=seat('مضيف');
  assert.equal((await create(app,{...creation('meenfina',owner),accountUserId:users[0].id})).body.error,'AUTH_REQUIRED');
  const pub=await create(app,creation('meenfina',owner),users[0]);assert.equal(pub.status,201);
  const newcomer=seat('ضيف');assert.equal((await join(app,pub.body.code,{...newcomer,accountUserId:users[1].id})).body.error,'AUTH_REQUIRED');
  const wrongGame=await join(app,pub.body.code,{...newcomer,game:'ersomha',directoryJoin:true},users[1]);assert.equal(wrongGame.body.error,'GAME');
  assert.equal(app.rooms.get(pub.body.code).instance.room.members.length,1);
  const privSeat=seat('خاص'),priv=await create(app,creation('meenfina',privSeat,null));assert.equal(priv.status,201);
  assert.equal((await join(app,priv.body.code,{...newcomer,game:'meenfina',directoryJoin:true},users[1])).body.error,'GAME');
  assert.equal((await join(app,priv.body.code,newcomer)).status,200);
  const client=connect(t,app,priv.body.code,privSeat);await until(()=>client.state?.phase==='lobby','legacy guest did not connect');assert.equal(client.state.directory,undefined);
});

test('default-off directory works against an old database without migration26 and never opens private rooms',async t=>{
  const{app,users}=await setup(t,false);await app.env.DB.exec('DROP TABLE online_public_rooms');
  const page=await list(app,'meenfina',users[0]);assert.equal(page.status,200);assert.equal(page.body.enabled,false);assert.deepEqual(page.body.rooms,[]);
  assert.equal((await create(app,creation('meenfina',seat('خاص'),null))).status,201);
  assert.equal((await create(app,creation('meenfina',seat('عام')),users[0])).body.error,'DIRECTORY_DISABLED');
  await cleanupOnlineDirectory(app.env);
  await deleteUser(app.env,users[6].id);
  assert.equal(await app.env.DB.prepare('SELECT 1 FROM users WHERE id=?').bind(users[6].id).first(),null);
});

test('two simultaneous real HTTP joins compete for the last authoritative team seat',async t=>{
  const{app,users}=await setup(t),owner=seat('المضيف'),created=await create(app,creation('badeeha',owner),users[0]),code=created.body.code;
  for(let n=1;n<=2;n++)assert.equal((await join(app,code,seat(`فريق ${n}`),users[n])).status,200);
  const attempts=await Promise.all([join(app,code,{...seat('فريق رابع'),game:'badeeha',directoryJoin:true},users[3]),join(app,code,{...seat('فريق خامس'),game:'badeeha',directoryJoin:true},users[4])]);
  assert.deepEqual(attempts.map(value=>value.status).sort(),[200,409]);assert.equal(attempts.find(value=>value.status===409).body.error,'FULL_BADEEHA');
  const rows=(await list(app,'badeeha',users[5])).body.rooms;assert.equal(rows[0].players,4);assert.equal(rows[0].capacity,4);assert.equal(rows[0].full,true);assert.equal(rows[0].joinable,false);
  assert.equal(app.rooms.get(code).instance.room.members.filter(member=>!member.left).length,4);
});

test('public WS uses current verified identity, reclaims the same seat on reconnect and preserves readiness after rehydration',async t=>{
  const{app,users}=await setup(t),owner=seat('المضيف'),other=seat('الصديق'),created=await create(app,creation('meenfina',owner),users[0]),code=created.body.code;
  assert.equal((await join(app,code,other,users[1])).status,200);
  const a=connect(t,app,code,owner,users[0]),b=connect(t,app,code,other,users[1]);
  await until(()=>a.state?.members.every(member=>member.connected)&&b.state?.members.every(member=>member.connected),'public challenge handshake failed');
  await b.command('ready',{ready:true});await until(()=>a.state.members.find(member=>member.id===other.id).ready,'ready did not reach peer');
  a.reconnectNow();await until(()=>a.connectionStatus==='connected'&&a.state?.directory?.visibility==='public','public reconnect failed');
  assert.equal(app.rooms.get(code).instance.room.members.length,2);
  await app.rehydrate(code);b.reconnectNow();await until(()=>b.connectionStatus==='connected'&&b.state.members.find(member=>member.id===other.id).ready,'rehydrated readiness lost');
  const duplicate=await join(app,code,seat('مقعد مزور'),users[1]);assert.equal(duplicate.body.error,'ACCOUNT_IN_ROOM');
  const wrong=await create(app,creation('meenfina',owner),users[2]);assert.equal(wrong.body.error,'AUTH');
  const stolen=new BrowserSocket(app.url.replace('http:','ws:')+`/api/rooms/${code}/socket`),frames=[];t.after(()=>stolen.terminate());stolen.on('message',raw=>frames.push(JSON.parse(String(raw))));await new Promise(resolve=>stolen.once('open',resolve));stolen.send(JSON.stringify({type:'auth',...owner,accountAuthorization:`Bearer ${users[2].token}`}));await until(()=>stolen.readyState===WebSocket.CLOSED,'borrowed credentials did not close');assert.equal(frames.some(frame=>frame.type==='state'),false);
});

test('failed durable membership writes never advance the discovery count',async t=>{
  const{app,users}=await setup(t),created=await create(app,creation('meenfina',seat('المضيف')),users[0]),code=created.body.code,item=app.rooms.get(code),put=item.storage.put.bind(item.storage);let fail=true;
  item.storage.put=async(key,value)=>{if(key==='room'&&fail){fail=false;throw new Error('intentional local persistence failure');}return put(key,value);};
  const newcomer=seat('الصديق'),rejected=await join(app,code,newcomer,users[1]);assert.equal(rejected.status,500);assert.equal((await list(app,'meenfina',users[2])).body.rooms[0].players,1);assert.equal(item.instance.room.members.length,1);
  assert.equal((await join(app,code,newcomer,users[1])).status,200);assert.equal((await list(app,'meenfina',users[2])).body.rooms[0].players,2);
});

test('directory lease expires closed, refreshes on room alarm and removes ended rooms without changing gameplay',async t=>{
  let now=Date.now();t.mock.method(Date,'now',()=>now);const{app,users}=await setup(t),created=await create(app,creation('meenfina',seat('المضيف')),users[0]),code=created.body.code,item=app.rooms.get(code);
  const first=await app.env.DB.prepare('SELECT expires_at FROM online_public_rooms WHERE room_code=?').bind(code).first();
  now+=31_000;await item.instance.alarm();const refreshed=await app.env.DB.prepare('SELECT expires_at FROM online_public_rooms WHERE room_code=?').bind(code).first();assert.equal(refreshed.expires_at-first.expires_at,31_000);
  now+=91_000;assert.equal((await list(app,'meenfina',users[1])).body.rooms.length,0,'stale row must not advertise a seat');await item.instance.alarm();assert.equal((await list(app,'meenfina',users[1])).body.rooms.length,1);
  const ended=structuredClone(item.instance.room);ended.phase='over';ended.deadlineAt=null;await item.instance.serial(()=>item.instance.commit(ended));assert.equal((await list(app,'meenfina',users[1])).body.rooms.length,0);assert.equal(item.instance.room.phase,'over');
  const waiting=structuredClone(item.instance.room);waiting.phase='lobby';await item.instance.serial(()=>item.instance.commit(waiting));assert.equal((await list(app,'meenfina',users[1])).body.rooms.length,1);
  now=item.instance.room.expiresAt+1;await item.instance.alarm();assert.equal(item.instance.room,null);assert.equal((await list(app,'meenfina',users[1])).body.rooms.length,0);
});

test('block relationships filter discovery and are checked again against committed participants at admission',async t=>{
  const{app,users}=await setup(t),created=await create(app,creation('meenfina',seat('المضيف')),users[0]),code=created.body.code;
  await app.env.DB.prepare('INSERT INTO social_blocks(blocker_id,blocked_id,created_at) VALUES(?,?,?)').bind(users[1].id,users[0].id,Date.now()).run();
  assert.equal((await list(app,'meenfina',users[1])).body.rooms.length,0);assert.equal((await list(app,'meenfina',users[2])).body.rooms.length,1);
  assert.equal((await join(app,code,seat('محظور'),users[1])).body.error,'ROOM_BLOCKED');assert.equal(app.rooms.get(code).instance.room.members.length,1);
});

test('bounded directory pagination is stable across occupancy changes and rejects malformed cursors',async t=>{
  const{app,users}=await setup(t);for(let n=0;n<3;n++)assert.equal((await create(app,creation('meenfina',seat(`مضيف ${n}`)),users[0])).status,201);
  const first=await listOnlineDirectory(app.env,users[1].id,{game:'meenfina',limit:2});assert.equal(first.rooms.length,2);assert.ok(first.nextCursor);
  await join(app,first.rooms[0].code,seat('ضيف'),users[1]);const second=await listOnlineDirectory(app.env,users[1].id,{game:'meenfina',limit:2,cursor:first.nextCursor});assert.equal(second.rooms.length,1);assert.equal(first.rooms.some(room=>room.code===second.rooms[0].code),false);
  for(const cursor of ['!',btoa(JSON.stringify([1,'x'])),btoa(JSON.stringify([1,'123456','extra']))])await assert.rejects(listOnlineDirectory(app.env,users[1].id,{game:'meenfina',cursor}),error=>error.code==='INVALID');
  await assert.rejects(listOnlineDirectory(app.env,users[1].id,{game:'meenfina',limit:100}),error=>error.code==='INVALID');
});

test('account deletion removes derived directory identities even without foreign keys and heartbeat cannot resurrect them',async t=>{
  const{app,users}=await setup(t),created=await create(app,creation('meenfina',seat('المضيف')),users[0]),code=created.body.code;
  await join(app,code,seat('الصديق'),users[1]);await app.env.DB.exec('PRAGMA foreign_keys=OFF');
  assert.equal((await app.env.DB.prepare('SELECT member_user_ids FROM online_public_rooms WHERE room_code=?').bind(code).first()).member_user_ids.includes(users[1].id),true);
  await deleteUser(app.env,users[1].id);assert.equal(await app.env.DB.prepare('SELECT 1 FROM online_public_rooms WHERE room_code=?').bind(code).first(),null);
  const item=app.rooms.get(code);item.instance.onlineDirectoryRefreshAt=0;await item.instance.serial(()=>item.instance.settleOnlineMetadata(item.instance.room));
  const refreshed=await app.env.DB.prepare('SELECT member_user_ids FROM online_public_rooms WHERE room_code=?').bind(code).first();assert.ok(refreshed);assert.equal(refreshed.member_user_ids.includes(users[1].id),false);
  await deleteUser(app.env,users[0].id);assert.equal(await app.env.DB.prepare('SELECT 1 FROM online_public_rooms WHERE room_code=?').bind(code).first(),null);
  item.instance.onlineDirectoryRefreshAt=0;await item.instance.serial(()=>item.instance.settleOnlineMetadata(item.instance.room));assert.equal(await app.env.DB.prepare('SELECT 1 FROM online_public_rooms WHERE room_code=?').bind(code).first(),null);
});

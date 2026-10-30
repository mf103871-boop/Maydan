import test from 'node:test';
import assert from 'node:assert/strict';
import * as mafia from '../server/mafia-model.mjs';
import {Room} from '../server/room.mjs';
import {bindSeatAccount,prepareRoomStats} from '../server/room-stats.mjs';
import {prepareMafiaResult} from '../server/mafia-results.mjs';
import {createLocalD1} from '../server/local-d1.mjs';
import {MAFIA_METRIC_PHASES} from '../src/online/mafia-metrics.mjs';

const NOW=1800000000000,SECRET='ROOM_ACCOUNT_SESSION_ROLE_TARGET_CHAT_IP_TOKEN_SENTINEL';
const total=(records,key)=>records.reduce((sum,record)=>sum+record[key],0);
class Storage {
  constructor(entries=[]) {this.data=new Map(entries);this.failDrain=false;this.failTransaction=false;}
  async get(key){return structuredClone(this.data.get(key));}
  async put(key,value){if(this.failDrain&&key==='mafiaResultOutbox'&&!value.length)throw new Error(SECRET);this.data.set(key,structuredClone(value));}
  async delete(key){this.data.delete(key);}
  async setAlarm(at){this.alarm=at;}
  async deleteAlarm(){this.alarm=null;}
  async transaction(fn){if(this.failTransaction)throw new Error(SECRET);const before=new Map(this.data);try{return await fn(this);}catch(error){this.data=before;throw error;}}
}
function startRoom(){
  const person=n=>({id:`seat-${n}`,tokenHash:SECRET,name:`لاعب ${n}`,avatar:0});
  const room=mafia.createRoom('ABC123',{...person(0),settings:{mode:'classic',capacity:6,visibility:'public',voiceMode:'off'}},NOW);
  for(let n=1;n<6;n++)mafia.joinRoom(room,person(n),NOW);
  for(let n=0;n<6;n++) {bindSeatAccount(room,`seat-${n}`,`account-${n}`);mafia.connected(room,`seat-${n}`,true,NOW);mafia.action(room,`seat-${n}`,{type:'ready',ready:true,matchId:room.matchId,phaseId:room.phaseId},NOW);}
  const previous=structuredClone(room);let random=12;
  mafia.action(room,'seat-0',{type:'start',matchId:room.matchId,phaseId:room.phaseId},NOW,{randomWord:()=>random=(Math.imul(random,1664525)+1013904223)>>>0});
  room.mafiaKey=SECRET;prepareRoomStats(previous,room,NOW,{mafiaProgressEnabled:true});return {previous,room};
}
async function instanceFor(storage,env){
  const instance=new Room({storage,blockConcurrencyWhile:fn=>fn(),getWebSockets:()=>[]},env);await instance.ready;
  instance.settleMafiaMetadata=async()=>{};instance.broadcast=()=>{};return instance;
}
function recordLogs(t){const records=[];t.mock.method(console,'info',(prefix,record)=>{assert.equal(prefix,'[mafia-metrics]');records.push(JSON.parse(record));});return records;}

test('phase metrics follow successful durable commits, ignore repeats/terminal phases, and cannot fail a commit when the sink fails',async t=>{
  let now=NOW;t.mock.method(Date,'now',()=>now);const records=recordLogs(t),{previous,room}=startRoom();
  const storage=new Storage([['room',previous]]),instance=await instanceFor(storage,{MAFIA_METRICS_ENABLED:'1'});
  storage.failTransaction=true;await assert.rejects(instance.commit(structuredClone(room),{prepared:true}));
  now+=60000;assert.equal(instance.metrics.flush(),null);assert.equal(instance.room.phase,'lobby');
  storage.failTransaction=false;await instance.commit(structuredClone(room),{prepared:true});
  await instance.commit(structuredClone(instance.room),{prepared:true});
  assert.equal(records.length,1);assert.equal(records[0].phaseCommitted[0],1);
  const next=structuredClone(instance.room);next.phase='opening';next.phaseId++;
  now+=60000;await instance.commit(next,{prepared:true});
  assert.equal(records[1].phaseCommitted[MAFIA_METRIC_PHASES.indexOf('opening')],1);
  assert.equal(records[1].phaseLagMs.reduce((a,b)=>a+b,0),1);
  const over=structuredClone(instance.room);over.phase='over';over.phaseId++;over.technicalAbort=true;
  now+=60000;await instance.commit(over,{prepared:true});assert.equal(records.length,2,'terminal phase must not expose an early end');
  const restart=structuredClone(room);restart.matchId++;
  t.mock.method(console,'info',()=>{throw new Error(SECRET);});
  now+=60000;await instance.commit(restart,{prepared:true});assert.equal((await storage.get('room')).phase,'role');
  assert.ok(!JSON.stringify(records).includes(SECRET));
});

test('the server gate is off by default and accepts only the explicit 1 setting',async t=>{
  let now=NOW;t.mock.method(Date,'now',()=>now);const records=recordLogs(t);
  for(const flag of [undefined,'0','true',true,'01']) {
    const {previous,room}=startRoom(),storage=new Storage([['room',previous]]);
    const instance=await instanceFor(storage,{MAFIA_METRICS_ENABLED:flag});now+=60000;
    await instance.commit(room,{prepared:true});assert.equal(instance.metrics.flush(),null);
  }
  assert.deepEqual(records,[]);
});

async function outboxFixture(t){
  let now=NOW;t.mock.method(Date,'now',()=>now);const records=recordLogs(t),DB=createLocalD1();t.after(()=>DB.close());
  for(let n=0;n<6;n++)await DB.prepare('INSERT INTO users(id,name,created_at,updated_at) VALUES(?,?,?,?)').bind(`account-${n}`,'اختبار',NOW,NOW).run();
  const {room}=startRoom();room.phase='over';room.phaseId++;room.outcome={faction:'town',reason:'faction',endedAt:NOW+1000};room.winners=room.participants.filter(id=>room.roleStates[id].faction==='town');
  const event=prepareMafiaResult(room,NOW+1000),storage=new Storage([['mafiaResultOutbox',[event]]]);
  const env={DB,MAFIA_METRICS_ENABLED:'1',MAFIA_PROGRESS_ENABLED:'1'},instance=await instanceFor(storage,env);
  return {DB,records,event,storage,env,instance,at:value=>{now=value;}};
}

test('no result metric precedes 30s, consumer success and durable ACK; failures and reconstruction cannot double count',async t=>{
  const f=await outboxFixture(t);f.at(f.event.notBefore-1);await f.instance.flushMafiaResults();assert.deepEqual(f.records,[]);
  assert.equal((await f.DB.prepare('SELECT COUNT(*) AS n FROM mafia_progress_events').first()).n,0);
  let fault='archive';f.env.DB={prepare:f.DB.prepare.bind(f.DB),batch:statements=>{
    if(fault==='archive'||fault==='progress'&&statements.some(s=>s.sql.includes('INSERT INTO mafia_progress_events')))throw new Error(SECRET);
    return f.DB.batch(statements);
  }};
  f.at(NOW+60000);await f.instance.flushMafiaResults();assert.equal(f.instance.mafiaResultOutbox.length,1);assert.deepEqual(f.records,[]);
  fault='progress';await f.instance.flushMafiaResults();assert.equal((await f.DB.prepare('SELECT COUNT(*) AS n FROM mafia_history').first()).n,1);assert.deepEqual(f.records,[]);
  fault=null;f.storage.failDrain=true;
  await assert.rejects(f.instance.flushMafiaResults(),{code:'MAFIA_RESULT_RETRY'});assert.deepEqual(f.records,[]);
  assert.equal((await f.DB.prepare('SELECT COUNT(*) AS n FROM mafia_progress_events').first()).n,6);
  const before=await f.DB.prepare('SELECT SUM(total_xp) AS xp FROM mafia_player_progress').first();
  f.storage.failDrain=false;const restored=await instanceFor(f.storage,f.env);await restored.flushMafiaResults();
  assert.equal(restored.mafiaResultOutbox.length,0);assert.deepEqual(f.records,[]);
  f.at(NOW+120000);await restored.flushMafiaResults();await restored.flushMafiaResults();
  assert.equal(total(f.records,'resultDrained'),1);assert.equal(f.records.length,1);
  const acknowledged=await instanceFor(f.storage,f.env);f.at(NOW+180000);await acknowledged.flushMafiaResults();
  assert.equal(total(f.records,'resultDrained'),1);assert.deepEqual(await f.DB.prepare('SELECT SUM(total_xp) AS xp FROM mafia_player_progress').first(),before);
  assert.ok(!JSON.stringify(f.records).includes(SECRET));assert.ok(f.records.every(record=>Buffer.byteLength(JSON.stringify(record))<=1024));
});

test('legacy archive timing stays unchanged while its result metric still waits END+30s',async t=>{
  const f=await outboxFixture(t);delete f.event.notBefore;f.event.rewardPolicyVersion=null;
  await f.storage.put('mafiaResultOutbox',[f.event]);f.instance.mafiaResultOutbox=[f.event];
  f.at(f.event.finishedAt+1);await f.instance.flushMafiaResults();assert.equal(f.instance.mafiaResultOutbox.length,0);assert.deepEqual(f.records,[]);
  f.at(f.event.finishedAt+29999);await f.instance.flushMafiaResults();assert.deepEqual(f.records,[]);
  f.at(NOW+60000);await f.instance.flushMafiaResults();assert.equal(total(f.records,'resultDrained'),1);
});

test('live socket hooks measure bounded queue/RPC attempts without command contents or error details',async t=>{
  let now=NOW;t.mock.method(Date,'now',()=>now);const records=recordLogs(t),{room}=startRoom();
  const DB={prepare:()=>({bind(){return this;},async first(){return {ok:1};}})};
  const instance=await instanceFor(new Storage([['room',room]]),{DB,MAFIA_METRICS_ENABLED:'1'});
  instance.advance=async()=>{};instance.directoryFeed.active=async()=>false;
  let attachment={id:'seat-0',accountUserId:SECRET,accountSessionId:SECRET},failReaction=false;
  const replies=[],ws={readyState:1,serializeAttachment:value=>{attachment=value;},deserializeAttachment:()=>attachment,send:value=>replies.push(value),close(){}};
  instance.reaction=async()=>{if(failReaction)throw new Error(SECRET);};
  let release;const barrier=instance.serial(()=>new Promise(resolve=>{release=resolve;}));await new Promise(resolve=>setImmediate(resolve));
  const command={type:'react',requestId:SECRET,targetId:SECRET,chat:SECRET,roleId:SECRET};
  const task=instance.webSocketMessage(ws,JSON.stringify(command));now+=125;release();await barrier;await task;
  failReaction=true;await instance.webSocketMessage(ws,JSON.stringify(command));
  now=NOW+60000;await instance.webSocketMessage(ws,'ping');
  assert.equal(replies.filter(value=>JSON.parse(value==='pong'?'{}':value).type==='ack').length,2);
  assert.equal(records.length,1);assert.deepEqual(records[0].commands,{ok:1,rejected:1,timeout:0,transport:0});
  assert.equal(records[0].queueMs.reduce((a,b)=>a+b,0),2);assert.equal(records[0].queueMs[2],1);
  assert.ok(!JSON.stringify(records).includes(SECRET));
});

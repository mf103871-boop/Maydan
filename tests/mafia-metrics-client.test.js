import test from 'node:test';
import assert from 'node:assert/strict';
import {RoomClient} from '../src/online/client.js';

const NOW=1800000000000,SECRET='ROOM_USER_SESSION_ROLE_TARGET_CHAT_IP_TOKEN_SENTINEL';
const sum=values=>values.reduce((total,value)=>total+value,0);
function fixture(t,options={}) {
  t.mock.timers.enable({apis:['setTimeout','setInterval','Date'],now:NOW});
  const sockets=[],records=[];
  class Socket {
    constructor(url){this.url=url;this.readyState=0;this.sent=[];this.bufferedAmount=0;sockets.push(this);}
    send(value){if(this.throwSend)throw new Error(SECRET);this.sent.push(value==='ping'?value:JSON.parse(value));}
    close(){this.readyState=3;}
    open(){this.readyState=1;this.onopen();}
    receive(value){this.onmessage({data:value==='pong'?value:JSON.stringify(value)});}
    state(revision=1,game='mafia'){this.receive({type:'state',state:{game,protocol:1,revision,matchId:7,phaseId:3,round:1,serverNow:Date.now(),you:{roleId:SECRET},chats:{team:[{text:SECRET}]}}});}
  }
  const client=new RoomClient({server:'http://localhost:3000',code:'ABC123',session:{id:SECRET,token:SECRET},getAccountAuthorization:()=>`Bearer ${SECRET}`,
    WebSocketImpl:Socket,onMetrics:record=>records.push(record),...options});
  t.after(()=>client.stop());client.start();return {client,sockets,records,at:offset=>t.mock.timers.setTime(NOW+offset)};
}

test('initial readiness and reconnect include the full episode once; stale sockets/duplicate states and ACKs cannot add samples',async t=>{
  let fetchCalls=0;t.mock.method(globalThis,'fetch',async()=>{fetchCalls++;throw new Error('unexpected upload');});
  const f=fixture(t),old=f.sockets[0];old.open();f.at(80);old.state();old.state();old.state(0);
  f.client.start();old.receive('pong');assert.equal(f.sockets.length,1);
  f.at(5000);old.readyState=3;old.onclose({code:1006});
  f.at(5200);f.client.reconnectNow();const current=f.sockets[1];current.open();f.at(5400);current.state(2);current.state(2);
  old.state(99);old.onclose({code:1006});assert.equal(f.client.state.revision,2);
  f.at(5500);const ok=f.client.command('night_action',{targetId:SECRET,text:SECRET}),okId=current.sent.at(-1).requestId;
  f.at(6000);current.receive({type:'ack',requestId:okId,ok:true});current.receive({type:'ack',requestId:okId,ok:true});await ok;
  const rejected=f.client.command('mafia_vote',{targetId:SECRET}),rejectedId=current.sent.at(-1).requestId;
  current.receive({type:'ack',requestId:rejectedId,ok:false,error:SECRET});await assert.rejects(rejected,{code:SECRET});
  current.receive({type:'ack',requestId:rejectedId,ok:false,error:SECRET});assert.deepEqual(f.records,[]);
  f.at(60000);current.receive('pong');
  assert.equal(f.records.length,1);const record=f.records[0];
  assert.equal(sum(record.connectionReady.initial),1);assert.equal(record.connectionReady.initial[1],1);
  assert.equal(sum(record.connectionReady.recovery),1);assert.equal(record.connectionReady.recovery[3],1,'recovery includes 200ms backoff + 200ms handshake');
  assert.deepEqual(record.commands,{ok:1,rejected:1,timeout:0,transport:0});assert.equal(sum(record.commandMs),2);
  assert.ok(!JSON.stringify(record).includes(SECRET));assert.doesNotMatch(JSON.stringify(record),/ABC123|Bearer|localhost|requestId|roleId|targetId|text|1800000/);
  assert.equal(fetchCalls,0);assert.ok(Buffer.byteLength(JSON.stringify(record))<=1024);
  f.at(120000);current.state(3);assert.equal(f.records.length,1,'ordinary snapshots do not count as reconnects');
});

test('timeouts, send failure and bounded pending rejection settle each command once, including late ACKs',async t=>{
  const f=fixture(t),first=f.sockets[0];first.open();first.state();
  const waiting=f.client.command('chat',{text:SECRET}).catch(error=>error.code),expiredId=first.sent.at(-1).requestId;
  t.mock.timers.tick(9999);assert.equal(f.client.pending.size,1);t.mock.timers.tick(1);assert.equal(await waiting,'TIMEOUT');
  first.receive({type:'ack',requestId:expiredId,ok:true});
  const lost=f.client.command('night_action',{targetId:SECRET}).catch(error=>error.code),lostId=first.sent.at(-1).requestId;
  f.client.reconnectNow();assert.equal(await lost,'DISCONNECTED');first.receive({type:'ack',requestId:lostId,ok:true});
  const second=f.sockets[1];second.open();second.state(2);second.throwSend=true;
  await assert.rejects(f.client.command('night_action',{targetId:SECRET}),{code:'DISCONNECTED'});second.throwSend=false;
  const bounded=Array.from({length:32},()=>f.client.command('chat',{text:SECRET}).catch(error=>error.code));
  assert.equal(f.client.pending.size,32);await assert.rejects(f.client.command('chat',{text:SECRET}),{code:'DISCONNECTED'});
  assert.deepEqual(await Promise.all(bounded),Array(32).fill('DISCONNECTED'));assert.equal(f.client.pending.size,0);
  const third=f.sockets[2];third.open();third.state(3);
  f.at(60000);third.receive('pong');assert.equal(f.records.length,1);
  assert.deepEqual(f.records[0].commands,{ok:0,rejected:0,timeout:1,transport:34});
  assert.equal(sum(f.records[0].commandMs),35);assert.ok(!JSON.stringify(f.records).includes(SECRET));
  f.at(120000);third.receive('pong');assert.equal(f.records.length,1,'cleared timeouts and late socket messages cannot replay settlements');
});

test('optional callback stays off by default and other games never produce Mafia observations',async t=>{
  const f=fixture(t,{onMetrics:undefined});f.sockets[0].open();f.sockets[0].state();f.at(60000);f.sockets[0].receive('pong');
  assert.equal(f.client.metrics.flush(),null);assert.deepEqual(f.records,[]);
  f.client.stop();
  const records=[],client=new RoomClient({server:'http://localhost:3000',code:'DEF456',session:{id:SECRET,token:SECRET},WebSocketImpl:f.sockets[0].constructor,onMetrics:record=>records.push(record)});
  t.after(()=>client.stop());client.start();const socket=f.sockets.at(-1);socket.open();socket.state(1,'meenfina');
  const pending=client.command('vote',{targetId:SECRET}),requestId=socket.sent.at(-1).requestId;socket.receive({type:'ack',requestId,ok:true});await pending;
  f.at(120000);socket.receive('pong');assert.equal(client.metrics.flush(),null);assert.deepEqual(records,[]);
});

test('a broken optional callback cannot interrupt readiness, command ACKs or recovery',async t=>{
  const f=fixture(t,{onMetrics:()=>{throw new Error(SECRET);}}),socket=f.sockets[0];socket.open();socket.state();
  const pending=f.client.command('chat',{text:SECRET}),requestId=socket.sent.at(-1).requestId;
  f.at(60000);socket.receive({type:'ack',requestId,ok:true});await pending;assert.equal(f.client.connectionStatus,'connected');
  f.client.reconnectNow();const recovered=f.sockets[1];recovered.open();recovered.state(2);assert.equal(f.client.state.revision,2);
});

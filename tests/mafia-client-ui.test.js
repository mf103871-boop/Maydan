import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomClient, getPublicRooms, subscribePublicRooms } from '../src/online/client.js';

class Socket {
  static current;
  constructor() { this.readyState=1;this.sent=[];Socket.current=this; }
  send(value) { this.sent.push(JSON.parse(value)); }
  close() { this.readyState=3; }
  receive(message) { this.onmessage({data:JSON.stringify(message)}); }
}

test('Mafia client accepts pinned old rooms and current rooms, rejecting an unknown protocol',()=>{
  const seen=[],errors=[];
  const client=new RoomClient({server:'http://localhost:3000',code:'123456',session:{id:'player',token:'test-token'},WebSocketImpl:Socket,onState:state=>seen.push(state),onError:code=>errors.push(code)});
  client.start();const socket=Socket.current;
  try {
    socket.onopen();
    for(const protocol of [1,2,3])socket.receive({type:'state',state:{game:'mafia',protocol,revision:protocol,serverNow:Date.now()}});
    assert.deepEqual(seen.map(state=>state.protocol),[1,2]);assert.deepEqual(errors,['ROOM_OUTDATED']);
  } finally {client.stop();}
});

test('observer transport authenticates its scope, sends no game actions and rejects a player projection',async()=>{
  const seen=[],errors=[];
  const client=new RoomClient({server:'http://localhost:3000',code:'123456',session:{id:'viewer',token:'test-token',scope:'observer'},WebSocketImpl:Socket,onState:state=>seen.push(state),onError:code=>errors.push(code)});
  client.start();const socket=Socket.current;
  try {
    socket.onopen();assert.equal(socket.sent[0].scope,'observer');
    socket.receive({type:'state',state:{game:'mafia',scope:'observer',protocol:2,revision:1,serverNow:Date.now()}});
    await assert.rejects(client.command('chat',{text:'not allowed'}),error=>error.code==='WAITING');
    assert.equal(socket.sent.filter(message=>message.type==='command').length,0);
    socket.receive({type:'state',state:{game:'mafia',protocol:2,revision:2,serverNow:Date.now(),you:{roleId:'mafia'}}});
    assert.equal(seen.length,1);assert.deepEqual(errors,['AUTH']);assert.equal(client.connectionStatus,'ended');
  } finally {client.stop();}
});

test('directory preserves opaque pagination and explicit all-state filters',async()=>{
  const previous=globalThis.fetch;let requested;
  globalThis.fetch=async url=>{requested=new URL(url);return new Response(JSON.stringify({rooms:[],nextCursor:'next'}),{headers:{'content-type':'application/json'}});};
  try {
    await getPublicRooms('http://localhost:3000',{mode:'all',voice:'off',status:'playing',cursor:'one+two/three='});
    assert.equal(requested.searchParams.get('mode'),'all');assert.equal(requested.searchParams.get('voice'),'off');assert.equal(requested.searchParams.get('status'),'playing');assert.equal(requested.searchParams.get('cursor'),'one+two/three=');
  } finally {globalThis.fetch=previous;}
});

test('directory invalidations coalesce and stop after the account subscription is disposed',async()=>{
  let calls=0;const dispose=subscribePublicRooms('http://localhost:3000',{WebSocketImpl:Socket,getAccountAuthorization:()=> 'Bearer fixture',onInvalidate:()=>calls++});const socket=Socket.current;
  socket.onopen();assert.deepEqual(socket.sent[0],{type:'auth',accountAuthorization:'Bearer fixture'});
  socket.receive({type:'directory-ready',revision:1});socket.receive({type:'directory-invalidated',revision:2});socket.receive({type:'directory-invalidated',revision:3});
  await new Promise(resolve=>setTimeout(resolve,220));assert.equal(calls,1);
  socket.receive({type:'directory-invalidated',revision:4});dispose();socket.receive({type:'directory-invalidated',revision:5});
  await new Promise(resolve=>setTimeout(resolve,220));assert.equal(calls,1);assert.equal(socket.readyState,3);
});

test('Back and dialogs restore a spectator room URL without silently opening a player session',async()=>{
  const previous={window:globalThis.window,location:globalThis.location,history:globalThis.history};const listeners=new Map;
  globalThis.window={addEventListener:(name,callback)=>listeners.set(name,callback)};
  globalThis.location={hash:'#/room/123456?watch=1'};globalThis.history={replaceState:(_a,_b,url)=>{location.hash=url;},back:()=>{}};
  const router=await import('../src/platform/router.js?mafia-observer-back-test');
  try {
    let target;router.setExitGuard(value=>{target=value;return true;});
    location.hash='#/online/mafia';listeners.get('hashchange')();
    assert.equal(target,'/online/mafia');assert.equal(location.hash,'/room/123456?watch=1');
    listeners.get('hashchange')();assert.equal(router.getRoute().params.watch,'1');
    router.resetRouterForTests();let closed=0;router.registerBackLayer(()=>{closed++;});
    location.hash='#/online/mafia';listeners.get('hashchange')();assert.equal(closed,1);assert.equal(location.hash,'/room/123456?watch=1');
    listeners.get('hashchange')();router.resetRouterForTests();router.setExitGuard(value=>{target=value;return true;});
    location.hash='#/room/123456';listeners.get('hashchange')();assert.equal(target,'/room/123456');assert.equal(location.hash,'/room/123456?watch=1');
  } finally {
    for(const [key,value] of Object.entries(previous))if(value===undefined)delete globalThis[key];else globalThis[key]=value;
  }
});

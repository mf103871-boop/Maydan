import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { build } from 'esbuild';
import { Miniflare,convertV4MiniflareOptions } from 'miniflare';
import { WebSocket } from 'ws';
import { migrationSql } from '../server/local-d1.mjs';
import { newCredentials,RoomClient } from '../src/online/client.js';
import { MAFIA_PROTOCOL } from '../src/online/shared.js';

const origin='https://test.local',pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(predicate,attempts=500){for(let n=0;n<attempts;n++){if(predicate())return;await pause(10);}assert.fail('websocket state timeout');}

test('workerd/D1: a fresh observer RoomClient securely completes the account challenge and reconnects', {timeout:60000}, async()=>{
  const tempRoot=path.resolve(os.tmpdir()),dir=await mkdtemp(path.join(tempRoot,'maydan-observer-auth-'));let mf;
  const sockets=[],clients=[];
  class BrowserSocket extends WebSocket{
    constructor(url){super(url,{origin});this.sent=[];this.received=[];sockets.push(this);this.on('message',data=>{try{this.received.push(JSON.parse(String(data)));}catch{/* pong */}});}
    send(data,...args){try{this.sent.push(JSON.parse(String(data)));}catch{/* ping */}return super.send(data,...args);}
  }
  try{
    const scriptPath=path.join(dir,'worker.mjs');
    await build({stdin:{resolveDir:process.cwd(),sourcefile:'observer-auth-test-entry.mjs',contents:`
      import {routeRequest,Room,RequestLimiter} from './server/worker.mjs';
      import {createUser} from './server/accounts/db.mjs';
      import {issueSession} from './server/accounts/session.mjs';
      import {json,errorResponse} from './server/protocol.mjs';
      export {Room,RequestLimiter};
      export default {async fetch(request,env,ctx){try{if(new URL(request.url).pathname==='/test/user'){const u=await createUser(env,{name:'حساب اختبار',email:crypto.randomUUID()+'@test.local'});const s=await issueSession(env,u.id);return json({id:u.id,token:s.token});}return await routeRequest(request,env,ctx);}catch(e){return errorResponse(e);}}};
    `},bundle:true,format:'esm',platform:'browser',outfile:scriptPath,logLevel:'silent'});
    mf=new Miniflare(convertV4MiniflareOptions({rootPath:dir,name:'observer-auth-test',modules:true,scriptPath,compatibilityDate:'2026-09-01',d1Databases:{DB:'observer-auth-test'},durableObjects:{ROOMS:{className:'Room',useSQLite:true},LIMITERS:{className:'RequestLimiter',useSQLite:true}},bindings:{ALLOWED_ORIGINS:origin,MAFIA_ENABLED:'1'},cf:false}));
    const server=(await mf.ready).origin,db=await mf.getD1Database('DB');await db.exec(migrationSql());
    async function person(n){const a=await(await mf.dispatchFetch(origin+'/test/user',{method:'POST'})).json();return {...newCredentials(),accountId:a.id,authorization:a.token,name:`شخص ${n}`,avatar:0,game:'mafia',capabilities:{mafia:MAFIA_PROTOCOL},settings:{mode:'classic',capacity:6,visibility:'public',voiceMode:'off'}};}
    async function api(person,pathname,body){const r=await mf.dispatchFetch(origin+pathname,{method:'POST',headers:{origin,authorization:`Bearer ${person.authorization}`,'content-type':'application/json'},body:JSON.stringify(body)});return {status:r.status,body:await r.json()};}
    const host=await person(1),watcher=await person(2),outsider=await person(3),created=await api(host,'/api/rooms',host);assert.equal(created.status,201);const code=created.body.code;
    assert.equal((await api(watcher,`/api/rooms/${code}/observe`,watcher)).status,200);
    const session={id:watcher.id,token:watcher.token,scope:'observer'},errors=[];let bearerReads=0;
    const client=new RoomClient({server,code,session,getAccountAuthorization:()=>{bearerReads++;return `Bearer ${watcher.authorization}`;},onError:code=>errors.push(code),WebSocketImpl:BrowserSocket});clients.push(client);client.start();
    await until(()=>client.connectionStatus==='connected'||client.stopped);assert.equal(client.connectionStatus,'connected',JSON.stringify(errors));assert.equal(client.state.scope,'observer');assert.equal(client.state.you,null);assert.equal(client.state.mafiaVoice.available,false);
    const firstSocket=client.ws;assert.equal(firstSocket.sent[0].accountAuthorization,undefined,'unmodified fresh client waits for the server challenge');assert.deepEqual(firstSocket.received[0],{type:'account-auth',game:'mafia'});assert.equal(firstSocket.sent[1].accountAuthorization,`Bearer ${watcher.authorization}`);assert.equal(bearerReads,1);
    client.reconnectNow();await until(()=>client.ws!==firstSocket&&client.connectionStatus==='connected');assert.equal(client.ws.sent[0].accountAuthorization,`Bearer ${watcher.authorization}`);assert.equal(client.ws.received[0].type,'state');assert.equal(bearerReads,2);assert.deepEqual(errors,[]);
    const address=server.replace('http:','ws:')+`/api/rooms/${code}/socket`,auth={type:'auth',...session,capabilities:{mafia:MAFIA_PROTOCOL}};
    const pending=new BrowserSocket(address);await new Promise(resolve=>pending.once('open',resolve));pending.send(JSON.stringify(auth));await until(()=>pending.received.length>0);assert.deepEqual(pending.received,[{type:'account-auth',game:'mafia'}]);await pause(30);assert.equal(pending.received.some(m=>m.type==='state'),false,'valid observer token alone cannot reveal even delayed state');
    pending.send(JSON.stringify({...auth,accountAuthorization:`Bearer ${outsider.authorization}`}));await until(()=>pending.readyState===WebSocket.CLOSED);assert.equal(pending.received.some(m=>m.type==='state'),false);assert.equal(client.connectionStatus,'connected','wrong account cannot replace the current observer connection');
    const forged=new BrowserSocket(address);await new Promise(resolve=>forged.once('open',resolve));forged.send(JSON.stringify({...auth,token:'f'.repeat(64)}));await until(()=>forged.readyState===WebSocket.CLOSED);assert.equal(forged.received.some(m=>m.type==='state'||m.type==='account-auth'),false,'invalid observer token is rejected before the challenge');
    await until(()=>client.state.phase==='lobby',3500);assert.deepEqual(client.state.log,[]);assert.deepEqual(client.state.chats,{public:[],team:[],observers:[]});
    const visibleSocket=client.ws;client.reconnectNow();await until(()=>client.ws!==visibleSocket&&client.connectionStatus==='connected');assert.equal(client.state.phase,'lobby');assert.deepEqual(client.state.log,[]);assert.deepEqual(client.state.chats,{public:[],team:[],observers:[]});assert.equal(bearerReads,3);
    assert.equal((await db.prepare('SELECT COUNT(*) n FROM mafia_observer_memberships WHERE user_id=?').bind(watcher.accountId).first()).n,1);assert.equal((await db.prepare('SELECT COUNT(*) n FROM mafia_seats WHERE user_id=?').bind(watcher.accountId).first()).n,0);
  }finally{
    clients.forEach(client=>client.stop());sockets.forEach(socket=>socket.terminate());if(mf)await mf.dispose();assert.equal(path.dirname(path.resolve(dir)),tempRoot);assert.match(path.basename(dir),/^maydan-observer-auth-/);await rm(dir,{recursive:true,force:true});
  }
});

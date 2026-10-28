import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { migrationSql } from '../server/local-d1.mjs';
import { newCredentials } from '../src/online/client.js';
import { MAFIA_PROTOCOL } from '../src/online/shared.js';

test('workerd/D1 observer admission is atomic across rooms and independent from player seats', {timeout:60000}, async () => {
  const root = path.resolve(os.tmpdir()), dir = await mkdtemp(path.join(root,'maydan-observer-workerd-')); let mf;
  try {
    const scriptPath=path.join(dir,'worker.mjs');
    await build({stdin:{resolveDir:process.cwd(),sourcefile:'observer-test-entry.mjs',contents:`
      import {routeRequest,Room as BaseRoom,RequestLimiter} from './server/worker.mjs';
      import {saveObserverStream,loadObserverStream} from './server/mafia-observers.mjs';
      import {createUser} from './server/accounts/db.mjs';
      import {issueSession} from './server/accounts/session.mjs';
      import {json,errorResponse} from './server/protocol.mjs';
      export class Room extends BaseRoom {fetch(request){const p=new URL(request.url).pathname;if(p==='/test/storage/seed')return this.serial(async()=>{const stream={schemaVersion:1,seq:7,visible:{text:'مجلس ميدان '.repeat(30000)},latest:null,pending:[],ends:{},endBuffers:{}};let chunks;await this.ctx.storage.transaction(async tx=>{chunks=await saveObserverStream(tx,stream);});return json({chunks});});if(p==='/test/storage/read')return this.serial(async()=>{const loaded=await loadObserverStream(this.ctx.storage);return json({chunks:loaded.chunks,seq:loaded.stream.seq,textMatches:loaded.stream.visible.text==='مجلس ميدان '.repeat(30000)});});return super.fetch(request);}}
      export {RequestLimiter};
      export default {async fetch(request,env,ctx){try{const p=new URL(request.url).pathname;if(p==='/test/user'){const u=await createUser(env,{name:'حساب اختبار',email:crypto.randomUUID()+'@test.local'});const s=await issueSession(env,u.id);return json({id:u.id,token:s.token});}if(p.startsWith('/test/storage/'))return await env.ROOMS.get(env.ROOMS.idFromName('storage-only-fixture')).fetch(request);return await routeRequest(request,env,ctx);}catch(e){return errorResponse(e);}}};`},bundle:true,format:'esm',platform:'browser',outfile:scriptPath,logLevel:'silent'});
    mf=new Miniflare(convertV4MiniflareOptions({rootPath:dir,name:'observer-test',modules:true,scriptPath,compatibilityDate:'2026-09-01',d1Databases:{DB:'observer-test'},durableObjects:{ROOMS:{className:'Room',useSQLite:true},LIMITERS:{className:'RequestLimiter',useSQLite:true}},bindings:{ALLOWED_ORIGINS:'https://test.local',MAFIA_ENABLED:'1'},cf:false}));
    const db=await mf.getD1Database('DB'); await db.exec(migrationSql());
    const stored=await(await mf.dispatchFetch('https://test.local/test/storage/seed')).json();assert.ok(stored.chunks>=3);
    const reloaded=await(await mf.dispatchFetch('https://test.local/test/storage/read')).json();assert.deepEqual(reloaded,{chunks:stored.chunks,seq:7,textMatches:true});
    async function person(n) { const a=await(await mf.dispatchFetch('https://test.local/test/user',{method:'POST'})).json();return {...newCredentials(),accountId:a.id,authorization:a.token,name:`شخص ${n}`,avatar:0,game:'mafia',capabilities:{mafia:MAFIA_PROTOCOL},settings:{mode:'classic',capacity:6,visibility:'public',voiceMode:'off'}}; }
    async function api(p,pathname,body) {const r=await mf.dispatchFetch('https://test.local'+pathname,{method:body===undefined?'GET':'POST',headers:{origin:'https://test.local',authorization:`Bearer ${p.authorization}`,...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json()};}
    const first=await person(1),second=await person(2),watcher=await person(3),outside=await person(4);
    const a=await api(first,'/api/rooms',first),b=await api(second,'/api/rooms',second);assert.equal(a.status,201);assert.equal(b.status,201);
    const codes=[a.body.code,b.body.code],results=await Promise.all(codes.map(code=>api(watcher,`/api/rooms/${code}/observe`,watcher)));
    assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);const held=codes[results.findIndex(r=>r.status===200)],other=codes.find(c=>c!==held);
    assert.equal((await db.prepare('SELECT COUNT(*) n FROM mafia_observer_memberships WHERE user_id=?').bind(watcher.accountId).first()).n,1);
    assert.equal((await db.prepare('SELECT COUNT(*) n FROM mafia_seats').first()).n,2,'Observers do not consume player seats');
    const seatDenied=await api(watcher,`/api/rooms/${other}/join`,watcher);assert.equal(seatDenied.status,409);assert.equal(seatDenied.body.error,'MAFIA_OBSERVER_ACTIVE');
    const directoryDenied=await api(watcher,'/api/rooms/public?game=mafia');assert.equal(directoryDenied.status,409);assert.equal(directoryDenied.body.error,'MAFIA_OBSERVER_ACTIVE');
    const listed=await api(outside,'/api/rooms/public?game=mafia');assert.equal(listed.status,200);assert.equal(listed.body.rooms.find(r=>r.code===held).spectators,1);
    const forged=await api(outside,`/api/rooms/${held}/observe/leave`,watcher);assert.equal(forged.status,401);
    assert.equal((await api(watcher,`/api/rooms/${held}/observe/leave`,watcher)).status,200);
    assert.equal((await api(watcher,`/api/rooms/${other}/join`,watcher)).status,200,'Leaving observation restores normal admission');
    const privateOwner=await person(5),privateRoom=await api(privateOwner,'/api/rooms',{...privateOwner,settings:{...privateOwner.settings,visibility:'private'}});
    assert.equal(privateRoom.status,201);assert.ok((await api(outside,`/api/rooms/${privateRoom.body.code}/observe`,outside)).status>=400);
    assert.equal((await db.prepare('SELECT COUNT(*) n FROM mafia_media_slots').first()).n,0);
    assert.equal((await db.prepare('SELECT COUNT(*) n FROM trials').first()).n,0);
  } finally {
    if(mf)await mf.dispose();assert.equal(path.dirname(path.resolve(dir)),root);assert.match(path.basename(dir),/^maydan-observer-workerd-/);await rm(dir,{recursive:true,force:true});
  }
});

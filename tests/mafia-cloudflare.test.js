import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { build } from 'esbuild';
import { Miniflare,convertV4MiniflareOptions } from 'miniflare';
import { migrationSql } from '../server/local-d1.mjs';
import { newCredentials } from '../src/online/client.js';
test('workerd/D1: concurrent final Mafia seats and cross-room account fence are authoritative',{timeout:60000},async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'maydan-mafia-workerd-'));let mf;
  try {
    const scriptPath=path.join(dir,'worker.mjs');
    await build({stdin:{resolveDir:process.cwd(),sourcefile:'mafia-test-entry.mjs',contents:`
      import {routeRequest,Room,RequestLimiter} from './server/worker.mjs';
      import {createUser} from './server/accounts/db.mjs';
      import {issueSession} from './server/accounts/session.mjs';
      import {json,errorResponse} from './server/protocol.mjs';
      export {Room,RequestLimiter};
      export default {async fetch(request,env,ctx){try{if(new URL(request.url).pathname==='/test/user'){const u=await createUser(env,{name:'لاعب اختبار',email:crypto.randomUUID()+'@test.local'});const s=await issueSession(env,u.id);return json({id:u.id,token:s.token});}return routeRequest(request,env,ctx);}catch(e){return errorResponse(e);}}};`},bundle:true,format:'esm',platform:'browser',outfile:scriptPath,logLevel:'silent'});
    mf=new Miniflare(convertV4MiniflareOptions({rootPath:dir,name:'mafia-test',modules:true,scriptPath,compatibilityDate:'2026-09-01',d1Databases:{DB:'mafia-test'},durableObjects:{ROOMS:{className:'Room',useSQLite:true},LIMITERS:{className:'RequestLimiter',useSQLite:true}},bindings:{ALLOWED_ORIGINS:'https://test.local',MAFIA_ENABLED:'1'},cf:false}));
    const db=await mf.getD1Database('DB');await db.exec(migrationSql());
    async function user(n){const account=await(await mf.dispatchFetch('https://test.local/test/user',{method:'POST'})).json();return {...newCredentials(),accountId:account.id,authorization:account.token,name:`لاعب ${n}`,avatar:n%4,capabilities:{mafia:1},game:'mafia',settings:{mode:'classic',capacity:6,visibility:'public'}};}
    async function api(p,path,body){const r=await mf.dispatchFetch('https://test.local'+path,{method:'POST',headers:{origin:'https://test.local',authorization:`Bearer ${p.authorization}`,'content-type':'application/json'},body:JSON.stringify(body)});return {status:r.status,body:await r.json()};}
    const people=[];for(let i=0;i<9;i++)people.push(await user(i));
    const created=await api(people[0],'/api/rooms',people[0]);assert.equal(created.status,201,JSON.stringify(created));const code=created.body.code;
    for(const p of people.slice(1,5))assert.equal((await api(p,`/api/rooms/${code}/join`,p)).status,200);
    const final=await Promise.all(people.slice(5,7).map(p=>api(p,`/api/rooms/${code}/join`,p)));assert.deepEqual(final.map(r=>r.status).sort(),[200,409]);
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM mafia_seats WHERE room_code=?').bind(code).first()).n,6);
    const other=await api(people[7],'/api/rooms',people[7]);assert.equal(other.status,201);
    const outsider=people[8],races=await Promise.all([other.body.code,code].map(c=>api(outsider,`/api/rooms/${c}/join`,outsider)));assert.equal(races.filter(r=>r.status===200).length,1);
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM mafia_seats WHERE user_id=?').bind(outsider.accountId).first()).n,1);
    const retried=await api(outsider,'/api/matchmaking/join',outsider);assert.equal(retried.body.code,other.body.code);
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM trials').first()).n,0);
  } finally {if(mf)await mf.dispose();await rm(dir,{recursive:true,force:true});}
});

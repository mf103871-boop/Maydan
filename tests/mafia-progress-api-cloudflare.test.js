import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { build } from 'esbuild';
import { Miniflare,convertV4MiniflareOptions } from 'miniflare';
import { migrationStatements,migrationSql } from '../server/local-d1.mjs';

test('workerd/D1 Mafia profile APIs preserve private defaults, CAS, server unlocks and live SQL fences',{timeout:60000},async()=>{
  const tempRoot=path.resolve(os.tmpdir()),directory=await mkdtemp(path.join(tempRoot,'mafia-profile-api-'));let mf;
  try {
    const scriptPath=path.join(directory,'worker.mjs');
    await build({stdin:{resolveDir:process.cwd(),sourcefile:'mafia-profile-api-fixture.mjs',contents:`
      import {routeMafia} from './server/mafia-router.mjs';
      import {createUser} from './server/accounts/db.mjs';
      import {issueSession} from './server/accounts/session.mjs';
      import {persistMafiaProgress} from './server/mafia-progression.mjs';
      import {json,errorResponse} from './server/protocol.mjs';
      export default {async fetch(request,env){try{
        const url=new URL(request.url);
        if(url.pathname==='/fixture/user'){const user=await createUser(env,{name:'Synthetic profile'}),session=await issueSession(env,user.id);return json({id:user.id,token:session.token});}
        if(url.pathname==='/fixture/progress'){await persistMafiaProgress(env,await request.json());return json({ok:true});}
        return await routeMafia(request,env,url)||json({error:'NOT_FOUND'},404);
      }catch(error){return errorResponse(error);}}};`},bundle:true,format:'esm',platform:'browser',outfile:scriptPath,logLevel:'silent'});
    mf=new Miniflare(convertV4MiniflareOptions({rootPath:directory,name:'mafia-profile-api',modules:true,scriptPath,compatibilityDate:'2026-09-01',d1Databases:{DB:'mafia-profile-api'},bindings:{MAFIA_ENABLED:'1',MAFIA_PROGRESS_ENABLED:'1'},cf:false}));
    const db=await mf.getD1Database('DB');await db.exec(migrationSql());
    async function api(user,path,method='GET',body){const response=await mf.dispatchFetch('https://fixture.test'+path,{method,headers:{...(user?{authorization:`Bearer ${user.token}`} :{}),...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:response.status,body:await response.json()};}
    const a=(await api(null,'/fixture/user','POST')).body,b=(await api(null,'/fixture/user','POST')).body;
    assert.equal((await api(null,'/api/mafia/catalog')).body.roles.length,12);
    assert.equal((await api(null,'/api/me/mafia/progress')).status,401);
    assert.deepEqual((await api(b,`/api/profiles/${a.id}/mafia`)).body,{available:false});
    assert.equal((await api(a,'/api/me/mafia/preferences','PATCH',{revision:0,representativeRoleId:'citizen'})).body.error,'MAFIA_ROLE_LOCKED');
    const finishedAt=Date.now()-60_000,key=`edge:${crypto.randomUUID()}`;
    const event={eventSchemaVersion:1,eventKind:'match_completed',source:'live',rewardPolicyVersion:1,key,eventId:`online:${crypto.randomUUID()}`,rulesetVersion:1,
      startedAt:finishedAt-180_000,finishedAt,notBefore:finishedAt+30_000,mode:'classic',visibility:'public',capacity:8,participantCount:6,draw:false,
      results:[{userId:a.id,roleId:'citizen',initialFaction:'town',faction:'town',won:false,forfeited:false,eliminatedAt:null}]};
    assert.equal((await api(null,'/fixture/progress','POST',event)).status,200);
    const writes=await Promise.all(['public','friends'].map(visibility=>api(a,'/api/me/mafia/preferences','PATCH',{revision:0,visibility,representativeRoleId:'citizen'})));
    assert.deepEqual(writes.map(result=>result.status).sort(),[200,409]);
    const prefs=await db.prepare('SELECT visibility,revision,representative_role_id FROM mafia_profile_preferences WHERE user_id=?').bind(a.id).first();
    assert.equal(prefs.revision,1);assert.equal(prefs.representative_role_id,'citizen');
    assert.equal((await api(a,'/api/me/mafia/progress')).body.progress.totalXp,50);
    await db.exec(migrationStatements().filter(sql=>sql.includes('CREATE TABLE IF NOT EXISTS mafia_profile_preferences')).join('\n'));
    assert.deepEqual(await db.prepare('SELECT visibility,revision,representative_role_id FROM mafia_profile_preferences WHERE user_id=?').bind(a.id).first(),prefs,'reapplying additive migration preserves the preference');
    await db.prepare('UPDATE mafia_profile_preferences SET visibility=? WHERE user_id=?').bind('public',a.id).run();
    assert.equal((await api(b,`/api/profiles/${a.id}/mafia`)).body.available,true);
    await db.prepare('INSERT INTO mafia_match_leases(user_id,room_key,match_id,expires_at,updated_at) VALUES(?,?,?,?,?)').bind(a.id,'edge-room','1',Date.now()+120_000,Date.now()).run();
    assert.deepEqual((await api(b,`/api/profiles/${a.id}/mafia`)).body,{available:false});
    assert.equal((await api(a,'/api/me/mafia/preferences','PATCH',{revision:1,visibility:'private'})).body.error,'MAFIA_SOCIAL_LOCKED');
    await db.prepare('DELETE FROM mafia_match_leases WHERE user_id=?').bind(a.id).run();
    const reward=await api(a,'/api/me/mafia/rewards/'+encodeURIComponent(key));assert.equal(reward.body.status,'processed');assert.equal(reward.body.xpAwarded,50);
    assert.deepEqual((await api(b,'/api/me/mafia/rewards/'+encodeURIComponent(key))).body,{status:'pending'});
    await db.prepare('DELETE FROM users WHERE id=?').bind(a.id).run();
    assert.equal(await db.prepare('SELECT 1 FROM mafia_profile_preferences WHERE user_id=?').bind(a.id).first(),null);
  } finally {
    if(mf)await mf.dispose();const relative=path.relative(tempRoot,path.resolve(directory));assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));await rm(directory,{recursive:true,force:true});
  }
});

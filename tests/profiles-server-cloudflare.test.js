import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import { build } from 'esbuild';
import { Miniflare,convertV4MiniflareOptions } from 'miniflare';
import { migrationSql } from '../server/local-d1.mjs';

test('D1/workerd: profile CAS, image consistency, duplicate outcomes, local quotas and deletion races', {timeout:60000}, async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'maydan-profiles-server-'));let mf;
  try {
    const scriptPath=path.join(dir,'worker.mjs');
    await build({stdin:{resolveDir:process.cwd(),sourcefile:'profiles-test-entry.mjs',contents:`
      import {routeProfiles} from './server/profiles/router.mjs';
      import {createUser} from './server/accounts/db.mjs';
      import {issueSession} from './server/accounts/session.mjs';
      import {ensurePlayerProfile,recordOnlineResult,profileDeleteStatements} from './server/profiles/db.mjs';
      import {json} from './server/protocol.mjs';
      export default {async fetch(request,env){try{
        const url=new URL(request.url);
        if(url.pathname==='/test/user'){const user=await createUser(env,{name:'حساب تجربة'});const session=await issueSession(env,user.id);await ensurePlayerProfile(env,user.id);return json({id:user.id,token:session.token});}
        if(url.pathname==='/test/result')return json({recorded:await recordOnlineResult(env,await request.json())});
        if(url.pathname==='/test/delete'){const {id}=await request.json();await env.DB.batch([...profileDeleteStatements(env,id),env.DB.prepare('DELETE FROM users WHERE id=?').bind(id)]);return json({ok:true});}
        return await routeProfiles(request,env,url)||new Response(null,{status:404});
      }catch(error){return json({error:error.code||'INTERNAL',detail:String(error),cause:String(error.cause)},error.status||500);}}};`},bundle:true,format:'esm',platform:'browser',outfile:scriptPath,logLevel:'silent'});
    mf=new Miniflare(convertV4MiniflareOptions({rootPath:dir,name:'profiles-server',modules:true,scriptPath,compatibilityDate:'2026-09-01',d1Databases:{DB:'profiles-server'},cf:false}));
    const d1=await mf.getD1Database('DB');await d1.exec(migrationSql());
    async function call(actor,path,method='GET',body) {
      const r=await mf.dispatchFetch(`https://test.local${path.startsWith('/test/')||path.startsWith('/api/')?path:'/api/profiles'+path}`,{method,
        headers:{...(actor?.token?{authorization:`Bearer ${actor.token}`} :{}),...(body===undefined?{}:{'content-type':'application/json'})},
        ...(body===undefined?{}:{body:JSON.stringify(body)})});
      return {status:r.status,body:r.headers.get('content-type')?.startsWith('image/')?new Uint8Array(await r.arrayBuffer()):await r.json()};
    }
    const a=(await call(null,'/test/user','POST')).body;
    const b=(await call(null,'/test/user','POST')).body;
    assert.ok(a.id,JSON.stringify(a));assert.ok(b.id,JSON.stringify(b));
    const originalResponse=await call(a,'/me');assert.equal(originalResponse.status,200,JSON.stringify(originalResponse));
    const original=originalResponse.body.profile;
    const patches=await Promise.all(['أول اسم','ثاني اسم'].map(name=>call(a,'/me','PATCH',{name,revision:original.revision})));
    assert.deepEqual(patches.map(r=>r.status).sort(),[200,409]);
    const stored=await d1.prepare('SELECT u.name,p.revision FROM users u JOIN player_profiles p ON p.user_id=u.id WHERE u.id=?').bind(a.id).first();
    assert.equal(stored.name,patches.find(r=>r.status===200).body.profile.name);
    const event={userId:a.id,eventId:'online:race-room:1',game:'fabraka',won:true,draw:false,finishedAt:Date.now()};
    const recorded=await Promise.all(Array.from({length:12},()=>call(null,'/test/result','POST',event)));
    assert.ok(recorded.every(r=>r.status===200),JSON.stringify(recorded));
    assert.equal(recorded.filter(r=>r.body.recorded).length,1);
    const stats=(await call(a,'/me')).body.profile;
    assert.equal(stats.stats.onlineMatches,1);assert.equal(stats.stats.onlineWins,1);assert.ok(stats.earnedTitles.includes('winner'));
    const revision=stats.revision;
    const urls=await Promise.all(['#ae5522','#3388aa'].map(async color=>{
      const bytes=await sharp({create:{width:64,height:64,channels:3,background:color}}).jpeg().toBuffer();
      return 'data:image/jpeg;base64,'+bytes.toString('base64');
    }));
    const imageRace=await Promise.all(urls.map(dataUrl=>call(a,'/me/images/avatar','PUT',{dataUrl,revision})));
    assert.deepEqual(imageRace.map(r=>r.status).sort(),[200,409]);
    const images=await d1.prepare('SELECT i.version,p.avatar_version,i.data_base64 FROM player_images i JOIN player_profiles p ON p.user_id=i.user_id WHERE i.user_id=?').bind(a.id).first();
    assert.equal(images.version,images.avatar_version);
    const current=(await call(a,'/me')).body.profile;
    const publicImage=await call(null,current.avatarUrl);assert.equal(publicImage.status,200);assert.equal((await sharp(publicImage.body).metadata()).width,64);
    assert.equal((await call(b,`/${a.id}/images/avatar`,'PUT',{dataUrl:urls[0]})).status,404);
    const starts=await Promise.all(Array.from({length:30},()=>call(b,'/me/sessions','POST',{game:'beep'})));
    assert.equal(starts.filter(r=>r.status===200).length,24);assert.equal(starts.filter(r=>r.status===429).length,6);
    await d1.prepare('UPDATE player_sessions SET started_at=? WHERE user_id=?').bind(Date.now()-31000,b.id).run();
    const sessions=starts.filter(r=>r.status===200).map(r=>r.body.sessionId);
    const completed=await Promise.all(sessions.map(id=>call(b,`/me/sessions/${id}/complete`,'POST',{})));
    assert.ok(completed.every(r=>r.status===200),JSON.stringify(completed));
    assert.equal((await call(b,'/me')).body.profile.stats.localSessions,24);
    const duplicates=await Promise.all(Array.from({length:8},()=>call(b,`/me/sessions/${sessions[0]}/complete`,'POST',{})));
    assert.ok(duplicates.every(r=>r.status===200 && r.body.counted===false));
    assert.equal((await call(b,'/me')).body.profile.stats.localSessions,24);
    // The deletion reservation closes public image reads and all new record/image writes.
    await d1.prepare('INSERT INTO account_deletions(user_id,attempt_id,created_at) VALUES(?,?,?)').bind(a.id,'delete-race',Date.now()).run();
    const late=await Promise.all([
      call(a,'/me/images/avatar','PUT',{dataUrl:urls[1]}),
      call(null,'/test/result','POST',{...event,eventId:'online:race-room:2'}),
      call(null,current.avatarUrl),call(null,'/test/delete','POST',{id:a.id}),
    ]);
    assert.ok([401,404].includes(late[0].status));assert.equal(late[1].body.recorded,false);assert.equal(late[2].status,404);
    for(const table of ['player_profiles','player_images','player_stats','player_events','player_sessions','player_achievements'])
      assert.equal((await d1.prepare('SELECT COUNT(*) n FROM '+table+' WHERE user_id=?').bind(a.id).first()).n,0,table);
    assert.equal((await call(b,'/me')).status,200);
  } finally {
    if(mf)await mf.dispose();assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));await rm(dir,{recursive:true,force:true});
  }
});

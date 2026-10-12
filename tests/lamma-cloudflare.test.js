import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { build } from 'esbuild';
import { Miniflare,convertV4MiniflareOptions } from 'miniflare';
import { migrationSql,migrationStatements,LocalD1 } from '../server/local-d1.mjs';

test('additive Lamma migration preserves existing direct message IDs, history and default type',async()=>{const db=new LocalD1();try{const sql=migrationStatements(),split=sql.findIndex(s=>s.startsWith('ALTER TABLE social_messages'));for(const s of sql.slice(0,split))await db.exec(s);await db.prepare("INSERT INTO social_messages(seq,conversation_id,sender_id,client_id,text,original_hash,created_at) VALUES(71,'direct-existing','alice','client-existing','رسالة سابقة','hash',123)").run();for(const s of sql.slice(split))await db.exec(s);const row=await db.prepare('SELECT * FROM social_messages WHERE seq=71').first();assert.equal(row.text,'رسالة سابقة');assert.equal(row.conversation_id,'direct-existing');assert.equal(row.kind,'text');assert.equal(row.attachment_id,null);}finally{db.close();}});

test('D1/workerd serializes final group seat, voice attachment claim and multi-device call acceptance', {timeout:60000},async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'maydan-lamma-'));let mf;
 try{
  const scriptPath=path.join(dir,'worker.mjs');
  await build({stdin:{resolveDir:process.cwd(),sourcefile:'lamma-test-entry.mjs',contents:`
    import {routeSocial} from './server/social/router.mjs';
    import {createUser} from './server/accounts/db.mjs';
    import {issueSession} from './server/accounts/session.mjs';
    import {json,errorResponse} from './server/protocol.mjs';
    export default {async fetch(request,env){try{if(new URL(request.url).pathname==='/test/user'){const u=await createUser(env,{name:'لاعب اختبار',email:crypto.randomUUID()+'@test.local'});const s=await issueSession(env,u.id);return json({id:u.id,token:s.token});}return await routeSocial(request,env)||new Response(null,{status:404});}catch(e){return errorResponse(e);}}};`},bundle:true,format:'esm',platform:'browser',outfile:scriptPath,logLevel:'silent'});
  mf=new Miniflare(convertV4MiniflareOptions({rootPath:dir,name:'lamma-test',modules:true,scriptPath,compatibilityDate:'2026-09-01',d1Databases:{DB:'lamma-test'},r2Buckets:{SOCIAL_AUDIO:'lamma-audio'},bindings:{LIVEKIT_URL:'wss://test.livekit.cloud',LIVEKIT_API_KEY:'test-key',LIVEKIT_API_SECRET:'test-secret'},cf:false}));
  const db=await mf.getD1Database('DB');await db.exec(migrationSql());const query=(sql,...args)=>db.prepare(sql).bind(...args);
  const user=async()=>await (await mf.dispatchFetch('https://test.local/test/user',{method:'POST'})).json();
  async function api(u,p,method='GET',body){const response=await mf.dispatchFetch(`https://test.local/api/social${p}`,{method,headers:{authorization:`Bearer ${u.token}`,...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:response.status,body:await response.json()};}
  const owner=await user(),users=[];for(let i=0;i<12;i++)users.push(await user());
  const g=(await api(owner,'/groups','POST',{name:'لمة الاختبار'})).body.group.id,now=Date.now();
  for(const u of users){const [a,b]=[owner.id,u.id].sort();await query("INSERT INTO social_friendships(id,user_low,user_high,requester_id,status,created_at,accepted_at) VALUES(?,?,?,?,'accepted',?,?)",crypto.randomUUID(),a,b,owner.id,now,now).run();}
  for(const u of users.slice(0,10))await query("INSERT INTO social_group_members(group_id,user_id,role,joined_at) VALUES(?,?,'member',?)",g,u.id,now).run();
  const candidates=users.slice(10),invites=[];for(const u of candidates){const res=await api(owner,`/groups/${g}/invites`,'POST',{userId:u.id});assert.equal(res.status,200,JSON.stringify(res.body));invites.push(res.body.invitation.id);}
  const accepted=await Promise.all(candidates.map((u,i)=>api(u,`/groups/${g}/invites/${invites[i]}/accept`,'POST')));assert.deepEqual(accepted.map(r=>r.status).sort(),[200,409]);assert.equal((await query('SELECT COUNT(*) AS n FROM social_group_members WHERE group_id=? AND left_at IS NULL',g).first()).n,12);
  const upload=await api(owner,'/attachments','POST',{scope:'group',conversationId:g,clientId:crypto.randomUUID(),mimeType:'audio/mp4',durationMs:1200,dataBase64:Buffer.from([0,0,0,20,102,116,121,112,77,52,65,32,0,0,0,0,109,52,97,32]).toString('base64')});assert.equal(upload.status,200,JSON.stringify(upload.body));
  const sent=await Promise.all([1,2].map(()=>api(owner,`/groups/${g}/messages`,'POST',{clientId:crypto.randomUUID(),kind:'voice',attachmentId:upload.body.attachment.id})));assert.deepEqual(sent.map(r=>r.status).sort(),[200,409]);assert.equal((await query('SELECT COUNT(*) AS n FROM social_group_messages WHERE attachment_id=?',upload.body.attachment.id).first()).n,1);
  const cid=crypto.randomUUID();await query("INSERT INTO social_calls(id,scope,conversation_id,initiator_id,client_id,status,created_at,ring_until,expires_at,room_name) VALUES(?,'group',?,?,?,'ringing',?,?,?,?)",cid,g,owner.id,crypto.randomUUID(),now,now+45000,now+45000,`lamma-${cid}`).run();await query("INSERT INTO social_call_participants(call_id,user_id,state,device_id,joined_at) VALUES(?,?,'active','owner-device',?)",cid,owner.id,now).run();const answerer=users[0];await query("INSERT INTO social_call_participants(call_id,user_id,state) VALUES(?,?,'invited')",cid,answerer.id).run();const answers=await Promise.all(['device-one','device-two'].map(deviceId=>api(answerer,`/calls/${cid}/accept`,'POST',{deviceId})));assert.deepEqual(answers.map(r=>r.status).sort(),[200,409]);const active=await query('SELECT device_id FROM social_call_participants WHERE call_id=? AND user_id=?',cid,answerer.id).first();assert.ok(['device-one','device-two'].includes(active.device_id));
  const staleDevice=active.device_id==='device-one'?'device-two':'device-one';
  const staleActions=await Promise.all(['leave','reject','end'].map(action=>api(answerer,`/calls/${cid}/${action}`,'POST',{deviceId:staleDevice})));
  assert.ok(staleActions.every(result=>result.status===200));
  assert.equal((await query('SELECT state FROM social_call_participants WHERE call_id=? AND user_id=?',cid,answerer.id).first()).state,'active');
  assert.equal((await query('SELECT status FROM social_calls WHERE id=?',cid).first()).status,'active');
  assert.equal((await query("SELECT COUNT(*) AS n FROM social_jobs WHERE kind IN ('lk_remove','lk_delete')").first()).n,0);
  const staleOwnerEnd=await api(owner,`/calls/${cid}/end`,'POST',{deviceId:'retired-owner-device'});assert.equal(staleOwnerEnd.status,200);
  assert.equal((await query('SELECT status FROM social_calls WHERE id=?',cid).first()).status,'active');
  const outsider=await user();assert.equal((await api(outsider,`/calls/${cid}/accept`,'POST',{deviceId:'outsider-device'})).status,404);
 }finally{if(mf)await mf.dispose();await rm(dir,{recursive:true,force:true});}
});

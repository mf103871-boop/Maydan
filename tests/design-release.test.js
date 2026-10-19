import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {studioApiClient,studioUploadPlan,assertStudioMetadata,pendingStudioMigrations,assertStudioMigration,physicalStudioInputs,studioSourceInputs,STUDIO_MIGRATION} from '../scripts/studio-release.mjs';
test('provenance hashes physical dependencies and explicitly recognizes only the pinned synthetic media define',()=>{
  assert.deepEqual(physicalStudioInputs(['src/studio/main.jsx','<define:__MAYDAN_MEDIA_VERSIONS__>','node_modules/react/index.js']),['src/studio/main.jsx','node_modules/react/index.js']);
  assert.throws(()=>physicalStudioInputs(['<define:UNREVIEWED>']),/Unknown generated/);
  assert.deepEqual(physicalStudioInputs(["src/data/bank.json with { type: 'json' }"]),['src/data/bank.json']);
  assert.throws(()=>physicalStudioInputs(["src/data/bank.js with { type: 'json' }"]),/non-JSON/);
  assert.throws(()=>physicalStudioInputs(["src/data/bank.json with { type: 'unknown' }"]),/Unknown import/);
});
test('actual five-entry Studio build graph resolves to existing hashed source files',async()=>{
  const inputs=await studioSourceInputs({requireClean:false});assert.match(inputs['src/design/DesignRuntime.jsx'],/^[a-f0-9]{64}$/);assert.match(inputs['src/data/games/fabraka/personal.json'],/^[a-f0-9]{64}$/);assert.equal(Object.keys(inputs).some(input=>input.includes(' with {') || input.startsWith('<')),false);
});
const releaseId='studio-20261019-abcd1234',ownerUserId='verified-owner';
function snapshot(name='maydan-game'){
  return{versionId:'old',latestVersionId:'old',settings:{compatibility_date:'2026-09-01',compatibility_flags:[],observability:{enabled:true},bindings:[
    {name:'DB',type:'d1',id:'9d863a31-6a5c-45f1-91f5-79ad400c3f6e'}, {name:'SESSION_SECRET',type:'secret_text'}, {name:'LIVEKIT_API_SECRET',type:'secret_text'},
    {name:'IOS_UPDATE_POLICY_ENABLED',type:'plain_text',text:'0'}, {name:'PADDLE_ENV',type:'plain_text',text:'sandbox'},
    {name:'SOCIAL_AUDIO',type:'r2_bucket',bucket_name:'maydan-social-audio'}, {name:'SOCIAL_JOBS',type:'durable_object_namespace',class_name:'LammaJobs',...(name==='maydan-rooms'?{script_name:'maydan-game'}:{})},
    ...(name==='maydan-game'?[{name:'ASSETS',type:'assets'}]:[])]},schedules:{schedules:name==='maydan-game'?[{cron:'* * * * *'},{cron:'17 3 * * *'}]:[]},version:{resources:{script_runtime:{migration_tag:name==='maydan-game'?'v3-lamma':'v1',...(name==='maydan-game'?{assets:{not_found_handling:'single-page-application',base_path:'/',raw_run_worker_first:['/api','/api/*','/health'],raw_headers:'/*\n X-Frame-Options: DENY'}}:{})}}}};
}
function afterState(name,before,plan){const after=structuredClone(before);after.versionId='new';const added=structuredClone(plan.metadata.bindings.filter(binding=>binding.type==='plain_text'));after.settings.bindings=after.settings.bindings.filter(binding=>!added.some(item=>item.name===binding.name)).concat(added);if(name==='maydan-game')after.version.resources.script_runtime.assets.raw_run_worker_first=[...plan.metadata.assets.config.run_worker_first];return after;}
test('Studio release inherits all resources and only adds owner role, closed publish flag and three routed pages',()=>{
    for(const name of ['maydan-game','maydan-rooms']){const before=snapshot(name),plan=studioUploadPlan(name,before,{releaseId,ownerUserId});assert.equal(plan.metadata.migrations,undefined);assert.deepEqual(plan.schedules,before.schedules.schedules);assert.deepEqual(plan.metadata.keep_bindings,['secret_text','secret_key']);assert.equal(plan.metadata.bindings.find(item=>item.name==='DESIGN_PUBLISH_ENABLED').text,'0');assert.equal(plan.metadata.bindings.find(item=>item.name==='DESIGN_EDITOR_USER_IDS').text,ownerUserId);assert.equal(plan.metadata.bindings.some(item=>item.name==='DESIGN_STUDIO_RELEASE'),name==='maydan-game');if(name==='maydan-game'){assert.equal(plan.metadata.keep_assets,true);assert.deepEqual(plan.metadata.assets.config.run_worker_first,['/api','/api/*','/health']);}assert.doesNotThrow(()=>assertStudioMetadata(name,before,afterState(name,before,plan),plan));}
});
test('Studio deployment verification rejects unrelated binding, secret, routing, scheduler and settings changes',()=>{
  const before=snapshot(),plan=studioUploadPlan('maydan-game',before,{releaseId,ownerUserId});
  for(const change of [state=>state.settings.bindings.push({name:'EXTRA',type:'secret_text'}),state=>{state.settings.bindings.find(item=>item.name==='PADDLE_ENV').text='production';},state=>{state.settings.bindings.find(item=>item.name==='DESIGN_PUBLISH_ENABLED').text='1';},state=>state.schedules.schedules.push({cron:'0 * * * *'}),state=>{state.settings.observability.enabled=false;},state=>{state.version.resources.script_runtime.migration_tag='v4';},state=>{state.version.resources.script_runtime.assets.raw_headers='/*\n X-Frame-Options: SAMEORIGIN';},state=>state.version.resources.script_runtime.assets.raw_run_worker_first.push('/*')]){const current=afterState('maydan-game',before,plan);change(current);assert.throws(()=>assertStudioMetadata('maydan-game',before,current,plan));}
  const alreadyOpen=snapshot();alreadyOpen.settings.bindings.push({name:'DESIGN_PUBLISH_ENABLED',type:'plain_text',text:'1'});assert.throws(()=>studioUploadPlan('maydan-game',alreadyOpen,{releaseId,ownerUserId}));
  const differentOwner=snapshot();differentOwner.settings.bindings.push({name:'DESIGN_EDITOR_USER_IDS',type:'plain_text',text:'someone-else'});assert.throws(()=>studioUploadPlan('maydan-game',differentOwner,{releaseId,ownerUserId}));
});
test('only the frozen additive Studio migration and an exact ledger extension are authorized',()=>{
  const bytes=readFileSync(new URL('../server/migrations/0012_design_studio.sql',import.meta.url));assert.doesNotThrow(()=>assertStudioMigration(bytes));assert.throws(()=>assertStudioMigration(Buffer.concat([bytes,Buffer.from('\nDELETE FROM users;')])));
  const before=['0001_accounts.sql','0011_ersomha_reports.sql'];assert.deepEqual(pendingStudioMigrations(before,[...before,STUDIO_MIGRATION]),[STUDIO_MIGRATION]);assert.deepEqual(pendingStudioMigrations([...before,STUDIO_MIGRATION],[...before,STUDIO_MIGRATION]),[]);assert.throws(()=>pendingStudioMigrations(before,[...before,STUDIO_MIGRATION,'0013_unknown.sql']));assert.throws(()=>pendingStudioMigrations([...before,'unknown.sql'],[...before,STUDIO_MIGRATION]));
});
test('new Cloudflare client permits exactly three frozen site keys and never general bucket or SQL writes',async()=>{
  const calls=[],bytes=Buffer.from('<!doctype html><html>Studio</html>'),sha256=createHash('sha256').update(bytes).digest('hex'),key=`studio-site/${releaseId}/editor.html`;
  const fetchImpl=async(url,options)=>{calls.push({url,options});return new Response(options.method==='GET'?bytes:'{}');},baseApi=async()=>{throw new Error('base must not be invoked');};
  const read=studioApiClient('private-token',{releaseId,fetchImpl,baseApi});assert.deepEqual(await read('/r2/buckets/maydan-social-audio/objects',{objectGet:key}),bytes);await assert.rejects(read('/r2/buckets/maydan-social-audio/objects',{objectPut:{key,bytes,sha256}}));assert.equal(calls.length,1);
  const write=studioApiClient('private-token',{allowApply:true,releaseId,fetchImpl,baseApi});assert.equal((await write('/r2/buckets/maydan-social-audio/objects',{objectPut:{key,bytes,sha256}})).uploaded,true);assert.equal(calls.at(-1).options.method,'PUT');
  for(const candidate of ['studio-assets/private','studio-site/other-release/editor.html',`studio-site/${releaseId}/anything.html`,`studio-site/${releaseId}/../private`])await assert.rejects(write('/r2/buckets/maydan-social-audio/objects',{objectPut:{key:candidate,bytes,sha256}}));
  await assert.rejects(write('/r2/buckets/maydan-social-audio/objects',{objectPut:{key,bytes,sha256:'0'.repeat(64)}}));await assert.rejects(write('/r2/buckets/maydan-social-audio/objects',{objectDelete:key}));await assert.rejects(write('/d1/database/other/query',{ownerCode:'MDN-123456789A'}));
  assert.equal(calls.length,2);
});
test('owner verification uses one fixed parameterized active-account SELECT without logging or serializing credentials',async()=>{
  let seen;const api=studioApiClient('do-not-output',{fetchImpl:async(url,options)=>{seen={url,options};return Response.json({success:true,result:[{success:true,results:[{id:ownerUserId,code:'MDN-123456789A'}]}]});},baseApi:async()=>{throw new Error('unexpected');}});
  const rows=await api('/d1/database/9d863a31-6a5c-45f1-91f5-79ad400c3f6e/query',{ownerCode:'MDN-123456789A'});assert.equal(rows[0].results[0].id,ownerUserId);const body=JSON.parse(seen.options.body);assert.match(body.sql,/^SELECT /);assert.match(body.sql,/account_deletions/);assert.match(body.sql,/moderation_suspensions/);assert.deepEqual(body.params,['MDN-123456789A']);assert.equal(seen.options.body.includes('do-not-output'),false);await assert.rejects(api('/d1/database/9d863a31-6a5c-45f1-91f5-79ad400c3f6e/query',{ownerCode:"' OR 1=1"}));
});

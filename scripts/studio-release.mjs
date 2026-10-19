// The default commands only inspect production or freeze encrypted local files.
// --apply requires a reviewed digest, current source/worker leases and fresh D1
// backup. No public frontend upload, new resource, secret or scheduler write.
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {homedir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {apiClient,snapshotWorker,assertLease,savePrivate,loadPrivate,publicManifest,assertAssetsUnchanged,assertDeployedBundle,assertPrivateBucket,migrationConfig,assetsConfig} from './lamma-release.mjs';
import {socialUpdatePlan,assertFreshBackup} from './lamma-social-update.mjs';
import {getBackendProvenance} from './lib/lamma-provenance.mjs';

const ROOT=fileURLToPath(new URL('../',import.meta.url)),PRIVATE=path.join(homedir(),'.codex/private/maydan-lamma-release');
const ACCOUNT='3fa113e56f10150f13618f641b9fe98e',DATABASE='9d863a31-6a5c-45f1-91f5-79ad400c3f6e',BUCKET='maydan-social-audio';
const WORKERS=['maydan-game','maydan-rooms'],ORIGIN='https://maydan-game.mf103871.workers.dev';
export const STUDIO_MIGRATION='0012_design_studio.sql';
const MIGRATION_HASH='f9e59a3c728983e3868178d0f20738aebcb4846ec7e8b2ab78378ce13353dea2';
const SITE_FILES={editor:'dist/studio/index.html',preview:'dist/studio/preview/index.html',play:'dist/studio/play/index.html'};
const STUDIO_VARS=['DESIGN_STUDIO_RELEASE','DESIGN_EDITOR_USER_IDS','DESIGN_PUBLISH_ENABLED'];
const SETTINGS=['compatibility_date','compatibility_flags','placement','logpush','observability','tail_consumers','tags','limits'];
const execute=promisify(execFile),hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const canonical=value=>JSON.stringify(value,(_,item)=>item && !Array.isArray(item) && typeof item==='object'?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))):item);
const stamp=()=>new Date().toISOString().replace(/[:.]/g,'-');
const cron=snapshot=>(snapshot.schedules?.schedules||[]).map(item=>item.cron).sort();
const normalized=bytes=>Buffer.from(bytes.toString().replace(/\r\n/g,'\n'));
const validRelease=value=>typeof value==='string' && /^[a-z0-9][a-z0-9-]{7,79}$/.test(value);
function directory(value){const result=path.resolve(value||path.join(PRIVATE,`studio-${stamp()}-${randomUUID().slice(0,8)}`)),relative=path.relative(PRIVATE,result);assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative),'Studio records must stay in the existing DPAPI directory.');return result;}
async function auth(){const {stdout}=await execute(process.execPath,[path.join(ROOT,'node_modules/wrangler/bin/wrangler.js'),'auth','token','--json'],{cwd:ROOT,windowsHide:true,timeout:30000,maxBuffer:1048576});const value=JSON.parse(stdout);assert.ok(typeof value.token==='string' && value.token && /oauth|api/i.test(value.type),'Wrangler authentication unavailable.');return value.token;}

// Only the three immutable site keys and one fixed owner-code SELECT extend the
// existing narrow Cloudflare client. No object delete/list, SQL write or secret API.
export function studioApiClient(token,{allowApply=false,releaseId=null,fetchImpl=fetch,baseApi=apiClient(token,allowApply)}={}){
  return async(suffix,options={})=>{
    if(options.ownerCode!==undefined){
      assert.equal(suffix,`/d1/database/${DATABASE}/query`);assert.deepEqual(Object.keys(options),['ownerCode']);assert.match(options.ownerCode,/^MDN-[A-F0-9]{10}$/);
      const response=await fetchImpl(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}${suffix}`,{method:'POST',redirect:'error',signal:AbortSignal.timeout(120000),headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({sql:'SELECT u.id,p.code FROM users u JOIN social_profiles p ON p.user_id=u.id WHERE p.code=? AND NOT EXISTS(SELECT 1 FROM account_deletions d WHERE d.user_id=u.id) AND NOT EXISTS(SELECT 1 FROM moderation_suspensions s WHERE s.user_id=u.id)',params:[options.ownerCode]})});
      assert.ok(response.ok,'Owner verification query failed; response suppressed.');const result=await response.json();assert.equal(result.success,true,'Owner verification was rejected.');return result.result;
    }
    if(options.objectGet!==undefined || options.objectPut!==undefined){
      const writing=options.objectPut!==undefined,item=writing?options.objectPut:{key:options.objectGet};
      assert.ok(validRelease(releaseId),'Exact frozen site release required.');assert.equal(suffix,`/r2/buckets/${BUCKET}/objects`);assert.deepEqual(Object.keys(options),[writing?'objectPut':'objectGet']);
      assert.ok(['editor','preview','play'].some(kind=>item.key===`studio-site/${releaseId}/${kind}.html`),'Only this release’s three HTML object keys are allowed.');
      if(writing){assert.equal(allowApply,true,'Read-only client refuses R2 upload.');assert.ok(Buffer.isBuffer(item.bytes) && item.bytes.length<=16*1024*1024);assert.equal(hash(item.bytes),item.sha256,'Frozen HTML hash mismatch.');}
      const response=await fetchImpl(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}${suffix}/${item.key.split('/').map(encodeURIComponent).join('/')}`,{method:writing?'PUT':'GET',redirect:'error',signal:AbortSignal.timeout(120000),headers:{authorization:`Bearer ${token}`,...(writing?{'content-type':'text/html; charset=utf-8','content-length':String(item.bytes.length),'cache-control':'no-store','x-amz-meta-sha256':item.sha256}:{})},...(writing?{body:item.bytes}:{})});
      if(!writing && response.status===404)return null;
      assert.ok(response.ok,`Studio object HTTP ${response.status}; response suppressed.`);return writing?{uploaded:true}:Buffer.from(await response.arrayBuffer());
    }
    assert.ok(Object.keys(options).every(key=>['exportBody','readMigrations','form','raw'].includes(key)),'Unapproved Cloudflare operation.');return baseApi(suffix,options);
  };
}
export function assertStudioMigration(bytes){assert.equal(hash(normalized(bytes)),MIGRATION_HASH,'Only the reviewed additive Design Studio migration is authorized.');}
export function physicalStudioInputs(inputs){
  const generated=new Set(['<define:__MAYDAN_MEDIA_VERSIONS__>']);
  return inputs.filter(input=>{if(generated.has(input))return false;assert.ok(!input.startsWith('<'),'Unknown generated build input.');return true;});
}
export function pendingStudioMigrations(ledger,names){assert.equal(new Set(ledger).size,ledger.length);assert.ok(ledger.includes('0011_ersomha_reports.sql'),'Existing production Ersomha schema required.');assert.ok(ledger.every(name=>names.includes(name)),'Unknown migration in live ledger.');const pending=names.filter(name=>!ledger.includes(name)).sort();assert.deepEqual(pending,ledger.includes(STUDIO_MIGRATION)?[]:[STUDIO_MIGRATION],'Only additive migration 0012 may be applied.');return pending;}
export function studioUploadPlan(name,before,{releaseId,ownerUserId}){
  assert.ok(WORKERS.includes(name));assert.ok(validRelease(releaseId));assert.match(ownerUserId||'',/^[A-Za-z0-9_-]{1,80}$/);
  const plan=socialUpdatePlan(name,before),allowed=name==='maydan-game'?STUDIO_VARS:STUDIO_VARS.filter(value=>value!=='DESIGN_STUDIO_RELEASE');
  const values={DESIGN_STUDIO_RELEASE:releaseId,DESIGN_EDITOR_USER_IDS:ownerUserId,DESIGN_PUBLISH_ENABLED:'0'};
  for(const key of allowed){const existing=before.settings.bindings.find(binding=>binding.name===key);if(existing){assert.equal(existing.type,'plain_text','Studio settings must be inspectable plain text.');if(key==='DESIGN_EDITOR_USER_IDS')assert.equal(existing.text,ownerUserId,'Do not replace a different existing editor role.');if(key==='DESIGN_PUBLISH_ENABLED')assert.notEqual(existing.text,'1','Do not combine this release with an already-open publication gate.');}}
  plan.metadata.bindings=plan.metadata.bindings.filter(binding=>!allowed.includes(binding.name));for(const key of allowed)plan.metadata.bindings.push({name:key,type:'plain_text',text:values[key]});
  plan.metadata.annotations={'workers/message':'Private Design Studio; existing public game and 63 referenced assets retained; publishing disabled'};return plan;
}
export function assertStudioMetadata(name,before,after,plan){
  const allowed=name==='maydan-game'?STUDIO_VARS:STUDIO_VARS.filter(value=>value!=='DESIGN_STUDIO_RELEASE'),bindings=value=>value.settings.bindings.filter(binding=>!allowed.includes(binding.name)).sort((a,b)=>a.name.localeCompare(b.name));
  assert.deepEqual(bindings(after),bindings(before),'An existing binding or secret changed.');for(const key of SETTINGS)assert.deepEqual(after.settings[key],before.settings[key],`Worker setting changed: ${key}`);assert.deepEqual(cron(after),cron(before),'Cron changed.');assert.equal(after.version.resources.script_runtime.migration_tag,before.version.resources.script_runtime.migration_tag,'DO history changed.');
  for(const key of allowed){const expected=plan.metadata.bindings.find(binding=>binding.name===key);assert.deepEqual(after.settings.bindings.find(binding=>binding.name===key),expected,`Studio variable differs: ${key}`);}
  if(name==='maydan-game')assert.deepEqual(assetsConfig(after.version.resources.script_runtime.assets),plan.metadata.assets.config,'Existing asset routing configuration changed.');
  assert.deepEqual(after.version.resources.script_runtime.assets,before.version.resources.script_runtime.assets,'Complete original asset configuration must remain unchanged.');
}
async function ledger(api){const rows=await api(`/d1/database/${DATABASE}/query`,{readMigrations:true});assert.ok(rows.every(row=>row.success));return rows.flatMap(row=>row.results).map(row=>row.name);}
async function names(){return(await readdir(path.join(ROOT,'server/migrations'))).filter(name=>name.endsWith('.sql')).sort();}
async function privateBucket(api){const[managed,custom]=await Promise.all(['managed','custom'].map(kind=>api(`/r2/buckets/${BUCKET}/domains/${kind}`)));assertPrivateBucket(managed,custom);}
async function ownerProof(api,ownerDirectory){const proof=await loadPrivate(directory(ownerDirectory),'owner');assert.match(proof.userId||'',/^[A-Za-z0-9_-]{1,80}$/);assert.match(proof.code||'',/^MDN-[A-F0-9]{10}$/);assert.ok(Number.isFinite(Date.parse(proof.verifiedAt)),'Human owner verification record required.');const rows=await api(`/d1/database/${DATABASE}/query`,{ownerCode:proof.code});assert.ok(rows.every(row=>row.success));assert.deepEqual(rows.flatMap(row=>row.results),[{id:proof.userId,code:proof.code}],'Human-verified player code no longer identifies exactly this active account.');return proof;}
export async function studioPreflight(dir){
  const api=studioApiClient(await auth()),workers={};for(const name of WORKERS){workers[name]=await snapshotWorker(api,name);socialUpdatePlan(name,workers[name]);}
  const publicAssets=await publicManifest();assert.equal(publicAssets.entries.length,63,'Expected the 63 reviewed public assets.');const migrations=await ledger(api),pendingMigrations=pendingStudioMigrations(migrations,await names());await privateBucket(api);for(const name of WORKERS)assertLease(workers[name],await snapshotWorker(api,name));
  const value={operation:'private-studio-v1',createdAt:new Date().toISOString(),databaseId:DATABASE,workers,public:publicAssets,migrations,pendingMigrations};await savePrivate(dir,'preflight',value);return{directory:dir,versions:Object.fromEntries(WORKERS.map(name=>[name,workers[name].versionId])),checkedAssets:63,pendingMigrations,productionChanged:false};
}
export async function studioBackup(dir){
  const before=await loadPrivate(dir,'preflight'),api=studioApiClient(await auth());for(const name of WORKERS)assertLease(before.workers[name],await snapshotWorker(api,name));
  let result,bookmark;const deadline=Date.now()+600000;do{result=await api(`/d1/database/${DATABASE}/export`,{exportBody:{output_format:'polling',dump_options:{no_schema:false,no_data:false,tables:[]},...(bookmark?{current_bookmark:bookmark}:{})}});assert.ok(result.success && result.status!=='error','D1 export failed.');if(result.status==='complete')break;bookmark=result.at_bookmark;assert.ok(bookmark && Date.now()<deadline,'D1 export timed out.');await new Promise(resolve=>setTimeout(resolve,3000));}while(true);
  const url=new URL(result.result.signed_url);assert.equal(url.protocol,'https:');assert.ok(!url.username && !url.password);const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(120000)});assert.ok(response.ok,'D1 backup download failed.');
  const bytes=Buffer.from(await response.arrayBuffer()),receipt={completedAt:new Date().toISOString(),bytes:bytes.length,sha256:hash(bytes),databaseId:DATABASE};assertFreshBackup(receipt,bytes);const target=path.join(dir,'backups',`backup-${stamp()}-${randomUUID().slice(0,8)}`);await savePrivate(target,'database.sql',bytes);await savePrivate(target,'receipt',receipt);assertFreshBackup(receipt,await loadPrivate(target,'database.sql',true));return{directory:dir,backupDirectory:target,backupComplete:true,sha256:receipt.sha256,bytes:bytes.length,productionChanged:false};
}
async function freshBackup(dir){const entries=(await readdir(path.join(dir,'backups'),{withFileTypes:true})).filter(entry=>entry.isDirectory() && /^backup-[A-Za-z0-9-]+$/.test(entry.name)).map(entry=>entry.name).sort().reverse();assert.ok(entries.length,'Fresh encrypted D1 export required.');const target=path.join(dir,'backups',entries[0]),receipt=await loadPrivate(target,'receipt');assert.equal(receipt.databaseId,DATABASE);assertFreshBackup(receipt,await loadPrivate(target,'database.sql',true));}
async function sourceInputs(){
  const compiled=await build({entryPoints:['src/studio/main.jsx','src/design/preview-main.jsx','src/studio/game-main.jsx','server/full-worker.mjs','server/worker.mjs'],absWorkingDir:ROOT,outdir:'.cache/studio-provenance-unused',bundle:true,write:false,metafile:true,platform:'browser',format:'esm',target:'es2022',jsx:'automatic',alias:{'react/jsx-runtime':path.join(ROOT,'src/design/jsx-runtime.js')},loader:{'.css':'text','.webp':'dataurl','.png':'dataurl','.woff2':'dataurl'},define:{__MAYDAN_VERSION__:JSON.stringify(JSON.parse(await readFile(path.join(ROOT,'package.json'),'utf8')).version),__MAYDAN_ROOMS_URL__:'"same-origin"',__MAYDAN_MEDIA_VERSIONS__:'{}','process.env.NODE_ENV':'"production"'},logLevel:'silent'});
  const files=[...new Set([...physicalStudioInputs(Object.keys(compiled.metafile.inputs)),'package-lock.json','scripts/studio-release.mjs','scripts/lamma-release.mjs','scripts/lamma-social-update.mjs','scripts/lib/lamma-provenance.mjs','scripts/lib.mjs','scripts/design-preview-build.mjs',`server/migrations/${STUDIO_MIGRATION}`])].sort();
  const map={};for(const input of files){const relative=path.relative(ROOT,path.resolve(ROOT,input)).split(path.sep).join('/');assert.ok(!relative.startsWith('../') && !path.isAbsolute(relative),'Bundled dependency outside repository.');map[relative]=hash(await readFile(path.join(ROOT,relative)));}
  const tracked=files.filter(file=>!file.startsWith('node_modules/'));const status=(await execute('git',['status','--porcelain','--untracked-files=all','--',...tracked],{cwd:ROOT,windowsHide:true,maxBuffer:4*1024*1024})).stdout;assert.equal(status.trim(),'','Commit all Studio source and release helpers before plan review.');return map;
}
async function bundle(name){const compiled=await build({entryPoints:[path.join(ROOT,'server',name==='maydan-game'?'full-worker.mjs':'worker.mjs')],bundle:true,write:false,format:'esm',platform:'browser',target:'es2022',minify:false,logLevel:'silent'});return Buffer.from(compiled.outputFiles[0].contents);}
export async function studioPlan(dir,ownerDirectory){
  const before=await loadPrivate(dir,'preflight');assert.equal(before.operation,'private-studio-v1');const api=studioApiClient(await auth()),owner=await ownerProof(api,ownerDirectory),provenance=await getBackendProvenance(ROOT,{requireClean:true}),inputs=await sourceInputs();
  const releaseId=`studio-${new Date().toISOString().slice(0,10).replaceAll('-','')}-${randomUUID().slice(0,8)}`,plans={},bundles={},site={};
  for(const name of WORKERS){assertLease(before.workers[name],await snapshotWorker(api,name));plans[name]=studioUploadPlan(name,before.workers[name],{releaseId,ownerUserId:owner.userId});const bytes=await bundle(name);bundles[name]={sha256:hash(bytes),bytes:bytes.length};await savePrivate(dir,`${name}.mjs`,bytes);}
  for(const[kind,file]of Object.entries(SITE_FILES)){const bytes=await readFile(path.join(ROOT,file));assert.ok(bytes.length<=16*1024*1024 && bytes.toString('utf8',0,128).trimStart().toLowerCase().startsWith('<!doctype html'),'Missing or invalid built Studio HTML.');site[kind]={path:file,key:`studio-site/${releaseId}/${kind}.html`,sha256:hash(bytes),bytes:bytes.length};await savePrivate(dir,`site-${kind}.html`,bytes);}
  const pending=pendingStudioMigrations(before.migrations,await names());assert.deepEqual(pending,before.pendingMigrations);const migration=await readFile(path.join(ROOT,'server/migrations',STUDIO_MIGRATION));assertStudioMigration(migration);await savePrivate(dir,'migration',migration);
  const review={operation:'private-studio-v1',createdAt:new Date().toISOString(),...provenance,snapshotSHA256:hash(canonical(before)),sourceInputs:inputs,releaseId,ownerUserId:owner.userId,ownerDirectory:directory(ownerDirectory),plans,bundles,site,pendingMigrations:pending,migrationSHA256:hash(migration),publicFrontendDeployed:false,publishEnabled:false,sequence:['Recheck reviewed source, owner code, worker leases, 63 public assets and fresh encrypted D1 backup','Upload only three frozen private site HTML objects and verify exact bytes','Apply only additive migration 0012','Upload frozen main and rooms modules, inherit all other settings and retain original asset routing; canonical Studio uses existing /api/* route','Verify site hashes, bindings, secrets, schedules, original public assets and disabled publication/update gates']};
  await savePrivate(dir,'deployment-plan',review);return{directory:dir,releaseId,planSHA256:hash(canonical(review)),sourceCommit:provenance.sourceCommit,bundles,site,pendingMigrations:pending,ownerVerified:true,applied:false};
}
async function frozenReview(dir,digest){const review=await loadPrivate(dir,'deployment-plan'),before=await loadPrivate(dir,'preflight');assert.equal(review.operation,'private-studio-v1');assert.equal(hash(canonical(before)),review.snapshotSHA256);if(digest!==undefined){assert.match(digest,/^[a-f0-9]{64}$/);assert.equal(hash(canonical(review)),digest,'Reviewed plan digest changed.');}return{review,before};}
export async function studioVerify(dir){
  const{review,before}=await frozenReview(dir),api=studioApiClient(await auth(),{releaseId:review.releaseId}),versions={};
  for(const name of WORKERS){const current=await snapshotWorker(api,name);assertStudioMetadata(name,before.workers[name],current,review.plans[name]);await assertDeployedBundle(current.script,name,review.bundles[name].sha256);versions[name]=current.versionId;}
  assert.deepEqual(await ledger(api),[...before.migrations,...review.pendingMigrations]);assertAssetsUnchanged(before.public,await publicManifest(before.public.paths));await privateBucket(api);
  for(const[kind,route]of Object.entries({editor:'/api/studio/',preview:'/api/studio/preview/',play:'/api/studio/play/'})){const bytes=await api(`/r2/buckets/${BUCKET}/objects`,{objectGet:review.site[kind].key});assert.ok(bytes);assert.equal(hash(bytes),review.site[kind].sha256);const response=await fetch(ORIGIN+route,{redirect:'error',signal:AbortSignal.timeout(30000)});assert.equal(response.status,200,`Studio route unavailable: ${route}`);assert.equal(response.headers.get('x-maydan-studio-release'),review.releaseId,'Static-assets routing bypassed Studio handler.');assert.equal(hash(Buffer.from(await response.arrayBuffer())),review.site[kind].sha256);}
  const result={verifiedAt:new Date().toISOString(),releaseId:review.releaseId,sourceCommit:review.sourceCommit,versions,checkedAssets:63,existingPublicAssetsUnchanged:true,publishEnabled:false,ownerOnly:true,site:review.site,addedMigrations:review.pendingMigrations,publicFrontendDeployed:false};await savePrivate(dir,`verification-${stamp()}`,result);return result;
}
export async function studioApply(dir,digest){
  const{review,before}=await frozenReview(dir,digest),provenance=await getBackendProvenance(ROOT,{requireClean:true});for(const key of ['sourceServerTree','backendTreeSha256'])assert.equal(provenance[key],review[key],'Source changed after review.');for(const[file,sha]of Object.entries(review.sourceInputs))assert.equal(hash(await readFile(path.join(ROOT,file))),sha,`Source changed: ${file}`);await freshBackup(dir);
  const api=studioApiClient(await auth(),{allowApply:true,releaseId:review.releaseId});const owner=await ownerProof(api,review.ownerDirectory);assert.equal(owner.userId,review.ownerUserId);for(const name of WORKERS){const current=await snapshotWorker(api,name);assertLease(before.workers[name],current);assert.deepEqual(studioUploadPlan(name,current,review),review.plans[name]);}
  assert.deepEqual(await ledger(api),before.migrations);assertAssetsUnchanged(before.public,await publicManifest(before.public.paths));await privateBucket(api);await freshBackup(dir);
  const modules={},sites={};for(const name of WORKERS){modules[name]=await loadPrivate(dir,`${name}.mjs`,true);assert.equal(hash(modules[name]),review.bundles[name].sha256);}for(const kind of Object.keys(SITE_FILES)){sites[kind]=await loadPrivate(dir,`site-${kind}.html`,true);assert.equal(hash(sites[kind]),review.site[kind].sha256);assert.equal(await api(`/r2/buckets/${BUCKET}/objects`,{objectGet:review.site[kind].key}),null,'Release object already exists; do not overwrite an unknown prior attempt.');}
  const migration=await loadPrivate(dir,'migration',true);assertStudioMigration(migration);assert.equal(hash(migration),review.migrationSHA256);assert.equal(hash(await readFile(path.join(ROOT,'server/migrations',STUDIO_MIGRATION))),review.migrationSHA256);
  await writeFile(path.join(dir,'apply.lock'),JSON.stringify({startedAt:new Date().toISOString(),planSHA256:digest}),{flag:'wx',mode:0o600});let sequence=0;const phase=async(name,action)=>{const number=++sequence;await savePrivate(dir,`journal-${number}-start`,{name,at:new Date().toISOString()});const result=await action();await savePrivate(dir,`journal-${number}-done`,{name,at:new Date().toISOString()});return result;};
  for(const kind of Object.keys(SITE_FILES))await phase(`private-site-${kind}`,async()=>{await api(`/r2/buckets/${BUCKET}/objects`,{objectPut:{key:review.site[kind].key,bytes:sites[kind],sha256:review.site[kind].sha256}});assert.equal(hash(await api(`/r2/buckets/${BUCKET}/objects`,{objectGet:review.site[kind].key})),review.site[kind].sha256);});
  if(review.pendingMigrations.length)await phase('additive-migration-0012',async()=>{const target=path.join(dir,'frozen-migrations');await mkdir(target,{mode:0o700});await writeFile(path.join(target,STUDIO_MIGRATION),migration,{flag:'wx',mode:0o600});const config=migrationConfig();config.d1_databases[0].migrations_dir=target;const configPath=path.join(dir,'studio-migration-config.json');await writeFile(configPath,JSON.stringify(config),{flag:'wx',mode:0o600});await execute(process.execPath,[path.join(ROOT,'node_modules/wrangler/bin/wrangler.js'),'d1','migrations','apply','maydan-accounts','--remote','--config',configPath],{cwd:ROOT,windowsHide:true,timeout:120000,maxBuffer:4*1024*1024,env:{...process.env,CI:'true'}});assert.deepEqual(await ledger(api),[...before.migrations,STUDIO_MIGRATION]);});
  for(const name of WORKERS)await phase(`worker-${name}`,async()=>{assertLease(before.workers[name],await snapshotWorker(api,name));const form=new FormData();form.set('metadata',new Blob([JSON.stringify(review.plans[name].metadata)],{type:'application/json'}));form.set(`${name}.mjs`,new File([modules[name]],`${name}.mjs`,{type:'application/javascript+module'}));await api(`/workers/scripts/${name}`,{form});const current=await snapshotWorker(api,name);assertStudioMetadata(name,before.workers[name],current,review.plans[name]);await assertDeployedBundle(current.script,name,review.bundles[name].sha256);assertAssetsUnchanged(before.public,await publicManifest(before.public.paths));});
  const result=await phase('verification',()=>studioVerify(dir));return{...result,applied:true,secretValuesWritten:false,resourcesProvisioned:false,testFlightUploaded:false};
}
async function main(){const[command,suppliedDir,arg]=process.argv.slice(2);assert.ok(['preflight','backup','plan','--apply','verify'].includes(command),'Use preflight [dir], backup <dir>, plan <dir> <encrypted-owner-directory>, --apply <dir> <reviewed-digest>, verify <dir>.');if(command!=='preflight')assert.ok(suppliedDir,'Exact private plan directory required.');const dir=directory(suppliedDir);let result;if(command==='preflight')result=await studioPreflight(dir);else if(command==='backup')result=await studioBackup(dir);else if(command==='plan'){assert.ok(arg,'Human-verified encrypted owner directory required.');result=await studioPlan(dir,arg);}else if(command==='--apply')result=await studioApply(dir,arg);else result=await studioVerify(dir);console.log(JSON.stringify(result,null,2));}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(JSON.stringify({failed:true,message:error instanceof assert.AssertionError?error.message.split('\n')[0]:'Studio release failed; credentials and private response bodies suppressed.'}));process.exitCode=1;});

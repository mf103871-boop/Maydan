// Local preflight (no network): node scripts/lamma-live-provider-acceptance.mjs --check
// Authorized trial: node scripts/lamma-live-provider-acceptance.mjs --run-preview --livekit-host <preview-project>.livekit.cloud
// This script never reads provider secrets. Only the preview worker signs tokens.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import http from 'node:http';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { getBackendProvenance } from './lib/lamma-provenance.mjs';
import { PREVIEW_LIVEKIT_PROJECT_ID, PREVIEW_LIVEKIT_HOST, assertPreviewLiveKitHost } from './lib/lamma-provider-target.mjs';

const ROOT=fileURLToPath(new URL('../',import.meta.url));
const CONFIG=path.join(ROOT,'wrangler.lamma-preview.jsonc');
const DATABASE='maydan-lamma-preview-accounts',DATABASE_ID='346a7165-9989-4fe2-a5a3-aec017a2d21b';
const ORIGIN='https://maydan-lamma-preview.mf103871.workers.dev';
const outputDir=path.join(ROOT,'.cache','lamma-preview');
const execute=promisify(execFile),sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const literal=value=>`'${String(value).replaceAll("'","''")}'`;
const mode=process.argv[2],hostIndex=process.argv.indexOf('--livekit-host');
const providerHost=hostIndex>=0?process.argv[hostIndex+1]:null;
const runId=randomUUID(),users=[],calls=[],groups=[];
const report={runId,startedAt:new Date().toISOString(),origin:ORIGIN,checks:[],cleanup:null};
let browser,server,page,seeded=false,writes=0,writeWindow=Math.floor(Date.now()/60_000);

function previewURL(input){const url=new URL(input,ORIGIN);assert.equal(url.origin,ORIGIN,'Non-preview origin forbidden');assert.equal(url.username+url.password,'');return url;}
function safeError(error){return String(error?.message||'Acceptance failed').replace(/mdn1\.[\w.-]+/g,'[SESSION REDACTED]').replace(/[\w-]{10,}\.[\w-]{10,}\.[\w-]{10,}/g,'[JWT REDACTED]').replace(/([?&](?:access_token|token)=)[^&\s]+/gi,'$1[REDACTED]').slice(0,1600);}
async function guard(){
  const active=(await readFile(CONFIG,'utf8')).split(/\r?\n/).filter(line=>!line.trimStart().startsWith('//')).join('\n');
  assert.match(active,/"name"\s*:\s*"maydan-lamma-preview"/);
  assert.match(active,new RegExp(`"database_name"\\s*:\\s*"${DATABASE}"`));
  assert.match(active,new RegExp(`"database_id"\\s*:\\s*"${DATABASE_ID}"`));
  assert.equal((active.match(/"database_id"/g)||[]).length,1);
  assert.ok(!active.includes('9d863a31-6a5c-45f1-91f5-79ad400c3f6e')&&!active.includes('"script_name"'),'Production resources forbidden');
  previewURL(ORIGIN);
}
async function d1(sql,{query=false}={}){
  await guard();const filename=path.join(outputDir,`${runId}-${randomUUID()}.sql`);
  await writeFile(filename,sql,{mode:0o600});
  try{
    const {stdout}=await execute(process.execPath,[path.join(ROOT,'node_modules/wrangler/bin/wrangler.js'),'d1','execute',DATABASE,'--remote','--config',CONFIG,...(query?['--command',sql]:['--file',filename]),'--json'],{cwd:ROOT,maxBuffer:8*1024*1024,timeout:120_000,windowsHide:true});
    if(!query)return;
    // Read-only SELECT output contains only counts/fixture IDs, never credentials.
    const start=stdout.search(/\[\s*\{/);assert.ok(start>=0,'Missing D1 query result');
    const result=JSON.parse(stdout.slice(start));assert.ok(result.every(r=>r.success),'D1 query failed');return result.flatMap(r=>r.results||[]);
  }catch{throw Error('Preview D1 operation failed; command output suppressed.');}
  finally{await unlink(filename).catch(()=>{});}
}
async function deploymentVersion(){
  await guard();
  let stdout;try{({stdout}=await execute(process.execPath,[path.join(ROOT,'node_modules/wrangler/bin/wrangler.js'),'deployments','list','--config',CONFIG,'--json'],{cwd:ROOT,maxBuffer:2*1024*1024,timeout:30_000,windowsHide:true}));}catch{throw Error('Could not verify preview deployment version.');}
  const records=JSON.parse(stdout.slice(stdout.search(/\[\s*\{/))).sort((a,b)=>Date.parse(b.created_on)-Date.parse(a.created_on));
  const versions=records[0]?.versions;assert.equal(versions?.length,1,'Split preview deployments cannot be accepted');assert.equal(versions[0].percentage,100);
  return versions[0].version_id;
}
async function request(user,pathname,method='GET',body){
  const url=previewURL(pathname);
  if(method!=='GET'&&pathname.startsWith('/api/social/')){
    if(writeWindow!==Math.floor(Date.now()/60_000)){writeWindow=Math.floor(Date.now()/60_000);writes=0;}
    if(++writes>43){console.log('Waiting for the next preview API quota window.');await sleep(60_050-Date.now()%60_000);writeWindow=Math.floor(Date.now()/60_000);writes=1;}
  }
  const response=await fetch(url,{method,redirect:'error',signal:AbortSignal.timeout(25_000),headers:{Origin:'maydan://app',...(user?{Authorization:`Bearer ${user.token}`}:{}) ,...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const rotated=response.headers.get('x-maydan-session');if(user&&rotated)user.token=rotated;
  const data=response.headers.get('content-type')?.includes('application/json')?await response.json():null;
  return {status:response.status,data};
}
const social=(user,suffix,method,body)=>request(user,`/api/social${suffix}`,method,body);
function expect(result,status,label){assert.equal(result.status,status,`${label}: HTTP ${result.status} (${result.data?.error||'no error code'})`);return result.data;}
async function check(name,fn){
  console.log(`CHECK ${name}`);
  try{await fn();report.checks.push({name,passed:true});console.log(`PASS ${name}`);}
  catch(error){report.checks.push({name,passed:false,error:safeError(error)});throw Error(`FAILED ${name}; see sanitized report.`);}
}
async function until(test,label,timeout=30_000){const deadline=Date.now()+timeout;do{if(await test())return;await sleep(500);}while(Date.now()<deadline);throw Error(`Timed out: ${label}`);}
function session(id,now){const sid=randomBytes(8).toString('hex'),secret=randomBytes(32).toString('base64url');return{token:`mdn1.${sid}.${secret}`,sql:`INSERT INTO sessions(id,user_id,secret_hash,client,created_at,last_seen,expires_at) VALUES(${literal(sid)},${literal(id)},${literal(createHash('sha256').update(secret).digest('hex'))},'preview-live-provider',${now},${now},${now+3_600_000});`};}
function connection(data,user){
  const c=data.connection,url=new URL(c.url);assert.equal(url.protocol,'wss:');assert.equal(url.hostname,providerHost,'Unexpected LiveKit project');
  assert.equal(url.username+url.password+url.search+url.hash,'');assert.ok(['','/'].includes(url.pathname));
  const jwt=JSON.parse(Buffer.from(c.token.split('.')[1],'base64url').toString('utf8'));
  assert.equal(jwt.sub,user.id);assert.equal(jwt.video.room,`lamma-${data.call.id}`);assert.equal(jwt.video.roomJoin,true);
  assert.deepEqual(jwt.video.canPublishSources,['microphone']);assert.equal(jwt.video.canPublishData,false);assert.ok(!jwt.video.roomAdmin&&!jwt.video.roomCreate);
  assert.equal(jwt.video.canUpdateOwnMetadata,false);
  assert.equal(JSON.parse(jwt.metadata).lammaJoinedAt,data.call.participants.find(p=>p.userId===user.id)?.joinedAt);
  assert.ok(jwt.exp*1000>Date.now()+30_000,'Token must be fresh enough to distinguish revocation from expiry');
  return c;
}
async function harness(){
  const bundle=await build({stdin:{resolveDir:ROOT,contents:`
    import {Room,RoomEvent,Track,setLogLevel} from 'livekit-client';
    setLogLevel('silent');
    const slots=new Map();
    async function leave(slot){const s=slots.get(slot);if(!s)return;await s.room.disconnect();s.oscillator?.stop();s.track?.stop();await s.audio?.close();slots.delete(slot);}
    async function join(slot,connection,publish=true){
      await leave(slot);const room=new Room({adaptiveStream:false,dynacast:false});
      const s={room,disconnected:false,disconnectReason:null};slots.set(slot,s);room.on(RoomEvent.Disconnected,reason=>{s.disconnected=true;s.disconnectReason=reason??null;});
      try{
        await room.connect(connection.url,connection.token,{autoSubscribe:true,maxRetries:0,peerConnectionTimeout:12000,websocketTimeout:12000});
        if(publish){const audio=new AudioContext();await audio.resume();const oscillator=audio.createOscillator(),gain=audio.createGain(),destination=audio.createMediaStreamDestination();gain.gain.value=.015;oscillator.frequency.value=240+slots.size*13;oscillator.connect(gain).connect(destination);oscillator.start();const track=destination.stream.getAudioTracks()[0];Object.assign(s,{audio,oscillator,track});await room.localParticipant.publishTrack(track,{source:Track.Source.Microphone,name:'synthetic-audio'});}
        return {connected:true,identity:room.localParticipant.identity,roomName:room.name,metadata:room.localParticipant.metadata,refreshedMetadata:room.engine.token!==connection.token?JSON.parse(atob(room.engine.token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))).metadata:null};
      }catch(e){await leave(slot);return {connected:false,reason:e.reason??null,status:e.status??null,name:e.name};}
    }
    async function snapshot(slot){const s=slots.get(slot);if(!s)return null;let tracks=0,bytes=0;for(const p of s.room.remoteParticipants.values())for(const publication of p.audioTrackPublications.values()){if(!publication.track)continue;tracks++;const stats=await publication.track.getRTCStatsReport();stats?.forEach(r=>{if(r.type==='inbound-rtp'&&r.kind==='audio')bytes+=r.bytesReceived||0;});}return {state:s.room.state,disconnected:s.disconnected,disconnectReason:s.disconnectReason,peers:s.room.remoteParticipants.size,tracks,bytes};}
    window.trial={join,leave,snapshot,close:async()=>{for(const slot of [...slots.keys()])await leave(slot);},preflight:async()=>{const audio=new AudioContext();await audio.resume();const destination=audio.createMediaStreamDestination();const result={rtc:typeof RTCPeerConnection==='function',audio:audio.state,tracks:destination.stream.getAudioTracks().length};destination.stream.getTracks().forEach(t=>t.stop());await audio.close();return result;}};
  `},bundle:true,write:false,format:'iife',logLevel:'silent'});
  server=http.createServer((_req,res)=>{res.writeHead(200,{'content-type':'text/html','cache-control':'no-store'});res.end(`<!doctype html><meta charset="utf-8"><script>${bundle.outputFiles[0].text}</script>`);});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  browser=await chromium.launch({headless:true,args:['--autoplay-policy=no-user-gesture-required'],...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
  page=await browser.newPage();await page.goto(`http://127.0.0.1:${server.address().port}`);
  assert.deepEqual(await page.evaluate(()=>window.trial.preflight()),{rtc:true,audio:'running',tracks:1});
}
const snapshot=slot=>page.evaluate(slot=>window.trial.snapshot(slot),slot);
async function joinBrowser(slot,c,user){const result=await page.evaluate(({slot,c})=>window.trial.join(slot,c),{slot,c});if(!result.connected)report.failedJoin={slot,userId:user.id,...result};assert.equal(result.connected,true,`Provider join rejected (${result.reason}/${result.status})`);assert.equal(result.identity,user.id);const metadata=JSON.parse(Buffer.from(c.token.split('.')[1],'base64url').toString('utf8')).metadata;assert.equal(result.metadata,metadata,'provider echoes signed generation metadata');report.providerMetadataEchoes=(report.providerMetadataEchoes||0)+1;if(result.refreshedMetadata!=null){assert.equal(result.refreshedMetadata,metadata,'refreshed provider token preserves generation');report.refreshedTokenMetadataEchoes=(report.refreshedTokenMetadataEchoes||0)+1;}}
async function audioFlow(slots){await until(async()=>{const states=await Promise.all(slots.map(snapshot));return states.every(s=>s?.state==='connected'&&s.peers===slots.length-1&&s.tracks===slots.length-1&&s.bytes>0);},`${slots.length} peers receiving synthetic audio`,35_000);report.maximumConnectedParticipants=Math.max(report.maximumConnectedParticipants||0,slots.length);}
async function rejectedOldToken(c){
  const claims=JSON.parse(Buffer.from(c.token.split('.')[1],'base64url').toString('utf8'));assert.ok(claims.exp*1000>Date.now()+5000,'Token expiry would make the revocation result inconclusive');
  const result=await page.evaluate(c=>window.trial.join('revoked-probe',c,false),c);
  assert.equal(result.connected,false,'Revoked provider token still admitted a participant');
  assert.equal(result.reason,0,`Expected explicit provider NotAllowed; got reason ${result.reason}, status ${result.status}`);
}
async function disconnected(slot){await until(async()=>(await snapshot(slot))?.state==='disconnected',`provider disconnect for ${slot}`);}
async function revocationAcknowledged(callId,user,c){
  const claims=JSON.parse(Buffer.from(c.token.split('.')[1],'base64url').toString('utf8')),started=Date.now();
  try{await until(async()=>{const rows=await d1(`SELECT revoked_before FROM social_call_participants WHERE call_id=${literal(callId)} AND user_id=${literal(user.id)};`,{query:true});return rows[0]?.revoked_before>claims.nbf;},'provider revocation acknowledged with a newer cutoff',30_000);}
  catch(error){report.revocationDiagnostic={originalTokenNbf:claims.nbf,participant:await d1(`SELECT state,joined_at,revoked_before,provider_sid FROM social_call_participants WHERE call_id=${literal(callId)} AND user_id=${literal(user.id)};`,{query:true}),jobs:await d1(`SELECT kind,attempts,due_at,lease_until FROM social_jobs WHERE json_extract(payload,'$.room')=${literal(`lamma-${callId}`)} AND json_extract(payload,'$.identity')=${literal(user.id)};`,{query:true})};throw error;}
  report.revocationAcknowledgementMs=Date.now()-started;
}
async function jobsRemaining(){if(!calls.length)return 0;const rows=await d1(`SELECT COUNT(*) AS n FROM social_jobs WHERE kind IN ('lk_remove','lk_delete') AND json_extract(payload,'$.room') IN (${calls.map(c=>literal(`lamma-${c.id}`)).join(',')});`,{query:true});return rows[0]?.n;}
async function start(owner,scope,conversationId){
  // Keep the API quota wait outside a newly created room's ringing window.
  if(writeWindow===Math.floor(Date.now()/60_000)&&writes+(scope==='group'?15:6)>43){console.log('Waiting for call-setup quota headroom.');await sleep(60_050-Date.now()%60_000);writeWindow=Math.floor(Date.now()/60_000);writes=0;}
  const data=expect(await social(owner,'/calls','POST',{scope,conversationId,clientId:randomUUID(),deviceId:owner.deviceId}),200,'CreateRoom through preview');
  calls.push({id:data.call.id,owner,scope,ended:false});
  report.fixtureRooms=calls.map(call=>({callId:call.id,roomName:`lamma-${call.id}`,scope:call.scope}));
  return data;
}
async function end(call){expect(await social(call.owner,`/calls/${call.id}/end`,'POST',{deviceId:call.owner.deviceId}),200,'end provider room');call.ended=true;}
async function join(user,id){return expect(await social(user,`/calls/${id}/join`,'POST',{deviceId:user.deviceId}),200,'join call');}
async function seed(){
  const now=Date.now(),sql=[];
  for(let i=0;i<12;i++){const id=`lamma-live-${runId}-${i}`,main=session(id,now),cleanup=session(id,now);users.push({id,deviceId:`preview-device-${i}`,token:main.token,cleanupToken:cleanup.token});sql.push(`INSERT INTO users(id,name,email,created_at,updated_at) VALUES(${literal(id)},${literal(`اختبار صوت ${i}`)},NULL,${now},${now});`,main.sql,cleanup.sql);}
  seeded=true;await d1(sql.join('\n'));
}
async function run(){
  assert.ok(['--check','--run-preview'].includes(mode),'Use --check or explicit --run-preview --livekit-host <preview>.livekit.cloud');
  await guard();await harness();console.log('PASS isolated Chromium, synthetic audio, and preview resource guards');
  if(mode==='--check'){report.preflightOnly=true;return;}
  assertPreviewLiveKitHost(providerHost);
  report.providerProjectId=PREVIEW_LIVEKIT_PROJECT_ID;report.providerHost=PREVIEW_LIVEKIT_HOST;
  Object.assign(report,await getBackendProvenance(ROOT,{requireClean:true}));report.previewDeploymentVersion=await deploymentVersion();
  await mkdir(outputDir,{recursive:true});expect(await request(null,'/health'),200,'preview health');await seed();
  const owner=users[0],friend=users[1];let conversationId,groupId,groupCall,groupConnections;
  await check('preview capability and accepted synthetic friendships',async()=>{
    assert.equal(expect(await social(owner,'/capabilities'),200,'capabilities').liveCalls,true,'Preview LiveKit credentials are not configured');
    for(const user of users.slice(1)){const sent=expect(await social(user,'/requests','POST',{userId:owner.id}),200,'request friendship');const accepted=expect(await social(owner,`/requests/${sent.request.id}/accept`,'POST',{}),200,'accept friendship');if(user===friend)conversationId=accepted.conversationId;}
  });
  await check('direct real audio, other-device guard, and room-ending token revocation',async()=>{
    const created=await start(owner,'direct',conversationId),call=calls.at(-1),a=connection(created,owner),b=connection(await join(friend,call.id),friend);
    await Promise.all([joinBrowser('direct-owner',a,owner),joinBrowser('direct-friend',b,friend)]);await audioFlow(['direct-owner','direct-friend']);
    expect(await social(friend,`/calls/${call.id}/leave`,'POST',{deviceId:'wrong-installation'}),200,'stale-device cleanup');
    assert.equal(expect(await social(friend,`/calls/${call.id}`),200,'still active').call.participants.find(p=>p.userId===friend.id).state,'active');
    assert.equal((await snapshot('direct-friend')).state,'connected');
    await end(call);await Promise.all(['direct-owner','direct-friend'].map(disconnected));await rejectedOldToken(a);await rejectedOldToken(b);
  });
  await check('twelve accepted group members connect and receive actual audio',async()=>{
    groupId=expect(await social(owner,'/groups','POST',{name:'لمة اختبار الاتصال المعزول'}),200,'create private group').group.id;groups.push(groupId);
    for(const user of users.slice(1)){const invite=expect(await social(owner,`/groups/${groupId}/invites`,'POST',{userId:user.id}),200,'invite friend').invitation;expect(await social(user,`/groups/${groupId}/invites/${invite.id}/accept`,'POST',{}),200,'accept group');}
    const created=await start(owner,'group',groupId);groupCall=calls.at(-1);groupConnections=[connection(created,owner)];
    for(const user of users.slice(1))groupConnections.push(connection(await join(user,groupCall.id),user));
    try{
      // Twelve simulated phones share one renderer/CPU here. Limit simultaneous
      // ICE handshakes, then retain every connection and require actual audio
      // among all twelve; media/revocation assertions are unchanged.
      for(let offset=0;offset<users.length;offset+=3)await Promise.all(users.slice(offset,offset+3).map((user,i)=>joinBrowser(`group-${offset+i}`,groupConnections[offset+i],user)));
      await audioFlow(users.map((_,i)=>`group-${i}`));
    }catch(error){
      report.groupMediaDiagnostic={browserStates:await Promise.all(users.map((_,i)=>snapshot(`group-${i}`))).catch(()=>null),ownerView:(await social(owner,`/calls/${groupCall.id}`).catch(()=>({data:null}))).data};
      report.groupMediaDiagnostic.database=await d1(`SELECT user_id,state,revoked_before,provider_sid FROM social_call_participants WHERE call_id=${literal(groupCall.id)};`,{query:true}).catch(()=>null);
      throw error;
    }
    const dto=expect(await social(owner,`/calls/${groupCall.id}`),200,'group call state').call;
    assert.equal(dto.participants.filter(p=>p.state==='active').length,12);
    assert.ok(dto.participants.every(p=>p.userId===owner.id||!('deviceId' in p)),'Other installation IDs leaked');
  });
  await check('real provider join webhooks bind every participant SID',async()=>{
    await until(async()=>{const rows=await d1(`SELECT COUNT(*) AS n FROM social_call_participants WHERE call_id=${literal(groupCall.id)} AND provider_sid IS NOT NULL;`,{query:true});return rows[0]?.n===12;},'twelve verified provider webhooks',45_000);
  });
  await check('blocking revokes media and old token while unrelated group members stay connected',async()=>{
    const before=expect(await social(owner,`/calls/${groupCall.id}`),200,'group before block').call;
    report.blockDiagnostic={before:{status:before.status,participants:before.participants.map(p=>({userId:p.userId,state:p.state}))},blockerId:friend.id,blockedId:users[2].id};
    expect(await social(friend,'/blocks','POST',{userId:users[2].id}),200,'block group peer');await disconnected('group-1');await rejectedOldToken(groupConnections[1]);
    const blockedView=await social(friend,`/calls/${groupCall.id}`);
    if(blockedView.status!==409){
      report.blockDiagnostic.blockedView={status:blockedView.status,data:blockedView.data};
      report.blockDiagnostic.ownerView=(await social(owner,`/calls/${groupCall.id}`)).data;
      report.blockDiagnostic.browserStates=await Promise.all(users.map((_,i)=>snapshot(`group-${i}`)));
      report.blockDiagnostic.database=await d1(`SELECT 'participant' AS recordType,user_id,state,revoked_before FROM social_call_participants WHERE call_id=${literal(groupCall.id)} UNION ALL SELECT 'block' AS recordType,blocker_id AS user_id,blocked_id AS state,created_at AS revoked_before FROM social_blocks WHERE blocker_id=${literal(friend.id)} OR blocked_id=${literal(friend.id)};`,{query:true});
    }
    assert.equal(expect(blockedView,409,'blocked shared call').error,'CALL_UNAVAILABLE');
    const others=await Promise.all(users.filter((_,i)=>i!==1).map(user=>snapshot(`group-${users.indexOf(user)}`)));assert.ok(others.every(s=>s.state==='connected'));
    expect(await social(friend,`/blocks/${users[2].id}`,'DELETE'),200,'unblock group peer');
    let joined;await until(async()=>{joined=await social(friend,`/calls/${groupCall.id}/join`,'POST',{deviceId:friend.deviceId});return joined.status!==409||joined.data?.error!=='CALL_RECONNECTING';},'fresh authorized rejoin',15_000);
    groupConnections[1]=connection(expect(joined,200,'rejoin after cutoff'),friend);await joinBrowser('group-1',groupConnections[1],friend);await audioFlow(users.map((_,i)=>`group-${i}`));
  });
  await check('voluntary provider disconnect triggers authenticated webhook departure',async()=>{
    await page.evaluate(()=>window.trial.leave('group-11'));
    await until(async()=>{const dto=expect(await social(owner,`/calls/${groupCall.id}`),200,'webhook departure').call;return dto.participants.find(p=>p.userId===users[11].id)?.state==='left';},'provider participant_left webhook',45_000);
    // D1's left state precedes the asynchronous RoomService response. Only the
    // recorded cutoff proves that the provider has acknowledged revocation.
    await revocationAcknowledged(groupCall.id,users[11],groupConnections[11]);
    await rejectedOldToken(groupConnections[11]);
  });
  await check('group room end revokes remaining tokens and drains RoomService jobs',async()=>{
    await end(groupCall);await Promise.all(users.slice(0,11).map((_,i)=>disconnected(`group-${i}`)));await rejectedOldToken(groupConnections[0]);
    await until(async()=>(await jobsRemaining())===0,'RemoveParticipant/DeleteRoom provider jobs drained',60_000);
  });
}
try{await run();report.passed=true;}
catch(error){report.passed=false;report.error=safeError(error);console.error(report.error);process.exitCode=1;}
finally{
  if(seeded){
    let ended=0,deleted=0;
    for(const call of calls){try{if(!call.ended)await end(call);ended++;}catch{/* Sanitized cleanup count below. */}}
    await page?.evaluate(()=>window.trial.close()).catch(()=>{});
    for(const user of users){try{if((await request({token:user.cleanupToken},'/api/account','DELETE')).status===204)deleted++;}catch{/* Scoped one-hour credentials expire even if network cleanup fails. */}}
    report.cleanup={accountsSeeded:users.length,accountsDeleted:deleted,callsCreated:calls.length,callEndRequestsAccepted:ended,credentials:'memory-only; D1 stores one-hour hashes'};
    if(calls.length)try{await until(async()=>{report.cleanup.providerJobsRemaining=await jobsRemaining();return report.cleanup.providerJobsRemaining===0;},'cleanup provider jobs drained',60_000);}catch{report.cleanup.verificationFailed=true;}
    if(deleted===users.length&&ended===calls.length&&!report.cleanup.providerJobsRemaining&&!report.cleanup.verificationFailed){
      const sql=groups.flatMap(id=>['social_group_invites','social_group_messages','social_group_members','social_groups'].map(table=>`DELETE FROM ${table} WHERE ${table==='social_groups'?'id':'group_id'}=${literal(id)};`));
      for(const call of calls)sql.push(`DELETE FROM social_call_participants WHERE call_id=${literal(call.id)};`,`DELETE FROM social_calls WHERE id=${literal(call.id)};`);
      if(sql.length)await d1(sql.join('\n')).catch(()=>{report.cleanup.tombstonesRetained=true;});
      try{const rows=await d1(`SELECT COUNT(*) AS n FROM users WHERE id LIKE ${literal(`lamma-live-${runId}-%`)} UNION ALL SELECT COUNT(*) AS n FROM sessions WHERE user_id LIKE ${literal(`lamma-live-${runId}-%`)};`,{query:true});report.cleanup.remainingUsersAndSessions=rows.reduce((n,row)=>n+row.n,0);}catch{report.cleanup.verificationFailed=true;}
    }
    if(deleted!==users.length||ended!==calls.length||report.cleanup.providerJobsRemaining||report.cleanup.verificationFailed||report.cleanup.remainingUsersAndSessions){report.passed=false;process.exitCode=1;}
    console.log(`CLEANUP ${deleted}/${users.length} synthetic accounts; ${ended}/${calls.length} calls ended`);
  }
  await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));
  if(mode==='--run-preview'){
    if(report.previewDeploymentVersion)try{const after=await getBackendProvenance(ROOT,{requireClean:true});report.sourceCommitAtFinish=after.sourceCommit;report.finishedPreviewDeploymentVersion=await deploymentVersion();assert.equal(after.backendTreeSha256,report.backendTreeSha256,'Backend changed during trial');assert.equal(report.finishedPreviewDeploymentVersion,report.previewDeploymentVersion,'Preview version changed during trial');}catch(error){report.passed=false;report.provenanceError=safeError(error);process.exitCode=1;}
    report.finishedAt=new Date().toISOString();await mkdir(outputDir,{recursive:true});await writeFile(path.join(outputDir,'live-provider-result.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});console.log(`Sanitized report: .cache/lamma-preview/live-provider-result.json (${report.passed?'PASS':'FAIL'})`);
  }
}

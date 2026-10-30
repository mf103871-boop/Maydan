import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { evaluateMafiaAcceptance, runMafiaAcceptanceReport, MAFIA_ACCEPTANCE_CASES, MAFIA_ACCEPTANCE_SCOPES } from '../scripts/mafia-acceptance-report.mjs';

const ROOT=fileURLToPath(new URL('../',import.meta.url)),CLI=path.join(ROOT,'scripts/mafia-acceptance-report.mjs');
const NOW=Date.UTC(2026,9,30,12),DAY=86400000,ISO=new Date(NOW-60_000).toISOString(),MAX=1048576;
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const clone=value=>structuredClone(value);
const roles=['citizen','investigator','doctor','guard','observer','reporter','herald','analyst','mafia','masker','blocker','leader','tracker'];

// ALL claims below are manufactured unit data, including the deliberately
// human/device/provider-looking rows. They NEVER attest a real device, human,
// deployment, subscription or test run. Even the consistent fixture must remain
// unauthenticated and NOT ready for release.
function manufacturedOperatorClaims(now=NOW) {
  const ISO=new Date(now-60_000).toISOString();
  const candidate={sourceCommit:'a'.repeat(40),indexSHA256:'1'.repeat(64),workerSHA256:'2'.repeat(64),configSHA256:'3'.repeat(64),migrationSetSHA256:'4'.repeat(64),
    worker:'maydan-mafia-preview',url:'https://maydan-mafia-preview.mf103871.workers.dev',activeVersion:'11111111-2222-4333-8444-555555555555',
    productionChanged:false,sourceTreeClean:true,verification:{workerBytesMatch:true,indexBytesMatch:true},pendingMigrations:[],
    rules:{rulesetVersion:1,protocol:2,supportedRulesetVersions:[1,2]},nativeBuild:'1.9 (37)',nativeIndexSHA256:'5'.repeat(64)};
  const manifest={kind:'mafia-preview-manifest',config:{sha256:candidate.configSHA256},migrationSetSHA256:candidate.migrationSetSHA256,rules:clone(candidate.rules),capacity:{maxActiveRooms:1,maxVoiceParticipants:80}};
  const evidence={schemaVersion:1,kind:'mafia-acceptance-evidence',candidate:{sourceCommit:candidate.sourceCommit,workerVersion:candidate.activeVersion,indexSHA256:candidate.indexSHA256,workerSHA256:candidate.workerSHA256,protocol:2,rulesets:[1,2],ratingModel:'preview-elo-1'},
    artifacts:[],automation:null,devices:[],cases:[],humanSamples:[],balanceReview:null,providerQuota:null,performance:null,ratingReview:null};
  const bytesById={},artifactIntegrity={},artifactChecks={};
  function artifact(id,kind,checks=['synthetic-fixture']) {
    const observations=checks.map(check=>({check,status:'pass',triggerCode:'synthetic-unit-fixture',outcomeCode:'fabricated-test-data',counts:{'synthetic-only':1},measurements:{}}));
    const receipt={schemaVersion:1,kind:'mafia-acceptance-artifact',type:kind,candidate:{sourceCommit:candidate.sourceCommit,indexSHA256:candidate.indexSHA256,workerVersion:candidate.activeVersion},capturedAt:ISO,observations};
    const bytes=Buffer.from(JSON.stringify(receipt));bytesById[id]=bytes;artifactIntegrity[id]=true;artifactChecks[id]=observations.map(({check,status})=>({check,status}));
    evidence.artifacts.push({id,path:`artifacts/${id}.json`,sha256:hash(bytes),kind,capturedAt:ISO});return id;
  }
  const automated=artifact('automated','automated-run',MAFIA_ACCEPTANCE_SCOPES),devices=artifact('devices','device-observation',MAFIA_ACCEPTANCE_CASES);
  evidence.automation={sourceCommit:candidate.sourceCommit,passed:1,failed:0,skipped:0,scopes:[...MAFIA_ACCEPTANCE_SCOPES],artifactIds:[automated],completedAt:ISO};
  evidence.devices=[
    ...['phone-a','phone-b'].flatMap(hardwareAlias=>[
      {alias:hardwareAlias+'-safari',hardwareAlias,kind:'physical-iphone-safari',platformVersion:'iOS 26.0',clientVersion:'Safari 26.0',indexSHA256:candidate.indexSHA256,nativeBuild:null},
      {alias:hardwareAlias+'-native',hardwareAlias,kind:'physical-iphone-native',platformVersion:'iOS 26.0',clientVersion:'1.9',indexSHA256:candidate.nativeIndexSHA256,nativeBuild:candidate.nativeBuild}]),
    {alias:'independent',hardwareAlias:'desktop-a',kind:'independent-browser',platformVersion:'test',clientVersion:'Chromium test',indexSHA256:candidate.indexSHA256,nativeBuild:null}];
  evidence.cases=MAFIA_ACCEPTANCE_CASES.map(id=>({id,status:'pass',devices:evidence.devices.map(row=>row.alias),artifactIds:[devices],observedAt:ISO,unauthorizedAudienceCount:0,duplicateAuthoritativeRewardCount:0}));
  for(let capacity=6;capacity<=12;capacity++)evidence.humanSamples.push({capacity,mode:capacity<9?'classic':'shadow',rulesetVersion:1,participantKind:'real-human',completed:capacity===7?10:3,groups:capacity===7?2:1,novices:2,returning:2,understandingParticipants:4,correctWinCondition:4,artifactIds:[artifact(`humans-${capacity}`,'human-session')],observedAt:ISO});
  evidence.humanSamples.push({capacity:8,mode:'classic',rulesetVersion:2,participantKind:'real-human',completed:3,groups:1,novices:0,returning:0,understandingParticipants:0,correctWinCondition:0,artifactIds:[artifact('tracker','human-session')],observedAt:ISO});
  evidence.balanceReview={rolesCovered:roles,sevenPlayerReviewed:true,blockingIssues:0,artifactIds:[artifact('balance','balance-review')],reviewedAt:ISO};
  evidence.providerQuota={provider:'livekit',participantLimit:92,roomLimit:2,mafiaReservedParticipants:80,mafiaReservedRooms:1,socialReservedParticipants:12,socialReservedRooms:1,artifactIds:[artifact('quota','provider-quota')],capturedAt:ISO};
  evidence.performance={networkRttMs:150,actionAckP95Ms:300,audioTransitionMaxMs:3000,actionSamples:100,audioSamples:20,queueWaitP90Ms:89999,queueMatches:10,artifactIds:[artifact('performance','performance')],capturedAt:ISO};
  const calibration={kind:'mafia-rating-calibration-report',schemaVersion:1,evidenceKind:'real-human',status:'candidate-needs-review',rulesetVersion:1,template:'classic8-6town-2mafia',baselineModel:'preview-elo-1',provenance:{sourceCommit:candidate.sourceCommit},blockerCodes:[],policySHA256:'6'.repeat(64)};
  const calibrationBytes=Buffer.from(JSON.stringify(calibration)),calibrationSHA256=hash(calibrationBytes);
  evidence.ratingReview={reportSHA256:calibrationSHA256,policySHA256:calibration.policySHA256,decision:'accepted-for-next-preview-season',artifactIds:[artifact('rating','rating-review')],reviewedAt:ISO};
  return {candidate,manifest,evidence,artifactIntegrity,artifactChecks,calibration,calibrationSHA256,calibrationBytes,bytesById,now};
}
const evaluate=f=>evaluateMafiaAcceptance(f);
const blocked=(result,code)=>assert.ok(result.blockers.some(row=>row.code===code),JSON.stringify(result));
function neverAuthenticated(result) {
  assert.equal(result.ready,false);assert.equal(result.liveVerified,false);assert.equal(result.physicalHumanClaimsAuthenticated,false);assert.equal(result.testsRunByThisTool,false);
}

test('a consistent SYNTHETIC fixture only completes supplied claims; it never authenticates people or release readiness',()=>{
  const result=evaluate(manufacturedOperatorClaims());assert.equal(result.status,'supplied-evidence-complete-unverified');assert.equal(result.suppliedEvidenceComplete,true);neverAuthenticated(result);
});

test('the incomplete operator template cannot satisfy physical, human, quota or calibration gates',async()=>{
  const f=manufacturedOperatorClaims();f.evidence=JSON.parse(await readFile(path.join(ROOT,'docs/mafia/acceptance-template.json'),'utf8'));
  const result=evaluate(f);assert.equal(result.status,'incomplete');neverAuthenticated(result);
  for(const section of ['candidate','automation','D2','D3','G1','A5','performance','E2'])assert.ok(result.blockers.some(row=>row.section===section),section);
});

test('an exact duplicate human bucket cannot double a below-threshold seven-player sample',()=>{
  const f=manufacturedOperatorClaims(),sample=f.evidence.humanSamples.find(row=>row.capacity===7);sample.completed=5;sample.groups=1;
  f.evidence.humanSamples.push(clone(sample));const result=evaluate(f);assert.equal(result.suppliedEvidenceComplete,false);
  blocked(result,'REAL_HUMAN_7_PLAYER_SAMPLES_REQUIRED');
});

test('human group and comprehension counts must describe a possible cohort',()=>{
  for(const changes of [{groups:4,completed:3},{novices:0,returning:0,understandingParticipants:4},{correctWinCondition:5,understandingParticipants:4}]){
    const f=manufacturedOperatorClaims();Object.assign(f.evidence.humanSamples[0],changes);
    assert.throws(()=>evaluate(f),/INVALID_HUMAN_COUNTS/);
  }
});

test('matching malformed rules and worker identities cannot become an accepted current candidate',()=>{
  for(const update of [f=>{f.candidate.rules.protocol=99;f.manifest.rules.protocol=99;f.evidence.candidate.protocol=99;},
    f=>{f.candidate.rules.rulesetVersion=999;f.manifest.rules.rulesetVersion=999;},
    f=>{f.candidate.rules.supportedRulesetVersions=[1,9];f.manifest.rules.supportedRulesetVersions=[1,9];f.evidence.candidate.rulesets=[1,9];},
    f=>{f.candidate.activeVersion='not-a-worker-version';f.evidence.candidate.workerVersion='not-a-worker-version';}]){
    const f=manufacturedOperatorClaims();update(f);assert.throws(()=>evaluate(f),/INVALID_CANDIDATE_RECEIPT/);
  }
});

test('Safari and native evidence must describe the SAME two phones, with a separate browser',()=>{
  const f=manufacturedOperatorClaims();for(const row of f.evidence.devices)if(row.kind==='physical-iphone-native')row.hardwareAlias+='-different';
  const result=evaluate(f);assert.equal(result.suppliedEvidenceComplete,false);neverAuthenticated(result);
});

test('candidate source, configuration, index, worker bytes, migrations and native delivery remain separately bound',()=>{
  const mutations=[
    [f=>f.evidence.candidate.sourceCommit='b'.repeat(40),'EVIDENCE_CANDIDATE_MISMATCH'],
    [f=>f.evidence.candidate.indexSHA256='8'.repeat(64),'EVIDENCE_CANDIDATE_MISMATCH'],
    [f=>f.evidence.candidate.workerSHA256='8'.repeat(64),'EVIDENCE_CANDIDATE_MISMATCH'],
    [f=>f.evidence.candidate.workerVersion='22222222-2222-4333-8444-555555555555','EVIDENCE_CANDIDATE_MISMATCH'],
    [f=>f.evidence.candidate.rulesets=[1],'EVIDENCE_CANDIDATE_MISMATCH'],
    [f=>f.candidate.configSHA256='8'.repeat(64),'LOCAL_MANIFEST_MISMATCH'],
    [f=>f.manifest.migrationSetSHA256='8'.repeat(64),'LOCAL_MANIFEST_MISMATCH'],
    [f=>f.manifest.rules.protocol=1,'LOCAL_MANIFEST_MISMATCH'],
    [f=>f.candidate.url='https://maydan-game.mf103871.workers.dev','ISOLATED_PREVIEW_RECEIPT_REQUIRED'],
    [f=>f.candidate.productionChanged=true,'ISOLATED_PREVIEW_RECEIPT_REQUIRED'],
    [f=>f.candidate.sourceTreeClean=false,'FROZEN_DEPLOYMENT_CORRESPONDENCE_MISSING'],
    [f=>f.candidate.pendingMigrations=['0025_mafia_rating_policy.sql'],'FROZEN_DEPLOYMENT_CORRESPONDENCE_MISSING'],
    [f=>f.candidate.verification.workerBytesMatch=false,'FROZEN_DEPLOYMENT_CORRESPONDENCE_MISSING'],
    [f=>delete f.candidate.nativeIndexSHA256,'MATCHED_UPDATED_NATIVE_BUILD_ON_TWO_PHONES_REQUIRED'],
    [f=>f.candidate.nativeBuild='1.8 (22)','MATCHED_UPDATED_NATIVE_BUILD_ON_TWO_PHONES_REQUIRED'],
  ];
  for(const [mutate,code]of mutations){const f=manufacturedOperatorClaims();mutate(f);const result=evaluate(f);blocked(result,code);neverAuthenticated(result);}
});

test('test totals, generic pass strings and an old 1715 count cannot replace bound current observations',()=>{
  for(const observations of [undefined,'pass',[{check:'pass',status:'pass'}],MAFIA_ACCEPTANCE_SCOPES.map(check=>({check,status:'not-run'}))]){
    const f=manufacturedOperatorClaims();f.evidence.automation.passed=1715;f.artifactChecks.automated=observations;
    blocked(evaluate(f),'CURRENT_CANDIDATE_INTEGRATED_TEST_EVIDENCE_REQUIRED');
  }
  const f=manufacturedOperatorClaims();f.evidence.automation.sourceCommit='b'.repeat(40);
  blocked(evaluate(f),'CURRENT_CANDIDATE_INTEGRATED_TEST_EVIDENCE_REQUIRED');
});

test('missing hashes, stale artifacts, missing observations and recorded failures cannot be papered over by pass declarations',()=>{
  for(const mutate of [f=>f.artifactIntegrity.automated=false,f=>f.evidence.artifacts.find(x=>x.id==='automated').capturedAt=new Date(NOW-8*DAY).toISOString(),f=>delete f.artifactChecks.automated]){
    const f=manufacturedOperatorClaims();mutate(f);blocked(evaluate(f),'CURRENT_CANDIDATE_INTEGRATED_TEST_EVIDENCE_REQUIRED');
  }
  const f=manufacturedOperatorClaims();f.artifactChecks.automated.push({check:MAFIA_ACCEPTANCE_SCOPES[0],status:'fail'});
  blocked(evaluate(f),'RECORDED_FAILURE_REQUIRES_RESOLUTION');
  f.evidence.artifacts[0].capturedAt=new Date(NOW+60_001).toISOString();blocked(evaluate(f),'CURRENT_CANDIDATE_INTEGRATED_TEST_EVIDENCE_REQUIRED');
});

test('physical aliases, hardware pairs, web/native hashes and each observed case cannot substitute for one another',()=>{
  const mutations=[
    f=>f.evidence.devices[1].alias=f.evidence.devices[0].alias,
    f=>f.evidence.devices.push({...f.evidence.devices[0],alias:'duplicate-safari'}),
    f=>f.evidence.devices.find(x=>x.kind==='independent-browser').hardwareAlias='phone-a',
    f=>f.evidence.devices[0].indexSHA256=f.candidate.nativeIndexSHA256,
    f=>f.evidence.devices[1].indexSHA256=f.candidate.indexSHA256,
    f=>f.evidence.devices[1].nativeBuild='1.8 (22)',
    f=>f.evidence.cases[0].devices=f.evidence.cases[0].devices.filter(alias=>alias!=='phone-b-native'),
    f=>f.evidence.cases[0].devices.push('unknown-device'),
    f=>f.evidence.cases[0].unauthorizedAudienceCount=1,
    f=>f.evidence.cases[0].duplicateAuthoritativeRewardCount=1,
    f=>f.evidence.cases[0].status='fail',
    f=>f.evidence.cases[0].observedAt=new Date(NOW-31*DAY).toISOString(),
  ];
  for(const mutate of mutations){const f=manufacturedOperatorClaims();mutate(f);const result=evaluate(f);assert.equal(result.suppliedEvidenceComplete,false);assert.ok(result.blockers.some(x=>x.section==='D2'));neverAuthenticated(result);}
  const f=manufacturedOperatorClaims();f.evidence.devices[0].kind='simulator';assert.throws(()=>evaluate(f),/INVALID_DEVICE_METADATA/);
});

test('every v1 capacity needs its own real-human claims; synthetic, mixed and tracker rows cannot fill gaps',()=>{
  for(let capacity=6;capacity<=12;capacity++){
    const f=manufacturedOperatorClaims();f.evidence.humanSamples=f.evidence.humanSamples.filter(row=>row.rulesetVersion!==1||row.capacity!==capacity);
    blocked(evaluate(f),`REAL_HUMAN_${capacity}_PLAYER_SAMPLES_REQUIRED`);
  }
  for(const participantKind of ['synthetic','mixed']){
    const f=manufacturedOperatorClaims();f.evidence.humanSamples.forEach(row=>row.participantKind=participantKind);const result=evaluate(f);
    for(let capacity=6;capacity<=12;capacity++)blocked(result,`REAL_HUMAN_${capacity}_PLAYER_SAMPLES_REQUIRED`);
    blocked(result,'REAL_HUMAN_TRACKER_SAMPLE_REQUIRED');
  }
  for(const mutate of [f=>f.evidence.humanSamples.find(x=>x.capacity===7).groups=1,
    f=>f.evidence.humanSamples.find(x=>x.capacity===7).completed=9,
    f=>f.evidence.humanSamples.find(x=>x.rulesetVersion===2).completed=2,
    f=>f.evidence.humanSamples.find(x=>x.rulesetVersion===2).observedAt=new Date(NOW-31*DAY).toISOString()]){
    const f=manufacturedOperatorClaims();mutate(f);assert.equal(evaluate(f).suppliedEvidenceComplete,false);
  }
  const f=manufacturedOperatorClaims();f.evidence.humanSamples.find(x=>x.rulesetVersion===2).mode='shadow';assert.throws(()=>evaluate(f),/INVALID_HUMAN_SAMPLE/);
});

test('comprehension, role review, provider reservations, performance and separate calibration review retain their thresholds',()=>{
  const cases=[
    [f=>f.evidence.humanSamples.forEach(row=>row.correctWinCondition=0),'RECORDED_NEW_PLAYER_COMPREHENSION_REQUIRED'],
    [f=>f.evidence.balanceReview.rolesCovered=roles.filter(role=>role!=='tracker'),'FIXED_CANDIDATE_ROLE_AND_SEVEN_PLAYER_REVIEW_REQUIRED'],
    [f=>f.evidence.balanceReview.sevenPlayerReviewed=false,'FIXED_CANDIDATE_ROLE_AND_SEVEN_PLAYER_REVIEW_REQUIRED'],
    ...Object.entries({participantLimit:91,roomLimit:1,mafiaReservedParticipants:79,mafiaReservedRooms:0,socialReservedParticipants:11,socialReservedRooms:0}).map(([field,value])=>[f=>f.evidence.providerQuota[field]=value,'CURRENT_PROVIDER_QUOTA_WITH_MAFIA_AND_SOCIAL_RESERVE_REQUIRED']),
    [f=>f.evidence.providerQuota.capturedAt=new Date(NOW-8*DAY).toISOString(),'CURRENT_PROVIDER_QUOTA_WITH_MAFIA_AND_SOCIAL_RESERVE_REQUIRED'],
    ...Object.entries({networkRttMs:150.01,actionAckP95Ms:300.01,audioTransitionMaxMs:3000.01,actionSamples:99,audioSamples:19,queueWaitP90Ms:90000,queueMatches:9}).map(([field,value])=>[f=>f.evidence.performance[field]=value,'CONTROLLED_NETWORK_AUDIO_ACTION_AND_POPULATED_QUEUE_MEASUREMENTS_REQUIRED']),
    [f=>f.evidence.performance.capturedAt=new Date(NOW-15*DAY).toISOString(),'CONTROLLED_NETWORK_AUDIO_ACTION_AND_POPULATED_QUEUE_MEASUREMENTS_REQUIRED'],
    [f=>f.calibration.evidenceKind='synthetic','REAL_HUMAN_CALIBRATION_AND_SEPARATE_REVIEW_REQUIRED'],
    [f=>f.calibration.provenance.sourceCommit='b'.repeat(40),'REAL_HUMAN_CALIBRATION_AND_SEPARATE_REVIEW_REQUIRED'],
    [f=>f.calibration.blockerCodes=['insufficient-evidence'],'REAL_HUMAN_CALIBRATION_AND_SEPARATE_REVIEW_REQUIRED'],
    [f=>f.evidence.ratingReview=null,'REAL_HUMAN_CALIBRATION_AND_SEPARATE_REVIEW_REQUIRED'],
    [f=>f.evidence.ratingReview.reportSHA256='7'.repeat(64),'REAL_HUMAN_CALIBRATION_AND_SEPARATE_REVIEW_REQUIRED'],
    [f=>f.evidence.ratingReview.policySHA256='7'.repeat(64),'REAL_HUMAN_CALIBRATION_AND_SEPARATE_REVIEW_REQUIRED'],
    [f=>f.evidence.ratingReview.decision='activate-now','REAL_HUMAN_CALIBRATION_AND_SEPARATE_REVIEW_REQUIRED'],
  ];
  for(const [mutate,code]of cases){const f=manufacturedOperatorClaims();mutate(f);const result=evaluate(f);blocked(result,code);neverAuthenticated(result);}
  for(const section of ['providerQuota','performance','balanceReview']){const f=manufacturedOperatorClaims();f.evidence[section].ready=true;assert.throws(()=>evaluate(f),/INVALID_EVIDENCE_SCHEMA/);}
  const f=manufacturedOperatorClaims();f.candidate.ready=true;f.calibration.ready=true;neverAuthenticated(evaluate(f));
});

async function diskFixture(t,f=manufacturedOperatorClaims(Date.now())) {
  const base=path.resolve(os.tmpdir()),directory=await mkdtemp(path.join(base,'mafia-acceptance-synthetic-'));
  t.after(async()=>{const relative=path.relative(base,directory);assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));await rm(directory,{recursive:true,force:true});});
  const files=Object.fromEntries(['candidate','manifest','evidence','calibration'].map(key=>[key,path.join(directory,key+'.json')]));
  const save=async()=>{for(const key of Object.keys(files))await writeFile(files[key],JSON.stringify(f[key]));};
  await mkdir(path.join(directory,'artifacts'));await save();
  for(const artifact of f.evidence.artifacts)await writeFile(path.join(directory,artifact.path),f.bytesById[artifact.id]);
  const argv=Object.entries(files).flatMap(([key,file])=>['--'+key,file]);
  const cli=(args=argv)=>{const result=spawnSync(process.execPath,[CLI,...args],{cwd:directory,encoding:'utf8',timeout:15_000,maxBuffer:1024*1024});assert.ifError(result.error);return result;};
  const rewriteArtifact=async(id,mutate)=>{const metadata=f.evidence.artifacts.find(x=>x.id===id),receipt=JSON.parse(f.bytesById[id]);mutate(receipt);const bytes=Buffer.from(JSON.stringify(receipt));metadata.sha256=hash(bytes);f.bytesById[id]=bytes;await writeFile(path.join(directory,metadata.path),bytes);await save();};
  return {directory,files,f,argv,save,cli,rewriteArtifact};
}
function cliError(result,code) {assert.equal(result.status,1,result.stdout+result.stderr);assert.equal(result.stdout,'');assert.deepEqual(JSON.parse(result.stderr),{error:code});}

test('real CLI hashes sanitized files and returns only an unauthenticated synthetic completion receipt',async t=>{
  const h=await diskFixture(t),result=h.cli();assert.equal(result.status,0,result.stderr);assert.equal(result.stderr,'');const report=JSON.parse(result.stdout);
  assert.equal(report.status,'supplied-evidence-complete-unverified');neverAuthenticated(report);
  const direct=await runMafiaAcceptanceReport(h.argv),again=JSON.parse(h.cli().stdout);
  assert.ok(Number.isFinite(Date.parse(direct.evaluatedAt))&&Date.parse(direct.evaluatedAt)<=Date.now());
  delete direct.evaluatedAt;delete again.evaluatedAt;assert.deepEqual(direct,again);
});

test('real CLI rejects stale candidate-bound artifacts, forged checks, raw old totals and missing or changed bytes',async t=>{
  const h=await diskFixture(t);
  await h.rewriteArtifact('automated',receipt=>receipt.candidate.sourceCommit='b'.repeat(40));
  let result=h.cli();assert.equal(result.status,2);blocked(JSON.parse(result.stdout),'ARTIFACT_MISSING_OR_HASH_MISMATCH');neverAuthenticated(JSON.parse(result.stdout));
  await h.rewriteArtifact('automated',receipt=>{receipt.candidate.sourceCommit=h.f.candidate.sourceCommit;receipt.observations=[{check:'old-1715-tests',status:'pass',triggerCode:'synthetic-unit-fixture',outcomeCode:'fabricated-test-data',counts:{passed:1715},measurements:{}}];});
  result=h.cli();assert.equal(result.status,2);blocked(JSON.parse(result.stdout),'CURRENT_CANDIDATE_INTEGRATED_TEST_EVIDENCE_REQUIRED');
  await writeFile(path.join(h.directory,'artifacts/automated.json'),'PRIVATE-SENTINEL old 1715 tests passed');
  result=h.cli();cliError(result,'INVALID_JSON');assert.ok(!(result.stdout+result.stderr).includes('PRIVATE-SENTINEL'));
  await rm(path.join(h.directory,'artifacts/automated.json'));result=h.cli();assert.equal(result.status,2);blocked(JSON.parse(result.stdout),'ARTIFACT_MISSING_OR_HASH_MISMATCH');
});

test('real CLI preserves a recorded failure even when the same current check also contains pass',async t=>{
  const h=await diskFixture(t);await h.rewriteArtifact('automated',receipt=>receipt.observations.push({...receipt.observations[0],status:'fail'}));
  const result=h.cli();assert.equal(result.status,2);blocked(JSON.parse(result.stdout),'RECORDED_FAILURE_REQUIRES_RESOLUTION');neverAuthenticated(JSON.parse(result.stdout));
});

test('real CLI rejects hash mismatches and stale/current-binding mismatches independently of valid receipt syntax',async t=>{
  const h=await diskFixture(t),metadata=h.f.evidence.artifacts.find(row=>row.id==='automated');
  const receipt=JSON.parse(h.f.bytesById.automated);receipt.observations[0].counts.changed=1;
  await writeFile(path.join(h.directory,metadata.path),JSON.stringify(receipt));let result=h.cli();assert.equal(result.status,2);blocked(JSON.parse(result.stdout),'ARTIFACT_MISSING_OR_HASH_MISMATCH');
  metadata.capturedAt=new Date(Date.now()-8*DAY).toISOString();await h.rewriteArtifact('automated',row=>row.capturedAt=metadata.capturedAt);
  result=h.cli();assert.equal(result.status,2);blocked(JSON.parse(result.stdout),'CURRENT_CANDIDATE_INTEGRATED_TEST_EVIDENCE_REQUIRED');
  const artifact=JSON.parse(h.f.bytesById.automated);artifact.observations[0].counts.unsafe='PRIVATE-SENTINEL';
  await writeFile(path.join(h.directory,metadata.path),JSON.stringify(artifact));result=h.cli();cliError(result,'INVALID_ARTIFACT_OBSERVATION');assert.ok(!result.stderr.includes('PRIVATE-SENTINEL'));
});

test('CLI rejects malformed, deep, excessive-node and oversized input without leaking paths or contents',async t=>{
  const h=await diskFixture(t),bad=[
    ['PRIVATE-SENTINEL invalid json','INVALID_JSON'],
    ['{"constructor":{}}','INVALID_JSON_KEY'],
    [JSON.stringify({value:'x'.repeat(4097)}),'JSON_STRING_LIMIT'],
    [JSON.stringify(Array.from({length:20001},()=>null)),'JSON_COMPLEXITY_LIMIT'],
    [JSON.stringify(Array.from({length:18}).reduce(value=>({nested:value}),null)),'JSON_COMPLEXITY_LIMIT'],
    [Buffer.alloc(MAX+1,32),'JSON_FILE_LIMIT'],
  ];
  for(const [bytes,code]of bad){await writeFile(h.files.evidence,bytes);const result=h.cli();cliError(result,code);assert.ok(!(result.stdout+result.stderr).includes(h.directory));assert.ok(!(result.stdout+result.stderr).includes('PRIVATE-SENTINEL'));}
  await h.save();await rm(h.files.candidate);cliError(h.cli(),'EVIDENCE_FILE_UNAVAILABLE');
  cliError(h.cli(['--candidate','PRIVATE-SENTINEL-missing','--manifest',h.files.manifest,'--evidence',h.files.evidence]),'EVIDENCE_FILE_UNAVAILABLE');
});

test('CLI permits the exact 1MiB JSON boundary and rejects its next byte',async t=>{
  const h=await diskFixture(t),bytes=Buffer.from(JSON.stringify(h.f.evidence));await writeFile(h.files.evidence,Buffer.concat([bytes,Buffer.alloc(MAX-bytes.length,32)]));
  assert.equal(h.cli().status,0);await writeFile(h.files.evidence,Buffer.concat([bytes,Buffer.alloc(MAX+1-bytes.length,32)]));cliError(h.cli(),'JSON_FILE_LIMIT');
});

test('CLI JSON complexity permits depth16 and 20000 nodes exactly and rejects the next step',async t=>{
  const h=await diskFixture(t);
  h.f.manifest.extra=Array.from({length:15}).reduce(value=>({nested:value}),null);await h.save();assert.equal(h.cli().status,0);
  h.f.manifest.extra={nested:h.f.manifest.extra};await h.save();cliError(h.cli(),'JSON_COMPLEXITY_LIMIT');
  delete h.f.manifest.extra;const nodes=value=>1+(value&&typeof value==='object'?Object.values(value).reduce((total,item)=>total+nodes(item),0):0);
  h.f.manifest.extra=Array.from({length:20000-nodes(h.f.manifest)-1},()=>null);await h.save();assert.equal(h.cli().status,0);
  h.f.manifest.extra.push(null);await h.save();cliError(h.cli(),'JSON_COMPLEXITY_LIMIT');
});

test('artifact count and aggregate bytes are bounded independently of individual valid JSON sizes',async t=>{
  const h=await diskFixture(t),original=h.f.evidence.artifacts.find(x=>x.id==='humans-6'),bytes=h.f.bytesById[original.id];
  while(h.f.evidence.artifacts.length<64){const id='extra-'+h.f.evidence.artifacts.length,row={...original,id,path:`artifacts/${id}.json`};h.f.evidence.artifacts.push(row);await writeFile(path.join(h.directory,row.path),bytes);}
  await h.save();assert.equal(h.cli().status,0);
  h.f.evidence.artifacts.push({...original,id:'extra-65',path:'artifacts/extra-65.json'});await h.save();cliError(h.cli(),'ARTIFACT_COUNT_LIMIT');
  h.f.evidence.artifacts=[];
  const padded=Buffer.concat([bytes,Buffer.alloc(MAX-bytes.length,32)]);
  for(let n=0;n<9;n++){const id='large-'+n,row={...original,id,path:`artifacts/${id}.json`,sha256:hash(padded)};h.f.evidence.artifacts.push(row);await writeFile(path.join(h.directory,row.path),padded);}
  await h.save();cliError(h.cli(),'ARTIFACT_FILE_LIMIT');
});

test('traversal, symlinks, directories and empty artifact files are rejected without reading private contents',async t=>{
  const h=await diskFixture(t),row=h.f.evidence.artifacts[0],original=row.path;
  for(const invalid of ['artifacts/../PRIVATE-SENTINEL.json','../PRIVATE-SENTINEL.json','artifacts//nested.json','artifacts/./nested.json']){row.path=invalid;await h.save();cliError(h.cli(),'INVALID_ARTIFACT_PATH');}
  const outside=path.join(h.directory,'private-outside-artifacts');await mkdir(outside);await writeFile(path.join(outside,'PRIVATE-SENTINEL.json'),'PRIVATE-SENTINEL');
  await symlink(outside,path.join(h.directory,'artifacts/link'),'junction');row.path='artifacts/link/PRIVATE-SENTINEL.json';await h.save();let result=h.cli();cliError(result,'ARTIFACT_FILE_LIMIT');assert.ok(!result.stderr.includes('PRIVATE-SENTINEL'));
  row.path='artifacts/directory.json';await mkdir(path.join(h.directory,row.path));await h.save();cliError(h.cli(),'ARTIFACT_FILE_LIMIT');
  row.path=original;await writeFile(path.join(h.directory,row.path),'');await h.save();cliError(h.cli(),'ARTIFACT_FILE_LIMIT');
  await writeFile(path.join(h.directory,row.path),Buffer.alloc(MAX+1,32));cliError(h.cli(),'ARTIFACT_FILE_LIMIT');
});

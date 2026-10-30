// Read-only operator evidence evaluation. This never runs tests, calls a
// provider, reads credentials, changes environments or grants release approval.
import {open,realpath,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {MAFIA_PROTOCOL,MAFIA_RULESET_VERSION,MAFIA_ALL_ROLES} from '../src/online/mafia-shared.js';
import {MAFIA_SUPPORTED_RULESET_VERSIONS} from '../server/mafia-ruleset-policy.mjs';

const SHA=/^[a-f0-9]{64}$/,COMMIT=/^[a-f0-9]{40}$/,ALIAS=/^[a-z][a-z0-9-]{0,39}$/;
const WORKER_VERSION=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const DAY=86400000,MAX_JSON=1048576,MAX_ARTIFACTS=64,MAX_ARTIFACT_BYTES=8*MAX_JSON;
const stamp=value=>typeof value==='string'&&Number.isFinite(Date.parse(value));
const count=value=>Number.isSafeInteger(value)&&value>=0;
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export const MAFIA_ACCEPTANCE_CASES=Object.freeze([
  'join-reconnect','account-replacement','layout-input','background-lock-privacy',
  'network-handover','permission-listen-only','system-audio-interruption',
  'faction-audience-transition','conversion-elimination','stale-grant-denial',
  'observer-delay','rewards-duplicates','reports-permissions','tracker-interactions',
]);
export const MAFIA_ACCEPTANCE_SCOPES=Object.freeze([
  'engine-rulesets','d1-ledgers','account-deletion','identity-epochs','ranked-matchmaking',
  'ranked-settlement','season-close','community-grants','tournament-roster',
  'tracker-interactions','voice-authorization','browser-responsive',
]);
const roles=Object.keys(MAFIA_ALL_ROLES);
const deviceKinds=['physical-iphone-safari','physical-iphone-native','independent-browser'];
const artifactKinds=['automated-run','device-observation','human-session','balance-review','provider-quota','performance','rating-review'];
function requireShape(value,fields){
  if(!object(value)||Object.keys(value).some(key=>!fields.includes(key)))throw new Error('INVALID_EVIDENCE_SCHEMA');
}
function boundedJSON(bytes){
  if(bytes.length>MAX_JSON)throw new Error('JSON_SIZE_LIMIT');
  let value;try{value=JSON.parse(bytes.toString('utf8'));}catch{throw new Error('INVALID_JSON');}
  let nodes=0;
  const inspect=(item,depth=0)=>{
    if(++nodes>20000||depth>16)throw new Error('JSON_COMPLEXITY_LIMIT');
    if(typeof item==='string'&&item.length>4096)throw new Error('JSON_STRING_LIMIT');
    if(item&&typeof item==='object')for(const [key,child]of Object.entries(item)){
      if(['__proto__','constructor','prototype'].includes(key)||key.length>100)throw new Error('INVALID_JSON_KEY');
      inspect(child,depth+1);
    }
  };inspect(value);return value;
}
async function readBoundedBytes(file,error='JSON_FILE_LIMIT'){
  const handle=await open(file,'r');
  try{
    const info=await handle.stat();if(!info.isFile()||info.size>MAX_JSON)throw new Error(error);
    // Bound the read itself too: a file growing after stat must not allocate an
    // unbounded buffer before the JSON/aggregate limits get a chance to reject.
    const buffer=Buffer.allocUnsafe(MAX_JSON+1);let length=0;
    while(length<buffer.length){const result=await handle.read(buffer,length,buffer.length-length,length);if(!result.bytesRead)break;length+=result.bytesRead;}
    if(length>MAX_JSON)throw new Error(error);return buffer.subarray(0,length);
  }finally{await handle.close();}
}
const readJSONBytes=file=>readBoundedBytes(file);
async function readJSON(file){return boundedJSON(await readJSONBytes(file));}
function validateEvidence(evidence){
  requireShape(evidence,['schemaVersion','kind','candidate','artifacts','automation','devices','cases','humanSamples','balanceReview','providerQuota','performance','ratingReview']);
  if(evidence.schemaVersion!==1||evidence.kind!=='mafia-acceptance-evidence')throw new Error('INVALID_EVIDENCE_KIND');
  requireShape(evidence.candidate,['sourceCommit','workerVersion','indexSHA256','workerSHA256','protocol','rulesets','ratingModel']);
  for(const field of ['artifacts','devices','cases','humanSamples'])if(!Array.isArray(evidence[field])||evidence[field].length>128)throw new Error('INVALID_EVIDENCE_COLLECTION');
  if(evidence.artifacts.length>MAX_ARTIFACTS)throw new Error('ARTIFACT_COUNT_LIMIT');
  const ids=new Set();
  for(const item of evidence.artifacts){
    requireShape(item,['id','path','sha256','kind','capturedAt']);
    if(!ALIAS.test(item.id||'')||ids.has(item.id)||!SHA.test(item.sha256||'')||!artifactKinds.includes(item.kind)||!stamp(item.capturedAt))throw new Error('INVALID_ARTIFACT_METADATA');
    ids.add(item.id);
    if(typeof item.path!=='string'||item.path.length>200||!/^artifacts\/[a-zA-Z0-9._/-]+\.json$/.test(item.path)||item.path.split('/').some(part=>!part||part==='.'||part==='..'))throw new Error('INVALID_ARTIFACT_PATH');
  }
  for(const item of evidence.devices){
    requireShape(item,['alias','hardwareAlias','kind','platformVersion','clientVersion','indexSHA256','nativeBuild']);
    if(!ALIAS.test(item.alias||'')||!deviceKinds.includes(item.kind)||!ALIAS.test(item.hardwareAlias||''))throw new Error('INVALID_DEVICE_METADATA');
    if(!SHA.test(item.indexSHA256||'')||(item.kind==='physical-iphone-native'?typeof item.nativeBuild!=='string'||!/^[A-Za-z0-9 ._()-]{1,64}$/.test(item.nativeBuild):item.nativeBuild!==null))throw new Error('INVALID_DEVICE_METADATA');
    for(const key of ['platformVersion','clientVersion'])if(typeof item[key]!=='string'||!/^[A-Za-z0-9 ._()-]{1,64}$/.test(item[key]))throw new Error('INVALID_DEVICE_VERSION');
  }
  for(const item of evidence.cases){
    requireShape(item,['id','status','devices','artifactIds','observedAt','unauthorizedAudienceCount','duplicateAuthoritativeRewardCount']);
    if(!MAFIA_ACCEPTANCE_CASES.includes(item.id)||!['pass','fail','not-run'].includes(item.status)||!Array.isArray(item.devices)||!Array.isArray(item.artifactIds))throw new Error('INVALID_DEVICE_CASE');
    if(item.devices.length>128||new Set(item.devices).size!==item.devices.length||item.devices.some(alias=>!ALIAS.test(alias)))throw new Error('INVALID_DEVICE_CASE');
  }
  for(const item of evidence.humanSamples){
    requireShape(item,['capacity','mode','rulesetVersion','participantKind','completed','groups','novices','returning','understandingParticipants','correctWinCondition','artifactIds','observedAt']);
    if(!count(item.capacity)||item.capacity<6||item.capacity>12||!['classic','shadow'].includes(item.mode)||![1,2].includes(item.rulesetVersion)||!['real-human','synthetic','mixed'].includes(item.participantKind)||!Array.isArray(item.artifactIds))throw new Error('INVALID_HUMAN_SAMPLE');
    if(item.mode!==(item.capacity<9?'classic':'shadow')||item.rulesetVersion===2&&item.capacity<8)throw new Error('INVALID_HUMAN_SAMPLE');
    for(const key of ['completed','groups','novices','returning','understandingParticipants','correctWinCondition'])if(!count(item[key]))throw new Error('INVALID_HUMAN_COUNTS');
    if(item.groups>item.completed||!Number.isSafeInteger(item.novices+item.returning)||item.understandingParticipants>item.novices+item.returning||item.correctWinCondition>item.understandingParticipants)throw new Error('INVALID_HUMAN_COUNTS');
  }
  if(evidence.automation!==null)requireShape(evidence.automation,['sourceCommit','passed','failed','skipped','scopes','artifactIds','completedAt']);
  if(evidence.balanceReview!==null)requireShape(evidence.balanceReview,['rolesCovered','sevenPlayerReviewed','blockingIssues','artifactIds','reviewedAt']);
  if(evidence.providerQuota!==null)requireShape(evidence.providerQuota,['provider','participantLimit','roomLimit','mafiaReservedParticipants','mafiaReservedRooms','socialReservedParticipants','socialReservedRooms','artifactIds','capturedAt']);
  if(evidence.performance!==null)requireShape(evidence.performance,['networkRttMs','actionAckP95Ms','audioTransitionMaxMs','actionSamples','audioSamples','queueWaitP90Ms','queueMatches','artifactIds','capturedAt']);
  if(evidence.ratingReview!==null)requireShape(evidence.ratingReview,['reportSHA256','policySHA256','decision','artifactIds','reviewedAt']);
}

// Pure evaluation of supplied claims and separately resolved local file hashes.
// Even a complete bundle remains unverified operator evidence, never ready:true.
export function evaluateMafiaAcceptance({candidate,manifest,evidence,artifactIntegrity={},artifactChecks={},calibration=null,calibrationSHA256=null,now=Date.now()}){
  validateEvidence(evidence);
  if(!object(candidate)||!COMMIT.test(candidate.sourceCommit||'')||!SHA.test(candidate.indexSHA256||'')||!SHA.test(candidate.workerSHA256||'')||!SHA.test(candidate.configSHA256||'')||!SHA.test(candidate.migrationSetSHA256||'')
    ||!WORKER_VERSION.test(candidate.activeVersion||'')||!object(candidate.rules)||Object.keys(candidate.rules).some(key=>!['rulesetVersion','protocol','supportedRulesetVersions'].includes(key))
    ||candidate.rules.rulesetVersion!==MAFIA_RULESET_VERSION||candidate.rules.protocol!==MAFIA_PROTOCOL||!same(candidate.rules.supportedRulesetVersions,MAFIA_SUPPORTED_RULESET_VERSIONS))throw new Error('INVALID_CANDIDATE_RECEIPT');
  const blockers=[],add=(section,code)=>blockers.push({section,code});
  if(!object(manifest)||manifest.kind!=='mafia-preview-manifest'||manifest.config?.sha256!==candidate.configSHA256||manifest.migrationSetSHA256!==candidate.migrationSetSHA256||!same(manifest.rules,candidate.rules))add('candidate','LOCAL_MANIFEST_MISMATCH');
  if(candidate.worker!=='maydan-mafia-preview'||candidate.url!=='https://maydan-mafia-preview.mf103871.workers.dev'||candidate.productionChanged!==false)add('candidate','ISOLATED_PREVIEW_RECEIPT_REQUIRED');
  if(candidate.sourceTreeClean!==true||candidate.verification?.workerBytesMatch!==true||candidate.verification?.indexBytesMatch!==true||candidate.pendingMigrations?.length!==0)add('candidate','FROZEN_DEPLOYMENT_CORRESPONDENCE_MISSING');
  const binding=evidence.candidate;
  if(binding.sourceCommit!==candidate.sourceCommit||binding.workerVersion!==candidate.activeVersion||binding.indexSHA256!==candidate.indexSHA256||binding.workerSHA256!==candidate.workerSHA256||binding.protocol!==candidate.rules?.protocol||!same(binding.rulesets,candidate.rules?.supportedRulesetVersions)||binding.ratingModel!=='preview-elo-1')add('candidate','EVIDENCE_CANDIDATE_MISMATCH');
  const byId=new Map(evidence.artifacts.map(row=>[row.id,row]));
  const checksFor=id=>Array.isArray(artifactChecks[id])?artifactChecks[id]:[];
  const fresh=(value,days)=>stamp(value)&&Date.parse(value)<=now+60000&&now-Date.parse(value)<=days*DAY;
  const refs=(ids,kind,days=30,check=null)=>Array.isArray(ids)&&ids.length>0&&ids.length<=16&&new Set(ids).size===ids.length&&ids.every(id=>{
    const row=byId.get(id);return row?.kind===kind&&artifactIntegrity[id]===true&&fresh(row.capturedAt,days)&&checksFor(id).some(row=>row?.status==='pass');
  })&&(!check||ids.some(id=>checksFor(id).some(row=>row?.check===check&&row.status==='pass')));
  for(const item of evidence.artifacts){
    if(artifactIntegrity[item.id]!==true)add('artifacts','ARTIFACT_MISSING_OR_HASH_MISMATCH');
    if(!checksFor(item.id).length)add('artifacts','ARTIFACT_OBSERVATIONS_REQUIRED');
    if(checksFor(item.id).some(row=>row?.status==='fail'))add('artifacts','RECORDED_FAILURE_REQUIRES_RESOLUTION');
  }
  const auto=evidence.automation;
  if(!auto||auto.sourceCommit!==candidate.sourceCommit||!count(auto.passed)||auto.passed===0||auto.failed!==0||auto.skipped!==0||!Array.isArray(auto.scopes)||!MAFIA_ACCEPTANCE_SCOPES.every(scope=>auto.scopes.includes(scope)&&refs(auto.artifactIds,'automated-run',7,scope))||!fresh(auto.completedAt,7))add('automation','CURRENT_CANDIDATE_INTEGRATED_TEST_EVIDENCE_REQUIRED');
  const devices=evidence.devices,aliases=new Set(devices.map(row=>row.alias));
  if(aliases.size!==devices.length)add('D2','DUPLICATE_DEVICE_ALIAS');
  if(new Set(devices.map(row=>JSON.stringify([row.hardwareAlias,row.kind]))).size!==devices.length)add('D2','DUPLICATE_HARDWARE_CLIENT');
  const physicalHardware=new Set(devices.filter(row=>row.kind!=='independent-browser').map(row=>row.hardwareAlias));
  if(devices.some(row=>row.kind==='independent-browser'&&physicalHardware.has(row.hardwareAlias)))add('D2','INDEPENDENT_BROWSER_HARDWARE_REQUIRED');
  // Native builds use their own explicitly selected API origin and therefore
  // need not have the same HTML bytes as the same-origin hosted web build.
  const matching=devices.filter(row=>row.kind==='physical-iphone-native'
    ?SHA.test(candidate.nativeIndexSHA256||'')&&row.indexSHA256===candidate.nativeIndexSHA256
    :row.indexSHA256===candidate.indexSHA256);
  const safari=matching.filter(row=>row.kind==='physical-iphone-safari'),native=matching.filter(row=>row.kind==='physical-iphone-native'),browsers=matching.filter(row=>row.kind==='independent-browser');
  if(new Set(safari.map(row=>row.hardwareAlias)).size<2||browsers.length<1)add('D2','TWO_PHYSICAL_IPHONES_AND_INDEPENDENT_BROWSER_REQUIRED');
  if(typeof candidate.nativeBuild!=='string'||!candidate.nativeBuild||!SHA.test(candidate.nativeIndexSHA256||'')||new Set(native.filter(row=>row.nativeBuild===candidate.nativeBuild).map(row=>row.hardwareAlias)).size<2)add('D2','MATCHED_UPDATED_NATIVE_BUILD_ON_TWO_PHONES_REQUIRED');
  const pairedHardware=new Set(safari.filter(row=>native.some(phone=>phone.hardwareAlias===row.hardwareAlias&&phone.nativeBuild===candidate.nativeBuild)).map(row=>row.hardwareAlias));
  if(pairedHardware.size<2)add('D2','SAFARI_NATIVE_ON_SAME_TWO_PHONES_REQUIRED');
  for(const id of MAFIA_ACCEPTANCE_CASES){
    const rows=evidence.cases.filter(row=>row.id===id),row=rows[0];
    const covered=matching.filter(device=>row?.devices.includes(device.alias));
    const physicalKinds=new Set(covered.map(device=>device.kind));
    const allPhysical=new Set(covered.filter(d=>d.kind==='physical-iphone-safari').map(d=>d.hardwareAlias)).size>=2
      &&new Set(covered.filter(d=>d.kind==='physical-iphone-safari'&&covered.some(phone=>phone.kind==='physical-iphone-native'&&phone.nativeBuild===candidate.nativeBuild&&phone.hardwareAlias===d.hardwareAlias)).map(d=>d.hardwareAlias)).size>=2;
    if(rows.length!==1||row.status!=='pass'||row.devices.some(alias=>!aliases.has(alias))||!fresh(row.observedAt,30)||row.unauthorizedAudienceCount!==0||row.duplicateAuthoritativeRewardCount!==0||!allPhysical||!physicalKinds.has('independent-browser')||!refs(row.artifactIds,'device-observation',30,id))add('D2',`CASE_${id.toUpperCase().replaceAll('-','_')}_REQUIRED`);
  }
  const bucket=row=>JSON.stringify([row.capacity,row.mode,row.rulesetVersion,[...row.artifactIds].sort()]);
  const sampleCounts=new Map();for(const row of evidence.humanSamples)sampleCounts.set(bucket(row),(sampleCounts.get(bucket(row))||0)+1);
  if([...sampleCounts.values()].some(value=>value>1))add('D3','DUPLICATE_HUMAN_SAMPLE_BUCKET');
  const uniqueSamples=evidence.humanSamples.filter(row=>sampleCounts.get(bucket(row))===1);
  for(let capacity=6;capacity<=12;capacity++){
    const samples=uniqueSamples.filter(row=>row.capacity===capacity&&row.rulesetVersion===1&&row.mode===(capacity<9?'classic':'shadow')&&row.participantKind==='real-human'&&fresh(row.observedAt,90)&&refs(row.artifactIds,'human-session',90));
    const completed=samples.reduce((n,row)=>n+row.completed,0),groups=samples.reduce((n,row)=>n+row.groups,0);
    if(completed<(capacity===7?10:3)||groups<(capacity===7?2:1))add('D3',`REAL_HUMAN_${capacity}_PLAYER_SAMPLES_REQUIRED`);
  }
  const understood=uniqueSamples.filter(row=>row.participantKind==='real-human'&&fresh(row.observedAt,90)&&refs(row.artifactIds,'human-session',90));
  const participants=understood.reduce((n,row)=>n+row.understandingParticipants,0),correct=understood.reduce((n,row)=>n+row.correctWinCondition,0);
  if(understood.some(row=>row.correctWinCondition>row.understandingParticipants)||participants<10||correct/participants<0.8)add('D3','RECORDED_NEW_PLAYER_COMPREHENSION_REQUIRED');
  const review=evidence.balanceReview;
  if(!review||!Array.isArray(review.rolesCovered)||!roles.every(role=>review.rolesCovered.includes(role))||review.sevenPlayerReviewed!==true||review.blockingIssues!==0||!fresh(review.reviewedAt,30)||!refs(review.artifactIds,'balance-review'))add('D3','FIXED_CANDIDATE_ROLE_AND_SEVEN_PLAYER_REVIEW_REQUIRED');
  if(!uniqueSamples.some(row=>row.rulesetVersion===2&&row.capacity>=8&&row.participantKind==='real-human'&&row.completed>=3&&fresh(row.observedAt,30)&&refs(row.artifactIds,'human-session')))add('G1','REAL_HUMAN_TRACKER_SAMPLE_REQUIRED');
  const quota=evidence.providerQuota,capacity=manifest?.capacity;
  if(!quota||quota.provider!=='livekit'||!['participantLimit','roomLimit','mafiaReservedParticipants','mafiaReservedRooms','socialReservedParticipants','socialReservedRooms'].every(key=>count(quota[key]))||quota.mafiaReservedParticipants<(capacity?.maxVoiceParticipants||80)||quota.mafiaReservedRooms<(capacity?.maxActiveRooms||1)||quota.socialReservedParticipants<12||quota.socialReservedRooms<1||quota.participantLimit<quota.mafiaReservedParticipants+quota.socialReservedParticipants||quota.roomLimit<quota.mafiaReservedRooms+quota.socialReservedRooms||!fresh(quota.capturedAt,7)||!refs(quota.artifactIds,'provider-quota',7))add('A5','CURRENT_PROVIDER_QUOTA_WITH_MAFIA_AND_SOCIAL_RESERVE_REQUIRED');
  const perf=evidence.performance;
  if(!perf||![perf.networkRttMs,perf.actionAckP95Ms,perf.audioTransitionMaxMs,perf.queueWaitP90Ms].every(v=>Number.isFinite(v)&&v>=0)||perf.networkRttMs>150||perf.actionAckP95Ms>300||perf.audioTransitionMaxMs>3000||!count(perf.actionSamples)||perf.actionSamples<100||!count(perf.audioSamples)||perf.audioSamples<20||!count(perf.queueMatches)||perf.queueMatches<10||perf.queueWaitP90Ms>=90000||!fresh(perf.capturedAt,14)||!refs(perf.artifactIds,'performance',14))add('performance','CONTROLLED_NETWORK_AUDIO_ACTION_AND_POPULATED_QUEUE_MEASUREMENTS_REQUIRED');
  const rating=evidence.ratingReview;
  if(!calibration||calibration.kind!=='mafia-rating-calibration-report'||calibration.schemaVersion!==1||calibration.evidenceKind!=='real-human'||calibration.status!=='candidate-needs-review'||calibration.rulesetVersion!==1||calibration.template!=='classic8-6town-2mafia'||calibration.baselineModel!=='preview-elo-1'||calibration.provenance?.sourceCommit!==candidate.sourceCommit||!Array.isArray(calibration.blockerCodes)||calibration.blockerCodes.length||!SHA.test(calibration.policySHA256||'')||!rating||rating.reportSHA256!==calibrationSHA256||rating.policySHA256!==calibration.policySHA256||rating.decision!=='accepted-for-next-preview-season'||!fresh(rating.reviewedAt,30)||!refs(rating.artifactIds,'rating-review'))add('E2','REAL_HUMAN_CALIBRATION_AND_SEPARATE_REVIEW_REQUIRED');
  const unique=[...new Map(blockers.map(item=>[`${item.section}:${item.code}`,item])).values()];
  return {schemaVersion:1,kind:'mafia-acceptance-report',sourceCommit:candidate.sourceCommit,indexSHA256:candidate.indexSHA256,workerVersion:candidate.activeVersion,
    evaluatedAt:new Date(now).toISOString(),status:unique.length?'incomplete':'supplied-evidence-complete-unverified',suppliedEvidenceComplete:unique.length===0,
    ready:false,liveVerified:false,physicalHumanClaimsAuthenticated:false,testsRunByThisTool:false,
    evidenceCounts:{artifacts:evidence.artifacts.length,devices:devices.length,deviceCases:evidence.cases.length,humanSampleGroups:evidence.humanSamples.length},blockers:unique,
    limitations:['Only local supplied files and claim consistency are evaluated.','File hashes do not authenticate a device, human participant, provider quota, or operator decision.','No test execution, live account/provider access, deployment, release approval, or automatic calibration occurs.']};
}

export async function runMafiaAcceptanceReport(argv=process.argv.slice(2)){
  const flags={};
  for(let i=0;i<argv.length;i+=2){const flag=argv[i],value=argv[i+1];if(!['--candidate','--manifest','--evidence','--calibration'].includes(flag)||flags[flag]||!value||value.startsWith('--'))throw new Error('USAGE_CANDIDATE_MANIFEST_EVIDENCE_CALIBRATION');flags[flag]=value;}
  if(!flags['--candidate']||!flags['--manifest']||!flags['--evidence'])throw new Error('USAGE_CANDIDATE_MANIFEST_EVIDENCE_CALIBRATION');
  const [candidate,manifest,evidence]=await Promise.all([readJSON(flags['--candidate']),readJSON(flags['--manifest']),readJSON(flags['--evidence'])]);
  validateEvidence(evidence);const root=await realpath(path.dirname(path.resolve(flags['--evidence']))),integrity={},checks={};let total=0;
  for(const artifact of evidence.artifacts){
    const file=path.resolve(root,...artifact.path.split('/')),relative=path.relative(root,file);
    if(relative.startsWith('..')||path.isAbsolute(relative))throw new Error('ARTIFACT_OUTSIDE_EVIDENCE_DIRECTORY');
    try{
      const resolved=await realpath(file),info=await stat(file);
      if(resolved!==file||!info.isFile()||info.size===0||info.size>MAX_JSON||total+info.size>MAX_ARTIFACT_BYTES)throw new Error('ARTIFACT_FILE_LIMIT');
      const bytes=await readBoundedBytes(file,'ARTIFACT_FILE_LIMIT');total+=bytes.length;
      if(!bytes.length||total>MAX_ARTIFACT_BYTES)throw new Error('ARTIFACT_FILE_LIMIT');
      const receipt=boundedJSON(bytes);
      requireShape(receipt,['schemaVersion','kind','type','candidate','capturedAt','observations']);
      requireShape(receipt.candidate,['sourceCommit','indexSHA256','workerVersion']);
      if(receipt.schemaVersion!==1||receipt.kind!=='mafia-acceptance-artifact'||receipt.type!==artifact.kind||receipt.capturedAt!==artifact.capturedAt||!Array.isArray(receipt.observations)||!receipt.observations.length||receipt.observations.length>200)throw new Error('INVALID_ARTIFACT_RECEIPT');
      for(const row of receipt.observations){
        requireShape(row,['check','status','triggerCode','outcomeCode','counts','measurements']);
        if(!ALIAS.test(row.check||'')||!['pass','fail','not-run'].includes(row.status)||!ALIAS.test(row.triggerCode||'')||!ALIAS.test(row.outcomeCode||''))throw new Error('INVALID_ARTIFACT_OBSERVATION');
        for(const key of ['counts','measurements']){
          if(!object(row[key])||Object.keys(row[key]).length>16)throw new Error('INVALID_ARTIFACT_OBSERVATION');
          for(const [name,value]of Object.entries(row[key]))if(!ALIAS.test(name)||!Number.isFinite(value)||value<0||key==='counts'&&!count(value))throw new Error('INVALID_ARTIFACT_OBSERVATION');
        }
      }
      integrity[artifact.id]=hash(bytes)===artifact.sha256&&receipt.candidate.sourceCommit===candidate.sourceCommit&&receipt.candidate.indexSHA256===candidate.indexSHA256&&receipt.candidate.workerVersion===candidate.activeVersion;
      checks[artifact.id]=receipt.observations.map(({check,status})=>({check,status}));
    }catch(error){if(error.code==='ENOENT'){integrity[artifact.id]=false;continue;}throw error;}
  }
  let calibration=null,calibrationSHA256=null;
  if(flags['--calibration']){const bytes=await readJSONBytes(flags['--calibration']);calibration=boundedJSON(bytes);calibrationSHA256=hash(bytes);}
  return evaluateMafiaAcceptance({candidate,manifest,evidence,artifactIntegrity:integrity,artifactChecks:checks,calibration,calibrationSHA256});
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{const result=await runMafiaAcceptanceReport();process.stdout.write(JSON.stringify(result,null,2)+'\n');if(!result.suppliedEvidenceComplete)process.exitCode=2;}
  catch(error){process.stderr.write(JSON.stringify({error:['INVALID_EVIDENCE_SCHEMA','INVALID_EVIDENCE_KIND','INVALID_EVIDENCE_COLLECTION','ARTIFACT_COUNT_LIMIT','INVALID_ARTIFACT_METADATA','INVALID_ARTIFACT_PATH','INVALID_ARTIFACT_RECEIPT','INVALID_ARTIFACT_OBSERVATION','INVALID_DEVICE_METADATA','INVALID_DEVICE_VERSION','INVALID_DEVICE_CASE','INVALID_HUMAN_SAMPLE','INVALID_HUMAN_COUNTS','INVALID_CANDIDATE_RECEIPT','JSON_SIZE_LIMIT','INVALID_JSON','JSON_COMPLEXITY_LIMIT','JSON_STRING_LIMIT','INVALID_JSON_KEY','JSON_FILE_LIMIT','ARTIFACT_FILE_LIMIT','ARTIFACT_OUTSIDE_EVIDENCE_DIRECTORY','USAGE_CANDIDATE_MANIFEST_EVIDENCE_CALIBRATION'].includes(error.message)?error.message:'EVIDENCE_FILE_UNAVAILABLE'})+'\n');process.exitCode=1;}
}

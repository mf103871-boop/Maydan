import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalD1, migrationStatements } from '../server/local-d1.mjs';
import { issueSession } from '../server/accounts/session.mjs';
import { routeRewarded } from '../server/rewarded/router.mjs';
import { issueRewardedAttempt, verifyRewardedAttempt, cancelRewardedAttempt, rewardedEntryStatus, LOCAL_REWARDED_UNIT, REWARDED_ITEM } from '../server/rewarded/attempts.mjs';
import { startRewardedLocalMatch, reserveRewardedMatch, commitRewardedMatch, rewardedAccess } from '../server/rewarded/ledger.mjs';
import { gameplayAccessDescriptor } from '../server/rewarded/settings.mjs';
import { GAMEPLAY_ENTRY_OFFERS, ENTRY_TICKET_POLICY, TICKET_POLICY, gameplayEntryOffer, gameplayOffer,
  resolveGameplayPolicy, badeehaFreeSelection } from '../src/shared/account/gameplay-policy.mjs';

const ORIGIN='http://localhost:3000';
function setup(t, extra={}){
  const DB=new LocalD1();t.after(()=>DB.close());for(const sql of migrationStatements())DB.database.exec(sql);
  return{DB,APP_ORIGIN:ORIGIN,PADDLE_ENV:'sandbox',AUTH_DEV_FAKE:'1',REWARDED_ENV:'local',
    REWARDED_PREVIEW_ENABLED:'1',REWARDED_ADS_ENABLED:'1',GAMEPLAY_ACCESS_POLICY:ENTRY_TICKET_POLICY,...extra};
}
async function account(env){const userId=crypto.randomUUID(),now=Date.now();
  await env.DB.prepare('INSERT INTO users(id,name,created_at,updated_at) VALUES(?,?,?,?)').bind(userId,'Fixture',now,now).run();
  return{userId,token:(await issueSession(env,userId)).token};}
async function api(env,user,path,{method='GET',body,capability='2'}={}){
  const response=await routeRewarded(new Request(ORIGIN+'/api/rewarded/'+path,{method,headers:{origin:ORIGIN,
    authorization:'Bearer '+user.token,...(capability?{'x-maydan-gameplay-capability':capability}:{}),...(body?{'content-type':'application/json'}:{})},
    ...(body?{body:JSON.stringify(body)}:{})}),env);
  return{status:response.status,body:await response.json()};
}
const claim=(userId,offer)=>({userId,offer,matchId:crypto.randomUUID()});
async function first(env,user,game){const entry=gameplayEntryOffer(game),mode=entry.modes[0],c=claim(user.userId,gameplayOffer(game,mode).id);
  if(mode==='local')return startRewardedLocalMatch(env,c);await reserveRewardedMatch(env,c);return commitRewardedMatch(env,c);}
async function award(env,user,offer,now=Date.now()){
  const attempt=await issueRewardedAttempt(env,user.userId,offer,'web',now);
  await verifyRewardedAttempt(env,{environment:'local',attemptId:attempt.attemptId,userId:user.userId,adUnit:LOCAL_REWARDED_UNIT,
    rewardItem:REWARDED_ITEM,timestamp:now,transactionId:crypto.randomUUID()},now);
  return attempt;
}
const throwsCode=code=>error=>error.code===code;

test('v2 descriptor protects all eight games before mode selection while preserving v1 and explicit free behavior',()=>{
  assert.equal(GAMEPLAY_ENTRY_OFFERS.length,8);
  const v2=gameplayAccessDescriptor({GAMEPLAY_ACCESS_POLICY:ENTRY_TICKET_POLICY});
  assert.deepEqual(v2,{access:'trial-ticket',policy:ENTRY_TICKET_POLICY,allPacks:true,hosting:'trial-ticket',freePacks:[],
    entryGate:'before-mode',ticketScope:'game',gameplayCapability:2});
  assert.equal(gameplayAccessDescriptor({GAMEPLAY_ACCESS_POLICY:TICKET_POLICY}).freePacks.length,10);
  assert.equal(gameplayAccessDescriptor({}).access,'free');
  assert.equal(badeehaFreeSelection(['general'],ENTRY_TICKET_POLICY),false);assert.equal(badeehaFreeSelection(['general'],TICKET_POLICY),true);
  assert.equal(resolveGameplayPolicy({billing:{gameplay:{policy:ENTRY_TICKET_POLICY}},build:TICKET_POLICY}),ENTRY_TICKET_POLICY);
  assert.equal(resolveGameplayPolicy({billing:{gameplay:{policy:TICKET_POLICY}},build:ENTRY_TICKET_POLICY}),TICKET_POLICY);
  assert.equal(resolveGameplayPolicy({billing:{gameplay:{access:'free'}},build:ENTRY_TICKET_POLICY}),null);
});

test('entry status is read-only for all eight cards, shares one trial across modes, and requires capability2',async t=>{
  const env=setup(t),user=await account(env);
  for(const offer of GAMEPLAY_ENTRY_OFFERS){for(let n=0;n<3;n++){
    const r=await api(env,user,'entry-status?game='+offer.game);assert.equal(r.status,200);assert.equal(r.body.access,'trial');
    assert.equal(r.body.offer,offer.id);assert.deepEqual(Object.keys(r.body.modeAccess).sort(),[...offer.modes].sort());
  }}
  for(const table of ['rewarded_match_claims','rewarded_attempts','trials'])assert.equal((await env.DB.prepare(`SELECT count(*) AS n FROM ${table}`).first()).n,0);
  await assert.rejects(api(env,user,'entry-status?game=mafia',{capability:null}),throwsCode('UPDATE_REQUIRED'));
  await first(env,user,'fabraka');const r=await api(env,user,'entry-status?game=fabraka');
  assert.equal(r.body.access,'required');assert.deepEqual(r.body.modeAccess,{local:'required',online:'required'});
  assert.equal((await env.DB.prepare("SELECT count(*) AS n FROM rewarded_match_claims WHERE source='trial'").first()).n,1);
  await assert.rejects(api(env,user,'local-start',{method:'POST',capability:null,body:{offer:'beep-local',matchId:crypto.randomUUID()}}),throwsCode('UPDATE_REQUIRED'));
});

test('a new game entry ticket can fund either concrete mode once, and cannot fund another game or be claimed as entry',async t=>{
  const env=setup(t),user=await account(env);await first(env,user,'fabraka');await first(env,user,'beep');
  await award(env,user,'fabraka-entry-v2');
  let status=await rewardedEntryStatus(env,user.userId,'fabraka','web');assert.equal(status.access,'ticket');
  assert.deepEqual(status.modeAccess,{local:'ticket',online:'ticket'});
  const c=claim(user.userId,'fabraka-online');assert.equal((await reserveRewardedMatch(env,c)).source,'ticket');await commitRewardedMatch(env,c);
  status=await rewardedEntryStatus(env,user.userId,'fabraka','web');assert.equal(status.access,'required');
  await assert.rejects(startRewardedLocalMatch(env,claim(user.userId,'fabraka-local')),throwsCode('REWARDED_REQUIRED'));
  await assert.rejects(startRewardedLocalMatch(env,claim(user.userId,'beep-local')),throwsCode('REWARDED_REQUIRED'));
  for(const game of ['mafia','ersomha','beep'])await assert.rejects(startRewardedLocalMatch(env,claim(user.userId,game+'-entry-v2')),throwsCode('REWARDED_UNAVAILABLE'));
});

test('legacy mode tickets keep their scope, entry status exposes that mode, and a new entry reward remains optional',async t=>{
  const env=setup(t,{GAMEPLAY_ACCESS_POLICY:TICKET_POLICY}),user=await account(env);await first(env,user,'fabraka');
  const legacyAt=Date.now()-16*60_000,legacy=await issueRewardedAttempt(env,user.userId,'fabraka-local','web',legacyAt);
  env.GAMEPLAY_ACCESS_POLICY=ENTRY_TICKET_POLICY;
  const broad=await award(env,user,'fabraka-entry-v2',Date.now());
  await verifyRewardedAttempt(env,{environment:'local',attemptId:legacy.attemptId,userId:user.userId,adUnit:LOCAL_REWARDED_UNIT,
    rewardItem:REWARDED_ITEM,timestamp:legacyAt,transactionId:crypto.randomUUID()},Date.now()+1);
  // Prefer the narrower older contract even if a broad ticket was earned first.
  const local=await startRewardedLocalMatch(env,claim(user.userId,'fabraka-local'));assert.equal(local.source,'ticket');
  const row=await env.DB.prepare('SELECT offer FROM rewarded_attempts WHERE id=(SELECT ticket_id FROM rewarded_match_claims WHERE match_id=?)').bind(local.matchId).first();
  assert.equal(row.offer,'fabraka-local');
  const online=claim(user.userId,'fabraka-online');await reserveRewardedMatch(env,online);await commitRewardedMatch(env,online);
  assert.equal((await env.DB.prepare('SELECT ticket_id FROM rewarded_match_claims WHERE match_id=?').bind(online.matchId).first()).ticket_id,broad.attemptId);
  await award(env,user,'fabraka-local');
  const status=await rewardedEntryStatus(env,user.userId,'fabraka','web');
  assert.equal(status.access,'ticket');assert.equal(status.entryAccess,'required');assert.deepEqual(status.modeAccess,{local:'ticket',online:'required'});
  const additional=await issueRewardedAttempt(env,user.userId,'fabraka-entry-v2','web');assert.ok(additional.attemptId);
  assert.equal(await rewardedAccess(env,user.userId,'fabraka-online'),'required','SDK callback alone is not a server ticket');
  await cancelRewardedAttempt(env,'local',user.userId,additional.attemptId);
  assert.equal(await rewardedAccess(env,user.userId,'fabraka-local'),'ticket','unwatched new offer never consumes the legacy ticket');
});

test('v1 spent trials and committed local recovery survive v2 without renewing a first trial',async t=>{
  const env=setup(t,{GAMEPLAY_ACCESS_POLICY:TICKET_POLICY}),user=await account(env);
  const c=claim(user.userId,'beep-local'),before=await startRewardedLocalMatch(env,c);env.GAMEPLAY_ACCESS_POLICY=ENTRY_TICKET_POLICY;
  assert.equal((await rewardedEntryStatus(env,user.userId,'beep','web')).access,'required');
  const recovered=await api(env,user,'local-start',{method:'POST',body:{offer:c.offer,matchId:c.matchId}});
  assert.deepEqual(recovered.body,before);assert.equal((await env.DB.prepare('SELECT count(*) AS n FROM rewarded_match_claims').first()).n,1);
});

test('concurrent local/online starts cannot duplicate an entry ticket and ad outages never fail open',async t=>{
  const env=setup(t),user=await account(env);await first(env,user,'fabraka');await award(env,user,'fabraka-entry-v2');
  env.REWARDED_ADS_ENABLED='0';env.REWARDED_PREVIEW_ENABLED='0';
  const starts=await Promise.allSettled([startRewardedLocalMatch(env,claim(user.userId,'fabraka-local')),reserveRewardedMatch(env,claim(user.userId,'fabraka-online'))]);
  assert.equal(starts.filter(r=>r.status==='fulfilled').length,1);
  assert.equal((await env.DB.prepare("SELECT count(*) AS n FROM rewarded_match_claims WHERE source='ticket' AND state IN ('reserved','committed')").first()).n,1);
  assert.equal(gameplayAccessDescriptor(env).policy,ENTRY_TICKET_POLICY);
  const status=await rewardedEntryStatus(env,user.userId,'fabraka','web');assert.ok(['required','busy'].includes(status.access));assert.equal(status.adsAvailable,false);
});

test('v1 issued SSV attempts still verify with v2 and only grant their original mode ticket',async t=>{
  const env=setup(t,{GAMEPLAY_ACCESS_POLICY:TICKET_POLICY}),user=await account(env);await first(env,user,'fabraka');
  const now=Date.now(),attempt=await issueRewardedAttempt(env,user.userId,'fabraka-online','web',now);env.GAMEPLAY_ACCESS_POLICY=ENTRY_TICKET_POLICY;
  await verifyRewardedAttempt(env,{environment:'local',attemptId:attempt.attemptId,userId:user.userId,adUnit:LOCAL_REWARDED_UNIT,
    rewardItem:REWARDED_ITEM,timestamp:now,transactionId:crypto.randomUUID()},now);
  const status=await rewardedEntryStatus(env,user.userId,'fabraka','web');assert.equal(status.access,'ticket');
  assert.deepEqual(status.modeAccess,{local:'required',online:'ticket'});
});

test('v1 and disabled policies do not expose the new entry offers or renew access',async t=>{
  const env=setup(t,{GAMEPLAY_ACCESS_POLICY:TICKET_POLICY}),user=await account(env);
  const config=await api(env,user,'config');assert.ok(config.body.offers.every(o=>o.mode!=='entry'));
  assert.equal((await api(env,user,'entry-status?game=beep')).status,404);
  await assert.rejects(issueRewardedAttempt(env,user.userId,'beep-entry-v2','web'),throwsCode('REWARDED_UNAVAILABLE'));
  env.GAMEPLAY_ACCESS_POLICY=undefined;assert.equal(gameplayAccessDescriptor(env).access,'free');
});

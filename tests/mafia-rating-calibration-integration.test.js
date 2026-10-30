import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,readFile,rm,writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { rankedMatchDeltas } from '../server/mafia-ranked-rating.mjs';
import { MAFIA_BASE_RATING_POLICY,makeMafiaRatingPolicy,expectedMafiaTownScore,ratingDeltasForPolicy,canonicalMafiaRatingValue } from '../server/mafia-rating-policy.mjs';
import { calibrateMafiaRating,mafiaRatingSHA256,normalizeMafiaRatingDataset,MAFIA_RATING_EXPORT_SQL } from '../server/mafia-rating-calibration.mjs';
import { publishMafiaRatingPolicy,bindMafiaSeasonRatingPolicy,resolveMafiaSeasonRatingPolicy } from '../server/mafia-rating-policy-store.mjs';
import { deleteUser } from '../server/accounts/db.mjs';
import { runMafiaRatingCalibration } from '../scripts/mafia-rating-calibrate.mjs';
import { fixture,peopleFor,rankedEvent,query,rows,interposeBatch } from './mafia-matchmaking-integration-fixture.mjs';

// Every row below is manufactured test data, including the deliberately
// attested-looking variants used to test the publication boundary. None is
// evidence that a human session, voice test or balance trial occurred.
async function syntheticDataset({count=100,evidenceKind='synthetic',allHuman=false}={}) {
  return {schemaVersion:1,kind:'mafia-rating-dataset',evidenceKind,
    provenance:{sourceCommit:'a'.repeat(40),workerVersion:'11111111-2222-3333-4444-555555555555',migrationSetSHA256:'b'.repeat(64),querySHA256:await mafiaRatingSHA256(MAFIA_RATING_EXPORT_SQL),exportedAt:new Date().toISOString()},
    matches:Array.from({length:count},(_,index)=>({sampleRef:(index+1).toString(16).padStart(64,'0'),at:Date.now()-10_000_000+index*1000,outcome:index%2?'mafia':'town',townMeanBefore:1000,mafiaMeanBefore:1000,forfeits:0,netRatingDelta:0,seats:8,allHuman}))};
}
async function policyFixture(t) {
  const h=await fixture(t,{qualify:false}),[moderator]=await peopleFor(h.env,1);h.env.MODERATOR_USER_IDS=moderator.accountId;
  const dataset=await syntheticDataset({evidenceKind:'real-human',allHuman:true});
  const statements=[];
  for(const [index,sample]of dataset.matches.entries()) {
    const key=`synthetic-calibration-${index}`;
    statements.push(query(h.env,"INSERT INTO mafia_ranked_matches(match_key,season_id,room_code,created_at,status,settled_at,event_digest) VALUES(?,?,?,?,'completed',?,?)",key,h.season,'654321',sample.at,sample.at+120_000,sample.sampleRef));
    for(const [seat,person]of h.people.entries()) {
      const faction=seat<6?'town':'mafia';
      statements.push(query(h.env,'INSERT INTO mafia_ranked_receipts VALUES(?,?,?,1000,0,1000,?, ?,0,?)',person.accountId,key,h.season,faction,sample.outcome===faction?1:0,sample.at+120_000));
    }
  }
  await h.env.DB.batch(statements);
  return {...h,moderator,dataset,body:{dataset,reviewAcknowledged:true}};
}
async function futureSeason(env,id='future-synthetic',delay=60_000) {
  await query(env,"INSERT INTO mafia_ranked_seasons(id,starts_at,ends_at,ruleset_version,rating_model,reward_policy,status) VALUES(?,?,?,1,'preview-elo-1',1,'open')",id,Date.now()+delay,Date.now()+3_600_000).run();
  return id;
}
const hasPublication=statements=>statements.some(statement=>statement.sql.startsWith('INSERT OR IGNORE INTO mafia_rating_policies'));
const hasBinding=statements=>statements.some(statement=>statement.sql.startsWith('INSERT OR IGNORE INTO mafia_ranked_season_policy'));
const policyCount=async env=>(await query(env,'SELECT COUNT(*) AS n FROM mafia_rating_policies').first()).n;

test('existing v1 seasons dispatch the exact previous integer algorithm across1000 synthetic matches',()=>{
  let seed=0x97142;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  for(let match=0;match<1000;match++) {
    const draw=match%7===0,townWins=match%2===0;
    const results=Array.from({length:8},(_,index)=>({userId:`u-${index}`,playerId:`seat-${index}`,faction:index<6?'town':'mafia',won:!draw&&(index<6)===townWins,forfeited:false}));
    if(match%11===0){results[0].forfeited=true;results[0].won=false;}
    const ratings=new Map(results.map(result=>[result.userId,{rating:Math.floor(random()*3001),games:Math.floor(random()*40)}]));
    assert.deepEqual(ratingDeltasForPolicy(results,ratings,MAFIA_BASE_RATING_POLICY,{draw}),rankedMatchDeltas(results,ratings));
  }
});

test('learned faction model keeps zero-sum integer budgets, deterministic remainders, bounds and natural-elimination results',()=>{
  const results=Array.from({length:8},(_,index)=>({userId:`u-${index}`,playerId:`seat-${index}`,faction:index<6?'town':'mafia',won:index<6,forfeited:false,eliminatedAt:index===0?123:null}));
  const ratings=new Map(results.map(result=>[result.userId,{rating:1000,games:20}]));
  for(const prior of [0.2,0.35,0.5,0.65,0.8]) {
    const policy=makeMafiaRatingPolicy(prior,'c'.repeat(64)),deltas=ratingDeltasForPolicy(results,ratings,policy);
    assert.equal([...deltas.values()].reduce((sum,delta)=>sum+delta,0),0);
    assert.deepEqual(new Map([...ratingDeltasForPolicy(results.toReversed(),ratings,policy)].sort()),new Map([...deltas].sort()));
    assert.ok(deltas.get('u-0')>=0);assert.equal(expectedMafiaTownScore(1000,1000,policy),prior);
    assert.ok([...ratingDeltasForPolicy(results,ratings,policy,{technicalAbort:true}).values()].every(delta=>delta===0));
  }
  const policy=makeMafiaRatingPolicy(0.5,'c'.repeat(64));
  const forfeit=structuredClone(results);forfeit[0].forfeited=true;forfeit[0].won=false;
  assert.ok(ratingDeltasForPolicy(forfeit,ratings,policy).get('u-0')<=-16);
  const bounded=new Map(results.map(result=>[result.userId,{rating:result.faction==='town'?3000:0,games:20}]));
  for(const [id,delta]of ratingDeltasForPolicy(results,bounded,policy))assert.ok(bounded.get(id).rating+delta>=0&&bounded.get(id).rating+delta<=3000);
  const duplicated=structuredClone(results);duplicated[1].userId=duplicated[0].userId;
  assert.throws(()=>ratingDeltasForPolicy(duplicated,ratings,policy),/MAFIA_RATING_POLICY_INVALID/);
  assert.throws(()=>ratingDeltasForPolicy(results,ratings,{...policy,scale:200}),/MAFIA_RATING_POLICY_INVALID/);
});

test('calibration cannot promote synthetic/unknown samples or invent human observations',async()=>{
  for(const evidenceKind of ['synthetic','unknown']) {
    const fitted=await calibrateMafiaRating(await syntheticDataset({evidenceKind,allHuman:true}));
    assert.equal(fitted.policy,null);assert.ok(fitted.report.blockerCodes.includes('HUMAN_EVIDENCE_NOT_ATTESTED'));
    assert.equal(fitted.report.evidenceAuthentication,'operator-supplied-unverified');
    assert.equal(fitted.report.calibrated,false);assert.equal(fitted.report.ready,false);assert.equal(fitted.report.liveVerified,false);
  }
  const unlabelled=await calibrateMafiaRating(await syntheticDataset({evidenceKind:'real-human',allHuman:false}));
  assert.equal(unlabelled.report.samples.eligible,0);assert.equal(unlabelled.policy,null);
});

test('canonical hashes are input-order independent; training never consumes the chronological holdout',async()=>{
  const dataset=await syntheticDataset({evidenceKind:'real-human',allHuman:true});
  const first=await calibrateMafiaRating(dataset),reordered=await calibrateMafiaRating({...dataset,matches:dataset.matches.toReversed()});
  assert.equal(first.report.provenance.inputSHA256,reordered.report.provenance.inputSHA256);assert.deepEqual(first.policy,reordered.policy);
  const changed=structuredClone(dataset);changed.matches.slice(80).forEach(row=>{row.outcome='town';});
  const heldout=await calibrateMafiaRating(changed);
  assert.equal(first.report.faction.fittedTownPrior,heldout.report.faction.fittedTownPrior);
  assert.notEqual(first.report.holdout.observedTownScore,heldout.report.holdout.observedTownScore);
  assert.notEqual(first.report.provenance.inputSHA256,heldout.report.provenance.inputSHA256);
  assert.equal(first.report.samples.training,80);assert.equal(first.report.samples.holdout,20);
  const json=JSON.stringify(first.report);assert.equal(json.includes(dataset.matches[0].sampleRef),false);assert.equal(json.includes('matches"'),false);
});

test('strict dataset rejects extra identities, duplicate references and malformed provenance; incomplete samples stay excluded',async()=>{
  const dataset=await syntheticDataset();
  for(const change of [value=>{value.matches[0].userId='private-account';},value=>{value.matches[1].sampleRef=value.matches[0].sampleRef;},value=>{value.provenance.sourceCommit='not-a-commit';},value=>{value.matches[0].allHuman='true';},value=>{value.matches[0].townMeanBefore=Infinity;}]) {
    const invalid=structuredClone(dataset);change(invalid);assert.throws(()=>normalizeMafiaRatingDataset(invalid),/MAFIA_CALIBRATION_INVALID/);
  }
  const mixed=await syntheticDataset({evidenceKind:'real-human',allHuman:true});
  mixed.matches[0].forfeits=1;mixed.matches[1].seats=7;mixed.matches[2].outcome='technical_abort';
  const outcome=await calibrateMafiaRating(mixed);assert.equal(outcome.report.samples.eligible,97);assert.equal(outcome.policy,null);
  assert.ok(outcome.report.blockerCodes.includes('HUMAN_MATCH_SAMPLE_BELOW_100'));
  mixed.provenance.querySHA256='0'.repeat(64);assert.ok((await calibrateMafiaRating(mixed)).report.blockerCodes.includes('EXPORT_QUERY_MISMATCH'));
});

test('offline exporter wraps actual rows with human labelsunset and refuses artifact overwrites',async t=>{
  const temporary=await mkdtemp(path.join(os.tmpdir(),'maydan-calibration-integration-'));
  t.after(async()=>{const relative=path.relative(os.tmpdir(),temporary);assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));await rm(temporary,{recursive:true,force:true});});
  const dataset=await syntheticDataset({evidenceKind:'real-human',allHuman:true}),input=path.join(temporary,'synthetic-ledger.json'),provenance=path.join(temporary,'provenance.json'),output=path.join(temporary,'wrapped.json');
  await writeFile(input,JSON.stringify(dataset.matches));await writeFile(provenance,JSON.stringify(dataset.provenance));
  await runMafiaRatingCalibration(['--wrap-export',input,'--provenance',provenance,'--output',output]);
  const wrapped=JSON.parse(await readFile(output,'utf8'));assert.equal(wrapped.evidenceKind,'unknown');assert.ok(wrapped.matches.every(row=>row.allHuman===false));
  await assert.rejects(runMafiaRatingCalibration(['--wrap-export',input,'--provenance',provenance,'--output',output]),{code:'EEXIST'});
  const plan=path.join(temporary,'plan.json');await runMafiaRatingCalibration(['--export-plan',plan]);
  const projected=JSON.parse(await readFile(plan,'utf8'));assert.equal(projected.readOnly,true);assert.equal(projected.executed,false);assert.equal(projected.sql,MAFIA_RATING_EXPORT_SQL);
});

test('publication recomputes source-bound policy, is immutable/idempotent, and does not change an existing season',async t=>{
  const h=await policyFixture(t),published=await publishMafiaRatingPolicy(h.env,h.moderator.actor,h.body);
  assert.equal(published.active,false);assert.equal(published.productionReady,false);assert.equal(published.humanLabels,'moderator-attested-not-independently-verified');
  assert.deepEqual(await publishMafiaRatingPolicy(h.env,h.moderator.actor,h.body),published);assert.equal(await policyCount(h.env),1);
  assert.deepEqual(await resolveMafiaSeasonRatingPolicy(h.env,await query(h.env,'SELECT * FROM mafia_ranked_seasons WHERE id=?',h.season).first()),MAFIA_BASE_RATING_POLICY);
  await assert.rejects(bindMafiaSeasonRatingPolicy(h.env,h.moderator.actor,{seasonId:h.season,policyId:published.id}),{code:'MAFIA_RATING_SEASON_FIXED'});
  const stored=await query(h.env,'SELECT * FROM mafia_rating_policies').first();
  assert.equal(await mafiaRatingSHA256(JSON.parse(stored.policy_json)),stored.id);assert.equal(await mafiaRatingSHA256(JSON.parse(stored.report_json)),stored.report_sha256);
  assert.equal(stored.dataset_sha256,published.datasetSHA256);assert.equal(JSON.stringify(stored).includes(h.dataset.matches[0].sampleRef),false);
});

for(const race of ['receipt-deleted','ledger-changed','session-revoked','reviewer-deletion'])test(`publication rechecks ${race} inside the immutable insert`,async t=>{
  const h=await policyFixture(t);
  const restore=interposeBatch(h.env,hasPublication,async db=>{
    if(race==='receipt-deleted')await db.prepare('DELETE FROM mafia_ranked_receipts WHERE user_id=? AND match_key=?').bind(h.people[0].accountId,'synthetic-calibration-0').run();
    if(race==='ledger-changed')await db.prepare('UPDATE mafia_ranked_receipts SET before_rating=1200 WHERE user_id=? AND match_key=?').bind(h.people[0].accountId,'synthetic-calibration-0').run();
    if(race==='session-revoked')await db.prepare('UPDATE sessions SET revoked_at=0 WHERE id=?').bind(h.moderator.sessionId).run();
    if(race==='reviewer-deletion')await db.prepare('INSERT INTO account_deletions VALUES(?,?,?)').bind(h.moderator.accountId,'synthetic-delete',Date.now()).run();
  });
  await assert.rejects(publishMafiaRatingPolicy(h.env,h.moderator.actor,h.body));assert.equal(restore(),true);assert.equal(await policyCount(h.env),0);
});

test('publication rejects a changed/deleted source, arbitrary client policy and production origin',async t=>{
  const h=await policyFixture(t);
  await assert.rejects(publishMafiaRatingPolicy(h.env,h.people[0].actor,h.body),{code:'NOT_FOUND'});
  await assert.rejects(publishMafiaRatingPolicy({...h.env,APP_ORIGIN:'https://maydan-game.mf103871.workers.dev'},h.moderator.actor,h.body),{code:'NOT_FOUND'});
  await assert.rejects(publishMafiaRatingPolicy(h.env,h.moderator.actor,{...h.body,policy:{townWinPrior:0.9}}),{code:'INVALID'});
  await deleteUser(h.env,h.people[0].accountId);
  await assert.rejects(publishMafiaRatingPolicy(h.env,h.moderator.actor,h.body),{code:'MAFIA_CALIBRATION_LEDGER_MISMATCH'});assert.equal(await policyCount(h.env),0);
});

for(const race of ['queue','match','start','revoked-session'])test(`future-season policy binding rejects concurrent ${race}`,async t=>{
  const h=await policyFixture(t),published=await publishMafiaRatingPolicy(h.env,h.moderator.actor,h.body),season=await futureSeason(h.env);
  const restore=interposeBatch(h.env,hasBinding,async db=>{
    if(race==='queue')await db.prepare("INSERT INTO mafia_ranked_queue(user_id,season_id,seat_id,token_hash,queue_revision,session_id,joined_at,expires_at,status) VALUES(?,?,?,?,?,?,?,?,'queued')").bind(h.people[0].accountId,season,h.people[0].id,'a'.repeat(64),'synthetic',h.people[0].sessionId,Date.now(),Date.now()+60_000).run();
    if(race==='match')await db.prepare("INSERT INTO mafia_ranked_matches(match_key,season_id,room_code,created_at,status) VALUES(?,?,?,?,'creating')").bind(crypto.randomUUID(),season,'123456',Date.now()).run();
    if(race==='start'){await new Promise(resolve=>setTimeout(resolve,15));await db.prepare('UPDATE mafia_ranked_seasons SET starts_at=? WHERE id=?').bind(Date.now()-1,season).run();}
    if(race==='revoked-session')await db.prepare('UPDATE sessions SET revoked_at=0 WHERE id=?').bind(h.moderator.sessionId).run();
  });
  await assert.rejects(bindMafiaSeasonRatingPolicy(h.env,h.moderator.actor,{seasonId:season,policyId:published.id}));assert.equal(restore(),true);
  assert.equal((await query(h.env,'SELECT COUNT(*) AS n FROM mafia_ranked_season_policy').first()).n,0);
});

test('one future binding is idempotent, detects hash corruption and survives deletion of its reviewer',async t=>{
  const h=await policyFixture(t),published=await publishMafiaRatingPolicy(h.env,h.moderator.actor,h.body),season=await futureSeason(h.env),body={seasonId:season,policyId:published.id};
  const first=await bindMafiaSeasonRatingPolicy(h.env,h.moderator.actor,body);
  assert.deepEqual(await bindMafiaSeasonRatingPolicy(h.env,h.moderator.actor,body),first);
  const current=await query(h.env,'SELECT * FROM mafia_ranked_seasons WHERE id=?',season).first();
  const original=await query(h.env,'SELECT policy_json FROM mafia_rating_policies WHERE id=?',published.id).first(),parsed=JSON.parse(original.policy_json);
  await query(h.env,'UPDATE mafia_rating_policies SET policy_json=? WHERE id=?',canonicalMafiaRatingValue({...parsed,townWinPrior:0.6}),published.id).run();
  await assert.rejects(resolveMafiaSeasonRatingPolicy(h.env,current),{code:'MAFIA_RATING_POLICY_INVALID'});
  await assert.rejects(bindMafiaSeasonRatingPolicy(h.env,h.moderator.actor,body),{code:'MAFIA_RATING_POLICY_INVALID'});
  await query(h.env,'UPDATE mafia_rating_policies SET policy_json=? WHERE id=?',original.policy_json,published.id).run();
  await deleteUser(h.env,h.moderator.accountId);
  assert.equal((await query(h.env,'SELECT created_by FROM mafia_rating_policies').first()).created_by,null);
  assert.equal((await query(h.env,'SELECT linked_by FROM mafia_ranked_season_policy').first()).linked_by,null);
  assert.deepEqual(await resolveMafiaSeasonRatingPolicy(h.env,current),parsed);
});

test('calibration export excludes learned-bound seasons instead of feeding v2 back into its baseline',async t=>{
  const h=await policyFixture(t),published=await publishMafiaRatingPolicy(h.env,h.moderator.actor,h.body),season=await futureSeason(h.env);
  await bindMafiaSeasonRatingPolicy(h.env,h.moderator.actor,{seasonId:season,policyId:published.id});
  await query(h.env,"INSERT INTO mafia_ranked_matches(match_key,season_id,room_code,created_at,status) VALUES('synthetic-v2',?,'123456',?,'aborted')",season,Date.now()).run();
  const exported=await rows(h.env,MAFIA_RATING_EXPORT_SQL);assert.equal(exported.length,100);assert.ok(exported.every(row=>row.seats===8));
});

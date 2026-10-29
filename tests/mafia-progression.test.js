import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalD1 } from '../server/local-d1.mjs';
import { createUser } from '../server/accounts/db.mjs';
import { persistMafiaProgress, mafiaProgressStatements, mafiaProgressEnabled, mafiaProgressLevel, mafiaRoleMastery,
  mafiaProgressDeleteStatements } from '../server/mafia-progression.mjs';

const NOW=Date.now(), FINISH=NOW-31_000;
async function setup(t) {
  const env={DB:createLocalD1(),MAFIA_PROGRESS_ENABLED:'1'};t.after(()=>env.DB.close());
  const user=await createUser(env,{name:'اختبار تقدم'});
  const event=(changes={})=>({eventSchemaVersion:1,eventKind:'match_completed',source:'live',rewardPolicyVersion:1,
    key:`fixture:${crypto.randomUUID()}`,eventId:`online:${crypto.randomUUID()}`,rulesetVersion:1,
    startedAt:FINISH-120_000,finishedAt:FINISH,notBefore:FINISH+30_000,
    visibility:'public',mode:'classic',capacity:6,participantCount:6,draw:false,
    // One frozen account projection is enough for the consumer fixture; the
    // room contract separately verifies its complete authenticated roster.
    results:[{userId:user.id,roleId:'investigator',initialFaction:'town',faction:'town',won:false,forfeited:false,eliminatedAt:null}],...changes});
  const player=()=>env.DB.prepare('SELECT * FROM mafia_player_progress WHERE user_id=?').bind(user.id).first();
  const role=()=>env.DB.prepare('SELECT * FROM mafia_role_progress WHERE user_id=?').bind(user.id).first();
  const receipts=async()=> (await env.DB.prepare('SELECT * FROM mafia_progress_events WHERE user_id=? ORDER BY match_key').bind(user.id).all()).results;
  return {env,user,event,player,role,receipts};
}

test('policy v1 awards public completion/win/draw and derives level/mastery at exact boundaries',async t=>{
  const h=await setup(t),a=h.event(),b=h.event(),c=h.event({draw:true});b.results[0].won=true;
  await persistMafiaProgress(h.env,a);await persistMafiaProgress(h.env,b);await persistMafiaProgress(h.env,c);
  const player=await h.player(),role=await h.role();
  assert.equal(player.total_xp,180);assert.equal(player.rewarded_matches,3);assert.equal(player.legacy_matches,0);
  assert.equal(role.qualified_matches,3);assert.equal(role.wins,1);assert.equal(role.draws,1);
  assert.deepEqual((await h.receipts()).map(row=>row.xp_awarded).sort((x,y)=>x-y),[50,60,70]);
  for(const [xp,level,remainder] of [[0,1,0],[249,1,249],[250,2,0],[499,2,249],[500,3,0]])
    assert.deepEqual(mafiaProgressLevel(xp),{level,xpInLevel:remainder,xpPerLevel:250});
  for(const [matches,tier] of [[0,0],[1,1],[4,1],[5,2],[14,2],[15,3],[39,3],[40,4],[99,4],[100,5],[101,5]])
    assert.equal(mafiaRoleMastery(matches),tier);
  assert.throws(()=>mafiaProgressLevel(-1));assert.throws(()=>mafiaRoleMastery(1.5));
});

test('private first three committed grants use FINISH UTC day; excess earns neither XP nor mastery, wins stay 50',async t=>{
  const h=await setup(t),day=Math.floor(FINISH/86400000)*86400000;
  const privateEvent=finishedAt=>h.event({visibility:'private',startedAt:finishedAt-120_000,finishedAt,notBefore:finishedAt+30_000});
  for(let index=0;index<4;index++){
    const event=privateEvent(day+1_000+index);event.results[0].won=true;
    await h.env.DB.batch(await mafiaProgressStatements(h.env,event,{now:day+2*86400000}));
  }
  assert.equal((await h.player()).total_xp,150);assert.equal((await h.player()).rewarded_matches,3);
  assert.equal((await h.role()).qualified_matches,3);assert.equal((await h.role()).wins,3);
  const rows=await h.receipts();assert.equal(rows.filter(row=>row.participation_granted).length,3);
  assert.equal(rows.find(row=>!row.participation_granted).exclusion_reason,'private_daily_cap');
  assert.ok(rows.every(row=>row.utc_day===day));
  const nextDay=privateEvent(day+86400000+1_000);
  await h.env.DB.batch(await mafiaProgressStatements(h.env,nextDay,{now:day+3*86400000}));
  assert.equal((await h.player()).total_xp,200);
});

test('exactly-once identity excludes policy version, compares immutable content and survives repeated consumers',async t=>{
  const h=await setup(t),event=h.event();event.results[0].won=true;
  await persistMafiaProgress(h.env,event);await persistMafiaProgress(h.env,structuredClone(event));
  assert.equal((await h.player()).total_xp,70);assert.equal((await h.receipts()).length,1);
  const conflict=structuredClone(event);conflict.results[0].won=false;
  await assert.rejects(persistMafiaProgress(h.env,conflict),/NOT NULL|constraint/i);
  assert.equal((await h.player()).total_xp,70);assert.equal((await h.role()).qualified_matches,1);
  await assert.rejects(persistMafiaProgress(h.env,{...event,rewardPolicyVersion:2}),/MAFIA_PROGRESS_INVALID/);
  assert.equal((await h.receipts())[0].reward_policy_version,1);
});

test('minimal permanent receipt retains final faction and outcome after conversion, duplicate delivery and archive cleanup',async t=>{
  const h=await setup(t),event=h.event({visibility:'private'});
  Object.assign(event.results[0],{faction:'shadow',won:true});
  const statements=await mafiaProgressStatements(h.env,event);
  assert.ok(statements[0].args.length<100,'the receipt INSERT remains within the D1 binding limit');
  await persistMafiaProgress(h.env,event);await persistMafiaProgress(h.env,structuredClone(event));
  const facts=({role_id,initial_faction,faction,won,draw,forfeited,visibility,participation_granted,xp_awarded})=>
    ({role_id,initial_faction,faction,won,draw,forfeited,visibility,participation_granted,xp_awarded});
  const expected={role_id:'investigator',initial_faction:'town',faction:'shadow',won:1,draw:0,forfeited:0,
    visibility:'private',participation_granted:1,xp_awarded:50};
  assert.deepEqual(facts((await h.receipts())[0]),expected);
  assert.equal((await h.player()).total_xp,50);assert.equal((await h.role()).qualified_matches,1);
  // Progress does not need a retained reveal, roster or result row to establish
  // the converted investigator's actual winning faction later.
  await h.env.DB.exec('DELETE FROM mafia_history;DELETE FROM mafia_results;');
  assert.deepEqual(facts((await h.receipts())[0]),expected);
  const legacy=h.event({source:'legacy',rewardPolicyVersion:null,startedAt:null,visibility:null,mode:null,capacity:null,participantCount:null,draw:true});
  Object.assign(legacy.results[0],{faction:'shadow',forfeited:true});
  for(let index=0;index<2;index++)await h.env.DB.batch(await mafiaProgressStatements(h.env,legacy,{legacy:true}));
  const old=(await h.receipts()).find(row=>row.source==='legacy');
  assert.deepEqual(facts(old),{role_id:'investigator',initial_faction:'town',faction:'shadow',won:0,draw:1,forfeited:1,
    visibility:null,participation_granted:0,xp_awarded:0});
  assert.equal((await h.player()).legacy_matches,1);assert.equal((await h.player()).total_xp,50);
  assert.equal((await h.role()).qualified_matches,1);
  await assert.rejects(h.env.DB.prepare("UPDATE mafia_progress_events SET faction='unknown' WHERE user_id=?").bind(h.user.id).run(),/CHECK constraint/);
  await assert.rejects(h.env.DB.prepare('UPDATE mafia_progress_events SET won=2 WHERE user_id=?').bind(h.user.id).run(),/CHECK constraint/);
  assert.deepEqual(facts((await h.receipts()).find(row=>row.source==='live')),expected);
});

test('a failure after receipt/player writes rolls back aggregates and quota; retry grants once',async t=>{
  const h=await setup(t),event=h.event({visibility:'private'}),batch=h.env.DB.batch.bind(h.env.DB);let injected=false;
  const mock=t.mock.method(h.env.DB,'batch',statements=>{
    if(!injected){injected=true;return batch([...statements.slice(0,3),h.env.DB.prepare('INSERT INTO missing_progress_fixture VALUES(1)'),...statements.slice(3)]);}
    return batch(statements);
  });
  await assert.rejects(persistMafiaProgress(h.env,event),/missing_progress_fixture/);
  assert.deepEqual(await h.receipts(),[]);assert.equal(await h.player(),null);assert.equal(await h.role(),null);
  mock.mock.restore();await persistMafiaProgress(h.env,event);await persistMafiaProgress(h.env,event);
  assert.equal((await h.player()).total_xp,50);assert.equal((await h.receipts()).length,1);
});

test('a conflicting receipt for a later participant rolls back earlier participant grants in the same batch',async t=>{
  const h=await setup(t),second=await createUser(h.env,{name:'مشارك ثان'}),existing=h.event();
  existing.results[0].userId=second.id;await persistMafiaProgress(h.env,existing);
  const conflict=structuredClone(existing);conflict.results.unshift({...conflict.results[0],userId:h.user.id});
  await assert.rejects(persistMafiaProgress(h.env,conflict),/NOT NULL|constraint/i);
  assert.deepEqual(await h.receipts(),[]);assert.equal(await h.player(),null);assert.equal(await h.role(),null);
  assert.equal((await h.env.DB.prepare('SELECT total_xp FROM mafia_player_progress WHERE user_id=?').bind(second.id).first()).total_xp,50);
});

test('ordinary elimination retains the team reward while forfeiture, legacy, tutorial, observers and aborts never reward',async t=>{
  const h=await setup(t),eliminated=h.event();eliminated.results[0].won=true;eliminated.results[0].eliminatedAt=FINISH-10_000;
  await persistMafiaProgress(h.env,eliminated);
  const forfeit=h.event({visibility:'private'});forfeit.results[0].won=true;forfeit.results[0].forfeited=true;
  await persistMafiaProgress(h.env,forfeit);
  assert.equal((await h.player()).total_xp,70);assert.equal((await h.role()).qualified_matches,1);
  assert.equal((await h.receipts()).find(row=>row.match_key===forfeit.key).exclusion_reason,'forfeited');
  assert.deepEqual(await persistMafiaProgress(h.env,{...h.event(),rewardPolicyVersion:null}),{status:'legacy-unrewarded'});
  for(const change of [{source:'tutorial'},{source:'observer'},{technicalAbort:true},{tutorial:true},{observer:true}])
    await assert.rejects(persistMafiaProgress(h.env,h.event(change)),/MAFIA_PROGRESS_INVALID/);
  const observerSeat=h.event();observerSeat.results[0].spectator=true;
  await assert.rejects(persistMafiaProgress(h.env,observerSeat),/MAFIA_PROGRESS_INVALID/);
  assert.equal((await h.player()).total_xp,70);assert.equal((await h.receipts()).length,2);
});

test('default-off pauses promised rewards and the 30-second gate cannot be acknowledged early',async t=>{
  const h=await setup(t),event=h.event();
  assert.equal(mafiaProgressEnabled({}),false);assert.equal(mafiaProgressEnabled({MAFIA_PROGRESS_ENABLED:'true'}),false);
  delete h.env.MAFIA_PROGRESS_ENABLED;
  await assert.rejects(persistMafiaProgress(h.env,event),/MAFIA_PROGRESS_DISABLED/);
  assert.deepEqual(await h.receipts(),[]);
  h.env.MAFIA_PROGRESS_ENABLED='1';
  const pending=h.event({finishedAt:NOW,notBefore:NOW+30_000});
  await assert.rejects(persistMafiaProgress(h.env,pending),/MAFIA_PROGRESS_PENDING/);
  assert.deepEqual(await h.receipts(),[]);await persistMafiaProgress(h.env,event);
  assert.equal((await h.player()).total_xp,50);
});

test('live account guards run inside SQL, and deletion removes permanent receipts without late resurrection',async t=>{
  const h=await setup(t),event=h.event(),batch=h.env.DB.batch.bind(h.env.DB);let raced=false;
  const mock=t.mock.method(h.env.DB,'batch',async statements=>{
    if(!raced){raced=true;await h.env.DB.prepare('INSERT INTO account_deletions(user_id,attempt_id,created_at) VALUES(?,?,?)').bind(h.user.id,'progress-race',NOW).run();}
    return batch(statements);
  });
  await persistMafiaProgress(h.env,event);assert.equal(raced,true);assert.deepEqual(await h.receipts(),[]);assert.equal(await h.player(),null);
  mock.mock.restore();await h.env.DB.prepare('DELETE FROM account_deletions WHERE user_id=?').bind(h.user.id).run();
  await persistMafiaProgress(h.env,event);assert.equal((await h.player()).total_xp,50);
  await h.env.DB.batch(mafiaProgressDeleteStatements(h.env,h.user.id));
  await h.env.DB.prepare('DELETE FROM users WHERE id=?').bind(h.user.id).run();
  await persistMafiaProgress(h.env,event);
  assert.deepEqual(await h.receipts(),[]);assert.equal(await h.player(),null);assert.equal(await h.role(),null);
});

test('legacy import shares permanent identity but increments only legacy counters; no private quota or mastery',async t=>{
  const h=await setup(t),event=h.event({source:'legacy',rewardPolicyVersion:null,startedAt:null,visibility:null,mode:null,capacity:null,participantCount:null});
  for(let index=0;index<2;index++)await h.env.DB.batch(await mafiaProgressStatements(h.env,event,{legacy:true}));
  assert.equal((await h.player()).total_xp,0);assert.equal((await h.player()).rewarded_matches,0);assert.equal((await h.player()).legacy_matches,1);
  assert.equal((await h.role()).qualified_matches,0);assert.equal((await h.role()).wins,0);assert.equal((await h.role()).legacy_matches,1);
  const row=(await h.receipts())[0];assert.equal(row.source,'legacy');assert.equal(row.status,'processed');assert.equal(row.participation_granted,0);
  const live=h.event({key:event.key});
  await assert.rejects(persistMafiaProgress(h.env,live),/NOT NULL|constraint/i);
  assert.equal((await h.player()).total_xp,0,'unexpected live/legacy collision requires reconciliation, never silent reward loss');
});

test('unknown/duplicate accounts, bad roles, impossible outcomes and shortened privacy delay reject the whole event',async t=>{
  const h=await setup(t);
  const mutations=[e=>{e.results.push({...e.results[0]});},e=>{e.results[0].roleId='made-up';},e=>{e.results[0].initialFaction='mafia';},
    e=>{e.results[0].userId='../other';},e=>{e.draw=true;e.results[0].won=true;},e=>{e.notBefore=e.finishedAt+29_999;},
    e=>{e.startedAt=e.finishedAt+1;},e=>{e.participantCount=2;}];
  for(const mutate of mutations){const event=h.event();mutate(event);await assert.rejects(persistMafiaProgress(h.env,event),/MAFIA_PROGRESS_INVALID/);}
  assert.deepEqual(await h.receipts(),[]);assert.equal(await h.player(),null);
});

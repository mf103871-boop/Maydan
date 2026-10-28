import test from 'node:test';
import assert from 'node:assert/strict';
import { createMafiaTutorial, validateTutorialProgress } from '../src/games/mafia/tutorial/adapter.mjs';
import { TUTORIAL_ACTORS, TUTORIAL_HUMAN_ID } from '../src/games/mafia/tutorial/scenario.mjs';
import * as pure from '../src/games/mafia/rules.mjs';
import * as server from '../server/mafia-model.mjs';
import { RoomError as ServerRoomError } from '../server/room-model.mjs';
import { RoomError, fail } from '../src/shared/room-primitives.mjs';
import { objectionableText } from '../src/shared/moderation-filter.mjs';
import { objectionableText as serverFilter } from '../server/moderation/filter.mjs';

const human=TUTORIAL_HUMAN_ID,mafia='tutorial-mafia',masker='tutorial-masker';
const next={
  welcome:t=>t.guide('continue'),
  'lobby-chat':t=>t.act('chat',{text:'مرحبًا يا شباب',channel:'public',clientId:'tutorial-test-message'}),
  'lobby-voice':t=>t.guide('voice-joined')&&t.guide('voice-unmuted'),
  'lobby-ready':t=>t.act('ready',{ready:true}),
  'lobby-start':t=>t.act('start'),
  'role-open':t=>t.guide('role-open'),
  'role-close':t=>t.guide('role-close'),
  opening:t=>t.guide('continue'),
  'night-1-intro':t=>t.guide('continue'),
  'night-1-pick':t=>t.act('night_action',{targetId:mafia}),
  'night-1-result':t=>t.guide('clues-open')&&t.guide('continue'),
  'discussion-1':t=>t.guide('continue'),
  'nomination-1':t=>t.act('nominate',{targetId:mafia}),
  'defense-1':t=>t.guide('continue'),
  'verdict-1':t=>t.act('verdict',{approve:true}),
  'verdict-1-result':t=>t.guide('continue'),
  'night-2-intro':t=>t.guide('continue'),
  'night-2-pick':t=>t.act('night_action',{targetId:masker}),
  'night-2-result':t=>t.guide('clues-open')&&t.guide('continue'),
  'discussion-2':t=>t.guide('continue'),
  'nomination-2':t=>t.act('nominate',{targetId:masker}),
  'defense-2':t=>t.guide('continue'),
  'verdict-2':t=>t.act('verdict',{approve:true}),
  ending:t=>t.guide('continue'),
  'quiz-majority':t=>t.guide('quiz-answer','four'),
  'quiz-information':t=>t.guide('quiz-answer','dated'),
  shadow:t=>t.guide('continue'),
  encyclopedia:t=>t.guide('encyclopedia-open')&&t.guide('encyclopedia-close'),
};
async function until(tutorial,step) {
  for(let i=0;tutorial.getState().coach.stepId!==step&&i<40;i++){
    const current=tutorial.getState().coach.stepId;
    assert.ok(next[current],`unknown lesson step ${current}`);
    assert.equal(await next[current](tutorial),true,`accepted transition from ${current}`);
  }
  assert.equal(tutorial.getState().coach.stepId,step);
}
const alive=s=>s.members.filter(p=>p.alive===true);

test('shared rules and primitives preserve every server export and RoomError identity',()=>{
  assert.deepEqual(Object.keys(server),Object.keys(pure));
  for(const key of Object.keys(pure))assert.equal(server[key],pure[key]);
  assert.equal(ServerRoomError,RoomError);assert.equal(serverFilter,objectionableText);
  assert.throws(()=>fail('AUTH',401),error=>error instanceof ServerRoomError&&error.code==='AUTH'&&error.status===401);
});

test('the complete fixed eight-seat match uses actual rules: private investigation, healing, two charges, strict majorities and town win',async()=>{
  const t=createMafiaTutorial(),begin=t.getState().clock.nowMs;
  assert.equal(t.getState().snapshot.members.filter(m=>m.trainingBot).length,7);
  assert.equal(t.getState().snapshot.members.some(m=>Object.hasOwn(m,'roleId')),false);
  await until(t,'night-1-result');let s=t.getState().snapshot;
  assert.equal(alive(s).length,8);assert.equal(s.you.resources.charges,1);
  assert.deepEqual(s.you.reports.map(r=>[r.type,r.targetId,r.faction]),[['investigation',mafia,'mafia']]);
  assert.equal(s.log.find(e=>e.type==='dawn').peaceful,true);
  assert.equal(s.log.some(e=>e.roleId||e.targetId||e.protectedId),false);
  assert.equal(s.replay,null);assert.equal(t.guide('continue'),false,'a result is read before leaving it');
  await until(t,'defense-1');
  await assert.rejects(t.act('chat',{text:'مقاطعة',clientId:'tutorial-interruption'}),{code:'CHANNEL'});
  await until(t,'verdict-1-result');s=t.getState().snapshot;
  assert.equal(alive(s).length,7);
  assert.deepEqual(s.log.filter(e=>e.type==='verdict_closed').map(e=>[e.approvals,e.total,e.passed]),[[5,8,true]]);
  assert.equal(s.members.find(m=>m.id===mafia).alive,false);
  assert.equal(s.members.find(m=>m.id===mafia).roleId,undefined,'verdict never reveals the role');
  await until(t,'night-2-result');s=t.getState().snapshot;
  assert.equal(alive(s).length,6);assert.equal(s.you.resources.charges,0);
  assert.deepEqual(s.you.reports.map(r=>r.targetId),[mafia,masker]);
  assert.equal(s.members.find(m=>m.id==='tutorial-citizen-3').alive,false);
  await until(t,'ending');s=t.getState().snapshot;
  assert.equal(s.outcome.faction,'town');assert.equal(t.getState().clock.nowMs-begin,431_000);
  assert.deepEqual(s.log.filter(e=>e.type==='verdict_closed').map(e=>[e.approvals,e.total,e.passed]),[[5,8,true],[4,6,true]]);
  assert.deepEqual(s.replay.players.map(m=>[m.playerId,m.roleId]),TUTORIAL_ACTORS.map(m=>[m.id,m.roleId]));
  assert.equal(s.replay.events.some(e=>e.type==='night_action'&&e.roleId==='masker'),false);
  assert.deepEqual(s.replay.events.filter(e=>e.type==='night_action'&&e.roleId==='doctor').map(e=>e.targetId),['tutorial-citizen-1','tutorial-citizen-2']);
  assert.equal(t.getState().status,'active','winning alone is not completion before review and knowledge checks');
  await until(t,'complete');assert.equal(t.getState().status,'completed');
});

for(const step of ['night-1-pick','night-2-pick','nomination-1','nomination-2','verdict-1','verdict-2','quiz-majority','quiz-information'])test(`${step}: a mistaken decision settles honestly, then replay restores the entire checkpoint`,async()=>{
  const t=createMafiaTutorial();await until(t,step);
  const before=t.getState(),savedBefore=t.exportProgress();
  if(step.startsWith('night-'))await t.act('night_action',{targetId:'tutorial-guard'});
  else if(step.startsWith('nomination'))await t.act('nominate',{targetId:human});
  else if(step.startsWith('verdict'))await t.act('verdict',{approve:false});
  else t.guide('quiz-answer',step==='quiz-majority'?'three':'certain');
  assert.ok(t.getState().feedback?.canRetry);
  if(step.startsWith('verdict')){
    const result=t.getState().snapshot.log.filter(e=>e.type==='verdict_closed').at(-1);
    assert.deepEqual([result.approvals,result.total,result.passed],step==='verdict-1'?[4,8,false]:[3,6,false]);
  }
  const persisted=t.exportProgress(),resumed=createMafiaTutorial({progress:persisted});
  assert.equal(resumed.getState().restoreStatus,'restored');
  assert.deepEqual(resumed.getState().snapshot,t.getState().snapshot);
  assert.deepEqual(resumed.getState().feedback,t.getState().feedback);
  assert.equal(t.retryCheckpoint(),true);
  assert.equal(t.getState().checkpointRevision,before.checkpointRevision+1);
  assert.deepEqual(t.getState().snapshot,before.snapshot);
  assert.deepEqual(t.getState().clock,before.clock);
  assert.deepEqual(t.exportProgress(),savedBefore);
  await until(t,'complete');assert.equal(t.getState().snapshot.outcome.faction,'town');
});

test('virtual clock pauses explanations, uses bounded deltas, times out through the rules and restores both the day and charges',async()=>{
  const t=createMafiaTutorial();let now=t.getState().clock.nowMs;
  assert.equal(t.advance(1000),false);assert.equal(t.getState().clock.nowMs,now);
  await until(t,'night-2-pick');const before=t.getState();
  assert.equal(before.clock.paused,true);assert.equal(t.guide('continue'),true);
  assert.equal(t.advance(Infinity),false);assert.equal(t.advance(35_000),false);assert.equal(t.advance(-1),false);
  for(let i=0;i<35;i++)assert.equal(t.advance(1000),true);
  assert.equal(t.getState().feedback.code,'DECISION_TIMEOUT');assert.equal(t.getState().snapshot.phase,'dawn');
  assert.equal(t.getState().snapshot.you.resources.charges,1,'no action is invented when time runs out');
  assert.equal(alive(t.getState().snapshot).length,6);
  assert.ok(validateTutorialProgress(t.exportProgress()));
  assert.equal(t.retryCheckpoint(),true);assert.deepEqual(t.getState().snapshot,before.snapshot);assert.deepEqual(t.getState().clock,before.clock);
});

test('bounded decision replay validates elapsed decisions, never restores raw state, and excludes free-form messages',async()=>{
  const t=createMafiaTutorial();await until(t,'night-1-pick');t.guide('continue');for(let i=0;i<12;i++)t.advance(1000);
  const checkpointResume=createMafiaTutorial({progress:t.exportProgress()});
  assert.equal(checkpointResume.getState().clock.remainingMs,35_000,'unfinished timing resumes from the saved checkpoint');
  await t.act('night_action',{targetId:mafia});
  const valid=t.exportProgress(),resumed=createMafiaTutorial({progress:valid});
  assert.deepEqual(validateTutorialProgress(valid),valid);
  assert.deepEqual(resumed.getState().snapshot,t.getState().snapshot);
  assert.equal(JSON.stringify(valid).includes('مرحبًا يا شباب'),false);
  const tamper=fn=>{const bad=structuredClone(valid);fn(bad);assert.equal(validateTutorialProgress(bad),null);assert.equal(createMafiaTutorial({progress:bad}).getState().restoreStatus,'invalid');};
  tamper(v=>v.room={roleStates:{[human]:{roleId:'mafia'}}});
  tamper(v=>v.decisions.at(-1).fields.roles={});
  tamper(v=>v.decisions.at(-1).elapsedMs=35_000);
  tamper(v=>v.decisions.at(-1).fields.targetId='remote-real-account');
  tamper(v=>v.decisions.reverse());
  tamper(v=>v.decisions=Array(65).fill(v.decisions[0]));
  tamper(v=>v.decisions.at(-1).elapsedMs=-1);
  const outdated={...valid,scenarioVersion:999};assert.equal(validateTutorialProgress(outdated),null);assert.equal(createMafiaTutorial({progress:outdated}).getState().restoreStatus,'incompatible');
  assert.equal(Object.hasOwn(valid,'room'),false);assert.equal(Object.hasOwn(valid,'now'),false);
});

test('the complete lesson, retries and completion replays have no network, provider, real clock, storage or stats side effects',async context=>{
  context.mock.method(globalThis,'fetch',()=>assert.fail('the local tutorial must never fetch'));
  context.mock.method(Date,'now',()=>assert.fail('the tutorial must use its explicit virtual clock'));
  const t=createMafiaTutorial();let notifications=0;const unsubscribe=t.subscribe(()=>notifications++);
  await until(t,'verdict-1');await t.act('verdict',{approve:false});t.retryCheckpoint();await until(t,'complete');
  assert.ok(notifications>0);unsubscribe();
  const progress=t.exportProgress();for(let i=0;i<3;i++)assert.equal(createMafiaTutorial({progress}).getState().status,'completed');
  const snapshot=t.getState().snapshot;snapshot.you.resources.charges=999;snapshot.settings.capacity=12;
  assert.equal(t.getState().snapshot.you.resources.charges,0);assert.equal(t.getState().snapshot.settings.capacity,8);
  const count=notifications;t.dispose();assert.equal(await t.act('start'),false);assert.equal(t.guide('continue'),false);assert.equal(t.advance(1),false);assert.equal(notifications,count);
});

test('tutorial adapter rejects caller-supplied actor, seed, roles, rewind and phase values without changing its checkpoint',async()=>{
  const t=createMafiaTutorial();await until(t,'night-1-pick');const before=t.getState();
  for(const extra of [{actorId:mafia},{seed:1},{roles:[mafia]},{rewind:true},{now:0},{phaseId:99},{matchId:123},{randomWord:0}])await assert.rejects(t.act('night_action',{targetId:mafia,...extra}),{code:'INVALID'});
  assert.deepEqual(t.getState(),before);assert.equal(t.guide('restore-raw',{phase:'over'}),false);
});

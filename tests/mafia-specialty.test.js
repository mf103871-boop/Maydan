import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {createMafiaLab,validateMafiaLabProgress} from '../src/games/mafia/tutorial/labs/adapter.mjs';
import {MAFIA_LABS,LAB_HUMAN,labActors} from '../src/games/mafia/tutorial/labs/scenarios.mjs';

const cache=path.resolve('.cache');await mkdir(cache,{recursive:true});const dir=await mkdtemp(path.join(cache,'mafia-specialty-'));
after(async()=>{assert.equal(path.dirname(dir),cache);await rm(dir,{recursive:true,force:true});});
await build({stdin:{resolveDir:process.cwd(),contents:"export {readLabRecord,saveLabRecord,labStorageKey,clearDeletedMafiaLabs} from './src/games/mafia/tutorial/labs/progress.js';"},outfile:path.join(dir,'storage.mjs'),bundle:true,platform:'node',format:'esm',packages:'external',logLevel:'silent'});
const {readLabRecord,saveLabRecord,labStorageKey,clearDeletedMafiaLabs}=await import(pathToFileURL(path.join(dir,'storage.mjs')));
const by=(course,role)=>labActors(course).find(actor=>actor.roleId===role)?.id;
const make=courseId=>createMafiaLab({courseId});
const state=lab=>lab.getState(),view=lab=>state(lab).snapshot;
async function correct(lab,course) {
  const step=state(lab).coach.stepId;
  const targets={self:LAB_HUMAN,protect:by(course,'investigator'),repeat:by(course,'citizen'),mask:by(course,'mafia'),block:by(course,'doctor'),shield:by(course,'guard'),investigate:by(course,'mafia'),'after-conversion':by(course,'citizen'),trace:by(course,'doctor'),'trace-quiet':by(course,'investigator'),'trace-blocked':by(course,'doctor')};
  if(targets[step])return lab.act('night_action',{targetId:targets[step]});
  if(step==='nominate')return lab.act('nominate',{targetId:null});
  return lab.guide(['recruit','verdict'].includes(step)?'abstain':'continue');
}
async function reach(lab,course,step) {
  for(let n=0;state(lab).coach.stepId!==step&&n<20;n++){assert.equal(await correct(lab,course),true);assert.equal(state(lab).feedback,null);}
  assert.equal(state(lab).coach.stepId,step);
}

for(const course of Object.keys(MAFIA_LABS))test(`${course}: every correct decision restores through the real rules and ends locally`,async()=>{
  const lab=make(course);let checks=0;
  while(state(lab).status!=='completed'){
    assert.ok(checks++<20);const restored=createMafiaLab({courseId:course,progress:lab.exportProgress()});
    assert.equal(state(restored).restoreStatus,'restored');assert.deepEqual(view(restored),view(lab));restored.dispose();
    assert.equal(await correct(lab,course),true);assert.equal(state(lab).feedback,null);
  }
  assert.ok(view(lab).members.slice(1).every(actor=>actor.trainingBot));
  assert.equal(view(lab).settings.voiceMode,'off');assert.equal(state(lab).clock.paused,true);
  assert.equal(await lab.act('night_action',{targetId:LAB_HUMAN}),false);
  assert.deepEqual(validateMafiaLabProgress(lab.exportProgress()),lab.exportProgress());
  assert.doesNotMatch(JSON.stringify(lab.exportProgress()),/roleStates|resources|seed|account|token|chat|roster|reward/);
});

test('doctor: real self protection, exhausted self protection, previous-target rejection and full retry',async()=>{
  const lab=make('doctor');await reach(lab,'doctor','self');
  await lab.act('night_action',{targetId:by('doctor','citizen')});assert.equal(view(lab).you.alive,false,'wrong protection lets the actual attack kill the doctor');
  assert.equal(state(lab).feedback.code,'WRONG_DECISION');assert.equal(lab.retryCheckpoint(),true);assert.equal(view(lab).you.alive,true);
  await correct(lab,'doctor');assert.equal(view(lab).you.resources.selfProtection,0);assert.equal(view(lab).you.alive,true);
  await reach(lab,'doctor','protect');const before=view(lab);
  await lab.act('night_action',{targetId:LAB_HUMAN});assert.equal(state(lab).feedback.code,'TARGET');assert.deepEqual(view(lab),before);
  lab.retryCheckpoint();await correct(lab,'doctor');await reach(lab,'doctor','repeat');
  await lab.act('night_action',{targetId:by('doctor','investigator')});assert.equal(state(lab).feedback.code,'TARGET');
  const saved=lab.exportProgress(),restored=createMafiaLab({courseId:'doctor',progress:saved});
  assert.equal(state(restored).feedback.code,'TARGET');restored.retryCheckpoint();await correct(restored,'doctor');assert.equal(state(restored).status,'completed');
});

test('masker: real NPC investigation changes for one night without fabricating a human report',async()=>{
  const lab=make('masker');await reach(lab,'masker','mask');
  await lab.act('night_action',{targetId:by('masker','citizen')});assert.equal(state(lab).feedback.code,'TARGET');lab.retryCheckpoint();
  await lab.act('night_action',{targetId:LAB_HUMAN});assert.equal(state(lab).feedback.code,'WRONG_DECISION');assert.equal(view(lab).you.resources.charges,0);assert.match(state(lab).feedback.text,/المافيا/);
  lab.retryCheckpoint();assert.equal(view(lab).you.resources.charges,1);await correct(lab,'masker');
  assert.match(state(lab).coach.text,/أهل الميدان/);assert.deepEqual(view(lab).you.reports,[]);assert.equal(view(lab).you.faction,'mafia');
  lab.guide('continue');assert.match(state(lab).coach.text,/المافيا/);assert.equal(view(lab).you.resources.charges,0);assert.deepEqual(view(lab).you.reports,[]);
});

test('blocker: blocking doctor removes active protection; a fresh experiment preserves the passive shield',async()=>{
  const lab=make('blocker');await reach(lab,'blocker','block');
  await lab.act('night_action',{targetId:by('blocker','citizen')});assert.equal(view(lab).members.find(actor=>actor.id===by('blocker','citizen')).alive,true);
  lab.retryCheckpoint();await correct(lab,'blocker');assert.equal(view(lab).members.find(actor=>actor.id===by('blocker','citizen')).alive,false);
  assert.match(state(lab).coach.text,/مجلس تدريبي جديد/);const oldAt=state(lab).clock.nowMs;
  lab.guide('continue');assert.ok(state(lab).clock.nowMs>oldAt);assert.equal(view(lab).you.resources.charges,1);await correct(lab,'blocker');
  assert.equal(view(lab).members.find(actor=>actor.id===by('blocker','guard')).alive,true);assert.equal(state(lab).status,'completed');
  assert.match(state(lab).coach.text,/استهلك درعه/);
});

test('conversion: actual recruitment changes faction while preserving investigator identity and remaining charges',async()=>{
  const lab=make('conversion');await reach(lab,'conversion','recruit');assert.equal(view(lab).you.resources.charges,1);
  await lab.act('night_action',{targetId:by('conversion','citizen')});
  assert.equal(state(lab).feedback.code,'WRONG_DECISION');assert.equal(view(lab).you.faction,'shadow');assert.equal(view(lab).you.resources.charges,0);
  lab.retryCheckpoint();assert.equal(view(lab).you.faction,'town');assert.equal(view(lab).you.resources.charges,1);
  lab.guide('abstain');assert.equal(view(lab).you.faction,'shadow');assert.equal(view(lab).you.roleId,'investigator');assert.equal(view(lab).you.resources.charges,1);
  assert.equal(view(lab).you.reports.filter(report=>report.type==='investigation').length,1);
  await reach(lab,'conversion','done');assert.equal(view(lab).you.resources.charges,0);assert.equal(view(lab).you.reports.filter(report=>report.type==='investigation').length,2);
});

test('abstention: a real tied nomination selects nobody; four of eight fails and an affirmative fifth passes',async()=>{
  const lab=make('abstention');await reach(lab,'abstention','nominate');
  assert.equal(lab.guide('abstain'),false,'nomination abstention must use the real nominate(null) action');await correct(lab,'abstention');
  assert.equal(view(lab).log.find(event=>event.type==='nomination_closed').nomineeId,null);
  await reach(lab,'abstention','verdict');await lab.act('verdict',{approve:true});
  assert.deepEqual((({approvals,total,passed})=>({approvals,total,passed}))(view(lab).log.find(event=>event.type==='verdict_closed')),{approvals:5,total:8,passed:true});
  assert.equal(state(lab).feedback.code,'WRONG_DECISION');lab.retryCheckpoint();
  await lab.act('verdict',{approve:false});assert.equal(state(lab).feedback.code,'WRONG_DECISION','a recorded rejection is distinct from sending no ballot');
  lab.retryCheckpoint();lab.guide('abstain');const verdict=view(lab).log.find(event=>event.type==='verdict_closed');
  assert.equal(verdict.approvals,4);assert.equal(verdict.total,8);assert.equal(verdict.passed,false);assert.equal(view(lab).members.find(actor=>actor.id===by('abstention','mafia')).alive,true);
});

test('bounded semantic journals reject skipped steps, raw state, foreign actors, course/version changes and decisions after feedback',async()=>{
  const lab=make('doctor');await reach(lab,'doctor','self');const valid=lab.exportProgress();
  const bad=[{...valid,seed:1},{...valid,courseId:'unknown'},{...valid,courseVersion:2},{...valid,rulesetVersion:2},{...valid,decisions:Array(65).fill(valid.decisions[0])},
    {...valid,decisions:[{step:'repeat',type:'night_action',fields:{targetId:LAB_HUMAN}}]},
    {...valid,decisions:[...valid.decisions,{step:'self',type:'night_action',fields:{targetId:'real-account'}}]},
    {...valid,decisions:[...valid.decisions,{step:'self',type:'night_action',fields:{targetId:LAB_HUMAN,roleId:'doctor'}}]},
    {...valid,decisions:[...valid.decisions,...valid.decisions]}];
  for(const input of bad){const restored=createMafiaLab({courseId:'doctor',progress:input});assert.notEqual(state(restored).restoreStatus,'restored');assert.equal(state(restored).coach.stepId,'intro');assert.equal(validateMafiaLabProgress(input),null);}
  assert.equal(createMafiaLab({courseId:'doctor',progress:{...valid,courseId:'masker'}}).getState().restoreStatus,'invalid');
  await lab.act('night_action',{targetId:by('doctor','citizen')});const wrong=lab.exportProgress();wrong.decisions.push({step:'self',type:'continue',fields:{}});assert.equal(validateMafiaLabProgress(wrong),null);
  await assert.rejects(make('masker').act('start',{}),{code:'INVALID'});assert.equal(make('doctor').guide('abstain'),false);
});

test('storage isolates account, guest, origin and course; corruption fails closed, and deletion clears only the account namespace',async()=>{
  const items=new Map(),store={getItem:key=>items.get(key),setItem:(key,value)=>items.set(key,value),removeItem:key=>items.delete(key)};
  const owners=['https://one.invalid|A','https://one.invalid|B','https://one.invalid|guest','https://two.invalid|A'];
  const lab=make('doctor');await reach(lab,'doctor','protect');
  for(const owner of owners)assert.equal(saveLabRecord(store,owner,'doctor',lab.exportProgress()),true);
  assert.equal(readLabRecord(store,owners[0],'doctor').status,'in-progress');assert.equal(readLabRecord(store,owners[0],'masker').progress,null);
  const key=labStorageKey(owners[0],'doctor'),record=JSON.parse(items.get(key));
  for(const forged of [{...record,owner:owners[1]},{...record,courseId:'masker'},{...record,...make('masker').exportProgress()},{...record,rawRoles:{}},null]){
    items.set(key,JSON.stringify(forged));assert.equal(readLabRecord(store,owners[0],'doctor').progress,null);
  }
  items.set(key,JSON.stringify({...record,courseVersion:0}));assert.equal(readLabRecord(store,owners[0],'doctor').outdated,true);
  items.set(key,'x'.repeat(20_001));assert.equal(readLabRecord(store,owners[0],'doctor').invalid,true);
  items.set(key,JSON.stringify(record));items.set('maydan:mafia-tutorial:original','untouched');
  clearDeletedMafiaLabs({userId:'A',server:'https://one.invalid',storage:store});assert.equal(readLabRecord(store,owners[0],'doctor').progress,null);
  for(const owner of owners.slice(1))assert.equal(readLabRecord(store,owner,'doctor').status,'in-progress');
  assert.equal(items.get('maydan:mafia-tutorial:original'),'untouched');
});

test('local chat uses the actual action but never enters the persisted journal; storage failure remains owner scoped',async()=>{
  const lab=make('masker');await reach(lab,'masker','mask');const prefix=lab.exportProgress().decisions;
  await lab.act('chat',{channel:'team',text:'رسالة محلية لا تُحفظ',clientId:'local-only'});
  assert.equal(view(lab).chats.team.at(-1).text,'رسالة محلية لا تُحفظ');assert.deepEqual(lab.exportProgress().decisions,prefix);
  assert.equal(createMafiaLab({courseId:'masker',progress:lab.exportProgress()}).getState().snapshot.chats.team.length,0);
  const blocked={getItem(){throw Error('blocked');},setItem(){throw Error('blocked');},removeItem(){throw Error('blocked');}};
  const owner='https://blocked.invalid|A';assert.equal(saveLabRecord(blocked,owner,'masker',lab.exportProgress()),false);
  assert.equal(readLabRecord(blocked,owner,'masker').status,'in-progress');assert.equal(readLabRecord(blocked,'https://blocked.invalid|B','masker').progress,null);
  clearDeletedMafiaLabs({userId:'A',server:'https://blocked.invalid',storage:blocked});assert.equal(readLabRecord(blocked,owner,'masker').progress,null);
});

test('pure course graph has no server persistence and controllers perform no transport, timer or media operations',async()=>{
  const graph=await build({entryPoints:['src/games/mafia/tutorial/labs/adapter.mjs'],bundle:true,write:false,metafile:true,format:'esm',logLevel:'silent'});
  assert.ok(Object.keys(graph.metafile.inputs).every(input=>!input.startsWith('server/')));
  const names=['fetch','WebSocket','setTimeout','setInterval'],saved=Object.fromEntries(names.map(name=>[name,globalThis[name]]));
  try{
    for(const name of names)globalThis[name]=()=>{throw Error('Unexpected '+name);};
    for(const course of Object.keys(MAFIA_LABS)){const lab=make(course);assert.equal(lab.advance(1e9),false);await reach(lab,course,'done');lab.dispose();assert.equal(lab.guide('continue'),false);assert.equal(lab.advance(1e9),false);}
  }finally{for(const name of names)globalThis[name]=saved[name];}
});

import * as rules from '../rules.mjs';
import { fail } from '../../../shared/room-primitives.mjs';
import { TUTORIAL_ACTORS, TUTORIAL_HUMAN_ID, TUTORIAL_LESSONS, TUTORIAL_DIALOGUE, tutorialRandomWord } from './scenario.mjs';
import { MAFIA_TUTORIAL_ID, MAFIA_TUTORIAL_SCENARIO_ID, MAFIA_TUTORIAL_SCENARIO_VERSION, MAFIA_TUTORIAL_RULESET_VERSION, MAFIA_TUTORIAL_PROGRESS_VERSION } from './version.mjs';
export * from './version.mjs';

const BASE_TIME = 1_800_000_000_000;
const MAX_DECISIONS = 64, MAX_PROGRESS_BYTES = 16_384;
const HUMAN = TUTORIAL_HUMAN_ID, DOCTOR = 'tutorial-doctor', GUARD = 'tutorial-guard';
const CITIZENS = ['tutorial-citizen-1', 'tutorial-citizen-2', 'tutorial-citizen-3'];
const MAFIA = 'tutorial-mafia', MASKER = 'tutorial-masker';
const ACTION_STEPS = new Set(['night-1-pick','night-2-pick','nomination-1','nomination-2','verdict-1','verdict-2']);
const GUIDES = new Set(['continue','role-open','role-close','clues-open','voice-joined','voice-unmuted','encyclopedia-open','encyclopedia-close','quiz-answer']);
const CONTINUE = Object.freeze({welcome:'lobby-chat',opening:'night-1-intro','night-1-intro':'night-1-pick','night-1-result':'discussion-1','discussion-1':'nomination-1','defense-1':'verdict-1','verdict-1-result':'night-2-intro','night-2-intro':'night-2-pick','night-2-result':'discussion-2','discussion-2':'nomination-2','defense-2':'verdict-2',ending:'quiz-majority',shadow:'encyclopedia'});
const clone = value => structuredClone(value);
const plain = value => value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const keys = (value, required, optional = []) => plain(value) && required.every(key => Object.hasOwn(value,key)) && Object.keys(value).every(key => required.includes(key)||optional.includes(key));
const knownTarget = id => id === null || TUTORIAL_ACTORS.some(actor => actor.id === id);

function validRecord(record) {
  if (!plain(record) || !Object.hasOwn(TUTORIAL_LESSONS,record.stepId) || !Number.isInteger(record.elapsedMs) || record.elapsedMs < 0 || record.elapsedMs > 120_000) return false;
  const common=['stepId','kind','elapsedMs'];
  if(record.kind==='timeout'||record.kind==='chat-practice')return keys(record,common);
  if(record.kind==='guide')return keys(record,[...common,'event'],record.event==='quiz-answer'?['value']:[])&&GUIDES.has(record.event)&&(record.event!=='quiz-answer'||typeof record.value==='string'&&record.value.length<=20);
  if(record.kind!=='act'||!keys(record,[...common,'type','fields'])||!plain(record.fields))return false;
  if(record.type==='start')return keys(record.fields,[]);
  if(record.type==='ready')return keys(record.fields,['ready'])&&record.fields.ready===true;
  if(['night_action','nominate'].includes(record.type))return keys(record.fields,['targetId'])&&knownTarget(record.fields.targetId);
  if(record.type==='verdict')return keys(record.fields,['approve'])&&typeof record.fields.approve==='boolean';
  return false;
}

function parseProgress(value) {
  if(!keys(value,['schemaVersion','tutorialId','scenarioId','scenarioVersion','rulesetVersion','decisions']))return {reason:'invalid'};
  if(value.schemaVersion!==MAFIA_TUTORIAL_PROGRESS_VERSION||value.tutorialId!==MAFIA_TUTORIAL_ID||value.scenarioId!==MAFIA_TUTORIAL_SCENARIO_ID||value.scenarioVersion!==MAFIA_TUTORIAL_SCENARIO_VERSION||value.rulesetVersion!==MAFIA_TUTORIAL_RULESET_VERSION)return {reason:'incompatible'};
  if(!Array.isArray(value.decisions)||value.decisions.length>MAX_DECISIONS||!value.decisions.every(validRecord))return {reason:'invalid'};
  try {if(new TextEncoder().encode(JSON.stringify(value)).byteLength>MAX_PROGRESS_BYTES)return {reason:'invalid'};}catch{return {reason:'invalid'};}
  return {progress:clone(value)};
}

/** Local lesson controller. No storage, account, transport, microphone or result writer. */
export function createMafiaTutorial({progress=null}={}) {
  let room,now,stepId,stepStartedAt,journal,flags,feedback,checkpointIndex,checkpointId,running;
  let checkpointRevision=0,disposed=false,restoreStatus='new';
  const listeners=new Set();
  const alive=()=>room.participants.filter(id=>room.roleStates[id]?.alive);
  function actAs(id,type,fields={}) {
    return rules.action(room,id,{type,matchId:room.matchId,phaseId:room.phaseId,...fields},now);
  }
  function boot() {
    now=BASE_TIME;journal=[];flags={};feedback=null;running=false;checkpointIndex=0;checkpointId='welcome';
    const input=actor=>({id:actor.id,name:actor.name,avatar:actor.avatar,tokenHash:`local-only-${actor.id}`});
    room=rules.createRoom('LOCAL_TUTORIAL',{...input(TUTORIAL_ACTORS[0]),settings:{mode:'classic',capacity:8,visibility:'private',voiceMode:'optional',roomName:'أول ليلة في الميدان'}},now);
    for(const actor of TUTORIAL_ACTORS.slice(1))rules.joinRoom(room,input(actor),now);
    for(const actor of TUTORIAL_ACTORS){rules.connected(room,actor.id,true,now);actAs(actor.id,'ready',{ready:actor.id!==HUMAN});}
    stepId='welcome';stepStartedAt=now;
  }
  function finishPhase() {
    if(!Number.isFinite(room.deadlineAt))fail('TUTORIAL_STEP',409);
    now=room.deadlineAt;rules.tick(room,now);
  }
  function dialogue(id) {
    for(const [index,[actor,text]] of (TUTORIAL_DIALOGUE[id]||[]).entries())actAs(actor,'chat',{channel:'public',text,clientId:`tutorial-${id}-${index}`});
  }
  function enter(id) {
    stepId=id;stepStartedAt=now;flags={};feedback=null;running=false;
    checkpointIndex=journal.length;checkpointId=id;
    if(id==='night-1-pick') {
      actAs(DOCTOR,'night_action',{targetId:CITIZENS[0]});
      for(const actor of [MAFIA,MASKER])actAs(actor,'mafia_vote',{targetId:CITIZENS[0]});
    }
    if(id==='night-2-pick') {
      actAs(DOCTOR,'night_action',{targetId:CITIZENS[1]});
      actAs(MASKER,'mafia_vote',{targetId:CITIZENS[2]});
    }
    if(id.startsWith('nomination-')) {
      const first=id==='nomination-1',target=first?MAFIA:MASKER;
      const supporting=first?[DOCTOR,GUARD,CITIZENS[0],CITIZENS[1]]:[DOCTOR,GUARD,CITIZENS[0]];
      for(const actor of alive().filter(actor=>actor!==HUMAN))actAs(actor,'nominate',{targetId:supporting.includes(actor)?target:HUMAN});
    }
    if(id.startsWith('verdict-')&&!id.endsWith('result')) {
      const supporting=id==='verdict-1'?[DOCTOR,GUARD,CITIZENS[0],CITIZENS[1]]:[DOCTOR,GUARD,CITIZENS[0]];
      for(const actor of alive().filter(actor=>actor!==HUMAN))actAs(actor,'verdict',{approve:supporting.includes(actor)});
    }
    dialogue(id);
  }
  function mistake(code,text) {
    running=false;feedback={code,title:'جرّب القرار مرة ثانية',text,canRetry:true,checkpointId};
  }
  function applyAct(type,fields) {
    if(stepId==='lobby-ready'&&type==='ready'&&fields.ready===true){actAs(HUMAN,type,fields);enter('lobby-start');return true;}
    if(stepId==='lobby-start'&&type==='start') {
      rules.action(room,HUMAN,{type:'start',matchId:room.matchId,phaseId:room.phaseId},now,{randomWord:tutorialRandomWord()});
      if(room.rulesetVersion!==MAFIA_TUTORIAL_RULESET_VERSION||TUTORIAL_ACTORS.some(actor=>room.roleStates[actor.id]?.roleId!==actor.roleId))fail('TUTORIAL_RULESET_CHANGED',409);
      enter('role-open');return true;
    }
    if(['night-1-pick','night-2-pick'].includes(stepId)&&type==='night_action'&&fields.targetId!==null) {
      const first=stepId==='night-1-pick',expected=first?MAFIA:MASKER;
      actAs(HUMAN,type,fields);finishPhase();
      if(fields.targetId!==expected)mistake('INVESTIGATION_TARGET',first?'هذه نتيجة اختيارك الفعلية. في هذه الخطوة طلبنا فحص سليم؛ أعد القرار وتحقق من اسمه.':'هذه نتيجة اختيارك الفعلية. ارجع إلى حديث مازن الذي دافع عن سليم بيقين، ثم اختر هدفًا يستند إلى هذه القرينة.');
      else enter(first?'night-1-result':'night-2-result');
      return true;
    }
    if(['nomination-1','nomination-2'].includes(stepId)&&type==='nominate') {
      const first=stepId==='nomination-1',expected=first?MAFIA:MASKER;
      actAs(HUMAN,type,fields);finishPhase();
      if(fields.targetId!==expected)mistake('NOMINATION_TARGET','هذه نتيجة الترشيح الحقيقية بأصوات المجلس. اختيارك لم يتبع تقريرك؛ ارجع إلى القرار وقارن اسم الهدف بالتقرير.');
      else {if(room.phase!=='defense'||room.nomineeId!==expected)fail('TUTORIAL_RULESET_CHANGED',409);enter(first?'defense-1':'defense-2');}
      return true;
    }
    if(['verdict-1','verdict-2'].includes(stepId)&&type==='verdict') {
      const first=stepId==='verdict-1';actAs(HUMAN,type,fields);finishPhase();
      if(!fields.approve)mistake('VERDICT_MAJORITY',first?'ظهرت النتيجة: أربعة من ثمانية، فلم يتحقق أكثر من النصف. بقي المرشح في اللعب. أعد الحكم مستندًا إلى تقريرك.':'ظهرت النتيجة: ثلاثة من ستة، فلم يمر الإقصاء. أعد الحكم؛ نحتاج أربعة أصوات على الأقل.');
      else {if(first?room.phase!=='night'||room.roleStates[MAFIA].alive:room.phase!=='over'||room.outcome?.faction!=='town')fail('TUTORIAL_RULESET_CHANGED',409);enter(first?'verdict-1-result':'ending');}
      return true;
    }
    return false;
  }
  function applyGuide(event,value) {
    if(event==='continue'&&Object.hasOwn(CONTINUE,stepId)) {
      if(stepId.startsWith('night-')&&stepId.endsWith('-result')&&!flags.clues)return false;
      const next=CONTINUE[stepId];
      if(['opening','night-1-result','night-2-result','discussion-1','discussion-2','defense-1','defense-2'].includes(stepId))finishPhase();
      enter(next);return true;
    }
    if(stepId==='role-open'&&event==='role-open'){enter('role-close');return true;}
    if(stepId==='role-close'&&event==='role-close'){finishPhase();enter('opening');return true;}
    if(stepId==='lobby-voice'&&event==='voice-joined'&&!flags.voice){flags.voice=true;return true;}
    if(stepId==='lobby-voice'&&event==='voice-unmuted'&&flags.voice){enter('lobby-ready');return true;}
    if(['night-1-result','night-2-result'].includes(stepId)&&event==='clues-open'&&!flags.clues){flags.clues=true;return true;}
    if(stepId==='encyclopedia'&&event==='encyclopedia-open'&&!flags.encyclopedia){flags.encyclopedia=true;return true;}
    if(stepId==='encyclopedia'&&event==='encyclopedia-close'&&flags.encyclopedia){enter('complete');return true;}
    if(['quiz-majority','quiz-information'].includes(stepId)&&event==='quiz-answer') {
      if(!TUTORIAL_LESSONS[stepId].choices.some(choice=>choice.id===value))return false;
      const majority=stepId==='quiz-majority';
      if(value!==(majority?'four':'dated'))mistake('QUIZ_ANSWER',majority?'أكثر من نصف ستة يعني أربعة، وليس ثلاثة. جرّب الإجابة مرة ثانية.':'التمويه قد يجعل المافيا تظهر من أهل الميدان في التقرير، والتجنيد قد يغير الانتماء لاحقًا.');
      else enter(majority?'quiz-information':'shadow');
      return true;
    }
    return false;
  }
  function applyRecord(record,{replaying=false}={}) {
    if(feedback||disposed||record.stepId!==stepId||!validRecord(record))return false;
    const at=stepStartedAt+record.elapsedMs;
    if(at<now||(!ACTION_STEPS.has(stepId)&&record.elapsedMs!==0)||record.kind!=='timeout'&&room.deadlineAt!=null&&at>=room.deadlineAt)return false;
    if(record.kind==='timeout'&&(!ACTION_STEPS.has(stepId)||at!==room.deadlineAt))return false;
    if(journal.length>=MAX_DECISIONS)return false;
    // The checkpoint is an accepted decision prefix, not a partially patched room.
    // Roll back invalid commands atomically even if a future rule validates late.
    const before={room:clone(room),now,stepId,stepStartedAt,flags:clone(flags),feedback:clone(feedback),checkpointIndex,checkpointId,running,journal:journal.slice()};
    now=at;journal.push(clone(record));
    let accepted=false;
    try {
      if(record.kind==='act')accepted=applyAct(record.type,record.fields);
      if(record.kind==='guide')accepted=applyGuide(record.event,record.value);
      if(record.kind==='chat-practice'&&stepId==='lobby-chat') {
        if(replaying)actAs(HUMAN,'chat',{channel:'public',text:'مرحبًا يا جماعة',clientId:'tutorial-lobby-practice'});
        enter('lobby-voice');accepted=true;
      }
      if(record.kind==='timeout') {finishPhase();mistake('DECISION_TIMEOUT','انتهى وقت القرار بهذه النتيجة. التدريب يسمح لك بإعادة هذه النقطة؛ في المباراة الحقيقية لا يعود الوقت.');accepted=true;}
    } catch(error) {restoreInternal(before);throw error;}
    if(!accepted)restoreInternal(before);
    return accepted;
  }
  function restoreInternal(value) {
    ({room,now,stepId,stepStartedAt,flags,feedback,checkpointIndex,checkpointId,running,journal}=value);
  }
  function record(kind,fields={}) {return {stepId,kind,elapsedMs:now-stepStartedAt,...fields};}
  function notify(){for(const listener of listeners)listener();}
  function exportProgress(){return {schemaVersion:MAFIA_TUTORIAL_PROGRESS_VERSION,tutorialId:MAFIA_TUTORIAL_ID,scenarioId:MAFIA_TUTORIAL_SCENARIO_ID,scenarioVersion:MAFIA_TUTORIAL_SCENARIO_VERSION,rulesetVersion:MAFIA_TUTORIAL_RULESET_VERSION,decisions:clone(journal)};}
  function getState() {
    const view=rules.snapshot(room,HUMAN,now),lesson=TUTORIAL_LESSONS[stepId];
    view.members=view.members.map(actor=>({...actor,trainingBot:actor.id!==HUMAN}));
    const canContinue=ACTION_STEPS.has(stepId)||Object.hasOwn(CONTINUE,stepId)&&(!stepId.startsWith('night-')||!stepId.endsWith('-result')||Boolean(flags.clues));
    return {snapshot:view,clock:{nowMs:now,remainingMs:Number.isFinite(room.deadlineAt)?Math.max(0,room.deadlineAt-now):0,paused:!running||Boolean(feedback)||disposed},coach:{...clone(lesson),stepId,promptKey:stepId,canContinue},checkpointRevision,status:disposed?'disposed':stepId==='complete'?'completed':'active',restoreStatus,feedback:clone(feedback)};
  }
  function replay(decisions) {
    boot();for(const decision of decisions)if(!applyRecord(decision,{replaying:true}))return false;
    running=false;return true;
  }
  boot();
  if(progress!==null) {
    const parsed=parseProgress(progress);
    if(parsed.reason)restoreStatus=parsed.reason;
    else {try {if(!replay(parsed.progress.decisions))throw new Error('Invalid lesson sequence');restoreStatus='restored';checkpointRevision+=1;}catch{boot();restoreStatus='invalid';}}
  }
  return Object.freeze({
    getState,exportProgress,
    subscribe(listener){if(typeof listener!=='function'||disposed)return()=>{};listeners.add(listener);return()=>listeners.delete(listener);},
    async act(type,fields={}) {
      if(disposed||feedback||stepId==='complete')return false;
      if(type==='chat') {
        if(!keys(fields,['text'],['channel','clientId'])||(fields.channel??'public')!=='public')fail('INVALID');
        actAs(HUMAN,'chat',{channel:'public',text:fields.text,clientId:fields.clientId??`tutorial-human-${room.chats.public.length}-${now}`});
        if(stepId==='lobby-chat')applyRecord(record('chat-practice'));
        notify();return true;
      }
      const decision=record('act',{type,fields:clone(fields)});
      if(!validRecord(decision))fail('INVALID');
      const result=applyRecord(decision);if(result)notify();return result;
    },
    guide(event,value) {
      if(disposed||feedback||stepId==='complete')return false;
      if(event==='continue'&&ACTION_STEPS.has(stepId)){running=true;notify();return true;}
      const decision=record('guide',{event,...(value===undefined?{}:{value})});
      if(!validRecord(decision))return false;
      const result=applyRecord(decision);if(result)notify();return result;
    },
    advance(deltaMs) {
      if(disposed||feedback||!running||!ACTION_STEPS.has(stepId))return false;
      if(!Number.isFinite(deltaMs)||deltaMs<0||deltaMs>1000)return false;
      const next=now+Math.floor(deltaMs);
      if(next>=room.deadlineAt) {
        const timeout={stepId,kind:'timeout',elapsedMs:room.deadlineAt-stepStartedAt};
        if(!applyRecord(timeout))return false;
      } else now=next;
      notify();return true;
    },
    retryCheckpoint() {
      if(disposed||!feedback)return false;
      const prefix=journal.slice(0,checkpointIndex),revision=checkpointRevision+1;
      if(!replay(prefix))fail('TUTORIAL_RULESET_CHANGED',409);
      checkpointRevision=revision;notify();return true;
    },
    dispose(){disposed=true;running=false;listeners.clear();},
  });
}

/** Validate semantic decision order as well as the bounded JSON envelope. */
export function validateTutorialProgress(value) {
  const parsed=parseProgress(value);if(!parsed.progress)return null;
  const tutorial=createMafiaTutorial({progress:parsed.progress});
  const valid=tutorial.getState().restoreStatus==='restored'?tutorial.exportProgress():null;
  tutorial.dispose();return valid;
}

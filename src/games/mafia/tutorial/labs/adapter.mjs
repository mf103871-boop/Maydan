import * as rules from '../../rules.mjs';
import {MAFIA_RULESET_VERSION} from '../../../../online/mafia-shared.js';
import {fail} from '../../../../shared/room-primitives.mjs';
import {LAB_HUMAN as HUMAN,LAB_VERSION,LAB_RULESET,MAFIA_LABS,labActors,labRuleset} from './scenarios.mjs';

// Shared semantic labels keep journals and commands identical without repeated literals.
const VERDICT="verdict",NIGHT_ACTION="night_action",NOMINATE="nominate",RECRUIT="recruit",AFTER_CONVERSION="after-conversion",TOWN_LABEL="أهل الميدان",INTRO="intro",NIGHT="night",ABSTAIN="abstain",MAFIA_LABEL="المافيا",CONTINUE="continue",INVESTIGATE_RESULT="investigate-result",MAFIA="mafia",PROTECT="protect",NOMINATE_RESULT="nominate-result",PROTECT_RESULT="protect-result",SHIELD="shield",RECRUIT_RESULT="recruit-result",INVESTIGATE="investigate",BLOCK_RESULT="block-result",MAFIA_VOTE="mafia_vote",NOMINATION="nomination",SELF_RESULT="self-result",MASK_RESULT="mask-result",UNMASKED="unmasked",RESTORED="restored";
const BASE=1_800_000_000_000,clone=value=>structuredClone(value);
const plain=value=>value&&Object.getPrototypeOf(value)===Object.prototype;
const exact=(value,keys)=>plain(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const changed=()=>fail('LAB_RULESET_CHANGED',409);
const STEPS={doctor:[INTRO,'self',SELF_RESULT,PROTECT,PROTECT_RESULT,'repeat','done'],masker:[INTRO,'mask',MASK_RESULT,UNMASKED,'done'],
  blocker:[INTRO,'block',BLOCK_RESULT,SHIELD,'done'],conversion:[INTRO,INVESTIGATE,INVESTIGATE_RESULT,RECRUIT,RECRUIT_RESULT,AFTER_CONVERSION,'done'],
  tracker:[INTRO,'trace','trace-result','trace-quiet','trace-quiet-result','trace-blocked','done'],
  abstention:[INTRO,NOMINATE,NOMINATE_RESULT,VERDICT,'done']};

// No transport, account, storage, wall clock, result writer or microphone.
export function createMafiaLab({courseId,progress=null}={}) {
  const spec=Object.hasOwn(MAFIA_LABS,courseId)?MAFIA_LABS[courseId]:null;
  if(!spec||MAFIA_RULESET_VERSION!==LAB_RULESET)fail('LAB_UNSUPPORTED',409);
  const rulesetVersion=labRuleset(courseId);
  const actors=labActors(courseId),listeners=new Set();let room,now,step,journal,feedback,checkpoint=0,checkpointRevision=0,disposed=false,restoreStatus='new';
  const [doctor,investigator,mafia,guard,leader,civilian,blocker]=['doctor','investigator',MAFIA,'guard','leader','citizen','blocker'].map(role=>actors.find(actor=>actor.roleId===role)?.id);
  const targets={self:HUMAN,protect:investigator,repeat:civilian,mask:mafia,block:doctor,shield:guard,investigate:mafia,[AFTER_CONVERSION]:civilian};
  if(courseId==='tracker')Object.assign(targets,{trace:doctor,'trace-quiet':investigator,'trace-blocked':doctor});
  // [round, attack target, protection target, optional NPC ability actor/target].
  const nights={self:[1,HUMAN],protect:[2,investigator],repeat:[3,civilian],mask:[1,civilian,civilian,investigator,mafia],
    unmasked:[2,investigator,investigator,investigator,mafia],block:[1,civilian,civilian],shield:[1,guard,civilian],
    investigate:[1,civilian,civilian],recruit:[2,HUMAN,HUMAN,leader,HUMAN],[AFTER_CONVERSION]:[3,civilian,civilian]};
  if(courseId==='tracker')Object.assign(nights,{trace:[1,civilian,civilian],'trace-quiet':[2,investigator,investigator],'trace-blocked':[1,civilian,civilian,blocker,HUMAN]});
  const isChoice=()=>Object.hasOwn(targets,step)||[RECRUIT,NOMINATE,VERDICT].includes(step);
  const action=(id,type,fields={})=>rules.action(room,id,{type,matchId:room.matchId,phaseId:room.phaseId,...fields},now);
  const settle=()=>{if(!Number.isFinite(room.deadlineAt))changed();now=room.deadlineAt;rules.tick(room,now);};
  const until=(phase,round=1)=>{for(let guard=0;(room.phase!==phase||room.round!==round)&&guard<80;guard++)settle();if(room.phase!==phase||room.round!==round)changed();};
  function bootRoom(second=false) {
    now=BASE+(second?600_000:0);const input=actor=>({id:actor.id,name:actor.name,avatar:actor.avatar,tokenHash:`local-${actor.id}`});
    room=rules.createRoom('LOCAL_SPECIALTY',{...input(actors[0]),settings:{mode:actors.length===9?'shadow':'classic',capacity:actors.length,visibility:'private',voiceMode:'off',roomName:Array.from(spec.title).slice(0,30).join(''),...(rulesetVersion===2?{experimentalRole:'tracker'}:{})}},now);
    for(const actor of actors.slice(1))rules.joinRoom(room,input(actor),now);
    for(const actor of actors){rules.connected(room,actor.id,true,now);action(actor.id,'ready',{ready:true});}
    let index=0;rules.action(room,HUMAN,{type:'start',matchId:room.matchId,phaseId:room.phaseId},now,{randomWord:()=>{if(index>=spec.words.length)changed();return spec.words[index++];}});
    if(actors.some(actor=>room.roleStates[actor.id]?.roleId!==actor.roleId))changed();
  }
  function botNight(attack,protect) {
    if(protect)action(doctor,NIGHT_ACTION,{targetId:protect});
    if(attack)for(const actor of actors.filter(a=>a.id!==HUMAN&&room.roleStates[a.id].alive&&room.roleStates[a.id].faction===MAFIA))action(actor.id,MAFIA_VOTE,{targetId:attack});
  }
  function enter(next) {
    step=next;feedback=null;checkpoint=journal.length;
    if(step===SHIELD){bootRoom(true);checkpointRevision++;}
    if(step==='trace-blocked'){bootRoom(true);checkpointRevision++;}
    const plan=nights[step];if(plan){until(NIGHT,plan[0]);botNight(plan[1],plan[2]);if(plan[3])action(plan[3],NIGHT_ACTION,{targetId:plan[4]});if(step===UNMASKED)settle();}
    if(step===NOMINATE){
      until(NOMINATION);const bots=actors.slice(1);for(let i=0;i<bots.length;i++)action(bots[i].id,NOMINATE,{targetId:i<3?mafia:i<6?investigator:null});
    }
    if(step===VERDICT){
      until(NOMINATION,2);for(const actor of actors.slice(1))action(actor.id,NOMINATE,{targetId:mafia});
      settle();if(room.phase!=='defense')changed();settle();
      for(const [i,actor]of actors.slice(1).entries())action(actor.id,VERDICT,{approve:i<4});
    }
  }
  function boot(){journal=[];feedback=null;bootRoom();enter(INTRO);}
  const mistake=(code,text)=>{feedback={code,title:'نتيجة قرارك الفعلية',text,canRetry:true};};
  const name=id=>actors.find(actor=>actor.id===id)?.name||'شخصية التدريب';
  function teacher() {
    const texts={
      intro:spec.description+' كل الشخصيات محلية. القرارات هنا لا تمنح XP أو إتقانًا.',
      self:'المافيا التدريبية تستهدفك. اختر حماية نفسك؛ هذه فرصتك الوحيدة لحماية النفس.',
      [SELF_RESULT]:'نجحت الحماية. استُهلكت حماية النفس، ولم تتغير وظيفتك.',
      protect:`المافيا تستهدف ${name(investigator)}. حمايتك السابقة كانت لنفسك؛ اختر الهدف الجديد.`,
      [PROTECT_RESULT]:'حميت الهدف الجديد. في الليلة التالية لا يمكنك حمايته مرة ثانية متتالية.',
      repeat:`الهدف الآن ${name(civilian)}. جرّب القيد ثم اختر الهدف المسموح. حماية النفس المستهلكة لا تعود.`,
      mask:`محقق التدريب سيفحص ${name(mafia)}. اختر أداة التمويه ثم هذا الحليف. الطبيب يحمي هدف الهجوم التجريبي.`,
      [MASK_RESULT]:`نتيجة تعليمية من محقق التدريب: قرأ «${room.privateEvents[investigator]?.at(-1)?.faction==='town'?TOWN_LABEL:MAFIA_LABEL}». هذا ليس تقريرك في مباراة حقيقية. التمويه لم يغير فصيل الحليف.`,
      unmasked:`في الليلة الثانية قرأ محقق التدريب «${room.privateEvents[investigator]?.at(-1)?.faction===MAFIA?MAFIA_LABEL:TOWN_LABEL}» للهدف نفسه. الأثر لليلة واحدة والشحنة لا تتجدد.`,
      block:`الطبيب يحمي ${name(civilian)} والمافيا تستهدفه. اختر التعطيل ثم الطبيب لتختبر الفعل النشط.`,
      [BLOCK_RESULT]:'حُجبت الحماية فوقع الهجوم فعلًا. التجربة التالية مجلس تدريبي جديد يعيد الشحنة لشرح الدرع.',
      shield:'تجربة مستقلة: الهجوم يستهدف الحارس والطبيب يحمي شخصًا آخر. عطّل الحارس وشاهد هل يوقف ذلك درعه.',
      investigate:`افحص ${name(mafia)} مرة. لاحظ الشحنة المتبقية قبل تغير الفريق.`,
      [INVESTIGATE_RESULT]:'بقيت شحنة واحدة. في الليلة الثانية سيحاول قائد التدريب تجنيدك والطبيب يحميك.',
      recruit:'اترك التحقيق هذه الليلة بزر «أمتنع». لن نرسل فعلًا نيابة عنك؛ يحسم المحرك التجنيد الحقيقي.',
      [RECRUIT_RESULT]:'افتح بطاقتك: أصبحت مع الظل، وبقي اختصاص المحقق وشحنته. صرت تفوز مع فريقك الجديد.',
      [AFTER_CONVERSION]:`جرّب التحقيق الآن على ${name(civilian)}. تبدل الفريق لا يمنح شحنة جديدة ولا يمحو القدرة الباقية.`,
      trace:`الطبيب التدريبي اختار ${name(civilian)} للحماية. تتبّع الطبيب؛ التقرير سيذكر الوجهة وحدها، دون اسم قدرته أو فريقه.`,
      'trace-result':`وردت وجهة الاختيار ${name(civilian)}. أنت تعرفها من إعداد الدرس؛ في مباراة حقيقية لا يثبت ذلك أن الهدف طبيب أو أن فعله نجح.`,
      'trace-quiet':`المحقق التدريبي لا يختار قدرة هذه الليلة، مع وجود حماية واردة إليه. تتبّعه ولاحظ أن التتبع يرصد اختياراته الصادرة فقط.`,
      'trace-quiet-result':'لم تُرصد وجهة. النتيجة نفسها قد تعني الامتناع أو التعطيل؛ ليست دليلًا على فريق الهدف. استُهلكت الشحنتان؛ نفتح مجلسًا تدريبيًا جديدًا لشرح التعطيل.',
      'trace-blocked':'تجربة مستقلة برصيد جديد: المعطّل يستهدفك. اختر تتبّع الطبيب؛ سيحسم المحرك الحجب ويستهلك الشحنة المثبتة.',
      nominate:'أصوات التدريب متعادلة بين هدفين. اختر «أمتنع» دون تسمية لاعب؛ لاحظ حسم التعادل.',
      [NOMINATE_RESULT]:'بقي الترشيح متعادلًا فلم يوجد مرشح للدفاع. الآن نجرب الامتناع عن الحكم في يوم جديد.',
      verdict:'أربعة من ثمانية يؤيدون الإقصاء. اختر «أمتنع»: نترك تصويتك غائبًا حتى الإغلاق، ولا نرسله كرفض.',
      done:courseId==='blocker'?'بقي الحارس حيًا واستهلك درعه؛ التعطيل لا يلغي الدرع السلبي. أنهيت التمرين المحلي.':courseId==='tracker'?'حُجب تقريرك واستهلكت شحنة واحدة من المجلس الجديد. المتعقّب دور تجريبي؛ لا تكشف الوجهة نوع القدرة أو الانتماء. أنهيت التمرين المحلي.':'أنهيت التمرين المحلي. نتيجة التعلم لا تدخل مبارياتك أو مكافآتك.',
    };
    const choice=isChoice();
    return {stepId:step,title:step===INTRO?spec.title:'جرّب وتحقق',text:texts[step],target:choice?'actions':'coach',mode:choice?'action':'guide',
      canContinue:!feedback,event:choice?([RECRUIT,VERDICT].includes(step)?ABSTAIN:undefined):step==='done'?undefined:CONTINUE,
      buttonLabel:[RECRUIT,VERDICT].includes(step)?'أمتنع':step===INTRO?'ابدأ التجربة':'تابع'};
  }
  function expected(type,fields) {
    if(step===NOMINATE)return type===NOMINATE&&fields.targetId===null;
    if(step===RECRUIT||step===VERDICT)return type===ABSTAIN;
    return type===NIGHT_ACTION&&fields.targetId===targets[step];
  }
  function validRecord(record) {
    if(!exact(record,['step','type','fields'])||!STEPS[courseId].includes(record.step)||!plain(record.fields))return false;
    if([CONTINUE,ABSTAIN].includes(record.type))return exact(record.fields,[]);
    if([NIGHT_ACTION,MAFIA_VOTE,NOMINATE].includes(record.type))return exact(record.fields,['targetId'])&&(record.fields.targetId===null||actors.some(actor=>actor.id===record.fields.targetId));
    return record.type===VERDICT&&exact(record.fields,['approve'])&&typeof record.fields.approve==='boolean';
  }
  function apply(record) {
    if(disposed||feedback||step==='done'||record.step!==step||!validRecord(record))return false;
    const stages=STEPS[courseId],index=stages.indexOf(step);
    if(record.type===CONTINUE){
      if(isChoice())return false;
      journal.push(clone(record));enter(stages[index+1]);return true;
    }
    if(!isChoice()
      ||record.type===ABSTAIN&&![RECRUIT,VERDICT].includes(step))return false;
    const before=clone(room),beforeNow=now,beforeStep=step,beforeJournal=journal.slice(),beforeCheckpoint=checkpoint,beforeRevision=checkpointRevision;
    try {
      if(record.type!==ABSTAIN)action(HUMAN,record.type,record.fields);
      settle();journal.push(clone(record));
      if(!expected(record.type,record.fields)){
        const result=step==='mask'?` قرأ محقق التدريب «${room.privateEvents[investigator]?.at(-1)?.faction===MAFIA?MAFIA_LABEL:TOWN_LABEL}» للهدف المطلوب.`:step===VERDICT?' سُجّل اختيارك كصوت؛ الامتناع يترك الحكم بلا صوت منك.':'';
        mistake('WRONG_DECISION','حُسم ما اخترته فعلًا.'+result+' ارجع لنقطة القرار واتبع تعليمات الشخصيات المحلية.');return true;
      }
      if(step==='mask'&&room.privateEvents[investigator]?.at(-1)?.faction!=='town')changed();
      if(step==='trace'&&!room.privateEvents[HUMAN]?.at(-1)?.destinationIds?.includes(civilian))changed();
      if(step==='trace-quiet'&&room.privateEvents[HUMAN]?.at(-1)?.destinationIds?.length!==0)changed();
      if(step==='trace-blocked'&&(room.privateEvents[HUMAN]?.at(-1)?.type!=='no_result'||room.roleStates[HUMAN].resources.charges!==1))changed();
      if(step===SHIELD&&(!room.roleStates[guard].alive||room.roleStates[guard].resources.shield!==0))changed();
      if(step===RECRUIT&&(room.roleStates[HUMAN].faction!=='shadow'||room.roleStates[HUMAN].resources.charges!==1))changed();
      if(step===VERDICT&&(room.history.filter(event=>event.type==='verdict_closed').at(-1)?.passed!==false||Object.hasOwn(room.verdictVotes,HUMAN)))changed();
      enter(stages[index+1]);return true;
    } catch(error) {
      room=before;now=beforeNow;step=beforeStep;journal=beforeJournal;checkpoint=beforeCheckpoint;checkpointRevision=beforeRevision;
      if(!['TARGET','ABILITY_UNAVAILABLE'].includes(error.code))throw error;
      journal.push(clone(record));mistake(error.code,'رفض المحرك هذا الهدف أو القدرة فعلًا. راجع الشحنة والهدف السابق، ثم أعد نقطة القرار.');return true;
    }
  }
  const notify=()=>{for(const listener of listeners)listener();};
  const exported=()=>({schemaVersion:1,courseId,courseVersion:LAB_VERSION,rulesetVersion,decisions:clone(journal)});
  function replay(value){boot();for(const record of value.decisions)if(!apply(record))return false;return true;}
  boot();
  if(progress!==null){
    if(!exact(progress,['schemaVersion','courseId','courseVersion','rulesetVersion','decisions'])||progress.schemaVersion!==1||progress.courseId!==courseId
      ||!Array.isArray(progress.decisions)||progress.decisions.length>64||JSON.stringify(progress).length>16384)restoreStatus='invalid';
    else if(progress.courseVersion!==LAB_VERSION||progress.rulesetVersion!==rulesetVersion)restoreStatus='incompatible';
    else try{if(!replay(progress))throw Error();restoreStatus=RESTORED;}catch{boot();restoreStatus='invalid';}
  }
  return Object.freeze({
    getState(){const snapshot=rules.snapshot(room,HUMAN,now);snapshot.members=snapshot.members.map(member=>({...member,trainingBot:member.id!==HUMAN}));
      return {snapshot,clock:{nowMs:now,remainingMs:Math.max(0,(room.deadlineAt||now)-now),paused:true},coach:teacher(),feedback:clone(feedback),
        checkpointRevision,status:disposed?'disposed':step==='done'?'completed':'active',restoreStatus};},
    exportProgress:exported,
    subscribe(listener){if(disposed||typeof listener!=='function')return()=>{};listeners.add(listener);return()=>listeners.delete(listener);},
    async act(type,fields={}){if(disposed||feedback||step==='done')return false;
      if(type==='chat'){if(!exact(fields,['channel','text'])&&!exact(fields,['channel','text','clientId']))fail('INVALID',400);action(HUMAN,type,fields);notify();return true;}
      const record={step,type,fields:clone(fields)};if(!validRecord(record))fail('INVALID',400);const accepted=apply(record);if(accepted)notify();return accepted;},
    guide(event){if(disposed||feedback||step==='done')return false;if(['role-open','role-close','clues-open','encyclopedia-open','encyclopedia-close'].includes(event))return true;
      if(![CONTINUE,ABSTAIN].includes(event))return false;const accepted=apply({step,type:event,fields:{}});if(accepted)notify();return accepted;},
    // Short exercises are untimed; an explicit choice closes the real phase.
    advance(){return false;},
    retryCheckpoint(){if(disposed||!feedback)return false;const prefix=journal.slice(0,checkpoint),revision=checkpointRevision+1;if(!replay({...exported(),decisions:prefix}))changed();checkpointRevision=revision;notify();return true;},
    dispose(){disposed=true;listeners.clear();},
  });
}
export function validateMafiaLabProgress(value){try{const lab=createMafiaLab({courseId:value?.courseId,progress:value});const result=lab.getState().restoreStatus===RESTORED?lab.exportProgress():null;lab.dispose();return result;}catch{return null;}}

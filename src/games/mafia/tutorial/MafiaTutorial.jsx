import { tr, getUiLocale, localeDirection } from '../../../shared/i18n/core.js';
import React, { useEffect, useRef, useState } from 'react';
import { MafiaLobby, MafiaMatchView, MafiaRules, MafiaPrivacy, useMafiaPrivacy } from '../../../online/Mafia.jsx';
import { Button, Modal } from '../../../shared/ui/components.jsx';
import { useVisualViewport } from '../../../shared/ui/useVisualViewport.js';
import { navigate, setExitGuard } from '../../../platform/router.js';
import { useLamma } from '../../../social/LammaProvider.jsx';
import { createMafiaTutorial } from './adapter.mjs';
import { TUTORIAL_HUMAN_ID } from './scenario.mjs';
import { useTutorialProgress } from './useTutorialProgress.js';
import css from './tutorial.css';
import shellCss from '../../../online/online-mafia.css';
import { usePlatform } from '../../../platform/context.js';
import { useI18n } from '../../../shared/i18n/react.jsx';
import { localizeTutorialView } from './localize.js';

const goRooms = () => navigate('/online/mafia',{replace:true});
let acceptedTrainingSound = 0;
export function TutorialSession({ owner, progress, update, mark, isCurrentOwner=()=>true, designPreview=false,
  factory=createMafiaTutorial,humanId=TUTORIAL_HUMAN_ID,title=tr("أول ليلة في الميدان"),disclosure=tr("تدريب محلي · ٧ شخصيات تدريب · بلا لاعبين حقيقيين"),finishTarget='/online/mafia',finishLabel=tr("ادخل الغرف"),privateCover=false }) {
  const platform = usePlatform();
  const { locale } = useI18n();
  const [engine] = useState(()=>factory({progress}));
  const [rawView,setView] = useState(()=>engine.getState());
  const view = localizeTutorialView(rawView,humanId,locale,title);
  const [voiceJoined,setVoiceJoined] = useState(false), [muted,setMuted] = useState(true);
  const [exitTarget,setExitTarget] = useState(null), [saveFailed,setSaveFailed] = useState(false);
  const [minimized,setMinimized] = useState(false);
  const covered = useMafiaPrivacy(privateCover);
  const frame=useRef(null), live=useRef(true), latest=useRef({update,mark,isCurrentOwner}); latest.current={update,mark,isCurrentOwner};
  const persisted=useRef(''), completed=useRef(false);
  useVisualViewport(frame,{heightProperty:'--mafia-visible-height',topProperty:'--mafia-visible-top'});
  useEffect(()=>{
    live.current=true;
    const refresh=()=>{if(live.current)setView(engine.getState());};
    const unsubscribe=engine.subscribe(refresh); refresh();
    let then=performance.now();
    const timer=setInterval(()=>{const now=performance.now(),elapsed=Math.min(1000,now-then);then=now;if(!document.hidden&&!document.querySelector('[role="dialog"], [aria-modal="true"]'))engine.advance(elapsed);},250);
    if(!designPreview)setExitGuard(target=>{setExitTarget(target);return true;});
    return()=>{live.current=false;clearInterval(timer);unsubscribe?.();engine.dispose();if(!designPreview)setExitGuard(null);};
  },[engine,designPreview]);
  useEffect(()=>{
    if(designPreview)return;
    const progress=engine.exportProgress(),fingerprint=JSON.stringify(progress);
    if(fingerprint!==persisted.current){persisted.current=fingerprint;setSaveFailed(!latest.current.update({status:view.status==='completed'?'completed':'in-progress',progress},owner));}
    if(view.status==='completed'&&!completed.current){completed.current=true;latest.current.mark('completed',owner);}
  },[view,engine,owner,designPreview]);
  useEffect(()=>{setMinimized(false);},[view.coach?.stepId]);
  const trainingFeedback=(before,accepted,quiz=false)=>{
    if(accepted!==true||designPreview||covered||!live.current||!latest.current.isCurrentOwner(owner))return;
    const after=engine.getState(),revision=after.checkpointRevision;
    // Phase changes already have a Mafia audio owner. Replays/restores never
    // enter this user-action path, and retry remounts the phase owner silently.
    const type=after.feedback?'ui.error':quiz?'game.correct':before.snapshot.phaseId===after.snapshot.phaseId?'ui.confirm':null;
    if(type)platform?.sound?.emit?.(type,{id:`training-action:${++acceptedTrainingSound}`,
      guard:()=>live.current&&!document.hidden&&latest.current.isCurrentOwner(owner)&&engine.getState().checkpointRevision===revision});
  };
  const guide=(event,value)=>{
    if(!live.current)return false;
    const before=engine.getState(),accepted=engine.guide(event,value);
    // Navigation/role opening already have their own tap cue. Only submitted
    // quiz answers are acknowledged here, after the lesson accepts them.
    if(event==='quiz-answer')trainingFeedback(before,accepted,true);
    return accepted;
  };
  const act=async(type,fields)=>{
    if(!live.current)return false;
    const before=engine.getState(),accepted=await engine.act(type,fields);
    trainingFeedback(before,accepted);return accepted;
  };
  act.audioAccepted=true;
  const state=view.snapshot;
  const me=state.members.find(player=>player.id===humanId);
  const quiet=state.phase==='night'&&state.you?.voice?.canListen===false;
  const voice={simulated:true,status:voiceJoined?'connected':'off',requested:voiceJoined,muted,mediaEpoch:state.mafiaVoice?.mediaEpoch,canPublish:!quiet,participants:[],
    onJoin:()=>{setVoiceJoined(true);setMuted(true);guide('voice-joined');},
    onLeave:()=>{setVoiceJoined(false);setMuted(true);guide('voice-left');},
    onMute:value=>{setMuted(value);guide(value?'voice-muted':'voice-unmuted');}};
  const coach=view.coach || {};
  const finishExit=(target,skip=false)=>{if(!live.current||!latest.current.isCurrentOwner(owner))return;if(designPreview){setExitTarget(null);return;}if(skip&&!latest.current.mark('skipped',owner))return;setExitGuard(null);navigate(target||'/online/mafia',{replace:true});};
  return <section ref={frame} data-design-screen="mafia.tutorial" className="mafia-noir mafia-room-shell mafia-tutorial-screen" dir={localeDirection(getUiLocale())} aria-label={covered?tr("التدريب محجوب"):tr("{v0} — تدريب محلي", {v0: title})}>
    <style>{shellCss}{css}</style>
    {covered?<MafiaPrivacy/>:<>
    <header className="mafia-tutorial-top"><span className="mafia-training-badge">{tr("تدريب")}</span><div><strong>{title}</strong><small data-design-id="tutorial-disclosure" data-design-required="true">{disclosure}</small></div><Button data-design-id="tutorial-exit" data-design-required="true" onClick={()=>setExitTarget(finishTarget)}>{tr("لاحقًا")}</Button></header>
    <aside data-design-id="tutorial-coach" data-design-required="true" className={`mafia-tutorial-coach ${minimized?'is-minimized':''}`} aria-live="polite" data-lesson-step={coach.stepId}>
      <div className="mafia-tutorial-coach-title"><h2>{coach.title || tr("تعلّم من قرارك")}</h2><Button data-design-id="tutorial-help-toggle" aria-expanded={!minimized} aria-label={minimized?tr("إظهار الشرح"):tr("تصغير الشرح")} onClick={()=>setMinimized(value=>!value)}>{minimized?tr("الشرح"):'−'}</Button></div>
      {!minimized&&<><p>{coach.text}</p>{view.feedback && <div className="mafia-tutorial-feedback" role="status"><b>{view.feedback.title}</b><p>{view.feedback.text}</p></div>}
        <div className="mafia-tutorial-coach-actions">
          {view.feedback?.canRetry && <Button data-design-id="tutorial-retry" onClick={()=>engine.retryCheckpoint()}>{tr("أعد نقطة القرار")}</Button>}
          {!view.feedback?.canRetry && coach.choices?.map(choice=><Button data-design-id="tutorial-answer" key={choice.id} onClick={()=>guide('quiz-answer',choice.id)}>{choice.label}</Button>)}
          {!view.feedback?.canRetry && coach.event && <Button data-design-id="tutorial-continue" disabled={coach.canContinue===false} onClick={()=>guide(coach.event)}>{coach.buttonLabel || tr("تابع")}</Button>}
          {coach.stepId==='encyclopedia'&&<MafiaRules onGuide={guide}/>}
          {view.status==='completed'&&<Button data-design-id="tutorial-finish" onClick={()=>finishExit(finishTarget)}>{finishLabel}</Button>}
        </div>{view.clock.paused && <small>{tr("وقت التدريب متوقف حتى تنهي الشرح أو الحركة المطلوبة.")}</small>}</>}
    </aside>
    {saveFailed&&<p className="mafia-tutorial-storage-warning" role="status">{tr("تعذّر الحفظ على هذا الجهاز. يمكنك متابعة الدرس؛ قد لا يعود تقدمك بعد إغلاقه.")}</p>}
    <div className="mafia-tutorial-stage" data-training-target={coach.target} key={`${owner}:${view.checkpointRevision}`}>
      {state.phase==='lobby'?<MafiaLobby state={state} me={me} isHost act={act} voice={voice} accountId={owner} tutorial={{onGuide:guide}}/>:<MafiaMatchView state={state} me={me} isHost act={act} disabled={view.status==='completed'} accountId={owner} voice={voice} sound={designPreview?undefined:platform?.sound} clock={view.clock} tutorial={{onGuide:guide}}/>}
    </div>
    {exitTarget&&<Modal className="mafia-noir mafia-paper-dialog mafia-tutorial-exit" placement="bottom" data-design-screen="mafia.tutorial" title={tr("تكمل التدريب لاحقًا؟")} onClose={()=>setExitTarget(null)} footer={<><Button data-design-id="tutorial-save-exit" full onClick={()=>finishExit(exitTarget,true)}>{tr("احفظ واخرج")}</Button><Button data-design-id="tutorial-stay" full variant="ghost" onClick={()=>setExitTarget(null)}>{tr("أكمل التدريب")}</Button></>}><p>{tr("تبقى نقطة قرارك على هذا الجهاز، وتقدر تستكملها من دليل مافيا. لا تُحسب نتيجة هذا الدرس ضمن لعبك.")}</p></Modal>}
    </>}
  </section>;
}

export function MafiaTutorial() {
  const context=useTutorialProgress();
  const lamma=useLamma();
  const [choice,setChoice]=useState({owner:null,mode:null});
  useEffect(()=>{if(context.owner&&context.record&&choice.owner!==context.owner)setChoice({owner:context.owner,mode:context.record.progress&&context.record.status!=='completed'?'prompt':'new'});},[context.owner,context.record,choice.owner]);
  if(!context.owner||!context.record)return <div role="status">{tr("نجهّز التدريب…")}</div>;
  if(lamma?.activeCall?.scope==='mafia')return <div className="stack"><p>{tr("أكمل مجلسك الحالي أولًا. التدريب لا يقطع مكالمة مافيا القائمة.")}</p><Button onClick={goRooms}>{tr("إلى المجلس")}</Button></div>;
  const selected=choice.owner===context.owner?choice.mode:null;
  if(!selected)return <div role="status">{tr("نجهّز التدريب…")}</div>;
  if(selected==='prompt')return <section data-design-screen="mafia.tutorial" className="mafia-noir mafia-tutorial-resume" dir={localeDirection(getUiLocale())}><style>{css}</style><h1>{tr("أول ليلة في الميدان")}</h1><p data-design-id="tutorial-disclosure" data-design-required="true">{tr("تدريب محلي مع ٧ شخصيات تدريب، دون لاعبين حقيقيين.")}</p><p>{tr("عندك تدريب محفوظ على هذا الجهاز.")}</p><Button data-design-id="tutorial-resume" onClick={()=>setChoice({owner:context.owner,mode:'resume'})}>{tr("استكمل من آخر قرار")}</Button><Button data-design-id="tutorial-restart" onClick={()=>setChoice({owner:context.owner,mode:'new'})}>{tr("ابدأ من جديد")}</Button><Button data-design-id="tutorial-exit" data-design-required="true" onClick={()=>{context.mark('skipped');goRooms();}}>{tr("لاحقًا")}</Button></section>;
  return <TutorialSession key={context.owner} owner={context.owner} progress={selected==='new'?null:context.record.progress} update={context.update} mark={context.mark} isCurrentOwner={context.isCurrentOwner}/>;
}

// The real local view in Studio, with decisions only in memory.
export function MafiaTutorialPreview(){return <TutorialSession owner="studio-tutorial-preview" progress={null} update={()=>true} mark={()=>true} designPreview/>;}

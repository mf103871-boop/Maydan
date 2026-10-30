import React, { useEffect, useRef, useState } from 'react';
import { MafiaLobby, MafiaMatchView, MafiaRules, MafiaPrivacy } from '../../../online/Mafia.jsx';
import { Button, Modal } from '../../../shared/ui/components.jsx';
import { useVisualViewport } from '../../../shared/ui/useVisualViewport.js';
import { navigate, setExitGuard } from '../../../platform/router.js';
import { useLamma } from '../../../social/LammaProvider.jsx';
import { createMafiaTutorial } from './adapter.mjs';
import { TUTORIAL_HUMAN_ID } from './scenario.mjs';
import { useTutorialProgress } from './useTutorialProgress.js';
import css from './tutorial.css';
import shellCss from '../../../online/online-mafia.css';

const goRooms = () => navigate('/online/mafia',{replace:true});
export function TutorialSession({ owner, progress, update, mark, isCurrentOwner=()=>true, designPreview=false,
  factory=createMafiaTutorial,humanId=TUTORIAL_HUMAN_ID,title='أول ليلة في الميدان',disclosure='تدريب محلي · ٧ شخصيات تدريب · بلا لاعبين حقيقيين',finishTarget='/online/mafia',finishLabel='ادخل الغرف',privateCover=false }) {
  const [engine] = useState(()=>factory({progress}));
  const [view,setView] = useState(()=>engine.getState());
  const [voiceJoined,setVoiceJoined] = useState(false), [muted,setMuted] = useState(true);
  const [exitTarget,setExitTarget] = useState(null), [saveFailed,setSaveFailed] = useState(false);
  const [minimized,setMinimized] = useState(false);
  const [covered,setCovered] = useState(()=>privateCover&&typeof document!=='undefined'&&document.hidden);
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
  useEffect(()=>{if(!privateCover)return;const cover=()=>setCovered(document.hidden);document.addEventListener('visibilitychange',cover);return()=>document.removeEventListener('visibilitychange',cover);},[privateCover]);
  const guide=(event,value)=>{if(live.current)return engine.guide(event,value);return false;};
  const act=(type,fields)=>live.current?engine.act(type,fields):Promise.resolve(false);
  const state=view.snapshot;
  const me=state.members.find(player=>player.id===humanId);
  const quiet=state.phase==='night'&&state.you?.voice?.canListen===false;
  const voice={simulated:true,status:voiceJoined?'connected':'off',requested:voiceJoined,muted,mediaEpoch:state.mafiaVoice?.mediaEpoch,canPublish:!quiet,participants:[],
    onJoin:()=>{setVoiceJoined(true);setMuted(true);guide('voice-joined');},
    onLeave:()=>{setVoiceJoined(false);setMuted(true);guide('voice-left');},
    onMute:value=>{setMuted(value);guide(value?'voice-muted':'voice-unmuted');}};
  const coach=view.coach || {};
  const finishExit=(target,skip=false)=>{if(!live.current||!latest.current.isCurrentOwner(owner))return;if(designPreview){setExitTarget(null);return;}if(skip&&!latest.current.mark('skipped',owner))return;setExitGuard(null);navigate(target||'/online/mafia',{replace:true});};
  return <section ref={frame} data-design-screen="mafia.tutorial" className="mafia-noir mafia-room-shell mafia-tutorial-screen" dir="rtl" aria-label={covered?'التدريب محجوب':`${title} — تدريب محلي`}>
    <style>{shellCss}{css}</style>
    {covered?<MafiaPrivacy/>:<>
    <header className="mafia-tutorial-top"><div><strong>{title}</strong><small data-design-id="tutorial-disclosure" data-design-required="true">{disclosure}</small></div><Button data-design-id="tutorial-exit" data-design-required="true" onClick={()=>setExitTarget(finishTarget)}>لاحقًا</Button></header>
    <aside data-design-id="tutorial-coach" data-design-required="true" className={`mafia-tutorial-coach ${minimized?'is-minimized':''}`} aria-live="polite" data-lesson-step={coach.stepId}>
      <div className="mafia-tutorial-coach-title"><h2>{coach.title || 'تعلّم من قرارك'}</h2><Button data-design-id="tutorial-help-toggle" aria-expanded={!minimized} aria-label={minimized?'إظهار الشرح':'تصغير الشرح'} onClick={()=>setMinimized(value=>!value)}>{minimized?'الشرح':'−'}</Button></div>
      {!minimized&&<><p>{coach.text}</p>{view.feedback && <div className="mafia-tutorial-feedback" role="status"><b>{view.feedback.title}</b><p>{view.feedback.text}</p></div>}
        <div className="mafia-tutorial-coach-actions">
          {view.feedback?.canRetry && <Button data-design-id="tutorial-retry" onClick={()=>engine.retryCheckpoint()}>أعد نقطة القرار</Button>}
          {!view.feedback?.canRetry && coach.choices?.map(choice=><Button data-design-id="tutorial-answer" key={choice.id} onClick={()=>guide('quiz-answer',choice.id)}>{choice.label}</Button>)}
          {!view.feedback?.canRetry && coach.event && <Button data-design-id="tutorial-continue" disabled={coach.canContinue===false} onClick={()=>guide(coach.event)}>{coach.buttonLabel || 'تابع'}</Button>}
          {coach.stepId==='encyclopedia'&&<MafiaRules onGuide={guide}/>}
          {view.status==='completed'&&<Button data-design-id="tutorial-finish" onClick={()=>finishExit(finishTarget)}>{finishLabel}</Button>}
        </div>{view.clock.paused && <small>وقت التدريب متوقف حتى تنهي الشرح أو الحركة المطلوبة.</small>}</>}
    </aside>
    {saveFailed&&<p className="mafia-tutorial-storage-warning" role="status">تعذّر الحفظ على هذا الجهاز. يمكنك متابعة الدرس؛ قد لا يعود تقدمك بعد إغلاقه.</p>}
    <div className="mafia-tutorial-stage" data-training-target={coach.target} key={`${owner}:${view.checkpointRevision}`}>
      {state.phase==='lobby'?<MafiaLobby state={state} me={me} isHost act={act} voice={voice} tutorial={{onGuide:guide}}/>:<MafiaMatchView state={state} me={me} isHost act={act} disabled={view.status==='completed'} accountId={owner} voice={voice} clock={view.clock} tutorial={{onGuide:guide}}/>}
    </div>
    {exitTarget&&<Modal className="mafia-noir" data-design-screen="mafia.tutorial" title="تكمل التدريب لاحقًا؟" onClose={()=>setExitTarget(null)} footer={<><Button data-design-id="tutorial-save-exit" full onClick={()=>finishExit(exitTarget,true)}>احفظ واخرج</Button><Button data-design-id="tutorial-stay" full variant="ghost" onClick={()=>setExitTarget(null)}>أكمل التدريب</Button></>}><p>تبقى نقطة قرارك على هذا الجهاز، وتقدر تستكملها من دليل مافيا. لا تُحسب نتيجة هذا الدرس ضمن لعبك.</p></Modal>}
    </>}
  </section>;
}

export function MafiaTutorial() {
  const context=useTutorialProgress();
  const lamma=useLamma();
  const [choice,setChoice]=useState({owner:null,mode:null});
  useEffect(()=>{if(context.owner&&context.record&&choice.owner!==context.owner)setChoice({owner:context.owner,mode:context.record.progress&&context.record.status!=='completed'?'prompt':'new'});},[context.owner,context.record,choice.owner]);
  if(!context.owner||!context.record)return <div role="status">نجهّز التدريب…</div>;
  if(lamma?.activeCall?.scope==='mafia')return <div className="stack"><p>أكمل مجلسك الحالي أولًا. التدريب لا يقطع مكالمة مافيا القائمة.</p><Button onClick={goRooms}>إلى المجلس</Button></div>;
  const selected=choice.owner===context.owner?choice.mode:null;
  if(!selected)return <div role="status">نجهّز التدريب…</div>;
  if(selected==='prompt')return <section data-design-screen="mafia.tutorial" className="mafia-noir mafia-tutorial-resume" dir="rtl"><style>{css}</style><h1>أول ليلة في الميدان</h1><p data-design-id="tutorial-disclosure" data-design-required="true">تدريب محلي مع ٧ شخصيات تدريب، دون لاعبين حقيقيين.</p><p>عندك تدريب محفوظ على هذا الجهاز.</p><Button data-design-id="tutorial-resume" onClick={()=>setChoice({owner:context.owner,mode:'resume'})}>استكمل من آخر قرار</Button><Button data-design-id="tutorial-restart" onClick={()=>setChoice({owner:context.owner,mode:'new'})}>ابدأ من جديد</Button><Button data-design-id="tutorial-exit" data-design-required="true" onClick={()=>{context.mark('skipped');goRooms();}}>لاحقًا</Button></section>;
  return <TutorialSession key={context.owner} owner={context.owner} progress={selected==='new'?null:context.record.progress} update={context.update} mark={context.mark} isCurrentOwner={context.isCurrentOwner}/>;
}

// The real local view in Studio, with decisions only in memory.
export function MafiaTutorialPreview(){return <TutorialSession owner="studio-tutorial-preview" progress={null} update={()=>true} mark={()=>true} designPreview/>;}

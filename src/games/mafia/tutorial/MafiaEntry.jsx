import React, { useEffect, useRef } from 'react';
import { Online } from '../../../online/Online.jsx';
import { readSaved } from '../../../online/client.js';
import { useLamma } from '../../../social/LammaProvider.jsx';
import { navigate } from '../../../platform/router.js';
import { Button } from '../../../shared/ui/components.jsx';
import { useTutorialProgress } from './useTutorialProgress.js';
import { hasOwnedRoomRestore, shouldStartTutorial } from './progress.js';

export function MafiaEntry() {
  const state=useTutorialProgress({loadStatus:true});
  const lamma=useLamma();
  const chosen=useRef(null);
  const hasRestore=hasOwnedRoomRestore(name=>readSaved(state.server,name),state.account.user?.id) || lamma?.activeCall?.scope==='mafia';
  const start=shouldStartTutorial({normalEntry:true,ready:state.checked&&state.autoStartVerified,hasRestore,record:state.record});
  useEffect(()=>{
    if(!start||!state.owner||chosen.current===state.owner)return;
    chosen.current=state.owner;
    navigate('/tutorial/mafia',{replace:true});
  },[start,state.owner]);
  if(!state.checked||!state.record||start)return <div className="stack center" role="status">نجهّز دخول المجلس…</div>;
  const onTutorial=()=>navigate('/tutorial/mafia');
  return <>{!hasRestore && (state.record.progress||state.record.outdated||state.record.invalid) && <aside className="mafia-tutorial-return"><p>{state.record.outdated ? 'تحدّث درس مافيا. ابدأ النسخة الجديدة عندما يناسبك.' : state.record.invalid ? 'تعذّر استعادة التدريب المحفوظ؛ يمكنك بدء الدرس من جديد.' : 'تقدر تكمل تدريبك من آخر قرار.'}</p><Button onClick={onTutorial}>{state.record.progress?'استكمل التدريب':'افتح التدريب'}</Button></aside>}<Online game="mafia" onTutorial={hasRestore?undefined:onTutorial}/></>;
}

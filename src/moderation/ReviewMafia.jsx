import React, { useEffect, useRef, useState } from 'react';
import { useAccount } from '../shared/account/context.js';
import { reviewMafiaPath } from './client.js';
import { mafiaReportCategoryLabel } from '../online/mafia-report-shared.js';

const channelLabel={public:'المجلس العام',team:'القناة الخاصة المصرح بها للمبلّغ',observers:'قناة المقصيين',unknown:'قناة محفوظة قديمًا'};
export function ReviewMafia({ path }) {
  const account=useAccount(),owner=account.ready&&account.signedIn?account.user?.id:null,valid=reviewMafiaPath(path);
  const [opened,setOpened]=useState(false),[state,setState]=useState(null),[retry,setRetry]=useState(0);
  const latest=useRef({owner,request:account.requestAuthenticated});latest.current={owner,request:account.requestAuthenticated};
  useEffect(()=>{
    if(!owner||!valid||!opened)return undefined;
    let current=true;const controller=new AbortController();setState(null);
    latest.current.request(valid,{signal:controller.signal}).then(evidence=>{if(current&&latest.current.owner===owner)setState({owner,path:valid,evidence});},()=>{if(current&&latest.current.owner===owner)setState({owner,path:valid,error:true});});
    return()=>{current=false;controller.abort();};
  },[owner,valid,opened,retry]);
  if(!owner||!valid)return null;
  const shown=state?.owner===owner&&state?.path===valid?state:null;
  return <div className="stack moderation-evidence"><button type="button" className="btn btn-secondary" onClick={()=>setOpened(value=>!value)}>{opened?'إخفاء دليل مافيا':'عرض دليل مافيا المخوّل'}</button>
    {opened&&(shown?.evidence?<><h3>{mafiaReportCategoryLabel(shown.evidence.category)}</h3><p>المجلس <bdi>{shown.evidence.roomCode}</bdi> · المباراة {shown.evidence.matchId}</p>
      <p>منظور المبلّغ: {shown.evidence.perspective.scope==='observer'?'مشاهد بدليل متأخر ثلاثين ثانية':shown.evidence.perspective.scope==='player'?'مشارك في المباراة':'دليل قديم بلا وصف منظور'}</p>
      <details><summary>مرجع المباراة</summary><bdi>{shown.evidence.matchKey}</bdi></details>
      {shown.evidence.messages.length?shown.evidence.messages.map((message,index)=><blockquote key={message.id+index} dir="auto"><small>{channelLabel[message.channel]||channelLabel.unknown} · المقعد <bdi>{message.playerId}</bdi></small><p>{message.text}</p></blockquote>):<p>لا توجد رسالة نصية مرفقة بهذا البلاغ؛ راجع وصف المبلّغ.</p>}</>:shown?.error?<p role="alert">لم يعد الدليل متاحًا أو تغيّرت صلاحية المراجعة. <button type="button" onClick={()=>setRetry(value=>value+1)}>إعادة التحقق</button></p>:<p role="status">نحمّل الدليل المصرّح به…</p>)}
  </div>;
}

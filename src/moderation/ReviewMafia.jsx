import { tr } from '../shared/i18n/core.js';
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
  return <div className="stack moderation-evidence"><button type="button" className="btn btn-secondary" onClick={()=>setOpened(value=>!value)}>{opened?tr("إخفاء دليل مافيا"):tr("عرض دليل مافيا المخوّل")}</button>
    {opened&&(shown?.evidence?<><h3>{mafiaReportCategoryLabel(shown.evidence.category)}</h3><p>{tr("المجلس ")}<bdi>{shown.evidence.roomCode}</bdi>{tr(" · المباراة ")}{shown.evidence.matchId}</p>
      <p>{tr("منظور المبلّغ: ")}{shown.evidence.perspective.scope==='observer'?tr("مشاهد بدليل متأخر ثلاثين ثانية"):shown.evidence.perspective.scope==='player'?tr("مشارك في المباراة"):tr("دليل قديم بلا وصف منظور")}</p>
      <details><summary>{tr("مرجع المباراة")}</summary><bdi>{shown.evidence.matchKey}</bdi></details>
      {shown.evidence.messages.length?shown.evidence.messages.map((message,index)=><blockquote key={message.id+index} dir="auto"><small>{channelLabel[message.channel]||channelLabel.unknown}{tr(" · المقعد ")}<bdi>{message.playerId}</bdi></small><p>{message.text}</p></blockquote>):<p>{tr("لا توجد رسالة نصية مرفقة بهذا البلاغ؛ راجع وصف المبلّغ.")}</p>}</>:shown?.error?<p role="alert">{tr("لم يعد الدليل متاحًا أو تغيّرت صلاحية المراجعة. ")}<button type="button" onClick={()=>setRetry(value=>value+1)}>{tr("إعادة التحقق")}</button></p>:<p role="status">{tr("نحمّل الدليل المصرّح به…")}</p>)}
  </div>;
}

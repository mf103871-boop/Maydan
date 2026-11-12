import { PresentationStyles } from '../shared/ui/PresentationStyles.jsx';
import { uiDirection, uiDateLocale } from './format.js';
import { tr } from '../shared/i18n/core.js';
import React, { useEffect, useRef, useState } from 'react';
import { Modal, Button } from '../shared/ui/components.jsx';
import { useAccount } from '../shared/account/context.js';
import { SUPPORT_EMAIL } from '../shared/account/config.js';
import { mafiaReportCategoryLabel, MAFIA_REPORT_STATUS_LABELS } from './mafia-report-shared.js';
import css from './mafia.css?sheet';

export function MafiaReportInbox({ onClose }) {
  const account=useAccount(),owner=account.ready&&account.signedIn?account.user?.id:null;
  const latest=useRef({owner,request:account.requestAuthenticated});latest.current={owner,request:account.requestAuthenticated};
  const [state,setState]=useState({owner:null,reports:[],loading:false,error:false,nextBefore:null});
  const [refresh,setRefresh]=useState(0),[before,setBefore]=useState(null);
  useEffect(()=>{
    if(!owner)return undefined;
    let current=true;const controller=new AbortController();
    setState(value=>({owner,reports:before&&value.owner===owner?value.reports:[],loading:true,error:false,nextBefore:null}));
    latest.current.request('/api/me/mafia/reports'+(before?`?before=${before}`:''),{signal:controller.signal}).then(result=>{
      if(!current||latest.current.owner!==owner)return;
      setState(value=>({owner,reports:before?[...value.reports,...result.reports.filter(row=>!value.reports.some(old=>old.id===row.id))]:result.reports,loading:false,error:false,nextBefore:result.nextBefore}));
    }).catch(()=>{if(current&&latest.current.owner===owner)setState(value=>({...value,owner,loading:false,error:true}));});
    return()=>{current=false;controller.abort();};
  },[owner,refresh,before]);
  if(!owner)return null;
  const shown=state.owner===owner?state:{reports:[],loading:true,error:false,nextBefore:null};
  return <Modal className="mafia-noir mafia-guide-dialog mafia-history-dialog" title={tr("بلاغاتي في مافيا")} onClose={onClose}><PresentationStyles sheet={css}/><div className="stack" dir={uiDirection()}>
    <p>{tr("تابع حالة البلاغ الذي أرسلته. يراجع فريق الإشراف السياق قبل اتخاذ القرار.")}</p>
    <Button disabled={shown.loading} onClick={()=>{setBefore(null);setRefresh(value=>value+1);}}>{tr("تحديث البلاغات")}</Button>
    {shown.loading&&<p role="status">{tr("نحمّل البلاغات…")}</p>}{shown.error&&<p role="alert">{tr("تعذّر تحميل بلاغاتك. تحقق من الاتصال ثم أعد المحاولة.")}</p>}
    {!shown.loading&&!shown.error&&!shown.reports.length&&<p>{tr("لم ترسل بلاغات مافيا بعد.")}</p>}
    {shown.reports.map(report=><article className="stack" style={{padding:14,borderRadius:14,background:'var(--m-panel)',border:'1px solid var(--m-border)',color:'var(--m-ink)'}} key={report.id}><h3>{tr(mafiaReportCategoryLabel(report.category))}</h3><strong>{tr(MAFIA_REPORT_STATUS_LABELS[report.status])||tr("بانتظار المراجعة")}</strong>
      <p>{tr("المجلس ")}<bdi>{report.roomCode}</bdi>{Number.isSafeInteger(report.matchId)?tr(" · المباراة {v0}", {v0: report.matchId}):''}</p><small>{new Date(report.createdAt).toLocaleString(uiDateLocale())}</small><details><summary>{tr("مرجع البلاغ")}</summary><bdi style={{overflowWrap:'anywhere'}}>{report.id}</bdi></details></article>)}
    {shown.nextBefore&&<Button disabled={shown.loading} onClick={()=>setBefore(shown.nextBefore)}>{tr("بلاغات أقدم")}</Button>}
    <p>{tr("للاعتراض على قرار يخص حسابك، ")}<a style={{color:'var(--m-gold)'}} href={`mailto:${SUPPORT_EMAIL}`}>{tr("تواصل مع دعم ميدان")}</a>{tr(". يُعالج الاعتراض عبر وسيلة الدعم الحالية.")}</p>
  </div></Modal>;
}

import React, { useEffect, useRef, useState } from 'react';
import { useAccount } from '../shared/account/context.js';
import { getMafiaReward } from '../profiles/mafia-client.js';
import { arabicNumber } from './shared.js';
import { MAFIA_ROLES } from './mafia-shared.js';
import { Button } from '../shared/ui/components.jsx';

const exclusionText = reason => ({
  forfeited: 'الانسحاب لا يمنح خبرة أو إتقانًا لهذه المباراة.',
  private_daily_cap: 'اكتملت منح المشاركة الثلاث للغرف الخاصة في يوم هذه النتيجة.',
  legacy: 'نتيجة تاريخية محفوظة دون خبرة أو إتقان جديد.',
}[reason] || 'هذه النتيجة لا تمنح تقدمًا جديدًا.');
export function validMafiaReward(value, matchKey) {
  return value?.status==='processed'&&value.matchKey===matchKey&&Number.isSafeInteger(value.xpAwarded)
    &&value.xpAwarded>=0&&value.xpAwarded<=70&&typeof value.participationGranted==='boolean'
    &&Number.isSafeInteger(value.finishedAt)&&value.finishedAt>0&&Object.hasOwn(MAFIA_ROLES,value.roleId);
}

// Read-only UI. Opening/reopening this panel never submits a result or grant.
export function MafiaRewardSummary({ server, accountId, receipt, clockOffset=0, loadReward=getMafiaReward }) {
  const account=useAccount(),auth=account.authHeaders?.()||{},authRef=useRef(auth),ownerRef=useRef(null),session=useRef({identity:null,epoch:0});
  const identity=[account.user?.id||'',Boolean(account.ready),Boolean(account.signedIn),auth.Authorization||auth.authorization||''].join('\u0000');
  if(session.current.identity!==identity)session.current={identity,epoch:session.current.epoch+1};
  const epoch=session.current.epoch;
  authRef.current=auth;ownerRef.current={id:account.user?.id,ready:account.ready,signedIn:account.signedIn,epoch};
  const key=`${accountId||''}:${receipt?.matchKey||''}:${epoch}`;
  const enabled=Boolean(account.ready&&account.signedIn&&server&&accountId&&account.user?.id===accountId&&receipt?.matchKey&&Number.isSafeInteger(receipt.notBefore));
  const [record,setRecord]=useState(null),[refresh,setRefresh]=useState(0),generation=useRef(0);
  const shown=record?.key===key?record:null;
  useEffect(()=>{
    const request=++generation.current,controller=new AbortController();let timer,attempts=0;
    const current=()=>!controller.signal.aborted&&request===generation.current&&ownerRef.current.id===accountId
      &&ownerRef.current.ready&&ownerRef.current.signedIn&&ownerRef.current.epoch===epoch;
    if(!enabled)return()=>controller.abort();
    setRecord({key,status:'pending'});
    const read=async()=>{
      if(!current())return;
      try {
        const value=await loadReward(server,authRef.current,receipt.matchKey,{signal:controller.signal});
        if(!current())return;
        const now=Date.now()+clockOffset;
        if(validMafiaReward(value,receipt.matchKey)&&now>=receipt.notBefore&&now>=value.finishedAt+30000) {
          setRecord({key,status:'processed',data:value});return;
        }
        if(value?.status!=='pending')throw new Error('INVALID_REWARD');
        setRecord({key,status:'pending'});
        if(++attempts<6)timer=setTimeout(read,Math.min(30000,2000*2**(attempts-1)));
      }catch(error){if(current()&&error?.code!=='ABORTED')setRecord({key,status:'error'});}
    };
    timer=setTimeout(read,Math.max(0,receipt.notBefore-(Date.now()+clockOffset)));
    return()=>{controller.abort();clearTimeout(timer);};
  },[enabled,key,epoch,accountId,server,receipt?.matchKey,receipt?.notBefore,clockOffset,loadReward,refresh]);
  if(!enabled)return null;
  const reward=shown?.data;
  return <section className="mafia-reward-summary" aria-label="مكافأة المباراة" aria-live="polite">
    <h3>رحلتك في مافيا</h3>
    {shown?.status==='processed'?<>
      <strong className="mafia-reward-xp">{reward.xpAwarded>0?`+${arabicNumber(reward.xpAwarded)} خبرة`:'دون خبرة إضافية'}</strong>
      <p>{reward.participationGranted?`إكمال مؤهل لإتقان دور ${MAFIA_ROLES[reward.roleId].name}.`:exclusionText(reward.exclusionReason)}</p>
      {!!reward.achievements?.length&&<ul aria-label="إنجازات هذه المباراة">{reward.achievements.map(item=><li key={item.id||item.achievementId}>{item.label||item.title||'إنجاز مافيا مكتسب'}</li>)}</ul>}
      {!!reward.grants?.length&&<p>أُضيفت مقتنيات مكتسبة إلى مظهرك؛ تقدر تجهيزها من المتجر.</p>}
    </>:<>
      <p role={shown?.status==='error'?'alert':'status'}>{shown?.status==='error'?'تعذّر تحديث المكافأة. تقدر المحاولة مجددًا.':'نجهّز مكافأتك… ستظهر هنا بعد قليل.'}</p>
      <Button variant="ghost" onClick={()=>setRefresh(value=>value+1)}>تحديث المكافأة</Button>
    </>}
  </section>;
}

import { PresentationStyles } from '../shared/ui/PresentationStyles.jsx';
import { uiDirection, localizeAuthored } from './format.js';
import { arabicNumber as ar } from './format.js';
import { tr } from '../shared/i18n/core.js';
import React, { useEffect, useRef, useState } from 'react';
import { Modal, Button } from '../shared/ui/components.jsx';
import { useAccount } from '../shared/account/context.js';
import { MAFIA_ALL_ROLES as MAFIA_ROLES } from './mafia-shared.js';
import { mafiaEventText } from './Mafia.jsx';

import css from './mafia.css?sheet';

const faction=id=>({town:tr("المدينة"),mafia:tr("المافيا"),shadow:tr("الرابطة"),draw:tr("تعادل")}[id]||'');
const seat=value=>tr("المقعد {v0}", {v0: ar(value)});
export function MafiaReviewDialog({matchKey,onClose}) {
  const account=useAccount(),owner=account.ready&&account.signedIn?account.user?.id:null;
  const headers=account.authHeaders?.()||{},authorization=headers.Authorization||headers.authorization||'';
  const identity=useRef({owner:null,authorization:null,epoch:0});
  if(identity.current.owner!==owner||identity.current.authorization!==authorization)identity.current={owner,authorization,epoch:identity.current.epoch+1};
  const epoch=identity.current.epoch,scope=JSON.stringify([owner,matchKey,epoch]);
  const latest=useRef();latest.current=account.requestAuthenticated;
  const [state,setState]=useState({scope:null,data:null,error:false,loading:true}),[retry,setRetry]=useState(0);
  useEffect(()=>{
    if(!owner)return undefined;
    let active=true;const controller=new AbortController();setState({scope,data:null,error:false,loading:true});
    const current=()=>active&&!controller.signal.aborted&&identity.current.epoch===epoch;
    latest.current('/api/mafia/history/'+encodeURIComponent(matchKey),{signal:controller.signal}).then(data=>{
      if(current())setState({scope,data,error:false,loading:false});
    }).catch(()=>{if(current())setState({scope,data:null,error:true,loading:false});});
    return()=>{active=false;controller.abort();};
  },[owner,matchKey,epoch,scope,retry]);
  if(!owner)return null;
  const shown=state.scope===scope?state:{data:null,error:false,loading:true},review=shown.data?.available?shown.data:null;
  const members=review?.players.map(player=>({id:player.seat,name:seat(player.seat)}))||[];
  const eventText=event=>mafiaEventText({...event,playerId:event.actorSeat,targetId:event.targetSeat,targetIds:event.targetSeats,destinationIds:event.destinationSeats,
    recruiterId:event.recruiterSeat,nomineeId:event.nomineeSeat,votes:Object.fromEntries((event.votes||[]).map(vote=>[vote.seat,vote.approve]))},members);
  return <Modal className="mafia-noir mafia-history-dialog mafia-paper-dialog" title={tr("مراجعة المباراة")} onClose={onClose}><PresentationStyles sheet={css}/><div className="mafia-history stack" dir={uiDirection()}>
    <p>{tr("راجع أدوار المقاعد وأحداث المباراة المكتملة. تتاح المراجعة للمشاركين خلال ")}{ar(30)}{tr(" يومًا.")}</p>
    {shown.loading&&<p role="status">{tr("نحمّل المراجعة…")}</p>}
    {shown.error&&<><p role="alert">{tr("تعذّر تحميل المراجعة. تحقق من الاتصال ثم حاول مجددًا.")}</p><Button onClick={()=>setRetry(value=>value+1)}>{tr("إعادة المحاولة")}</Button></>}
    {!shown.loading&&!shown.error&&!review&&<p>{tr("المراجعة غير متاحة الآن. قد تكون النتيجة قيد التجهيز أو انتهت مدة حفظ السجل.")}</p>}
    {review&&<><h3>{review.outcome==='draw'?tr("تعادل"):tr("فوز {v0}", {v0: faction(review.outcome)})}</h3><div className="mafia-history-stats">{review.players.map(player=><article key={player.seat}><strong>{seat(player.seat)} · {localizeAuthored(MAFIA_ROLES[player.roleId])?.name||tr("دور")}</strong><span>{faction(player.initialFaction)}{player.initialFaction!==player.faction?` ← ${faction(player.faction)}`:''}</span><small>{player.forfeited?tr("انسحاب"):review.outcome==='draw'?tr("تعادل"):player.won?tr("فوز الفريق"):tr("خسارة الفريق")}</small></article>)}</div>
      <h3>{tr("تسلسل الأحداث")}</h3>{review.earlierEventsOmitted>0&&<p>{tr("نعرض آخر ")}{ar(review.events.length)}{tr(" حدثًا من هذه المباراة.")}</p>}
      <ol className="stack">{review.events.map((event,index)=><li key={index}><small>{tr("الجولة ")}{ar(event.round)} · {ar(event.elapsedSeconds)}{tr(" ث")}</small><p>{eventText(event)}</p>
        {event.votes&&<p>{event.votes.length?event.votes.map(vote=>`${seat(vote.seat)}: ${vote.approve?tr("موافقة"):tr("رفض")}`).join('، '):tr("لم تُسجل أصوات.")}</p>}</li>)}</ol>
    </>}
  </div></Modal>;
}

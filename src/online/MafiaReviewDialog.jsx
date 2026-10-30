import React, { useEffect, useRef, useState } from 'react';
import { Modal, Button } from '../shared/ui/components.jsx';
import { useAccount } from '../shared/account/context.js';
import { MAFIA_ALL_ROLES as MAFIA_ROLES } from './mafia-shared.js';
import { mafiaEventText } from './Mafia.jsx';
import { arabicNumber as ar } from './shared.js';
import css from './mafia.css';

const faction=id=>({town:'المدينة',mafia:'المافيا',shadow:'الرابطة',draw:'تعادل'}[id]||'');
const seat=value=>`المقعد ${ar(value)}`;
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
  return <Modal className="mafia-noir mafia-history-dialog" title="مراجعة المباراة" onClose={onClose}><style>{css}</style><div className="mafia-history stack" dir="rtl">
    <p>راجع أدوار المقاعد وأحداث المباراة المكتملة. تتاح المراجعة للمشاركين خلال {ar(30)} يومًا.</p>
    {shown.loading&&<p role="status">نحمّل المراجعة…</p>}
    {shown.error&&<><p role="alert">تعذّر تحميل المراجعة. تحقق من الاتصال ثم حاول مجددًا.</p><Button onClick={()=>setRetry(value=>value+1)}>إعادة المحاولة</Button></>}
    {!shown.loading&&!shown.error&&!review&&<p>المراجعة غير متاحة الآن. قد تكون النتيجة قيد التجهيز أو انتهت مدة حفظ السجل.</p>}
    {review&&<><h3>{review.outcome==='draw'?'تعادل':`فوز ${faction(review.outcome)}`}</h3><div className="mafia-history-stats">{review.players.map(player=><article key={player.seat}><strong>{seat(player.seat)} · {MAFIA_ROLES[player.roleId]?.name||'دور'}</strong><span>{faction(player.initialFaction)}{player.initialFaction!==player.faction?` ← ${faction(player.faction)}`:''}</span><small>{player.forfeited?'انسحاب':review.outcome==='draw'?'تعادل':player.won?'فوز الفريق':'خسارة الفريق'}</small></article>)}</div>
      <h3>تسلسل الأحداث</h3>{review.earlierEventsOmitted>0&&<p>نعرض آخر {ar(review.events.length)} حدثًا من هذه المباراة.</p>}
      <ol className="stack">{review.events.map((event,index)=><li key={index}><small>الجولة {ar(event.round)} · {ar(event.elapsedSeconds)} ث</small><p>{eventText(event)}</p>
        {event.votes&&<p>{event.votes.length?event.votes.map(vote=>`${seat(vote.seat)}: ${vote.approve?'موافقة':'رفض'}`).join('، '):'لم تُسجل أصوات.'}</p>}</li>)}</ol>
    </>}
  </div></Modal>;
}

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Button } from '../shared/ui/components.jsx';
import { useAccount } from '../shared/account/context.js';
import { ProfileAvatar } from '../profiles/ProfileAvatar.jsx';
import { useProfiles } from '../profiles/ProfileProvider.jsx';
import { navigate, registerBackLayer } from '../platform/router.js';
import { arabicNumber, errorText } from './shared.js';
import css from './online-directory.css';

const footerReservations=new WeakMap();
function footerReservation(root) {
  let state=footerReservations.get(root);
  if(!state){state={previous:root.style.getPropertyValue('--online-directory-footer-space'),priority:root.style.getPropertyPriority('--online-directory-footer-space'),owners:new Map()};footerReservations.set(root,state);}
  const owner={};
  const apply=()=>root.style.setProperty('--online-directory-footer-space',`${Math.max(0,...state.owners.values())}px`);
  return {update(value){state.owners.set(owner,value);apply();},release(){state.owners.delete(owner);if(state.owners.size)apply();else{if(state.previous)root.style.setProperty('--online-directory-footer-space',state.previous,state.priority);else root.style.removeProperty('--online-directory-footer-space');footerReservations.delete(root);}}};
}

export function OnlineDirectoryProfile() {
  const account=useAccount(),profiles=useProfiles();
  const user=account.user&&(profiles?.mine?.id===account.user.id?profiles.mine:account.user);
  return <footer data-design-id="profile-footer" className="online-directory-profile"><button data-design-id="profile" type="button" onClick={()=>navigate(user?'/profile':'/settings')} aria-label={user?'فتح بروفايلي':'تسجيل الدخول'}>
    <ProfileAvatar user={user||{}} size={48}/><span><b>{user?.name||'ضيف ميدان'}</b><small>{user?'بروفايلي':'سجّل الدخول للغرف العامة'}</small></span><span className="online-directory-profile-arrow" aria-hidden="true">‹</span>
  </button></footer>;
}

// Per-game adapters supply admission/observation decisions. This shell never
// infers a permission from a room count, a badge or the selected appearance.
export function OnlineRoomRow({room,title,subtitle,statusLabel,voiceLabel,canJoin=false,canObserve=false,disabled=false,onJoin,onObserve}) {
  const action=canJoin?onJoin:canObserve?onObserve:null;
  const Content=action?'button':'div';
  return <article data-design-id="room" className="online-directory-row" data-room-code={room.code} data-room-status={room.status||'waiting'}>
    <Content className="online-directory-row-content" type={action?'button':undefined} data-design-id={action?(canJoin?'room-join':'room-observe'):undefined} aria-label={action?`${canJoin?'الانضمام إلى':'مشاهدة'} ${title||room.roomName}`:undefined} disabled={action?disabled:undefined} onClick={action?()=>action(room.code):undefined}>
    <div className="online-directory-row-copy"><b>{title||room.roomName}</b><div className="online-directory-row-meta"><span>{statusLabel}</span>{voiceLabel&&<span>{voiceLabel}</span>}{subtitle&&<span>{subtitle}</span>}</div></div>
    <div className="online-directory-row-side"><bdi className={room.full?'is-full':''}>{arabicNumber(room.players)} / {arabicNumber(room.capacity)}</bdi>
      {action?<span className="online-directory-row-label">{canJoin?'انضم':'شاهد'}</span>:<small>{room.full?'مكتملة':'غير متاحة'}</small>}
    </div>
    </Content>
  </article>;
}

export function OnlineDirectoryView({game,title='الغرف العامة',rooms=[],renderRoom,loading=false,error='',notice,emptyText='لا غرف متاحة الآن. أنشئ غرفتك أو ادخل برمز.',onCreate,onCode,onRefresh,onQuickJoin,disabled=false,createDisabled=false,enabled,filters,help,footer,hasPrevious=false,nextCursor,onPrevious,onNext,children}) {
  const [panel,setPanel]=useState('');
  const viewRef=useRef(null),footerRef=useRef(null);
  useEffect(()=>panel?registerBackLayer(()=>setPanel('')):undefined,[panel]);
  useLayoutEffect(()=>{
    const view=viewRef.current,footer=footerRef.current;
    if(!view||typeof window==='undefined')return undefined;
    const viewport=window.visualViewport,reservation=footerReservation(document.documentElement);let frame=null,active=true;
    const update=()=>{frame=null;if(!active||Math.abs((viewport?.scale??1)-1)>.001)return;const top=viewport?.offsetTop||0,height=viewport?.height||window.innerHeight;
      const available=Math.max(180,height-Math.max(0,view.getBoundingClientRect().top-top)-8);
      const value=`${Math.round(available)}px`;if(view.style.getPropertyValue('--directory-pane-height')!==value)view.style.setProperty('--directory-pane-height',value);
      const rect=footer?.getBoundingClientRect();reservation.update(rect&&rect.height>0&&rect.top<top+height&&rect.bottom>top?Math.max(0,Math.ceil(top+height-Math.max(top,rect.top))):0);
    };
    const schedule=()=>{if(active&&frame===null)frame=requestAnimationFrame(update);};
    const observer=typeof ResizeObserver==='undefined'?null:new ResizeObserver(schedule);observer?.observe(view);if(footer)observer?.observe(footer);
    window.addEventListener('resize',schedule);window.addEventListener('scroll',schedule,{passive:true});view.addEventListener('animationend',schedule);viewport?.addEventListener('resize',schedule);viewport?.addEventListener('scroll',schedule);update();
    return()=>{active=false;if(frame!==null)cancelAnimationFrame(frame);observer?.disconnect();window.removeEventListener('resize',schedule);window.removeEventListener('scroll',schedule);view.removeEventListener('animationend',schedule);viewport?.removeEventListener('resize',schedule);viewport?.removeEventListener('scroll',schedule);reservation.release();};
  },[]);
  return <section ref={viewRef} className={`online-directory-view online-directory-${game||'all'}`} data-design-screen={`online.${game||'all'}.directory`}>
    <style>{css}</style>
    <div data-design-id="toolbar" className="online-directory-toolbar" aria-label={title}>
      {onCreate&&<Button size="sm" aria-label="إنشاء غرفة جديدة" data-design-id="create-public-room" disabled={disabled||createDisabled} onClick={onCreate}>+ إنشاء</Button>}
      {onCode&&<Button size="sm" data-design-id="entry-join" disabled={disabled} onClick={onCode}>دخول برمز</Button>}
      {onQuickJoin&&<Button size="sm" aria-label="انضمام سريع إلى غرفة متاحة" data-design-id="quick-join" variant="primary" disabled={disabled||enabled!==true||loading} onClick={onQuickJoin}>سريع</Button>}
      <Button size="sm" data-design-id="refresh" variant="ghost" aria-label="تحديث الغرف" disabled={disabled||loading} onClick={onRefresh}>↻</Button>
      {(filters||help)&&<Button data-design-id="directory-options" size="sm" variant="ghost" aria-label="خيارات الغرف والمساعدة" aria-expanded={Boolean(panel)} onClick={()=>setPanel(value=>value?'':'options')}>⋯</Button>}
    </div>
    {panel&&<div className="online-directory-options"><div className="online-directory-option-tabs">{filters&&<Button data-design-id="directory-filter" size="sm" onClick={()=>setPanel('filters')}>تصفية الغرف</Button>}{help&&<Button data-design-id="directory-help" size="sm" onClick={()=>setPanel('help')}>المساعدة والمزيد</Button>}<Button data-design-id="directory-options-close" size="sm" aria-label="إغلاق خيارات الغرف" variant="ghost" onClick={()=>setPanel('')}>×</Button></div>{panel==='help'?help:filters}</div>}
    {notice&&<div data-design-id="notice" className="online-directory-notice" role="status">{notice}</div>}
    {error&&<p className="online-directory-notice error" role="alert">{errorText(error)}</p>}
    {enabled===false&&!error&&<p className="online-directory-notice" role="status">دليل الغرف غير متاح حاليًا. يمكنك استخدام الرمز للغرف القائمة.</p>}
    <div data-design-id="rooms" className="online-directory-list" aria-label={title} aria-busy={loading}>
      {loading&&rooms.length===0&&<p data-design-id="loading" className="online-directory-empty" role="status">نحمّل الغرف المتاحة…</p>}
      {!loading&&enabled===true&&!rooms.length&&!error&&<p data-design-id="empty" className="online-directory-empty">{emptyText}</p>}
      {rooms.map(room=><React.Fragment key={room.code}>{renderRoom(room)}</React.Fragment>)}
    </div>
    {(hasPrevious||nextCursor)&&<nav className="online-directory-pages" aria-label="صفحات الغرف"><Button size="sm" data-design-id="directory-previous" disabled={disabled||loading||!hasPrevious} onClick={onPrevious}>السابق</Button><Button size="sm" data-design-id="directory-next" disabled={disabled||loading||!nextCursor} onClick={onNext}>التالي</Button></nav>}
    {children}
    <div ref={footerRef} className="online-directory-footer-slot">{footer===undefined?<OnlineDirectoryProfile/>:footer}</div>
  </section>;
}

export function OnlineLobbyFrame({game,children,footer}) {
  return <section data-design-screen="online.lobby" className={`stack online-lobby-frame online-lobby-${game}`}><style>{css}</style><div className="online-lobby-body">{children}</div>{footer&&<footer className="online-lobby-controls">{footer}</footer>}</section>;
}

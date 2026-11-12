import { tr, getUiLocale, localeDirection } from '../shared/i18n/core.js';
import React,{useEffect,useRef,useState,useSyncExternalStore} from 'react';
import {resolveAccountServer} from '../shared/account/api.js';
import {MAFIA_ROLES} from '../online/mafia-shared.js';
import {MafiaProgressClient,mafiaProgressScope} from './mafia-client.js';
import {MAFIA_ACHIEVEMENT_LIST} from './mafia-catalog.js';
import {getCosmetic} from '../plus/catalog.js';
import css from './mafia-panel.css?sheet';
import { PresentationStyles } from '../shared/ui/PresentationStyles.jsx';

const number=value=>Number.isFinite(value)?Math.max(0,value).toLocaleString(getUiLocale()):'—';
const roleName=id=>tr(MAFIA_ROLES[id]?.name||"دور غير متاح");
const messages={CONFLICT:'تغيّرت إعداداتك على جهاز آخر. أعد التحميل وراجع اختياراتك قبل حفظها.',
  MAFIA_SOCIAL_LOCKED:'يمكنك تعديل الظهور والدور الممثل بعد انتهاء مباراة مافيا أو المشاهدة.',
  MAFIA_ROLE_LOCKED:'هذا الدور لم يُفتح للعرض بعد. اختر دورًا مؤهلًا أو ألغِ الاختيار.',
  STALE:'وصلت بيانات قديمة. أعد التحميل للحصول على الحالة الحالية.',AUTH_REQUIRED:'سجّل الدخول لعرض تقدمك.',
  AUTH_EXPIRED:'انتهت الجلسة. سجّل الدخول من جديد.',OFFLINE:'تقدم مافيا يحتاج اتصالًا بالخادم.',CONFIG:'تقدم مافيا غير متاح في هذه النسخة.'};
function Preferences({data,busy,onSave}) {
  const [visibility,setVisibility]=useState(data.preferences?.visibility||'private');
  const [role,setRole]=useState(data.preferences?.representativeRoleId||'');
  return <form className="mafia-profile-preferences" onSubmit={event=>{event.preventDefault();if(!busy)onSave({revision:data.revision,visibility,representativeRoleId:role||null});}}>
    <h3>{tr("خصوصية التقدم")}</h3><p>{tr("هذا الإعداد يخص لوحة تقدم مافيا. تبقى إحصاءات ميدان العامة ضمن ملفك العام.")}</p><p>{tr("الدور الممثل اختيار ثابت لبروفايلك. لا يكشف دورك أو فريقك في أي مباراة جارية.")}</p>
    <div className="mafia-profile-fields"><label>{tr("ظهور لوحة مافيا")}<select aria-label={tr("ظهور لوحة مافيا")} value={visibility} disabled={busy||data.preferencesLocked} onChange={event=>setVisibility(event.target.value)}>
      <option value="private">{tr("أنا فقط")}</option><option value="friends">{tr("أصدقائي")}</option><option value="public">{tr("الجميع")}</option></select></label>
      <label>{tr("الدور الممثل")}<select aria-label={tr("الدور الممثل")} value={role} disabled={busy||data.preferencesLocked} onChange={event=>setRole(event.target.value)}><option value="">{tr("دون دور ممثل")}</option>
        {data.roles.map(item=><option key={item.roleId} value={item.roleId} disabled={!item.representativeUnlocked}>{roleName(item.roleId)}{item.representativeUnlocked?'':tr(" · لم يُفتح")}</option>)}</select></label></div>
    {data.preferencesLocked&&<p role="status">{messages.MAFIA_SOCIAL_LOCKED}</p>}
    <button type="submit" disabled={busy||data.preferencesLocked}>{busy?tr("جارٍ الحفظ…"):tr("حفظ إعدادات مافيا")}</button>
  </form>;
}
export function MafiaProgressView({state,owner=false,onRetry=()=>{},onSave=()=>{}}) {
  const {data,loading,saving,error}=state;
  return <section className="mafia-profile" dir={localeDirection(getUiLocale())} aria-label={tr("تقدم مافيا")}><PresentationStyles sheet={css} />
    <header><div><span className="mafia-profile-kicker">{tr("ملف المجلس")}</span><h2>{owner?tr("رحلتك في مافيا"):tr("رحلة اللاعب في مافيا")}</h2></div><button data-design-id="mafia-progress-refresh" type="button" onClick={onRetry} disabled={loading||saving} aria-label={tr("تحديث تقدم مافيا")}>{tr("تحديث")}</button></header>
    {loading?<p role="status">{tr("جارٍ تحميل تقدم مافيا…")}</p>:<>
      {error&&<p className="mafia-profile-error" role="alert">{messages[error]||tr("تعذّر تحميل تقدم مافيا. حاول مرة أخرى.")}</p>}
      {data?.available===false?<p>{data.preferencesLocked?messages.MAFIA_SOCIAL_LOCKED:tr("تقدم مافيا غير متاح للعرض حاليًا.")}</p>:data?.available===true?<>
        <section className="mafia-profile-overview" aria-label={tr("المستوى الحالي")}><span className="mafia-profile-emblem" aria-hidden="true"><svg viewBox="0 0 48 48" fill="none"><path d="M24 4 40 11v10c0 11-5 17-16 23C13 38 8 32 8 21V11L24 4Z" stroke="currentColor" strokeWidth="3"/><path d="m24 12 2.6 7.4H34l-6 4.6 2.3 7.3-6.3-4.6-6.3 4.6 2.3-7.3-6-4.6h7.4L24 12Z" fill="currentColor"/></svg></span><div className="mafia-profile-overview-copy"><div className="mafia-profile-level"><strong>{tr("المستوى ")}{number(data.progress.level)}</strong><span>{number(data.progress.totalXp)} XP</span></div>
        <div className="mafia-profile-xp" role="progressbar" aria-label={tr("خبرة المستوى في مافيا")} aria-valuemin={0} aria-valuemax={data.progress.xpPerLevel} aria-valuenow={Math.min(data.progress.xpInLevel,data.progress.xpPerLevel)}><span style={{width:`${Math.max(0,Math.min(100,data.progress.xpInLevel/Math.max(1,data.progress.xpPerLevel)*100))}%`}}/></div>
        <p>{number(data.progress.xpInLevel)}{tr(" من ")}{number(data.progress.xpPerLevel)}{tr(" XP للمستوى التالي · ")}{number(data.progress.rewardedMatches)}{tr(" مشاركة منحت تقدمًا")}</p></div></section>
        {!data.progress.rewardedMatches&&<p className="mafia-profile-note">{tr("تبدأ الرحلة من أول مباراة مؤهلة مكتملة. اللعب والتدريب متاحان دون شراء قوة.")}</p>}
        {data.preferences?.representativeRoleId&&<p>{tr("الدور الممثل: ")}<strong>{roleName(data.preferences.representativeRoleId)}</strong>{tr(" · اختيار بروفايل ثابت")}</p>}
        {!!data.progress.legacyMatches&&<p className="mafia-profile-legacy">{tr("سجل سابق: ")}{number(data.progress.legacyMatches)}{tr(" مشاركة مستوردة دون XP أو إتقان.")}</p>}
        <div className="mafia-profile-grid">{data.roles.map(item=><article key={item.roleId} className="mafia-profile-role"><h3>{roleName(item.roleId)}</h3><span className="mafia-profile-stage">{item.mastery?tr("مرحلة الإتقان {v0} من ٥", {v0: number(item.mastery)}):tr("لم يبدأ الإتقان")}</span>
          <span className="mafia-profile-stars" aria-hidden="true">{Array.from({length:5},(_,i)=><span key={i} className={item.mastery>i?'earned':undefined}>★</span>)}</span><p>{tr("عينة مؤهلة: ")}{number(item.qualifiedMatches)}{tr(" مباراة")}</p><small>{number(item.wins)}{tr(" فوز · ")}{number(item.draws)}{tr(" تعادل")}</small>
          {item.qualifiedMatches>0&&item.qualifiedMatches<5&&<small>{tr("العينة صغيرة؛ الأرقام تصف مشاركتك الحالية.")}</small>}
          {!!item.legacyMatches&&<small className="mafia-profile-legacy">{tr("سجل سابق منفصل: ")}{number(item.legacyMatches)}</small>}</article>)}</div>
        <p>{tr("الإتقان من المباريات التي منحت تقدمًا. الخاص يمنح ٥٠ XP لأول ثلاث منح معتمدة في يوم النهاية بتوقيت UTC؛ بعد ذلك لا XP ولا إتقان. المنسحب لا يحصل على تقدم.")}</p>
        <h3>{tr("إنجازات مافيا")}</h3><div className="mafia-profile-achievements">{MAFIA_ACHIEVEMENT_LIST.map(rule=>{
          const earned=data.achievements?.some(item=>item.id===rule.id);
          return <span key={rule.id} title={tr(rule.description)} aria-label={tr(rule.label)+(earned?tr("، مكتمل"):tr("، لم يُفتح بعد"))}>{earned?'✓ ':''}{tr(rule.label)}{!earned&&tr(" · لم يُفتح بعد")}</span>;
        })}</div>
        {owner&&data.grants?.length>0&&<p className="mafia-profile-rewards"><strong>{tr("مكافآتك الدائمة")}</strong> ·  {data.grants.map(item=>tr(getCosmetic(item.itemId)?.label)).filter(Boolean).join('، ')}{tr(" · المصدر: إنجاز مافيا. تجدها في «إطاراتي ومظهر بلس» دون اشتراط بلس.")}</p>}
        {owner&&<Preferences key={data.revision} data={data} busy={saving} onSave={onSave}/>}
      </>:!error&&<p>{tr("لا توجد بيانات تقدم معروضة.")}</p>}
    </>}
  </section>;
}
export function MafiaProgressPanel({account,profileId,owner,server=resolveAccountServer()}) {
  const [client]=useState(()=>new MafiaProgressClient());
  const enabled=account.ready===true&&account.signedIn===true&&!!account.user?.id;
  const viewerId=enabled?account.user.id:null;
  const auth=enabled?account.authHeaders?.()||{}:{},targetId=owner?'me':profileId;
  const identity=useRef({key:null,header:null,epoch:0});
  const key=[server,viewerId,targetId,enabled].join('\u0000'),header=auth.Authorization||auth.authorization||'';
  if(identity.current.key!==key||identity.current.header!==header)identity.current={key,header,epoch:identity.current.epoch+1};
  const sessionEpoch=identity.current.epoch,scope=mafiaProgressScope({server,viewerId,targetId,sessionEpoch});
  const state=useSyncExternalStore(client.subscribe,client.getSnapshot,client.getSnapshot);
  useEffect(()=>{
    if(!enabled){client.start(null);return;}
    client.start({server,viewerId,targetId,auth,sessionEpoch});
    const refresh=()=>{if(document.visibilityState!=='hidden'&&!client.getSnapshot().saving)client.load().catch(()=>{});};
    client.load().catch(()=>{});window.addEventListener('focus',refresh);document.addEventListener('visibilitychange',refresh);
    return()=>{window.removeEventListener('focus',refresh);document.removeEventListener('visibilitychange',refresh);client.start(null);};
    // Header identity stays in a private ref; only its numeric epoch enters the
    // request scope. Rendering conceals old data before effect cleanup runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[client,scope]);
  if(!enabled)return null;
  const visible=state.scope===scope?state:{data:null,loading:true,saving:false,error:null};
  return <MafiaProgressView state={visible} owner={owner} onRetry={()=>client.load().catch(()=>{})} onSave={body=>client.save(body).catch(()=>{})}/>;
}

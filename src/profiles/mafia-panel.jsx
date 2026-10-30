import React,{useEffect,useRef,useState,useSyncExternalStore} from 'react';
import {resolveAccountServer} from '../shared/account/api.js';
import {MAFIA_ROLES} from '../online/mafia-shared.js';
import {MafiaProgressClient,mafiaProgressScope} from './mafia-client.js';
import {MAFIA_ACHIEVEMENT_LIST} from './mafia-catalog.js';
import {getCosmetic} from '../plus/catalog.js';
import css from './mafia-panel.css';

const number=value=>Number.isFinite(value)?Math.max(0,value).toLocaleString('ar'):'—';
const roleName=id=>MAFIA_ROLES[id]?.name||'دور غير متاح';
const messages={CONFLICT:'تغيّرت إعداداتك على جهاز آخر. أعد التحميل وراجع اختياراتك قبل حفظها.',
  MAFIA_SOCIAL_LOCKED:'يمكنك تعديل الظهور والدور الممثل بعد انتهاء مباراة مافيا أو المشاهدة.',
  MAFIA_ROLE_LOCKED:'هذا الدور لم يُفتح للعرض بعد. اختر دورًا مؤهلًا أو ألغِ الاختيار.',
  STALE:'وصلت بيانات قديمة. أعد التحميل للحصول على الحالة الحالية.',AUTH_REQUIRED:'سجّل الدخول لعرض تقدمك.',
  AUTH_EXPIRED:'انتهت الجلسة. سجّل الدخول من جديد.',OFFLINE:'تقدم مافيا يحتاج اتصالًا بالخادم.',CONFIG:'تقدم مافيا غير متاح في هذه النسخة.'};
function Preferences({data,busy,onSave}) {
  const [visibility,setVisibility]=useState(data.preferences?.visibility||'private');
  const [role,setRole]=useState(data.preferences?.representativeRoleId||'');
  return <form className="mafia-profile-preferences" onSubmit={event=>{event.preventDefault();if(!busy)onSave({revision:data.revision,visibility,representativeRoleId:role||null});}}>
    <h3>ظهور لوحة مافيا</h3><p>هذا الإعداد يخص لوحة تقدم مافيا. تبقى إحصاءات ميدان العامة ضمن ملفك العام.</p><p>الدور الممثل اختيار ثابت لبروفايلك. لا يكشف دورك أو فريقك في أي مباراة جارية.</p>
    <div className="mafia-profile-fields"><label>ظهور لوحة مافيا<select aria-label="ظهور لوحة مافيا" value={visibility} disabled={busy||data.preferencesLocked} onChange={event=>setVisibility(event.target.value)}>
      <option value="private">أنا فقط</option><option value="friends">أصدقائي</option><option value="public">الجميع</option></select></label>
      <label>الدور الممثل<select aria-label="الدور الممثل" value={role} disabled={busy||data.preferencesLocked} onChange={event=>setRole(event.target.value)}><option value="">دون دور ممثل</option>
        {data.roles.map(item=><option key={item.roleId} value={item.roleId} disabled={!item.representativeUnlocked}>{roleName(item.roleId)}{item.representativeUnlocked?'':' · لم يُفتح'}</option>)}</select></label></div>
    {data.preferencesLocked&&<p role="status">{messages.MAFIA_SOCIAL_LOCKED}</p>}
    <button type="submit" disabled={busy||data.preferencesLocked}>{busy?'جارٍ الحفظ…':'حفظ إعدادات مافيا'}</button>
  </form>;
}
export function MafiaProgressView({state,owner=false,onRetry=()=>{},onSave=()=>{}}) {
  const {data,loading,saving,error}=state;
  return <section className="mafia-profile" dir="rtl" aria-label="تقدم مافيا"><style>{css}</style>
    <header><h2>{owner?'رحلتك في مافيا':'رحلة اللاعب في مافيا'}</h2><button data-design-id="mafia-progress-refresh" type="button" onClick={onRetry} disabled={loading||saving} aria-label="تحديث تقدم مافيا">تحديث</button></header>
    {loading?<p role="status">جارٍ تحميل تقدم مافيا…</p>:<>
      {error&&<p className="mafia-profile-error" role="alert">{messages[error]||'تعذّر تحميل تقدم مافيا. حاول مرة أخرى.'}</p>}
      {data?.available===false?<p>{data.preferencesLocked?messages.MAFIA_SOCIAL_LOCKED:'تقدم مافيا غير متاح للعرض حاليًا.'}</p>:data?.available===true?<>
        <div className="mafia-profile-level"><strong>المستوى {number(data.progress.level)}</strong><span>{number(data.progress.totalXp)} XP</span></div>
        <div className="mafia-profile-xp" role="progressbar" aria-label="خبرة المستوى في مافيا" aria-valuemin={0} aria-valuemax={data.progress.xpPerLevel} aria-valuenow={Math.min(data.progress.xpInLevel,data.progress.xpPerLevel)}><span style={{width:`${Math.max(0,Math.min(100,data.progress.xpInLevel/Math.max(1,data.progress.xpPerLevel)*100))}%`}}/></div>
        <p>{number(data.progress.xpInLevel)} من {number(data.progress.xpPerLevel)} XP للمستوى التالي · {number(data.progress.rewardedMatches)} مشاركة منحت تقدمًا</p>
        {!data.progress.rewardedMatches&&<p className="mafia-profile-note">تبدأ الرحلة من أول مباراة مؤهلة مكتملة. اللعب والتدريب متاحان دون شراء قوة.</p>}
        {data.preferences?.representativeRoleId&&<p>الدور الممثل: <strong>{roleName(data.preferences.representativeRoleId)}</strong> · اختيار بروفايل ثابت</p>}
        {!!data.progress.legacyMatches&&<p className="mafia-profile-legacy">سجل سابق: {number(data.progress.legacyMatches)} مشاركة مستوردة دون XP أو إتقان.</p>}
        <div className="mafia-profile-grid">{data.roles.map(item=><article key={item.roleId} className="mafia-profile-role"><h3>{roleName(item.roleId)}</h3><span className="mafia-profile-stage">{item.mastery?`مرحلة الإتقان ${number(item.mastery)} من ٥`:'لم يبدأ الإتقان'}</span>
          <p>عينة مؤهلة: {number(item.qualifiedMatches)} مباراة</p><small>{number(item.wins)} فوز · {number(item.draws)} تعادل</small>
          {item.qualifiedMatches>0&&item.qualifiedMatches<5&&<small>العينة صغيرة؛ الأرقام تصف مشاركتك الحالية.</small>}
          {!!item.legacyMatches&&<small className="mafia-profile-legacy">سجل سابق منفصل: {number(item.legacyMatches)}</small>}</article>)}</div>
        <p>الإتقان من المباريات التي منحت تقدمًا. الخاص يمنح ٥٠ XP لأول ثلاث منح معتمدة في يوم النهاية بتوقيت UTC؛ بعد ذلك لا XP ولا إتقان. المنسحب لا يحصل على تقدم.</p>
        <h3>إنجازات مافيا</h3><div className="mafia-profile-achievements">{MAFIA_ACHIEVEMENT_LIST.map(rule=>{
          const earned=data.achievements?.some(item=>item.id===rule.id);
          return <span key={rule.id} title={rule.description} aria-label={rule.label+(earned?'، مكتمل':'، لم يُفتح بعد')}>{earned?'✓ ':''}{rule.label}{!earned&&' · لم يُفتح بعد'}</span>;
        })}</div>
        {owner&&data.grants?.length>0&&<p>مكافآتك الدائمة: {data.grants.map(item=>getCosmetic(item.itemId)?.label).filter(Boolean).join('، ')} · المصدر: إنجاز مافيا. تجدها في «إطاراتي ومظهر بلس» دون اشتراط بلس.</p>}
        {owner&&<Preferences key={data.revision} data={data} busy={saving} onSave={onSave}/>}
      </>:!error&&<p>لا توجد بيانات تقدم معروضة.</p>}
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

import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { configureIntegratedPreviewAudio, integratedPreviewAudio, subscribeIntegratedPreviewSound } from '../../src/shared/fx/integrated-preview-audio.js';
import css from './preview.css';

const accountPrefix=`maydan:environment:${encodeURIComponent(location.origin)}:account:`;
async function post(url,body){const r=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const d=await r.json();if(!r.ok)throw Error(d.error||'تعذّر إكمال الخطوة المحلية');return d;}
const duration = value => { const s=Math.max(0,Math.floor(Number(value)||0));return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`; };
const privateGameRoute = hash => /^#\/?(play|room|tutorial|online)(\/|\?|$)/.test(hash);
function AudioReview(){
  const [sound,setSound]=useState(null),[status,setStatus]=useState(null),[message,setMessage]=useState('');
  useEffect(()=>subscribeIntegratedPreviewSound(setSound),[]);
  useEffect(()=>{
    if(!sound)return;
    const update=()=>setStatus(sound.music.getStatus?.()||null);
    update();const unsubscribe=sound.music.subscribeStatus?.(update);const timer=setInterval(update,1000);
    return()=>{unsubscribe?.();clearInterval(timer);};
  },[sound]);
  const pack=integratedPreviewAudio()?.pack;
  const suite=pack?.musicSuites?.['warmth-long'];
  const ids=suite?[...new Set([suite.introTrackId,...suite.trackIds].filter(Boolean))]:['music-bossa'];
  const total=ids.reduce((n,id)=>n+(pack?.assets?.[id]?.file?.durationSeconds||0),0);
  const title=pack?.assets?.[status?.trackId]?.titleAr||status?.trackTitle||'بانتظار بدء الموسيقى';
  const state={playing:'تعمل',paused:'متوقفة مؤقتًا بحسب إعدادات اللعبة',ended:'اكتملت',failed:'تعذّر التحميل', 'gesture-required':'اضغط زرًا لتشغيل الصوت'}[status?.state]||'جاهزة للتجربة';
  const menuOnly=!privateGameRoute(location.hash);
  const sample=name=>{if(privateGameRoute(location.hash)||!sound)return;sound.unlock();sound.play(name,{source:'manual-local-review',guard:()=>!privateGameRoute(location.hash)});setMessage('عينة يدوية من بنك المعاينة؛ مستوى الصوت من الإعدادات.');};
  return <section className="integrated-audio-review" aria-label="تجربة الصوتيات داخل اللعبة">
    <h3>دفء وخفّة · الموسيقى المتنوّعة</h3>
    <p>مدة المرور الأول <bdi>{duration(total)}</bdi> عبر {ids.length} مقاطع. تنتقل بهدوء، ولا تعود لبداية المقطوعة عند التنقّل أو التوقف المؤقت. بعد انتهاء المكتبة تُعاد المقاطع بترتيب متغيّر دون تكرار مباشر.</p>
    <p><strong>{title}</strong><br/><span>{state}</span> · <bdi>{duration(status?.position)} / {duration(status?.chapterSeconds)}</bdi></p>
    <progress max={status?.chapterSeconds||1} value={status?.position||0} aria-label="تقدم المقطع الحالي"/>
    <button disabled={!sound||!menuOnly||status?.state!=='playing'} onClick={()=>setMessage(sound.music.skipNext?.()?'ينتقل إلى المقطع التالي بخفوت تدريجي.':'المشهد الحالي أو إعدادات الصوت لا تسمح بالتخطي.')}>جرّب المقطع التالي</button>
    {status?.state==='failed'&&<button disabled={!sound||!menuOnly} onClick={()=>setMessage(sound.music.retry?.()?'أُعيدت محاولة تشغيل الموسيقى.':'المشهد الحالي أو إعدادات الصوت لا تسمح بالتشغيل.')}>إعادة محاولة الموسيقى</button>}
    {status?.degraded&&<p>تعذّر تحميل أحد المقاطع؛ يستمر المقطع السليم ولا يعود المشغّل إلى بنك الأصوات القديم.</p>}
    <div className="integrated-preview-actions">{[['click','النقر'],['correct','الإجابة الصحيحة'],['wrong','الإجابة الخاطئة'],['timerWarning','دقات الساعة'],['win','نهاية المباراة']].map(([cue,label])=><button disabled={!sound||!menuOnly} key={cue} onClick={()=>sample(cue)}>{label}</button>)}</div>
    <p role="status">{message}</p><details><summary>المقاطع والمصادر</summary><ol>{ids.map(id=>{const a=pack?.assets?.[id];return a?<li key={id}><b>{a.titleAr}</b> · <bdi>{duration(a.file.durationSeconds)}</bdi><br/><a href={a.source.pageUrl} target="_blank" rel="noreferrer">{a.source.title}</a></li>:null;})}</ol></details>
    <p>الصوت الحالي معتمد منك للمعاينة. تبقى الموسيقى هادئة أو صامتة بحسب مرحلة اللعب والكلام؛ تجربة الآيفون وتجهيز النشر لم تتم بعد.</p>
  </section>;
}
function Controls(){
  const [path,setPath]=useState(location.hash),[open,setOpen]=useState(false),[busy,setBusy]=useState(false),[note,setNote]=useState(''),[rooms,setRooms]=useState([]);
  useEffect(()=>{const f=()=>{setPath(location.hash);setOpen(false);};window.addEventListener('hashchange',f);return()=>window.removeEventListener('hashchange',f);},[]);
  const inGame=privateGameRoute(path);
  const act=async callback=>{setBusy(true);try{await callback();}catch(e){setNote(e.message);}finally{setBusy(false);}};
  const login=async scenario=>{const r=await post('/__plus_lab__/scenario',{scenario});localStorage.setItem(accountPrefix+'session',JSON.stringify(r.session.token));localStorage.setItem(accountPrefix+'me',JSON.stringify({data:r.me,fetchedAt:Date.now()}));location.hash='/';location.reload();};
  return <><style>{css}</style><aside className="integrated-preview-bar" hidden={inGame} aria-label="بيئة التجربة المحلية">
    <span>معاينة محلية · بيانات تجريبية</span><button onClick={()=>setOpen(v=>!v)} aria-expanded={open}>أدوات التجربة</button>
    {open&&<section className="integrated-preview-tools" aria-label="أدوات التجربة"><header><strong>اللعبة كاملة على خادم محلي</strong><button aria-label="إغلاق أدوات التجربة" onClick={()=>setOpen(false)}>×</button></header>
      <p>الغرف والرسائل تستخدم الخدمات المحلية. الحسابات والشخصيات أدناه تجريبية؛ لا دفع فعلي ولا اتصال بـ Apple أو Google أو LiveKit.</p>
      <div className="integrated-preview-actions">{[['free','حساب مجاني'],['plus','بلس · بروفايل وإطار'],['owned','مالك قطع دائمة'],['expired','اشتراك منتهٍ']].map(([id,label])=><button disabled={busy} key={id} onClick={()=>act(()=>login(id))}>{label}</button>)}</div>
      <div className="integrated-preview-actions"><button disabled={busy} onClick={()=>act(async()=>{const r=await post('/__preview__/seed',{});setRooms(r.rooms);setNote('غرف محلية فعلية مع شخصيات اختبار؛ يمكنك دخولها من قائمة اللعبة.');})}>تجهيز غرف الاختبار</button><button disabled={busy} onClick={()=>act(async()=>{localStorage.removeItem(accountPrefix+'session');localStorage.removeItem(accountPrefix+'me');location.reload();})}>متابعة كضيف</button></div>
      {rooms.map(r=><div key={r.code} className="integrated-room"><bdi>{r.code}</bdi><span>{r.name}</span><a href={'#/room/'+r.code}>دخول</a><button disabled={busy} onClick={()=>act(async()=>{await post('/__preview__/room-action',{code:r.code,action:'ready'});setNote('أكدت الشخصيات التجريبية جاهزيتها.');})}>جهّز الشخصيات</button><button disabled={busy} onClick={()=>act(async()=>{await post('/__preview__/room-action',{code:r.code,action:'start'});setNote('أُرسل البدء؛ يتحقق الخادم من الشروط.');})}>بدء المضيف</button></div>)}
      <p role="status">{note}</p><p>الصوت المختار: «دفء وخفّة» · موسيقى30% ومؤثرات65% أول مرة، وتُحفظ اختياراتك في الإعدادات.</p><AudioReview/>
      <a href="/__integrated__/progress/" target="_blank" rel="noreferrer">سجل التنفيذ وما بقي</a>
    </section>}
  </aside></>;
}
async function boot(){
  const r=await fetch('/audio-preview/manifest.json');if(!r.ok)throw Error('تعذّر تحميل بنك الصوت المحلي');
  if(!configureIntegratedPreviewAudio({pack:await r.json(),baseUrl:'/audio-preview/'}))throw Error('لم يجتز بنك الصوت تحقق المعاينة المحلية');
  const host=document.createElement('div');host.id='integrated-preview-tools';document.body.insertBefore(host,document.getElementById('root'));createRoot(host).render(<Controls/>);
  await import('../../src/main.jsx');
}
boot().catch(e=>{const node=document.getElementById('fatal');if(node){node.style.display='block';node.textContent='تعذّر تجهيز المعاينة: '+e.message;}});

import React,{useEffect,useRef,useState} from 'react';
import {Modal,Button} from '../shared/ui/components.jsx';
import {useAccount} from '../shared/account/context.js';
import {SUPPORT_EMAIL} from '../shared/account/config.js';
import {getCosmetic} from '../plus/catalog.js';
import css from './mafia.css';
const status={registration:'التسجيل مفتوح',locked:'القائمة مثبتة',closed:'انتهت البطولة',cancelled:'أُلغيت البطولة'};
const message={MAFIA_COMMUNITY_DISABLED:'الموسم والأندية غير متاحة في هذه البيئة.',MAFIA_SOCIAL_LOCKED:'ارجع بعد انتهاء اللعب أو المشاهدة أو مغادرة طابور المنافسة.',CONFLICT:'تغيرت البيانات على جهاز آخر. حدّث اللوحة قبل إعادة المحاولة.',TOURNAMENT_MATCH_INVALID:'لا تطابق المباراة القائمة المثبتة أو القواعد أو الوقت، أو لم تعتمد نتيجتها بعد.',TOURNAMENT_LOCKED:'التسجيل أو الإجراء المطلوب مغلق حاليًا.',TOURNAMENT_UNAVAILABLE:'تحقق من ثمانية أعضاء حاليين ومن استكمال الجولات المطلوبة.',TOURNAMENT_LIMIT:'أكمل أو ألغِ بطولة مفتوحة قبل إنشاء بطولة أخرى.',MAFIA_REWARD_LOCKED:'لم تكتمل شروط المكافأة بعد.',CONTENT_REJECTED:'عدّل النص ليلائم قواعد ميدان.',NOT_FOUND:'لم تعد هذه البيانات متاحة لك.'};
const date=value=>new Date(value).toLocaleString('ar');
const n=value=>Number(value||0).toLocaleString('ar');
export function MafiaCommunity({onClose}) {
  const [foreground,setForeground]=useState(()=>typeof document==='undefined'||document.visibilityState!=='hidden');
  const account=useAccount(),owner=foreground&&account.ready&&account.signedIn?account.user?.id:null;
  const auth=owner?account.authHeaders?.()||{}:{},token=auth.Authorization||auth.authorization||'';
  const identity=useRef({key:'',epoch:0});const key=JSON.stringify([owner,token,account.ready]);
  if(identity.current.key!==key)identity.current={key,epoch:identity.current.epoch+1};
  const epoch=identity.current.epoch,latest=useRef({owner,epoch,request:account.requestAuthenticated});latest.current={owner,epoch,request:account.requestAuthenticated};
  const sequence=useRef(0),controller=useRef(null),attempt=useRef(null);
  const [state,setState]=useState({owner:null,epoch:0,data:null,club:null,event:null,busy:false,error:null});
  const [selected,setSelected]=useState(''),[motto,setMotto]=useState(''),[title,setTitle]=useState(''),[startsAt,setStartsAt]=useState(''),[matchKey,setMatchKey]=useState('');
  const [revision,setRevision]=useState(0);
  useEffect(()=>{
    const change=()=>{sequence.current++;controller.current?.abort();setForeground(document.visibilityState!=='hidden');};
    const hide=()=>{sequence.current++;controller.current?.abort();setForeground(false);};
    document.addEventListener('visibilitychange',change);window.addEventListener('pagehide',hide);window.addEventListener('pageshow',change);
    return()=>{document.removeEventListener('visibilitychange',change);window.removeEventListener('pagehide',hide);window.removeEventListener('pageshow',change);};
  },[]);
  const stillCurrent=()=>latest.current.owner===owner&&latest.current.epoch===epoch;
  const scoped=state.owner===owner&&state.epoch===epoch?state:{data:null,club:null,event:null,busy:false,error:null};
  const update=async(path='',options={},section='data')=>{
    if(!owner||latest.current.owner!==owner||latest.current.epoch!==epoch)return null;
    controller.current?.abort();const abort=new AbortController();controller.current=abort;
    const serial=++sequence.current,at=latest.current,transportCleanup=[];
    const current=()=>!abort.signal.aborted&&latest.current.owner===at.owner&&latest.current.epoch===at.epoch&&serial===sequence.current;
    setState(value=>value.owner===owner&&value.epoch===epoch?{...value,busy:true,error:null}:{owner,epoch,data:null,club:null,event:null,busy:true,error:null});
    try{
      const result=await at.request(path.startsWith('/api/')?path:'/api/mafia/community'+path,{...options,fetchImpl:async(url,init)=>{
        const transport=new AbortController(),stop=()=>transport.abort();
        if(abort.signal.aborted||init.signal?.aborted)stop();
        abort.signal.addEventListener('abort',stop,{once:true});init.signal?.addEventListener('abort',stop,{once:true});
        transportCleanup.push(()=>{abort.signal.removeEventListener('abort',stop);init.signal?.removeEventListener('abort',stop);});
        return fetch(url,{...init,signal:transport.signal});
      }});
      if(!current())return null;
      setState(value=>({...value,[section]:result,busy:false,error:null}));return result;
    }catch(error){if(current())setState(value=>({...value,busy:false,...(['NOT_FOUND','MAFIA_SOCIAL_LOCKED','AUTH_REQUIRED','AUTH_EXPIRED'].includes(error.code)?{club:null,event:null,candidates:null}:{}),error:message[error.code]||'تعذر إكمال الطلب. أعد المحاولة بعد التحقق من الاتصال.'}));return null;}
    finally{for(const cleanup of transportCleanup)cleanup();}
  };
  const reload=()=>{setSelected('');setMotto('');setRevision(0);setState(value=>({...value,club:null,event:null,candidates:null}));return update();};
  useEffect(()=>{
    sequence.current++;controller.current?.abort();attempt.current=null;setSelected('');setTitle('');setStartsAt('');setMatchKey('');setMotto('');setRevision(0);
    setState({owner,epoch,data:null,club:null,event:null,busy:false,error:null});
    if(owner)update();
    return()=>{sequence.current++;controller.current?.abort();};
  // update deliberately captures this exact owner/token epoch; no response from a
  // retired identity is displayed after A -> B -> A or a rotated session.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[owner,epoch]);
  const openClub=async group=>{
    setSelected(group.id);setMotto(group.motto||'');setRevision(group.revision||0);setState(value=>({...value,club:null,event:null,candidates:null}));
    if(group.clubCreatedAt){const result=await update(`/clubs/${group.id}`,{},'club');if(result&&stillCurrent()){setMotto(result.club.motto);setRevision(result.club.revision);}}
  };
  const saveClub=async event=>{event.preventDefault();const result=await update(`/clubs/${selected}`,{method:'PUT',body:{motto,revision}},'club');if(result&&stillCurrent()){setRevision(result.club.revision);setState(value=>({...value,data:{...value.data,groups:value.data.groups.map(group=>group.id===selected?{...group,motto:result.club.motto,clubCreatedAt:result.club.createdAt,revision:result.club.revision}:group)}}));}};
  const createEvent=async event=>{
    event.preventDefault();const time=new Date(startsAt).getTime(),attemptKey=JSON.stringify([selected,title,time]);
    if(attempt.current?.key!==attemptKey)attempt.current={key:attemptKey,clientId:crypto.randomUUID()};
    const result=await update(`/clubs/${selected}/tournaments`,{method:'POST',body:{title,startsAt:time,clientId:attempt.current.clientId}},'event');
    if(result&&stillCurrent()){attempt.current=null;setTitle('');setStartsAt('');setState(value=>({...value,club:{...value.club,tournaments:[{id:result.tournament.id,title:result.tournament.title,startsAt:result.tournament.startsAt,state:result.tournament.state,revision:result.tournament.revision},...value.club.tournaments]}}));}
  };
  const event=scoped.event?.tournament,club=scoped.club?.club,mission=scoped.club?.mission,season=scoped.data?.season;
  const manage=role=>role==='owner'||role==='admin',busy=scoped.busy;
  if(!foreground)return null;
  return <Modal className="mafia-noir mafia-guide-dialog mafia-history-dialog" title="موسم اللمة والأندية" onClose={onClose}><style>{css}</style><div className="stack mafia-community" dir="rtl">
    <style>{`.mafia-community{max-height:75dvh;overflow:auto;overscroll-behavior:contain}.mafia-community article{padding:14px;border:1px solid var(--m-border);background:var(--m-panel);border-radius:14px}.mafia-community input,.mafia-community textarea,.mafia-community select{width:100%;min-width:0;box-sizing:border-box;background:#101b2b;color:#fff4df;border:1px solid #8290a0;padding:10px;border-radius:8px}.mafia-community label{display:grid;gap:6px}.mafia-community button{white-space:normal}.mafia-community .row{flex-wrap:wrap}.mafia-community bdi{overflow-wrap:anywhere}.mafia-community a{color:var(--m-gold)}.mafia-community progress{width:100%}`}</style>
    <p>موسم تجميلي مجاني وأندية مبنية على مجموعات ميدان الحالية. المكتسبات دائمة ولا تغيّر توزيع الأدوار أو القدرات.</p>
    {!owner?<p>سجّل الدخول من حساب ميدان لعرض الموسم وأنديتك.</p>:<>
      <Button disabled={busy} onClick={reload}>تحديث الموسم والأندية</Button>{busy&&<p role="status">جارٍ التحميل…</p>}{scoped.error&&<p role="alert">{scoped.error}</p>}
      {season&&<article className="stack"><h3>{season.label}</h3><p>{date(season.startsAt)} إلى {date(season.endsAt)}</p><progress aria-label="مشاركات الموسم" max={season.target} value={Math.min(season.target,season.completed)}/><p>{n(season.completed)} من {n(season.target)} مشاركة عامة مؤهلة داخل نافذة الموسم. السجل المستورد والخاص والتدريب والانسحاب لا يحتسبون.</p><strong>{getCosmetic(season.itemId)?.label}</strong><Button disabled={busy||!season.canClaim} onClick={async()=>{const result=await update('/season/claim',{method:'POST',body:{}},'claim');if(result&&stillCurrent())setState(value=>({...value,data:{...value.data,season:result.season}}));}}>{season.claimed?'استلمت المكافأة':season.canClaim?'استلام مكافأة الموسم':'أكمل المشاركات لفتح المكافأة'}</Button><small>تجد ما استلمته في متجر المظهر ضمن العناصر المكتسبة، دون اشتراط بلس.</small></article>}
      <h3>مجموعاتي وأنديتي</h3><p>العضوية والدعوات والإدارة من «اللمة». يمكن لمسؤول مجموعة تفعيل هوية النادي هنا. لا توجد عضوية أو محادثة ثانية.</p>
      {scoped.data?.groups?.length===0&&<p>ليس لديك مجموعات حالية. أنشئ مجموعة أو اقبل دعوة من شاشة اللمة، ثم حدّث هذه اللوحة.</p>}
      <div className="row">{scoped.data?.groups?.map(group=><Button key={group.id} disabled={busy} onClick={()=>openClub(group)}>{group.name}{group.clubCreatedAt?' · نادٍ':''}</Button>)}</div>
      {selected&&manage(club?.role||scoped.data?.groups?.find(group=>group.id===selected)?.role)&&<form className="stack" onSubmit={saveClub}><label>شعار النادي القصير<input maxLength={100} required value={motto} onChange={e=>setMotto(e.target.value)}/></label><Button disabled={busy} type="submit">{club?'حفظ شعار النادي':'تفعيل النادي للمجموعة'}</Button></form>}
      {club&&<article className="stack"><h3>{club.name}</h3><p>{club.motto}</p><h4>مهمة المشاركة</h4><progress aria-label="مشاركات النادي" max={mission.target} value={Math.min(mission.target,mission.total)}/><p>{n(mission.total)} من {n(mission.target)} مشاركة من الأعضاء الحاليين · مساهمتك {n(mission.own)} من {n(mission.ownTarget)} المطلوبة.</p><p>تحتسب المشاركات العامة المؤهلة بعد عضويتك وتفعيل النادي. اعتماد المشاركة لنادٍ واحد فقط؛ مغادرة عضو تزيل مساهمته من العداد دون سحب مكافأة استلمتها سابقًا.</p><Button disabled={busy} onClick={()=>update(`/clubs/${selected}/credit`,{method:'POST',body:{}},'club')}>{mission.claimed?'تحديث مساهمتي · المكافأة مستلمة':mission.canClaim?'استلام ستايل المجلس':'اعتماد مشاركاتي وتحديث المهمة'}</Button><small>المكافأة: {getCosmetic(mission.itemId)?.label}، تجميل دائم.</small>
        <h4>مواعيد البطولات المحدودة</h4><p>ثمانية أعضاء، ثلاث مباريات أساسية خاصة دون صوت، نسخة القواعد ١. الفوز ٣ نقاط والتعادل نقطة. الجوائز ترتيب وتقدير داخل النادي؛ دون مال أو تأثير في تصنيف المنافسة.</p>
        {scoped.club.tournaments.map(t=><Button key={t.id} disabled={busy} onClick={()=>{setMatchKey('');setState(value=>({...value,candidates:null}));update(`/tournaments/${t.id}`,{},'event');}}>{t.title} · {status[t.state]} · {date(t.startsAt)}</Button>)}
        {manage(club.role)&&<form className="stack" onSubmit={createEvent}><label>اسم البطولة<input maxLength={60} required value={title} onChange={e=>setTitle(e.target.value)}/></label><label>الموعد بتوقيت جهازك<input type="datetime-local" required value={startsAt} onChange={e=>setStartsAt(e.target.value)}/></label><small>اختر موعدًا بعد ١٥ دقيقة وخلال ٧ أيام. تُثبت القائمة قبل الموعد، وتحتاج ثمانية أعضاء يسجل كل منهم بنفسه.</small><Button disabled={busy} type="submit">إنشاء موعد بطولة</Button></form>}
      </article>}
      {event&&<article className="stack"><h3>{event.title}</h3><strong>{status[event.state]}</strong><p>{date(event.startsAt)} · {n(scoped.event.members.length)} من ٨ مقاعد · {n(scoped.event.matches.length)} من ٣ جولات</p>
        {event.state==='registration'&&<div className="row"><Button disabled={busy} onClick={()=>update(`/tournaments/${event.id}/registration`,{method:scoped.event.members.some(m=>m.userId===owner)?'DELETE':'PUT',...(scoped.event.members.some(m=>m.userId===owner)?{}:{body:{}})},'event')}>{scoped.event.members.some(m=>m.userId===owner)?'سحب تسجيلي':'تسجيل مقعدي'}</Button>{manage(event.role)&&<Button disabled={busy||scoped.event.members.length!==8} onClick={()=>update(`/tournaments/${event.id}`,{method:'PATCH',body:{revision:event.revision,action:'lock'}},'event')}>تثبيت القائمة والقواعد</Button>}</div>}
        <p>تجري الجولات في غرفة أصدقاء بالقواعد المثبتة بعد الموعد. لا يقبل النظام اسم فائز تكتبه؛ يقرأ النتيجة الخادمية ويطابق كل المشاركين والوقت والقواعد. المباراة المنسحبة أو ذات القائمة المختلفة لا تحتسب.</p>
        <ol>{scoped.event.members.map((m,index)=><li key={m.userId}>{m.userId===owner?'أنت':m.name||`المشارك ${index+1}`} · {n(m.points)} نقطة{m.place?` · المركز ${n(m.place)}`:''}</li>)}</ol>
        {event.state==='locked'&&manage(event.role)&&<><Button disabled={busy} onClick={()=>update('/api/mafia/history?limit=50',{},'candidates')}>اختيار جولة من مبارياتي المكتملة</Button>{scoped.candidates&&<form className="stack" onSubmit={e=>{e.preventDefault();update(`/tournaments/${event.id}/matches`,{method:'POST',body:{matchKey}},'event');}}><label>المباراة المراد مطابقتها<select required value={matchKey} onChange={e=>setMatchKey(e.target.value)}><option value="">اختر مباراة بعد موعد البطولة</option>{scoped.candidates.matches.filter(match=>!match.forfeited&&match.finishedAt>event.startsAt&&!scoped.event.matches.some(accepted=>accepted.matchKey===match.matchKey)).map(match=><option key={match.matchKey} value={match.matchKey}>{date(match.finishedAt)} · {match.draw?'تعادل':match.won?'فوز الفريق':'خسارة الفريق'}</option>)}</select></label><small>تعرض آخر ٥٠ نتيجة تخصك. يجب أن تكون من المشاركين لتختار جولتك؛ يتحقق الخادم من القائمة والقواعد قبل اعتمادها.</small><Button disabled={busy||!matchKey} type="submit">مطابقة النتيجة واعتماد الجولة</Button></form>}<Button disabled={busy||scoped.event.matches.length!==3} onClick={()=>update(`/tournaments/${event.id}`,{method:'PATCH',body:{revision:event.revision,action:'close'}},'event')}>إغلاق البطولة وتثبيت الترتيب</Button></>}
        {['registration','locked'].includes(event.state)&&manage(event.role)&&<Button disabled={busy} onClick={()=>update(`/tournaments/${event.id}`,{method:'PATCH',body:{revision:event.revision,action:'cancel'}},'event')}>إلغاء البطولة</Button>}
        <p>للاعتراض على أهلية نتيجة أو مخالفة، أرسل مرجع البطولة والمباراة إلى <a href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('اعتراض بطولة مافيا '+event.id)}`}>دعم ميدان</a>. القرارات لا تُستبدل تلقائيًا بتصويت الأعضاء.</p>
      </article>}
    </>}
  </div></Modal>;
}

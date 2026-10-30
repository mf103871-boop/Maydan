import React,{useEffect,useRef,useState} from 'react';
import {Modal,Button} from '../shared/ui/components.jsx';
import {useAccount} from '../shared/account/context.js';
import {resolveServerUrl,arabicNumber} from './shared.js';
import config from '../../online.config.json';
import {newCredentials,readSaved,save} from './client.js';
import {socialInterruption} from '../social/interruption.js';
import css from './mafia.css';

const SERVER=resolveServerUrl(typeof __MAYDAN_ROOMS_URL__!=='undefined'&&__MAYDAN_ROOMS_URL__||config.serverUrl,typeof location==='undefined'?'':location.origin);
const labels={MAFIA_RANKED_ELIGIBILITY:'يلزم فهم القواعد وإكمال عشر مباريات عامة مؤهلة.',MAFIA_RANKED_COOLDOWN:'انتظر انتهاء مهلة الانسحاب قبل العودة.',MAFIA_RANKED_CLOSED:'الموسم مغلق حاليًا.',MAFIA_ACTIVE_ELSEWHERE:'لديك نشاط مافيا على هذا الحساب. أكمله أولًا.',MAFIA_RANKED_CALL_ACTIVE:'أنه المكالمة الاجتماعية قبل دخول الطابور.',MAFIA_RANKED_UNDERSTANDING:'راجع إجاباتك وحاول مجددًا.',MAFIA_DRAINING:'الطابور لا يستقبل مباريات جديدة حاليًا.',NETWORK:'تعذر الاتصال. يمكنك إعادة المحاولة.'};
const ar=arabicNumber;
const authorizationOf=account=>{const headers=account.authHeaders?.()||{};return headers.Authorization||headers.authorization||'';};
const hasQueueEvidence=result=>result?.available===true&&Object.hasOwn(result,'queue')&&(result.queue===null||result.queue&&['queued','assigned'].includes(result.queue.status));

export function MafiaRanked({onClose,onJoined}){
  const account=useAccount(),owner=account.ready&&account.signedIn?account.user?.id:null;
  const authorization=owner?authorizationOf(account):'';
  const identity=useRef({owner:null,authorization:'',epoch:0});
  if(identity.current.owner!==owner||identity.current.authorization!==authorization)identity.current={owner,authorization,epoch:identity.current.epoch+1};
  const epoch=identity.current.epoch,scope=`${owner}:${epoch}`;
  const [record,setRecord]=useState({scope:'',data:null}),[busy,setBusy]=useState(false),[error,setError]=useState(''),[answers,setAnswers]=useState([-1,-1,-1]),[board,setBoard]=useState(null);
  const data=record.scope===scope?record.data:null,key=`rankedCredentials:${owner}`;
  const credentialsRef=useRef(null),lifetime=useRef({mounted:true}),pending=useRef(new Set()),privacy=useRef(null),privacyOwner=useRef(Symbol('mafia-ranked-queue')),joined=useRef(false),commandEpoch=useRef(0),busyRef=useRef(false);
  const admission=useRef({owner:null,uncertain:false,known:false,queue:null});
  const uncertain=admission.current.owner===owner&&admission.current.uncertain;
  const current=()=>lifetime.current.mounted&&identity.current.owner===owner&&identity.current.epoch===epoch;
  async function request(path,body,signal){
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000),abort=()=>controller.abort();
    if(signal?.aborted)controller.abort();
    signal?.addEventListener('abort',abort,{once:true});pending.current.add(controller);
    try{
      const response=await fetch(`${SERVER}/api/mafia/ranked${path}`,{method:body===undefined?'GET':'POST',headers:{authorization,...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)}),credentials:'omit',cache:'no-store',signal:controller.signal});
      let result;try{result=await response.json();}catch{throw new Error('NETWORK');}
      if(!response.ok)throw new Error(result.error||'NETWORK');return result;
    }catch(error){if(error?.name==='AbortError')throw new Error('NETWORK');throw error;}
    finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);pending.current.delete(controller);}
  }
  function apply(result,confirmed=false){
    if(!current()||typeof result?.available!=='boolean')return;
    if(result.available&&!hasQueueEvidence(result))return;
    if(hasQueueEvidence(result)&&(!admission.current.uncertain||confirmed)){
      admission.current={owner,uncertain:false,known:true,queue:result.queue};
      if(result.queue){if(!privacy.current)privacy.current=socialInterruption.lockCommunication(privacyOwner.current);}
      else{privacy.current?.();privacy.current=null;}
    }
    setRecord({scope,data:result});
  }
  function enterRoom(result){
    const pendingSession=credentialsRef.current||readSaved(SERVER,key);
    if(!current()||document.hidden||joined.current||!result.queue?.code||pendingSession?.id!==result.queue.clientSeatId)return false;
    const session={...pendingSession,id:result.queue.seatId};
    joined.current=true;
    const stored=save(SERVER,result.queue.code,session);save(SERVER,`roomOwner:${result.queue.code}`,owner);save(SERVER,'lastRoom',result.queue.code);save(SERVER,'persistence',stored);
    onJoined(result.queue.code,session,stored);return true;
  }
  useEffect(()=>{
    const alive=lifetime.current,activeRequests=pending.current;
    if(admission.current.owner!==owner)admission.current={owner,uncertain:false,known:false,queue:null};
    alive.mounted=true;credentialsRef.current=owner?readSaved(SERVER,key):null;joined.current=false;busyRef.current=false;commandEpoch.current++;
    setRecord({scope,data:null});setError('');setBusy(false);setBoard(null);
    let cancelled=false,inFlight=false,timer;
    const load=async()=>{
      if(cancelled||inFlight||!owner||joined.current)return;
      if(document.hidden||busyRef.current){timer=setTimeout(load,5000);return;}
      inFlight=true;const operation=commandEpoch.current;
      try{
        // After an unknown admission outcome, a coordinator request must run
        // after the possibly committed join. A direct D1 read can be too early.
        const held=credentialsRef.current;
        const fence=admission.current.owner===owner&&admission.current.uncertain&&held;
        const snapshot=await request(fence?'/queue/status':'',fence?held:undefined);if(cancelled||!current()||operation!==commandEpoch.current)return;
        apply(snapshot,!!fence);
        const session=credentialsRef.current;
        if(!fence&&snapshot.queue?.status==='queued'&&session?.id===snapshot.queue.seatId){const next=await request('/queue/status',session);if(cancelled||operation!==commandEpoch.current)return;apply(next,true);if(next.queue?.status==='assigned')enterRoom(next);}
        else if(snapshot.queue?.status==='assigned')enterRoom(snapshot);
      }catch(e){if(!cancelled&&current())setError(e.message||'NETWORK');}
      finally{inFlight=false;if(!cancelled&&!joined.current)timer=setTimeout(load,5000);}
    };
    void load();
    return()=>{
      cancelled=true;alive.mounted=false;clearTimeout(timer);for(const controller of activeRequests)controller.abort();
      // A same-account token replacement hands the existing cover to the new
      // effect. It must not also leave an old-token reconciler owning that lock.
      if(identity.current.owner===owner&&identity.current.epoch!==epoch)return;
      // Closing via the dialog cancels first. Unexpected navigation still
      // retains privacy until the account's server activity is confirmed gone.
      const release=privacy.current;privacy.current=null;
      if(!release)return;
      // authHeaders reads AccountProvider's current session ref even when this
      // keyed dialog was unmounted rather than rendered with the next account.
      const sameSession=()=>identity.current.owner===owner&&identity.current.epoch===epoch&&authorizationOf(account)===authorization;
      if(joined.current||!sameSession()){release();return;}
      let checks=0,needsFence=admission.current.owner===owner&&admission.current.uncertain;
      const held=credentialsRef.current||readSaved(SERVER,key);
      const reconcile=async()=>{
        if(!sameSession()){release();return;}
        try{
          const fence=needsFence&&held;
          const response=await fetch(`${SERVER}/api/mafia/ranked${fence?'/queue/status':''}`,{method:fence?'POST':'GET',headers:{authorization,...(fence?{'content-type':'application/json'}:{})},...(fence?{body:JSON.stringify(held)}:{}),credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(15000)});
          if(response.ok){const state=await response.json();if(!sameSession()){release();return;}if(hasQueueEvidence(state)){needsFence=false;if(!state.queue){release();return;}}}
        }catch{/* A lost read does not authorize showing queued social content. */}
        if(++checks<400)setTimeout(reconcile,10000);
      };
      setTimeout(reconcile,1000);
    };
  // Identity epoch fences token rotation and A to B to A account transitions.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[owner,epoch]);
  async function mutate(path,body,{preserveError=false}={}){
    if(!current()||busyRef.current||!owner)return null;const operation={owner,epoch};busyRef.current=operation;commandEpoch.current++;setBusy(true);if(!preserveError)setError('');
    try{const result=await request(path,body);if(current()){apply(result,path.startsWith('/queue/'));return result;}}
    catch(e){if(current())setError(e.message||'NETWORK');}
    finally{if(busyRef.current===operation){busyRef.current=false;if(current())setBusy(false);}}
    return null;
  }
  async function join(){
    if(!current()||busyRef.current||!owner||uncertain)return;
    const session=credentialsRef.current||readSaved(SERVER,key)||newCredentials();credentialsRef.current=session;save(SERVER,key,session);
    // Suppress cached communication before the server can commit its lease.
    if(!privacy.current)privacy.current=socialInterruption.lockCommunication(privacyOwner.current);
    admission.current={...admission.current,owner,uncertain:true};
    const result=await mutate('/queue/join',session);if(result?.queue?.status==='assigned')enterRoom(result);
    if(!result&&current()){const recovered=await mutate('/queue/status',session,{preserveError:true});if(recovered?.queue?.status==='assigned')enterRoom(recovered);}
  }
  async function close(){
    if(!current()||busyRef.current)return;
    let snapshot=admission.current.owner===owner&&admission.current.known?{available:true,queue:admission.current.queue}:data;
    if(!snapshot||admission.current.uncertain){
      const held=credentialsRef.current||readSaved(SERVER,key);
      snapshot=await mutate(held?'/queue/status':'',held||undefined);
      if(!snapshot||!hasQueueEvidence(snapshot))return;
    }
    if(snapshot.queue?.status==='assigned'){if(!enterRoom(snapshot)&&current()&&!document.hidden)setError('MAFIA_ACTIVE_ELSEWHERE');return;}
    if(snapshot.queue){
      admission.current={...admission.current,owner,uncertain:true};
      const result=await mutate('/queue/cancel',{seatId:snapshot.queue.seatId,revision:snapshot.queue.revision});
      if(!result||!hasQueueEvidence(result))return;
      if(result.queue){if(result.queue.status==='assigned')enterRoom(result);return;}
    }
    if(!current()||admission.current.uncertain)return;
    privacy.current?.();privacy.current=null;onClose();
  }
  const qs=[['متى تكشف بطاقة دورك للآخرين؟',['في بداية المباراة','لا تكشف البطاقة؛ الادعاء والنقاش جزء من اللعب','بعد أول تصويت']],['هل إقصاؤك طبيعيًا يعني انسحابك؟',['لا؛ تابع دون تسريب للأحياء','نعم دائمًا','يعطيك حق إرسال تلميحات']],['هل الاشتراك يغيّر قوة الأدوار؟',['نعم','يزيد رصيد المهارة','لا؛ القدرات متساوية في النمط نفسه']]];
  return <Modal className="mafia-noir mafia-guide-dialog" title="المنافسة التجريبية" onClose={close}><style>{css}</style><div className="mafia-guide stack" dir="rtl">
    <p className="mafia-notice">معاينة تجريبية غير معايرة. ثمانية مقاعد بأسماء مؤقتة وقواعد أساسية ثابتة ونص فقط. تتوقف المحادثات والمكالمات الاجتماعية أثناء الطابور والمباراة.</p>
    {error&&<p role="alert">{labels[error]||'تعذر إتمام الطلب. حدّث الحالة وحاول مجددًا.'}</p>}
    {uncertain&&<p role="status">لم نتأكد من حالة حجزك بعد. أبقينا خصوصية التواصل حتى نتحقق.</p>}
    {!data?<p role="status">نحمّل الموسم والتقدم…</p>:!data.available?<p>المنافسة غير متاحة في هذه البيئة.</p>:<>
      <p>{data.season?'موسم المنافسة التجريبي':'لا موسم مفتوح'} · {data.season?.status==='open'?'مفتوح':data.season?.status==='closing'?'يصفّي المباريات':'مغلق'}</p>
      {data.canManageSeasons&&data.season&&data.season.status!=='closed'&&<Button disabled={busy||data.season.endsAt>Date.now()} onClick={async()=>{const result=await mutate('/season/close',{seasonId:data.season.id});if(result)try{apply(await request(''));}catch(e){if(current())setError(e.message);}}}>إغلاق الموسم وتثبيت ترتيب ومكافآت المؤهلين</Button>}
      <p><strong>{data.rating.band}</strong> · {ar(data.rating.rating)} نقطة · {ar(data.rating.games)} مباراة{data.rating.provisional?` · باقي ${ar(data.rating.placementRemaining)} لتحديد المرتبة`:''}</p>
      <p>تقدم الأهلية: {ar(data.eligibility.publicMatches)} / ١٠ مباريات عامة مؤهلة · فهم القواعد: {data.eligibility.understands?'مكتمل':'مطلوب'}</p>
      {data.matchmaking?.skillBased&&<p className="mafia-muted">نبحث عن لاعبين بمستوى متقارب، ويتسع نطاق البحث تدريجيًا أثناء انتظارك. نحتاج ثمانية لاعبين متوافقين؛ لا يوجد موعد مضمون لبدء المباراة.</p>}
      {!data.eligibility.understands&&!data.queue&&!uncertain&&<fieldset disabled={busy}><legend>فحص فهم بديل عن إكمال الدرس</legend>{qs.map(([question,options],i)=><label className="stack" key={question}>{question}<select value={answers[i]} onChange={e=>setAnswers(old=>old.map((v,j)=>i===j?Number(e.target.value):v))}><option value={-1}>اختر إجابتك</option>{options.map((option,j)=><option key={option} value={j}>{option}</option>)}</select></label>)}<Button disabled={answers.includes(-1)||busy} onClick={()=>mutate('/understanding',{answers})}>تأكيد الفهم</Button></fieldset>}
      {data.eligibility.cooldownUntil>Date.now()&&<p>مهلة العودة بعد الانسحاب تنتهي عند {new Date(data.eligibility.cooldownUntil).toLocaleTimeString('ar')}.</p>}
      {uncertain?<Button disabled={busy} onClick={close}>التحقق وإلغاء الانتظار</Button>:data.queue?<><p role="status">{data.queue.status==='assigned'?'اكتملت المقاعد؛ ندخلك إلى المباراة.':`أنت في الطابور · ${ar(data.waiting)} / ٨ متاحين. ينتهي الحجز إذا غادر جهازك ولم يعد خلال دقيقتين.`}</p><Button disabled={busy} onClick={close}>{data.queue.status==='assigned'?'متابعة المباراة على هذا الجهاز':'إلغاء الانتظار وإغلاق'}</Button></>:<Button disabled={busy||!data.eligibility.eligible||data.season?.status!=='open'} onClick={join}>دخول طابور فردي</Button>}
      {!data.queue&&!uncertain&&<Button disabled={busy} onClick={async()=>{setBusy(true);setError('');try{const result=await request('/leaderboard');if(current())setBoard({scope,rows:result.rows});}catch(e){if(current())setError(e.message);}finally{if(current())setBusy(false);}}}>الترتيب التجريبي بأسماء مؤقتة</Button>}
      {board?.scope===scope&&!data.queue&&<ol>{board.rows.length?board.rows.map(row=><li key={row.alias}>{row.own?'أنت':`مشارك ${row.alias}`} · {row.band} · {ar(row.rating)} · {ar(row.games)} مباراة</li>):<li>لا مشاركين أكملوا التحديد بعد.</li>}</ol>}
      <p className="mafia-muted">أول عشر مباريات تحدد المرتبة. الإقصاء الطبيعي يحتفظ بالنتيجة؛ الانسحاب المستحق يخفض التصنيف ويمنع العودة ١٥ دقيقة. الإلغاء التقني بلا تصنيف. مكافأة إغلاق الموسم تجميلية بعد عشر مباريات، ولا تتكرر بإعادة الإغلاق. الأرقام والرتب الحالية تجريبية وقد تتغير بين المواسم.</p>
    </>}
  </div></Modal>;
}

import React, { useEffect, useRef, useState } from 'react';
import { Button, Card, ConfirmModal, Modal } from '../shared/ui/components.jsx';
import { ProfileAvatar } from '../profiles/ProfileAvatar.jsx';
import { Avatar } from '../shared/brand/art.jsx';
import { MafiaIcon, MafiaRoleArt } from '../games/mafia/icon.jsx';
import { MAFIA_DEFAULT_SETTINGS, MAFIA_ROLES, MAFIA_PHASES, MAFIA_FACTIONS } from './mafia-shared.js';
import { arabicNumber, errorText } from './shared.js';
import css from './mafia.css';

const ar = arabicNumber;
const label = value => typeof value === 'string' ? value : value?.name || value?.label || '';
const phaseLabel = phase => label(MAFIA_PHASES[phase]) || 'مجلس ميدان';
const factionLabel = faction => label(MAFIA_FACTIONS[faction]) || 'غير معلن';
const noop = () => {};
const isActive = state => !['lobby', 'over', 'closed', 'waiting'].includes(state.phase) && !state.waiting;
const nameOf = (members, id) => members.find(player => player.id === id)?.name || 'لاعب';

export function normalizeMafiaSettings(value = {}) {
  const mode = value.mode === 'shadow' ? 'shadow' : 'classic';
  const min = mode === 'shadow' ? 9 : 6, max = mode === 'shadow' ? 12 : 8;
  return { mode, capacity: Math.max(min, Math.min(max, Number(value.capacity) || (mode === 'shadow' ? 10 : 8))), visibility: value.visibility === 'public' ? 'public' : 'private' };
}

export function MafiaSettings({ value = MAFIA_DEFAULT_SETTINGS, onChange = noop, disabled = false }) {
  const settings = normalizeMafiaSettings(value);
  return <section data-design-screen="online.mafia.setup" className="mafia-settings stack" aria-label="إعداد مافيا ميدان"><style>{css}</style>
    <div data-design-id="mode-choice" className="mafia-mode-picker" role="group" aria-label="طور المباراة">{[['classic','المجلس الأساسي','٦–٨ لاعبين · فريقان'],['shadow','رابطة الظل','٩–١٢ لاعبًا · ثلاثة أطراف']].map(([mode,title,detail]) => <button data-design-id="mode-option" type="button" key={mode} disabled={disabled} aria-pressed={settings.mode === mode} onClick={() => onChange(normalizeMafiaSettings({ ...settings, mode, capacity: mode === 'shadow' ? 10 : 8 }))}><strong>{title}</strong><small>{detail}</small></button>)}</div>
    <div className="mafia-settings-row"><label>سعة المجلس<select data-design-id="capacity" value={settings.capacity} disabled={disabled} onChange={event => onChange({ ...settings, capacity: Number(event.target.value) })}>{(settings.mode === 'shadow' ? [9,10,11,12] : [6,7,8]).map(n => <option key={n} value={n}>{ar(n)} لاعبين</option>)}</select></label>
      <label>ظهور الغرفة<select data-design-id="visibility" disabled={disabled} value={settings.visibility} onChange={event => onChange({ ...settings, visibility: event.target.value })}><option value="private">خاصة · برمز أو دعوة</option><option value="public">عامة · يستقبل المجلس لاعبين</option></select></label></div>
    <p className="mafia-muted">حساب لكل لاعب. استضافة تجربة مجانية ثم بلس؛ الانضمام مجاني. لا تُباع قوة أو أفضلية في الأدوار.</p><MafiaRules />
  </section>;
}

export function MafiaRules({ possibleRoles, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  const [lesson, setLesson] = useState(0);
  const lessons = [
    ['ابدأ من كلامهم', 'مثال تدريبي: ليان تقول «شاهدت عمر يتحرك ليلًا». هذا يثبت نشاطًا فقط، ولا يثبت فريقه. اسألها عن الليلة ونوع المعلومة.'],
    ['فرّق بين الدليل والادعاء', 'كل شخص يستطيع الادعاء بأنه المحقق. لا يرى الآخرون بطاقته. التحقيق يتأثر بالتمويه، والفريق قد يتغير بعد التجنيد.'],
    ['اسمع الدفاع ثم احكم', 'الترشيح يحدد مشتبهًا واحدًا. له ٢٠ ثانية للدفاع، ثم يصوّت الأحياء سرًا. يلزم أكثر من نصفهم للإقصاء.'],
    ['كل ليلة تغيّر المجلس', 'اختيارات الليل قابلة للتعديل حتى يغلق الخادم المرحلة. بعد الإقصاء تابع الأحداث، دون إرسال تلميحات للأحياء.'],
  ];
  return <>{!defaultOpen && <Button data-design-id="rules" variant="ghost" full onClick={() => setOpen(true)}>{possibleRoles ? 'أدوار هذا المجلس ودليل اللعب' : 'دليل المجلس والأدوار الاثنا عشر'}</Button>}{open && <Modal data-design-screen="online.mafia.guide" title="دليل مافيا ميدان" onClose={() => setOpen(false)}><div className="mafia-guide stack"><span className="mafia-kicker">تدريب توضيحي · شخصيات افتراضية</span><h3>{lessons[lesson][0]}</h3><p>{lessons[lesson][1]}</p><div className="row-between"><Button data-design-id="back" disabled={!lesson} onClick={() => setLesson(lesson - 1)}>السابق</Button><span>{ar(lesson + 1)} / ٤</span><Button data-design-id="continue" disabled={lesson === lessons.length - 1} onClick={() => setLesson(lesson + 1)}>التالي</Button></div><p className="mafia-muted">هذه موسوعة القدرات؛ وجود دور هنا لا يعني أنه موزّع في المباراة الحالية.</p><div className="mafia-role-catalog">{Object.values(MAFIA_ROLES).filter(role => !possibleRoles || possibleRoles.includes(role.id)).map(role => <article key={role.id} className={`mafia-role-tile faction-${role.faction}`}><MafiaRoleArt roleId={role.id}/><div><h4>{role.name}</h4><small>{factionLabel(role.faction)}</small><p>{role.description} </p></div></article>)}</div></div></Modal>}</>;
}

export function MafiaDirectory({ rooms = [], enabled, loading, error, mode, onMode = noop, onRefresh = noop, onQuickJoin = noop, onJoin = noop, disabled }) {
  return <section data-design-screen="online.mafia.directory" className="mafia-directory stack"><style>{css}</style><div data-design-id="header"><span className="mafia-kicker">مكانك حول المجلس</span><h2>مجالس تنتظرك</h2><p>انضم مجانًا. الانضمام السريع يبحث عن غرفة موجودة ولا يستهلك تجربتك.</p></div><label>نوع المجلس<select data-design-id="directory-mode" value={mode} onChange={e => onMode(e.target.value)}><option value="classic">الأساسي · ٦–٨</option><option value="shadow">رابطة الظل · ٩–١٢</option></select></label><div data-design-id="actions" className="mafia-settings-row"><Button data-design-id="quick-join" disabled={disabled || loading || enabled !== true} onClick={onQuickJoin}>انضمام سريع</Button><Button data-design-id="refresh" variant="secondary" disabled={loading} onClick={onRefresh}>{loading ? 'نبحث عن مجالس…' : 'تحديث المجالس'}</Button></div>{error && <p role="alert" className="mafia-notice">{errorText(error)}</p>}{enabled === false && <p data-design-id="notice" role="status">المجالس الجديدة غير متاحة حاليًا. المباريات القائمة تتابع حتى نهايتها.</p>}{loading && <p data-design-id="loading" role="status">نحمّل الغرف المتاحة…</p>}{!loading && enabled === true && rooms.length === 0 && <p data-design-id="empty" className="mafia-empty">لا يوجد مجلس ينتظر الآن. أنشئ غرفة وادعُ أصحابك، أو جرّب مجددًا لاحقًا.</p>}<div data-design-id="rooms" className="mafia-room-list">{rooms.map(room => <Card key={room.code} className="mafia-directory-room"><div><b>مجلس {room.hostName}</b><small>{room.mode === 'shadow' ? 'رابطة الظل' : 'المجلس الأساسي'} · {ar(room.players)} / {ar(room.capacity)} · {ar(room.ready)} جاهز</small></div><Button data-design-id="room-join" disabled={disabled || room.players >= room.capacity || enabled !== true} onClick={() => onJoin(room.code)}>انضم</Button></Card>)}</div></section>;
}

export function MafiaLobbyInfo({ state }) {
  return <Card className="mafia-lobby-info stack"><style>{css}</style><div className="mafia-lobby-art"><MafiaIcon /><div><span className="mafia-kicker">المجلس ينتظر اللّمّة</span><h2>{state.settings?.mode === 'shadow' ? 'رابطة الظل' : 'المجلس الأساسي'}</h2><p>{ar(state.settings?.capacity || 8)} مقاعد · {state.settings?.visibility === 'public' ? 'غرفة عامة' : 'غرفة خاصة'}</p></div></div><p>جهّز السماعات إن أمكن. يمكنك الاستماع والكتابة دون تشغيل الميكروفون. تُشرح بطاقتك سرًا عند بداية المباراة.</p>{state.composition && <p>التشكيل المتوقع عند اكتمال السعة: {ar(state.composition.mafia)} مافيا · {ar(state.composition.town)} من أهل الميدان{state.composition.shadow ? ` · ${ar(state.composition.shadow)} قائد للرابطة` : ''}. يثبت التوزيع بحسب عدد الجاهزين عند البداية.</p>}<p className="mafia-muted">الأدوار الفعلية لا يراها المضيف؛ توزّعها اللعبة عند البداية. من يدخل متأخرًا ينتظر المباراة التالية.</p><MafiaRules possibleRoles={state.possibleRoles}/></Card>;
}

function useCountdown(deadline, offset, preview, serverNow) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { if (!deadline || preview) return undefined; const timer = setInterval(() => setNow(Date.now()), 250); return () => clearInterval(timer); }, [deadline, preview]);
  return deadline ? Math.max(0, Math.ceil((deadline - (preview && Number.isFinite(serverNow) ? serverNow : now + offset)) / 1000)) : null;
}
function SecretCard({ you, hidden, onHide, previewReveal }) {
  const [revealed, setRevealed] = useState(Boolean(previewReveal));
  useEffect(() => { if (hidden) setRevealed(false); }, [hidden]);
  const role = MAFIA_ROLES[you?.roleId];
  if (!role || hidden) return hidden ? <div data-design-id="privacy" data-design-required="true" className="mafia-secret-cover">بطاقتك محجوبة لحماية دورك</div> : null;
  return <section data-design-id="role-card" className={`mafia-secret faction-${you.faction}`}><div className="mafia-secret-top"><span>بطاقتك الخاصة</span><Button data-design-id="role-toggle" size="sm" variant="ghost" aria-expanded={revealed} onClick={() => { setRevealed(!revealed); onHide?.(); }}>{revealed ? 'إخفاء البطاقة' : 'اكشف بطاقتي'}</Button></div>{revealed ? <div data-design-id="role-content" className="mafia-secret-content"><MafiaRoleArt roleId={role.id}/><div><strong>{role.name}</strong><small>انتماؤك الآن: {factionLabel(you.faction)}</small><p>{role.description}</p></div></div> : <div className="mafia-secret-closed"><MafiaIcon/><p>السر عندك… لا تعرض بطاقتك للآخرين.</p></div>}</section>;
}

function eventText(event, members) {
  if (typeof event === 'string') return event;
  if (event.text || event.message) return event.text || event.message;
  const person = nameOf(members, event.playerId || event.targetId);
  const texts = { eliminated: `${person} غادر المجلس`, dawn: event.peaceful ? 'أشرقت الشمس دون إقصاء ليلي' : 'أشرقت شمس جديدة على المجلس', match_started:'بدأ المجلس وتوزعت الأدوار سرًا', night_started:'بدأ الليل؛ اتبع قناتك وتعليمات دورك', match_ended:'انتهت المباراة', host_changed:`انتقلت إدارة الغرفة إلى ${person}`, nomination_closed:event.nomineeId ? `المرشح للدفاع: ${nameOf(members,event.nomineeId)}` : 'تعادل الترشيح؛ لا مرشح لهذه الليلة', verdict_closed:event.passed ? 'وافق المجلس على الإقصاء' : 'رفض المجلس الإقصاء', no_elimination: 'مرّت الليلة دون إقصاء', extended: 'المنادي أضاف ٢٠ ثانية للنقاش', nomination_tie: 'تعادل الترشيح، يواصل الجميع إلى الليل', faction_revealed: `${person}: ${factionLabel(event.faction)}`, disconnected: `${person} انقطع اتصاله`, reconnected: `${person} عاد للمجلس`, withdrawal: `${person} انسحب` };
  if(event.type==='roles') return 'توزعت الأدوار الأولية كما تظهر في البطاقات.';
  if(event.type==='night_action') return `${person} استخدم قدرة ${MAFIA_ROLES[event.roleId]?.name || 'دوره'} تجاه ${(event.targetIds || [event.targetId]).filter(Boolean).map(id=>nameOf(members,id)).join(' و') || 'هدفه'}.`;
  if(event.type==='attack_vote') return `${person} اختار ${nameOf(members,event.targetId)} لهجوم المافيا.`;
  if(event.type==='nomination_vote') return event.targetId ? `${person} رشّح ${nameOf(members,event.targetId)}.` : `${person} امتنع عن الترشيح.`;
  if(event.type==='verdict_votes') return `حكم المجلس على ${nameOf(members,event.nomineeId)}: ${ar(Object.values(event.votes || {}).filter(Boolean).length)} أصوات موافقة.`;
  if(event.type==='converted') return `انضم ${person} إلى رابطة الظل بتجنيد ${nameOf(members,event.recruiterId)}.`;
  if(event.type==='shield_used') return `${person} نجا بحمايته الذاتية.`;
  return texts[event.type] || texts[event.kind] || 'تحديث في المجلس';
}

function reportText(report,members) {
  if(report.text || report.message) return report.text || report.message;
  if(report.type==='converted') return 'انضممت إلى رابطة الظل. تغير فريقك وشرط فوزك، وبقي دورك وقدراتك المتاحة.';
  if(report.type==='recruitment') return report.success ? `انضم ${nameOf(members,report.targetId)} إلى رابطة الظل.` : 'لم تنجح محاولة التجنيد. لا يُكشف سبب الفشل.';
  if(report.type==='shield_used') return 'أنقذتك حمايتك الذاتية من هجوم هذه الليلة. استُهلكت الحماية الوحيدة.';
  if(report.type==='no_result') return 'لم تحصل على نتيجة لهذا الفحص. لا يُكشف سبب تعذّر النتيجة.';
  if(report.faction) return `${nameOf(members,report.targetId)}: ${factionLabel(report.faction)} وقت الفحص.`;
  if(report.same!==undefined) return `${(report.targetIds||[]).map(id=>nameOf(members,id)).join(' و')}: الانتماء الظاهر ${report.same?'متطابق':'مختلف'}.`;
  if(report.acted!==undefined) return `${nameOf(members,report.targetId)} ${report.acted?'قدّم فعلًا ليليًا مقبولًا غير معطّل':'لم يُرصد له فعل ليلي مقبول غير معطّل'}.`;
  return 'انتهى فحصك لهذه الليلة.';
}

function MafiaVoice({ voice = {}, state }) {
  const connected = ['connected','on','silent'].includes(voice.status);
  const [actionError,setActionError] = useState('');
  const run = async task => {setActionError('');try{await task?.();}catch(error){setActionError(/[\u0600-\u06ff]/.test(error?.message || '')?error.message:'تعذّر تنفيذ أمر الصوت. حاول مجددًا.');}};
  return <div data-design-id="voice" data-design-required="true" className="mafia-voice"><div><b>{connected ? 'صوت المجلس متصل' : voice.status === 'connecting' || voice.status === 'reconnecting' ? 'نؤمّن الاتصال الصوتي…' : 'اسمع المجلس وشارك بصوتك'}</b><small>{state.phase === 'night' ? 'مسارات الليل معزولة حسب الفريق' : state.phase === 'defense' ? 'الصوت للمرشح فقط أثناء الدفاع' : 'الميكروفون اختياري؛ الكتابة متاحة حسب المرحلة'}</small></div><div className="mafia-voice-actions">{connected ? <><Button data-design-id="mute" disabled={!voice.onMute || !voice.canPublish} onClick={() => run(() => voice.onMute(!voice.muted))}>{voice.muted || !voice.canPublish ? 'شغّل الميكروفون' : 'اكتم الميكروفون'}</Button>{voice.onSpeaker && voice.audioOutputs?.length > 0 && <label><span className="sr-only">مخرج الصوت</span><select aria-label="مخرج الصوت" data-design-id="audio-output" value={voice.outputId || 'default'} onChange={event => run(() => voice.onSpeaker(event.target.value))}>{voice.audioOutputs.map(output => <option key={output.id || output.deviceId} value={output.id || output.deviceId}>{output.label || 'السماعة'}</option>)}</select></label>}<Button data-design-id="voice-leave" variant="ghost" onClick={() => run(voice.onLeave)}>افصل الصوت</Button></> : <Button data-design-id="voice-join" disabled={!voice.onJoin || voice.status === 'connecting'} onClick={() => run(voice.onJoin)}>الانضمام بالصوت</Button>}</div>{(voice.error || actionError) && <p role="alert">{actionError || (/[\u0600-\u06ff]/.test(voice.error) ? voice.error : errorText(voice.error))}</p>}</div>;
}

function MafiaChat({ state, you, me, members, disabled, act }) {
  const draftKey = `${me?.id}:${state.matchId}:${state.phaseId}`;
  const [draft,setDraft] = useState({key:draftKey,text:''});
  const text = draft.key === draftKey ? draft.text : '';
  const setText = value => setDraft({key:draftKey,text:value});
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [channel, setChannel] = useState('public');
  const list = useRef(null);
  const alive = Boolean(me?.alive && !you?.pendingForfeit);
  const team = alive && state.phase === 'night' && ['mafia','shadow'].includes(you?.faction);
  const observer = !alive && !!you?.roleId;
  const allowedChannel = team ? 'team' : observer ? 'observers' : 'public';
  const writable = team || observer || (alive && ['opening','discussion'].includes(state.phase)) || (alive && state.phase === 'defense' && state.nomineeId === me.id);
  const actualChannel = channel === 'public' && observer ? 'public' : allowedChannel;
  const chats = Array.isArray(state.chats) ? state.chats : state.chats?.[actualChannel] || [];
  const messages = chats.filter(item => !item.channel || item.channel === actualChannel);
  useEffect(() => { setDraft({key:`${me?.id}:${state.matchId}:${state.phaseId}`,text:''}); setError(''); setChannel(allowedChannel); }, [me?.id,state.matchId,state.phaseId,allowedChannel]);
  useEffect(() => { if (list.current) list.current.scrollTop = list.current.scrollHeight; }, [messages.length]);
  async function send(event) {
    event.preventDefault(); if (!text.trim() || disabled || sending || !writable || actualChannel !== allowedChannel) return;
    setSending(true); setError('');
    try { const ok = await act('chat', { channel: allowedChannel, text: text.trim(), clientId: crypto.randomUUID() }); if (ok !== false) setText(''); }
    catch { setError('تعذّر إرسال الرسالة. جرّب مجددًا.'); }
    finally { setSending(false); }
  }
  return <section data-design-id="chat" className="mafia-chat"><div className="mafia-panel-heading"><h3>{actualChannel === 'team' ? 'حديث الفريق · سري' : actualChannel === 'observers' ? 'مجلس المقصيين' : 'حديث المجلس'}</h3>{observer && <Button data-design-id="chat-channel" size="sm" onClick={() => setChannel(channel === 'public' ? 'observers' : 'public')}>{channel === 'public' ? 'حديث المقصيين' : 'متابعة الأحياء'}</Button>}</div><div data-design-id="messages" ref={list} className="mafia-chat-messages" role="log" aria-live="polite" aria-relevant="additions">{messages.length ? messages.map((message,i) => <p key={message.id || message.clientId || i}><b>{nameOf(members,message.senderId || message.playerId)}:</b> {message.text}</p>) : <p className="mafia-muted">{writable ? 'ابدأ بكلمة… واستمع للأدلة.' : 'تظهر هنا الرسائل المسموحة لهذه المرحلة.'}</p>}</div>{writable && actualChannel === allowedChannel ? <form data-design-id="composer" onSubmit={send}><label className="sr-only" htmlFor="mafia-message">رسالتك إلى {actualChannel === 'team' ? 'الفريق' : 'المجلس'}</label><input data-design-id="message-input" id="mafia-message" maxLength={400} autoComplete="off" value={text} onChange={e => setText(e.target.value)} placeholder="اكتب رسالتك…" disabled={disabled || sending}/><Button data-design-id="send" type="submit" disabled={disabled || sending || !text.trim()}>إرسال</Button></form> : <p className="mafia-muted">{observer ? 'تتابع الأحياء دون إرسال رسائل إليهم.' : 'الكتابة العامة متوقفة في هذه المرحلة.'}</p>}{error && <p role="alert">{error}</p>}</section>;
}

function ActionPanel({ state, you, me, members, disabled, act }) {
  const [selected, setSelected] = useState([]);
  const [confirm, setConfirm] = useState(null);
  const [nightTool,setNightTool] = useState(you?.actions?.some(action=>action.type==='mafia_vote') ? 'attack' : 'ability');
  useEffect(() => { setSelected([]); setConfirm(null); }, [state.phaseId, state.matchId]);
  if (!me?.alive || !you?.roleId) return null;
  const actions = Array.isArray(you.actions) ? you.actions : [];
  const rawAbility = actions.find(action => action.type === 'night_action');
  const ballot = actions.find(action => action.type === 'mafia_vote');
  const ability = ballot && nightTool === 'attack' ? null : rawAbility;
  const showBallot = !!ballot && (!rawAbility || nightTool === 'attack');
  const nominationAction = actions.find(action => action.type === 'nominate');
  const nomination = state.phase === 'nomination' && !you.nominationSubmitted && !!nominationAction;
  const verdict = state.phase === 'verdict' && !you.verdictSubmitted && actions.some(action => action.type === 'verdict');
  const pick = target => setSelected(old => you.roleId === 'analyst' && ability ? old.includes(target) ? old.filter(id => id !== target) : [...old.slice(-1),target] : [target]);
  const targetIds = nomination ? nominationAction.targets : ability?.targets || [];
  const actionLabel = state.phase === 'night' ? 'اختيارك الليلي' : phaseLabel(state.phase);
  const submit = async () => { await act(nomination ? 'nominate' : 'night_action', nomination ? { targetId: selected[0] || null } : you.roleId === 'analyst' ? { targetIds: selected } : { targetId: selected[0] }); };
  return <section data-design-id="ability" className="mafia-ability"><h3>{showBallot ? 'اختيار المافيا الليلي' : actionLabel}</h3>{rawAbility && ballot && <div className="mafia-action-tabs" role="group" aria-label="إجراءاتك الليلية"><Button data-design-id="night-attack-tab" aria-pressed={nightTool==='attack'} onClick={()=>setNightTool('attack')}>الهجوم المشترك</Button><Button data-design-id="night-ability-tab" aria-pressed={nightTool==='ability'} onClick={()=>setNightTool('ability')}>قدرتي · {ar(rawAbility.remaining)} متاح</Button></div>}{ability?.remaining != null && <p className="mafia-muted">متاح من قدرتك: {ar(ability.remaining)}.</p>}{(ability || nomination) && <><p>{nomination ? 'اختر مشتبهًا أو امتنع. لا يتغير صوتك بعد التأكيد.' : you.roleId === 'analyst' ? 'اختر لاعبين مختلفين للمقارنة.' : 'اختر الهدف. يمكنك تغيير اختيارك حتى ينتهي الليل.'}</p><div data-design-id="targets" className="mafia-target-grid">{targetIds.map(target => { const id = typeof target === 'string' ? target : target.id; const player = members.find(p => p.id === id); return player && <button data-design-id="target" type="button" key={id} aria-pressed={selected.includes(id)} disabled={disabled} onClick={() => pick(id)}><span>#{ar(player.seat || members.indexOf(player) + 1)}</span>{player.name}</button>; })}</div><Button data-design-id="ability-submit" disabled={disabled || selected.length < (you.roleId === 'analyst' && ability ? 2 : 1)} onClick={() => nomination ? setConfirm({ kind: 'nominate', targetId: selected[0] }) : submit()}>{nomination ? 'تأكيد الترشيح' : 'اعتماد اختيار الليل'}</Button>{nomination && <Button data-design-id="abstain" variant="ghost" disabled={disabled} onClick={() => setConfirm({ kind: 'nominate', targetId: null })}>امتنع عن الترشيح</Button>}{you.nightAction && <><p role="status">اختيارك محفوظ لهذه الليلة. يمكنك تغييره قبل نهاية الوقت.</p><Button data-design-id="cancel-ability" variant="ghost" disabled={disabled} onClick={() => act('night_action',{targetId:null})}>إلغاء اختيار الليل</Button></>}</>}
    {showBallot && <div className="mafia-kill-ballot"><p>الأعلى أصواتًا يُستهدف؛ التعادل يعني عدم الهجوم.</p><div className="mafia-target-grid">{ballot.targets.map(target => { const id = typeof target === 'string' ? target : target.id; const player = members.find(p => p.id === id); return player && <button data-design-id="mafia-vote" key={id} type="button" aria-pressed={you.killTarget === id} disabled={disabled} onClick={() => act('mafia_vote', { targetId: id })}>{player.name}</button>; })}</div><Button data-design-id="abstain" variant="ghost" disabled={disabled} onClick={() => act('mafia_vote', { targetId: null })}>لا أختار هدفًا</Button></div>}
    {verdict && <><p>هل تؤيد إقصاء <b>{nameOf(members,state.nomineeId)}</b>؟ يلزم أكثر من نصف الأحياء. صوتك نهائي.</p><div className="mafia-settings-row"><Button data-design-id="verdict-yes" disabled={disabled} onClick={() => setConfirm({ kind:'verdict', approve:true })}>أوافق على الإقصاء</Button><Button data-design-id="verdict-no" variant="secondary" disabled={disabled} onClick={() => setConfirm({ kind:'verdict', approve:false })}>أرفض الإقصاء</Button></div></>}
    {actions.some(action => action.type === 'herald') && <Button data-design-id="herald" disabled={disabled} onClick={() => setConfirm({kind:'herald'})}>استخدم المنادي · أضف ٢٠ ثانية</Button>}
    {!ability && !ballot && !nomination && !verdict && <p className="mafia-muted">{state.phase === 'night' ? 'لا إجراء متاح لك الآن. تابع المرحلة واحتفظ بملاحظاتك.' : 'تابع النقاش؛ الإجراءات المتاحة تظهر هنا في وقتها.'}</p>}
    {confirm && <ConfirmModal title="تؤكد اختيارك؟" message={confirm.kind === 'herald' ? 'تُستخدم قدرة المنادي مرة واحدة في المباراة.' : confirm.kind === 'verdict' ? confirm.approve ? 'تؤيد إقصاء المرشح. لا يمكنك تغيير الحكم بعد التأكيد.' : 'ترفض إقصاء المرشح. لا يمكنك تغيير الحكم بعد التأكيد.' : confirm.targetId ? `ترشّح ${nameOf(members,confirm.targetId)}. لن يتغير صوتك بعد التأكيد.` : 'تمتنع عن الترشيح لهذه الجولة.'} confirmLabel="اعتمد اختياري" onCancel={() => setConfirm(null)} onConfirm={async () => { const {kind,...fields} = confirm; const ok = await act(kind,fields); if (ok !== false) setConfirm(null); }}/>}
  </section>;
}

export function MafiaMatch({ state, me, isHost, disabled = false, act = noop, clockOffset = 0, accountId = '', voice = {}, onSafety }) {
  const [hidden, setHidden] = useState(() => typeof document !== 'undefined' && document.hidden);
  const notesKey = `${accountId}:${state.matchId}`;
  const [noteDraft, setNoteDraft] = useState({key:notesKey,text:''});
  const notes = noteDraft.key === notesKey ? noteDraft.text : '';
  const setNotes = text => setNoteDraft({key:notesKey,text});
  const [tab, setTab] = useState(state._designPreview && state.previewTab || 'council');
  const [safety, setSafety] = useState(null);
  const remaining = useCountdown(state.deadlineAt, clockOffset, state._designPreview, state.serverNow);
  const you = state.waiting || (state.you?.id && state.you.id !== me?.id) ? null : state.you;
  const members = state.members || [];
  useEffect(() => { setNoteDraft({key:`${accountId}:${state.matchId}`,text:''}); setTab(state._designPreview && state.previewTab || 'council'); setSafety(null); }, [accountId, state.matchId, state._designPreview, state.previewTab]);
  useEffect(() => { const cover = () => setHidden(document.hidden); document.addEventListener('visibilitychange', cover); return () => document.removeEventListener('visibilitychange', cover); }, []);
  const finished = ['over','closed'].includes(state.phase);
  const resultTitle = state.reason === 'voice_unavailable' ? 'انتهت المباراة بسبب الاتصال' : state.outcome?.faction === 'draw' || state.outcome === 'draw' ? 'المجلس انتهى بالتعادل' : state.phase === 'closed' && !state.outcome ? 'انتهت صلاحية الغرفة' : `النتيجة: ${factionLabel(typeof state.outcome === 'string' ? state.outcome : state.outcome?.faction || state.outcome?.winner)}`;
  const speaking = new Set((voice.participants || []).filter(p => p.speaking && !p.muted).map(p => p.id || p.identity));
  const seats = <div data-design-id="players" className="mafia-seats" aria-label="مقاعد المجلس">{members.filter(p => !p.spectator).map((player,i) => <button data-design-id="player-seat" key={player.id} type="button" disabled={player.id === me?.id || !onSafety} onClick={() => {setSafety(player);}} className={`mafia-seat ${!player.alive ? 'eliminated' : ''} ${speaking.has(player.id) ? 'speaking' : ''}`} aria-label={`المقعد ${player.seat || i+1}، ${player.name}${player.id === me?.id ? '، أنت' : ''}، ${player.alive ? 'في المجلس' : 'مقصي'}${speaking.has(player.id) ? '، يتحدث الآن' : ''}`}><span className="mafia-seat-number">{ar(player.seat || i+1)}</span>{player.profile ? <ProfileAvatar user={player.profile} size={44}/> : <Avatar index={player.avatar || 0}/>}<b>{player.id === me?.id ? 'أنت' : player.name}</b><small>{!player.connected ? 'يعيد الاتصال' : !player.alive ? 'يتابع' : speaking.has(player.id) ? 'يتحدث الآن' : 'في المجلس'}</small></button>)}</div>;
  if (hidden && isActive(state)) return <MafiaPrivacy/>;
  if (state.waiting) return <section data-design-screen="online.mafia.waiting" className="mafia-shell mafia-waiting"><style>{css}</style><MafiaIcon/><h2>المجلس بدأ، ومكانك محفوظ</h2><p data-design-id="notice">تدخل في المباراة التالية. لا تُعرض لك أدوار أو محادثات المباراة الجارية.</p><MafiaRules/></section>;
  return <section data-design-screen={state._designPreview && state.previewScene || `online.mafia.${state.phase}`} className={`mafia-shell phase-${state.phase}`} dir="rtl"><style>{css}</style>
    <header data-design-id="header" className="mafia-heading"><div><span className="mafia-kicker">مافيا ميدان · {state.settings?.mode === 'shadow' ? 'رابطة الظل' : 'المجلس الأساسي'}</span><h1 data-design-id="phase-title">{phaseLabel(state.phase)}</h1><p>{finished ? 'انكشف المجلس… حان وقت الحكايات' : `اليوم ${ar(state.round || 1)} · ${ar(members.filter(p => p.alive).length)} أحياء`}</p></div>{remaining !== null && !finished && <div data-design-id="timer" data-design-required="true" className={`mafia-clock ${remaining <= 10 ? 'urgent' : ''}`} role="timer" aria-label={`${ar(remaining)} ثانية متبقية`}><b>{ar(remaining)}</b><small>ثانية</small></div>}</header>
    {isActive(state) && <MafiaVoice voice={voice} state={state}/>}
    {!finished && you?.roleId && <SecretCard key={`${accountId}:${state.matchId}:${you.roleId}:${you.faction}`} you={you} hidden={hidden} previewReveal={state._designPreview && state.previewReveal}/>}
    {!finished && me && !me.alive && <p data-design-id="observer-notice" className="mafia-notice">أنت الآن تتابع المجلس. لا يمكنك توجيه الأحياء؛ نتيجتك مع فريقك تُسجّل عند النهاية، ويمكنك الخروج من المشاهدة.</p>}
    {state.phase === 'defense' && <p data-design-id="defense" className="mafia-notice"><b>{nameOf(members,state.nomineeId)}</b>، المجلس يسمع دفاعك الآن. الصوت والكتابة للمرشح وحده.</p>}
    {state.phase === 'night' && <ActionPanel key={`night:${accountId}:${state.matchId}:${state.phaseId}:${you?.roleId}`} state={state} you={you || {}} me={me} members={members} disabled={disabled} act={act}/>}
    {state.phase === 'night' ? <details data-design-id="players-fold" className="mafia-fold"><summary data-design-id="players-toggle">المجلس · {ar(members.filter(p=>p.alive).length)} أحياء · عرض المقاعد</summary>{seats}</details> : seats}

    {!finished ? <><div data-design-id="tabs" className="mafia-tabs" role="tablist" aria-label="أجزاء المجلس">{[['council','المجلس'],['clues','أدلتي'],['notes','دفتر الشكوك']].map(([id,title]) => <button data-design-id={`tab.${id}`} role="tab" aria-selected={tab === id} aria-controls={`mafia-panel-${id}`} id={`mafia-tab-${id}`} tabIndex={tab === id ? 0 : -1} onKeyDown={event => {if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault(); const ids=['council','clues','notes'];const next=event.key==='Home'?0:event.key==='End'?2:(ids.indexOf(tab)+(event.key==='ArrowLeft'?1:2))%3;setTab(ids[next]);document.getElementById(`mafia-tab-${ids[next]}`)?.focus();}}} key={id} type="button" onClick={() => setTab(id)}>{title}</button>)}</div>
      <div id={`mafia-panel-${tab}`} role="tabpanel" aria-labelledby={`mafia-tab-${tab}`}>
        {tab === 'council' && <div className="mafia-council-columns"><div>{state.phase !== 'night' && <ActionPanel key={`${accountId}:${state.matchId}:${state.phaseId}:${you?.roleId}`} state={state} you={you || {}} me={me} members={members} disabled={disabled} act={act}/>}<section data-design-id="events" className="mafia-events"><h3>سجل المجلس</h3><ol>{(state.log || []).slice(-15).map((event,i) => <li key={event.id || i}>{eventText(event,members)}</li>)}</ol>{!state.log?.length && <p className="mafia-muted">يبدأ السجل مع أول أحداث المجلس.</p>}</section></div><MafiaChat key={`${accountId}:${state.matchId}`} state={state} you={you} me={me} members={members} disabled={disabled} act={act}/></div>}
        {tab === 'clues' && <section data-design-id="reports" className="mafia-reports"><h3>أدلتك الخاصة</h3><p className="mafia-muted">المعلومة تخص الليلة المكتوبة. التمويه والتجنيد قد يغيران ما تعرفه.</p>{(you?.reports || []).map((report,i) => <article key={report.id || i}><b>الليلة {ar(report.night || report.round || 1)}</b><p>{reportText(report,members)}</p></article>)}{!you?.reports?.length && <p>لا أدلة خاصة بعد.</p>}{you?.allies?.length > 0 && <p>فريقك المعروف الآن: {you.allies.map(ally => nameOf(members,typeof ally === 'string' ? ally : ally.id)).join('، ')}</p>}</section>}
        {tab === 'notes' && <section data-design-id="notebook" className="mafia-notebook"><h3>دفتر الشكوك</h3><p>ملاحظاتك تبقى في هذه الجلسة، ولا تُرسل إلى المجلس. تُمسح عند تبديل الحساب أو بدء مباراة جديدة.</p><label htmlFor="mafia-notes">ملاحظاتي<textarea data-design-id="notes-input" id="mafia-notes" maxLength={2000} value={notes} onChange={e => setNotes(e.target.value)} placeholder="مين غيّر روايته؟ أي معلومة تحتاج سؤالًا؟"/></label></section>}
      </div></> : <section data-design-id="results" className="mafia-results"><MafiaIcon/><h2>{resultTitle}</h2><p>{state.reason === 'voice_unavailable' ? 'تعذّر تأمين قنوات الصوت. لا نفتح قناة قد تكشف الأسرار.' : 'تُكشف الأدوار والأحداث المهمة هنا؛ المحادثات السرية تبقى خاصة.'}</p><div data-design-id="recap" className="mafia-recap">{(Array.isArray(state.replay) ? state.replay : state.replay?.players || state.replay?.roles || []).map((item,i) => <article key={item.id || i}><MafiaRoleArt roleId={item.roleId}/><b>{nameOf(members,item.playerId || item.id)}</b><span>{MAFIA_ROLES[item.roleId]?.name || 'دور'}</span><small>{factionLabel(item.faction)}{item.initialFaction && item.initialFaction!==item.faction ? ` · بدأ مع ${factionLabel(item.initialFaction)}` : ''}</small></article>)}</div>{state.replay?.events && <ol>{state.replay.events.map((event,i) => <li key={event.id || i}>{eventText(event,members)}</li>)}</ol>}{isHost && state.phase === 'over' && <Button data-design-id="restart" disabled={disabled} full onClick={() => act('restart')}>إلى الانتظار · مجلس جديد</Button>}{voice.onReturnToCall && voice.previousCall && <Button data-design-id="return-call" onClick={voice.onReturnToCall}>العودة لمكالمة الشلّة</Button>}</section>}
    <MafiaRules possibleRoles={state.possibleRoles}/>
    {safety && <MafiaSafety player={safety} onClose={() => setSafety(null)} onSafety={onSafety}/>}

  </section>;
}

export function MafiaSafety({ player, onClose = noop, onSafety = noop }) {
  const [reason,setReason] = useState(''); const [error,setError] = useState(''); const [busy,setBusy] = useState(false);
  async function send(kind) { setBusy(true); setError(''); try { await onSafety({kind,player,reason}); onClose(); } catch { setError(kind === 'block' ? 'تعذّر الحظر والخروج، حاول مجددًا.' : 'تعذّر إرسال البلاغ، حاول مجددًا.'); } finally { setBusy(false); } }
  return <Modal data-design-screen="online.mafia.safety" title={`إجراءات ${player.name}`} onClose={onClose}><div className="stack"><p>الإبلاغ لا يكشف دورًا ولا يطرد لاعبًا من المباراة. الحظر أثناء المشاركة ينهي مقعدك.</p><label>تفاصيل البلاغ<textarea data-design-id="report-details" maxLength={1000} value={reason} onChange={e=>setReason(e.target.value)}/></label><Button data-design-id="submit" disabled={busy || !reason.trim()} onClick={() => send('report')}>إرسال بلاغ</Button><Button data-design-id="block-exit" variant="secondary" disabled={busy} onClick={() => send('block')}>حظر وخروج من المجلس</Button>{error&&<p role="alert">{error}</p>}</div></Modal>;
}

export function MafiaPrivacy() { return <section data-design-screen="online.mafia.privacy" className="mafia-shell mafia-waiting"><style>{css}</style><div data-design-id="privacy" data-design-required="true"><MafiaIcon/><h2>المجلس محجوب لحماية الأسرار</h2><p>تعود شاشتك عند فتح ميدان.</p></div></section>; }

export function MafiaHistory({ data, loading, error, onClose = noop, onRefresh = noop }) {
  return <Modal data-design-screen="online.mafia.history" title="سجل مجالسك" onClose={onClose}><div className="mafia-history stack"><p>نتائج أدوارك وفرقك في آخر {ar(data?.retentionDays || 30)} يومًا، دون نشر المحادثات.</p><Button data-design-id="refresh" disabled={loading} onClick={onRefresh}>{loading?'نحمّل السجل…':'تحديث السجل'}</Button>{error&&<p data-design-id="error" role="alert">{errorText(error)}</p>}{loading&&<p data-design-id="loading" role="status">نحمّل نتائجك…</p>}{data&&<><div data-design-id="stats" className="mafia-history-stats">{data.stats.map((row,i)=><article key={i}><MafiaRoleArt roleId={row.roleId}/><strong>{MAFIA_ROLES[row.roleId]?.name || 'دور'}</strong><small>{factionLabel(row.faction)}</small><span>{ar(row.matches)} مباراة · {ar(row.wins)} فوز · {ar(row.draws)} تعادل</span></article>)}</div><ol data-design-id="history">{data.matches.map(match=><li key={match.matchKey}><b>{MAFIA_ROLES[match.roleId]?.name || 'دور'} · {factionLabel(match.faction)}</b><span>{match.forfeited?'انسحاب':match.draw?'تعادل':match.won?'فوز الفريق':'خسارة الفريق'}</span><time dateTime={new Date(match.finishedAt).toISOString()}>{new Date(match.finishedAt).toLocaleDateString('ar-JO')}</time></li>)}</ol>{!data.matches.length&&<p data-design-id="empty">أول مجلس لك سيظهر هنا بعد اكتماله.</p>}</>}</div></Modal>;
}

import React, { useEffect, useRef, useState } from 'react';
import { Button, Modal } from '../shared/ui/components.jsx';
import { ProfileAvatar } from '../profiles/ProfileAvatar.jsx';
import { Avatar } from '../shared/brand/art.jsx';
import { MafiaIcon, MafiaRoleArt, MafiaSceneArt } from '../games/mafia/icon.jsx';
import { MAFIA_DEFAULT_SETTINGS, MAFIA_ROLES, MAFIA_PHASES, MAFIA_FACTIONS } from './mafia-shared.js';
import { arabicNumber, errorText } from './shared.js';
import css from './mafia.css';
import { MAFIA_NOIR_ASSETS } from '../games/mafia/noir-assets.js';
import { useMafiaSound } from '../games/mafia/useMafiaSound.js';

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

// Shared by room creation and the host's lobby editor. `present` counts the
// seats already taken: the server refuses a capacity below it.
function MafiaSettingsFields({ settings, onChange, disabled, present = 0 }) {
  return <>
    <div data-design-id="mode-choice" className="mafia-mode-picker" role="group" aria-label="طور المباراة">{[['classic','المجلس الأساسي','٦–٨ لاعبين · فريقان'],['shadow','رابطة الظل','٩–١٢ لاعبًا · ثلاثة أطراف']].map(([mode,title,detail]) => <button data-design-id="mode-option" type="button" key={mode} disabled={disabled || present > (mode === 'shadow' ? 12 : 8)} aria-pressed={settings.mode === mode} onClick={() => onChange(normalizeMafiaSettings({ ...settings, mode, capacity: mode === 'shadow' ? Math.max(10, present) : 8 }))}><strong>{title}</strong><small>{detail}</small></button>)}</div>
    <div className="mafia-settings-row"><label>سعة المجلس<select data-design-id="capacity" value={settings.capacity} disabled={disabled} onChange={event => onChange({ ...settings, capacity: Number(event.target.value) })}>{(settings.mode === 'shadow' ? [9,10,11,12] : [6,7,8]).map(n => <option key={n} value={n} disabled={n < present}>{ar(n)} لاعبين</option>)}</select></label>
      <label>ظهور الغرفة<select data-design-id="visibility" disabled={disabled} value={settings.visibility} onChange={event => onChange({ ...settings, visibility: event.target.value })}><option value="private">خاصة · برمز أو دعوة</option><option value="public">عامة · يستقبل المجلس لاعبين</option></select></label></div>
  </>;
}

export function MafiaSettings({ value = MAFIA_DEFAULT_SETTINGS, onChange = noop, disabled = false }) {
  const settings = normalizeMafiaSettings(value);
  return <section data-design-screen="online.mafia.setup" className="mafia-noir mafia-settings stack" aria-label="إعداد مافيا ميدان"><style>{css}</style>
    <MafiaSettingsFields settings={settings} onChange={onChange} disabled={disabled}/>
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
  return <>{!defaultOpen && <Button data-design-id="rules" variant="ghost" full onClick={() => setOpen(true)}>{possibleRoles ? 'أدوار هذا المجلس ودليل اللعب' : 'دليل المجلس والأدوار الاثنا عشر'}</Button>}{open && <Modal className="mafia-noir mafia-guide-dialog" data-design-screen="online.mafia.guide" title="دليل مافيا ميدان" onClose={() => setOpen(false)}><style>{css}</style><div className="mafia-guide stack"><span className="mafia-kicker">تدريب توضيحي · شخصيات افتراضية</span><h3>{lessons[lesson][0]}</h3><p>{lessons[lesson][1]}</p><div className="row-between"><Button data-design-id="back" disabled={!lesson} onClick={() => setLesson(lesson - 1)}>السابق</Button><span>{ar(lesson + 1)} / ٤</span><Button data-design-id="continue" disabled={lesson === lessons.length - 1} onClick={() => setLesson(lesson + 1)}>التالي</Button></div><p className="mafia-muted">هذه موسوعة القدرات؛ وجود دور هنا لا يعني أنه موزّع في المباراة الحالية.</p><div className="mafia-role-catalog">{Object.values(MAFIA_ROLES).filter(role => !possibleRoles || possibleRoles.includes(role.id)).map(role => <article key={role.id} className={`mafia-role-tile faction-${role.faction}`}><MafiaRoleArt roleId={role.id}/><div><h4>{role.name}</h4><small>{factionLabel(role.faction)}</small><p>{role.description} </p></div></article>)}</div></div></Modal>}</>;
}

export function MafiaDirectory({ rooms = [], enabled, loading, error, mode, onMode = noop, onRefresh = noop, onQuickJoin = noop, onJoin = noop, onCreate, disabled }) {
  return <section data-design-screen="online.mafia.directory" className="mafia-noir mafia-directory stack"><style>{css}</style>
    <div data-design-id="header" className="mafia-directory-heading"><div><span className="mafia-kicker">مجلس جديد · وجوه جديدة</span><h2>الغرف العامة</h2><p>اختر مجلسك. الانضمام مجاني ولا يستهلك تجربتك.</p></div><MafiaIcon/></div>
    <div className="mafia-directory-filters"><label><span className="sr-only">نوع المجلس</span><select data-design-id="directory-mode" disabled={disabled || loading} value={mode} onChange={e => onMode(e.target.value)}><option value="classic">الأساسي · ٦–٨ لاعبين</option><option value="shadow">رابطة الظل · ٩–١٢ لاعبًا</option></select></label><Button data-design-id="refresh" variant="ghost" disabled={disabled || loading} onClick={onRefresh}>{loading ? 'نبحث…' : 'تحديث'}</Button></div>
    <div data-design-id="actions" className="mafia-directory-actions"><Button data-design-id="quick-join" variant="primary" disabled={disabled || loading || enabled !== true} onClick={onQuickJoin}>انضمام سريع <span aria-hidden="true">←</span></Button>{onCreate && <Button data-design-id="create-public-room" disabled={disabled || loading || enabled !== true} onClick={onCreate}>+ أنشئ غرفة عامة</Button>}</div>
    {error && <p role="alert" className="mafia-notice">{errorText(error)}</p>}{enabled === false && <p data-design-id="notice" className="mafia-notice" role="status">المجالس الجديدة غير متاحة حاليًا. المباريات القائمة تتابع حتى نهايتها.</p>}{loading && <p data-design-id="loading" className="mafia-empty" role="status">نحمّل الغرف المتاحة…</p>}
    {!loading && enabled === true && rooms.length === 0 && <div data-design-id="empty" className="mafia-empty"><MafiaSceneArt sceneId="night"/><div><h3>المقاعد تنتظر أول حكاية</h3><p>لا يوجد مجلس ينتظر الآن. أنشئ غرفة وادعُ أصحابك، أو حدّث القائمة لاحقًا.</p></div></div>}
    <div data-design-id="rooms" className="mafia-room-list">{rooms.map(room => <article key={room.code} data-room-code={room.code} className="mafia-directory-room"><div className="mafia-room-medallion" aria-hidden="true"><MafiaIcon/></div><div className="mafia-directory-room-copy"><span className="mafia-room-tag">{room.mode === 'shadow' ? 'رابطة الظل' : 'المجلس الأساسي'}</span><h3>مجلس {room.hostName}</h3><p>{ar(room.players)} / {ar(room.capacity)} لاعبين <span>· {ar(room.ready)} جاهز</span></p><div className="mafia-room-capacity" aria-hidden="true">{Array.from({length:room.capacity},(_,i)=><i key={i} className={i<room.players?'occupied':''}/>)}</div></div><Button data-design-id="room-join" disabled={disabled || room.players >= room.capacity || enabled !== true} onClick={() => onJoin(room.code)}>{room.players >= room.capacity ? 'مكتملة' : 'انضم'}</Button></article>)}</div>
  </section>;
}

// Only the host edits the waiting room; unsaved edits live until saved or closed.
function MafiaLobbySettings({ state, disabled, act }) {
  const [editing, setEditing] = useState(false), [draft, setDraft] = useState(null);
  const value = draft || normalizeMafiaSettings(state.settings);
  const close = () => { setEditing(false); setDraft(null); };
  return <div className="mafia-lobby-settings"><Button data-design-id="room-settings" full aria-expanded={editing} disabled={disabled} onClick={() => (editing ? close() : setEditing(true))}>{editing ? 'إغلاق إعدادات المجلس' : 'تعديل إعدادات المجلس'}</Button>
    {editing && <><MafiaSettingsFields settings={value} onChange={setDraft} disabled={disabled} present={state.members.filter(m => !m.left).length}/><p className="mafia-muted">تغيير الطور أو ظهور الغرفة يعيد الآخرين إلى «يستعد» حتى يؤكدوا من جديد.</p><Button data-design-id="save" full variant="primary" disabled={disabled} onClick={async () => { if (await act('settings', { settings: value })) close(); }}>حفظ إعدادات المجلس</Button></>}</div>;
}

export function MafiaLobbyInfo({ state, isHost = false, disabled = false, act = noop }) {
  return <section data-design-screen="online.mafia.lobby" className="mafia-noir mafia-lobby-info stack"><style>{css}</style><div className="mafia-lobby-art" style={{'--mafia-environment':`url("${MAFIA_NOIR_ASSETS.environment}")`}}><MafiaIcon/><div><span className="mafia-kicker">كل وجه يخفي حكاية</span><h2>{state.settings?.mode === 'shadow' ? 'رابطة الظل' : 'المجلس الأساسي'}</h2><p>{ar(state.settings?.capacity || 8)} مقاعد · {state.settings?.visibility === 'public' ? 'غرفة عامة' : 'غرفة خاصة'}</p></div></div><div className="mafia-lobby-brief"><p>جهّز السماعات إن أمكن. استمع واكتب دون تشغيل الميكروفون، واكشف بطاقتك سرًا عند البداية.</p>{state.composition && <p className="mafia-composition"><span>{ar(state.composition.mafia)} مافيا</span><span>{ar(state.composition.town)} أهل الميدان</span>{state.composition.shadow>0 && <span>{ar(state.composition.shadow)} قائد للرابطة</span>}</p>}<p className="mafia-muted">التوزيع يثبت بحسب عدد الجاهزين. الأدوار الفعلية لا يراها المضيف، والقادم بعد البداية ينتظر المباراة التالية.</p></div>{isHost && <MafiaLobbySettings state={state} disabled={disabled} act={act}/>}<MafiaRules possibleRoles={state.possibleRoles}/></section>;
}

function useCountdown(deadline, offset, preview, serverNow) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { if (!deadline || preview) return undefined; const timer = setInterval(() => setNow(Date.now()), 250); return () => clearInterval(timer); }, [deadline, preview]);
  return deadline ? Math.max(0, Math.ceil((deadline - (preview && Number.isFinite(serverNow) ? serverNow : now + offset)) / 1000)) : null;
}
function SecretCard({ you, hidden, previewReveal }) {
  const [revealed, setRevealed] = useState(Boolean(previewReveal));
  useEffect(() => { if (hidden) setRevealed(false); }, [hidden]);
  const role = MAFIA_ROLES[you?.roleId];
  if (!role || hidden) return hidden ? <div data-design-id="privacy" data-design-required="true" className="mafia-secret-cover">بطاقتك محجوبة لحماية دورك</div> : null;
  return <section data-design-id="role-card" className="mafia-secret"><div className="mafia-secret-top"><span><span className="mafia-secret-seal" aria-hidden="true">◆</span> هويتك سرّك</span><Button data-design-id="role-toggle" data-sound="mafiaRole" variant="ghost" aria-expanded={revealed} aria-haspopup="dialog" onClick={() => setRevealed(true)}>اكشف بطاقتي <span aria-hidden="true">←</span></Button></div>
    {revealed && <Modal className="mafia-noir mafia-role-dialog" data-design-screen="online.mafia.role-card" title="بطاقتك الخاصة" closeLabel="إخفاء البطاقة" onClose={() => setRevealed(false)} footer={<Button data-design-id="role-hide" full onClick={()=>setRevealed(false)}>إخفاء البطاقة</Button>}><style>{css}</style><article data-design-id="role-content" className={`mafia-secret-content faction-${you.faction}`}><div className="mafia-role-portrait"><MafiaRoleArt roleId={role.id}/><span>سرّي · لك وحدك</span></div><div className="mafia-role-description"><span className="mafia-kicker">انتماؤك الآن: {factionLabel(you.faction)}</span><h2>{role.name}</h2><p>{role.description}</p><small>الآخرون لا يرون بطاقتك. أغلقها قبل إظهار الشاشة لأي شخص.</small></div></article></Modal>}
  </section>;
}

function NarrativeCard({ state, members, compact = false }) {
  const phase = state.phase;
  const scenes = {role:'investigation',opening:'dawn',night:'night',dawn:'dawn',discussion:'dawn',nomination:'verdict',defense:'verdict',verdict:'verdict',over:'ending',closed:'ending'};
  const descriptions = {role:'اقرأ قدرتك بعيدًا عن أعين الآخرين. بطاقتك لا يراها أحد سواك.',opening:'تعرّف إلى أصوات المجلس. كل شخص يملك حكاية… وليس كل حكاية دليلًا.',night:'حلّ الليل. اختيارات الأدوار سرية، وتغلق مع انتهاء الوقت.',dawn:'عاد الضوء إلى المجلس. هذه هي الأخبار التي يحق للجميع معرفتها.',discussion:'اسأل عن التفاصيل، اربط الروايات، واترك للآخرين فرصة الدفاع.',nomination:'من تحتاج روايته إلى دفاع؟ اختر أو امتنع، ثم أكّد صوتك.',defense:`المجلس يستمع إلى ${nameOf(members,state.nomineeId)}. الصوت والكتابة للمرشح وحده.`,verdict:'سمعت الدفاع. قرارك نهائي، والإقصاء يحتاج أكثر من نصف الأحياء.'};
  return <article data-design-id="narrative" className={`mafia-narrative ${compact?'is-compact':''}`}><MafiaSceneArt sceneId={scenes[phase] || 'night'}/><div><span className="mafia-kicker">حكاية المجلس</span><h3>{phase==='night'?'أُغلقت أبواب المجلس':phase==='dawn'?'ماذا ترك الليل خلفه؟':phase==='discussion'?'الكلمة الآن لكم':phaseLabel(phase)}</h3><p>{descriptions[phase] || 'انتهت الحكاية، وظهرت الأدوار.'}</p></div></article>;
}

function MafiaConfirmModal({ title, message, confirmLabel, onConfirm, onCancel }) {
  return <Modal title={title} onClose={onCancel} className="mafia-noir mafia-confirm" footer={<><Button data-design-id="confirm" full onClick={onConfirm}>{confirmLabel}</Button><Button data-design-id="cancel" full variant="ghost" onClick={onCancel}>رجوع</Button></>}><style>{css}</style><p>{message}</p></Modal>;
}

function eventText(event, members) {
  if (typeof event === 'string') return event;
  if (event.text || event.message) return event.text || event.message;
  const person = nameOf(members, event.playerId || event.targetId);
  const texts = { eliminated: event.reason === 'verdict' ? `أقصى المجلس ${person}` : event.reason === 'forfeit' ? `${person} انسحب من المجلس` : event.reason === 'night' ? `${person} خرج من المجلس بهجوم ليلي` : `${person} غادر المجلس`, dawn: event.peaceful ? 'أشرقت الشمس دون إقصاء ليلي' : 'أشرقت شمس جديدة على المجلس', match_started:'بدأ المجلس وتوزعت الأدوار سرًا', night_started:'بدأ الليل؛ اتبع قناتك وتعليمات دورك', match_ended:'انتهت المباراة', host_changed:`انتقلت إدارة الغرفة إلى ${person}`, nomination_closed:event.nomineeId ? `المرشح للدفاع: ${nameOf(members,event.nomineeId)}` : 'تعادل الترشيح؛ لا مرشح لهذه الليلة', verdict_closed:event.passed ? 'وافق المجلس على الإقصاء' : 'رفض المجلس الإقصاء', no_elimination: 'مرّت الليلة دون إقصاء', extended: `${person} استخدم قدرة المنادي وأضاف ٢٠ ثانية للنقاش`, nomination_tie: 'تعادل الترشيح، يواصل الجميع إلى الليل', faction_revealed: `${person}: ${factionLabel(event.faction)}`, disconnected: `${person} انقطع اتصاله`, reconnected: `${person} عاد للمجلس`, withdrawal: `${person} انسحب` };
  if(event.type==='roles') return 'توزعت الأدوار الأولية كما تظهر في البطاقات.';
  if(event.type==='night_action') return `${person} استخدم قدرة ${MAFIA_ROLES[event.roleId]?.name || 'دوره'} تجاه ${(event.targetIds || [event.targetId]).filter(Boolean).map(id=>nameOf(members,id)).join(' و') || 'هدفه'}.`;
  if(event.type==='attack_vote') return `${person} اختار ${nameOf(members,event.targetId)} لهجوم المافيا.`;
  if(event.type==='nomination_vote') return event.targetId ? `${person} رشّح ${nameOf(members,event.targetId)}.` : `${person} امتنع عن الترشيح.`;
  if(event.type==='verdict_votes') return `حكم المجلس على ${nameOf(members,event.nomineeId)}: ${ar(Object.values(event.votes || {}).filter(Boolean).length)} أصوات موافقة.`;
  if(event.type==='converted') return `انضم ${person} إلى رابطة الظل بتجنيد ${nameOf(members,event.recruiterId)}.`;
  if(event.type==='shield_used') return `${person} نجا بحمايته الذاتية.`;
  return texts[event.type] || texts[event.kind] || 'تحديث في المجلس';
}

// Each living ally's current attack choice, as the server shows it to the Mafia only.
function teamBallotText(you, members) {
  const votes = you?.teamVotes || {};
  return (you?.allies || []).map(ally => typeof ally === 'string' ? ally : ally.id).map(id => `${nameOf(members,id)}: ${!Object.hasOwn(votes,id) ? 'لم يختر بعد' : votes[id] ? nameOf(members,votes[id]) : 'بلا هدف'}`).join('، ');
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
  const recovering = ['connecting','reconnecting'].includes(voice.status);
  const quiet = voice.status === 'silent' || (state.phase === 'night' && state.you?.voice?.canListen === false);
  // The provider could not secure a channel: the match goes on over text and
  // voice returns by itself once the server confirms the old grants are gone.
  const outage = Boolean(state.mafiaVoice?.outage);
  const [actionError,setActionError] = useState('');
  const run = async task => {setActionError('');try{await task?.();}catch(error){setActionError(/[\u0600-\u06ff]/.test(error?.message || '')?error.message:'تعذّر تنفيذ أمر الصوت. حاول مجددًا.');}};
  return <div data-design-id="voice" data-design-required="true" className="mafia-voice" data-mafia-call-controls={state.mafiaVoice?.callId} data-mafia-controls-ready={Boolean((connected || voice.requested) && typeof voice.onLeave==='function') ? 'true' : 'false'}>
    <div><b>{outage ? 'الصوت متوقف مؤقتًا' : recovering ? 'نؤمّن الاتصال الصوتي…' : quiet ? (state.phase === 'night' ? 'الليل هادئ الآن' : 'المجلس هادئ لحظات') : connected ? 'صوت المجلس متصل' : 'اسمع المجلس وشارك بصوتك'}</b>
      <small>{outage ? 'تعذّر تأمين قناة الصوت، فلم نفتح قناة جديدة. المباراة مستمرة بالكتابة، ويعود الصوت تلقائيًا عند توفره.' : quiet ? voice.requested ? 'سيعود صوت المجلس تلقائيًا عندما تبدأ مرحلة الاستماع.' : 'فعّل صوت النهار الآن ليعود تلقائيًا عند بدء النقاش.' : state.phase === 'night' ? 'مسارات الليل معزولة حسب الفريق' : state.phase === 'defense' ? 'الصوت للمرشح فقط أثناء الدفاع' : 'الميكروفون اختياري؛ الكتابة متاحة حسب المرحلة'}</small></div>
    <div className="mafia-voice-actions">{connected || voice.requested ? <>
      <Button data-design-id="mute" disabled={!voice.onMute || !voice.canPublish || recovering} onClick={() => run(() => voice.onMute(!voice.muted))}>{!voice.canPublish || recovering ? 'الميكروفون مغلق' : voice.muted ? 'شغّل الميكروفون' : 'اكتم الميكروفون'}</Button>
      {connected && voice.onSpeaker && voice.audioOutputs?.length > 0 && <label><span className="sr-only">مخرج الصوت</span><select aria-label="مخرج الصوت" data-design-id="audio-output" value={voice.outputId || 'default'} onChange={event => run(() => voice.onSpeaker(event.target.value))}>{voice.audioOutputs.map(output => <option key={output.id || output.deviceId} value={output.id || output.deviceId}>{output.label || 'السماعة'}</option>)}</select></label>}
      <Button data-design-id="voice-leave" variant="ghost" disabled={!voice.onLeave} onClick={() => run(voice.onLeave)}>افصل الصوت</Button>
    </> : <Button data-design-id="voice-join" disabled={!voice.onJoin || recovering || outage} onClick={() => run(voice.onJoin)}>{quiet ? 'تفعيل صوت النهار' : 'الانضمام بالصوت'}</Button>}</div>
    {(connected || voice.requested) && voice.onResume && voice.audioBlocked && <Button data-design-id="voice-resume" onClick={() => run(voice.onResume)}>اضغط لاستعادة الصوت</Button>}
    {!outage && (voice.error || actionError) && <p role="alert">{actionError || (/[\u0600-\u06ff]/.test(voice.error) ? voice.error : errorText(voice.error))}</p>}
  </div>;
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
  // The day is one public channel (voice and text alike); only the defense belongs to the nominee.
  const writable = team || observer || (alive && ['opening','discussion','nomination','verdict'].includes(state.phase)) || (alive && state.phase === 'defense' && state.nomineeId === me.id);
  const actualChannel = channel === 'public' && observer ? 'public' : allowedChannel;
  const chats = Array.isArray(state.chats) ? state.chats : state.chats?.[actualChannel] || [];
  const messages = chats.filter(item => !item.channel || item.channel === actualChannel);
  useEffect(() => { setDraft({key:`${me?.id}:${state.matchId}:${state.phaseId}`,text:''}); setError(''); setChannel(allowedChannel); }, [me?.id,state.matchId,state.phaseId,allowedChannel]);
  useEffect(() => { if (list.current) list.current.scrollTop = list.current.scrollHeight; }, [messages.length, actualChannel, state.log?.length, state.phaseId]);
  async function send(event) {
    event.preventDefault(); if (!text.trim() || disabled || sending || !writable || actualChannel !== allowedChannel) return;
    setSending(true); setError('');
    try { const ok = await act('chat', { channel: allowedChannel, text: text.trim(), clientId: crypto.randomUUID() }); if (ok !== false) setText(''); }
    catch { setError('تعذّر إرسال الرسالة. جرّب مجددًا.'); }
    finally { setSending(false); }
  }
  const timeline = [
    ...(state.log || []).slice(-12).map((event,i)=>({kind:'event',key:`e-${event.id || i}`,at:Number(event.at)||0,value:event})),
    ...messages.map((message,i)=>({kind:'message',key:`m-${message.id || message.clientId || i}`,at:Number(message.at)||0,value:message})),
  ].sort((a,b)=>a.at-b.at).slice(-64);
  return <section data-design-id="chat" className={`mafia-chat channel-${actualChannel}`}><div className="mafia-panel-heading"><h3>{actualChannel === 'team' ? 'حديث الفريق · سري' : actualChannel === 'observers' ? 'مجلس المقصيين' : 'حديث المجلس'}</h3><span className="mafia-channel-tag">{actualChannel==='team'?'قناة خاصة':actualChannel==='observers'?'للمتابعين':'عام'}</span>{observer && <Button data-design-id="chat-channel" size="sm" onClick={() => setChannel(channel === 'public' ? 'observers' : 'public')}>{channel === 'public' ? 'حديث المقصيين' : 'متابعة الأحياء'}</Button>}</div>
    <div data-design-id="messages" ref={list} className="mafia-chat-messages" role="log" aria-live="polite" aria-relevant="additions"><NarrativeCard key={state.phaseId} state={state} members={members} compact={state.phase==='night'}/>{timeline.map(item=>item.kind==='event'?<article data-design-id="event" key={item.key} className="mafia-event-card">{['eliminated','faction_revealed','verdict_closed','match_ended'].includes(item.value.type) ? <MafiaSceneArt className="mafia-event-art" sceneId={{eliminated:'elimination',faction_revealed:'investigation',verdict_closed:'verdict',match_ended:'ending'}[item.value.type]}/> : <span aria-hidden="true">◆</span>}<div><small>راوي المجلس</small><p>{eventText(item.value,members)}</p></div></article>:<article key={item.key} className={`mafia-message ${[item.value.senderId,item.value.playerId].includes(me?.id)?'is-own':''}`}><span className="mafia-message-seat" aria-hidden="true">{ar(members.find(p=>p.id===(item.value.senderId || item.value.playerId))?.seat || '·')}</span><div><b>{nameOf(members,item.value.senderId || item.value.playerId)}</b><p>{item.value.text}</p></div></article>)}{!messages.length && <p className="mafia-chat-empty">{writable ? 'ابدأ بكلمة… واستمع للأدلة.' : 'تظهر هنا الرسائل المسموحة لهذه المرحلة.'}</p>}</div>
    {writable && actualChannel === allowedChannel ? <form data-design-id="composer" onSubmit={send}><label className="sr-only" htmlFor="mafia-message">رسالتك إلى {actualChannel === 'team' ? 'الفريق' : 'المجلس'}</label><input data-design-id="message-input" id="mafia-message" maxLength={400} autoComplete="off" value={text} onChange={e => setText(e.target.value)} placeholder={actualChannel==='team'?'همسة للفريق…':'اكتب للمجلس…'} disabled={disabled || sending}/><Button data-design-id="send" type="submit" disabled={disabled || sending || !text.trim()}>إرسال</Button></form> : <p className="mafia-chat-locked">{observer ? 'تتابع الأحياء دون إرسال رسائل إليهم.' : 'الكتابة العامة متوقفة في هذه المرحلة.'}</p>}{error && <p role="alert">{error}</p>}
  </section>;
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
  const hasHerald = actions.some(action => action.type === 'herald');
  if (!['night','nomination','verdict'].includes(state.phase) && !hasHerald) return null;
  const submit = async () => { await act(nomination ? 'nominate' : 'night_action', nomination ? { targetId: selected[0] || null } : you.roleId === 'analyst' ? { targetIds: selected } : { targetId: selected[0] }); };
  return <section data-design-id="ability" className="mafia-ability"><div className="mafia-ability-heading"><h3>{showBallot ? 'اختيار المافيا الليلي' : actionLabel}</h3>{ability?.remaining != null && <small>متاح: {ar(ability.remaining)}</small>}</div>{rawAbility && ballot && <div className="mafia-action-tabs" role="group" aria-label="إجراءاتك الليلية"><Button data-design-id="night-attack-tab" aria-pressed={nightTool==='attack'} onClick={()=>setNightTool('attack')}>الهجوم المشترك</Button><Button data-design-id="night-ability-tab" aria-pressed={nightTool==='ability'} onClick={()=>setNightTool('ability')}>قدرتي · {ar(rawAbility.remaining)} متاح</Button></div>}{(ability || nomination) && <><p>{nomination ? 'اختر مشتبهًا أو امتنع. لا يتغير صوتك بعد التأكيد.' : you.roleId === 'analyst' ? 'اختر لاعبين مختلفين للمقارنة.' : 'اختر الهدف. يمكنك تغيير اختيارك حتى ينتهي الليل.'}</p><div data-design-id="targets" className="mafia-target-grid">{targetIds.map(target => { const id = typeof target === 'string' ? target : target.id; const player = members.find(p => p.id === id); return player && <button data-sound="mafiaSelect" data-design-id="target" type="button" key={id} aria-pressed={selected.includes(id)} disabled={disabled} onClick={() => pick(id)}><span>#{ar(player.seat || members.indexOf(player) + 1)}</span>{player.name}</button>; })}</div><Button data-design-id="ability-submit" disabled={disabled || selected.length < (you.roleId === 'analyst' && ability ? 2 : 1)} onClick={() => nomination ? setConfirm({ kind: 'nominate', targetId: selected[0] }) : submit()}>{nomination ? 'تأكيد الترشيح' : 'اعتماد اختيار الليل'}</Button>{nomination && <Button data-design-id="abstain" variant="ghost" disabled={disabled} onClick={() => setConfirm({ kind: 'nominate', targetId: null })}>امتنع عن الترشيح</Button>}{you.nightAction && <><p role="status">اختيارك محفوظ لهذه الليلة. يمكنك تغييره قبل نهاية الوقت.</p><Button data-design-id="cancel-ability" variant="ghost" disabled={disabled} onClick={() => act('night_action',{targetId:null})}>إلغاء اختيار الليل</Button></>}</>}
    {showBallot && <div className="mafia-kill-ballot"><p>الأعلى أصواتًا يُستهدف؛ التعادل يعني عدم الهجوم.</p><div className="mafia-target-grid">{ballot.targets.map(target => { const id = typeof target === 'string' ? target : target.id; const player = members.find(p => p.id === id); const picks = Object.values(you.teamVotes || {}).filter(choice => choice === id).length; return player && <button data-sound="mafiaSelect" data-design-id="mafia-vote" key={id} type="button" aria-pressed={you.killTarget === id} disabled={disabled} onClick={() => act('mafia_vote', { targetId: id })}>{player.name}{picks > 0 && <span aria-label={`اختاره ${ar(picks)} من فريقك`}> ✦{ar(picks)}</span>}</button>; })}</div>{teamBallotText(you, members) && <p className="mafia-muted" role="status">اختيارات فريقك: {teamBallotText(you, members)}</p>}<Button data-design-id="abstain" variant="ghost" disabled={disabled} onClick={() => act('mafia_vote', { targetId: null })}>لا أختار هدفًا</Button></div>}
    {verdict && <><p>هل تؤيد إقصاء <b>{nameOf(members,state.nomineeId)}</b>؟ يلزم أكثر من نصف الأحياء. صوتك نهائي.</p><div className="mafia-settings-row"><Button data-design-id="verdict-yes" disabled={disabled} onClick={() => setConfirm({ kind:'verdict', approve:true })}>أوافق على الإقصاء</Button><Button data-design-id="verdict-no" variant="secondary" disabled={disabled} onClick={() => setConfirm({ kind:'verdict', approve:false })}>أرفض الإقصاء</Button></div></>}
    {actions.some(action => action.type === 'herald') && <Button data-design-id="herald" disabled={disabled} onClick={() => setConfirm({kind:'herald'})}>استخدم المنادي · أضف ٢٠ ثانية</Button>}
    {!ability && !ballot && !nomination && !verdict && <p className="mafia-muted" role="status">{state.phase === 'nomination' && you.nominationSubmitted ? (you.myNomination ? `سُجّل ترشيحك: ${nameOf(members,you.myNomination)}. لا يتغير بعد التأكيد.` : 'سُجّل امتناعك عن الترشيح في هذه الجولة.') : state.phase === 'verdict' && you.verdictSubmitted ? `سُجّل حكمك: ${you.myVerdict ? 'تؤيد الإقصاء' : 'ترفض الإقصاء'}. النتيجة عند انتهاء الوقت.` : state.phase === 'night' ? 'لا إجراء متاح لك الآن. تابع المرحلة واحتفظ بملاحظاتك.' : 'تابع النقاش؛ الإجراءات المتاحة تظهر هنا في وقتها.'}</p>}
    {confirm && <MafiaConfirmModal title="تؤكد اختيارك؟" message={confirm.kind === 'herald' ? 'تُستخدم قدرة المنادي مرة واحدة في المباراة، ويرى المجلس أنك من استخدمها.' : confirm.kind === 'verdict' ? confirm.approve ? 'تؤيد إقصاء المرشح. لا يمكنك تغيير الحكم بعد التأكيد.' : 'ترفض إقصاء المرشح. لا يمكنك تغيير الحكم بعد التأكيد.' : confirm.targetId ? `ترشّح ${nameOf(members,confirm.targetId)}. لن يتغير صوتك بعد التأكيد.` : 'تمتنع عن الترشيح لهذه الجولة.'} confirmLabel="اعتمد اختياري" onCancel={() => setConfirm(null)} onConfirm={async () => { const {kind,...fields} = confirm; const ok = await act(kind,fields); if (ok !== false) setConfirm(null); }}/>}
  </section>;
}

export function MafiaMatch({ state, me, isHost, disabled = false, act = noop, clockOffset = 0, accountId = '', voice = {}, sound, onSafety }) {
  const [hidden, setHidden] = useState(() => typeof document !== 'undefined' && document.hidden);
  useMafiaSound(state, { hidden, preview:Boolean(state._designPreview), sound });
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
  if (state.waiting) return <section data-design-screen="online.mafia.waiting" className="mafia-noir mafia-shell mafia-waiting"><style>{css}</style><MafiaIcon/><h2>المجلس بدأ، ومكانك محفوظ</h2><p data-design-id="notice">تدخل في المباراة التالية. لا تُعرض لك أدوار أو محادثات المباراة الجارية.</p><MafiaRules/></section>;
  return <section data-design-screen={state._designPreview && state.previewScene || `online.mafia.${state.phase}`} className={`mafia-noir mafia-shell phase-${state.phase} ${finished ? 'is-finished' : 'has-player-rail'}`} dir="rtl"><style>{css}</style>
    <header data-design-id="header" className="mafia-heading"><div><span className="mafia-kicker">مافيا ميدان · {state.settings?.mode === 'shadow' ? 'رابطة الظل' : 'المجلس الأساسي'}</span><h1 data-design-id="phase-title">{phaseLabel(state.phase)}</h1><p>{finished ? 'انكشف المجلس… حان وقت الحكايات' : `اليوم ${ar(state.round || 1)} · ${ar(members.filter(p => p.alive).length)} أحياء`}</p></div>{!finished && you?.roleId && <SecretCard key={`${accountId}:${state.matchId}:${you.roleId}:${you.faction}`} you={you} hidden={hidden} previewReveal={state._designPreview && state.previewReveal}/>} {remaining !== null && !finished && <div data-design-id="timer" data-design-required="true" className={`mafia-clock ${remaining <= 10 ? 'urgent' : ''}`} role="timer" aria-label={`${ar(remaining)} ثانية متبقية`}><b>{ar(remaining)}</b><small>ثانية</small></div>}</header>
    {isActive(state) && <MafiaVoice voice={voice} state={state}/>}
    {!finished && me && !me.alive && <p data-design-id="observer-notice" className="mafia-notice">أنت الآن تتابع المجلس. لا يمكنك توجيه الأحياء؛ نتيجتك مع فريقك تُسجّل عند النهاية، ويمكنك الخروج من المشاهدة.</p>}
    {state.phase === 'defense' && <p data-design-id="defense" className="mafia-notice"><b>{nameOf(members,state.nomineeId)}</b>، المجلس يسمع دفاعك الآن. الصوت والكتابة للمرشح وحده.</p>}
    {state.phase === 'night' && <ActionPanel key={`night:${accountId}:${state.matchId}:${state.phaseId}:${you?.roleId}`} state={state} you={you || {}} me={me} members={members} disabled={disabled} act={act}/>}


    {!finished ? <><div data-design-id="tabs" className="mafia-tabs" role="tablist" aria-label="أجزاء المجلس">{[['council','المحادثة'],['clues','أدلتي'],['notes','ملاحظاتي']].map(([id,title]) => <button data-design-id={`tab.${id}`} role="tab" aria-selected={tab === id} aria-controls={`mafia-panel-${id}`} id={`mafia-tab-${id}`} tabIndex={tab === id ? 0 : -1} onKeyDown={event => {if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault(); const ids=['council','clues','notes'];const next=event.key==='Home'?0:event.key==='End'?2:(ids.indexOf(tab)+(event.key==='ArrowLeft'?1:2))%3;setTab(ids[next]);document.getElementById(`mafia-tab-${ids[next]}`)?.focus();}}} key={id} type="button" onClick={() => setTab(id)}>{title}</button>)}</div>
      <div id={`mafia-panel-${tab}`} role="tabpanel" aria-labelledby={`mafia-tab-${tab}`}>
        {tab === 'council' && <div className="mafia-council-columns">{state.phase !== 'night' && <ActionPanel key={`${accountId}:${state.matchId}:${state.phaseId}:${you?.roleId}`} state={state} you={you || {}} me={me} members={members} disabled={disabled} act={act}/>}<MafiaChat key={`${accountId}:${state.matchId}`} state={state} you={you} me={me} members={members} disabled={disabled} act={act}/></div>}
        {tab === 'clues' && <section data-design-id="reports" className="mafia-reports"><h3>أدلتك الخاصة</h3><p className="mafia-muted">المعلومة تخص الليلة المكتوبة. التمويه والتجنيد قد يغيران ما تعرفه.</p>{(you?.reports || []).map((report,i) => <article key={report.id || i}><b>الليلة {ar(report.night || report.round || 1)}</b><p>{reportText(report,members)}</p></article>)}{!you?.reports?.length && <p>لا أدلة خاصة بعد.</p>}{you?.allies?.length > 0 && <p>فريقك المعروف الآن: {you.allies.map(ally => nameOf(members,typeof ally === 'string' ? ally : ally.id)).join('، ')}</p>}</section>}
        {tab === 'notes' && <section data-design-id="notebook" className="mafia-notebook"><h3>دفتر الشكوك</h3><p>ملاحظاتك تبقى في هذه الجلسة، ولا تُرسل إلى المجلس. تُمسح عند تبديل الحساب أو بدء مباراة جديدة.</p><label htmlFor="mafia-notes">ملاحظاتي<textarea data-design-id="notes-input" id="mafia-notes" maxLength={2000} value={notes} onChange={e => setNotes(e.target.value)} placeholder="مين غيّر روايته؟ أي معلومة تحتاج سؤالًا؟"/></label></section>}
      </div></> : <section data-design-id="results" className="mafia-results"><MafiaSceneArt sceneId="ending" className="mafia-result-art"/><h2>{resultTitle}</h2><p>{state.reason === 'voice_unavailable' ? 'تعذّر تأمين قنوات الصوت. لا نفتح قناة قد تكشف الأسرار.' : 'تُكشف الأدوار والأحداث المهمة هنا؛ المحادثات السرية تبقى خاصة.'}</p><div data-design-id="recap" className="mafia-recap">{(Array.isArray(state.replay) ? state.replay : state.replay?.players || state.replay?.roles || []).map((item,i) => <article key={item.id || i}><MafiaRoleArt roleId={item.roleId}/><b>{nameOf(members,item.playerId || item.id)}</b><span>{MAFIA_ROLES[item.roleId]?.name || 'دور'}</span><small>{factionLabel(item.faction)}{item.initialFaction && item.initialFaction!==item.faction ? ` · بدأ مع ${factionLabel(item.initialFaction)}` : ''}</small></article>)}</div>{state.replay?.events && <ol>{state.replay.events.map((event,i) => <li key={event.id || i}>{eventText(event,members)}</li>)}</ol>}{isHost && state.phase === 'over' && <Button data-design-id="restart" disabled={disabled} full onClick={() => act('restart')}>إلى الانتظار · مجلس جديد</Button>}{voice.onReturnToCall && voice.previousCall && <Button data-design-id="return-call" onClick={voice.onReturnToCall}>العودة لمكالمة الشلّة</Button>}</section>}
    <MafiaRules possibleRoles={state.possibleRoles}/>
    {!finished && <footer data-design-id="player-rail" className="mafia-player-rail"><div className="mafia-rail-heading"><span>المجلس · {ar(members.filter(p=>p.alive).length)} أحياء</span><span>اسحب لاستعراض المقاعد <span aria-hidden="true">↔</span></span></div>{seats}</footer>}
    {safety && <MafiaSafety player={safety} onClose={() => setSafety(null)} onSafety={onSafety}/>}

  </section>;
}

export function MafiaSafety({ player, onClose = noop, onSafety = noop }) {
  const [reason,setReason] = useState(''); const [error,setError] = useState(''); const [busy,setBusy] = useState(false);
  async function send(kind) { setBusy(true); setError(''); try { await onSafety({kind,player,reason}); onClose(); } catch { setError(kind === 'block' ? 'تعذّر الحظر والخروج، حاول مجددًا.' : 'تعذّر إرسال البلاغ، حاول مجددًا.'); } finally { setBusy(false); } }
  return <Modal className="mafia-noir mafia-safety" data-design-screen="online.mafia.safety" title={`إجراءات ${player.name}`} onClose={onClose}><style>{css}</style><div className="stack"><p>الإبلاغ لا يكشف دورًا ولا يطرد لاعبًا من المباراة. الحظر أثناء المشاركة ينهي مقعدك.</p><label>تفاصيل البلاغ<textarea data-design-id="report-details" maxLength={1000} value={reason} onChange={e=>setReason(e.target.value)}/></label><Button data-design-id="submit" disabled={busy || !reason.trim()} onClick={() => send('report')}>إرسال بلاغ</Button><Button data-design-id="block-exit" variant="secondary" disabled={busy} onClick={() => send('block')}>حظر وخروج من المجلس</Button>{error&&<p role="alert">{error}</p>}</div></Modal>;
}

export function MafiaPrivacy() { return <section data-design-screen="online.mafia.privacy" className="mafia-noir mafia-shell mafia-waiting"><style>{css}</style><div data-design-id="privacy" data-design-required="true"><MafiaIcon/><h2>المجلس محجوب لحماية الأسرار</h2><p>تعود شاشتك عند فتح ميدان.</p></div></section>; }

export function MafiaHistory({ data, loading, error, onClose = noop, onRefresh = noop }) {
  return <Modal className="mafia-noir mafia-history-dialog" data-design-screen="online.mafia.history" title="سجل مجالسك" onClose={onClose}><style>{css}</style><div className="mafia-history stack"><p>نتائج أدوارك وفرقك في آخر {ar(data?.retentionDays || 30)} يومًا، دون نشر المحادثات.</p><Button data-design-id="refresh" disabled={loading} onClick={onRefresh}>{loading?'نحمّل السجل…':'تحديث السجل'}</Button>{error&&<p data-design-id="error" role="alert">{errorText(error)}</p>}{loading&&<p data-design-id="loading" role="status">نحمّل نتائجك…</p>}{data&&<><div data-design-id="stats" className="mafia-history-stats">{data.stats.map((row,i)=><article key={i}><MafiaRoleArt roleId={row.roleId}/><strong>{MAFIA_ROLES[row.roleId]?.name || 'دور'}</strong><small>{factionLabel(row.faction)}</small><span>{ar(row.matches)} مباراة · {ar(row.wins)} فوز · {ar(row.draws)} تعادل</span></article>)}</div><ol data-design-id="history">{data.matches.map(match=><li key={match.matchKey}><b>{MAFIA_ROLES[match.roleId]?.name || 'دور'} · {factionLabel(match.faction)}</b><span>{match.forfeited?'انسحاب':match.draw?'تعادل':match.won?'فوز الفريق':'خسارة الفريق'}</span><time dateTime={new Date(match.finishedAt).toISOString()}>{new Date(match.finishedAt).toLocaleDateString('ar-JO')}</time></li>)}</ol>{!data.matches.length&&<p data-design-id="empty">أول مجلس لك سيظهر هنا بعد اكتماله.</p>}</>}</div></Modal>;
}

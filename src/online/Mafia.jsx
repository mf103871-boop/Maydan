import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Button, Modal } from '../shared/ui/components.jsx';
import { ProfileAvatar } from '../profiles/ProfileAvatar.jsx';
import { Avatar } from '../shared/brand/art.jsx';
import { MafiaIcon, MafiaRoleArt, MafiaSceneArt, MafiaCardBack } from '../games/mafia/icon.jsx';
import { MAFIA_DEFAULT_SETTINGS, MAFIA_ALL_ROLES as MAFIA_ROLES, MAFIA_PHASES, MAFIA_FACTIONS } from './mafia-shared.js';
import { arabicNumber, errorText } from './shared.js';
import css from './mafia.css';
import { MAFIA_NOIR_ASSETS } from '../games/mafia/noir-assets.js';
import { useMafiaSound } from '../games/mafia/useMafiaSound.js';
import { MafiaRewardSummary } from './MafiaRewardSummary.jsx';
import { navigate } from '../platform/router.js';
import { MAFIA_REPORT_CATEGORIES } from './mafia-report-shared.js';
import { OnlineDirectoryView, OnlineRoomRow } from './OnlineDirectoryView.jsx';
import { mafiaTimelineScope, mergeMafiaTimeline, readMafiaTimeline, pageMafiaTimeline } from '../games/mafia/timeline.js';
import { createMafiaEventEffects } from '../games/mafia/event-effects.js';

const ar = arabicNumber;
const label = value => typeof value === 'string' ? value : value?.name || value?.label || '';
const phaseLabel = phase => label(MAFIA_PHASES[phase]) || 'مجلس ميدان';
const factionLabel = faction => label(MAFIA_FACTIONS[faction]) || 'غير معلن';
const noop = () => {};
const isActive = state => !['lobby', 'over', 'closed', 'waiting'].includes(state.phase) && !state.waiting;
const nameOf = (members, id) => members.find(player => player.id === id)?.name || 'لاعب';

function ToolIcon({ name }) {
  const paths = { role:'M5 3h12v17H5z M8 8h6 M8 12h6', clues:'M9 3h10v17H5V7z M9 3v5H5 M9 12h6 M9 16h6', notes:'m4 16 1 4 4-1L20 8l-5-5z M13 5l5 5', more:'M5 12h.01 M12 12h.01 M19 12h.01', action:'m13 2-9 12h7l-1 8 10-13h-8z', mic:'M9 5a3 3 0 0 1 6 0v7a3 3 0 0 1-6 0z M6 11v1a6 6 0 0 0 12 0v-1 M12 18v4 M8 22h8', muted:'M9 5a3 3 0 0 1 6 0v7 M6 11v1a6 6 0 0 0 10 4 M12 18v4 M8 22h8 M3 3l18 18', leave:'M8 4H4v16h4 M13 7l5 5-5 5 M8 12h10' };
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={paths[name] || paths.more}/></svg>;
}

export function MafiaEventOverlay({ effect }) {
  if (!effect) return null;
  return <aside data-design-id="event-overlay" data-event-id={effect.id} data-event-kind={effect.kind} className="mafia-event-overlay" role="status" aria-live="polite"><MafiaSceneArt sceneId={effect.scene || 'night'}/><div><strong>{effect.title}</strong>{effect.caption && <small>{effect.caption}</small>}</div></aside>;
}

function useMafiaVisualEffect(state, { ownerId, hidden, connection, remaining }) {
  const [controller] = useState(() => createMafiaEventEffects());
  const [effect, setEffect] = useState(null);
  useEffect(() => {
    const next = controller.update(state, { ownerId, hidden, connected: connection === 'connected', preview: Boolean(state._designPreview), remaining });
    if (next) setEffect(next);
    else if (hidden || connection !== 'connected') setEffect(null);
  }, [controller, state, ownerId, hidden, connection, remaining]);
  useEffect(() => {
    if (!effect) return undefined;
    const timer = setTimeout(() => setEffect(current => current?.id === effect.id ? null : current), effect.durationMs);
    return () => clearTimeout(timer);
  }, [effect]);
  useEffect(() => {
    const cover = () => { controller.suspend(); setEffect(null); };
    window.addEventListener('pagehide', cover);
    return () => window.removeEventListener('pagehide', cover);
  }, [controller]);
  return !hidden && connection === 'connected' && effect?.scope === mafiaTimelineScope(state, ownerId) ? effect : null;
}

// pagehide can precede document.hidden. Cover private DOM before a browser/native
// snapshot, and restore only the surface on pageshow, never a revealed card.
export function useMafiaPrivacy(enabled = true) {
  const [hidden, setHidden] = useState(() => enabled && typeof document !== 'undefined' && document.hidden);
  useEffect(() => {
    if (!enabled) return undefined;
    const cover = () => flushSync(() => setHidden(true));
    const visibility = () => { if (document.hidden) cover(); else flushSync(() => setHidden(false)); };
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('pagehide', cover); window.addEventListener('pageshow', visibility);
    return () => {
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('pagehide', cover); window.removeEventListener('pageshow', visibility);
    };
  }, [enabled]);
  return enabled && hidden;
}

export function normalizeMafiaSettings(value = {}) {
  const mode = value.mode === 'shadow' ? 'shadow' : 'classic';
  const min = mode === 'shadow' ? 9 : 6, max = mode === 'shadow' ? 12 : 8;
  return { mode, capacity: Math.max(min, Math.min(max, Number(value.capacity) || (mode === 'shadow' ? 10 : 8))), visibility: value.visibility === 'private' ? 'private' : 'public', roomName: typeof value.roomName === 'string' ? value.roomName : '', community: 'ar', voiceMode: value.voiceMode === 'off' ? 'off' : 'optional', ...(value.experimentalRole==='tracker'?{experimentalRole:'tracker',visibility:'private'}:{}) };
}

// Shared by room creation and the host's lobby editor. `present` counts the
// seats already taken: the server refuses a capacity below it.
function MafiaSettingsFields({ settings, onChange, disabled, present = 0, experimentalRolesEnabled = false }) {
  return <>
    <label className="mafia-name-field">اسم المجلس<input data-design-id="room-name" maxLength={30} value={settings.roomName} disabled={disabled} autoComplete="off" placeholder="مجلس الشلّة" onChange={event => onChange({ ...settings, roomName: event.target.value })}/></label>
    <div data-design-id="mode-choice" className="mafia-mode-picker" role="group" aria-label="طور المباراة">{[['classic','المجلس الأساسي','٦–٨ لاعبين · فريقان'],['shadow','رابطة الظل','٩–١٢ لاعبًا · ثلاثة أطراف']].map(([mode,title,detail]) => <button data-design-id="mode-option" type="button" key={mode} disabled={disabled || present > (mode === 'shadow' ? 12 : 8)} aria-pressed={settings.mode === mode} onClick={() => onChange(normalizeMafiaSettings({ ...settings, mode, capacity: mode === 'shadow' ? Math.max(10, present) : 8 }))}><strong>{title}</strong><small>{detail}</small></button>)}</div>
    <div className="mafia-settings-row"><label>سعة المجلس<select data-design-id="capacity" value={settings.capacity} disabled={disabled} onChange={event => onChange({ ...settings, capacity: Number(event.target.value) })}>{(settings.mode === 'shadow' ? [9,10,11,12] : [6,7,8]).map(n => <option key={n} value={n} disabled={n < present || settings.experimentalRole==='tracker'&&n<8}>{ar(n)} لاعبين</option>)}</select></label>
      <label>ظهور الغرفة<select data-design-id="visibility" disabled={disabled || settings.experimentalRole==='tracker'} value={settings.visibility} onChange={event => onChange({ ...settings, visibility: event.target.value })}><option value="private">خاصة · برمز أو دعوة</option><option value="public">عامة · يستقبل المجلس لاعبين</option></select></label></div>
    {(experimentalRolesEnabled || settings.experimentalRole==='tracker') && <label><input type="checkbox" checked={settings.experimentalRole==='tracker'} disabled={disabled || !experimentalRolesEnabled} onChange={event=>{const next={...settings,visibility:'private',capacity:settings.mode==='shadow'?Math.max(9,settings.capacity):8};if(event.target.checked)next.experimentalRole='tracker';else delete next.experimentalRole;onChange(next);}}/>المتعقّب التجريبي · مجلس خاص من ٨ لاعبين فأكثر، بلا XP أو تصنيف</label>}
    <label>التواصل<select data-design-id="voice-mode" disabled={disabled} value={settings.voiceMode} onChange={event => onChange({ ...settings, voiceMode: event.target.value })}><option value="optional">صوت ونص · الميكروفون اختياري</option><option value="off">نص فقط · دون اتصال صوتي</option></select></label>
  </>;
}

export function MafiaSettings({ value = MAFIA_DEFAULT_SETTINGS, onChange = noop, disabled = false, experimentalRolesEnabled = false }) {
  const settings = normalizeMafiaSettings(value);
  return <section data-design-screen="online.mafia.setup" className="mafia-noir mafia-settings stack" aria-label="إعداد مافيا ميدان"><style>{css}</style>
    <MafiaSettingsFields settings={settings} onChange={onChange} disabled={disabled} experimentalRolesEnabled={experimentalRolesEnabled}/>
    <p className="mafia-muted">حساب لكل لاعب. استضافة الغرف والانضمام واللعب مجانية بالكامل. لا تُباع قوة أو أفضلية في الأدوار.</p><MafiaRules />
  </section>;
}

function MafiaRoleDetails({ role, resources }) {
  const guide = role.guide;
  const remaining = role.id === 'guard' ? resources?.shield : resources?.charges;
  return <div className="mafia-role-details" dir="rtl">
    <dl>
      <div><dt>متى تعمل؟</dt><dd>{guide.timing}</dd></div>
      <div><dt>الرصيد الأساسي</dt><dd>{role.charges == null ? (role.ability ? 'دون حد عددي؛ التوقيت والقيود أدناه تحدد الاستخدام.' : 'دون قدرة خاصة.') : `${ar(role.charges)} ${role.id === 'guard' ? 'درع في المباراة.' : 'استعمال في المباراة.'}`}</dd></div>
      {Number.isFinite(remaining) && role.charges != null && <div className="mafia-role-balance"><dt>المتبقي لك الآن</dt><dd>{ar(remaining)} {role.id === 'guard' ? 'درع' : 'استعمال'}</dd></div>}
      {role.id === 'doctor' && Number.isFinite(resources?.selfProtection) && <div className="mafia-role-balance"><dt>حماية نفسك المتبقية</dt><dd>{ar(resources.selfProtection)}</dd></div>}
      <div><dt>الأهداف</dt><dd>{guide.targets.description}</dd></div>
      <div><dt>ما الذي تثبته؟</dt><dd>{guide.evidence.description}</dd></div>
      <div><dt>من يرى الأثر؟</dt><dd>{guide.visibility.description}</dd></div>
      <div><dt>التغيير والإلغاء</dt><dd>{guide.selection.description}</dd></div>
      <div><dt>متى يُستهلك؟</dt><dd>{guide.consumption.description}</dd></div>
    </dl>
    <div><h5>القيود وحدود المعلومة</h5><ul>{guide.limitations.map(text => <li key={text}>{text}</li>)}</ul></div>
    <div><h5>التداخل مع القدرات الأخرى</h5><ul>{guide.interactions.map(text => <li key={text}>{text}</li>)}</ul></div>
    <p className="mafia-role-example"><strong>مثال:</strong> {guide.example}</p>
  </div>;
}

export function MafiaRules({ possibleRoles, defaultOpen = false, onTutorial, onGuide = noop }) {
  const [open, setOpen] = useState(defaultOpen);
  const [lesson, setLesson] = useState(0);
  const lessons = [
    ['ابدأ من كلامهم', 'مثال تدريبي: ليان تقول «شاهدت عمر يتحرك ليلًا». هذا يثبت نشاطًا فقط، ولا يثبت فريقه. اسألها عن الليلة ونوع المعلومة.'],
    ['فرّق بين الدليل والادعاء', 'كل شخص يستطيع الادعاء بأنه المحقق. لا يرى الآخرون بطاقته. التحقيق يتأثر بالتمويه، والفريق قد يتغير بعد التجنيد.'],
    ['اسمع الدفاع ثم احكم', 'الترشيح يحدد مشتبهًا واحدًا. له ٢٠ ثانية للدفاع، ثم يصوّت الأحياء سرًا. يلزم أكثر من نصفهم للإقصاء.'],
    ['كل ليلة تغيّر المجلس', 'اختيارات الليل قابلة للتعديل حتى يغلق الخادم المرحلة. بعد الإقصاء تابع الأحداث، دون إرسال تلميحات للأحياء.'],
  ];
  return <>{!defaultOpen && <Button data-design-id="rules" variant="ghost" full onClick={() => {setOpen(true);onGuide('encyclopedia-open');}}>{possibleRoles ? 'الأدوار الممكنة ودليل اللعب' : 'دليل المجلس والأدوار الاثنا عشر'}</Button>}{open && <Modal className="mafia-noir mafia-guide-dialog" data-design-screen="online.mafia.guide" title="دليل مافيا ميدان" onClose={() => {setOpen(false);onGuide('encyclopedia-close');}}><style>{css}</style><div className="mafia-guide stack">{onTutorial && <><Button data-design-id="tutorial-start" onClick={()=>{setOpen(false);onTutorial();}}>تعلّم مع شخصيات التدريب</Button><Button data-design-id="specialist-training" aria-label="تمارين تخصص مافيا" onClick={()=>{setOpen(false);navigate('/tutorial/mafia?labs=1');}}>تمارين التخصص القصيرة</Button></>}<span className="mafia-kicker">تدريب توضيحي · شخصيات افتراضية</span><h3>{lessons[lesson][0]}</h3><p>{lessons[lesson][1]}</p><div className="row-between"><Button data-design-id="back" disabled={!lesson} onClick={() => setLesson(lesson - 1)}>السابق</Button><span>{ar(lesson + 1)} / ٤</span><Button data-design-id="continue" disabled={lesson === lessons.length - 1} onClick={() => setLesson(lesson + 1)}>التالي</Button></div><p className="mafia-muted">هذه موسوعة القدرات؛ وجود دور هنا لا يعني أنه موزّع في المباراة الحالية. الانتماء المكتوب هنا هو انتماء الدور عند التوزيع؛ التجنيد قد يغيّره.</p><div className="mafia-role-catalog">{Object.values(MAFIA_ROLES).filter(role => possibleRoles ? possibleRoles.includes(role.id) : role.id!=='tracker').map(role => <article key={role.id} data-role-id={role.id} className={`mafia-role-tile faction-${role.faction}`}><MafiaRoleArt roleId={role.id}/><div><h4>{role.name}</h4><small>انتماء البداية: {factionLabel(role.faction)}</small><p>{role.description}</p></div><details className="mafia-role-disclosure"><summary>تفاصيل قدرة {role.name}</summary><MafiaRoleDetails role={role}/></details></article>)}</div></div></Modal>}</>;
}

export function MafiaDirectory({ onTutorial, rooms = [], enabled, loading, error, mode = 'all', voiceMode = 'all', status = 'all', onMode = noop, onVoiceMode = noop, onStatus = noop, onRefresh = noop, onQuickJoin = noop, onJoin = noop, onObserve = noop, onCreate, onCode, nextCursor, hasPrevious, onNext = noop, onPrevious = noop, disabled, children, helpActions, footer }) {
  const filters = <div className="mafia-directory-filters">
    <label><span className="sr-only">نوع المجلس</span><select aria-label="نوع المجلس" data-design-id="directory-mode" disabled={disabled || loading} value={mode} onChange={e => onMode(e.target.value)}><option value="all">كل الأطوار</option><option value="classic">الأساسي</option><option value="shadow">رابطة الظل</option></select></label>
    <label><span className="sr-only">نوع التواصل</span><select aria-label="نوع التواصل" data-design-id="directory-voice" disabled={disabled || loading} value={voiceMode} onChange={e => onVoiceMode(e.target.value)}><option value="all">كل أنواع التواصل</option><option value="optional">صوت ونص</option><option value="off">نص فقط</option></select></label>
    <label><span className="sr-only">حالة المجلس</span><select aria-label="حالة المجلس" data-design-id="directory-status" disabled={disabled || loading} value={status} onChange={e => onStatus(e.target.value)}><option value="all">كل الحالات</option><option value="waiting">في الانتظار</option><option value="playing">يلعبون الآن</option><option value="finished">انتهت المباراة</option></select></label>
  </div>;
  return <section data-design-screen="online.mafia.directory" className="mafia-noir mafia-directory mafia-directory-dense" aria-label="الغرف العامة"><style>{css}</style><OnlineDirectoryView game="mafia" title="مافيا ميدان" rooms={rooms} enabled={enabled} loading={loading} error={error} disabled={disabled} onCreate={onCreate} createDisabled={enabled!==true||loading} onCode={onCode} onRefresh={onRefresh} onQuickJoin={onQuickJoin} filters={filters} help={<><MafiaRules onTutorial={onTutorial}/>{helpActions}{children}</>} footer={footer} nextCursor={nextCursor} hasPrevious={hasPrevious} onNext={onNext} onPrevious={onPrevious} emptyText="لا مجالس متاحة الآن. أنشئ مجلسًا أو غيّر التصفية." notice={enabled === false ? 'المجالس الجديدة غير متاحة حاليًا. المباريات القائمة تتابع حتى نهايتها.' : null} renderRoom={room => {
    const roomStatus = room.status || 'waiting', full = room.full ?? room.players >= room.capacity;
    const canJoin = roomStatus === 'waiting' && !full;
    return <OnlineRoomRow key={room.code} room={room} title={room.roomName || `مجلس ${room.hostName || 'ميدان'}`} subtitle={`${room.mode === 'shadow' ? 'رابطة الظل' : 'الأساسي'}${!canJoin && Number(room.protocol)<2?' · غرفة بإصدار سابق':''}${roomStatus === 'waiting' ? ` · ${ar(room.ready || 0)} جاهز` : ''}`} statusLabel={roomStatus === 'playing' ? 'يلعبون الآن' : roomStatus === 'finished' ? 'انتهت المباراة' : full ? 'ممتلئة' : 'انتظار'} voiceLabel={room.voiceMode === 'off' ? 'نص فقط' : 'صوت ونص'} canJoin={canJoin} canObserve={!canJoin && Number(room.protocol) >= 2} disabled={disabled || enabled !== true} onJoin={() => onJoin(room.code)} onObserve={() => onObserve(room.code)}/>;
  }}/></section>;
}

// Only the host edits the waiting room; unsaved edits live until saved or closed.
function MafiaLobbySettings({ state, disabled, act }) {
  const [editing, setEditing] = useState(false), [draft, setDraft] = useState(null), [editingRevision,setEditingRevision] = useState(null);
  const value = draft || normalizeMafiaSettings(state.settings);
  const close = () => { setEditing(false); setDraft(null); };
  return <div className="mafia-lobby-settings"><Button data-design-id="room-settings" full aria-expanded={editing} disabled={disabled} onClick={() => {if(editing)close();else{setEditingRevision(state.settingsRevision);setEditing(true);}}}>{editing ? 'إغلاق إعدادات المجلس' : 'تعديل إعدادات المجلس'}</Button>
    {editing && <><MafiaSettingsFields settings={value} onChange={setDraft} disabled={disabled} present={state.members.filter(m => !m.left).length}/><p className="mafia-muted">حفظ أي تغيير في الإعدادات يعيد الآخرين إلى «يستعد» حتى يؤكدوا من جديد.</p><Button data-design-id="save" full variant="primary" disabled={disabled} onClick={async () => { if (await act('settings', { settings: value, expectedSettingsRevision: editingRevision })) close(); }}>حفظ إعدادات المجلس</Button></>}</div>;
}

export function MafiaLobbyInfo({ state, isHost = false, disabled = false, act = noop }) {
  return <section data-design-screen="online.mafia.lobby" className="mafia-noir mafia-lobby-info stack"><style>{css}</style><div className="mafia-lobby-art" style={{'--mafia-environment':`url("${MAFIA_NOIR_ASSETS.environment}")`}}><MafiaIcon/><div><span className="mafia-kicker">كل وجه يخفي حكاية</span><h2>{state.settings?.mode === 'shadow' ? 'رابطة الظل' : 'المجلس الأساسي'}</h2><p>{ar(state.settings?.capacity || 8)} مقاعد · {state.settings?.visibility === 'public' ? 'غرفة عامة' : 'غرفة خاصة'}</p></div></div><div className="mafia-lobby-brief">{state.rulesetVersion===2&&<p role="status">مجلس المتعقّب التجريبي · ٨ لاعبين فأكثر · بلا XP أو إتقان أو تصنيف. التوازن لم يُعتمد بعد.</p>}<p>جهّز السماعات إن أمكن. استمع واكتب دون تشغيل الميكروفون، واكشف بطاقتك سرًا عند البداية.</p>{state.composition && <p className="mafia-composition"><span>{ar(state.composition.mafia)} مافيا</span><span>{ar(state.composition.town)} أهل الميدان</span>{state.composition.shadow>0 && <span>{ar(state.composition.shadow)} قائد للرابطة</span>}</p>}<p className="mafia-muted">التوزيع يثبت بحسب عدد الجاهزين. الأدوار الفعلية لا يراها المضيف، والقادم بعد البداية ينتظر المباراة التالية.</p></div>{isHost && <MafiaLobbySettings state={state} disabled={disabled} act={act}/>}<MafiaRules possibleRoles={state.possibleRoles}/></section>;
}

// Seat identity is stable; role art never chooses another player's public card.
export function MafiaPlayerCards({ state, me, voice = {}, selected = [], targets = [], onSelect, onSafety, onManage, disabled = false, tutorial = false }) {
  const players = (state.members || []).filter(player => !player.spectator && !player.left).slice().sort((a,b) => (a.seat || 0) - (b.seat || 0));
  const isLobby = state.phase === 'lobby';
  const permitted = state.scope !== 'observer' && state.settings?.voiceMode !== 'off' && (isLobby || state.you?.voice?.canListen === true) && !state.mafiaVoice?.quiet && !state.mafiaVoice?.outage;
  const currentEpoch = !Number.isSafeInteger(state.mafiaVoice?.mediaEpoch) || voice.mediaEpoch === state.mafiaVoice.mediaEpoch;
  const speaking = new Set((permitted && currentEpoch && voice.status === 'connected' ? voice.participants || [] : []).filter(p => p.speaking && !p.muted).map(p => p.id || p.identity));
  const targetMode = targets.length > 0 && typeof onSelect === 'function';
  return <div data-design-id="players" className="mafia-seats" aria-label="بطاقات لاعبي المجلس">{players.map((player,i) => {
    const eligible = targets.includes(player.id);
    const action = targetMode ? eligible ? () => onSelect(player.id) : null : onManage ? () => onManage(player) : player.id !== me?.id && onSafety ? () => onSafety(player) : null;
    const summary = isLobby ? player.ready ? 'جاهز' : 'يستعد' : player.alive === false ? 'مقصي' : speaking.has(player.id) ? 'يتحدث الآن' : '';
    return <button data-design-id="player-seat" data-player-id={player.id} type="button" key={player.id} disabled={disabled || !action} onClick={action || noop} aria-pressed={targetMode ? selected.includes(player.id) : undefined} aria-label={`المقعد ${player.seat || i+1}، ${player.name}${player.id === me?.id ? '، أنت' : ''}${summary ? `، ${summary}` : ''}`} className={`mafia-seat ${player.alive === false && !isLobby ? 'eliminated' : ''} ${speaking.has(player.id) ? 'speaking' : ''} ${eligible ? 'is-target' : ''} ${selected.includes(player.id) ? 'selected' : ''}`}>
      <span className="mafia-seat-number">{ar(player.seat || i+1)}</span><span className="mafia-seat-portrait">{player.profile ? <ProfileAvatar user={player.profile} size={36}/> : <Avatar index={player.avatar || 0}/>}<MafiaCardBack className="mafia-seat-seal"/></span><span className="mafia-seat-copy"><b>{player.id === me?.id ? 'أنت' : player.name}</b><small>{tutorial && player.id !== me?.id ? 'شخصية تدريب · ' : ''}{!player.connected ? 'يعيد الاتصال' : summary || 'في المجلس'}</small></span>
    </button>;
  })}</div>;
}

export function MafiaLobby({ state, me, isHost = false, disabled = false, act = noop, voice = {}, invite, appearance, onSafety, tutorial, accountId = '' }) {
  const [panel,setPanel] = useState(null), [managed,setManaged] = useState(null), [confirm,setConfirm] = useState(null);
  const players = state.members.filter(player => !player.left && !player.spectator);
  const minimum = state.settings?.mode === 'shadow' ? 9 : state.rulesetVersion===2 ? 8 : 6;
  const canStart = players.length >= minimum && players.every(player => player.connected && player.ready);
  return <section data-design-screen="online.mafia.lobby" className="mafia-noir mafia-shell mafia-compact-game mafia-density mafia-lobby-screen" dir="rtl"><style>{css}</style>
    <header data-design-id="header" className="mafia-heading"><div><span className="mafia-kicker">غرفة الانتظار · {ar(players.length)} / {ar(state.settings.capacity)}</span><h1>{state.settings.roomName || 'مجلس مافيا'}</h1></div><span className="mafia-voice-badge">{state.settings.voiceMode === 'off' ? 'نص فقط' : 'صوت ونص'}</span>{!tutorial && <><Button data-design-id="invite" aria-label="دعوة لاعبين" onClick={() => setPanel('invite')}>دعوة</Button><Button data-design-id="room-settings" aria-label="إعدادات المجلس" onClick={() => setPanel('settings')}>⋯</Button></>}</header>
    {state.settings.voiceMode !== 'off' && <MafiaVoice state={state} voice={voice}/>}{!tutorial&&state.settings.voiceMode !== 'off'&&voice.requested&&<p className="mafia-lobby-voice-note">للمحادثات الجانبية، غادر صوت الغرفة أولًا.</p>}
    <main className="mafia-activity"><MafiaChat state={state} you={state.you} me={me} accountId={accountId} members={players} disabled={disabled} act={act}/></main>
    <footer data-design-id="player-rail" className="mafia-player-rail"><div className="mafia-lobby-ready"><Button data-design-id="ready" disabled={disabled} variant={me?.ready ? 'secondary' : 'primary'} onClick={() => act('ready', { ready: !me?.ready })}>{me?.ready ? 'جاهز ✓' : 'أنا جاهز'}</Button>{isHost ? <Button data-design-id="start" data-design-required="true" disabled={disabled || !canStart} variant="primary" onClick={() => act('start')}>ابدأ اللعب</Button> : <span>المضيف يبدأ بعد الجاهزية</span>}</div><p className="mafia-rail-note" role="status">{canStart ? 'المجلس جاهز للبداية' : `نحتاج ${ar(minimum)} لاعبين متصلين وجاهزين على الأقل`}</p><MafiaPlayerCards state={state} me={me} voice={voice} disabled={disabled} tutorial={Boolean(tutorial)} onManage={tutorial ? undefined : player => setManaged(player)}/></footer>
    {panel && <Modal className="mafia-noir mafia-lobby-panel" data-design-screen="online.mafia.lobby" title={panel === 'invite' ? 'ادعُ للمجلس' : 'إعدادات المجلس'} onClose={() => setPanel(null)}><style>{css}</style>{panel === 'invite' ? invite : <>{appearance}<MafiaLobbyInfo state={state} isHost={isHost} disabled={disabled} act={act}/></>}</Modal>}
    {managed && <Modal className="mafia-noir" data-design-screen="online.mafia.lobby" title={managed.name} onClose={() => setManaged(null)}><style>{css}</style><div className="stack"><p>{managed.id === state.hostId ? 'مضيف المجلس' : 'لاعب في المجلس'}</p>{isHost && managed.id !== me?.id && <><Button data-design-id="member-host" disabled={disabled || !managed.connected} onClick={() => setConfirm({type:'host',targetId:managed.id,name:managed.name})}>تسليم الاستضافة</Button><Button data-design-id="member-remove" disabled={disabled} onClick={() => setConfirm({type:'kick',targetId:managed.id,name:managed.name})}>إزالة من الانتظار</Button></>}{managed.id !== me?.id && onSafety && <Button data-design-id="player-safety" onClick={() => {setPanel(null);onSafety(managed);setManaged(null);}}>الإبلاغ والحظر</Button>}</div></Modal>}
    {confirm && <MafiaConfirmModal title={confirm.type === 'kick' ? `إزالة ${confirm.name}؟` : `تسليم الاستضافة إلى ${confirm.name}؟`} message={confirm.type === 'kick' ? 'يخرج من هذا المجلس ولا يستطيع العودة إليه.' : 'يصبح اللاعب مسؤولًا عن الإعدادات وبدء المباراة.'} confirmLabel="تأكيد" onCancel={() => setConfirm(null)} onConfirm={async () => {if(await act(confirm.type,{targetId:confirm.targetId}) !== false){setConfirm(null);setManaged(null);}}}/>}
  </section>;
}

function useCountdown(deadline, offset, preview, serverNow, clock) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { if (!deadline || preview || clock) return undefined; const timer = setInterval(() => setNow(Date.now()), 250); return () => clearInterval(timer); }, [deadline, preview, clock]);
  if (clock) return Number.isFinite(clock.remainingMs) ? Math.max(0,Math.ceil(clock.remainingMs/1000)) : null;
  return deadline ? Math.max(0, Math.ceil((deadline - (preview && Number.isFinite(serverNow) ? serverNow : now + offset)) / 1000)) : null;
}
function SecretCard({ you, hidden, previewReveal, onGuide = noop }) {
  const [revealed, setRevealed] = useState(Boolean(previewReveal));
  useEffect(() => { if (hidden) setRevealed(false); }, [hidden]);
  const role = MAFIA_ROLES[you?.roleId];
  if (!role || hidden) return hidden ? <div data-design-id="privacy" data-design-required="true" className="mafia-secret-cover">بطاقتك محجوبة لحماية دورك</div> : null;
  return <section data-design-id="role-card" className="mafia-secret"><div className="mafia-secret-top"><span><span className="mafia-secret-seal" aria-hidden="true">◆</span> هويتك سرّك</span><Button data-design-id="role-toggle" data-sound="mafiaRole" variant="ghost" aria-expanded={revealed} aria-haspopup="dialog" aria-label="بطاقتي ودوري" title="بطاقتي ودوري" onClick={() => {setRevealed(true);onGuide('role-open');}}><ToolIcon name="role"/><span className="sr-only">اكشف بطاقتي</span></Button></div>
    {revealed && <Modal className="mafia-noir mafia-role-dialog" data-design-screen="online.mafia.role-card" title="بطاقتك الخاصة" closeLabel="إخفاء البطاقة" onClose={() => {setRevealed(false);onGuide('role-close');}} footer={<Button data-design-id="role-hide" full onClick={()=>{setRevealed(false);onGuide('role-close');}}>إخفاء البطاقة</Button>}><style>{css}</style><article data-design-id="role-content" className={`mafia-secret-content faction-${you.faction}`}><div className="mafia-role-portrait"><MafiaRoleArt roleId={role.id}/><span>سرّي · لك وحدك</span></div><div className="mafia-role-description"><span className="mafia-kicker">انتماؤك الآن: {factionLabel(you.faction)}</span><h2>{role.name}</h2><p>{role.description}</p><small>الآخرون لا يرون بطاقتك. أغلقها قبل إظهار الشاشة لأي شخص.</small><details className="mafia-role-disclosure"><summary>تفاصيل قدرتك ورصيدك</summary><MafiaRoleDetails role={role} resources={you.resources}/></details></div></article></Modal>}
  </section>;
}

function NarrativeCard({ state, members, compact = false }) {
  const phase = state.phase;
  const scenes = {lobby:'lobby',role:'deal',opening:'dawn',night:'night',dawn:'dawn',discussion:'dawn',nomination:'verdict',defense:'verdict',verdict:'verdict',over:'ending',closed:'ending'};
  const descriptions = {lobby:'تتابع حديث الانتظار بعد تأخير ثلاثين ثانية. يمكنك حجز مقعد عندما يصبح متاحًا.',role:'اقرأ قدرتك بعيدًا عن أعين الآخرين. بطاقتك لا يراها أحد سواك.',opening:'تعرّف إلى أصوات المجلس. كل شخص يملك حكاية… وليس كل حكاية دليلًا.',night:'حلّ الليل. اختيارات الأدوار سرية، وتغلق مع انتهاء الوقت.',dawn:'عاد الضوء إلى المجلس. هذه هي الأخبار التي يحق للجميع معرفتها.',discussion:'اسأل عن التفاصيل، اربط الروايات، واترك للآخرين فرصة الدفاع.',nomination:'من تحتاج روايته إلى دفاع؟ اختر أو امتنع، ثم أكّد صوتك.',defense:`المجلس يستمع إلى ${nameOf(members,state.nomineeId)}. الصوت والكتابة للمرشح وحده.`,verdict:'سمعت الدفاع. قرارك نهائي، والإقصاء يحتاج أكثر من نصف الأحياء.'};
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
  if(event.type==='tracking_report') return `${person} تتبّع ${nameOf(members,event.targetId)}: ${(event.destinationIds||[]).length?(event.destinationIds||[]).map(id=>nameOf(members,id)).join('، '):'لم تُرصد وجهة غير معطّلة'}.`;
  if(event.type==='attack_vote') return `${person} اختار ${nameOf(members,event.targetId)} لهجوم المافيا.`;
  if(event.type==='nomination_vote') return event.targetId ? `${person} رشّح ${nameOf(members,event.targetId)}.` : `${person} امتنع عن الترشيح.`;
  if(event.type==='verdict_votes') return `حكم المجلس على ${nameOf(members,event.nomineeId)}: ${ar(Object.values(event.votes || {}).filter(Boolean).length)} أصوات موافقة.`;
  if(event.type==='converted') return `انضم ${person} إلى رابطة الظل بتجنيد ${nameOf(members,event.recruiterId)}.`;
  if(event.type==='shield_used') return `${person} صدّ الهجوم بدرع الحارس.`;
  return texts[event.type] || texts[event.kind] || 'تحديث في المجلس';
}

export { eventText as mafiaEventText };

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
  if(report.type==='tracking') return `${nameOf(members,report.targetId)}: ${(report.destinationIds||[]).length?'الوجهات المقبولة غير المعطّلة: '+report.destinationIds.map(id=>nameOf(members,id)).join('، '):'لم تُرصد وجهة مقبولة غير معطّلة'}. لا يحدد التقرير القدرة أو الفريق أو نجاحها.`;
  if(report.type==='no_result') return 'لم تحصل على نتيجة لهذا الفحص. لا يُكشف سبب تعذّر النتيجة.';
  if(report.faction) return `${nameOf(members,report.targetId)}: ${factionLabel(report.faction)} وقت الفحص.`;
  if(report.same!==undefined) return `${(report.targetIds||[]).map(id=>nameOf(members,id)).join(' و')}: الانتماء الظاهر ${report.same?'متطابق':'مختلف'}.`;
  if(report.acted!==undefined) return `${nameOf(members,report.targetId)} ${report.acted?'قدّم فعلًا ليليًا مقبولًا غير معطّل':'لم يُرصد له فعل ليلي مقبول غير معطّل'}.`;
  return 'انتهى فحصك لهذه الليلة.';
}

function MafiaVoice({ voice = {}, state }) {
  const connected = ['connected','on','silent'].includes(voice.status);
  const recovering = ['connecting','reconnecting'].includes(voice.status);
  const quiet = Boolean(state.mafiaVoice?.quiet) || voice.status === 'silent' || (state.phase === 'night' && state.you?.voice?.canListen === false);
  // The provider could not secure a channel: the match goes on over text and
  // voice returns by itself once the server confirms the old grants are gone.
  const outage = Boolean(state.mafiaVoice?.outage);
  const currentEpoch = !Number.isSafeInteger(state.mafiaVoice?.mediaEpoch) || voice.mediaEpoch === state.mafiaVoice.mediaEpoch;
  const canSpeak = Boolean(voice.canPublish && !quiet && !outage && !recovering && currentEpoch && (state.phase === 'lobby' || state.you?.voice?.canSpeak !== false));
  const [actionError,setActionError] = useState('');
  const run = async task => {setActionError('');try{await task?.();}catch(error){setActionError(/[\u0600-\u06ff]/.test(error?.message || '')?error.message:'تعذّر تنفيذ أمر الصوت. حاول مجددًا.');}};
  return <div data-design-id="voice" data-design-required="true" className="mafia-voice" data-mafia-call-controls={voice.simulated ? undefined : state.mafiaVoice?.callId} data-mafia-controls-ready={voice.simulated ? undefined : Boolean((connected || voice.requested) && typeof voice.onLeave==='function') ? 'true' : 'false'}>
    <div><b>{voice.simulated ? 'محاكاة الصوت · لا يوجد اتصال' : outage ? 'الصوت متوقف مؤقتًا' : recovering ? 'نؤمّن الاتصال الصوتي…' : quiet ? (state.phase === 'night' ? 'الليل هادئ الآن' : 'المجلس هادئ لحظات') : connected ? 'صوت المجلس متصل' : 'اسمع المجلس وشارك بصوتك'}</b>
      <small>{voice.simulated ? 'تدرّب على الأزرار؛ لا نطلب الميكروفون ولا نغيّر مكالمتك الحالية.' : outage ? 'تعذّر تأمين قناة الصوت، فلم نفتح قناة جديدة. المباراة مستمرة بالكتابة، ويعود الصوت تلقائيًا عند توفره.' : quiet ? voice.requested ? 'سيعود صوت المجلس تلقائيًا عندما تبدأ مرحلة الاستماع.' : 'فعّل صوت النهار الآن ليعود تلقائيًا عند بدء النقاش.' : state.phase === 'night' ? 'مسارات الليل معزولة حسب الفريق' : state.phase === 'defense' ? 'الصوت للمرشح فقط أثناء الدفاع' : 'الميكروفون اختياري؛ الكتابة متاحة حسب المرحلة'}</small></div>
    <div className="mafia-voice-actions">{connected || voice.requested ? <>
      <Button data-design-id="mute" aria-label={!canSpeak ? 'الميكروفون مغلق' : voice.muted ? 'شغّل الميكروفون' : 'اكتم الميكروفون'} title={!canSpeak ? 'الميكروفون مغلق حسب المرحلة' : voice.muted ? 'شغّل الميكروفون' : 'اكتم الميكروفون'} className="mafia-voice-icon" disabled={!voice.onMute || !canSpeak} onClick={() => run(() => voice.onMute(!voice.muted))}><ToolIcon name={!canSpeak || voice.muted ? 'muted' : 'mic'}/></Button>
      {connected && voice.onSpeaker && voice.audioOutputs?.length > 0 && <label><span className="sr-only">مخرج الصوت</span><select aria-label="مخرج الصوت" data-design-id="audio-output" value={voice.outputId || 'default'} onChange={event => run(() => voice.onSpeaker(event.target.value))}>{voice.audioOutputs.map(output => <option key={output.id || output.deviceId} value={output.id || output.deviceId}>{output.label || 'السماعة'}</option>)}</select></label>}
      <Button data-design-id="voice-leave" aria-label="افصل الصوت" title="افصل الصوت" className="mafia-voice-icon" variant="ghost" disabled={!voice.onLeave} onClick={() => run(voice.onLeave)}><ToolIcon name="leave"/></Button>
    </> : <Button data-design-id="voice-join" disabled={!voice.onJoin || recovering || outage} onClick={() => run(voice.onJoin)}>{quiet ? 'تفعيل صوت النهار' : 'الانضمام بالصوت'}</Button>}</div>
    {(connected || voice.requested) && voice.onResume && voice.audioBlocked && <Button data-design-id="voice-resume" onClick={() => run(voice.onResume)}>اضغط لاستعادة الصوت</Button>}
    {!outage && (voice.error || actionError) && <p role="alert">{actionError || (/[\u0600-\u06ff]/.test(voice.error) ? voice.error : errorText(voice.error))}</p>}
  </div>;
}

function TimelineText({ text = '' }) {
  if (text.length <= 220) return <p dir="auto">{text}</p>;
  return <details className="mafia-long-message"><summary>{text.slice(0, 140)}… <span>اقرأ كامل الرسالة</span></summary><p dir="auto">{text}</p></details>;
}

export function MafiaChat({ state, you, me, members, disabled, act, accountId = '' }) {
  const watchOnly = state.scope === 'observer', lobby = state.phase === 'lobby' && !watchOnly;
  const ownerId = accountId || me?.id || '';
  const draftKey = `${ownerId}:${state.code}:${state.matchId}:${state.phaseId}`;
  const [draft,setDraft] = useState({key:draftKey,text:''});
  const text = draft.key === draftKey ? draft.text : '';
  const setText = value => setDraft({key:draftKey,text:value});
  const [sending,setSending] = useState(false), [error,setError] = useState(''), [channel,setChannel] = useState('public');
  const alive = Boolean(me?.alive && !you?.pendingForfeit);
  const team = alive && state.phase === 'night' && ['mafia','shadow'].includes(you?.faction);
  const observer = !watchOnly && !alive && Boolean(you?.roleId);
  const allowedChannel = team ? 'team' : observer ? 'observers' : 'public';
  const actualChannel = channel === 'public' && observer ? 'public' : allowedChannel;
  const writable = !watchOnly && !['over','closed'].includes(state.phase) && (lobby || team || observer || (alive && ['opening','discussion','nomination','verdict'].includes(state.phase)) || (alive && state.phase === 'defense' && state.nomineeId === me.id));
  const channelKey = actualChannel === 'team' ? `team:${you.faction}` : actualChannel;
  const chats = Array.isArray(state.chats) ? state.chats : state.chats?.[actualChannel] || [];
  const messages = chats.filter(item => !item.channel || item.channel === actualChannel);
  const scope = mafiaTimelineScope(state, ownerId);
  const [archive,setArchive] = useState(null);
  const cache = useMemo(() => mergeMafiaTimeline(archive,{scope,channel:channelKey,events:state.log || [],messages}), [archive,scope,channelKey,state.log,messages]);
  useEffect(() => { if (cache !== archive) setArchive(cache); }, [cache,archive]);
  const allRows = useMemo(() => readMafiaTimeline(cache,channelKey), [cache,channelKey]);
  const viewKey = `${scope}:${channelKey}`;
  const [shown,setShown] = useState(() => ({key:viewKey,start:Math.max(0,allRows.length-40)}));
  const visibleStart = shown.key === viewKey ? shown.start : Math.max(0,allRows.length-40);
  const page = pageMafiaTimeline(allRows,allRows.length-visibleStart);
  const list = useRef(null), follow = useRef(true), layout = useRef(null), restoreAnchor = useRef(false);
  const [unread,setUnread] = useState(0);
  useEffect(() => { setDraft({key:draftKey,text:''}); setError(''); setChannel(allowedChannel); }, [draftKey,allowedChannel]);
  useLayoutEffect(() => {
    const element = list.current;
    if (!element) return;
    const previous = layout.current;
    if (!previous || previous.key !== viewKey) { follow.current = true; element.scrollTop = element.scrollHeight; setUnread(0); setShown(current=>current.key===viewKey?current:{key:viewKey,start:page.earlier}); }
    else if (restoreAnchor.current) { element.scrollTop = previous.top + element.scrollHeight - previous.height; restoreAnchor.current = false; }
    else if (follow.current) { element.scrollTop = element.scrollHeight; setUnread(0); }
    else if (allRows.length > previous.count) setUnread(count => count + allRows.length - previous.count);
    layout.current = {key:viewKey,height:element.scrollHeight,top:element.scrollTop,count:allRows.length};
  }, [allRows,viewKey,page.earlier]);
  async function send(event) {
    event.preventDefault(); if (!text.trim() || disabled || sending || !writable || actualChannel !== allowedChannel) return;
    const submittedKey = draftKey;
    setSending(true);setError('');
    try { if(await act('chat',{channel:allowedChannel,text:text.trim(),clientId:crypto.randomUUID()}) !== false) setDraft(current => current.key === submittedKey ? {key:submittedKey,text:''} : current); }
    catch { setError('تعذّر إرسال الرسالة. جرّب مجددًا.'); }
    finally { setSending(false); }
  }
  return <section data-design-id="chat" className={`mafia-chat channel-${actualChannel}`}><div className="mafia-panel-heading"><h3>{actualChannel === 'team' ? 'حديث الفريق · سري' : actualChannel === 'observers' ? 'مجلس المقصيين' : 'المحادثة والأحداث'}</h3><span className="mafia-channel-tag">{actualChannel === 'team' ? 'قناة خاصة' : actualChannel === 'observers' ? 'للمتابعين' : 'عام'}</span>{observer && <Button data-design-id="chat-channel" size="sm" onClick={() => setChannel(actualChannel === 'public' ? 'observers' : 'public')}>{actualChannel === 'public' ? 'حديث المقصيين' : 'متابعة الأحياء'}</Button>}</div>
    <div data-design-id="messages" ref={list} onScroll={event => { const el=event.currentTarget;follow.current=el.scrollHeight-el.scrollTop-el.clientHeight<50;if(follow.current)setUnread(0);if(layout.current)layout.current={...layout.current,top:el.scrollTop,height:el.scrollHeight}; }} className="mafia-chat-messages" role="log" aria-live={unread ? 'off' : 'polite'} aria-relevant="additions" tabIndex={0} aria-label="سجل المحادثة وأحداث المجلس">
      <details className="mafia-timeline-info"><summary>{lobby ? 'انتظر الجاهزية ثم ابدأ المجلس' : 'عن سجل هذه الجلسة'}</summary><p>يعرض الخادم آخر ٢٥٦ حدثًا عامًا وآخر ١٠٠ رسالة مسموحة من كل قناة. تحتفظ هذه الشاشة بما وصل إليك أثناء الجلسة؛ الرسائل الأقدم غير المحمّلة قد لا تتوفر بعد إعادة فتح الصفحة.</p></details>
      {page.earlier > 0 && <Button data-design-id="load-older" variant="ghost" onClick={() => {restoreAnchor.current=true;setShown({key:viewKey,start:Math.max(0,page.earlier-40)});}}>عرض الأقدم · {ar(page.earlier)}</Button>}
      {page.rows.map(item => item.kind === 'event' ? <article data-design-id="event" data-timeline-id={item.key} key={item.key} className="mafia-event-card"><span className="mafia-public-seal" aria-hidden="true">◆</span><div><small>حدث معلن</small><TimelineText text={eventText(item.value,members)}/></div></article> : <article data-timeline-id={item.key} key={item.key} className={`mafia-message ${me?.id && [item.value.senderId,item.value.playerId].includes(me.id)?'is-own':''}`}><span className="mafia-message-seat" aria-hidden="true">{ar(members.find(p=>p.id===(item.value.senderId||item.value.playerId))?.seat||'·')}</span><div><b>{nameOf(members,item.value.senderId||item.value.playerId)}</b><TimelineText text={item.value.text}/></div></article>)}
      {!page.total && <p className="mafia-chat-empty">{writable?'ابدأ الحديث… ثم تابع الأدلة.':'تظهر هنا الرسائل والأحداث المسموحة لك.'}</p>}
    </div>
    {unread > 0 && <button type="button" data-design-id="new-messages" className="mafia-new-messages" onClick={() => {follow.current=true;if(list.current)list.current.scrollTop=list.current.scrollHeight;setUnread(0);}}>↓ {ar(unread)} تحديث جديد</button>}
    {writable && actualChannel === allowedChannel ? <form data-design-id="composer" onSubmit={send}><label className="sr-only" htmlFor="mafia-message">رسالتك إلى {actualChannel === 'team' ? 'الفريق' : 'المجلس'}</label><input data-design-id="message-input" id="mafia-message" maxLength={400} autoComplete="off" value={text} onChange={e=>setText(e.target.value)} placeholder={actualChannel==='team'?'رسالة للفريق…':'اكتب للمجلس…'} disabled={disabled||sending}/><Button data-design-id="send" type="submit" disabled={disabled||sending||!text.trim()}>إرسال</Button></form> : <p className="mafia-chat-locked">{watchOnly?'مشاهدة فقط · لا صوت أو رسائل للاعبين':observer?'تتابع الأحياء دون إرسال رسائل إليهم.':state.phase==='defense'?'الدفاع للمرشح وحده؛ استمع إلى روايته.':'الحديث العام متوقف في هذه المرحلة.'}</p>}{error&&<p role="alert">{error}</p>}
  </section>;
}

function ActionPanel({ state, you, me, members, disabled, act, selection }) {
  const [localSelected, setLocalSelected] = useState([]);
  const selected = selection?.selected || localSelected;
  const [confirm, setConfirm] = useState(null);
  const [localNightTool,setLocalNightTool] = useState(you?.actions?.some(action=>action.type==='mafia_vote') ? 'attack' : 'ability');
  const nightTool = selection?.nightTool || localNightTool, setNightTool = selection?.setNightTool || setLocalNightTool;
  useEffect(() => { setLocalSelected([]); setConfirm(null); }, [state.phaseId, state.matchId]);
  if (!me?.alive || !you?.roleId) return null;
  const actions = Array.isArray(you.actions) ? you.actions : [];
  const rawAbility = actions.find(action => action.type === 'night_action');
  const ballot = actions.find(action => action.type === 'mafia_vote');
  const ability = ballot && nightTool === 'attack' ? null : rawAbility;
  const showBallot = !!ballot && (!rawAbility || nightTool === 'attack');
  const nominationAction = actions.find(action => action.type === 'nominate');
  const nomination = state.phase === 'nomination' && !you.nominationSubmitted && !!nominationAction;
  const verdict = state.phase === 'verdict' && !you.verdictSubmitted && actions.some(action => action.type === 'verdict');
  const actionLabel = state.phase === 'night' ? (you.roleId==='tracker'?'تتبّع الوجهة الليلي':'اختيارك الليلي') : phaseLabel(state.phase);
  const hasHerald = actions.some(action => action.type === 'herald');
  if (!['night','nomination','verdict'].includes(state.phase) && !hasHerald) return null;
  const submit = async () => { await act(nomination ? 'nominate' : 'night_action', nomination ? { targetId: selected[0] || null } : you.roleId === 'analyst' ? { targetIds: selected } : { targetId: selected[0] }); };
  return <section data-design-id="ability" className="mafia-ability"><div className="mafia-ability-heading"><h3>{showBallot ? 'اختيار المافيا الليلي' : actionLabel}</h3>{ability?.remaining != null && <small>متاح: {ar(ability.remaining)}</small>}</div>{rawAbility && ballot && <div className="mafia-action-tabs" role="group" aria-label="إجراءاتك الليلية"><Button data-design-id="night-attack-tab" aria-pressed={nightTool==='attack'} onClick={()=>setNightTool('attack')}>الهجوم المشترك</Button><Button data-design-id="night-ability-tab" aria-pressed={nightTool==='ability'} onClick={()=>setNightTool('ability')}>قدرتي · {ar(rawAbility.remaining)} متاح</Button></div>}{(ability || nomination) && <><p>{nomination ? 'اختر مشتبهًا أو امتنع. لا يتغير صوتك بعد التأكيد.' : you.roleId === 'analyst' ? 'اختر لاعبين مختلفين للمقارنة.' : 'اختر الهدف. يمكنك تغيير اختيارك حتى ينتهي الليل.'}</p>{selection && <p className="mafia-selection-summary" role="status">{selected.length ? `اختيارك: ${selected.map(id=>nameOf(members,id)).join(' و')}` : 'اختر من بطاقات اللاعبين أدناه'}</p>}<Button data-design-id="ability-submit" disabled={disabled || selected.length < (you.roleId === 'analyst' && ability ? 2 : 1)} onClick={() => nomination ? setConfirm({ kind: 'nominate', targetId: selected[0] }) : submit()}>{nomination ? 'تأكيد الترشيح' : 'اعتماد اختيار الليل'}</Button>{nomination && <Button data-design-id="abstain" variant="ghost" disabled={disabled} onClick={() => setConfirm({ kind: 'nominate', targetId: null })}>امتنع عن الترشيح</Button>}{you.nightAction && <><p role="status">اختيارك محفوظ لهذه الليلة. يمكنك تغييره قبل نهاية الوقت.</p><Button data-design-id="cancel-ability" variant="ghost" disabled={disabled} onClick={() => act('night_action',{targetId:null})}>إلغاء اختيار الليل</Button></>}</>}
    {showBallot && <div className="mafia-kill-ballot"><p>اختر من بطاقات اللاعبين، ثم أكّد الهجوم. التعادل يلغي الهجوم.</p><p className="mafia-selection-summary" role="status">{selected.length ? `الهدف: ${nameOf(members,selected[0])}` : you.killTarget ? `المحفوظ: ${nameOf(members,you.killTarget)}` : 'اختر هدفًا للهجوم'}</p><Button data-design-id="mafia-vote" disabled={disabled || !selected.length} onClick={()=>act('mafia_vote',{targetId:selected[0]})}>اعتماد هدف الهجوم</Button>{teamBallotText(you,members) && <p className="mafia-muted" role="status">اختيارات فريقك: {teamBallotText(you,members)}</p>}<Button data-design-id="abstain" variant="ghost" disabled={disabled} onClick={()=>act('mafia_vote',{targetId:null})}>لا أختار هدفًا</Button></div>}
    {verdict && <><p>هل تؤيد إقصاء <b>{nameOf(members,state.nomineeId)}</b>؟ يلزم أكثر من نصف الأحياء. صوتك نهائي.</p><div className="mafia-settings-row"><Button data-design-id="verdict-yes" disabled={disabled} onClick={() => setConfirm({ kind:'verdict', approve:true })}>أوافق على الإقصاء</Button><Button data-design-id="verdict-no" variant="secondary" disabled={disabled} onClick={() => setConfirm({ kind:'verdict', approve:false })}>أرفض الإقصاء</Button></div></>}
    {actions.some(action => action.type === 'herald') && <Button data-design-id="herald" disabled={disabled} onClick={() => setConfirm({kind:'herald'})}>استخدم المنادي · أضف ٢٠ ثانية</Button>}
    {!ability && !ballot && !nomination && !verdict && <p className="mafia-muted" role="status">{state.phase === 'nomination' && you.nominationSubmitted ? (you.myNomination ? `سُجّل ترشيحك: ${nameOf(members,you.myNomination)}. لا يتغير بعد التأكيد.` : 'سُجّل امتناعك عن الترشيح في هذه الجولة.') : state.phase === 'verdict' && you.verdictSubmitted ? `سُجّل حكمك: ${you.myVerdict ? 'تؤيد الإقصاء' : 'ترفض الإقصاء'}. النتيجة عند انتهاء الوقت.` : state.phase === 'night' ? 'لا إجراء متاح لك الآن. تابع المرحلة واحتفظ بملاحظاتك.' : 'تابع النقاش؛ الإجراءات المتاحة تظهر هنا في وقتها.'}</p>}
    {confirm && <MafiaConfirmModal title="تؤكد اختيارك؟" message={confirm.kind === 'herald' ? 'تُستخدم قدرة المنادي مرة واحدة في المباراة، ويرى المجلس أنك من استخدمها.' : confirm.kind === 'verdict' ? confirm.approve ? 'تؤيد إقصاء المرشح. لا يمكنك تغيير الحكم بعد التأكيد.' : 'ترفض إقصاء المرشح. لا يمكنك تغيير الحكم بعد التأكيد.' : confirm.targetId ? `ترشّح ${nameOf(members,confirm.targetId)}. لن يتغير صوتك بعد التأكيد.` : 'تمتنع عن الترشيح لهذه الجولة.'} confirmLabel="اعتمد اختياري" onCancel={() => setConfirm(null)} onConfirm={async () => { const {kind,...fields} = confirm; const ok = await act(kind,fields); if (ok !== false) setConfirm(null); }}/>}
  </section>;
}

export function MafiaMatchView({ state, me, isHost, disabled = false, act = noop, clockOffset = 0, accountId = '', voice = {}, onSafety, clock, tutorial, rewardServer, sound, connection = 'connected' }) {
  const hidden = useMafiaPrivacy();
  const ownerId = accountId || me?.id || '';
  const notesKey = `${ownerId}:${state.code}:${state.matchId}`;
  const [noteDraft,setNoteDraft] = useState({key:notesKey,text:''});
  const notes = noteDraft.key === notesKey ? noteDraft.text : '';
  const setNotes = text => setNoteDraft({key:notesKey,text});
  const [tab,setTab] = useState(state._designPreview && state.previewTab || 'council');
  const [safety,setSafety] = useState(null), [toolsOpen,setToolsOpen] = useState(Boolean(state._designPreview&&state.previewTools));
  const [historyOpen,setHistoryOpen] = useState(false);
  const tutorialActive = Boolean(tutorial);
  const defaultActionOpen = tutorialActive || Boolean(state._designPreview && state.previewAction === true);
  const [actionOpen,setActionOpen] = useState(defaultActionOpen);
  const choiceKey = `${ownerId}:${state.code}:${state.matchId}:${state.phaseId}`;
  const [choice,setChoice] = useState({key:choiceKey,ids:[],tool:'attack'});
  const selected = choice.key === choiceKey ? choice.ids : [], nightTool = choice.key === choiceKey ? choice.tool : 'attack';
  const setSelected = next => setChoice(old=>({key:choiceKey,tool:old.key===choiceKey?old.tool:'attack',ids:typeof next==='function'?next(old.key===choiceKey?old.ids:[]):next}));
  const setNightTool = tool => setChoice({key:choiceKey,ids:[],tool});
  const remaining = useCountdown(state.deadlineAt,clockOffset,state._designPreview,state.serverNow,clock);
  useMafiaSound(state,{hidden:hidden || connection!=='connected',preview:Boolean(state._designPreview),sound,remaining:clock?.paused?null:remaining,ownerId});
  const effect = useMafiaVisualEffect(state,{ownerId,hidden,connection,remaining});
  const you = state.scope === 'observer' || state.waiting || (state.you?.id && state.you.id !== me?.id) ? null : state.you;
  const members = state.members || [], observer = state.scope === 'observer', finished = ['over','closed'].includes(state.phase);
  useEffect(() => {setNoteDraft({key:notesKey,text:''});setTab(state._designPreview&&state.previewTab||'council');setSafety(null);setHistoryOpen(false);setToolsOpen(Boolean(state._designPreview&&state.previewTools));}, [notesKey,state._designPreview,state.previewTab,state.previewTools]);
  useEffect(() => {setActionOpen(defaultActionOpen);}, [choiceKey,defaultActionOpen]);
  useLayoutEffect(() => {if(hidden){setTab('council');setSafety(null);setToolsOpen(false);setActionOpen(false);}}, [hidden]);
  const actions = !observer && me?.alive && you?.roleId ? you.actions || [] : [];
  const attack = actions.find(action=>action.type==='mafia_vote');
  const action = actions.find(item=>item.type === (state.phase==='nomination'?'nominate':attack&&nightTool==='attack'?'mafia_vote':'night_action'));
  const targets = (action?.targets||[]).map(target=>typeof target==='string'?target:target.id);
  const selection = {selected,setSelected,nightTool,setNightTool};
  const pick = id => {setSelected(old=>you?.roleId==='analyst'&&action?.type==='night_action'?old.includes(id)?old.filter(value=>value!==id):[...old.slice(-1),id]:[id]);setActionOpen(true);};
  const seats = <MafiaPlayerCards state={state} me={me} voice={observer?{}:voice} selected={selected} targets={targets} onSelect={pick} onSafety={onSafety?player=>setSafety(player):undefined} disabled={disabled} tutorial={Boolean(tutorial)}/>;
  const actionTitle = state.phase==='nomination'?'رشّح أو امتنع':state.phase==='verdict'?'أصدر حكمك':state.phase==='discussion'?'قدرة المنادي':you?.roleId==='analyst'?'قارن بين لاعبين':attack&&nightTool==='attack'?'اختيار هدف الهجوم':'اختيار قدرتك';
  const decisionStatus = state.phase==='nomination'&&you?.nominationSubmitted ? (you.myNomination?`سُجّل ترشيحك: ${nameOf(members,you.myNomination)}. لا يتغير بعد التأكيد.`:'سُجّل امتناعك عن الترشيح في هذه الجولة.') : state.phase==='verdict'&&you?.verdictSubmitted ? `سُجّل حكمك: ${you.myVerdict?'تؤيد الإقصاء':'ترفض الإقصاء'}. النتيجة عند انتهاء الوقت.` : '';
  const resultTitle = state.reason==='voice_unavailable'?'انتهت المباراة بسبب الاتصال':state.outcome?.faction==='draw'||state.outcome==='draw'?'المجلس انتهى بالتعادل':state.phase==='closed'&&!state.outcome?'انتهت صلاحية الغرفة':`النتيجة: ${factionLabel(typeof state.outcome==='string'?state.outcome:state.outcome?.faction||state.outcome?.winner)}`;
  if(hidden&&isActive(state))return <MafiaPrivacy/>;
  if(state.waiting&&!observer)return <section data-design-screen="online.mafia.waiting" className="mafia-noir mafia-shell mafia-waiting"><style>{css}</style><h2>مكانك للمجلس التالي</h2><p data-design-id="notice">تدخل في المباراة التالية. تبقى أدوار ومحادثات المباراة الجارية محجوبة عن المنتظرين.</p><MafiaRules/></section>;
  return <section data-design-screen={state._designPreview&&state.previewScene||`online.mafia.${state.phase}`} aria-label="مافيا ميدان" className={`mafia-noir mafia-shell mafia-compact-game mafia-density phase-${state.phase} ${observer?'is-observer':''} ${finished?'is-finished':'has-player-rail'}`} dir="rtl"><style>{css}</style>
    <header data-design-id="header" className="mafia-heading"><div className="mafia-phase-copy"><h1>{state.settings?.roomName||'مجلس مافيا'}</h1><p><strong data-design-id="phase-title">{phaseLabel(state.phase)}</strong> · {state.phase==='night'?'الليلة':'اليوم'} {ar(state.round||1)}</p></div>{remaining!==null&&!finished&&<div data-design-id="timer" data-design-required="true" className={`mafia-clock ${remaining<=10?'urgent':''}`} role="timer" aria-label={`${ar(remaining)} ثانية متبقية${clock?.paused?'؛ وقت التدريب متوقف':''}`}><b>{ar(remaining)}</b><small>{clock?.paused?'متوقف':'ثانية'}</small></div>}
      {!finished&&you?.roleId&&<SecretCard key={`${ownerId}:${state.matchId}:${you.roleId}:${you.faction}`} you={you} hidden={hidden} previewReveal={state._designPreview&&state.previewReveal} onGuide={tutorial?.onGuide}/>}
      {!finished&&!observer&&<Button data-design-id="tab.clues" aria-label="أدلتي الخاصة" aria-pressed={tab==='clues'} title="أدلتي الخاصة" className="mafia-tool" onClick={()=>{setTab('clues');tutorial?.onGuide?.('clues-open');}}><ToolIcon name="clues"/>{you?.reports?.length>0&&<span className="mafia-tool-dot"/>}</Button>}
      <Button data-design-id="mafia-tools" data-design-required="true" aria-label="المساعدة والملاحظات وأدوات المجلس" title="أدوات المجلس" className="mafia-tool" onClick={()=>setToolsOpen(true)}><ToolIcon name="more"/></Button>
    </header>
    {!observer&&state.settings?.voiceMode!=='off'&&isActive(state)&&<MafiaVoice voice={voice} state={state}/>}
    <main className={`mafia-activity ${finished?'is-results':''}`}>
      {finished&&<section data-design-id="results" className="mafia-results"><MafiaSceneArt sceneId="ending" className="mafia-result-art"/><h2>{resultTitle}</h2><p>{state.reason === 'voice_unavailable' ? 'تعذّر تأمين قنوات الصوت. لا نفتح قناة قد تكشف الأسرار.' : 'تُكشف الأدوار والأحداث المهمة هنا؛ المحادثات السرية تبقى خاصة.'}</p><div data-design-id="recap" className="mafia-recap">{(Array.isArray(state.replay) ? state.replay : state.replay?.players || state.replay?.roles || []).map((item,i) => <article key={item.id || i}><MafiaRoleArt roleId={item.roleId}/><b>{nameOf(members,item.playerId || item.id)}</b><span>{MAFIA_ROLES[item.roleId]?.name || 'دور'}</span><small>{factionLabel(item.faction)}{item.initialFaction && item.initialFaction!==item.faction ? ` · بدأ مع ${factionLabel(item.initialFaction)}` : ''}</small></article>)}</div>{state.replay?.events && <ol>{state.replay.events.map((event,i) => <li key={event.id || i}>{eventText(event,members)}</li>)}</ol>}{!tutorial && isHost && state.phase === 'over' && <Button data-design-id="restart" disabled={disabled} full onClick={() => act('restart')}>إلى الانتظار · مجلس جديد</Button>}{voice.onReturnToCall && voice.previousCall && <Button data-design-id="return-call" onClick={voice.onReturnToCall}>العودة لمكالمة الشلّة</Button>}</section>}
      {!finished&&observer&&<p data-design-id="observer-delay" data-design-required="true" className="mafia-observer-delay" role="status">مشاهدة متأخرة ٣٠ ثانية · دون صوت أو إرسال للاعبين</p>}
      {!finished&&state.phase==='defense'&&<p data-design-id="defense" className="mafia-notice">الدفاع لـ <b>{nameOf(members,state.nomineeId)}</b> · يستمع المجلس</p>}
      {!finished&&!observer&&you?.roleId&&!me?.alive&&<p className="mafia-observer-delay" role="status">أنت الآن تتابع المجلس · لا رسائل للأحياء</p>}
      <section className="mafia-timeline-frame">
        {finished&&<Button data-design-id="timeline-toggle" data-design-required="true" aria-expanded={historyOpen} aria-controls="mafia-timeline-body" onClick={()=>setHistoryOpen(value=>!value)}>محادثة المجلس وسجل الأحداث {historyOpen?'−':'+'}</Button>}
        <div id="mafia-timeline-body" className="mafia-timeline-body" hidden={finished&&!historyOpen}><MafiaChat key={`${ownerId}:${state.code}:${state.matchId}`} state={state} you={you} me={me} accountId={ownerId} members={members} disabled={disabled} act={act}/></div>
      </section>
      <MafiaEventOverlay effect={effect}/>
    </main>
    {!finished&&<footer data-design-id="player-rail" className="mafia-player-rail">{decisionStatus&&<p className="mafia-decision-status" role="status">{decisionStatus}</p>}{actions.length>0&&<section className={`mafia-action-dock ${actionOpen?'is-open':''}`}><button type="button" className="mafia-action-trigger" data-design-id="action-open" data-design-required="true" aria-expanded={actionOpen} aria-controls="mafia-current-action" onClick={()=>setActionOpen(value=>!value)}><ToolIcon name="action"/><strong>{actionTitle}</strong><span>{selected.length?`${ar(selected.length)} محدّد`:'بانتظار قرارك'}</span><span aria-hidden="true">{actionOpen?'−':'+'}</span></button><div id="mafia-current-action" hidden={!actionOpen}><ActionPanel key={choiceKey} state={state} you={you||{}} me={me} members={members} disabled={disabled} act={act} selection={selection}/></div></section>}<div className="mafia-rail-heading"><span>المجلس · {ar(members.filter(p=>p.alive).length)} أحياء</span><span>{targets.length?'اختر بطاقة ثم أكّد القرار':'اللاعبون'}</span></div>{seats}</footer>}
    {!observer&&tab!=='council'&&<Modal className="mafia-noir mafia-private-panel" data-design-screen={`online.mafia.${tab}`} title={tab==='clues'?'أدلتي الخاصة':'دفتر الشكوك'} onClose={()=>setTab('council')} footer={<Button data-design-id="tab.council" onClick={()=>setTab('council')}>العودة للمحادثة</Button>}><style>{css}</style>{tab==='clues'?<section data-design-id="reports" className="mafia-reports"><p className="mafia-muted">المعلومة تخص الليلة المكتوبة؛ قد يغيّر التمويه والتجنيد ما تعرفه.</p>{(you?.reports||[]).map((report,i)=><article key={report.id||i}><b>الليلة {ar(report.night||report.round||1)}</b><p>{reportText(report,members)}</p></article>)}{!you?.reports?.length&&<p>لا أدلة خاصة بعد.</p>}{you?.allies?.length>0&&<p>فريقك المعروف الآن: {you.allies.map(ally=>nameOf(members,typeof ally==='string'?ally:ally.id)).join('، ')}</p>}</section>:<section data-design-id="notebook" className="mafia-notebook"><p>ملاحظات محلية؛ لا تُرسل للمجلس وتُمسح عند تبديل الحساب أو المباراة.</p><label htmlFor="mafia-notes">ملاحظاتي<textarea data-design-id="notes-input" id="mafia-notes" maxLength={2000} value={notes} onChange={e=>setNotes(e.target.value)}/></label></section>}</Modal>}
    {toolsOpen&&<Modal className="mafia-noir mafia-tools-panel" data-design-screen="online.mafia.tools" title="أدوات المجلس" onClose={()=>setToolsOpen(false)}><style>{css}</style><div className="stack"><MafiaRules possibleRoles={state.possibleRoles} onGuide={tutorial?.onGuide}/>{!observer&&<Button data-design-id="tab.notes" onClick={()=>{setToolsOpen(false);setTab('notes');}}><ToolIcon name="notes"/> ملاحظاتي</Button>}{(tutorial?[]:members).filter(player=>player.id!==me?.id&&!player.spectator).map(player=><Button key={player.id} data-design-id="player-safety" onClick={()=>{setToolsOpen(false);setSafety(player);}}>إجراءات {player.name}</Button>)}{tutorial&&<p>شخصيات تدريب محلية؛ لا اتصال أو ميكروفون حقيقي.</p>}</div></Modal>}
    {finished&&!observer&&!tutorial&&!state._designPreview&&state.rewardReceipt&&<MafiaRewardSummary key={`${ownerId}:${state.matchId}`} server={rewardServer} accountId={ownerId} receipt={state.rewardReceipt} clockOffset={clockOffset}/>}
    {finished&&<MafiaRules possibleRoles={state.possibleRoles} onGuide={tutorial?.onGuide}/>}
    {safety&&<MafiaSafety player={safety} onClose={()=>setSafety(null)} onSafety={onSafety}/>}
  </section>;
}

// The connected game owns real audio; the tutorial imports only the presentation.
export function MafiaMatch(props) {
  return <MafiaMatchView {...props}/>;
}

export function MafiaSafety({ player, onClose = noop, onSafety = noop }) {
  const [reason,setReason] = useState(''); const [category,setCategory] = useState('other'); const [error,setError] = useState(''); const [busy,setBusy] = useState(false);
  async function send(kind) { setBusy(true); setError(''); try { await onSafety({kind,player,reason,...(kind==='report'?{category}:{})}); onClose(); } catch { setError(kind === 'block' ? 'تعذّر الحظر والخروج، حاول مجددًا.' : 'تعذّر إرسال البلاغ، حاول مجددًا.'); } finally { setBusy(false); } }
  return <Modal className="mafia-noir mafia-safety" data-design-screen="online.mafia.safety" title={`إجراءات ${player.name}`} onClose={onClose}><style>{css}</style><div className="stack"><p>الإبلاغ لا يكشف دورًا ولا يطرد لاعبًا من المباراة. الحظر أثناء المشاركة ينهي مقعدك.</p><label>فئة البلاغ<select data-design-id="report-category" aria-label="فئة البلاغ" value={category} disabled={busy} onChange={event=>setCategory(event.target.value)}>{MAFIA_REPORT_CATEGORIES.map(item=><option key={item.id} value={item.id}>{item.label}</option>)}</select></label><label>تفاصيل البلاغ<textarea data-design-id="report-details" maxLength={1000} value={reason} onChange={e=>setReason(e.target.value)}/></label><Button data-design-id="submit" disabled={busy || !reason.trim()} onClick={() => send('report')}>إرسال بلاغ</Button><Button data-design-id="block-exit" variant="secondary" disabled={busy} onClick={() => send('block')}>حظر وخروج من المجلس</Button>{error&&<p role="alert">{error}</p>}</div></Modal>;
}

export function MafiaPrivacy() { return <section data-design-screen="online.mafia.privacy" className="mafia-noir mafia-shell mafia-waiting"><style>{css}</style><div data-design-id="privacy" data-design-required="true"><MafiaIcon/><h2>المجلس محجوب لحماية الأسرار</h2><p>تعود شاشتك عند فتح ميدان.</p></div></section>; }

export function MafiaHistory({ data, loading, error, onClose = noop, onRefresh = noop, onReview = noop, hasPrevious = false, onPrevious = noop, onNext = noop }) {
  return <Modal className="mafia-noir mafia-history-dialog" data-design-screen="online.mafia.history" title="سجل مجالسك" onClose={onClose}><style>{css}</style><div className="mafia-history stack"><p>نتائج أدوارك وفرقك في آخر {ar(data?.retentionDays || 30)} يومًا، دون نشر المحادثات.</p><Button data-design-id="refresh" disabled={loading} onClick={onRefresh}>{loading?'نحمّل السجل…':'تحديث السجل'}</Button>{error&&<p data-design-id="error" role="alert">{errorText(error)}</p>}{loading&&<p data-design-id="loading" role="status">نحمّل نتائجك…</p>}{data&&<><div data-design-id="stats" className="mafia-history-stats">{data.stats.map((row,i)=><article key={i}><MafiaRoleArt roleId={row.roleId}/><strong>{MAFIA_ROLES[row.roleId]?.name || 'دور'}</strong><small>{factionLabel(row.faction)}</small><span>{ar(row.matches)} مباراة · {ar(row.wins)} فوز · {ar(row.draws)} تعادل</span></article>)}</div><ol data-design-id="history">{data.matches.map(match=><li key={match.matchKey}><b>{MAFIA_ROLES[match.roleId]?.name || 'دور'} · {factionLabel(match.faction)}</b><span>{match.forfeited?'انسحاب':match.draw?'تعادل':match.won?'فوز الفريق':'خسارة الفريق'}</span><time dateTime={new Date(match.finishedAt).toISOString()}>{new Date(match.finishedAt).toLocaleDateString('ar-JO')}</time><Button data-design-id="history-review" variant="secondary" onClick={()=>onReview(match.matchKey)}>مراجعة المباراة</Button><details><summary>مرجع المباراة للبطولة أو الاعتراض</summary><input data-design-id="history-reference" aria-label="مرجع المباراة" dir="ltr" readOnly value={match.matchKey} onFocus={event=>event.target.select()} style={{maxWidth:"100%",minWidth:0}}/></details></li>)}</ol>{!data.matches.length&&<p data-design-id="empty">أول مجلس لك سيظهر هنا بعد اكتماله.</p>}<div className="mafia-settings-row"><Button data-design-id="history-previous" variant="secondary" disabled={loading||!hasPrevious} onClick={onPrevious}>نتائج أحدث</Button><Button data-design-id="history-next" variant="secondary" disabled={loading||!data?.nextCursor} onClick={onNext}>نتائج أقدم</Button></div></>}</div></Modal>;
}

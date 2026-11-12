import { PresentationStyles } from '../shared/ui/PresentationStyles.jsx';
import { uiDirection, uiDateLocale, localizeAuthored } from './format.js';
import { arabicNumber, errorText } from './format.js';
import { tr } from '../shared/i18n/core.js';
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Button, Modal } from '../shared/ui/components.jsx';
import { ProfileAvatar } from '../profiles/ProfileAvatar.jsx';
import { PlayerName } from '../profiles/PlayerIdentity.jsx';
import { Avatar } from '../shared/brand/art.jsx';
import { GameArtwork } from '../shared/brand/art.jsx';
import { MafiaRoleArt, MafiaSceneArt, MafiaCardBack } from '../games/mafia/icon.jsx';
import { MAFIA_DEFAULT_SETTINGS, MAFIA_ALL_ROLES as MAFIA_ROLES, MAFIA_PHASES, MAFIA_FACTIONS } from './mafia-shared.js';

import css from './mafia.css?sheet';
import { MAFIA_NOIR_ASSETS } from '../games/mafia/noir-assets.js';
import { useMafiaSound } from '../games/mafia/useMafiaSound.js';
import { MafiaRewardSummary } from './MafiaRewardSummary.jsx';
import { navigate, registerBackLayer } from '../platform/router.js';
import { MAFIA_REPORT_CATEGORIES } from './mafia-report-shared.js';
import { OnlineDirectoryView, OnlineRoomRow } from './OnlineDirectoryView.jsx';
import { mafiaTimelineScope, mergeMafiaTimeline, readMafiaTimeline, pageMafiaTimeline } from '../games/mafia/timeline.js';
import { createMafiaEventEffects } from '../games/mafia/event-effects.js';
import { useAccount } from '../shared/account/context.js';
import { ticketPolicyEnabled } from '../shared/account/gameplay-policy.mjs';

const ar = arabicNumber;
const label = value => tr(typeof value === 'string' ? value : value?.name || value?.label || '');
const phaseLabel = phase => label(MAFIA_PHASES[phase]) || tr("مجلس ميدان");
const factionLabel = faction => label(MAFIA_FACTIONS[faction]) || tr("غير معلن");
const noop = () => {};
const isActive = state => !['lobby', 'over', 'closed', 'waiting'].includes(state.phase) && !state.waiting;
const nameOf = (members, id) => members.find(player => player.id === id)?.name || tr("لاعب");

function ToolIcon({ name }) {
  const paths = { role:'M5 3h12v17H5z M8 8h6 M8 12h6', clues:'M9 3h10v17H5V7z M9 3v5H5 M9 12h6 M9 16h6', notes:'m4 16 1 4 4-1L20 8l-5-5z M13 5l5 5', more:'M5 12h.01 M12 12h.01 M19 12h.01', action:'m13 2-9 12h7l-1 8 10-13h-8z', mic:'M9 5a3 3 0 0 1 6 0v7a3 3 0 0 1-6 0z M6 11v1a6 6 0 0 0 12 0v-1 M12 18v4 M8 22h8', muted:'M9 5a3 3 0 0 1 6 0v7 M6 11v1a6 6 0 0 0 10 4 M12 18v4 M8 22h8 M3 3l18 18', leave:'M8 4H4v16h4 M13 7l5 5-5 5 M8 12h10', clock:'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M12 7v5l3 2', lock:'M6 10h12v11H6z M9 10V7a3 3 0 0 1 6 0v3', sun:'M3 19h18 M6 16a6 6 0 0 1 12 0 M12 3v4 M4 7l3 3 M20 7l-3 3 M1 15h3 M20 15h3', check:'m5 12 4 4L19 6', players:'M9 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M2 21v-3a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v3 M17 4a4 4 0 0 1 0 8 M18 14a5 5 0 0 1 4 4v3' };
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={paths[name] || paths.more}/></svg>;
}

export function MafiaEventOverlay({ effect }) {
  if (!effect) return null;
  return <aside data-design-id="event-overlay" data-event-id={effect.id} data-event-kind={effect.kind} className="mafia-event-overlay" role="status" aria-live="polite"><MafiaSceneArt sceneId={effect.scene || 'night'}/><div><strong>{tr(effect.title)}</strong>{effect.caption && <small>{tr(effect.caption)}</small>}</div></aside>;
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
  return { mode, capacity: Math.max(min, Math.min(max, Number(value.capacity) || (mode === 'shadow' ? 10 : 8))), visibility: value.visibility === 'private' ? 'private' : 'public', roomName: typeof value.roomName === 'string' ? value.roomName : '', community: value.community === 'en' ? 'en' : 'ar', voiceMode: value.voiceMode === 'off' ? 'off' : 'optional', ...(value.experimentalRole==='tracker'?{experimentalRole:'tracker',visibility:'private'}:{}) };
}

// Shared by room creation and the host's lobby editor. `present` counts the
// seats already taken: the server refuses a capacity below it.
function MafiaSettingsFields({ settings, onChange, disabled, present = 0, experimentalRolesEnabled = false }) {
  return <>
    <label className="mafia-name-field">{tr("اسم المجلس")}<input data-design-id="room-name" maxLength={30} value={settings.roomName} disabled={disabled} autoComplete="off" placeholder={tr("مجلس الشلّة")} onChange={event => onChange({ ...settings, roomName: event.target.value })}/></label>
    <div data-design-id="mode-choice" className="mafia-mode-picker" role="group" aria-label={tr("طور المباراة")}>{[['classic',tr("المجلس الأساسي"),tr("٦–٨ لاعبين · فريقان")],['shadow',tr("رابطة الظل"),tr("٩–١٢ لاعبًا · ثلاثة أطراف")]].map(([mode,title,detail]) => <button data-design-id="mode-option" type="button" key={mode} disabled={disabled || present > (mode === 'shadow' ? 12 : 8)} aria-pressed={settings.mode === mode} onClick={() => onChange(normalizeMafiaSettings({ ...settings, mode, capacity: mode === 'shadow' ? Math.max(10, present) : 8 }))}><strong>{title}</strong><small>{detail}</small></button>)}</div>
    <div className="mafia-settings-row"><label>{tr("سعة المجلس")}<select data-design-id="capacity" value={settings.capacity} disabled={disabled} onChange={event => onChange({ ...settings, capacity: Number(event.target.value) })}>{(settings.mode === 'shadow' ? [9,10,11,12] : [6,7,8]).map(n => <option key={n} value={n} disabled={n < present || settings.experimentalRole==='tracker'&&n<8}>{ar(n)}{tr(" لاعبين")}</option>)}</select></label>
      <label>{tr("ظهور الغرفة")}<select data-design-id="visibility" disabled={disabled || settings.experimentalRole==='tracker'} value={settings.visibility} onChange={event => onChange({ ...settings, visibility: event.target.value })}><option value="private">{tr("خاصة · برمز أو دعوة")}</option><option value="public">{tr("عامة · يستقبل المجلس لاعبين")}</option></select></label></div>
    {(experimentalRolesEnabled || settings.experimentalRole==='tracker') && <label><input type="checkbox" checked={settings.experimentalRole==='tracker'} disabled={disabled || !experimentalRolesEnabled} onChange={event=>{const next={...settings,visibility:'private',capacity:settings.mode==='shadow'?Math.max(9,settings.capacity):8};if(event.target.checked)next.experimentalRole='tracker';else delete next.experimentalRole;onChange(next);}}/>{tr("المتعقّب التجريبي · مجلس خاص من ٨ لاعبين فأكثر، بلا XP أو تصنيف")}</label>}
    <label>{tr("التواصل")}<select data-design-id="voice-mode" disabled={disabled} value={settings.voiceMode} onChange={event => onChange({ ...settings, voiceMode: event.target.value })}><option value="optional">{tr("صوت ونص · الميكروفون اختياري")}</option><option value="off">{tr("نص فقط · دون اتصال صوتي")}</option></select></label>
  </>;
}

export function MafiaSettings({ value = MAFIA_DEFAULT_SETTINGS, onChange = noop, disabled = false, experimentalRolesEnabled = false }) {
  const account = useAccount();
  const settings = normalizeMafiaSettings(value);
  return <section data-design-screen="online.mafia.setup" className="mafia-noir mafia-settings stack" aria-label={tr("إعداد مافيا ميدان")}><PresentationStyles sheet={css}/>
    <MafiaSettingsFields settings={settings} onChange={onChange} disabled={disabled} experimentalRolesEnabled={experimentalRolesEnabled}/>
    <p className="mafia-muted">{tr("حساب لكل لاعب. ")}{ticketPolicyEnabled(account.gameplayPolicy) ? tr("الانضمام مجاني دائمًا. للمضيف مباراة أولى مجانية، ثم تذكرة مباراة بإعلان اختياري أو بلس.") : tr("استضافة الغرف والانضمام واللعب مجانية بالكامل.")}{tr(" لا تُباع قوة أو أفضلية في الأدوار.")}</p><MafiaRules />
  </section>;
}

function MafiaRoleDetails({ role, resources }) {
  const guide = role.guide;
  const remaining = role.id === 'guard' ? resources?.shield : resources?.charges;
  return <div className="mafia-role-details" dir={uiDirection()}>
    <dl>
      <div><dt>{tr("متى تعمل؟")}</dt><dd>{guide.timing}</dd></div>
      <div><dt>{tr("الرصيد الأساسي")}</dt><dd>{role.charges == null ? (role.ability ? tr("دون حد عددي؛ التوقيت والقيود أدناه تحدد الاستخدام.") : tr("دون قدرة خاصة.")) : `${ar(role.charges)} ${role.id === 'guard' ? tr("درع في المباراة.") : tr("استعمال في المباراة.")}`}</dd></div>
      {Number.isFinite(remaining) && role.charges != null && <div className="mafia-role-balance"><dt>{tr("المتبقي لك الآن")}</dt><dd>{ar(remaining)} {role.id === 'guard' ? tr("درع") : tr("استعمال")}</dd></div>}
      {role.id === 'doctor' && Number.isFinite(resources?.selfProtection) && <div className="mafia-role-balance"><dt>{tr("حماية نفسك المتبقية")}</dt><dd>{ar(resources.selfProtection)}</dd></div>}
      <div><dt>{tr("الأهداف")}</dt><dd>{guide.targets.description}</dd></div>
      <div><dt>{tr("ما الذي تثبته؟")}</dt><dd>{guide.evidence.description}</dd></div>
      <div><dt>{tr("من يرى الأثر؟")}</dt><dd>{guide.visibility.description}</dd></div>
      <div><dt>{tr("التغيير والإلغاء")}</dt><dd>{guide.selection.description}</dd></div>
      <div><dt>{tr("متى يُستهلك؟")}</dt><dd>{guide.consumption.description}</dd></div>
    </dl>
    <div><h5>{tr("القيود وحدود المعلومة")}</h5><ul>{guide.limitations.map(text => <li key={text}>{text}</li>)}</ul></div>
    <div><h5>{tr("التداخل مع القدرات الأخرى")}</h5><ul>{guide.interactions.map(text => <li key={text}>{text}</li>)}</ul></div>
    <p className="mafia-role-example"><strong>{tr("مثال:")}</strong> {guide.example}</p>
  </div>;
}

export function MafiaRules({ possibleRoles, defaultOpen = false, onTutorial, onGuide = noop }) {
  const [open, setOpen] = useState(defaultOpen);
  const [lesson, setLesson] = useState(0);
  const lessons = [
    [tr("ابدأ من كلامهم"), tr("مثال تدريبي: ليان تقول «شاهدت عمر يتحرك ليلًا». هذا يثبت نشاطًا فقط، ولا يثبت فريقه. اسألها عن الليلة ونوع المعلومة.")],
    [tr("فرّق بين الدليل والادعاء"), tr("كل شخص يستطيع الادعاء بأنه المحقق. لا يرى الآخرون بطاقته. التحقيق يتأثر بالتمويه، والفريق قد يتغير بعد التجنيد.")],
    [tr("اسمع الدفاع ثم احكم"), tr("الترشيح يحدد مشتبهًا واحدًا. له ٢٠ ثانية للدفاع، ثم يصوّت الأحياء سرًا. يلزم أكثر من نصفهم للإقصاء. بعد نهاية المباراة تُظهر مراجعتها من رشّح من، وصوت كل لاعب في الحكم.")],
    [tr("كل ليلة تغيّر المجلس"), tr("اختيارات الليل قابلة للتعديل حتى يغلق الخادم المرحلة. بعد الإقصاء تابع الأحداث، دون إرسال تلميحات للأحياء.")],
  ];
  return <>{!defaultOpen && <Button data-design-id="rules" variant="ghost" full onClick={() => {setOpen(true);onGuide('encyclopedia-open');}}>{possibleRoles ? tr("الأدوار الممكنة ودليل اللعب") : tr("دليل المجلس والأدوار الاثنا عشر")}</Button>}{open && <Modal className="mafia-noir mafia-guide-dialog mafia-paper-dialog" data-design-screen="online.mafia.guide" title={tr("دليل مافيا ميدان")} onClose={() => {setOpen(false);onGuide('encyclopedia-close');}}><PresentationStyles sheet={css}/><div className="mafia-guide stack">{onTutorial && <><div className="mafia-guide-steps"><div><ToolIcon name="role"/><span><b>{tr("احفظ هويتك")}</b><small>{tr("اقرأ بطاقتك على انفراد.")}</small></span></div><div><ToolIcon name="clues"/><span><b>{tr("اجمع القرائن")}</b><small>{tr("فرّق بين الكلام والفعل.")}</small></span></div><div><ToolIcon name="players"/><span><b>{tr("اسمع الدفاع وصوّت")}</b><small>{tr("اختر وفق ما عرفت في هذه الجولة.")}</small></span></div></div><Button data-design-id="tutorial-start" variant="primary" onClick={()=>{setOpen(false);onTutorial();}}>{tr("تعلّم مع شخصيات التدريب")}</Button><Button data-design-id="specialist-training" aria-label={tr("تمارين تخصص مافيا")} onClick={()=>{setOpen(false);navigate('/tutorial/mafia?labs=1');}}>{tr("تمارين التخصص القصيرة")}</Button></>}<span className="mafia-kicker">{tr("تدريب توضيحي · شخصيات افتراضية")}</span><h3>{lessons[lesson][0]}</h3><p>{lessons[lesson][1]}</p><div className="row-between"><Button data-design-id="back" disabled={!lesson} onClick={() => setLesson(lesson - 1)}>{tr("السابق")}</Button><span>{ar(lesson + 1)} / {ar(4)}</span><Button data-design-id="continue" disabled={lesson === lessons.length - 1} onClick={() => setLesson(lesson + 1)}>{tr("التالي")}</Button></div><p className="mafia-muted">{tr("هذه موسوعة القدرات؛ وجود دور هنا لا يعني أنه موزّع في المباراة الحالية. الانتماء المكتوب هنا هو انتماء الدور عند التوزيع؛ التجنيد قد يغيّره.")}</p><div className="mafia-role-catalog">{localizeAuthored(Object.values(MAFIA_ROLES)).filter(role => possibleRoles ? possibleRoles.includes(role.id) : role.id!=='tracker').map(role => <article key={role.id} data-role-id={role.id} className={`mafia-role-tile faction-${role.faction}`}><MafiaRoleArt roleId={role.id}/><div><h4>{role.name}</h4><small>{tr("انتماء البداية: ")}{factionLabel(role.faction)}</small><p>{role.description}</p></div><details className="mafia-role-disclosure"><summary>{tr("تفاصيل قدرة ")}{role.name}</summary><MafiaRoleDetails role={role}/></details></article>)}</div></div></Modal>}</>;
}

export function MafiaDirectory({ onTutorial, rooms = [], enabled, loading, error, mode = 'all', voiceMode = 'all', status = 'all', onMode = noop, onVoiceMode = noop, onStatus = noop, onRefresh = noop, onQuickJoin = noop, onJoin = noop, onObserve = noop, onCreate, onCode, nextCursor, hasPrevious, onNext = noop, onPrevious = noop, disabled, children, helpActions, footer }) {
  const [panel, setPanel] = useState('');
  const actionsLocked = disabled || loading;
  useEffect(() => panel ? registerBackLayer(() => setPanel('')) : undefined, [panel]);
  const filters = <div className="mafia-directory-filters">
    <label><span>{tr("نوع المجلس")}</span><select aria-label={tr("نوع المجلس")} data-design-id="directory-mode" disabled={disabled || loading} value={mode} onChange={e => onMode(e.target.value)}><option value="all">{tr("كل الأطوار")}</option><option value="classic">{tr("الأساسي")}</option><option value="shadow">{tr("رابطة الظل")}</option></select></label>
    <label><span>{tr("نوع التواصل")}</span><select aria-label={tr("نوع التواصل")} data-design-id="directory-voice" disabled={disabled || loading} value={voiceMode} onChange={e => onVoiceMode(e.target.value)}><option value="all">{tr("كل أنواع التواصل")}</option><option value="optional">{tr("صوت ونص")}</option><option value="off">{tr("نص فقط")}</option></select></label>
    <label><span>{tr("حالة المجلس")}</span><select aria-label={tr("حالة المجلس")} data-design-id="directory-status" disabled={disabled || loading} value={status} onChange={e => onStatus(e.target.value)}><option value="all">{tr("كل الحالات")}</option><option value="waiting">{tr("في الانتظار")}</option><option value="playing">{tr("يلعبون الآن")}</option><option value="finished">{tr("انتهت المباراة")}</option></select></label>
  </div>;
  const toolbar = <>
    <header className="mafia-directory-title"><GameArtwork game="mafia" className="mafia-icon"/><div><h1>{tr("مافيا ميدان")}</h1><span>{tr("دليل المجالس العامة")}</span></div></header>
    <div data-design-id="toolbar" className="mafia-directory-actions">
      {onCreate&&<Button data-design-id="create-public-room" variant="primary" aria-label={tr("إنشاء مجلس جديد")} disabled={actionsLocked||enabled!==true} onClick={onCreate}>{tr("+ إنشاء مجلس")}</Button>}
      {onCode&&<Button data-design-id="entry-join" disabled={disabled} onClick={onCode}>{tr("دخول برمز")}</Button>}
      <Button data-design-id="refresh" aria-label={tr("تحديث الغرف")} disabled={actionsLocked} onClick={onRefresh}>{tr("↻ تحديث")}</Button>
      <Button data-design-id="directory-options" aria-label={tr("خيارات الغرف والمساعدة")} aria-expanded={Boolean(panel)} onClick={()=>setPanel(value=>value?'':'filters')}>{tr("خيارات ومساعدة")}</Button>
    </div>
    {panel&&<section className="mafia-directory-paper" aria-label={tr("خيارات الغرف")}>
      <div className="mafia-directory-option-tabs">
        <Button data-design-id="directory-filter" variant={panel==='filters'?'primary':'ghost'} aria-pressed={panel==='filters'} onClick={()=>setPanel('filters')}>{tr("تصفية الغرف")}</Button>
        <Button data-design-id="directory-help" variant={panel==='help'?'primary':'ghost'} aria-pressed={panel==='help'} onClick={()=>setPanel('help')}>{tr("المساعدة والمزيد")}</Button>
        <Button data-design-id="directory-options-close" variant="ghost" aria-label={tr("إغلاق خيارات الغرف")} onClick={()=>setPanel('')}>×</Button>
      </div>
      {panel==='filters'?<>{filters}<Button data-design-id="directory-filter-apply" variant="primary" full onClick={()=>setPanel('')}>{tr("عرض المجالس")}</Button></>:<div className="mafia-directory-help"><MafiaRules onTutorial={onTutorial}/>{helpActions}{children}</div>}
    </section>}
    <div className="mafia-directory-list-label"><strong>{tr("المجالس العامة")}</strong><Button aria-label={tr("انضمام سريع إلى غرفة متاحة")} data-design-id="quick-join" data-sound="none" variant="ghost" disabled={actionsLocked||enabled!==true} onClick={onQuickJoin}>{tr("انضمام سريع ‹")}</Button></div>
  </>;
  return <section data-design-screen="online.mafia.directory" className="mafia-noir mafia-directory mafia-directory-dense" aria-label={tr("الغرف العامة")}><PresentationStyles sheet={css}/><OnlineDirectoryView game="mafia" title={tr("مافيا ميدان")} rooms={rooms} enabled={enabled} loading={loading} error={error} disabled={disabled} toolbar={toolbar} footer={footer} nextCursor={nextCursor} hasPrevious={hasPrevious} onNext={onNext} onPrevious={onPrevious} emptyText={tr("لا مجالس متاحة الآن. أنشئ مجلسًا أو غيّر التصفية.")} notice={enabled === false ? tr("المجالس الجديدة غير متاحة حاليًا. المباريات القائمة تتابع حتى نهايتها.") : null} renderRoom={room => {
    const roomStatus = room.status || 'waiting', full = room.full ?? room.players >= room.capacity;
    const canJoin = roomStatus === 'waiting' && !full;
    return <OnlineRoomRow key={room.code} room={room} title={room.roomName || tr("مجلس {v0}", {v0: room.hostName || tr("ميدان")})} subtitle={`${room.mode === 'shadow' ? tr("رابطة الظل") : tr("الأساسي")}${!canJoin && Number(room.protocol)<2?tr(" · غرفة بإصدار سابق"):''}${roomStatus === 'waiting' ? tr(" · {v0} جاهز", {v0: ar(room.ready || 0)}) : ''}`} statusLabel={roomStatus === 'playing' ? tr("يلعبون الآن") : roomStatus === 'finished' ? tr("انتهت المباراة") : full ? tr("ممتلئة") : tr("انتظار")} voiceLabel={room.voiceMode === 'off' ? tr("نص فقط") : tr("صوت ونص")} canJoin={canJoin} canObserve={!canJoin && Number(room.protocol) >= 2} disabled={disabled || enabled !== true} onJoin={() => onJoin(room.code)} onObserve={() => onObserve(room.code)}/>;
  }}/></section>;
}

// Only the host edits the waiting room; unsaved edits live until saved or closed.
function MafiaLobbySettings({ state, disabled, act }) {
  const [editing, setEditing] = useState(false), [draft, setDraft] = useState(null), [editingRevision,setEditingRevision] = useState(null);
  const value = draft || normalizeMafiaSettings(state.settings);
  const close = () => { setEditing(false); setDraft(null); };
  return <div className="mafia-lobby-settings"><Button data-design-id="room-settings" full aria-expanded={editing} disabled={disabled} onClick={() => {if(editing)close();else{setEditingRevision(state.settingsRevision);setEditing(true);}}}>{editing ? tr("إغلاق إعدادات المجلس") : tr("تعديل إعدادات المجلس")}</Button>
    {editing && <><MafiaSettingsFields settings={value} onChange={setDraft} disabled={disabled} present={state.members.filter(m => !m.left).length}/><p className="mafia-muted">{tr("حفظ أي تغيير في الإعدادات يعيد الآخرين إلى «يستعد» حتى يؤكدوا من جديد.")}</p><Button data-design-id="save" data-sound={act.audioAccepted?'none':undefined} full variant="primary" disabled={disabled} onClick={async () => { if (await act('settings', { settings: value, expectedSettingsRevision: editingRevision })) close(); }}>{tr("حفظ إعدادات المجلس")}</Button></>}</div>;
}

export function MafiaLobbyInfo({ state, isHost = false, disabled = false, act = noop }) {
  return <section data-design-screen="online.mafia.lobby" className="mafia-noir mafia-lobby-info stack"><PresentationStyles sheet={css}/><div className="mafia-lobby-art" style={{'--mafia-environment':`url("${MAFIA_NOIR_ASSETS.environment}")`}}><GameArtwork game="mafia" className="mafia-icon"/><div><span className="mafia-kicker">{tr("كل وجه يخفي حكاية")}</span><h2>{state.settings?.mode === 'shadow' ? tr("رابطة الظل") : tr("المجلس الأساسي")}</h2><p>{ar(state.settings?.capacity || 8)}{tr(" مقاعد · ")}{state.settings?.visibility === 'public' ? tr("غرفة عامة") : tr("غرفة خاصة")}</p></div></div><div className="mafia-lobby-brief">{state.rulesetVersion===2&&<p role="status">{tr("مجلس المتعقّب التجريبي · ٨ لاعبين فأكثر · بلا XP أو إتقان أو تصنيف. التوازن لم يُعتمد بعد.")}</p>}<p>{tr("جهّز السماعات إن أمكن. استمع واكتب دون تشغيل الميكروفون، واكشف بطاقتك سرًا عند البداية.")}</p>{state.composition && <p className="mafia-composition"><span>{ar(state.composition.mafia)}{tr(" مافيا")}</span><span>{ar(state.composition.town)}{tr(" أهل الميدان")}</span>{state.composition.shadow>0 && <span>{ar(state.composition.shadow)}{tr(" قائد للرابطة")}</span>}</p>}<p className="mafia-muted">{tr("التوزيع يثبت بحسب عدد الجاهزين. الأدوار الفعلية لا يراها المضيف، والقادم بعد البداية ينتظر المباراة التالية.")}</p></div>{isHost && <MafiaLobbySettings state={state} disabled={disabled} act={act}/>}<MafiaRules possibleRoles={state.possibleRoles}/></section>;
}

// Seat identity is stable; role art never chooses another player's public card.
export function MafiaPlayerCards({ state, me, voice = {}, selected = [], targets = [], onSelect, onSafety, onManage, disabled = false, tutorial = false }) {
  const players = (state.members || []).filter(player => !player.spectator && !player.left).slice().sort((a,b) => (a.seat || 0) - (b.seat || 0));
  const isLobby = state.phase === 'lobby';
  const permitted = state.scope !== 'observer' && state.settings?.voiceMode !== 'off' && (isLobby || state.you?.voice?.canListen === true) && !state.mafiaVoice?.quiet && !state.mafiaVoice?.outage;
  const currentEpoch = !Number.isSafeInteger(state.mafiaVoice?.mediaEpoch) || voice.mediaEpoch === state.mafiaVoice.mediaEpoch;
  const speaking = new Set((permitted && currentEpoch && voice.status === 'connected' ? voice.participants || [] : []).filter(p => p.speaking && !p.muted).map(p => p.id || p.identity));
  const targetMode = targets.length > 0 && typeof onSelect === 'function';
  const emptyCount = isLobby ? Math.max(0, (state.settings?.capacity || 0) - players.length) : 0;
  return <div data-design-id="players" className="mafia-seats" aria-label={tr("بطاقات لاعبي المجلس")}>{players.map((player,i) => {
    const eligible = targets.includes(player.id);
    const action = targetMode ? eligible ? () => onSelect(player.id) : null : onManage ? () => onManage(player) : player.id !== me?.id && onSafety ? () => onSafety(player) : null;
    const summary = isLobby ? player.ready ? tr("جاهز") : tr("يستعد") : player.alive === false ? tr("مقصي") : speaking.has(player.id) ? tr("يتحدث الآن") : '';
    return <button data-design-id="player-seat" data-player-id={player.id} type="button" key={player.id} disabled={disabled || !action} onClick={action || noop} aria-pressed={targetMode ? selected.includes(player.id) : undefined} aria-label={tr("المقعد {v0}، {v1}{v2}{v3}", {v0: player.seat || i+1, v1: player.name, v2: player.id === me?.id ? tr("، أنت") : '', v3: summary ? `، ${summary}` : ''})} className={`mafia-seat ${player.alive === false && !isLobby ? 'eliminated' : ''} ${speaking.has(player.id) ? 'speaking' : ''} ${eligible ? 'is-target' : ''} ${selected.includes(player.id) ? 'selected' : ''}`}>
      <span className="mafia-seat-number">{ar(player.seat || i+1)}</span><span className="mafia-seat-portrait">{player.profile ? <ProfileAvatar user={player.profile} size={28}/> : <Avatar index={player.avatar || 0}/>}<MafiaCardBack className="mafia-seat-seal"/></span><span className="mafia-seat-copy"><b><PlayerName user={player.profile} name={player.id === me?.id ? tr("أنت") : player.name} compact /></b><small>{tutorial && player.id !== me?.id ? tr("شخصية تدريب · ") : ''}{!player.connected ? tr("يعيد الاتصال") : summary || tr("في المجلس")}</small></span>
    </button>;
  })}{Array.from({length: emptyCount}, (_,index) => <div key={'empty-'+index} className="mafia-seat mafia-seat-empty"><MafiaCardBack className="mafia-seat-seal"/><span>{tr("مقعد فارغ")}</span></div>)}</div>;
}

export function MafiaLobby({ state, me, isHost = false, disabled = false, startDisabled = false, act = noop, voice = {}, invite, languageControl, onSafety, tutorial, accountId = '' }) {
  const [panel,setPanel] = useState(null), [managed,setManaged] = useState(null), [confirm,setConfirm] = useState(null);
  const players = state.members.filter(player => !player.left && !player.spectator);
  const minimum = state.settings?.mode === 'shadow' ? 9 : state.rulesetVersion===2 ? 8 : 6;
  const canStart = players.length >= minimum && players.every(player => player.connected && player.ready);
  return <section data-design-screen="online.mafia.lobby" className="mafia-noir mafia-shell mafia-compact-game mafia-density mafia-lobby-screen" dir={uiDirection()}><PresentationStyles sheet={css}/>
    <header data-design-id="header" className="mafia-heading"><div><span className="mafia-kicker">{tr("غرفة الانتظار · ")}{ar(players.length)}{tr(" من ")}{ar(state.settings.capacity)}</span><h1>{state.settings.roomName || tr("مجلس مافيا")}</h1></div><span className="mafia-voice-badge">{state.settings.voiceMode === 'off' ? tr("نص فقط") : tr("صوت ونص")}</span>{!tutorial && <><Button data-design-id="invite" aria-label={tr("دعوة لاعبين")} onClick={() => setPanel('invite')}>{tr("دعوة")}</Button><Button data-design-id="room-settings" aria-label={tr("إعدادات المجلس")} onClick={() => setPanel('settings')}>⋯</Button></>}</header>
    {languageControl && <div className="mafia-lobby-language">{languageControl}</div>}
    <section className="mafia-lobby-players" aria-label={tr("مقاعد الانتظار")}><MafiaPlayerCards state={state} me={me} voice={voice} disabled={disabled} tutorial={Boolean(tutorial)} onManage={tutorial ? undefined : player => setManaged(player)}/></section>
    <main className="mafia-activity"><MafiaChat state={state} you={state.you} me={me} accountId={accountId} members={players} disabled={disabled} act={act}/></main>
    {state.settings.voiceMode !== 'off' && <MafiaVoice state={state} voice={voice}/>}
    {!tutorial&&state.settings.voiceMode !== 'off'&&voice.requested&&<p className="mafia-lobby-voice-note">{tr("للمحادثات الجانبية، غادر صوت الغرفة أولًا.")}</p>}
    <footer data-design-id="player-rail" className="mafia-player-rail"><p className="mafia-rail-note" role="status">{canStart ? tr("المجلس جاهز للبداية") : ar(minimum)+tr(" لاعبين متصلين وجاهزين للبدء")}</p><div className="mafia-lobby-ready"><Button data-design-id="ready" data-sound={act.audioAccepted?'none':undefined} disabled={disabled} variant={me?.ready ? 'secondary' : 'primary'} onClick={() => act('ready', { ready: !me?.ready })}>{me?.ready ? tr("جاهز ✓") : tr("أنا جاهز")}</Button>{isHost ? <Button data-design-id="start" data-sound={act.audioAccepted?'none':undefined} data-design-required="true" disabled={disabled || startDisabled || !canStart} variant="primary" onClick={() => act('start')}>{tr("ابدأ اللعب")}</Button> : <span>{tr("المضيف يبدأ بعد الجاهزية")}</span>}</div></footer>
    {panel && <Modal className="mafia-noir mafia-lobby-panel mafia-paper-dialog" placement="bottom" data-design-screen="online.mafia.lobby" title={panel === 'invite' ? tr("ادعُ للمجلس") : tr("إعدادات المجلس")} onClose={() => setPanel(null)}><PresentationStyles sheet={css}/>{panel === 'invite' ? invite : <MafiaLobbyInfo state={state} isHost={isHost} disabled={disabled} act={act}/>}</Modal>}
    {managed && <Modal className="mafia-noir" data-design-screen="online.mafia.lobby" title={managed.name} onClose={() => setManaged(null)}><PresentationStyles sheet={css}/><div className="stack"><p>{managed.id === state.hostId ? tr("مضيف المجلس") : tr("لاعب في المجلس")}</p>{isHost && managed.id !== me?.id && <><Button data-design-id="member-host" disabled={disabled || !managed.connected} onClick={() => setConfirm({type:'host',targetId:managed.id,name:managed.name})}>{tr("تسليم الاستضافة")}</Button><Button data-design-id="member-remove" disabled={disabled} onClick={() => setConfirm({type:'kick',targetId:managed.id,name:managed.name})}>{tr("إزالة من الانتظار")}</Button></>}{managed.id !== me?.id && onSafety && <Button data-design-id="player-safety" onClick={() => {setPanel(null);onSafety(managed);setManaged(null);}}>{tr("الإبلاغ والحظر")}</Button>}</div></Modal>}
    {confirm && <MafiaConfirmModal title={confirm.type === 'kick' ? tr("إزالة {v0}؟", {v0: confirm.name}) : tr("تسليم الاستضافة إلى {v0}؟", {v0: confirm.name})} message={confirm.type === 'kick' ? tr("يخرج من هذا المجلس ولا يستطيع العودة إليه.") : tr("يصبح اللاعب مسؤولًا عن الإعدادات وبدء المباراة.")} confirmLabel={tr("تأكيد")} onCancel={() => setConfirm(null)} onConfirm={async () => {if(await act(confirm.type,{targetId:confirm.targetId}) !== false){setConfirm(null);setManaged(null);}}}/>}
  </section>;
}

function useCountdown(deadline, offset, preview, serverNow, clock) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { if (!deadline || preview || clock) return undefined; const timer = setInterval(() => setNow(Date.now()), 250); return () => clearInterval(timer); }, [deadline, preview, clock]);
  if (clock) return Number.isFinite(clock.remainingMs) ? Math.max(0,Math.ceil(clock.remainingMs/1000)) : null;
  return deadline ? Math.max(0, Math.ceil((deadline - (preview && Number.isFinite(serverNow) ? serverNow : now + offset)) / 1000)) : null;
}
function SecretCard({ you, hidden, revealed, onReveal, onHide }) {
  const role = localizeAuthored(MAFIA_ROLES[you?.roleId]);
  if (!role || hidden) return hidden ? <div data-design-id="privacy" data-design-required="true" className="mafia-secret-cover">{tr("بطاقتك محجوبة لحماية دورك")}</div> : null;
  return <section data-design-id="role-card" className="mafia-secret"><div className="mafia-secret-top"><span><span className="mafia-secret-seal" aria-hidden="true">◆</span>{tr(" هويتك سرّك")}</span><Button data-design-id="role-toggle" data-sound="mafiaRole" variant="ghost" aria-expanded={revealed} aria-haspopup="dialog" aria-label={tr("بطاقتي ودوري")} title={tr("اكشف بطاقتي")} onClick={onReveal}><ToolIcon name="role"/><span>{tr("دوري")}</span></Button></div>
    {revealed && <Modal className="mafia-noir mafia-role-dialog" data-design-screen="online.mafia.role-card" title={tr("دوري السري")} aria-label={tr("بطاقتك الخاصة")} closeLabel={tr("إخفاء البطاقة")} onClose={onHide} footer={<Button data-design-id="role-hide" variant="primary" full onClick={onHide}>{tr("إخفاء البطاقة")}</Button>}><PresentationStyles sheet={css}/><article data-design-id="role-content" className={`mafia-secret-content faction-${you.faction}`}><div className="mafia-role-portrait"><MafiaRoleArt roleId={role.id}/><span>{tr("خاص بك · لا يظهر للمجلس")}</span></div><div className="mafia-role-description"><h2>{role.name}</h2><span className="mafia-kicker">{tr("انتماؤك الآن: ")}{factionLabel(you.faction)}</span><p>{role.description}</p><small>{tr("الآخرون لا يرون بطاقتك. أغلقها قبل إظهار الشاشة لأي شخص.")}</small><details className="mafia-role-disclosure"><summary>{tr("تفاصيل قدرتك ورصيدك")}</summary><MafiaRoleDetails role={role} resources={you.resources}/></details></div></article></Modal>}
  </section>;
}

function NarrativeCard({ state, members, compact = false }) {
  const phase = state.phase;
  const scenes = {lobby:'lobby',role:'deal',opening:'dawn',night:'night',dawn:'dawn',discussion:'dawn',nomination:'verdict',defense:'verdict',verdict:'verdict',over:'ending',closed:'ending'};
  const descriptions = {lobby:tr("تتابع حديث الانتظار بعد تأخير ثلاثين ثانية. يمكنك حجز مقعد عندما يصبح متاحًا."),role:tr("اقرأ قدرتك بعيدًا عن أعين الآخرين. بطاقتك لا يراها أحد سواك."),opening:tr("تعرّف إلى أصوات المجلس. كل شخص يملك حكاية… وليس كل حكاية دليلًا."),night:tr("حلّ الليل. اختيارات الأدوار سرية، وتغلق مع انتهاء الوقت."),dawn:tr("عاد الضوء إلى المجلس. هذه هي الأخبار التي يحق للجميع معرفتها."),discussion:tr("اسأل عن التفاصيل، اربط الروايات، واترك للآخرين فرصة الدفاع."),nomination:tr("من تحتاج روايته إلى دفاع؟ اختر أو امتنع، ثم أكّد صوتك."),defense:tr("المجلس يستمع إلى {v0}. الصوت والكتابة للمرشح وحده.", {v0: nameOf(members,state.nomineeId)}),verdict:tr("سمعت الدفاع. قرارك نهائي، والإقصاء يحتاج أكثر من نصف الأحياء.")};
  return <article data-design-id="narrative" className={`mafia-narrative ${compact?'is-compact':''}`}><MafiaSceneArt sceneId={scenes[phase] || 'night'}/><div><span className="mafia-kicker">{tr("حكاية المجلس")}</span><h3>{phase==='night'?tr("أُغلقت أبواب المجلس"):phase==='dawn'?tr("ماذا ترك الليل خلفه؟"):phase==='discussion'?tr("الكلمة الآن لكم"):phaseLabel(phase)}</h3><p>{descriptions[phase] || tr("انتهت الحكاية، وظهرت الأدوار.")}</p></div></article>;
}

function MafiaConfirmModal({ title, message, confirmLabel, onConfirm, onCancel, confirmSound, selected, disabled }) {
  return <Modal title={title} onClose={onCancel} className="mafia-noir mafia-confirm mafia-paper-dialog" placement="bottom" footer={<><Button data-design-id="confirm" variant="primary" disabled={disabled} data-sound={confirmSound} full onClick={onConfirm}>{confirmLabel}</Button><Button data-design-id="cancel" full variant="ghost" onClick={onCancel}>{tr("رجوع")}</Button></>}><PresentationStyles sheet={css}/>{selected&&<div className="mafia-confirm-choice"><ToolIcon name="check"/><strong>{selected}</strong></div>}<p className="mafia-paper-note">{message}</p></Modal>;
}

function eventText(event, members) {
  if (typeof event === 'string') return event;
  if (event.text || event.message) return event.text || event.message;
  const person = nameOf(members, event.playerId || event.targetId);
  const texts = { eliminated: event.reason === 'verdict' ? tr("أقصى المجلس {v0}", {v0: person}) : event.reason === 'forfeit' ? tr("{v0} انسحب من المجلس", {v0: person}) : event.reason === 'night' ? tr("{v0} خرج من المجلس بهجوم ليلي", {v0: person}) : tr("{v0} غادر المجلس", {v0: person}), dawn: event.peaceful ? tr("أشرقت الشمس دون إقصاء ليلي") : tr("أشرقت شمس جديدة على المجلس"), match_started:tr("بدأ المجلس وتوزعت الأدوار سرًا"), night_started:tr("بدأ الليل؛ اتبع قناتك وتعليمات دورك"), match_ended:tr("انتهت المباراة"), host_changed:tr("انتقلت إدارة الغرفة إلى {v0}", {v0: person}), nomination_closed:event.nomineeId ? tr("المرشح للدفاع: {v0}", {v0: nameOf(members,event.nomineeId)}) : tr("تعادل الترشيح؛ لا مرشح لهذه الليلة"), verdict_closed:event.passed ? tr("وافق المجلس على الإقصاء") : tr("رفض المجلس الإقصاء"), no_elimination: tr("مرّت الليلة دون إقصاء"), extended: tr("{v0} استخدم قدرة المنادي وأضاف ٢٠ ثانية للنقاش", {v0: person}), nomination_tie: tr("تعادل الترشيح، يواصل الجميع إلى الليل"), faction_revealed: `${person}: ${factionLabel(event.faction)}`, disconnected: tr("{v0} انقطع اتصاله", {v0: person}), reconnected: tr("{v0} عاد للمجلس", {v0: person}), withdrawal: tr("{v0} انسحب", {v0: person}) };
  if(event.type==='roles') return tr("توزعت الأدوار الأولية كما تظهر في البطاقات.");
  if(event.type==='night_action') return tr("{v0} استخدم قدرة {v1} تجاه {v2}.", {v0: person, v1: localizeAuthored(MAFIA_ROLES[event.roleId])?.name || tr("دوره"), v2: (event.targetIds || [event.targetId]).filter(Boolean).map(id=>nameOf(members,id)).join(tr(' و')) || tr("هدفه")});
  if(event.type==='tracking_report') return tr("{v0} تتبّع {v1}: {v2}.", {v0: person, v1: nameOf(members,event.targetId), v2: (event.destinationIds||[]).length?(event.destinationIds||[]).map(id=>nameOf(members,id)).join(tr('، ')):tr("لم تُرصد وجهة غير معطّلة")});
  if(event.type==='attack_vote') return tr("{v0} اختار {v1} لهجوم المافيا.", {v0: person, v1: nameOf(members,event.targetId)});
  if(event.type==='nomination_vote') return event.targetId ? tr("{v0} رشّح {v1}.", {v0: person, v1: nameOf(members,event.targetId)}) : tr("{v0} امتنع عن الترشيح.", {v0: person});
  if(event.type==='verdict_votes') return tr("حكم المجلس على {v0}: {v1} أصوات موافقة.", {v0: nameOf(members,event.nomineeId), v1: ar(Object.values(event.votes || {}).filter(Boolean).length)});
  if(event.type==='converted') return tr("انضم {v0} إلى رابطة الظل بتجنيد {v1}.", {v0: person, v1: nameOf(members,event.recruiterId)});
  if(event.type==='shield_used') return tr("{v0} صدّ الهجوم بدرع الحارس.", {v0: person});
  return texts[event.type] || texts[event.kind] || tr("تحديث في المجلس");
}

export { eventText as mafiaEventText };

// Each living ally's current attack choice, as the server shows it to the Mafia only.
function teamBallotText(you, members) {
  const votes = you?.teamVotes || {};
  return (you?.allies || []).map(ally => typeof ally === 'string' ? ally : ally.id).map(id => `${nameOf(members,id)}: ${!Object.hasOwn(votes,id) ? tr("لم يختر بعد") : votes[id] ? nameOf(members,votes[id]) : tr("بلا هدف")}`).join(tr('، '));
}

function reportText(report,members) {
  if(report.text || report.message) return report.text || report.message;
  if(report.type==='converted') return tr("انضممت إلى رابطة الظل. تغير فريقك وشرط فوزك، وبقي دورك وقدراتك المتاحة.");
  if(report.type==='recruitment') return report.success ? tr("انضم {v0} إلى رابطة الظل.", {v0: nameOf(members,report.targetId)}) : tr("لم تنجح محاولة التجنيد. لا يُكشف سبب الفشل.");
  if(report.type==='shield_used') return tr("أنقذتك حمايتك الذاتية من هجوم هذه الليلة. استُهلكت الحماية الوحيدة.");
  if(report.type==='tracking') return tr("{v0}: {v1}. لا يحدد التقرير القدرة أو الفريق أو نجاحها.", {v0: nameOf(members,report.targetId), v1: (report.destinationIds||[]).length?tr("الوجهات المقبولة غير المعطّلة: ")+report.destinationIds.map(id=>nameOf(members,id)).join(tr('، ')):tr("لم تُرصد وجهة مقبولة غير معطّلة")});
  if(report.type==='no_result') return tr("لم تحصل على نتيجة لهذا الفحص. لا يُكشف سبب تعذّر النتيجة.");
  if(report.faction) return tr("{v0}: {v1} وقت الفحص.", {v0: nameOf(members,report.targetId), v1: factionLabel(report.faction)});
  if(report.same!==undefined) return tr("{v0}: الانتماء الظاهر {v1}.", {v0: (report.targetIds||[]).map(id=>nameOf(members,id)).join(tr(' و')), v1: report.same?tr("متطابق"):tr("مختلف")});
  if(report.acted!==undefined) return `${nameOf(members,report.targetId)} ${report.acted?tr("قدّم فعلًا ليليًا مقبولًا غير معطّل"):tr("لم يُرصد له فعل ليلي مقبول غير معطّل")}.`;
  return tr("انتهى فحصك لهذه الليلة.");
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
  const run = async task => {setActionError('');try{await task?.();}catch(error){setActionError(/[\u0600-\u06ff]/.test(error?.message || '')?error.message:tr("تعذّر تنفيذ أمر الصوت. حاول مجددًا."));}};
  return <div data-design-id="voice" data-design-required="true" className="mafia-voice" data-mafia-call-controls={voice.simulated ? undefined : state.mafiaVoice?.callId} data-mafia-controls-ready={voice.simulated ? undefined : Boolean((connected || voice.requested) && typeof voice.onLeave==='function') ? 'true' : 'false'}>
    <div><b>{voice.simulated ? tr("محاكاة الصوت · لا يوجد اتصال") : outage ? tr("الصوت متوقف مؤقتًا") : recovering ? tr("نؤمّن الاتصال الصوتي…") : quiet ? (state.phase === 'night' ? tr("الليل هادئ الآن") : tr("المجلس هادئ لحظات")) : connected ? tr("صوت المجلس متصل") : tr("اسمع المجلس وشارك بصوتك")}</b>
      <small>{voice.simulated ? tr("تدرّب على الأزرار؛ لا نطلب الميكروفون ولا نغيّر مكالمتك الحالية.") : outage ? tr("تعذّر تأمين قناة الصوت، فلم نفتح قناة جديدة. المباراة مستمرة بالكتابة، ويعود الصوت تلقائيًا عند توفره.") : quiet ? voice.requested ? tr("سيعود صوت المجلس تلقائيًا عندما تبدأ مرحلة الاستماع.") : tr("فعّل صوت النهار الآن ليعود تلقائيًا عند بدء النقاش.") : state.phase === 'night' ? tr("مسارات الليل معزولة حسب الفريق") : state.phase === 'defense' ? tr("الصوت للمرشح فقط أثناء الدفاع") : tr("الميكروفون اختياري؛ الكتابة متاحة حسب المرحلة")}</small></div>
    <div className="mafia-voice-actions">{connected || voice.requested ? <>
      <Button data-design-id="mute" aria-label={!canSpeak ? tr("الميكروفون مغلق") : voice.muted ? tr("شغّل الميكروفون") : tr("اكتم الميكروفون")} title={!canSpeak ? tr("الميكروفون مغلق حسب المرحلة") : voice.muted ? tr("شغّل الميكروفون") : tr("اكتم الميكروفون")} className="mafia-voice-icon" disabled={!voice.onMute || !canSpeak} onClick={() => run(() => voice.onMute(!voice.muted))}><ToolIcon name={!canSpeak || voice.muted ? 'muted' : 'mic'}/></Button>
      {connected && voice.onSpeaker && voice.audioOutputs?.length > 0 && <label><span className="sr-only">{tr("مخرج الصوت")}</span><select aria-label={tr("مخرج الصوت")} data-design-id="audio-output" value={voice.outputId || 'default'} onChange={event => run(() => voice.onSpeaker(event.target.value))}>{voice.audioOutputs.map(output => <option key={output.id || output.deviceId} value={output.id || output.deviceId}>{output.label || tr("السماعة")}</option>)}</select></label>}
      <Button data-design-id="voice-leave" aria-label={tr("افصل الصوت")} title={tr("افصل الصوت")} className="mafia-voice-icon" variant="ghost" disabled={!voice.onLeave} onClick={() => run(voice.onLeave)}><ToolIcon name="leave"/></Button>
    </> : <Button data-design-id="voice-join" disabled={!voice.onJoin || recovering || outage} onClick={() => run(voice.onJoin)}>{quiet ? tr("تفعيل صوت النهار") : tr("الانضمام بالصوت")}</Button>}</div>
    {(connected || voice.requested) && voice.onResume && voice.audioBlocked && <Button data-design-id="voice-resume" onClick={() => run(voice.onResume)}>{tr("اضغط لاستعادة الصوت")}</Button>}
    {!outage && (voice.error || actionError) && <p role="alert">{actionError || (/[\u0600-\u06ff]/.test(voice.error) ? voice.error : errorText(voice.error))}</p>}
  </div>;
}

function TimelineText({ text = '' }) {
  if (text.length <= 220) return <p dir="auto">{text}</p>;
  return <details className="mafia-long-message"><summary>{text.slice(0, 140)}… <span>{tr("اقرأ كامل الرسالة")}</span></summary><p dir="auto">{text}</p></details>;
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
    catch { setError(tr("تعذّر إرسال الرسالة. جرّب مجددًا.")); }
    finally { setSending(false); }
  }
  return <section data-design-id="chat" className={`mafia-chat channel-${actualChannel}`}><div className="mafia-panel-heading"><h3>{actualChannel === 'team' ? tr("حديث الفريق · سري") : actualChannel === 'observers' ? tr("مجلس المقصيين") : tr("المحادثة والأحداث")}</h3><span className="mafia-channel-tag">{actualChannel === 'team' ? tr("قناة خاصة") : actualChannel === 'observers' ? tr("للمتابعين") : tr("عام")}</span>{observer && <Button data-design-id="chat-channel" size="sm" onClick={() => setChannel(actualChannel === 'public' ? 'observers' : 'public')}>{actualChannel === 'public' ? tr("حديث المقصيين") : tr("متابعة الأحياء")}</Button>}</div>
    <div data-design-id="messages" ref={list} onScroll={event => { const el=event.currentTarget;follow.current=el.scrollHeight-el.scrollTop-el.clientHeight<50;if(follow.current)setUnread(0);if(layout.current)layout.current={...layout.current,top:el.scrollTop,height:el.scrollHeight}; }} className="mafia-chat-messages" role="log" aria-live={unread ? 'off' : 'polite'} aria-relevant="additions" tabIndex={0} aria-label={tr("سجل المحادثة وأحداث المجلس")}>
      <details className="mafia-timeline-info"><summary>{lobby ? tr("انتظر الجاهزية ثم ابدأ المجلس") : tr("عن سجل هذه الجلسة")}</summary><p>{tr("يعرض الخادم آخر ٢٥٦ حدثًا عامًا وآخر ١٠٠ رسالة مسموحة من كل قناة. تحتفظ هذه الشاشة بما وصل إليك أثناء الجلسة؛ الرسائل الأقدم غير المحمّلة قد لا تتوفر بعد إعادة فتح الصفحة.")}</p></details>
      {page.earlier > 0 && <Button data-design-id="load-older" variant="ghost" onClick={() => {restoreAnchor.current=true;setShown({key:viewKey,start:Math.max(0,page.earlier-40)});}}>{tr("عرض الأقدم · ")}{ar(page.earlier)}</Button>}
      {page.rows.map(item => item.kind === 'event' ? <article data-design-id="event" data-timeline-id={item.key} key={item.key} className="mafia-event-card"><span className="mafia-public-seal" aria-hidden="true">◆</span><div><small>{tr("حدث معلن")}</small><TimelineText text={eventText(item.value,members)}/></div></article> : <article data-timeline-id={item.key} key={item.key} className={`mafia-message ${me?.id && [item.value.senderId,item.value.playerId].includes(me.id)?'is-own':''}`}><span className="mafia-message-seat" aria-hidden="true">{ar(members.find(p=>p.id===(item.value.senderId||item.value.playerId))?.seat||'·')}</span><div><b>{nameOf(members,item.value.senderId||item.value.playerId)}</b><TimelineText text={item.value.text}/></div></article>)}
      {!page.total && <p className="mafia-chat-empty">{writable?tr("ابدأ الحديث… ثم تابع الأدلة."):tr("تظهر هنا الرسائل والأحداث المسموحة لك.")}</p>}
    </div>
    {unread > 0 && <button type="button" data-design-id="new-messages" className="mafia-new-messages" onClick={() => {follow.current=true;if(list.current)list.current.scrollTop=list.current.scrollHeight;setUnread(0);}}>↓ {ar(unread)}{tr(" تحديث جديد")}</button>}
    {writable && actualChannel === allowedChannel ? <form data-design-id="composer" onSubmit={send}><label className="sr-only" htmlFor="mafia-message">{tr("رسالتك إلى ")}{actualChannel === 'team' ? tr("الفريق") : tr("المجلس")}</label><input data-design-id="message-input" id="mafia-message" maxLength={400} autoComplete="off" value={text} onChange={e=>setText(e.target.value)} placeholder={actualChannel==='team'?tr("رسالة للفريق…"):tr("اكتب للمجلس…")} disabled={disabled||sending}/><Button data-design-id="send" type="submit" disabled={disabled||sending||!text.trim()}>{tr("إرسال")}</Button></form> : <p className="mafia-chat-locked">{watchOnly?tr("مشاهدة فقط · لا صوت أو رسائل للاعبين"):observer?tr("تتابع الأحياء دون إرسال رسائل إليهم."):state.phase==='defense'?tr("الدفاع للمرشح وحده؛ استمع إلى روايته."):tr("الحديث العام متوقف في هذه المرحلة.")}</p>}{error&&<p role="alert">{error}</p>}
  </section>;
}

const NIGHT_ACTION_LABELS = {
  investigator: 'اعتماد التحقيق',
  doctor: 'اعتماد الحماية',
  observer: 'اعتماد المراقبة',
  reporter: 'اعتماد الكشف',
  analyst: 'اعتماد المقارنة',
  masker: 'اعتماد التمويه',
  blocker: 'اعتماد التعطيل',
  leader: 'اعتماد محاولة التجنيد',
  tracker: 'اعتماد التتبّع',
};

function MafiaTargetRows({ action, members, selected, onPick, disabled }) {
  const ids = new Set((action.targets || []).map(target => typeof target === 'string' ? target : target.id));
  const players = members.filter(member => ids.has(member.id)).sort((a, b) => (a.seat || 0) - (b.seat || 0));
  return <div className="mafia-choice-rows" role="group" aria-label={tr("الأهداف المتاحة")}>
    {players.map(player => {
      const rank = selected.indexOf(player.id);
      return <button className="mafia-choice-row" type="button" key={player.id} data-design-id="target" data-player-id={player.id} aria-pressed={rank >= 0} disabled={disabled} onClick={() => onPick(player.id)}>
        <span className="mafia-choice-portrait">{player.profile ? <ProfileAvatar user={player.profile} size={34}/> : <Avatar index={player.avatar || 0}/>}</span>
        <span className="mafia-choice-name"><PlayerName user={player.profile} name={player.name} compact/>{player.alive === false&&<small>{tr("مقصي")}</small>}</span>
        <span className="mafia-choice-radio" aria-hidden="true">{rank >= 0 ? selected.length > 1 ? ar(rank+1) : <ToolIcon name="check"/> : null}</span>
      </button>;
    })}
  </div>;
}

function ActionPanel({ state, you, me, members, disabled, act, selection }) {
  const {selected,nightTool,setNightTool,pick} = selection;
  const [confirm,setConfirm] = useState(null);
  if (!me?.alive || !you?.roleId) return null;
  const actions = Array.isArray(you.actions) ? you.actions : [];
  const rawAbility = actions.find(action => action.type === 'night_action');
  const ballot = actions.find(action => action.type === 'mafia_vote');
  const ability = ballot && nightTool === 'attack' ? null : rawAbility;
  const showBallot = Boolean(ballot && (!rawAbility || nightTool === 'attack'));
  const nomination = state.phase === 'nomination' && !you.nominationSubmitted && actions.find(action => action.type === 'nominate');
  const verdict = state.phase === 'verdict' && !you.verdictSubmitted && actions.some(action => action.type === 'verdict');
  const hasHerald = actions.some(action => action.type === 'herald');
  if (!['night','nomination','verdict'].includes(state.phase) && !hasHerald) return null;
  const role = localizeAuthored(MAFIA_ROLES[you.roleId]);
  const decision = nomination || (showBallot ? ballot : ability);
  const selectedNames = selected.map(id => nameOf(members, id)).join(tr(' و'));
  const heading = nomination?tr("من يحتاج إلى دفاع؟"):verdict?tr("هل تؤيد الإقصاء؟"):state.phase==='night'?showBallot?tr("هدف الهجوم"):tr("قرار الليل"):phaseLabel(state.phase);
  const confirmationTitle = confirm?.kind === 'nominate' ? confirm.targetId ? tr("تأكيد ترشيح ") + nameOf(members,confirm.targetId) + '؟' : tr("تأكيد الامتناع عن الترشيح؟") : confirm?.kind === 'verdict' ? tr("تأكيد الحكم") : tr("تؤكد اختيارك؟");
  const confirmationChoice = confirm?.kind === 'verdict' ? confirm.approve ? tr("أوافق على الإقصاء") : tr("أرفض الإقصاء") : confirm?.targetId ? nameOf(members,confirm.targetId) : null;
  const confirmationMessage = confirm?.kind === 'herald' ? tr("تُستخدم قدرة المنادي مرة واحدة، ويرى المجلس أنك من استخدمها.") : confirm?.kind === 'verdict' ? tr("صوتك نهائي بعد التأكيد.") : tr("الترشيح نهائي بعد التأكيد.");
  const submitChoice = () => {
    if (nomination) setConfirm({kind:'nominate',targetId:selected[0]});
    else if (you.roleId==='analyst') act('night_action',{targetIds:selected});
    else act('night_action',{targetId:selected[0]});
  };
  return <section data-design-id="ability" className="mafia-ability">
    <div className="mafia-ability-heading">
      <h3>{heading}</h3>
      {ability?.remaining!=null&&<small>{tr("متاح: ")}{ar(ability.remaining)}</small>}
    </div>
    <div className="mafia-decision-scroll">
      {state.phase==='night'&&<p className="mafia-ability-private"><ToolIcon name="lock"/>{tr("قدرة خاصة · لا تظهر للمجلس")}</p>}
      {rawAbility&&ballot&&<div className="mafia-action-tabs" role="group" aria-label={tr("إجراءاتك الليلية")}>
        <Button data-design-id="night-attack-tab" aria-pressed={nightTool==='attack'} onClick={()=>setNightTool('attack')}>{tr("الهجوم المشترك")}</Button>
        <Button data-design-id="night-ability-tab" aria-pressed={nightTool==='ability'} onClick={()=>setNightTool('ability')}>{tr("قدرتي")}{rawAbility.remaining!=null?' · '+ar(rawAbility.remaining)+tr(" متاح"):''}</Button>
      </div>}
      {verdict&&<><div className="mafia-verdict-candidate"><ToolIcon name="players"/><span>{tr("المرشح العام للإقصاء")}<strong>{nameOf(members,state.nomineeId)}</strong></span></div><p className="mafia-paper-note">{tr("يلزم أكثر من نصف الأحياء. صوتك نهائي بعد التأكيد.")}</p></>}
      {decision&&<MafiaTargetRows action={decision} members={members} selected={selected} onPick={pick} disabled={disabled}/>}
      {selected.length>0&&<p className="mafia-selection-summary" role="status">{tr("اختيارك: ")}{selectedNames}</p>}
      {(ability||nomination)&&<p className="mafia-paper-note">{nomination?tr("الترشيح نهائي بعد التأكيد."):role?.description}</p>}
      {ability&&you.nightAction&&<p role="status">{tr("اختيارك محفوظ حتى نهاية الليل.")}</p>}
      {showBallot&&<>
        {!selectedNames&&you.killTarget&&<p className="mafia-selection-summary" role="status">{tr("الهدف المحفوظ: ")}{nameOf(members,you.killTarget)}</p>}
        {teamBallotText(you,members)&&<p className="mafia-muted" role="status">{tr("اختيارات فريقك: ")}{teamBallotText(you,members)}</p>}
        <p className="mafia-paper-note">{tr("التعادل يلغي الهجوم.")}</p>
      </>}
      {!decision&&!verdict&&!hasHerald&&<><p className="mafia-muted" role="status">{tr("لا إجراء متاح لك في هذه المرحلة.")}</p>{state.phase==='night'&&role?.guide?.timing&&<p>{role.guide.timing}</p>}</>}
    </div>
    {(decision||verdict||hasHerald)&&<div className="mafia-decision-actions">
      {(ability||nomination)&&<Button data-design-id="ability-submit" data-sound={act.audioAccepted&&!nomination?'none':undefined} variant="primary" disabled={disabled||selected.length<(you.roleId==='analyst'&&ability?2:1)} onClick={submitChoice}>{nomination?tr("تأكيد الترشيح"):tr(NIGHT_ACTION_LABELS[you.roleId])||tr("اعتماد اختيار الليل")}</Button>}
      {nomination&&<Button data-design-id="abstain" variant="secondary" disabled={disabled} onClick={()=>setConfirm({kind:'nominate',targetId:null})}>{tr("امتنع عن الترشيح")}</Button>}
      {ability&&you.nightAction&&<Button data-design-id="cancel-ability" data-sound={act.audioAccepted?'none':undefined} variant="secondary" disabled={disabled} onClick={()=>act('night_action',{targetId:null})}>{tr("إلغاء اختيار الليل")}</Button>}
      {showBallot&&<>
        <Button data-design-id="mafia-vote" data-sound={act.audioAccepted?'none':undefined} variant="primary" disabled={disabled||!selected.length} onClick={()=>act('mafia_vote',{targetId:selected[0]})}>{tr("اعتماد هدف الهجوم")}</Button>
        <Button data-design-id="abstain" variant="secondary" disabled={disabled} data-sound={act.audioAccepted?'none':undefined} onClick={()=>act('mafia_vote',{targetId:null})}>{tr("لا أختار هدفًا")}</Button>
      </>}
      {verdict&&<>
        <Button data-design-id="verdict-yes" disabled={disabled} onClick={()=>setConfirm({kind:'verdict',approve:true})}>{tr("أوافق على الإقصاء")}</Button>
        <Button data-design-id="verdict-no" variant="secondary" disabled={disabled} onClick={()=>setConfirm({kind:'verdict',approve:false})}>{tr("أرفض الإقصاء")}</Button>
      </>}
      {hasHerald&&<Button data-design-id="herald" disabled={disabled} onClick={()=>setConfirm({kind:'herald'})}>{tr("استخدم المنادي · أضف ٢٠ ثانية")}</Button>}
    </div>}
    {confirm&&<MafiaConfirmModal title={confirmationTitle} message={confirmationMessage} selected={confirmationChoice} confirmLabel={tr("اعتمد اختياري")} disabled={disabled} confirmSound={act.audioAccepted&&confirm.kind!=='herald'?'none':undefined} onCancel={()=>setConfirm(null)} onConfirm={async()=>{
      if(disabled)return;
      const {kind,...fields}=confirm;
      if(await act(kind,fields)!==false)setConfirm(null);
    }}/>}
  </section>;
}

function ResultDisclosure({ className, summary, children }) {
  const [open,setOpen] = useState(false);
  return <details className={className} onToggle={event=>setOpen(event.currentTarget.open)}><summary>{summary}</summary>{open&&children}</details>;
}

function MafiaResults({ state, members, title, isHost, disabled, act, tutorial, voice }) {
  const players = Array.isArray(state.replay) ? state.replay : state.replay?.players || state.replay?.roles || [];
  const events = state.replay?.events || [];
  return <section data-design-id="results" className="mafia-results">
    <div className="mafia-result-summary"><MafiaSceneArt sceneId="ending" className="mafia-result-art"/><div className="mafia-result-copy"><h2>{title}</h2><p>{state.reason==='voice_unavailable'?tr("تعذّر تأمين قنوات الصوت. لا نفتح قناة قد تكشف الأسرار."):players.length?tr("انكشفت الأدوار؛ المحادثات السرية تظل خاصة."):tr("انتهى المجلس دون أدوار معلنة.")}</p>{players.length>0&&<small>{ar(players.length)}{tr(" لاعبًا · اليوم ")}{ar(state.round||1)}</small>}</div>
      <div className="mafia-result-actions">{!tutorial&&isHost&&state.phase==='over'&&<Button data-design-id="restart" variant="primary" disabled={disabled} full onClick={()=>act('restart')}>{tr("إلى الانتظار · مجلس جديد")}</Button>}{!tutorial&&!isHost&&state.phase==='over'&&<p role="status">{tr("بانتظار صاحب المجلس لبدء مجلس جديد.")}</p>}{voice.onReturnToCall&&voice.previousCall&&<Button data-design-id="return-call" onClick={voice.onReturnToCall}>{tr("العودة لمكالمة الشلّة")}</Button>}</div>
    </div>
    {players.length>0&&<div className="mafia-result-section-heading"><h3>{tr("تشكيلة المجلس")}</h3><small>{tr("افتح البطاقة للتفاصيل")}</small></div>}
    <div data-design-id="recap" className="mafia-recap">{players.map((item,i)=>{
      const role = localizeAuthored(MAFIA_ROLES[item.roleId]), player = members.find(member=>member.id===(item.playerId||item.id)), converted = item.initialFaction&&item.initialFaction!==item.faction;
      return <ResultDisclosure key={`${item.playerId||item.id||i}:${item.roleId}`} className="mafia-recap-player" summary={<><span className="mafia-result-seat" aria-hidden="true">{ar(player?.seat||i+1)}</span><span className="mafia-result-player-copy"><b><bdi>{player?.name||tr("لاعب")}</bdi></b><span>{role?.name||tr("دور")}</span><small>{factionLabel(item.faction)}{converted?tr(" · تغيّر انتماؤه"):''}</small></span></>}><div className="mafia-result-player-detail"><MafiaRoleArt roleId={item.roleId} className="mafia-result-player-art"/>{role?.description&&<p>{role.description}</p>}{converted&&<small>{tr("بدأ مع ")}{factionLabel(item.initialFaction)}{tr("، وانتهى مع ")}{factionLabel(item.faction)}.</small>}</div></ResultDisclosure>;
    })}</div>
    {events.length>0&&<ResultDisclosure className="mafia-result-replay" summary={<>{tr("أحداث المباراة ")}<small>{ar(events.length)}{tr(" حدثًا")}</small></>}><ol>{events.map((event,i)=><li key={event.id||i}>{eventText(event,members)}</li>)}</ol></ResultDisclosure>}
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
  const defaultActionOpen = tutorialActive || ['nomination','verdict'].includes(state.phase) || Boolean(state._designPreview && state.previewAction === true);
  const [actionOpen,setActionOpen] = useState(defaultActionOpen);
  const choiceKey = `${ownerId}:${state.code}:${state.matchId}:${state.phaseId}`;
  const [choice,setChoice] = useState({key:choiceKey,ids:[],tool:'attack'});
  const selected = choice.key === choiceKey ? choice.ids : [], nightTool = choice.key === choiceKey ? choice.tool : 'attack';
  const setSelected = next => setChoice(old=>({key:choiceKey,tool:old.key===choiceKey?old.tool:'attack',ids:typeof next==='function'?next(old.key===choiceKey?old.ids:[]):next}));
  const setNightTool = tool => setChoice({key:choiceKey,ids:[],tool});
  const remaining = useCountdown(state.deadlineAt,clockOffset,state._designPreview,state.serverNow,clock);
  useMafiaSound(state,{hidden:hidden || connection!=='connected',preview:Boolean(state._designPreview),sound,remaining:clock?.paused?null:remaining,ownerId});
  const effect = useMafiaVisualEffect(state,{ownerId,hidden,connection,remaining});
  const recovering = connection !== 'connected';
  const you = recovering || state.scope === 'observer' || state.waiting || (state.you?.id && state.you.id !== me?.id) ? null : state.you;
  const roleKey = JSON.stringify([ownerId,state.matchId,you?.roleId,you?.faction]);
  const [revealedRole,setRevealedRole] = useState(() => state._designPreview && state.previewReveal ? roleKey : null);
  useLayoutEffect(() => {
    setRevealedRole(state._designPreview && state.previewReveal && !recovering ? roleKey : null);
  }, [roleKey,recovering,state._designPreview,state.previewReveal]);
  const showRole = () => {setRevealedRole(roleKey);tutorial?.onGuide?.('role-open');};
  const hideRole = () => {setRevealedRole(null);tutorial?.onGuide?.('role-close');};
  const members = state.members || [], observer = state.scope === 'observer', finished = ['over','closed'].includes(state.phase);
  useEffect(() => {setNoteDraft({key:notesKey,text:''});setTab(state._designPreview&&state.previewTab||'council');setSafety(null);setHistoryOpen(false);setToolsOpen(Boolean(state._designPreview&&state.previewTools));}, [notesKey,state._designPreview,state.previewTab,state.previewTools]);
  useEffect(() => {setActionOpen(defaultActionOpen);}, [choiceKey,defaultActionOpen]);
  useLayoutEffect(() => {if(hidden||recovering){setTab('council');setSafety(null);setToolsOpen(false);setActionOpen(false);setRevealedRole(null);}}, [hidden,recovering]);
  const actions = !observer && me?.alive && you?.roleId ? you.actions || [] : [];
  const showDecision = actions.length>0 || (state.phase==='night'&&!observer&&me?.alive&&you?.roleId);
  const attack = actions.find(action=>action.type==='mafia_vote');
  const action = actions.find(item=>item.type === (state.phase==='nomination'?'nominate':attack&&nightTool==='attack'?'mafia_vote':'night_action'));
  const targets = (action?.targets||[]).map(target=>typeof target==='string'?target:target.id);
  const pick = id => {setSelected(old=>you?.roleId==='analyst'&&action?.type==='night_action'?old.includes(id)?old.filter(value=>value!==id):[...old.slice(-1),id]:[id]);setActionOpen(true);};
  const selection = {selected,nightTool,setNightTool,pick};
  const seats = <MafiaPlayerCards state={state} me={me} voice={observer||recovering?{}:voice} selected={selected} targets={targets} onSelect={pick} onSafety={onSafety?player=>setSafety(player):undefined} disabled={disabled} tutorial={Boolean(tutorial)}/>;
  const actionTitle = state.phase==='nomination'?tr("رشّح أو امتنع"):state.phase==='verdict'?tr("أصدر حكمك"):state.phase==='discussion'?tr("قدرة المنادي"):you?.roleId==='analyst'?tr("قارن بين لاعبين"):attack&&nightTool==='attack'?tr("اختيار هدف الهجوم"):tr("اختيار قدرتك");
  const decisionStatus = state.phase==='nomination'&&you?.nominationSubmitted ? (you.myNomination?tr("سُجّل ترشيحك: {v0}. لا يتغير بعد التأكيد.", {v0: nameOf(members,you.myNomination)}):tr("سُجّل امتناعك عن الترشيح في هذه الجولة.")) : state.phase==='verdict'&&you?.verdictSubmitted ? tr("سُجّل حكمك: {v0}. النتيجة عند انتهاء الوقت.", {v0: you.myVerdict?tr("تؤيد الإقصاء"):tr("ترفض الإقصاء")}) : '';
  const resultTitle = state.reason==='voice_unavailable'?tr("انتهت المباراة بسبب الاتصال"):state.outcome?.faction==='draw'||state.outcome==='draw'?tr("المجلس انتهى بالتعادل"):state.phase==='closed'&&!state.outcome?tr("انتهت صلاحية الغرفة"):tr("النتيجة: {v0}", {v0: factionLabel(typeof state.outcome==='string'?state.outcome:state.outcome?.faction||state.outcome?.winner)});
  if(hidden&&isActive(state))return <MafiaPrivacy/>;
  if(state.waiting&&!observer)return <section data-design-screen="online.mafia.waiting" className="mafia-noir mafia-shell mafia-waiting"><PresentationStyles sheet={css}/>
    <h2>{tr("المجلس بدأ")}</h2><MafiaCardBack className="mafia-waiting-card"/>
    <div className="mafia-waiting-paper"><strong>{tr("مكانك للمجلس التالي")}</strong><p data-design-id="notice">{tr("تدخل في المباراة التالية. تبقى أدوار ومحادثات المباراة الجارية محجوبة عن المنتظرين.")}</p></div><MafiaRules/>
  </section>;
  return <section data-design-screen={state._designPreview&&state.previewScene||`online.mafia.${state.phase}`} aria-label={tr("مافيا ميدان")} className={`mafia-noir mafia-shell mafia-compact-game mafia-density phase-${state.phase} ${observer?'is-observer':''} ${finished?'is-finished':'has-player-rail'}`} dir={uiDirection()}><PresentationStyles sheet={css}/>
    <header data-design-id="header" className="mafia-heading">
      <div className="mafia-phase-copy">
        <h1>{state.settings?.roomName||tr("مجلس مافيا")}</h1>
        <p><strong data-design-id="phase-title">{phaseLabel(state.phase)}</strong><span>{state.phase==='night'?tr("الليلة {day}",{day:ar(state.round||1)}):tr("اليوم {day}",{day:ar(state.round||1)})}</span></p>
      </div>
      {remaining!==null&&!finished&&<div data-design-id="timer" data-design-required="true" className={'mafia-clock '+(remaining<=10?'urgent':'')} role="timer" aria-label={ar(remaining)+tr(" ثانية متبقية")+(clock?.paused?tr("؛ وقت التدريب متوقف"):'')}><ToolIcon name="clock"/><small>{clock?.paused?tr("وقت التدريب متوقف"):tr("الوقت المتبقي")}</small><b>{ar(remaining)}</b></div>}
      <nav className="mafia-match-tools" aria-label={tr("أدوات المباراة")}>
        {!finished&&you?.roleId&&<SecretCard you={you} hidden={hidden} revealed={revealedRole===roleKey} onReveal={showRole} onHide={hideRole}/>}
        {!finished&&!observer&&!recovering&&<Button data-design-id="tab.clues" aria-label={tr("أدلتي الخاصة")} aria-pressed={tab==='clues'} title={tr("أدلتي الخاصة")} className="mafia-tool" onClick={()=>{setTab('clues');tutorial?.onGuide?.('clues-open');}}><ToolIcon name="clues"/>{tr("أدلتي")}{you?.reports?.length>0&&<span className="mafia-tool-dot"/>}</Button>}
        <Button data-design-id="mafia-tools" data-design-required="true" aria-label={tr("المساعدة والملاحظات وأدوات المجلس")} title={tr("أدوات المجلس")} className="mafia-tool" onClick={()=>setToolsOpen(true)}><ToolIcon name="more"/>{tr("المزيد")}</Button>
      </nav>
    </header>
    <main className={`mafia-activity ${finished?'is-results':''}`}>
      {finished&&<MafiaResults key={notesKey} state={state} members={members} title={resultTitle} isHost={isHost} disabled={disabled} act={act} tutorial={tutorial} voice={voice}/>}
      {!finished&&observer&&<p data-design-id="observer-delay" data-design-required="true" className="mafia-observer-delay" role="status">{tr("مشاهدة متأخرة ٣٠ ثانية · دون صوت أو إرسال للاعبين")}</p>}
      {!finished&&!observer&&state.phase==='role'&&you?.roleId&&<div className="mafia-phase-feature">
        <MafiaCardBack className="mafia-intro-card"/><h2>{tr("بطاقتك لك وحدك")}</h2>
        <Button variant="primary" data-design-id="reveal-private-card" data-sound="mafiaRole" onClick={showRole}>{tr("اكشف بطاقتي")}</Button>
      </div>}
      {!finished&&state.phase==='dawn'&&<div className="mafia-phase-feature mafia-dawn-feature"><ToolIcon name="sun"/><h2>{tr("أشرقت شمس جديدة")}</h2></div>}
      {!finished&&state.phase==='defense'&&<div data-design-id="defense" className="mafia-defense-summary"><ToolIcon name="players"/><span><strong>{tr("الدفاع: ")}{nameOf(members,state.nomineeId)}</strong>{tr("الدفاع للمرشح وحده")}</span></div>}
      {!finished&&recovering&&<div className="mafia-recovery" role="status"><strong>{tr("نحاول إعادة الاتصال…")}</strong><p>{tr("نستعيد الحالة من الخادم قبل قبول قرار جديد.")}</p></div>}
      {!finished&&!observer&&you?.roleId&&!me?.alive&&<p className="mafia-observer-delay" role="status">{tr("أنت الآن تتابع المجلس · لا رسائل للأحياء")}</p>}
      <section className="mafia-timeline-frame">
        {finished&&<Button data-design-id="timeline-toggle" data-design-required="true" aria-expanded={historyOpen} aria-controls="mafia-timeline-body" onClick={()=>setHistoryOpen(value=>!value)}>{tr("محادثة المجلس وسجل الأحداث ")}{historyOpen?'−':'+'}</Button>}
        <div id="mafia-timeline-body" className="mafia-timeline-body" hidden={finished&&!historyOpen}><MafiaChat key={`${ownerId}:${state.code}:${state.matchId}`} state={state} you={you} me={me} accountId={ownerId} members={members} disabled={disabled||recovering} act={act}/></div>
      </section>
      <MafiaEventOverlay effect={effect}/>
    </main>
    {!observer&&!recovering&&state.settings?.voiceMode!=='off'&&isActive(state)&&<MafiaVoice voice={voice} state={state}/>}
    {!finished&&<footer data-design-id="player-rail" className="mafia-player-rail">{decisionStatus&&<p className="mafia-decision-status" role="status">{decisionStatus}</p>}{showDecision&&<section className={`mafia-action-dock ${actionOpen?'is-open':''}`}><button type="button" className="mafia-action-trigger" data-design-id="action-open" data-design-required="true" aria-expanded={actionOpen} aria-controls="mafia-current-action" onClick={()=>setActionOpen(value=>!value)}><ToolIcon name="action"/><strong>{actionTitle}</strong><span>{selected.length?tr("{v0} محدّد", {v0: ar(selected.length)}):tr("بانتظار قرارك")}</span><span aria-hidden="true">{actionOpen?'−':'+'}</span></button><div id="mafia-current-action" hidden={!actionOpen}><ActionPanel key={choiceKey} state={state} you={you||{}} me={me} members={members} disabled={disabled} act={act} selection={selection}/></div></section>}<div className="mafia-rail-heading"><span>{tr("المجلس · ")}{ar(members.filter(p=>p.alive).length)}{tr(" أحياء")}</span><span>{targets.length?tr("اختر بطاقة ثم أكّد القرار"):tr("اللاعبون")}</span></div>{seats}</footer>}
    {!observer&&!recovering&&tab!=='council'&&<Modal className="mafia-noir mafia-private-panel mafia-paper-dialog" data-design-screen={`online.mafia.${tab}`} title={tab==='clues'?tr("أدلتي الخاصة"):tr("دفتر الشكوك")} onClose={()=>setTab('council')} footer={<Button data-design-id="tab.council" onClick={()=>setTab('council')}>{tr("العودة للمحادثة")}</Button>}><PresentationStyles sheet={css}/>{tab==='clues'?<section data-design-id="reports" className="mafia-reports"><p className="mafia-private-badge"><ToolIcon name="lock"/>{tr("خاص بك")}</p>{(you?.reports||[]).map((report,i)=><article key={report.id||i}><b>{tr("الليلة ")}{ar(report.night||report.round||1)}</b><p>{reportText(report,members)}</p></article>)}{!you?.reports?.length&&<p>{tr("لا أدلة خاصة بعد.")}</p>}{you?.allies?.length>0&&<p>{tr("فريقك المعروف الآن: ")}{you.allies.map(ally=>nameOf(members,typeof ally==='string'?ally:ally.id)).join(tr('، '))}</p>}<p className="mafia-paper-note">{tr("المعلومة تخص الليلة المكتوبة. قد يغيّر التمويه والتجنيد ما تعرفه.")}</p></section>:<section data-design-id="notebook" className="mafia-notebook"><p>{tr("ملاحظات محلية؛ لا تُرسل للمجلس وتُمسح عند تبديل الحساب أو المباراة.")}</p><label htmlFor="mafia-notes">{tr("ملاحظاتي")}<textarea data-design-id="notes-input" id="mafia-notes" maxLength={2000} value={notes} onChange={e=>setNotes(e.target.value)}/></label></section>}</Modal>}
    {toolsOpen&&<Modal className="mafia-noir mafia-tools-panel mafia-paper-dialog" data-design-screen="online.mafia.tools" title={tr("أدوات المجلس")} onClose={()=>setToolsOpen(false)}><PresentationStyles sheet={css}/><div className="stack"><MafiaRules possibleRoles={state.possibleRoles} onGuide={tutorial?.onGuide}/>{!observer&&!recovering&&<Button data-design-id="tab.notes" onClick={()=>{setToolsOpen(false);setTab('notes');}}><ToolIcon name="notes"/>{tr(" ملاحظاتي")}</Button>}{(tutorial?[]:members).filter(player=>player.id!==me?.id&&!player.spectator).map(player=><Button key={player.id} data-design-id="player-safety" onClick={()=>{setToolsOpen(false);setSafety(player);}}>{tr("إجراءات ")}{player.name}</Button>)}{tutorial&&<p>{tr("شخصيات تدريب محلية؛ لا اتصال أو ميكروفون حقيقي.")}</p>}</div></Modal>}
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
  async function send(kind) { setBusy(true); setError(''); try { await onSafety({kind,player,reason,...(kind==='report'?{category}:{})}); onClose(); } catch { setError(kind === 'block' ? tr("تعذّر الحظر والخروج، حاول مجددًا.") : tr("تعذّر إرسال البلاغ، حاول مجددًا.")); } finally { setBusy(false); } }
  return <Modal className="mafia-noir mafia-safety mafia-paper-dialog" data-design-screen="online.mafia.safety" title={tr("الأمان")} onClose={onClose}><PresentationStyles sheet={css}/><div className="stack"><div className="mafia-verdict-candidate"><ToolIcon name="players"/><span>{tr("اللاعب المبلّغ عنه")}<strong>{player.name}</strong></span></div><label>{tr("فئة البلاغ")}<select data-design-id="report-category" aria-label={tr("فئة البلاغ")} value={category} disabled={busy} onChange={event=>setCategory(event.target.value)}>{MAFIA_REPORT_CATEGORIES.map(item=><option key={item.id} value={item.id}>{tr(item.label)}</option>)}</select></label><label>{tr("تفاصيل البلاغ")}<textarea data-design-id="report-details" maxLength={1000} value={reason} onChange={e=>setReason(e.target.value)}/></label><Button data-design-id="submit" variant="primary" disabled={busy || !reason.trim()} onClick={() => send('report')}>{tr("إرسال بلاغ")}</Button><Button data-design-id="block-exit" variant="secondary" disabled={busy} onClick={() => send('block')}>{tr("حظر ومغادرة المجلس")}</Button><p className="mafia-paper-note">{tr("الحظر أثناء المشاركة ينهي مقعدك. الإبلاغ لا يكشف دورًا ولا يطرد لاعبًا.")}</p>{error&&<p role="alert">{error}</p>}</div></Modal>;
}

export function MafiaPrivacy() { return <section data-design-screen="online.mafia.privacy" className="mafia-noir mafia-shell mafia-waiting"><PresentationStyles sheet={css}/><div data-design-id="privacy" data-design-required="true"><span className="mafia-private-lock"><ToolIcon name="lock"/></span><div className="mafia-waiting-paper"><h2>{tr("المجلس محجوب لحماية الأسرار")}</h2><p>{tr("تغلق بطاقتك عند مغادرة التطبيق. تعود شاشتك عند فتح ميدان.")}</p></div></div></section>; }

export function MafiaHistory({ data, loading, error, onClose = noop, onRefresh = noop, onReview = noop, hasPrevious = false, onPrevious = noop, onNext = noop }) {
  return <Modal className="mafia-noir mafia-history-dialog mafia-paper-dialog" data-design-screen="online.mafia.history" title={tr("سجل مجالسك")} onClose={onClose}><PresentationStyles sheet={css}/><div className="mafia-history stack"><p>{tr("نتائج أدوارك وفرقك في آخر ")}{ar(data?.retentionDays || 30)}{tr(" يومًا، دون نشر المحادثات.")}</p><Button data-design-id="refresh" disabled={loading} onClick={onRefresh}>{loading?tr("نحمّل السجل…"):tr("تحديث السجل")}</Button>{error&&<p data-design-id="error" role="alert">{errorText(error)}</p>}{loading&&<p data-design-id="loading" role="status">{tr("نحمّل نتائجك…")}</p>}{data&&<><div data-design-id="stats" className="mafia-history-stats">{data.stats.map((row,i)=><article key={i}><MafiaRoleArt roleId={row.roleId}/><strong>{localizeAuthored(MAFIA_ROLES[row.roleId])?.name || tr("دور")}</strong><small>{factionLabel(row.faction)}</small><span>{ar(row.matches)}{tr(" مباراة · ")}{ar(row.wins)}{tr(" فوز · ")}{ar(row.draws)}{tr(" تعادل")}</span></article>)}</div><ol data-design-id="history">{data.matches.map(match=><li key={match.matchKey}><b>{localizeAuthored(MAFIA_ROLES[match.roleId])?.name || tr("دور")} · {factionLabel(match.faction)}</b><span>{match.forfeited?tr("انسحاب"):match.draw?tr("تعادل"):match.won?tr("فوز الفريق"):tr("خسارة الفريق")}</span><time dateTime={new Date(match.finishedAt).toISOString()}>{new Date(match.finishedAt).toLocaleDateString(uiDateLocale())}</time><Button data-design-id="history-review" variant="secondary" onClick={()=>onReview(match.matchKey)}>{tr("مراجعة المباراة")}</Button><details><summary>{tr("مرجع المباراة للبطولة أو الاعتراض")}</summary><input data-design-id="history-reference" aria-label={tr("مرجع المباراة")} dir="ltr" readOnly value={match.matchKey} onFocus={event=>event.target.select()} style={{maxWidth:"100%",minWidth:0}}/></details></li>)}</ol>{!data.matches.length&&<p data-design-id="empty">{tr("أول مجلس لك سيظهر هنا بعد اكتماله.")}</p>}<div className="mafia-settings-row"><Button data-design-id="history-previous" variant="secondary" disabled={loading||!hasPrevious} onClick={onPrevious}>{tr("نتائج أحدث")}</Button><Button data-design-id="history-next" variant="secondary" disabled={loading||!data?.nextCursor} onClick={onNext}>{tr("نتائج أقدم")}</Button></div></>}</div></Modal>;
}

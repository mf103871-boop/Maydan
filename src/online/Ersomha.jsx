import { arabicNumber as number, errorText } from './format.js';
import { tr } from '../shared/i18n/core.js';
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Button, Card, Modal } from '../shared/ui/components.jsx';
import { Avatar } from '../shared/brand/art.jsx';
import { getPlayfulSceneArt } from '../shared/brand/playful-scenes.js';
import { IconBack, IconCheck, IconClock, IconClose, IconFlag, IconInfo, IconTag, IconRotate, IconUsers } from '../shared/ui/icons.jsx';
import { ErsomhaToolIcon } from './ErsomhaToolIcon.jsx';
import { ErsomhaCategoryIcon } from './ErsomhaCategoryIcon.jsx';
import { ProfileAvatar } from '../profiles/ProfileAvatar.jsx';
import { ErsomhaIcon } from '../games/ersomha/icon.jsx';
import { ERSOMHA_DIFFICULTIES, normalizeErsomhaOptions, enoughErsomhaCategories } from '../games/ersomha/options.js';
import { ERSOMHA_CATEGORIES} from './shared.js';
import { ErsomhaCanvas } from './ErsomhaCanvas.jsx';
import { registerBackLayer } from '../platform/router.js';
import { useDrawingOrientation } from '../native/drawing-orientation.js';
import { usePlatform } from '../platform/context.js';
import { useCandidateDeadlineWarning } from '../shared/fx/useDeadlineAudio.js';
import css from './ersomha.css?sheet';
import { PresentationStyles } from '../shared/ui/PresentationStyles.jsx';
import focusCss from './ersomha-focus.css';

const categoryLabel = id => tr(ERSOMHA_CATEGORIES.find(category => category.id === id)?.label) || id || tr("فكرة مرسومة");


export function ErsomhaSettings({ value, onChange, disabled, roomEditor = false }) {
  const options = normalizeErsomhaOptions(value), update = patch => onChange(normalizeErsomhaOptions({ ...options, ...patch }));
  return <fieldset className={`ers-settings stack ${roomEditor ? 'is-room-editor' : ''}`} disabled={disabled}><PresentationStyles sheet={css}/><legend className={roomEditor ? 'ers-visually-hidden' : undefined}>{tr("جهّزوا اللوحة")}</legend>
    {!roomEditor && <p className="ers-small">{tr("شخصان: تعاون ضد الوقت · ٣–٨: منافسة وتبادل أدوار")}</p>}
    <div className="ers-settings-grid"><label className="online-field"><span>{tr("مستوى الأفكار")}</span><select data-design-id="difficulty" value={options.difficulty} onChange={event => update({ difficulty: event.target.value })}>{Object.entries(ERSOMHA_DIFFICULTIES).map(([id, label]) => <option key={id} value={id}>{tr(label)}</option>)}</select></label><label className="online-field"><span>{tr("أدوار الرسم")}</span><select data-design-id="cycles" value={options.cycles} onChange={event => update({ cycles: Number(event.target.value) })}><option value={1}>{tr("دور لكل لاعب")}</option><option value={2}>{tr("دوران لكل لاعب")}</option></select></label></div>
    <details className="ers-category-details" open={roomEditor || undefined}><summary><IconTag/>{tr("فئات الأفكار · ")}{options.categories.length ? tr("{v0} مختارة", {v0: number(options.categories.length)}) : number(ERSOMHA_CATEGORIES.length)}</summary><div className="ers-category-grid" role="group" aria-label={tr("فئات ارسمها")}><Button data-design-id="categories-reset" size="sm" aria-pressed={!options.categories.length} onClick={() => update({ categories: [] })}>{tr("كل الفئات")}</Button>{ERSOMHA_CATEGORIES.map(category => <Button data-design-id="category-choice" size="sm" key={category.id} aria-pressed={options.categories.includes(category.id)} onClick={() => update({ categories: options.categories.includes(category.id) ? options.categories.filter(id => id !== category.id) : [...options.categories, category.id] })}>{tr(category.label)}</Button>)}</div></details>
    {!enoughErsomhaCategories(options) && <p className="online-notice error" role="alert">{tr("اختَر ثلاث فئات على الأقل، ليختار كل رسّام من أفكار متنوعة؛ أو اترك كل الفئات مفتوحة.")}</p>}
    {!roomEditor && <p className="ers-small">{tr("١٠ ثوانٍ للاختيار · ٦٠ ثانية للرسم · لا تتكرر فكرة شاهدها أحدكم دون اختياركم.")}</p>}
  </fieldset>;
}
export function ErsomhaLobbySettings({ state, isHost, disabled, act }) {
  const [editing, setEditing] = useState(false), [value, setValue] = useState(() => normalizeErsomhaOptions(state.settings)), [allowReplay, setAllowReplay] = useState(false);
  useEffect(() => { setValue(normalizeErsomhaOptions(state.settings)); setAllowReplay(false); }, [state.settings]);
  const duo = state.members?.filter(player => !player.left).length === 2;
  return <Card className={`stack ers-room-settings ${editing ? 'is-editing' : ''}`}><PresentationStyles sheet={css}/>
    {editing ? <div className="ers-settings-title"><h2>{tr("إعدادات الغرفة")}</h2><Button data-design-id="room-settings" aria-expanded="true" aria-label={tr("إغلاق إعدادات الغرفة")} disabled={disabled} onClick={() => setEditing(false)}><IconClose/></Button></div> : <><h2>{tr("ارسمها · ")}{state.settings.cycles === 2 ? tr("دوران لكل لاعب") : tr("دور لكل لاعب")}</h2><p className="online-footnote">{tr("اختيار ١٠ ثوانٍ · رسم ٦٠ ثانية · كشف ٧ ثوانٍ")}</p><ErsomhaRules /></>}
    {isHost && (editing ? <><div className="ers-settings-people"><DrawingPeople state={state}/><p className={duo ? 'ers-duo-mode' : undefined}>{duo ? tr("تعاون ضد الوقت") : tr("شخصان: تعاون ضد الوقت · ٣–٨: منافسة وتبادل أدوار")}</p></div><ErsomhaSettings value={value} onChange={setValue} disabled={disabled} roomEditor/><label className="ers-replay-toggle"><input data-design-id="allow-replay" type="checkbox" checked={allowReplay} onChange={event => setAllowReplay(event.target.checked)} disabled={disabled} />{tr("أوافق على إعادة أفكار قديمة إذا لم تكفِ الكلمات الجديدة")}</label><p className="ers-small">{tr("ابدأ بتوسيع الفئات عند نفاد الجديد. هذا الخيار وحده يسمح بإعادة ما شاهده أحد اللاعبين.")}</p><p className="ers-settings-timing">{tr("اختيار ١٠ ثوانٍ · رسم ٦٠ ثانية · كشف ٧ ثوانٍ")}</p><Button data-design-id="save" data-sound="none" full variant="primary" disabled={disabled || !enoughErsomhaCategories(value)} onClick={async () => { if (await act('settings', { settings: { ...value, allowReplay } })) setEditing(false); }}>{tr("حفظ إعدادات الغرفة")}</Button></> : <Button data-design-id="room-settings" full aria-expanded="false" disabled={disabled} onClick={() => setEditing(true)}>{tr("تعديل الصعوبة والفئات")}</Button>)}
    {state.settings.allowReplay && <p className="online-notice" role="status">{tr("سمح المضيف بإعادة الكلمات القديمة عند نفاد الجديد. يمكنك المغادرة قبل بدء المباراة.")}</p>}
  </Card>;
}
export function ErsomhaRules() {
  return <details className="ers-rules"><PresentationStyles sheet={css}/><summary><IconInfo/>{tr("كيف نرسم ونكسب؟")}</summary><ol><li>{tr("اختر فكرة من ثلاث، وارسمها دون كتابة الحل أو نطقه. ميكروفون الرسّام مكتوم خلال دوره.")}</li><li>{tr("الجميع يخمّن في الوقت نفسه؛ بعد معرفة الحل يصبح دورك التشجيع.")}</li><li>{tr("التخمين الصحيح ١٠٠ نقطة ومكافأة وقت حتى ٥٠. الرسّام يكسب حتى ١٠٠ حسب نسبة من عرفوا الحل.")}</li><li>{tr("لشخصين: عدد اللوحات المحلولة والوقت المتبقي نتيجة مشتركة، دون فائز شخصي.")}</li><li>{tr("لا نفقد الرسمة عند العودة من انقطاع قصير، وننتظر الرسّام حتى ١٥ ثانية مرة واحدة في الدور.")}</li></ol></details>;
}

function Players({ state, me }) {
  const guessed = new Set(state.guessedIds || []);
  const cooperative = (state.settings?.mode || state.mode) === 'cooperative';
  return <ul className="ers-players" data-design-id="players" aria-label={tr("اللاعبون وحالة الجولة")}>{state.members.filter(player => state.participants?.includes(player.id)).map(player => <li key={player.id} className={`${player.id === state.drawerId ? 'is-drawer' : ''} ${guessed.has(player.id) ? 'has-guessed' : ''}`}>
    {player.profile ? <ProfileAvatar user={player.profile} size={34} /> : <Avatar index={player.avatar} />}<span><b>{player.name}{player.id === me?.id ? tr(" · أنت") : ''}</b><small>{player.left ? tr("غادر") : !player.connected ? tr("منقطع") : player.id === state.drawerId ? tr("الرسّام ✎") : guessed.has(player.id) ? tr("عرفها ✓") : tr("يخمّن")}</small></span>{!cooperative && <strong>{number(player.score || 0)}</strong>}</li>)}</ul>;
}

export function ErsomhaHints({ value, contentLocale = 'ar' }) {
  const lengths = value?.wordLengths || [];
  if (!lengths.length) return <span className="ers-hidden-word">{tr("الفكرة مخبّأة في الرسمة")}</span>;
  let absoluteIndex = 0;
  return <div className="ers-letter-hint" aria-label={tr("فكرة من {v0} {v1}", {v0: number(lengths.length), v1: lengths.length === 1 ? tr("كلمة") : tr("كلمات")})} dir={contentLocale === 'en' ? 'ltr' : 'rtl'}>{lengths.map((length, word) => <span className="ers-hint-word" key={word}>{Array.from({ length }, (_, local) => {
    const index = absoluteIndex++; const character = value.letters?.find(letter => letter.index === index)?.char;
    return <i key={local} aria-label={character || tr("حرف مخفي")}>{character || 'ـ'}</i>;
  })}</span>)}</div>;
}

function Guess({ state, disabled, act }) {
  const [text, setText] = useState(''), [sending, setSending] = useState(false);
  const keyRef = useRef(`${state.matchId}:${state.round}`), inputRef = useRef(null), composingRef = useRef(false);
  useEffect(() => () => { keyRef.current = null; }, []);
  async function submit(event) {
    event.preventDefault(); if (!text.trim() || disabled || sending || state.myGuessed || composingRef.current) return;
    const roundKey = keyRef.current; setSending(true);
    try { if (await act('guess', { text: text.trim() }) && roundKey === keyRef.current) { setText(''); inputRef.current?.focus({ preventScroll: true }); } }
    finally { if (roundKey === keyRef.current) setSending(false); }
  }
  if (state.myGuessed) return <div className="ers-correct" role="status"><b>{tr("عرفتها! ✨")}</b><span>{tr("خلّ أصحابك يكتشفونها… الحل يظهر بعد الدور.")}</span></div>;
  return <form data-design-id="guess-form" className="ers-guess" onSubmit={submit}><label htmlFor={`ers-guess-${state.round}`} className="ers-visually-hidden">{tr("ما الذي يرسمه صاحبك؟")}</label><input data-design-id="guess-input" id={`ers-guess-${state.round}`} ref={inputRef} value={text} maxLength={60} autoComplete="off" autoCorrect="off" enterKeyHint="send" spellCheck={false} disabled={disabled} placeholder={tr("ما الرسمة؟ اكتب تخمينك…")} onChange={event => setText(event.target.value)} onCompositionStart={() => { composingRef.current = true; }} onCompositionEnd={() => { composingRef.current = false; }} onKeyDown={event => { if (event.key === 'Enter' && (composingRef.current || event.nativeEvent.isComposing || event.keyCode === 229)) event.preventDefault(); }} /><Button data-design-id="guess-send" type="submit" variant="primary" disabled={disabled || !text.trim()} loading={sending}>{tr("أرسل")}</Button></form>;
}

function Report({ onClose, onReport }) {
  const [reason, setReason] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [done, setDone] = useState(false);
  return <Modal title={done ? tr("وصل بلاغك") : tr("الإبلاغ عن الرسمة")} onClose={busy ? null : onClose} className="ers-report-modal" footer={done ? <Button data-design-id="close" full variant="primary" onClick={onClose}>{tr("تم")}</Button> : <><Button data-design-id="cancel" disabled={busy} onClick={onClose}>{tr("إلغاء")}</Button><Button data-design-id="confirm" variant="primary" disabled={!reason} loading={busy} onClick={async () => { setBusy(true); try { await onReport(reason); setDone(true); } catch (err) { setError(errorText(err.code || 'NETWORK')); } finally { setBusy(false); } }}>{tr("إرسال البلاغ")}</Button></>}>
    {done ? <p>{tr("سنراجع الرسمة. لا نُظهر للرسّام من أرسل البلاغ.")}</p> : <><p>{tr("تُحفظ نسخة خاصة من رسمة هذا الدور للمراجعة.")}</p><label className="online-field">{tr("السبب")}<select data-design-id="report-reason" value={reason} onChange={event => setReason(event.target.value)}><option value="">{tr("اختر السبب")}</option>{[tr("محتوى غير مناسب"), tr("إساءة أو تنمر"), tr("مشاركة معلومات شخصية"), tr("سبب آخر")].map(value => <option key={value}>{value}</option>)}</select></label></>}{error && <p className="online-notice error" role="alert">{error}</p>}
  </Modal>;
}

export function ErsomhaMatch({ state, me, disabled, isHost, act, client, status = 'connected', clockOffset = 0, drawerReady = true, onReport }) {
  const [now, setNow] = useState(Date.now()), [showReport, setShowReport] = useState(false), [canvasError, setCanvasError] = useState('');
  const [keyboard, setKeyboard] = useState(false), [expanded, setExpanded] = useState(() => typeof window !== 'undefined' && window.innerWidth > window.innerHeight), hostRef = useRef(null);
  const roundKey = `${state.matchId}:${state.round}`, mine = me?.id === state.drawerId, playing = state.phase === 'draw';
  const focusMode = mine && playing && drawerReady && expanded;
  const { status: orientationStatus, requestLandscape } = useDrawingOrientation(focusMode && !state._designPreview, { roundKey });
  const reportTargetRef = useRef(null);
  useEffect(() => { if (state._designPreview) return undefined; const timer = setInterval(() => setNow(Date.now()), 200); return () => clearInterval(timer); }, [state._designPreview]);
  useEffect(() => { setCanvasError(''); setShowReport(false); }, [state.matchId, state.round]);
  useEffect(() => { if (mine && playing && drawerReady) setExpanded(typeof window !== 'undefined' && window.innerWidth > window.innerHeight); }, [roundKey, mine, playing, drawerReady]);
  // Back leaves the enlarged canvas first. Friends and dialogs retain their
  // higher-priority Back handlers; the normal room exit guard stays unchanged.
  useLayoutEffect(() => focusMode ? registerBackLayer(() => setExpanded(false), { priority: 1 }) : undefined, [focusMode]);
  useEffect(() => {
    if (!focusMode || !hostRef.current) return undefined;
    const host = hostRef.current, parent = host.parentElement, originals = new Map();
    const protect = () => {
      for (const sibling of parent?.children || []) {
        if (sibling === host) continue;
        if (!originals.has(sibling)) originals.set(sibling, sibling.inert);
        sibling.inert = true;
      }
    };
    protect();
    const observer = typeof MutationObserver === 'undefined' ? null : new MutationObserver(protect);
    if (parent) observer?.observe(parent, { childList: true });
    return () => { observer?.disconnect(); for (const [sibling, inert] of originals) if (sibling.isConnected) sibling.inert = inert; };
  }, [focusMode]);
  useEffect(() => {
    let frame;
    const measure = () => {
      frame = null;
      const viewport = window.visualViewport, height = viewport?.height || window.innerHeight;
      if (viewport && Math.abs((viewport.scale || 1) - 1) > .001) return;
      hostRef.current?.style.setProperty('--ers-visible-height', `${height}px`);
      hostRef.current?.style.setProperty('--ers-visible-top', `${viewport?.offsetTop || 0}px`);
      const board = hostRef.current?.querySelector('.ers-board-wrap');
      if (board) {
        // Read the used padding value so env(safe-area-inset-bottom) is already
        // resolved to pixels. Custom-property text can still contain env(...).
        const top = board.getBoundingClientRect().top, safeBottom = parseFloat(getComputedStyle(hostRef.current.parentElement).paddingBottom) || 0;
        const landscape = window.innerWidth > window.innerHeight;
        const main = hostRef.current.querySelector('.ers-play-main');
        const remainingControls = landscape ? 0 : Math.max(0, (main?.getBoundingClientRect().bottom || board.getBoundingClientRect().bottom) - board.getBoundingClientRect().bottom);
        const panel = hostRef.current.querySelector('.ers-canvas-panel'), tools = hostRef.current.querySelector('.ers-tools');
        const panelBounds = panel?.getBoundingClientRect();
        const limit = focusMode && panelBounds
          ? Math.max(80, Math.floor(Math.min(panelBounds.width, panelBounds.height - (tools?.getBoundingClientRect().height || 0) - 8)))
          : Math.max(landscape ? 140 : 220, Math.floor(height - top - safeBottom - remainingControls - 8));
        const value = `${limit}px`;
        if (hostRef.current.style.getPropertyValue('--ers-board-limit') !== value) hostRef.current.style.setProperty('--ers-board-limit', value);
      }
      setKeyboard(Boolean(document.activeElement?.matches('input,textarea,[contenteditable=true]')) && window.innerHeight - height > 120);
    };
    const schedule = () => { if (frame == null) frame = requestAnimationFrame(measure); };
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    if (hostRef.current?.parentElement) observer?.observe(hostRef.current.parentElement);
    if (hostRef.current) {
      observer?.observe(hostRef.current);
      for (const node of hostRef.current.querySelectorAll('.ers-canvas-panel,.ers-tools')) observer?.observe(node);
    }
    measure(); window.visualViewport?.addEventListener('resize', schedule); window.addEventListener('resize', schedule); document.addEventListener('focusin', schedule); document.addEventListener('focusout', schedule);
    return () => { observer?.disconnect(); if (frame != null) cancelAnimationFrame(frame); window.visualViewport?.removeEventListener('resize', schedule); window.removeEventListener('resize', schedule); document.removeEventListener('focusin', schedule); document.removeEventListener('focusout', schedule); };
  }, [state.phase, drawerReady, focusMode]);
  const drawer = state.members.find(player => player.id === state.drawerId);
  const paused = Boolean(state.pauseUntil), seconds = Math.max(0, Math.ceil(((paused ? state.pauseUntil : state.deadlineAt) - (now + clockOffset)) / 1000));
  const phaseSeconds = paused ? 15 : state.phase === 'select' ? 10 : state.phase === 'result' ? 7 : state.settings?.drawSeconds || 60;
  const timerAngle = `${Math.min(1, seconds / phaseSeconds) * 360}deg`;
  const clock = `${number(Math.floor(seconds / 60)).padStart(2, number(0))}:${number(seconds % 60).padStart(2, number(0))}`;
  const platform = usePlatform();
  useCandidateDeadlineWarning(platform?.sound, JSON.stringify(['ersomha', state.code, state.matchId, state.round, state.phase, me?.id]), seconds,
    !state._designPreview && !disabled && status === 'connected' && !paused && playing && state.participants?.includes(me?.id));
  const cooperative = (state.settings?.mode || state.mode) === 'cooperative';
  const ordered = [...state.members.filter(player => state.participants?.includes(player.id))].sort((a, b) => b.score - a.score);
  const endedEarly = Boolean(state.reason);
  const endNotice = state.reason === 'players_left' ? tr("انتهت المباراة بعد مغادرة لاعب. هذه نتيجة الأدوار المكتملة.") : state.reason === 'account_unavailable' ? tr("توقفت المباراة لأن أحد حسابات اللاعبين لم يعد متاحًا للعب. حفظنا نتيجة الأدوار المكتملة.") : ['active_elsewhere', 'account_active_elsewhere'].includes(state.reason) ? tr("توقفت المباراة لأن حساب أحد اللاعبين انتقل إلى غرفة أخرى. حفظنا نتيجة الأدوار المكتملة.") : endedEarly ? tr("توقفت المباراة. هذه نتيجة الأدوار المكتملة.") : '';
  const report = onReport ? () => { reportTargetRef.current = { roundKey: `${state.matchId}:${state.round}`, submit: onReport }; setShowReport(true); } : null;
  if (mine && !drawerReady && ['select', 'draw'].includes(state.phase)) return <div data-design-screen="ersomha.private-wait" className="ersomha stack"><PresentationStyles sheet={css}/><Card data-design-id="privacy" data-design-required="true" className="ers-selection-wait" role="status"><ErsomhaIcon /><h1 data-design-id="title">{tr("نجهّز دورك…")}</h1><p>{tr("نكتم الميكروفون أولًا، ثم تظهر فكرتك السرّية.")}</p></Card></div>;
  if (state.phase === 'over') return <div data-design-screen="ersomha.over" className={`ersomha stack ${cooperative?'is-cooperative-final':''}`}><PresentationStyles sheet={css}/><Card data-design-id="results" className="ers-finish stack"><span className="ers-result-art"><img src={getPlayfulSceneArt('drawing-trophy',128)||getPlayfulSceneArt('easel',128)} width="128" height="128" alt=""/></span><h1 data-design-id="title">{endedEarly ? tr("حصيلة الأدوار المكتملة") : cooperative ? tr("معًا رسمتوها!") : tr("كل رسمة لها حكاية")}</h1>{endNotice && <p role="status">{endNotice}</p>}{cooperative ? <CoopResult state={state} /> : <DrawingPodium entries={ordered}/>}{isHost ? <><Button data-design-id="restart" full size="lg" variant="primary" disabled={disabled} onClick={() => act('restart')}>{tr("لوحات جديدة · العودة للانتظار")}</Button><p className="ers-small">{tr("يبدأ المضيف المباراة التالية من غرفة الانتظار.")}</p></> : <p>{tr("بانتظار المضيف لمباراة أخرى.")}</p>}</Card></div>;
  return <div data-design-screen={`ersomha.${state.phase}.${mine ? 'drawer' : 'guesser'}`} data-ersomha-drawing-focus={focusMode ? 'true' : undefined} ref={hostRef} className={`ersomha stack is-${state.phase} ${mine?'is-my-turn':'is-guessing'} ${playing ? 'is-drawing' : ''} ${focusMode ? 'is-drawing-focus' : ''} ${keyboard ? 'is-keyboard' : ''}`} onKeyDown={event => { if (focusMode && event.key === 'Escape' && !event.defaultPrevented && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); setExpanded(false); } }}><PresentationStyles sheet={css}/><style>{focusCss}</style>
    <header data-design-id="header" className="ers-match-header">
      {focusMode&&<Button data-design-id="focus-toggle" data-design-required="true" className="ers-focus-toggle" aria-expanded="true" aria-label={tr("العودة للغرفة")} onClick={()=>setExpanded(false)}><IconBack/>{tr("الغرفة")}</Button>}
      <h1 data-design-id={state.phase==='select'&&mine?undefined:'title'} className={focusMode?'ers-focus-word':'ers-visually-hidden'}>{focusMode?<><PrivateMark/>{state.myWord}<span>{tr("الميكروفون مكتوم")}</span></>:state.phase==='select'?tr("{v0} يختار فكرة…",{v0:drawer?.name||tr("صاحب الدور")}):state.phase==='result'?tr("كانت الرسمة…"):mine?tr("دورك ترسمها!"):tr("{v0} يرسم الآن",{v0:drawer?.name||tr("صاحبك")})}</h1>
      <span className="ers-turn">{tr("الدور ")}{number(state.round)}{tr(" من ")}{number(state.rounds)}</span>
      <span data-design-id="timer" data-seconds={seconds} className={`ers-timer ${seconds<=5&&!paused?'is-urgent':''}`} style={{'--ers-timer-angle':timerAngle}} role="timer" aria-label={tr("{v0} {v1} ثانية",{v0:paused?tr("ننتظر الرسام، متبقي"):tr("متبقي"),v1:number(seconds)})}><IconClock/><b dir="ltr">{clock}</b></span>
      {mine&&playing&&!focusMode&&<div className="ers-view-actions"><Button data-design-id="orientation" className="ers-rotate-toggle" aria-label={tr("عرض الرسم أفقيًا")} onClick={()=>{setExpanded(true);requestLandscape();}} title={orientationStatus==='rotate'?tr("اقلب الهاتف للعرض؛ قد يمنع قفل الاتجاه التدوير"):tr("عرض الرسم أفقيًا")}><IconRotate/></Button></div>}
      {playing&&!mine&&<div className="ers-guesser-identity"><DrawerIdentity player={drawer}/></div>}
      {report&&!mine&&!focusMode&&<Button data-design-id="report" className="ers-header-report" aria-label={tr("الإبلاغ عن الرسمة")} onClick={report}><IconFlag/></Button>}
      {focusMode&&<span className="ers-focus-connection" role="status">{status==='connected'?tr("متصل"):tr("جاري الاتصال بالغرفة…")}</span>}
    </header>
    {state.phase==='select'?<Card className="ers-choice-card stack">{mine?<><img className="ers-selection-art" src={getPlayfulSceneArt('easel',112)} width="112" height="112" alt=""/><h1 data-design-id="title">{tr("اختَر فكرتك")}</h1><p className="ers-privacy-note"><PrivateMark/>{tr("خاص بك · الميكروفون مكتوم")}</p><div data-design-id="word-choices" className="ers-word-choices">{(state.myChoices||[]).map((choice,index)=><button data-design-id="word-choice" data-sound="none" type="button" key={choice.id} disabled={disabled||seconds===0||paused} onClick={()=>act('select_word',{choiceId:choice.id})}><span className="ers-choice-number" aria-hidden="true">{number(index+1)}</span><strong>{choice.text}</strong><IconBack/></button>)}</div><p className="ers-small">{tr("إذا انتهى الوقت نختار لك تلقائيًا.")}</p><div className="ers-waiting-friends" data-design-id="players">{state.members.filter(player=>state.participants?.includes(player.id)&&player.id!==me?.id).map(player=><span key={player.id} title={player.name}><Portrait player={player} size={60}/><span className="ers-visually-hidden">{player.name}</span></span>)}</div><p className="ers-small">{tr("أصحابك ينتظرون أول خطّ")}</p></>:<div className="ers-selection-wait"><img className="ers-selection-art" src={getPlayfulSceneArt('easel',112)} width="112" height="112" alt=""/><b>{tr("جهّز خيالك…")}</b><p>{tr("بعد لحظات تشوفون أول خط معًا.")}</p><Players state={{...state,mode:cooperative?'cooperative':'competitive'}} me={me}/></div>}</Card>:<>
      <div data-design-id="word-banner" className={`ers-word-banner ${mine||state.phase==='result'?'is-known':''}`}>
        {state.phase==='result'?<strong>{tr("الحل")}: <span dir="auto">{state.revealedWord}</span></strong>:mine?<><strong><PrivateMark/>{tr("فكرتك")}: <span dir="auto">{state.myWord}</span></strong><span>{tr("خاص بك · الميكروفون مكتوم")}</span></>:<><strong><ErsomhaCategoryIcon category={state.category||state.publicWord?.category}/><span>{categoryLabel(state.category||state.publicWord?.category)}</span></strong><ErsomhaHints contentLocale={state.contentLocale} value={state.publicWord}/></>}
      </div>
      {mine&&playing&&<><p data-design-id="mic-note" data-design-required="true" className="ers-visually-hidden ers-mic-note">{tr("الميكروفون مكتوم طوال الرسم. وضّحها بخطوطك، دون حروف أو أرقام تكشف الحل.")}</p><DrawerIdentity player={drawer}/></>}
      <div className={`ers-play-grid ${playing&&!mine?'has-guesser':''}`}><div className="ers-play-main"><ErsomhaCanvas client={client} roundKey={`${state.matchId}:${state.round}`} epoch={state.drawing?.epoch} serverSeq={state.drawing?.seq||0} paletteVersion={state.drawing?.paletteVersion} paletteVersions={state.capabilities?.ersomhaPaletteVersions} canDraw={mine&&playing} wide={focusMode} paused={paused} connected={status==='connected'} onError={setCanvasError}/>
        {canvasError&&<p className="ers-small" role="status">{canvasError==='DRAW_PENDING'?tr("نثبت آخر خط؛ جرّب الأداة بعد لحظة."):errorText(canvasError)}</p>}
        {state.phase==='result'&&<Card data-design-id="results" className="ers-round-result stack">{['drawer_left','drawer_disconnected'].includes(state.roundReason)?<p>{tr("انقطع الرسّام؛ أُلغي الدور دون نقاط.")}</p>:<><h2>{(state.guessedIds||[]).length?(cooperative?tr("عرفتوها معًا!"):`${number(state.guessedIds.length)} ${state.guessedIds.length===1?tr("عرفها"):tr("عرفوها")}!`):tr("الرسمة القادمة أوضح!")}</h2>{cooperative?<CoopResult state={state}/>:<ul>{Object.entries(state.breakdown||{}).map(([playerId,item])=>{const player=state.members.find(member=>member.id===playerId);return <li key={playerId}><Portrait player={player} size={48}/><span dir="auto">{player?.name}</span><b>+{number(item.points??0)}</b></li>;})}</ul>}</>}<p className="ers-auto-next">{tr("الدور التالي يبدأ تلقائيًا…")}</p></Card>}
      </div>
        <div className="ers-side-panel">
          {playing&&!mine&&<div className="ers-guess-slot"><Guess key={`${state.matchId}:${state.round}:${me?.id}`} state={state} disabled={disabled||paused||seconds===0} act={act}/></div>}
          <details key={`${state.matchId}:${state.round}:${state.phase}:${mine}`} data-design-id="aside" className="ers-play-aside" open={playing&&!mine}>
            <summary><IconUsers/><b>{tr("الأصدقاء والتخمينات ")}</b><span>{number((state.guessedIds||[]).length)}{tr(" عرفها · ")}{number(state.participants?.length||0)}{tr(" لاعبين")}</span></summary>
            <div className="ers-aside-content">
              {mine&&playing&&!focusMode&&<div className="ers-secondary-actions"><Button data-design-id="focus-toggle" data-design-required="true" aria-expanded="false" onClick={()=>setExpanded(true)}><ErsomhaToolIcon name="expand"/>{tr("كبّر اللوحة")}</Button>{report&&<Button data-design-id="report" aria-label={tr("الإبلاغ عن الرسمة")} onClick={report}><IconFlag/>{tr("الإبلاغ عن الرسمة")}</Button>}</div>}<section data-design-id="guesses" className="ers-guesses" aria-label={tr("تخمينات الأصدقاء")} aria-live="polite" aria-relevant="additions">{!(state.recentGuesses||[]).length&&<p>{tr("أول تخمين يبدأ الحكاية…")}</p>}<ol>{(state.recentGuesses||[]).slice(-12).map(guess=>{const player=state.members.find(member=>member.id===guess.playerId);return <li key={guess.id} className={guess.correct?'is-correct':''}><Portrait player={player} size={34}/><b dir="auto">{player?.name||tr("لاعب")}</b><span dir="auto">{guess.correct?<>{tr("عرفها!")}<IconCheck/></>:guess.text}</span></li>;})}</ol></section>
              <details className="ers-aside-roster"><summary>{tr("اللاعبون وحالة الجولة")}</summary><Players state={{...state,mode:cooperative?'cooperative':'competitive'}} me={me}/></details>
            </div>
          </details>
        </div>
      </div>
      {playing&&!mine&&<p className="ers-answer-note"><IconInfo/>{tr("الحل يظهر بعد الدور")}</p>}
    </>}
    {paused&&<p className="ers-pause" role="status">{tr("ننتظر عودة الرسّام حتى ")}{number(seconds)}{tr(" ثانية. وقت الرسم متوقف.")}</p>}
    {showReport&&reportTargetRef.current?.roundKey===`${state.matchId}:${state.round}`&&<Report onClose={()=>setShowReport(false)} onReport={reportTargetRef.current.submit}/>}
  </div>;
}
function PrivateMark(){return <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><rect x="5" y="10" width="14" height="12" rx="3"/><path d="M8 10V6a4 4 0 0 1 8 0v4M12 14v4"/></svg>;}
function Portrait({player,size=48,presentation='avatar'}){return player?.profile?<ProfileAvatar user={player.profile} size={size} presentation={presentation}/>:<Avatar index={player?.avatar} style={{width:size,height:size}}/>;}
function DrawerIdentity({player}){return <div data-design-id="drawer-identity" className="ers-drawer-identity"><Portrait player={player} size={40}/><b><bdi>{player?.name||tr("صاحبك")}</bdi><span>{tr("يرسم الآن")}</span></b></div>;}
function DrawingPodium({entries}){
  const top=entries.slice(0,3),order=top.length===3?[top[1],top[0],top[2]]:top.length===2?[top[1],top[0]]:top;
  const rank=entry=>entries.findIndex(other=>other.score===entry.score)+1;
  return <div data-design-id="podium" className="ers-final-podium"><div className="ers-podium-stage">{order.map(entry=><div className="ers-podium-person" data-rank={rank(entry)} key={entry.id}><Portrait player={entry} size={88} presentation="cutout"/><div className="ers-podium-block"><span className="ers-podium-rank" aria-label={tr("الترتيب")}>{number(rank(entry))}</span><b dir="auto">{entry.name}</b><strong>{number(entry.score||0)}</strong></div></div>)}</div>{entries.length>3&&<ol className="ers-podium-rest">{entries.slice(3).map(entry=><li key={entry.id}><span aria-label={tr("الترتيب")}>{number(rank(entry))}</span><Portrait player={entry} size={52} presentation="cutout"/><b dir="auto">{entry.name}</b><strong>{number(entry.score||0)}</strong></li>)}</ol>}</div>;
}

function DrawingPeople({ state }) {
  const people = (state.members || []).filter(player => state.participants?.length ? state.participants.includes(player.id) : !player.left);
  return <div className="ers-drawing-people" aria-label={tr("اللاعبون وحالة الجولة")}>{people.map(player => <span key={player.id} title={player.name}><Portrait player={player} size={104}/><span className="ers-visually-hidden">{player.name}</span></span>)}</div>;
}
function CoopResult({ state }) {
  const result = state.coop || state.cooperative || state.team || {};
  return <div data-design-id="cooperative-result" className="ers-coop-result"><DrawingPeople state={state}/><div className="ers-coop-stats"><span><b>{number(result.solvedTurns ?? result.solved ?? result.solvedCount ?? 0)}</b>{tr("لوحات محلولة")}</span><span><b>{number(Math.floor((result.remainingMs ?? result.timeRemainingMs ?? 0) / 1000))}</b>{tr("ثانية وفّرتوها")}</span></div></div>;
}

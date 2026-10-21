import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Button, Card, Modal, Podium } from '../shared/ui/components.jsx';
import { Avatar } from '../shared/brand/art.jsx';
import { ProfileAvatar } from '../profiles/ProfileAvatar.jsx';
import { ErsomhaIcon } from '../games/ersomha/icon.jsx';
import { ERSOMHA_DIFFICULTIES, normalizeErsomhaOptions, enoughErsomhaCategories } from '../games/ersomha/options.js';
import { ERSOMHA_CATEGORIES, arabicNumber as number, errorText } from './shared.js';
import { ErsomhaCanvas } from './ErsomhaCanvas.jsx';
import { registerBackLayer } from '../platform/router.js';
import { useDrawingOrientation } from '../native/drawing-orientation.js';
import css from './ersomha.css';
import focusCss from './ersomha-focus.css';

const categoryLabel = id => ERSOMHA_CATEGORIES.find(category => category.id === id)?.label || id || 'فكرة مرسومة';

export function ErsomhaSettings({ value, onChange, disabled }) {
  const options = normalizeErsomhaOptions(value), update = patch => onChange(normalizeErsomhaOptions({ ...options, ...patch }));
  return <fieldset className="ers-settings stack" disabled={disabled}><style>{css}</style><legend>جهّزوا اللوحة</legend>
    <p className="ers-small">شخصان: تعاون ضد الوقت · ٣–٨: منافسة وتبادل أدوار</p>
    <div className="ers-settings-grid"><label className="online-field">مستوى الأفكار<select data-design-id="difficulty" value={options.difficulty} onChange={event => update({ difficulty: event.target.value })}>{Object.entries(ERSOMHA_DIFFICULTIES).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label><label className="online-field">أدوار الرسم<select data-design-id="cycles" value={options.cycles} onChange={event => update({ cycles: Number(event.target.value) })}><option value={1}>دور لكل لاعب</option><option value={2}>دوران لكل لاعب</option></select></label></div>
    <details className="ers-category-details"><summary>فئات الأفكار · {options.categories.length ? `${number(options.categories.length)} مختارة` : 'كل الفئات'}</summary><div className="ers-category-grid" role="group" aria-label="فئات ارسمها"><Button data-design-id="categories-reset" size="sm" aria-pressed={!options.categories.length} onClick={() => update({ categories: [] })}>كل الفئات</Button>{ERSOMHA_CATEGORIES.map(category => <Button data-design-id="category-choice" size="sm" key={category.id} aria-pressed={options.categories.includes(category.id)} onClick={() => update({ categories: options.categories.includes(category.id) ? options.categories.filter(id => id !== category.id) : [...options.categories, category.id] })}>{category.label}</Button>)}</div></details>
    {!enoughErsomhaCategories(options) && <p className="online-notice error" role="alert">اختَر ثلاث فئات على الأقل، ليختار كل رسّام من أفكار متنوعة؛ أو اترك كل الفئات مفتوحة.</p>}
    <p className="ers-small">١٠ ثوانٍ للاختيار · ٦٠ ثانية للرسم · لا تتكرر فكرة شاهدها أحدكم دون اختياركم.</p>
  </fieldset>;
}
export function ErsomhaLobbySettings({ state, isHost, disabled, act }) {
  const [editing, setEditing] = useState(false), [value, setValue] = useState(() => normalizeErsomhaOptions(state.settings)), [allowReplay, setAllowReplay] = useState(false);
  useEffect(() => { setValue(normalizeErsomhaOptions(state.settings)); setAllowReplay(false); }, [state.settings]);
  return <Card className="stack"><h2>ارسمها · {state.settings.cycles === 2 ? 'دوران لكل لاعب' : 'دور لكل لاعب'}</h2><p className="online-footnote">اختيار ١٠ ثوانٍ · رسم ٦٠ ثانية · كشف ٧ ثوانٍ</p><ErsomhaRules />
    {isHost && <><Button data-design-id="room-settings" full aria-expanded={editing} disabled={disabled} onClick={() => setEditing(value => !value)}>{editing ? 'إغلاق إعدادات الغرفة' : 'تعديل الصعوبة والفئات'}</Button>{editing && <><ErsomhaSettings value={value} onChange={setValue} disabled={disabled} /><label className="ers-replay-toggle"><input data-design-id="allow-replay" type="checkbox" checked={allowReplay} onChange={event => setAllowReplay(event.target.checked)} disabled={disabled} />أوافق على إعادة أفكار قديمة إذا لم تكفِ الكلمات الجديدة</label><p className="ers-small">ابدأ بتوسيع الفئات عند نفاد الجديد. هذا الخيار وحده يسمح بإعادة ما شاهده أحد اللاعبين.</p><Button data-design-id="save" full variant="primary" disabled={disabled || !enoughErsomhaCategories(value)} onClick={async () => { if (await act('settings', { settings: { ...value, allowReplay } })) setEditing(false); }}>حفظ إعدادات الغرفة</Button></>}</>}
    {state.settings.allowReplay && <p className="online-notice" role="status">سمح المضيف بإعادة الكلمات القديمة عند نفاد الجديد. يمكنك المغادرة قبل بدء المباراة.</p>}
  </Card>;
}
export function ErsomhaRules() {
  return <details className="ers-rules"><style>{css}</style><summary>كيف نرسم ونكسب؟</summary><ol><li>اختر فكرة من ثلاث، وارسمها دون كتابة الحل أو نطقه. ميكروفون الرسّام مكتوم خلال دوره.</li><li>الجميع يخمّن في الوقت نفسه؛ بعد معرفة الحل يصبح دورك التشجيع.</li><li>التخمين الصحيح ١٠٠ نقطة ومكافأة وقت حتى ٥٠. الرسّام يكسب حتى ١٠٠ حسب نسبة من عرفوا الحل.</li><li>لشخصين: عدد اللوحات المحلولة والوقت المتبقي نتيجة مشتركة، دون فائز شخصي.</li><li>لا نفقد الرسمة عند العودة من انقطاع قصير، وننتظر الرسّام حتى ١٥ ثانية مرة واحدة في الدور.</li></ol></details>;
}

function Players({ state, me }) {
  const guessed = new Set(state.guessedIds || []);
  const cooperative = (state.settings?.mode || state.mode) === 'cooperative';
  return <ul className="ers-players" data-design-id="players" aria-label="اللاعبون وحالة الجولة">{state.members.filter(player => state.participants?.includes(player.id)).map(player => <li key={player.id} className={`${player.id === state.drawerId ? 'is-drawer' : ''} ${guessed.has(player.id) ? 'has-guessed' : ''}`}>
    {player.profile ? <ProfileAvatar user={player.profile} size={34} /> : <Avatar index={player.avatar} />}<span><b>{player.name}{player.id === me?.id ? ' · أنت' : ''}</b><small>{player.left ? 'غادر' : !player.connected ? 'منقطع' : player.id === state.drawerId ? 'الرسّام ✎' : guessed.has(player.id) ? 'عرفها ✓' : 'يخمّن'}</small></span>{!cooperative && <strong>{number(player.score || 0)}</strong>}</li>)}</ul>;
}

export function ErsomhaHints({ value }) {
  const lengths = value?.wordLengths || [];
  if (!lengths.length) return <span className="ers-hidden-word">الفكرة مخبّأة في الرسمة</span>;
  let absoluteIndex = 0;
  return <div className="ers-letter-hint" aria-label={`فكرة من ${number(lengths.length)} ${lengths.length === 1 ? 'كلمة' : 'كلمات'}`} dir="rtl">{lengths.map((length, word) => <span className="ers-hint-word" key={word}>{Array.from({ length }, (_, local) => {
    const index = absoluteIndex++; const character = value.letters?.find(letter => letter.index === index)?.char;
    return <i key={local} aria-label={character || 'حرف مخفي'}>{character || 'ـ'}</i>;
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
  if (state.myGuessed) return <div className="ers-correct" role="status"><b>عرفتها! ✨</b><span>خلّ أصحابك يكتشفونها… الحل يظهر بعد الدور.</span></div>;
  return <form data-design-id="guess-form" className="ers-guess" onSubmit={submit}><label htmlFor={`ers-guess-${state.round}`} className="ers-visually-hidden">ما الذي يرسمه صاحبك؟</label><input data-design-id="guess-input" id={`ers-guess-${state.round}`} ref={inputRef} value={text} maxLength={60} autoComplete="off" autoCorrect="off" enterKeyHint="send" spellCheck={false} disabled={disabled} placeholder="ما الرسمة؟ اكتب تخمينك…" onChange={event => setText(event.target.value)} onCompositionStart={() => { composingRef.current = true; }} onCompositionEnd={() => { composingRef.current = false; }} onKeyDown={event => { if (event.key === 'Enter' && (composingRef.current || event.nativeEvent.isComposing || event.keyCode === 229)) event.preventDefault(); }} /><Button data-design-id="guess-send" type="submit" variant="primary" disabled={disabled || !text.trim()} loading={sending}>أرسل</Button></form>;
}

function Report({ onClose, onReport }) {
  const [reason, setReason] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [done, setDone] = useState(false);
  return <Modal title={done ? 'وصل بلاغك' : 'الإبلاغ عن الرسمة'} onClose={busy ? null : onClose} className="ers-report-modal" footer={done ? <Button data-design-id="close" full variant="primary" onClick={onClose}>تم</Button> : <><Button data-design-id="cancel" disabled={busy} onClick={onClose}>إلغاء</Button><Button data-design-id="confirm" variant="primary" disabled={!reason} loading={busy} onClick={async () => { setBusy(true); try { await onReport(reason); setDone(true); } catch (err) { setError(errorText(err.code || 'NETWORK')); } finally { setBusy(false); } }}>إرسال البلاغ</Button></>}>
    {done ? <p>سنراجع الرسمة. لا نُظهر للرسّام من أرسل البلاغ.</p> : <><p>تُحفظ نسخة خاصة من رسمة هذا الدور للمراجعة.</p><label className="online-field">السبب<select data-design-id="report-reason" value={reason} onChange={event => setReason(event.target.value)}><option value="">اختر السبب</option>{['محتوى غير مناسب', 'إساءة أو تنمر', 'مشاركة معلومات شخصية', 'سبب آخر'].map(value => <option key={value}>{value}</option>)}</select></label></>}{error && <p className="online-notice error" role="alert">{error}</p>}
  </Modal>;
}

export function ErsomhaMatch({ state, me, disabled, isHost, act, client, status = 'connected', clockOffset = 0, drawerReady = true, onReport }) {
  const [now, setNow] = useState(Date.now()), [showReport, setShowReport] = useState(false), [canvasError, setCanvasError] = useState('');
  const [keyboard, setKeyboard] = useState(false), [expanded, setExpanded] = useState(true), hostRef = useRef(null);
  const roundKey = `${state.matchId}:${state.round}`, mine = me?.id === state.drawerId, playing = state.phase === 'draw';
  const focusMode = mine && playing && drawerReady && expanded;
  const { status: orientationStatus, requestLandscape } = useDrawingOrientation(focusMode && !state._designPreview, { roundKey });
  const reportTargetRef = useRef(null);
  useEffect(() => { if (state._designPreview) return undefined; const timer = setInterval(() => setNow(Date.now()), 200); return () => clearInterval(timer); }, [state._designPreview]);
  useEffect(() => { setCanvasError(''); setShowReport(false); }, [state.matchId, state.round]);
  useEffect(() => { if (mine && playing && drawerReady) setExpanded(true); }, [roundKey, mine, playing, drawerReady]);
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
          ? Math.max(80, Math.floor(Math.min(panelBounds.width - (landscape ? 284 : 0), panelBounds.height - (landscape ? 0 : (tools?.getBoundingClientRect().height || 0) + 8))))
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
  const cooperative = (state.settings?.mode || state.mode) === 'cooperative';
  const ordered = [...state.members.filter(player => state.participants?.includes(player.id))].sort((a, b) => b.score - a.score);
  const endedEarly = Boolean(state.reason);
  const endNotice = state.reason === 'players_left' ? 'انتهت المباراة بعد مغادرة لاعب. هذه نتيجة الأدوار المكتملة.' : state.reason === 'account_unavailable' ? 'توقفت المباراة لأن أحد حسابات اللاعبين لم يعد متاحًا للعب. حفظنا نتيجة الأدوار المكتملة.' : ['active_elsewhere', 'account_active_elsewhere'].includes(state.reason) ? 'توقفت المباراة لأن حساب أحد اللاعبين انتقل إلى غرفة أخرى. حفظنا نتيجة الأدوار المكتملة.' : endedEarly ? 'توقفت المباراة. هذه نتيجة الأدوار المكتملة.' : '';
  const report = onReport ? () => { reportTargetRef.current = { roundKey: `${state.matchId}:${state.round}`, submit: onReport }; setShowReport(true); } : null;
  if (mine && !drawerReady && ['select', 'draw'].includes(state.phase)) return <div data-design-screen="ersomha.private-wait" className="ersomha stack"><style>{css}</style><Card data-design-id="privacy" data-design-required="true" className="ers-selection-wait" role="status"><ErsomhaIcon /><h1 data-design-id="title">نجهّز دورك…</h1><p>نكتم الميكروفون أولًا، ثم تظهر فكرتك السرّية.</p></Card></div>;
  if (state.phase === 'over') return <div data-design-screen="ersomha.over" className="ersomha stack"><style>{css}</style><Card data-design-id="results" className="ers-finish stack"><ErsomhaIcon /><span className="ers-eyebrow">حصيلة اللوحات</span><h1 data-design-id="title">{endedEarly ? 'حصيلة الأدوار المكتملة' : cooperative ? 'معًا رسمتوها!' : 'كل رسمة لها حكاية'}</h1>{endNotice && <p role="status">{endNotice}</p>}{cooperative ? <CoopResult state={state} /> : <Podium data-design-id="podium" entries={ordered} />}{isHost ? <Button data-design-id="restart" full size="lg" variant="primary" disabled={disabled} onClick={() => act('restart')}>لوحات جديدة · العودة للانتظار</Button> : <p>بانتظار المضيف لمباراة أخرى.</p>}</Card></div>;
  return <div data-design-screen={`ersomha.${state.phase}.${mine ? 'drawer' : 'guesser'}`} data-ersomha-drawing-focus={focusMode ? 'true' : undefined} ref={hostRef} className={`ersomha stack ${playing ? 'is-drawing' : ''} ${focusMode ? 'is-drawing-focus' : ''} ${keyboard ? 'is-keyboard' : ''}`} onKeyDown={event => { if (focusMode && event.key === 'Escape' && !event.defaultPrevented && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); setExpanded(false); } }}><style>{css}{focusCss}</style>
    <header data-design-id="header" className="ers-match-header"><div><span className="ers-eyebrow">{focusMode ? 'فكرتك · الميكروفون مكتوم' : `${cooperative ? 'تعاون ضد الوقت' : 'كل رسمة تقرّبك'} · ${ERSOMHA_DIFFICULTIES[state.settings?.difficulty] || 'سهل'}`}</span><h1 data-design-id="title">{focusMode ? state.myWord : state.phase === 'select' ? mine ? 'اختَر فكرتك' : `${drawer?.name || 'صاحب الدور'} يختار فكرة…` : state.phase === 'result' ? 'كانت الرسمة…' : mine ? 'دورك ترسمها!' : `${drawer?.name || 'صاحبك'} يرسم الآن`}</h1><span className="ers-turn">الدور {number(state.round)} / {number(state.rounds)}</span></div>{mine && playing && <><Button data-design-id="orientation" className="ers-rotate-toggle" size="sm" aria-label="عرض الرسم أفقيًا" onClick={() => { setExpanded(true); requestLandscape(); }} title={orientationStatus === 'rotate' ? 'اقلب الهاتف للعرض؛ قد يمنع قفل الاتجاه التدوير' : 'عرض الرسم أفقيًا'}><span aria-hidden="true">⤾</span></Button><Button data-design-id="focus-toggle" data-design-required="true" className="ers-focus-toggle" size="sm" aria-expanded={focusMode} aria-label={focusMode ? 'العودة للغرفة' : 'تكبير لوحة الرسم'} onClick={() => setExpanded(value => !value)}><span aria-hidden="true">{focusMode ? '↙' : '⛶'}</span><span className="ers-focus-label">{focusMode ? 'الغرفة' : 'كبّر اللوحة'}</span></Button></>}{report && <Button data-design-id="report" className="ers-header-report" size="sm" aria-label="الإبلاغ عن الرسمة" onClick={report}>⚑</Button>}<span data-design-id="timer" className={`ers-timer ${seconds <= 10 && !paused ? 'is-urgent' : ''}`} role="timer" aria-label={`${paused ? 'ننتظر الرسام، متبقي' : 'متبقي'} ${number(seconds)} ثانية`}><b>{number(seconds)}</b><small>{paused ? 'عودة' : 'ثانية'}</small></span></header>
    {state.phase === 'select' ? <Card className="ers-choice-card stack">{mine ? <><p>ثلاث أفكار، وثلاث طرق للحكاية. اختَر ما تقدر ترسمه.</p><div data-design-id="word-choices" className="ers-word-choices">{(state.myChoices || []).map(choice => <button data-design-id="word-choice" type="button" key={choice.id} disabled={disabled || seconds === 0 || paused} onClick={() => act('select_word', { choiceId: choice.id })}><small>{categoryLabel(choice.category)}</small><strong>{choice.text}</strong><span>ارسمها ←</span></button>)}</div><p className="ers-small">الميكروفون مكتوم لحماية الفكرة. إذا انتهى الوقت نختار لك تلقائيًا.</p></> : <div className="ers-selection-wait"><ErsomhaIcon /><b>جهّز خيالك…</b><p>بعد لحظات تشوفون أول خط معًا.</p></div>}</Card> : <>
      <div data-design-id="word-banner" className={`ers-word-banner ${mine || state.phase === 'result' ? 'is-known' : ''}`}><span>{state.phase === 'result' ? 'الحل' : mine ? 'فكرتك · الميكروفون مكتوم' : categoryLabel(state.category || state.publicWord?.category)}</span>{state.phase === 'result' ? <strong>{state.revealedWord}</strong> : mine ? <strong>{state.myWord}</strong> : <ErsomhaHints value={state.publicWord} />}</div>
      {mine && playing && <p data-design-id="mic-note" data-design-required="true" className="ers-mic-note">الميكروفون مكتوم طوال الرسم. وضّحها بخطوطك، دون حروف أو أرقام تكشف الحل.</p>}
      <div className="ers-play-grid"><div className="ers-play-main"><ErsomhaCanvas client={client} roundKey={`${state.matchId}:${state.round}`} epoch={state.drawing?.epoch} serverSeq={state.drawing?.seq || 0} canDraw={mine && playing} wide={focusMode} paused={paused} connected={status === 'connected'} onError={setCanvasError} />
        {canvasError && <p className="ers-small" role="status">{canvasError === 'DRAW_PENDING' ? 'نثبت آخر خط؛ جرّب الأداة بعد لحظة.' : errorText(canvasError)}</p>}
        {playing && !mine && <Guess key={`${state.matchId}:${state.round}:${me?.id}`} state={state} disabled={disabled || paused || seconds === 0} act={act} />}
        {state.phase === 'result' && <Card data-design-id="results" className="ers-round-result stack">{['drawer_left', 'drawer_disconnected'].includes(state.roundReason) ? <p>انقطع الرسّام؛ أُلغي الدور دون نقاط.</p> : <><h2>{(state.guessedIds || []).length ? `${number(state.guessedIds.length)} ${state.guessedIds.length === 1 ? 'عرفها' : 'عرفوها'}!` : 'الرسمة القادمة أوضح!'}</h2>{cooperative ? <CoopResult state={state} /> : <ul>{Object.entries(state.breakdown || {}).map(([playerId, item]) => <li key={playerId}><span>{state.members.find(player => player.id === playerId)?.name}</span><b>+{number(item.points ?? 0)}</b></li>)}</ul>}</>}<p className="ers-small">الدور التالي يبدأ تلقائيًا…</p></Card>}
      </div><details data-design-id="aside" className="ers-play-aside"><summary>الأصدقاء والتخمينات <span>{number((state.guessedIds || []).length)} عرفها · {number(state.participants?.length || 0)} لاعبين</span></summary><div className="ers-aside-content"><Players state={{ ...state, mode: cooperative ? 'cooperative' : 'competitive' }} me={me} /><section data-design-id="guesses" className="ers-guesses" aria-label="تخمينات الأصدقاء" aria-live="polite" aria-relevant="additions"><h2>لمعات الأصحاب</h2>{!(state.recentGuesses || []).length && <p>أول تخمين يبدأ الحكاية…</p>}<ol>{(state.recentGuesses || []).slice(-12).map(guess => <li key={guess.id} className={guess.correct ? 'is-correct' : ''}><b>{state.members.find(player => player.id === guess.playerId)?.name || 'لاعب'}</b><span>{guess.correct ? 'عرفها! ✓' : guess.text}</span></li>)}</ol></section></div></details></div>
    </>}
    {paused && <p className="ers-pause" role="status">ننتظر عودة الرسّام حتى {number(seconds)} ثانية. وقت الرسم متوقف.</p>}
    {showReport && reportTargetRef.current?.roundKey === `${state.matchId}:${state.round}` && <Report onClose={() => setShowReport(false)} onReport={reportTargetRef.current.submit} />}
  </div>;
}
function CoopResult({ state }) {
  const result = state.coop || state.cooperative || state.team || {};
  return <div data-design-id="cooperative-result" className="ers-coop-result"><span><b>{number(result.solvedTurns ?? result.solved ?? result.solvedCount ?? 0)}</b>لوحات محلولة</span><span><b>{number(Math.floor((result.remainingMs ?? result.timeRemainingMs ?? 0) / 1000))}</b>ثانية وفّرتوها</span></div>;
}

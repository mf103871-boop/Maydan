import { useSavedMatch } from '../../shared/ui/useSavedMatch.js';
import { tr } from '../../shared/i18n/core.js';
import { Avatar } from '../../shared/brand/art.jsx';
import React, { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Screen, Button, Segment, Card } from '../../shared/ui/components.jsx';
import { ResumeCountdown, useTimer, useTimerCues } from '../../shared/ui/index.js';
import { stampScreen, vignette, wait } from '../../shared/fx/index.js';
import { trimSeen } from '../../shared/lib/noRepeat.js';
import { mulberry32, randomSeed } from '../../shared/lib/rng.js';
import { getGameContent } from '../../data/game-content.js';
import { PresentationStyles } from '../../shared/ui/PresentationStyles.jsx';
import css from './jabeen.css?sheet';
import { initialState, reduce, currentEntrant, standings, createItemSource, normalizeOptions, restoreSession, sessionSnapshot, SECONDS } from './logic.js';
import { loadSession, SESSION_KEY } from '../../shared/lib/session.js';
import { useSessionSave } from '../../shared/ui/useSessionSave.js';
import { useGameMusicScene } from '../../shared/fx/useGameMusicScene.js';
import { useTilt } from './useTilt.js';
import { IconCheck, IconClock, IconPlay, IconRotate, IconSkip } from '../../shared/ui/icons.jsx';
import { getPlayfulSceneArt } from '../../shared/brand/playful-scenes.js';
import { PartyPodium, PartyStyles } from '../beep/StudioParty.jsx';
import actingArt from './illustrations/acting.webp';
import foodArt from './illustrations/food.webp';
import homeArt from './illustrations/home.webp';
import jobsArt from './illustrations/jobs.webp';
import proverbsArt from './illustrations/proverbs.webp';
import phoneGuideArt from './illustrations/guide.webp';
import turnArt from './illustrations/marker.webp';

const OPTIONS_KEY = 'options';
const SEEN_KEY = 'seen';
const CATEGORY_SCENES = {
  animals: 'category-animals', figures: 'category-history', places: 'category-geo',
};
const CATEGORY_ART = { acting: actingArt, food: foodArt, home: homeArt, jobs: jobsArt, proverbs: proverbsArt };
const CATEGORY_DISPLAY_ORDER = ['animals', 'acting', 'food', 'figures', 'jobs', 'home', 'proverbs', 'places'];

const readMatch = (slot, locale) => loadSession(slot, raw => restoreSession(raw, getGameContent('jabeen', locale)));

export function SetupOptions({ storage, api }) {
  const categories = useMemo(() => getGameContent('jabeen', api.contentLocale, api.contentVersion), [api.contentLocale, api.contentVersion]);
  const [opts, setOpts] = useState(() => normalizeOptions(storage.get(OPTIONS_KEY), categories));
  const resume = useSavedMatch('jabeen', storage, api.contentLocale, SESSION_KEY, readMatch);
  const update = (patch) => { const next = normalizeOptions({ ...opts, ...patch }, categories); setOpts(next); storage.set(OPTIONS_KEY, next); };
  return (
    <div data-design-screen="setup.jabeen" data-design-id="options" className="stack jabeen-setup party-setup">
    <PartyStyles />
    <PresentationStyles sheet={css} />
    {resume && <Card className="stack resume-card">
      <span className="card-title">{tr("لعبتكم بانتظاركم")}</span>
      <p className="card-muted">{tr("فئة «")}{resume.state.categoryName}{tr("» · دور ")}{currentEntrant(resume.state)?.name} ({resume.state.turn + 1}{tr(" من ")}{resume.state.entrants.length})</p>
      <Button data-design-id="resume" data-design-required="true" variant="accent" full onClick={() => api.resumeGame(resume)}>{tr("استئناف اللعبة المحفوظة")}</Button>
      <p className="card-muted">{tr("بدء لعبة جديدة يستبدل هذا التقدم.")}</p>
    </Card>}
    <div className="stack">
      <div className="party-setting"><span>{tr("طريقة التحكم")}</span>
        <Segment accent label={tr("طريقة التحكم")} value={opts.control} onChange={control => update({ control })} options={[{ value: 'auto', label: tr("الإمالة واللمس") }, { value: 'touch', label: tr("اللمس") }]} />
      </div>
      <div className="party-setting"><span>{tr("الفئة")}</span>
      <div className="jabeen-cats">
        {[...categories].sort((first, second) => CATEGORY_DISPLAY_ORDER.indexOf(first.id) - CATEGORY_DISPLAY_ORDER.indexOf(second.id)).map((c) => {
          const artwork = CATEGORY_ART[c.id] || getPlayfulSceneArt(CATEGORY_SCENES[c.id] || '', 48);
          return (
          <button data-design-id="category-card" key={c.id} type="button" className={`jabeen-cat ${opts.categoryId === c.id ? 'selected' : ''}`} aria-pressed={opts.categoryId === c.id} onClick={() => update({ categoryId: c.id })}>
            {artwork && <img src={artwork} alt="" width="48" height="48" loading="lazy" decoding="async" />}
            <span>{c.name}</span>{opts.categoryId === c.id && <IconCheck />}
          </button>
        );})}
      </div>
      </div>
      <div className="party-setting"><span>{tr("مدة الجولة")}</span>
        <Segment data-design-id="setting-duration" accent label={tr("المدة")} value={opts.seconds} onChange={(v) => update({ seconds: v })} options={SECONDS.map((s) => ({ value: s, label: tr("{v0} ثانية", {v0: s}) }))} />
      </div>
    </div>
    </div>
  );
}

function PhoneGuide({ rotation = false }) {
  if (!rotation) return <img className="jabeen-phone-guide" src={phoneGuideArt} width="600" height="364" decoding="async" alt="" />;
  return <svg className="jabeen-phone-guide" viewBox="0 0 180 112" aria-hidden="true" fill="none" strokeLinecap="round" strokeLinejoin="round">
    <path d="M30 57c3-16 12-29 27-35m-13-4 14 4-6 13M150 58c-3 16-12 29-27 35m13 4-14-4 6-13" stroke="#087f87" strokeWidth="4" />
    <rect x="56" y="35" width="68" height="42" rx="6" fill="#e9d5ec" stroke="#4f2c63" strokeWidth="4" />
    <path d="M66 51v10m48-10v10" stroke="#94709f" strokeWidth="3" />
    <path d="m29 72 8 2m-6 8 8-4m105-51 8-3m-8 10 9 1" stroke="#d9912d" strokeWidth="4" />
  </svg>;
}

function Stage({ state, timer, tilt, onAnswer, onEnd, flash, blocked }) {
  const tiltLive = state.control === 'auto' && tilt.supported;
  const tiltLost = state.control === 'auto' && !tilt.supported;
  const danger = timer.left <= 10;
  const okCount = state.results.filter((r) => r.ok).length;
  // التظليل الأحمر في آخر 3 ثوانٍ: عنصر ثابت في body (fx.vignette) يُطفأ عند إزالة المسرح.
  useEffect(() => { vignette(!blocked && timer.running && timer.left > 0 && timer.left <= 3); return () => vignette(false); }, [blocked, timer.left, timer.running]);
  if (blocked) return null;
  return (
    <div data-design-id="content" className={`jabeen-stage ${flash}`} role="group" aria-label={tr("جولة على جبينك")}>
      <div data-design-id="header" className="jabeen-stage-top">
        {/* في ثواني الخطر يُعاد تركيب الرقم كل ثانية (key) فيُلكم ثم ينبض */}
        <span data-design-id="timer" className={`num ${danger ? 'is-danger' : ''}`} role="timer" aria-label={tr("{v0} ثانية متبقية", {v0: timer.left})}><IconClock /><bdi>{timer.left}</bdi><small>{tr("ث")}</small></span>
        <span className="jabeen-active-player"><Avatar player={currentEntrant(state)} /><b dir="auto">{currentEntrant(state).name}</b><span className="count" key={`c${okCount}`}><IconCheck /> {okCount}</span></span>
        <Button size="sm" variant="ghost" className="jabeen-finish" data-design-id="continue" data-design-required="true" onClick={onEnd}>{tr("إنهاء")}</Button>
      </div>
      <div data-design-id="word" className="jabeen-word party-sparks"><span key={state.item ? state.item.id : 'none'}>{state.item ? state.item.text : '…'}</span></div>
      <div data-design-id="controls" className="jabeen-controls">
        {tiltLive && <p className="jabeen-hint">{tilt.calibrated ? tr("أَمِل للأسفل = صح · للأعلى = تخطي — أو استخدم الزرين.") : tr("ثبّت الجوال على جبينك لحظة… تُعاير الحركة.")}</p>}
        {tiltLost && <Button data-design-id="tilt-retry" size="sm" variant="ghost" onClick={() => { tilt.retry(); }}>{tr("إعادة تفعيل الميلان")}</Button>}
        <div className="jabeen-touch">
          <button type="button" data-design-id="correct" className="ok" onClick={() => onAnswer(true)}><IconCheck />{tr(" صح")}</button>
          <button type="button" data-design-id="skip" className="skip" onClick={() => onAnswer(false)}><IconSkip />{tr(" تخطي")}</button>
        </div>
      </div>
    </div>
  );
}

export function Game({ api, players, onExit, savedSession = null, designPreviewState = null }) {
  const categories = useMemo(() => getGameContent('jabeen', api.contentLocale, api.contentVersion), [api.contentLocale, api.contentVersion]);
  // لقطة محفوظة صالحة تعيد الحالة والمصدر بنفس البذرة والموضع؛ وإلا مباراة جديدة.
  const saved = useMemo(() => restoreSession(savedSession, categories), [savedSession, categories]);
  const seed = useRef(saved ? saved.seed : randomSeed());
  const random = useMemo(() => mulberry32(seed.current), []);
  const options = useMemo(() => normalizeOptions(saved ? saved.settings : api.storage.get(OPTIONS_KEY), categories), [api.storage, saved, categories]);
  const category = useMemo(() => categories.find((c) => c.id === options.categoryId) || categories[0], [options.categoryId, categories]);
  const source = useMemo(() => {
    const itemSource = createItemSource(category, { random, seen: api.storage.get(SEEN_KEY, {}) || {} });
    if (saved) itemSource.seek(saved.cursor, { cycles: saved.cycle ?? 0 });
    return itemSource;
  }, [category, random, api.storage, saved]);
  const [state, dispatch] = useReducer(reduce, undefined, () => (designPreviewState || (saved ? saved.state : initialState(players, category, options))));
  useGameMusicScene(api.sound, 'jabeen', state.phase);
  const profileSession = useRef(saved ? saved.profileSession || null : api.matchSnapshot?.() || null);
  const timeLeftRef = useRef(saved?.timeLeft ?? null);
  const resumeLeft = useRef(saved?.timeLeft ?? null);
  useSessionSave({
    api, state, active: state.phase !== 'over', phaseKey: `${state.phase}:${state.turn}`,
    snapshot: (current) => sessionSnapshot({ players: current.entrants, settings: options, seed: seed.current, cursor: source.cursor, cycle: source.cycle,
      timeLeft: current.phase === 'play' ? timeLeftRef.current : null, profileSession: profileSession.current, state: current }),
  });
  const [landscape, setLandscape] = useState(() => typeof window === 'undefined' || window.innerWidth >= window.innerHeight || window.innerWidth >= 700);
  const [flash, setFlash] = useState('');
  const flashTimer = useRef(null);
  const timer = useTimer({ frozen: !!api.designPreview, seconds: state.seconds, onEnd: () => { api.sound.play('buzzer'); api.haptics.vibrate('warning'); dispatch({ type: 'TIME_UP' }); } });
  // آخر خمس ثوانٍ تُسمع (tick ثم tickFast) وتهتز، وعدّ 3-2-1 عند العودة من الإخفاء أو من وضع الجوال عموديًا.
  useTimerCues(timer, api, { warningKey: JSON.stringify(['jabeen', state.turn]) });

  // الفئة الواحدة لا تكفي عشرة لاعبين؛ عند نفادها نعيد خلطها بدل إنهاء المباراة.
  const exhausted = source.remaining === 0;
  const drawForTurn = () => {
    let item = source.next();
    let recycled = false;
    if (!item) { source.reset({ reshuffle: true }); recycled = true; item = source.next(); }
    return { item, recycled };
  };

  const answer = (ok) => {
    if (!landscape || !timer.running) return;
    api.sound.emit?.(ok ? 'game.correct' : 'game.pass');
    api.haptics.vibrate(ok ? 'success' : 'light');
    setFlash(ok ? 'is-good' : 'is-skip');
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(''), wait(420));
    stampScreen(ok ? { text: '✓', tone: 'good', ms: 420 } : { text: '⏭', tone: 'bad', ms: 420 });
    // نفاد الفئة في منتصف الدور يعيد خلطها كما في بداية الدور، لا ينهي دور اللاعب مبكرًا.
    const next = drawForTurn();
    dispatch({ type: 'ANSWER', ok, item: next.item, recycled: next.recycled });
  };

  // نسخة واحدة من مستشعر الميلان: الإذن والقراءة في المكان نفسه.
  const tilt = useTilt({ enabled: state.control === 'auto' && state.phase === 'play' && landscape && timer.running, onDecision: (d) => answer(d === 'correct') });

  useEffect(() => { api.setInGame(state.phase !== 'over'); }, [state.phase, api]);
  useEffect(() => () => clearTimeout(flashTimer.current), []);
  useEffect(() => {
    const check = () => setLandscape(window.innerWidth >= window.innerHeight || window.innerWidth >= 700);
    check();
    window.addEventListener('resize', check);
    window.addEventListener('orientationchange', check);
    return () => { window.removeEventListener('resize', check); window.removeEventListener('orientationchange', check); };
  }, []);
  // Reset once per turn. Rotation only pauses/resumes the remaining time. A resumed turn
  // starts from the saved remaining time, once.
  useEffect(() => { if (state.phase === 'play') { timer.reset(resumeLeft.current ?? state.seconds); resumeLeft.current = null; if (landscape && !document.hidden) timer.start(); } else timer.pause(); }, [state.phase]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { timeLeftRef.current = timer.left; }, [timer.left]);
  // الجوال عموديًا يوقف الوقت؛ إعادته أفقيًا تستأنف بعدّ 3-2-1 (لا انطلاقة مباغتة)، وأول دخول يبدأ العدّ.
  useEffect(() => {
    if (state.phase !== 'play') return;
    if (!landscape) { timer.pause(); return; }
    if (document.hidden || timer.running || timer.resuming !== null) return;
    if (timer.paused) timer.resume(); else timer.start();
  }, [landscape]); // eslint-disable-line react-hooks/exhaustive-deps
  // A browser visibility resume must not restart behind the rotate prompt.
  const { running: timerRunning, pause: pauseTimer } = timer;
  useEffect(() => { if (!landscape && timerRunning) pauseTimer(); }, [landscape, timerRunning, pauseTimer]);
  useEffect(() => {
    if (state.phase !== 'over') return;
    api.storage.set(SEEN_KEY, trimSeen(source.seen(), 1200));
    // The platform owns the single completed-match sound.
    if (state.completed === true) { api.haptics.vibrate('win'); api.confetti.fire(); }
    api.matchOver?.({ completed: state.completed === true });
  }, [state.phase]); // eslint-disable-line react-hooks/exhaustive-deps

  const entrant = state.phase === 'over' ? null : currentEntrant(state);
  const finalTurn = state.turn === state.entrants.length - 1;

  return (
    <Screen data-design-screen={`jabeen.${state.phase}`} className="jabeen party-studio" aria-label={tr("على جبينك")}>
      <PartyStyles />
      <PresentationStyles sheet={css} />
      {state.phase === 'intro' && (
        <div data-design-id="intro" className="jabeen-intro">
          <div className="jabeen-player-header"><Avatar player={entrant} /><div><img className="jabeen-player-marker" src={turnArt} width="72" height="72" alt="" /><h2 className="party-heading">{tr(" دور ")}<bdi>{entrant.name}</bdi></h2></div></div>
          <p className="jabeen-category-pill">{tr("فئة «")}{state.categoryName}» · {state.seconds}{tr(" ثانية")}</p>
          <div className="jabeen-instruction"><strong>{tr("ضع الجوال على جبينك والشاشة نحو الآخرين")}</strong><PhoneGuide /><p className="party-ribbon">{tr("هم يصفون وأنت تخمّن. يمكنك استخدام الحركة أو أزرار اللمس.")}</p></div>
          {state.control === 'auto' && tilt.needsPermission && <p className="jabeen-perm">{tr("قد يطلب جهازك إذن استخدام مستشعر الحركة عند البدء. إن رفضت، يمكنك اللعب باللمس.")}</p>}
          {exhausted && <p className="jabeen-perm">{tr("انتهت كلمات «")}{state.categoryName}{tr("» — سنعيد خلطها من جديد ليكمل كل لاعب دوره.")}</p>}
          {!landscape && <p className="jabeen-perm" role="status">{tr("أدر الجوال أفقيًا قبل البدء، أو تابع بهذا الاتجاه. الوقت لم يبدأ بعد.")}</p>}
          <Button data-design-id="start" data-design-required="true" variant="accent" size="lg" full onClick={async () => { if (!landscape) { setLandscape(true); return; } if (state.control === 'auto') await tilt.request(); tilt.recalibrate(); api.sound.play('whoosh'); const draw = drawForTurn(); dispatch({ type: 'BEGIN', item: draw.item, recycled: draw.recycled }); }}><IconPlay /> {landscape ? tr("ابدأ الجولة") : tr("متابعة بهذا الاتجاه")}</Button>
        </div>
      )}
      {state.phase === 'play' && (
        <>
          {!landscape && <div data-design-id="rotate" data-design-required="true" className="jabeen-rotate"><div className="jabeen-rotate-panel"><PhoneGuide rotation /><h2>{tr("أدر الجوال أفقيًا")}</h2><p className="muted">{tr("الوقت متوقف. يمكنك أيضًا متابعة اللعب بأزرار اللمس.")}</p><Button data-design-id="continue" data-design-required="true" variant="accent" full onClick={() => setLandscape(true)}><IconRotate />{tr(" متابعة بهذا الاتجاه")}</Button></div></div>}
          <Stage state={state} timer={timer} tilt={tilt} flash={flash} blocked={!landscape} onAnswer={answer} onEnd={() => { timer.pause(); dispatch({ type: 'TIME_UP' }); }} />
          <ResumeCountdown resuming={timer.resuming} />
        </>
      )}
      {state.phase === 'review' && (
        <div className="stack">
          <div className="jabeen-player-header jabeen-review-header"><Avatar player={entrant} /><h2 className="party-heading">{tr(" نتيجة ")}<bdi>{entrant.name}</bdi></h2></div>
          <p className="jabeen-category-pill">{state.results.filter((r) => r.ok).length}{tr(" من ")}{state.results.length}{tr(" — المس أي كلمة لتصحيحها.")}</p>
          <div data-design-id="results" className="jabeen-review">
            {state.results.map((r, i) => (
              <button data-design-id="option" key={`${r.itemId}-${i}`} type="button" className={r.ok ? 'ok' : ''} aria-pressed={r.ok} onClick={() => dispatch({ type: 'TOGGLE_RESULT', index: i })}>
                <span className="mark" aria-hidden="true" key={String(r.ok)}>{r.ok ? '✓' : '—'}</span><span className="grow">{r.text}</span>
              </button>
            ))}
            {state.results.length === 0 && <p className="muted center">{tr("لم تُعرض كلمات في هذه الجولة.")}</p>}
          </div>
          {state.recycled && <p className="center muted">{tr("أُعيد خلط كلمات «")}{state.categoryName}{tr("» بعد نفادها، فقد تتكرر كلمة مع لاعب سابق.")}</p>}
          <Button data-design-id="continue" data-design-required="true" variant="accent" size="lg" full onClick={() => {
            api.sound.play('pop');
            if (!finalTurn) {
              const points = state.results.filter(result => result.ok).length;
              api.toast?.(tr("+{v0} لـ {v1}", {v0: points, v1: entrant.name}), {kind: 'success'});
            }
            dispatch({type: 'CONFIRM'});
          }}>{finalTurn ? tr("النتائج النهائية") : tr("اللاعب التالي")}</Button>
        </div>
      )}
      {state.phase === 'over' && (
        <div className="stack">
          <h2 className="party-heading">{tr("النتائج")}</h2>
          <PartyPodium entries={standings(state)} />
          <Button data-design-id="restart" variant="accent" size="lg" full onClick={() => { api.sound.play('whoosh'); api.restart(); }}>{tr("العب مرة أخرى")}</Button>
          <Button variant="secondary" full data-design-id="options" onClick={api.backToSetup}>{tr("تغيير اللاعبين أو الفئة")}</Button>
          <Button variant="ghost" full data-design-id="exit" data-design-required="true" onClick={onExit}>{tr("العودة للمنصة")}</Button>
        </div>
      )}
    </Screen>
  );
}

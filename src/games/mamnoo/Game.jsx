import { SetupPresets } from '../../plus/SetupPresets.jsx';
import { Avatar, GameArtwork } from '../../shared/brand/art.jsx';
import React, { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Screen, Button, Podium, Segment, Card, Scoreboard } from '../../shared/ui/components.jsx';
import { Timer, useTimer, useTimerCues } from '../../shared/ui/index.js';
import { flashScreen, stampScreen, wait } from '../../shared/fx/index.js';
import { trimSeen } from '../../shared/lib/noRepeat.js';
import { mulberry32, randomSeed } from '../../shared/lib/rng.js';
import cards from '../../data/games/mamnoo/cards.json';
import css from './mamnoo.css';
import { initialState, reduce, currentTeam, opponentLabel, standings, createCardSource, normalizeOptions, restoreSession, sessionSnapshot, SECONDS, ROUNDS, MAX_SKIPS } from './logic.js';
import { loadSession } from '../../shared/lib/session.js';
import { useSessionSave } from '../../shared/ui/useSessionSave.js';

const OPTIONS_KEY = 'options';
const SEEN_KEY = 'seen';

export function SetupOptions({ storage, api }) {
  const [opts, setOpts] = useState(() => normalizeOptions(storage.get(OPTIONS_KEY)));
  const [resume] = useState(() => loadSession(storage, restoreSession));
  const update = (patch) => { const next = normalizeOptions({ ...opts, ...patch }); setOpts(next); storage.set(OPTIONS_KEY, next); };
  return (
    <div data-design-screen="setup.mamnoo" data-design-id="options" className="stack">
    {!api.designPreview && <SetupPresets game="mamnoo" settings={opts} onApply={update} />}
    {resume && <Card className="stack resume-card">
      <span className="card-title">لعبتكم بانتظاركم</span>
      <p className="card-muted">الجولة {resume.state.round} من {resume.state.rounds} · {resume.teams.map((t) => t.name).join(' و')}</p>
      <Button data-design-id="resume" data-design-required="true" variant="accent" full onClick={() => api.resumeGame(resume)}>استئناف اللعبة المحفوظة</Button>
      <p className="card-muted">بدء لعبة جديدة يستبدل هذا التقدم.</p>
    </Card>}
    <Card className="stack">
      <span className="card-title">إعدادات الجولة</span>
      <div className="field"><span>مدة الجولة</span>
        <Segment data-design-id="setting-duration" accent label="المدة" value={opts.seconds} onChange={(v) => update({ seconds: v })} options={SECONDS.map((s) => ({ value: s, label: `${s} ث` }))} />
      </div>
      <div className="field"><span>جولات لكل فريق</span>
        <Segment data-design-id="setting-rounds" accent label="الجولات" value={opts.rounds} onChange={(v) => update({ rounds: v })} options={ROUNDS.map((r) => ({ value: r, label: `${r} جولات` }))} />
      </div>
    </Card>
    </div>
  );
}

function Round({ state, dispatch, api, source, timeLeftRef, resumeLeft }) {
  const team = currentTeam(state);
  const [flash, setFlash] = useState('');
  const timer = useTimer({ frozen: !!api.designPreview, seconds: state.seconds, onEnd: () => { api.sound.play('buzzer'); api.haptics.vibrate('warning'); dispatch({ type: 'TIME_UP' }); } });
  // كل دور يبدأ بمؤقت جديد: نصفّره صراحةً ثم نشغّله، فلا نعتمد على مساواة هشّة مع قيمة سابقة.
  // جولة مستأنفة تبدأ من الوقت المحفوظ مرة واحدة.
  useEffect(() => { if (state.phase === 'play') { timer.reset(resumeLeft.current ?? state.seconds); resumeLeft.current = null; timer.start(); } else if (timer.running) timer.pause(); }, [state.phase, state.round, state.turn]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { timeLeftRef.current = timer.left; }, [timer.left, timeLeftRef]);
  // آخر خمس ثوانٍ: tick ثم tickFast في الأخيرتَين، واهتزاز في آخر ثلاث؛ 3-2-1 عند الاستئناف.
  useTimerCues(timer, api);
  // الإرسال فوري؛ صنف الوميض يقع على البطاقة (لا على .stack الحاوي للمؤقت)، والختم/الوميض طبقات ثابتة في body.
  const act = (type, sound, haptic, cls) => {
    api.sound.play(sound); api.haptics.vibrate(haptic);
    setFlash(cls); setTimeout(() => setFlash(''), wait(500));
    if (type === 'CORRECT') { flashScreen('good'); stampScreen({ text: 'صح!', tone: 'good', points: '+١' }); }
    if (type === 'BUZZ') { flashScreen('bad'); stampScreen({ text: 'ممنوع!', tone: 'bad' }); }
    dispatch({ type, card: source.next() });
  };
  // في نهاية الجولة يُمرَّر فرق الجولة (+N يطير في لوحة النتائج) للفريق الذي لعب
  const roundDelta = state.phase === 'roundEnd' ? Math.max(0, state.tally.correct - state.tally.buzz) : 0;
  const entries = state.teams.map((t) => ({ ...t, score: state.scores[t.id], delta: t.id === team.id && roundDelta > 0 ? roundDelta : 0 }));

  if (state.phase === 'intro') {
    return (
      <div data-design-id="intro" className="mamnoo-intro">
        <p className="muted">الجولة {state.round} من {state.rounds}</p>
        <h2 style={{ color: team.color }}>دور {team.name}</h2>
        <div className="who" style={{ '--team': team.color }}>
          <span>🗣 لاعب من <b style={{ color: 'var(--text)' }}>{team.name}</b> يصف، وبقية فريقه يخمّنون دون رؤية الشاشة.</span>
          <span>👀 لاعب من <b style={{ color: 'var(--text)' }}>{opponentLabel(state)}</b> يراقب الشاشة ويضغط «ممنوع!» عند المخالفة.</span>
        </div>
        <Button data-design-id="start" data-design-required="true" variant="accent" size="lg" full onClick={() => { api.sound.play('whoosh'); dispatch({ type: 'BEGIN', card: source.next() }); }}>ابدأ {state.seconds} ثانية</Button>
        <Scoreboard data-design-id="scoreboard" entries={entries} />
      </div>
    );
  }
  if (state.phase === 'play' && state.card) {
    return (
      <div className="stack">
        <div data-design-id="header" className="mamnoo-head">
          <Timer data-design-id="timer" timer={timer} size={92} accent="#FF5C8A" />
          <div className="grow"><b style={{ color: team.color }}>{team.name}</b><small>صح {state.tally.correct} · ممنوع {state.tally.buzz} · تخطي {state.tally.skip}</small></div>
          <span className="badge"><b key={state.scores[team.id]}>{state.scores[team.id]}</b></span>
        </div>
        <div className={`mamnoo-judge ${flash}`}>
        <div data-design-id="question" className="mamnoo-card" key={state.card.id}>
          <div data-design-id="word" className="mamnoo-word">{state.card.word}</div>
          <div data-design-id="category" className="mamnoo-cat">{state.card.category}</div>
          <div data-design-id="options-list" className="mamnoo-forbidden" aria-label="الكلمات الممنوعة">{state.card.forbidden.map((w) => <span key={w}>{w}</span>)}</div>
        </div>
        </div>
        <div data-design-id="actions" className="mamnoo-buttons">
          <Button data-design-id="correct" variant="success" onClick={() => act('CORRECT', 'correct', 'success', 'flash-good')}>✅ صح +1</Button>
          <Button data-design-id="skip" variant="secondary" disabled={state.skipsLeft <= 0} onClick={() => act('SKIP', 'pass', 'light', '')}>⏭ تخطي ({state.skipsLeft})</Button>
          <Button data-design-id="wrong" className="mamnoo-buzz" onClick={() => act('BUZZ', 'buzzer', 'error', 'shake')}>🚫 ممنوع! −1</Button>
        </div>
      </div>
    );
  }
  if (state.phase === 'roundEnd') {
    return (
      <div data-design-id="intro" className="mamnoo-intro">
        <div className="big-emoji clay-stage clay-idle" aria-hidden="true"><span className="clay-lift"><GameArtwork game="mamnoo" /></span></div>
        <h2>انتهت جولة {team.name}</h2>
        <div data-design-id="results" className="mamnoo-tally"><span>✅ {state.tally.correct}</span><span>🚫 {state.tally.buzz}</span><span>⏭ {state.tally.skip}</span></div>
        <Scoreboard data-design-id="scoreboard" entries={entries} />
        <Button data-design-id="continue" data-design-required="true" variant="accent" size="lg" full onClick={() => { api.sound.play('whoosh'); dispatch({ type: 'NEXT' }); }}>{state.turn === state.teams.length - 1 && state.round >= state.rounds ? 'النتائج النهائية' : 'الفريق التالي'}</Button>
      </div>
    );
  }
  return null;
}

export function Game({ api, teams, onExit, savedSession = null, designPreviewState = null }) {
  // لقطة محفوظة صالحة تعيد الحالة والمصدر بنفس البذرة والموضع؛ وإلا مباراة جديدة.
  const saved = useMemo(() => restoreSession(savedSession), [savedSession]);
  const seed = useRef(saved ? saved.seed : randomSeed());
  const random = useMemo(() => mulberry32(seed.current), []);
  const options = useMemo(() => normalizeOptions(saved ? saved.settings : api.storage.get(OPTIONS_KEY)), [api.storage, saved]);
  const source = useMemo(() => {
    const cardsSource = createCardSource(cards, { random, seen: api.storage.get(SEEN_KEY, {}) || {} });
    if (saved) cardsSource.seek(saved.cursor);
    return cardsSource;
  }, [random, api.storage, saved]);
  const [state, dispatch] = useReducer(reduce, undefined, () => (designPreviewState || (saved ? saved.state : initialState(teams, options))));
  const profileSession = useRef(saved ? saved.profileSession || null : api.matchSnapshot?.() || null);
  const timeLeftRef = useRef(saved?.timeLeft ?? null);
  const resumeLeft = useRef(saved?.timeLeft ?? null);
  useSessionSave({
    api, state, active: state.phase !== 'over', phaseKey: `${state.phase}:${state.round}:${state.turn}`,
    snapshot: (current) => sessionSnapshot({ teams: current.teams, settings: options, seed: seed.current, cursor: source.cursor,
      timeLeft: current.phase === 'play' ? timeLeftRef.current : null, profileSession: profileSession.current, state: current }),
  });
  useEffect(() => { api.setInGame(state.phase !== 'over'); }, [state.phase, api]);
  useEffect(() => {
    if (state.phase !== 'over') return;
    api.storage.set(SEEN_KEY, trimSeen(source.seen(), 1500));
    // The platform owns the single completed-match sound.
    if (state.completed === true) { api.haptics.vibrate('win'); api.confetti.fire(); }
    api.matchOver?.({ completed: state.completed === true });
  }, [state.phase]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Screen data-design-screen={`mamnoo.${state.phase}`} className="mamnoo" aria-label="ممنوع">
      <style>{css}</style>
      {state.phase === 'over' ? (
        <div className="stack">
          <Podium data-design-id="podium" entries={standings(state)} />
          <Button data-design-id="restart" variant="accent" size="lg" full onClick={() => { api.sound.play('whoosh'); api.restart(); }}>العب مرة أخرى</Button>
          <Button variant="secondary" full data-design-id="options" onClick={api.backToSetup}>تغيير الفرق أو الإعدادات</Button>
          <Button variant="ghost" full data-design-id="exit" data-design-required="true" onClick={onExit}>العودة للمنصة</Button>
        </div>
      ) : <Round key={`${state.round}-${state.turn}`} state={state} dispatch={dispatch} api={api} source={source} timeLeftRef={timeLeftRef} resumeLeft={resumeLeft} />}
    </Screen>
  );
}

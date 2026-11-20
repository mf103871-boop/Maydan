import { useSavedMatch } from '../../shared/ui/useSavedMatch.js';
import { tr } from '../../shared/i18n/core.js';
import { Avatar } from '../../shared/brand/art.jsx';
import React, { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Screen, Button, Segment, Card } from '../../shared/ui/components.jsx';
import { Timer, useTimer, useTimerCues } from '../../shared/ui/index.js';
import { flashScreen, stampScreen, wait } from '../../shared/fx/index.js';
import { trimSeen } from '../../shared/lib/noRepeat.js';
import { mulberry32, randomSeed } from '../../shared/lib/rng.js';
import { getGameContent } from '../../data/game-content.js';
import { PresentationStyles } from '../../shared/ui/PresentationStyles.jsx';
import css from './mamnoo.css?sheet';
import { initialState, reduce, currentTeam, opponentLabel, standings, createCardSource, normalizeOptions, restoreSession, sessionSnapshot, SECONDS, ROUNDS, MAX_SKIPS } from './logic.js';
import { loadSession, SESSION_KEY } from '../../shared/lib/session.js';
import { useSessionSave } from '../../shared/ui/useSessionSave.js';
import { useGameMusicScene } from '../../shared/fx/useGameMusicScene.js';
import { IconStar } from '../../shared/ui/icons.jsx';
import { PartyPodium, PartyStyles } from '../beep/StudioParty.jsx';
import correctArt from './illustrations/correct.webp';
import skipArt from './illustrations/skip.webp';
import forbiddenArt from './illustrations/forbidden.webp';

const OPTIONS_KEY = 'options';
const SEEN_KEY = 'seen';
const PRESETS = [
  { value: 'classic', label: 'كلاسيكي', seconds: 60, rounds: 3 },
  { value: 'quick', label: 'سريع', seconds: 45, rounds: 2 },
  { value: 'long', label: 'مطوّل', seconds: 90, rounds: 4 },
];

const readMatch = slot => loadSession(slot, restoreSession);

export function SetupOptions({ storage, api }) {
  const [opts, setOpts] = useState(() => normalizeOptions(storage.get(OPTIONS_KEY)));
  const resume = useSavedMatch('mamnoo', storage, api.contentLocale, SESSION_KEY, readMatch);
  const update = (patch) => { const next = normalizeOptions({ ...opts, ...patch }); setOpts(next); storage.set(OPTIONS_KEY, next); };
  const activePreset = PRESETS.find(preset => preset.seconds === opts.seconds && preset.rounds === opts.rounds);
  return (
    <div data-design-screen="setup.mamnoo" data-design-id="options" className="stack mamnoo-setup party-setup">
    <PartyStyles />
    <PresentationStyles sheet={css} />
    {resume && <Card className="stack resume-card">
      <span className="card-title">{tr("لعبتكم بانتظاركم")}</span>
      <p className="card-muted">{tr("الجولة ")}{resume.state.round}{tr(" من ")}{resume.state.rounds} · {resume.teams.map((t) => t.name).join(' و')}</p>
      <Button data-design-id="resume" data-design-required="true" variant="accent" full onClick={() => api.resumeGame(resume)}>{tr("استئناف اللعبة المحفوظة")}</Button>
      <p className="card-muted">{tr("بدء لعبة جديدة يستبدل هذا التقدم.")}</p>
    </Card>}
    <div className="stack">
      <div className="party-setting"><span>{tr("إعدادات سريعة")}</span>
        <Segment accent label={tr("إعدادات سريعة")} options={PRESETS} value={activePreset?.value} onChange={value => {
          const preset = PRESETS.find(option => option.value === value);
          if (preset) update({ seconds: preset.seconds, rounds: preset.rounds });
        }} />
      </div>
      <div className="party-setting"><span>{tr("مدة الجولة")}</span>
        <Segment data-design-id="setting-duration" accent label={tr("المدة")} value={opts.seconds} onChange={(v) => update({ seconds: v })} options={SECONDS.map((s) => ({ value: s, label: tr("{v0} ث", {v0: s}) }))} />
      </div>
      <div className="party-setting"><span>{tr("جولات لكل فريق")}</span>
        <Segment data-design-id="setting-rounds" accent label={tr("الجولات")} value={opts.rounds} onChange={(v) => update({ rounds: v })} options={ROUNDS.map((r) => ({ value: r, label: tr("{v0} جولات", {v0: r}) }))} />
      </div>
    </div>
    </div>
  );
}

const teamPortraitIndex = (teams, team) => teams.findIndex(entry => entry.id === team.id);

function TeamScores({ state, rows = false }) {
  return <div data-design-id="scoreboard" className={`mamnoo-scores ${rows ? 'mamnoo-score-rows' : ''}`}>
    {state.teams.map((team, index) => (
      <div key={team.id} className="mamnoo-score">
        <Avatar index={index} /><div><strong dir="auto">{team.name}</strong><b>{state.scores[team.id]}</b></div>
      </div>
    ))}
  </div>;
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
  useTimerCues(timer, api, { warningKey: JSON.stringify(['mamnoo', state.round, state.turn]) });
  // الإرسال فوري؛ صنف الوميض يقع على البطاقة (لا على .stack الحاوي للمؤقت)، والختم/الوميض طبقات ثابتة في body.
  const act = (type, sound, haptic, cls) => {
    api.sound.play(sound); api.haptics.vibrate(haptic);
    setFlash(cls); setTimeout(() => setFlash(''), wait(500));
    if (type === 'CORRECT') { flashScreen('good'); stampScreen({ text: tr("صح!"), tone: 'good', points: '+١' }); }
    if (type === 'BUZZ') { flashScreen('bad'); stampScreen({ text: tr("ممنوع!"), tone: 'bad' }); }
    dispatch({ type, card: source.next() });
  };
  const roundDelta = state.phase === 'roundEnd' ? state.tally.correct - state.tally.buzz : 0;
  const portrait = teamPortraitIndex(state.teams, team);

  if (state.phase === 'intro') {
    return (
      <div data-design-id="intro" className="mamnoo-intro">
        <div className="mamnoo-meta"><bdi>{team.name}</bdi> · {tr("الجولة {v0} من {v1}", { v0: state.round, v1: state.rounds })} · {tr("{v0} ثانية", { v0: state.seconds })}</div>
        <div className="mamnoo-team-hero party-sparks"><Avatar index={portrait} /></div>
        <h2 className="party-heading is-lavender">{tr("استعداد الفريق")}</h2>
        <div className="who">
          <strong>{tr("اشرح الكلمة دون قول الكلمات الممنوعة")}</strong>
        </div>
        <p className="mamnoo-opponent"><bdi>{team.name}</bdi>{tr(" يخمّن دون رؤية الشاشة. لاعب من ")}<bdi>{opponentLabel(state)}</bdi>{tr(" يراقب المخالفات.")}</p>
        <TeamScores state={state} />
        <Button data-design-id="start" data-design-required="true" variant="accent" size="lg" full onClick={() => { api.sound.play('whoosh'); dispatch({ type: 'BEGIN', card: source.next() }); }}>{tr(" ابدأ ")}{state.seconds}{tr(" ثانية")}</Button>
      </div>
    );
  }
  if (state.phase === 'play' && state.card) {
    return (
      <div className="stack">
        <div data-design-id="header" className="mamnoo-head">
          <div className="mamnoo-active-team">
            <Avatar index={portrait} />
            <div><b dir="auto">{team.name}</b><strong key={state.scores[team.id]}>{state.scores[team.id]}</strong></div>
          </div>
          <Timer data-design-id="timer" timer={timer} size={94} accent="#08796d" />
        </div>
        <div className="mamnoo-live-tally">
          <span>{tr("صح ")}{state.tally.correct}</span>
          <span>{tr("ممنوع")}{' '}{state.tally.buzz}</span>
          <span>{tr("تخطيات مستخدمة")}{' '}{state.tally.skip}</span>
        </div>
        <div className={`mamnoo-judge ${flash}`}>
        <div data-design-id="question" className="mamnoo-card" key={state.card.id}>
          <div data-design-id="category" className="mamnoo-cat">{state.card.category}</div>
          <div data-design-id="word" className="mamnoo-word party-word-rays">{state.card.word}</div>
        </div>
        <section className="mamnoo-forbidden-panel">
          <h3>{tr(" الكلمات الممنوعة")}</h3>
          <ul data-design-id="options-list" className="mamnoo-forbidden">{state.card.forbidden.map((w) => <li key={w}>{w}</li>)}</ul>
        </section>
        </div>
        <div data-design-id="actions" className="mamnoo-buttons">
          <Button data-design-id="correct" variant="success" onClick={() => act('CORRECT', 'correct', 'success', 'flash-good')}><span>{tr("صح")}</span><bdi>+1</bdi></Button>
          <Button data-design-id="skip" variant="secondary" disabled={state.skipsLeft <= 0} onClick={() => act('SKIP', 'pass', 'light', '')}><span>{tr("تخطي")}</span><bdi>({state.skipsLeft})</bdi></Button>
          <Button data-design-id="wrong" className="mamnoo-buzz" onClick={() => act('BUZZ', 'buzzer', 'error', 'shake')}><span>{tr("ممنوع!")}</span><bdi>−1</bdi></Button>
        </div>
      </div>
    );
  }
  if (state.phase === 'roundEnd') {
    return (
      <div data-design-id="intro" className="mamnoo-intro">
        <div className="mamnoo-meta is-lavender"><bdi>{team.name}</bdi> · {tr("الجولة {v0} من {v1}", { v0: state.round, v1: state.rounds })} · {tr("الوقت")} {tr(" متوقف")}</div>
        <h2 className="party-heading">{tr("حصيلة الجولة")}</h2>
        <div data-design-id="results" className="mamnoo-tally">
          <span className="is-correct"><img src={correctArt} alt="" width="64" height="64" />{tr(" صح")}<b>{state.tally.correct}</b></span>
          <span className="is-skip"><img src={skipArt} alt="" width="64" height="64" />{tr(" تخطي")}<b>{state.tally.skip}</b></span>
          <span className="is-forbidden"><img src={forbiddenArt} alt="" width="64" height="64" />{tr(" ممنوع")}<b>{state.tally.buzz}</b></span>
        </div>
        <div className="mamnoo-round-points"><IconStar /><div>{tr(" نقاط الجولة ")}<strong dir="ltr">{roundDelta > 0 ? '+' : ''}{roundDelta}</strong></div></div>
        <h3 className="party-ribbon">{tr("النتيجة بعد الجولة")}</h3>
        <TeamScores state={state} rows />
        <Button data-design-id="continue" data-design-required="true" variant="accent" size="lg" full onClick={() => { api.sound.play('whoosh'); dispatch({ type: 'NEXT' }); }}>{state.turn === state.teams.length - 1 && state.round >= state.rounds ? tr("النتائج النهائية") : tr("الفريق التالي")}</Button>
      </div>
    );
  }
  return null;
}

export function Game({ api, teams, onExit, savedSession = null, designPreviewState = null }) {
  const cards = useMemo(() => getGameContent('mamnoo', api.contentLocale, api.contentVersion), [api.contentLocale, api.contentVersion]);
  // لقطة محفوظة صالحة تعيد الحالة والمصدر بنفس البذرة والموضع؛ وإلا مباراة جديدة.
  const saved = useMemo(() => restoreSession(savedSession), [savedSession]);
  const seed = useRef(saved ? saved.seed : randomSeed());
  const random = useMemo(() => mulberry32(seed.current), []);
  const options = useMemo(() => normalizeOptions(saved ? saved.settings : api.storage.get(OPTIONS_KEY)), [api.storage, saved]);
  const source = useMemo(() => {
    const cardsSource = createCardSource(cards, { random, seen: api.storage.get(SEEN_KEY, {}) || {} });
    if (saved) cardsSource.seek(saved.cursor);
    return cardsSource;
  }, [cards, random, api.storage, saved]);
  const [state, dispatch] = useReducer(reduce, undefined, () => (designPreviewState || (saved ? saved.state : initialState(teams, options))));
  useGameMusicScene(api.sound, 'mamnoo', state.phase);
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
    <Screen data-design-screen={`mamnoo.${state.phase}`} className="mamnoo party-studio" aria-label={tr("ممنوع")}>
      <PartyStyles />
      <PresentationStyles sheet={css} />
      {state.phase === 'over' ? (
        <div className="stack">
          <h2 className="party-heading">{tr("النتائج النهائية")}</h2>
          <PartyPodium entries={standings(state)} teamLabels portraitIndex={entry => teamPortraitIndex(state.teams, entry)} />
          <Button data-design-id="restart" variant="accent" size="lg" full onClick={() => { api.sound.play('whoosh'); api.restart(); }}>{tr("العب مرة أخرى")}</Button>
          <Button variant="secondary" full data-design-id="options" onClick={api.backToSetup}>{tr("تغيير الفرق أو الإعدادات")}</Button>
          <Button variant="ghost" full data-design-id="exit" data-design-required="true" onClick={onExit}>{tr("العودة للمنصة")}</Button>
        </div>
      ) : <Round key={`${state.round}-${state.turn}`} state={state} dispatch={dispatch} api={api} source={source} timeLeftRef={timeLeftRef} resumeLeft={resumeLeft} />}
    </Screen>
  );
}

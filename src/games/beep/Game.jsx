import { useSavedMatch } from '../../shared/ui/useSavedMatch.js';
import { tr } from '../../shared/i18n/core.js';
import { Avatar, GameArtwork } from '../../shared/brand/art.jsx';
// واجهة «قبل ما يطق!» — تعتمد على logic.js للحالة وعلى المكونات المشتركة للمؤقت والنتائج.
import React, { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Screen, Button, Segment, Card } from '../../shared/ui/components.jsx';
import { Timer, ResumeCountdown, useTimer, useTimerCues } from '../../shared/ui/index.js';
import { flashScreen, stampScreen } from '../../shared/fx/index.js';
import { IconCheck, IconClock } from '../../shared/ui/icons.jsx';
import { trimSeen } from '../../shared/lib/noRepeat.js';
import { mulberry32, randomSeed } from '../../shared/lib/rng.js';
import { getGameContent } from '../../data/game-content.js';
import { PresentationStyles } from '../../shared/ui/PresentationStyles.jsx';
import css from './beep.css?sheet';
import { initialState, reduce, currentPlayer, standings, createPromptSource, normalizeOptions, nextBombSeconds, bombPromptArgs, restoreSession, sessionSnapshot, SECONDS, ROUNDS, LIVES } from './logic.js';
import { loadSession, SESSION_KEY } from '../../shared/lib/session.js';
import { useSessionSave } from '../../shared/ui/useSessionSave.js';
import { useGameMusicScene } from '../../shared/fx/useGameMusicScene.js';
import { PartyPodium, PartyStyles } from './StudioParty.jsx';

const OPTIONS_KEY = 'options';
const SEEN_KEY = 'seen';
// نافذة قصيرة يبقى فيها أثر آخر حكم (قفزة/اهتزاز على شاشة التمهيد التالية)
const verdictFresh = (v) => !!v && Date.now() - v.at < 1200;

const readMatch = slot => loadSession(slot, restoreSession);

export function SetupOptions({ storage, api }) {
  const [opts, setOpts] = useState(() => normalizeOptions(storage.get(OPTIONS_KEY)));
  const resume = useSavedMatch('beep', storage, api.contentLocale, SESSION_KEY, readMatch);
  const update = (patch) => { const next = normalizeOptions({ ...opts, ...patch }); setOpts(next); storage.set(OPTIONS_KEY, next); };
  return (
    <div data-design-screen="setup.beep" data-design-id="options" className="stack beep-setup party-setup">
    <PartyStyles />
    <PresentationStyles sheet={css} />
    {resume && <Card className="stack resume-card">
      <span className="card-title">{tr("لعبتكم بانتظاركم")}</span>
      <p className="card-muted">{resume.state.mode === 'three' ? tr("الجولة {v0} من {v1}", {v0: resume.state.round, v1: resume.state.rounds}) : tr("💣 القنبلة · {v0} لاعبين باقين", {v0: resume.state.players.length - resume.state.eliminated.length})} · {resume.players.map((p) => p.name).join('، ')}</p>
      <Button data-design-id="resume" data-design-required="true" variant="accent" full onClick={() => api.resumeGame(resume)}>{tr("استئناف اللعبة المحفوظة")}</Button>
      <p className="card-muted">{tr("بدء لعبة جديدة يستبدل هذا التقدم.")}</p>
    </Card>}
    <div className="stack">
      <div className="party-setting"><span>{tr("نمط اللعبة")}</span>
        <Segment data-design-id="setting-mode" accent label={tr("نمط اللعبة")} value={opts.mode} onChange={(v) => update({ mode: v })} options={[{ value: 'three', label: tr("ثلاثة قبل الصفارة") }, { value: 'bomb', label: tr("💣 القنبلة").replace('💣', '').trim() }]} />
      </div>
      {opts.mode === 'three' && (
        <>
          <div className="party-setting"><span>{tr("مدة الإجابة")}</span>
            <Segment data-design-id="setting-duration" accent label={tr("المدة")} value={opts.seconds} onChange={(v) => update({ seconds: v })} options={SECONDS.map((s) => ({ value: s, label: tr("{v0} ثوانٍ", {v0: s}) }))} />
          </div>
          <div className="party-setting"><span>{tr("عدد الجولات")}</span>
            <Segment data-design-id="setting-rounds" accent label={tr("الجولات")} value={opts.rounds} onChange={(v) => update({ rounds: v })} options={ROUNDS.map((r) => ({ value: r, label: r }))} />
          </div>
        </>
      )}
      {opts.mode === 'bomb' && <p className="beep-setup-help">{tr("مؤقت مخفي بين 20 و60 ثانية. كل لاعب 3 أرواح. آخر من يبقى يفوز.")}</p>}
    </div>
    </div>
  );
}

function ThreeRound({ state, dispatch, api, source, timeLeftRef, resumeLeft }) {
  const player = currentPlayer(state);
  const verdict = useRef(null);
  const timer = useTimer({ frozen: !!api.designPreview, seconds: state.seconds, onEnd: () => { api.sound.play('buzzer'); api.haptics.vibrate('error'); flashScreen('bad'); dispatch({ type: 'FINISH', timedOut: true }); } });
  // طلب مستأنف يبدأ من الوقت المحفوظ مرة واحدة.
  useEffect(() => { if (state.phase === 'prompt') { timer.reset(resumeLeft.current ?? state.seconds); resumeLeft.current = null; timer.start(); } }, [state.phase, state.prompt && state.prompt.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { timeLeftRef.current = timer.left; }, [timer.left, timeLeftRef]);
  // صوت لكل ثانية من الثانية الأولى (tickFast في الأخيرتَين) من مصدر واحد؛ الحلقة بصرية فقط.
  useTimerCues(timer, api, { last: Infinity, fastBelow: 2, warningKey: JSON.stringify(['beep', state.round, state.turn, state.prompt?.id]) });

  if (state.phase === 'intro') {
    return (
      <div data-design-id="intro" className={`beep-intro ${verdictFresh(verdict.current) && !verdict.current.ok ? 'is-after-bad' : ''}`}>
        <h2 className="party-heading">{tr(" استعد")}</h2>
        <div className={`beep-hero party-sparks ${verdictFresh(verdict.current) && verdict.current.ok ? 'is-after-ok' : ''}`} aria-hidden="true"><span className="clay-lift"><Avatar player={player} /></span></div>
        <b className="beep-player-ribbon">{player.name}</b>
        <span className="beep-round-label">{tr("الجولة ")}{state.round}{tr(" من ")}{state.rounds}</span>
        <div className="beep-instruction"><strong>{tr("قل ثلاثة بصوت عالٍ")}</strong><p>{tr("عند الضغط على «جاهز» يظهر الطلب ويبدأ المؤقت.")}</p></div>
        <PlayersStrip state={state} bump={verdictFresh(verdict.current) && verdict.current.ok ? verdict.current.id : null} />
        <Button variant="accent" size="lg" full data-design-id="start" data-design-required="true" onClick={() => { api.sound.play('whoosh'); dispatch({ type: 'BEGIN', prompt: source.next(state.round, state.rounds) }); }}>{tr(" جاهز — ")}{state.seconds}{tr(" ثوانٍ")}</Button>
      </div>
    );
  }
  if (state.phase === 'prompt') {
    return (
      <>
        <div data-design-id="turn" className="beep-turn beep-turn-timed" key={state.turn}>
          <div className="beep-active-player"><Avatar player={player} /><b dir="auto">{player.name}</b></div>
          <Timer data-design-id="timer" timer={timer} size={102} accent="#08796d" label={tr("ثوانٍ")} />
        </div>
        <div data-design-id="prompt" className="beep-prompt is-live" key={state.prompt.id}><small>{state.prompt.category}</small><strong className="party-word-rays">{state.prompt.text}</strong></div>
        <div className="beep-prompt-art party-sparks"><GameArtwork game="beep" /></div>
        <Button data-design-id="continue" data-design-required="true" variant="accent" size="lg" full onClick={() => { timer.pause(); api.sound.play('pop'); dispatch({ type: 'FINISH' }); }}>{tr("خلصت! ✋").replace('✋', '').trim()}</Button>
      </>
    );
  }
  if (state.phase === 'judge') {
    return (
      <>
        <h2 className="party-heading is-lavender">{tr("الحكم")}</h2>
        <div data-design-id="prompt" className={`beep-prompt ${state.timedOut ? 'is-timeout' : ''}`} key={state.prompt.id}><strong>{state.prompt.text}</strong></div>
        <p className={`beep-prompt-status ${state.timedOut ? 'is-timeout' : ''}`}>{state.timedOut ? <IconClock /> : <IconCheck />}{state.timedOut ? tr("⏰ طقّت الصفارة").replace('⏰', '').trim() : tr("أنهى قبل الوقت")}</p>
        <h3 className="beep-judgment">{tr("هل ذكر ")}<bdi>{player.name}</bdi>{tr(" ثلاثة أشياء صحيحة؟")}</h3>
        <div data-design-id="judge" className="beep-judge">
          {/* الحكم يُرسل فورًا؛ الختم طبقة ثابتة فوق شاشة التمهيد التالية، وأثر الحكم (قفزة/نكزة) يُقرأ من verdict هناك */}
          <Button data-design-id="correct" variant="success" onClick={(e) => { api.sound.play('correct'); api.haptics.vibrate('success'); api.confetti.burst({ x: e.clientX, y: e.clientY }); stampScreen({ text: tr("صح!"), tone: 'good', points: '+١' }); verdict.current = { id: player.id, ok: true, at: Date.now() }; dispatch({ type: 'JUDGE', ok: true }); }}>{tr("نعم +1")}</Button>
          <Button data-design-id="wrong" variant="danger" onClick={() => { api.sound.play('wrong'); api.haptics.vibrate('error'); stampScreen({ text: tr("خطأ"), tone: 'bad' }); flashScreen('bad'); verdict.current = { id: player.id, ok: false, at: Date.now() }; dispatch({ type: 'JUDGE', ok: false }); }}>{tr("لا")}</Button>
        </div>
        <PlayersStrip state={state} />
      </>
    );
  }
  return null;
}

function BombRound({ state, dispatch, api, source, random, timeLeftRef, resumeLeft }) {
  const player = currentPlayer(state);
  const explode = () => {
    api.sound.play('explosion'); api.haptics.vibrate('explosion');
    dispatch({ type: 'EXPLODE' });
  };
  const timer = useTimer({ frozen: !!api.designPreview, seconds: state.bombSeconds, onEnd: explode });
  // كل قنبلة جديدة لها مدة عشوائية جديدة: نصفّر المؤقت عليها ثم نشغّله (القنبلة تستمر عبر التمرير لأن الطور يبقى prompt).
  // قنبلة مستأنفة تكمل من الوقت المحفوظ لا من فتيل جديد.
  useEffect(() => { if (state.phase === 'prompt') { timer.reset(resumeLeft.current ?? state.bombSeconds); resumeLeft.current = null; timer.start(); } }, [state.phase, state.round]); // eslint-disable-line react-hooks/exhaustive-deps
  // A constant pulse cannot reveal the hidden fuse through speed or haptics.
  useTimerCues(timer, api, { last: Infinity, fastBelow: -1, hapticBelow: -1 });
  useEffect(() => { timeLeftRef.current = timer.left; }, [timer.left, timeLeftRef]);

  if (state.phase === 'intro') {
    return (
      <div data-design-id="intro" className="beep-intro">
        <h2 className="party-heading is-lavender">{tr("استعداد القنبلة")}</h2>
        <div className="beep-hero beep-hero-bell party-sparks"><GameArtwork game="beep" /></div>
        <div className="beep-rules"><p>{tr(" مؤقت مخفي بين ٢٠ و٦٠ ثانية")}</p><p>{tr(" لكل لاعب ٣ أرواح. آخر من يبقى يفوز")}</p></div>
        <PlayersStrip state={state} />
        <Button variant="accent" size="lg" full data-design-id="start" data-design-required="true" onClick={() => { api.sound.play('whoosh'); dispatch({ type: 'BEGIN', prompt: source.next(...bombPromptArgs(state.history.length)) }); }}>{tr("تشغيل القنبلة")}</Button>
      </div>
    );
  }
  if (state.phase === 'prompt') {
    return (
      <>
        <div data-design-id="turn" className="beep-turn beep-turn-bomb" key={state.turn}>
          <div className="beep-active-player"><Avatar player={player} /><div><b dir="auto">{player.name}</b><Hearts lives={state.lives[player.id]} /></div></div>
          <div data-design-id="bomb" className="beep-bomb party-sparks" aria-hidden="true"><GameArtwork game="beep" /></div>
        </div>
        <ResumeCountdown resuming={timer.resuming} />
        <div data-design-id="prompt" className="beep-prompt is-live" key={state.prompt.id}><strong>{state.prompt.text}</strong><small>{state.prompt.category}</small></div>
        <PlayersStrip state={state} />
        <Button data-design-id="continue" data-design-required="true" variant="accent" size="lg" full onClick={() => { api.sound.play('pass'); api.haptics.vibrate('light'); dispatch({ type: 'PASS', prompt: source.next(...bombPromptArgs(state.history.length)) }); }}>{tr("أجبت — مرّر الجوال")}</Button>
      </>
    );
  }
  if (state.phase === 'boom') {
    const victim = state.players.find((p) => p.id === state.boomPlayerId);
    const livesLeft = state.lives[state.boomPlayerId];
    return (
      <div data-design-id="results" className="beep-boom" role="alert">
        <div className="beep-boom-bell">
          <div className="beep-prompt-art party-sparks"><GameArtwork game="beep" /></div>
          <h2 className="party-heading is-lavender">{tr("انتهت هذه القنبلة")}</h2>
        </div>
        <div className="beep-victim"><Avatar player={victim} /><div><strong dir="auto">{livesLeft > 0 ? tr("خسر {v0} روحًا", {v0: victim.name}) : tr("خرج {v0} من اللعبة", {v0: victim.name})}</strong><Hearts lives={livesLeft} broken={livesLeft} /></div></div>
        <PlayersStrip state={state} />
        <Button data-design-id="continue" data-design-required="true" variant="accent" size="lg" full onClick={() => { api.sound.play('whoosh'); dispatch({ type: 'CONTINUE', bombSeconds: nextBombSeconds(random) }); }}>{tr("قنبلة جديدة")}</Button>
      </div>
    );
  }
  return null;
}

// القلوب بمفتاح لكل خانة: القلب المكسور حديثًا (index === broken) ينبض بـ heart-break، والأقدم يبهت فقط.
function Hearts({ lives, broken = -1 }) {
  return (
    <span data-design-id="lives" className="beep-lives" aria-label={tr("{v0} أرواح", {v0: lives})}>
      {Array.from({ length: LIVES }).map((_, i) => <svg aria-hidden="true" key={i} className={i < lives ? 'is-live' : i === broken ? 'is-broken' : 'is-lost'} viewBox="0 0 24 24"><path d="M12 21S2 15 2 8a5 5 0 0 1 10-1 5 5 0 0 1 10 1c0 7-10 13-10 13Z" /></svg>)}
    </span>
  );
}

function SurvivorLaurel({ mirrored = false }) {
  return <svg className={`beep-laurel${mirrored ? ' is-mirrored' : ''}`} viewBox="0 0 28 48" aria-hidden="true" focusable="false">
    <path className="beep-laurel-stem" d="M24 45C7 35 7 18 12 4" />
    <path d="M12 13C5 10 7 3 12 0C16 6 14 10 12 13ZM10 22C3 21 0 15 2 11C8 13 11 17 10 22ZM12 31C5 32 1 27 1 23C8 23 12 27 12 31ZM17 40C9 43 5 39 4 35C11 33 16 36 17 40ZM10 23C10 15 15 12 20 13C19 19 15 22 10 23ZM13 33C12 26 17 23 22 24C21 30 17 33 13 33ZM20 43C17 36 22 32 27 33C28 38 24 42 20 43Z" />
  </svg>;
}

function PlayersStrip({ state, bump = null }) {
  return (
    <section className="beep-score-panel" aria-label={state.mode === 'three' ? tr("النتيجة الحالية") : tr("حالة اللاعبين")}>
    {state.phase !== 'prompt' && <h3 className="party-ribbon">{state.mode === 'three' ? tr("النتيجة الحالية") : tr("حالة اللاعبين")}</h3>}
    <div data-design-id="players" className={`beep-players ${state.mode === 'bomb' ? 'beep-roster-rows' : ''}`}>
      {state.players.map((p, i) => (
        <span key={p.id} className={`beep-chip ${state.eliminated.includes(p.id) ? 'is-out' : ''} ${state.phase !== 'over' && i === state.turn ? 'is-turn' : ''} ${bump === p.id ? 'is-bumped' : ''}`}>
          <Avatar player={p} /><span className="beep-roster-name"><bdi>{p.name}</bdi>{state.eliminated.includes(p.id) && <small>{tr("خرج")}</small>}</span>
          {state.mode === 'three' ? <b key={state.scores[p.id]}>{state.scores[p.id]}</b> : <Hearts lives={state.lives[p.id]} broken={state.phase === 'boom' && state.boomPlayerId === p.id ? state.lives[p.id] : -1} />}
        </span>
      ))}
    </div>
    </section>
  );
}

export function Game({ api, players, onExit, savedSession = null, designPreviewState = null }) {
  const prompts = useMemo(() => getGameContent('beep', api.contentLocale, api.contentVersion), [api.contentLocale, api.contentVersion]);
  // لقطة محفوظة صالحة تعيد الحالة والمصدر بنفس البذرة والموضع؛ وإلا مباراة جديدة.
  const saved = useMemo(() => restoreSession(savedSession), [savedSession]);
  const seed = useRef(saved ? saved.seed : randomSeed());
  const random = useMemo(() => mulberry32(seed.current), []);
  const options = useMemo(() => normalizeOptions(saved ? saved.settings : api.storage.get(OPTIONS_KEY)), [api.storage, saved]);
  const source = useMemo(() => {
    const promptSource = createPromptSource(prompts, { random, seen: api.storage.get(SEEN_KEY, {}) || {} });
    if (saved) promptSource.seek(saved.cursor);
    return promptSource;
  }, [prompts, random, api.storage, saved]);
  const [state, dispatch] = useReducer(reduce, undefined, () => (designPreviewState || (saved ? saved.state : initialState(players, options, { random }))));
  useGameMusicScene(api.sound, 'beep', state.phase);
  const [session, setSession] = useState(0);
  const profileSession = useRef(saved ? saved.profileSession || null : api.matchSnapshot?.() || null);
  const timeLeftRef = useRef(saved?.timeLeft ?? null);
  const resumeLeft = useRef(saved?.timeLeft ?? null);
  useSessionSave({
    api, state, active: state.phase !== 'over', phaseKey: `${state.phase}:${state.round}:${state.turn}`,
    snapshot: (current) => sessionSnapshot({ players: current.players, settings: options, seed: seed.current, cursor: source.cursor,
      timeLeft: current.phase === 'prompt' ? timeLeftRef.current : null, profileSession: profileSession.current, state: current }),
  });

  useEffect(() => { api.setInGame(state.phase !== 'over'); }, [state.phase, api]);
  useEffect(() => {
    if (state.phase !== 'over') return;
    api.storage.set(SEEN_KEY, trimSeen(source.seen(), 1500));
    // The platform owns the single completed-match sound.
    if (state.completed === true) { api.haptics.vibrate('win'); api.confetti.fire(); }
    api.matchOver?.({ completed: state.completed === true });
  }, [state.phase]); // eslint-disable-line react-hooks/exhaustive-deps

  const restart = () => { api.sound.play('whoosh'); setSession((s) => s + 1); api.restart(); };
  const finalEntries = state.phase === 'over' ? standings(state) : [];
  const bombWinner = state.mode === 'bomb' && finalEntries.filter(entry => entry.alive).length === 1 ? finalEntries[0] : null;

  return (
    <Screen data-design-screen={`beep.${state.mode}.${state.phase}`} className={`beep party-studio beep-${state.mode}-${state.phase}`} aria-label={tr("قبل ما يطق")}>
      <PartyStyles />
      <PresentationStyles sheet={css} />
      {state.phase === 'over' ? (
        <div className="stack">
          <h2 className="party-heading">{bombWinner ? tr("آخر لاعب باقٍ") : tr("النتائج")}</h2>
          {bombWinner ? <div data-design-id="podium" className="beep-bomb-winner">
            <div className="beep-hero"><Avatar player={bombWinner} /><SurvivorLaurel /><SurvivorLaurel mirrored /></div><strong className="beep-player-ribbon" dir="auto">{bombWinner.name}</strong>
          </div> : <PartyPodium entries={finalEntries} showPlaces />}
          {state.mode === 'bomb' && <PlayersStrip state={state} />}
          <div data-design-id="actions" className="beep-actions">
            <Button variant="accent" size="lg" full data-design-id="restart" onClick={restart}>{tr("العب مرة أخرى")}</Button>
            <Button variant="secondary" full data-design-id="options" onClick={api.backToSetup}>{tr("تغيير اللاعبين أو الإعدادات")}</Button>
            <Button variant="secondary" full data-design-id="exit" data-design-required="true" onClick={onExit}>{tr("العودة إلى ميدان")}</Button>
          </div>
        </div>
      ) : state.mode === 'three' ? (
        <ThreeRound key={session} state={state} dispatch={dispatch} api={api} source={source} timeLeftRef={timeLeftRef} resumeLeft={resumeLeft} />
      ) : (
        <BombRound key={session} state={state} dispatch={dispatch} api={api} source={source} random={random} timeLeftRef={timeLeftRef} resumeLeft={resumeLeft} />
      )}
    </Screen>
  );
}

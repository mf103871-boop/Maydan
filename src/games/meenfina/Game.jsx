import { tr, getUiLocale } from '../../shared/i18n/core.js';
import { GameArtwork } from '../../shared/brand/art.jsx';
import React, { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { socialInterruption } from '../../social/interruption.js';
import { Screen, Button, Segment, Card, Scoreboard } from '../../shared/ui/components.jsx';
import { cssAssetUrl } from '../../shared/ui/css-asset-url.js';
import { PassPhoneScreen } from '../../shared/setup/PassPhoneScreen.jsx';
import { trimSeen } from '../../shared/lib/noRepeat.js';
import { mulberry32, randomSeed } from '../../shared/lib/rng.js';
import { getGameContent } from '../../data/game-content.js';
import css from './meenfina.css?sheet';
import choiceCss from './choice-studio.css?sheet';
import lockArt from './meenfina-lock-v1-320.webp';
import { PresentationStyles } from '../../shared/ui/PresentationStyles.jsx';
import { stampScreen, wait } from '../../shared/fx/index.js';
import { initialState, reduce, currentVoter, standings, createStatementSource, normalizeOptions, tallyVotes, statementsLabel, restoreSession, sessionSnapshot, ROUNDS } from './logic.js';
import { loadSession } from '../../shared/lib/session.js';
import { useSessionSave } from '../../shared/ui/useSessionSave.js';
import { useGameMusicScene } from '../../shared/fx/useGameMusicScene.js';
import { ChoicePortrait, MeenChoice, MeenFinal, MeenQuestion, MeenScoreTotals } from './Studio.jsx';

const OPTIONS_KEY = 'options';
const SEEN_KEY = 'seen';

export function SetupOptions({ storage, api }) {
  const [opts, setOpts] = useState(() => normalizeOptions(storage.get(OPTIONS_KEY)));
  const [resume] = useState(() => loadSession(storage, restoreSession));
  const update = (patch) => { const next = normalizeOptions({ ...opts, ...patch }); setOpts(next); storage.set(OPTIONS_KEY, next); };
  return (
    <div data-design-screen="setup.meenfina" data-design-id="options" className="stack meen-setup">
    <PresentationStyles sheet={choiceCss} />
    <PresentationStyles sheet={css} />
    {resume && <Card className="stack resume-card">
      <span className="card-title">{tr("لعبتكم بانتظاركم")}</span>
      <p className="card-muted">{tr("العبارة ")}{resume.state.round}{tr(" من ")}{resume.state.rounds} · {resume.players.map((p) => p.name).join('، ')}</p>
      <Button data-design-id="resume" data-design-required="true" variant="accent" full onClick={() => api.resumeGame(resume)}>{tr("استئناف اللعبة المحفوظة")}</Button>
      <p className="card-muted">{tr("بدء لعبة جديدة يستبدل هذا التقدم.")}</p>
    </Card>}
    <GameArtwork game="meenfina" className="meen-setup-art" />
    <div className="stack meen-setup-options">
      <div className="field"><span>{tr("وضع اللعب")}</span>
        <Segment data-design-id="setting-mode" accent label={tr("وضع اللعب")} value={opts.mode} onChange={(v) => update({ mode: v })} options={[{ value: 'point', label: tr("👉 أشّر!").replace(/^\S+\s/u, '') }, { value: 'secret', label: tr("🤫 تصويت سري").replace(/^\S+\s/u, '') }]} />
      </div>
      <div className="field"><span>{tr("عدد العبارات")}</span>
        <Segment data-design-id="setting-rounds" accent label={tr("الجولات")} value={opts.rounds} onChange={(v) => update({ rounds: v })} options={ROUNDS.map((r) => ({ value: r, label: statementsLabel(r, api.contentLocale) }))} />
      </div>
      <p className="meen-info-note">{opts.mode === 'point' ? tr("أشّر: الجميع يشيرون في اللحظة نفسها.") : tr("سري: نمرّر الجوال ثم نكشف النتائج.")}</p>
    </div>
    </div>
  );
}

// طبقة العدّ تغطي الشاشة، فالعبارة تُرسم داخلها — وإلا أُشير قبل أن تُقرأ.
function Countdown({ api, statement, round, rounds, onDone }) {
  const [n, setN] = useState(3);
  // العدّ يتوقف والصفحة مخفية ويعود من الرقم نفسه؛ وإلا أُشير قبل أن يرى أحد.
  const [hidden, setHidden] = useState(() => typeof document !== 'undefined' && document.hidden);
  useEffect(() => {
    const onVisibility = () => setHidden(document.hidden || socialInterruption.getSnapshot().paused);
    document.addEventListener('visibilitychange', onVisibility);
    const unsubscribe = socialInterruption.subscribe(onVisibility);
    return () => { document.removeEventListener('visibilitychange', onVisibility); unsubscribe(); };
  }, []);
  useEffect(() => {
    if (api.designPreview) return undefined;
    if (hidden) return undefined;
    if (n > 0) { api.sound.play('countdown'); api.haptics.vibrate('light'); }
    else { api.sound.play('countdownGo'); api.haptics.vibrate('medium'); }
    const t = setTimeout(() => (n > 0 ? setN(n - 1) : onDone()), n > 0 ? 900 : 650);
    return () => clearTimeout(t);
  }, [n, hidden]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="meen-count">
      <h2 className="meen-section-title">{tr("استعد")}</h2>
      <p className="meen-round-pill">{tr("العبارة ")}{round}{tr(" من ")}{rounds}</p>
      <MeenQuestion text={statement} />
      <GameArtwork game="meenfina" className="meen-count-art" />
      <div className="meen-count-num" role="status" aria-live="assertive" aria-label={n > 0 ? String(n) : tr("أشّر الآن!")}>
        {n > 0 ? <div className="meen-count-beads" dir="ltr" aria-hidden="true">{[3, 2, 1].map(number => <span key={number} className={n === number ? 'current' : ''}>{number}</span>)}</div> : <div className="go">{tr("أشّر الآن!")}</div>}
      </div>
      <p className="meen-info-note">{tr(" نقرأ أولًا، ثم نشير معًا.")}</p>
    </div>
  );
}

export function Game({ api, players, onExit, savedSession = null, designPreviewState = null }) {
  const statements = useMemo(() => getGameContent('meenfina', api.contentLocale, api.contentVersion), [api.contentLocale, api.contentVersion]);
  // لقطة محفوظة صالحة تعيد الحالة والمصدر بنفس البذرة والموضع؛ وإلا مباراة جديدة.
  const saved = useMemo(() => restoreSession(savedSession), [savedSession]);
  const seed = useRef(saved ? saved.seed : randomSeed());
  const random = useMemo(() => mulberry32(seed.current), []);
  const options = useMemo(() => normalizeOptions(saved ? saved.settings : api.storage.get(OPTIONS_KEY)), [api.storage, saved]);
  const source = useMemo(() => {
    const statementSource = createStatementSource(statements, { random, seen: api.storage.get(SEEN_KEY, {}) || {} });
    if (saved) statementSource.seek(saved.cursor);
    return statementSource;
  }, [statements, random, api.storage, saved]);
  const [state, dispatch] = useReducer(reduce, undefined, () => (designPreviewState || (saved ? saved.state : initialState(players, options))));
  useGameMusicScene(api.sound, 'meenfina', state.phase);
  const profileSession = useRef(saved ? saved.profileSession || null : api.matchSnapshot?.() || null);
  useSessionSave({
    api, state, active: state.phase !== 'over', phaseKey: `${state.phase}:${state.round}:${state.voter}`,
    snapshot: (current) => sessionSnapshot({ players: current.players, settings: options, seed: seed.current, cursor: source.cursor, profileSession: profileSession.current, state: current }),
  });
  const [picked, setPicked] = useState([]);
  const [leaving, setLeaving] = useState(false);   // العبارة تطير جانبًا قبل «لا أحد» (حارس ضد الضغط المزدوج)
  const [cast, setCast] = useState(null); // اختيار خاص قابل للتغيير حتى التأكيد.
  const voteLock = useRef(false);

  useEffect(() => { api.setInGame(state.phase !== 'over'); }, [state.phase, api]);
  useEffect(() => { setPicked([]); }, [state.round, state.phase === 'pick']);
  useEffect(() => { setCast(null); voteLock.current = false; }, [state.round, state.voter, state.phase]);
  useEffect(() => {
    if (state.phase !== 'over') return;
    api.storage.set(SEEN_KEY, trimSeen(source.seen(), 1200));
    // The platform owns the single completed-match sound.
    if (state.completed === true) { api.haptics.vibrate('win'); api.confetti.fire(); }
    api.matchOver?.({ completed: state.completed === true });
  }, [state.phase]); // eslint-disable-line react-hooks/exhaustive-deps

  // مرجع الطور: التخطي المؤجَّل لا يُرسَل إن كان الحسم قد وقع خلال مهلته.
  const phaseRef = useRef(state.phase); phaseRef.current = state.phase;
  const toggle = (id) => { api.haptics.vibrate('selection'); setPicked((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id])); };
  const confirmPick = () => { api.sound.emit?.('ui.confirm'); api.haptics.vibrate('selection'); stampScreen({ text: tr("تم الاختيار") }); dispatch({ type: 'PICK', playerIds: picked }); };
  const skipStatement = () => {
    if (leaving) return;
    setLeaving(true); api.sound.play('pass');
    setTimeout(() => { setLeaving(false); if (phaseRef.current === 'pick') dispatch({ type: 'SKIP_STATEMENT' }); }, wait(300));
  };
  const castVote = (id) => {
    if (voteLock.current || phaseRef.current !== 'vote') return;
    setCast(id); api.haptics.vibrate('selection');
  };
  const confirmVote = () => {
    if (cast === null || voteLock.current || phaseRef.current !== 'vote') return;
    voteLock.current = true;
    const targetId = cast; setCast(null);
    api.sound.emit?.('ui.confirm'); api.haptics.vibrate('selection');
    dispatch({ type: 'VOTE', targetId });
  };

  if (state.phase === 'over') {
    const table = standings(state, api.contentLocale);
    return (
      <Screen data-design-screen={`meenfina.local.${state.phase}`} className="meenfina" aria-label={tr("مين فينا")}>
        <PresentationStyles sheet={choiceCss} />
        <PresentationStyles sheet={css} />
        <div className="stack">
          <MeenFinal sorted={table} />
          <Button data-design-id="restart" variant="accent" size="lg" full onClick={() => { api.sound.play('whoosh'); api.restart(); }}>{tr("العب مرة أخرى")}</Button>
          <Button variant="secondary" full data-design-id="options" onClick={api.backToSetup}>{tr("تغيير اللاعبين أو الوضع")}</Button>
          <Button variant="secondary" full data-design-id="exit" data-design-required="true" onClick={onExit}>{tr("العودة للمنصة")}</Button>
        </div>
      </Screen>
    );
  }

  return (
    <Screen data-design-screen={`meenfina.local.${state.phase}`} className="meenfina" aria-label={tr("مين فينا")} style={{ '--meen-lock': cssAssetUrl(lockArt) }}>
      <PresentationStyles sheet={choiceCss} />
      <PresentationStyles sheet={css} />
      {state.phase === 'intro' && (
        <div data-design-id="intro" className="meen-intro">
          <h2 className="meen-phase-heading">{tr("مين فينا")}</h2>
          <p className="meen-round-pill">{tr("العبارة ")}{state.round}{tr(" من ")}{state.rounds}</p>
          <div className="meen-intro-guide"><GameArtwork game="meenfina" /><strong>{state.mode === 'point' ? tr("جهّزوا أصابعكم") : tr("تصويت سري")}</strong><p>{state.mode === 'point' ? tr("اقرأوا العبارة، ثم أشيروا جميعًا عند انتهاء العد.") : tr("سيمرّ الجوال على كل لاعب ليصوّت سرًا.")}</p></div>
          <Button data-design-id="start" data-design-required="true" variant="accent" size="lg" full onClick={() => { api.sound.play('whoosh'); dispatch({ type: 'BEGIN', statement: source.next() }); }}>{tr("اعرض العبارة")}</Button>
          <Scoreboard data-design-id="scoreboard" entries={state.players.map((p) => ({ ...p, score: state.scores[p.id] }))} />
        </div>
      )}

      {state.phase === 'countdown' && (
        <Countdown api={api} statement={state.statement.text} round={state.round} rounds={state.rounds} onDone={() => dispatch({ type: 'COUNTDOWN_DONE' })} />
      )}

      {state.phase === 'pick' && (
        <div className="stack meen-pick-stage">
          <MeenQuestion className={leaving ? 'is-leaving' : ''} text={state.statement.text} />
          <p className="meen-info-note">{tr(" يمكن اختيار أكثر من لاعب عند التعادل.")}</p>
          <div data-design-id="options-list" className="meen-grid">
            {state.players.map(player => <MeenChoice key={player.id} player={player} selected={picked.includes(player.id)} onClick={() => toggle(player.id)} />)}
          </div>
          <p className="meen-info-note">{tr("اضغطوا من حصل على أكثر إشارات (يمكن اختيار أكثر من واحد عند التعادل).")}</p>
          <Button variant="accent" size="lg" full disabled={picked.length === 0 || leaving} data-design-id="submit" data-design-required="true" onClick={confirmPick}>{tr("تأكيد (")}{picked.length})</Button>
          <Button variant="secondary" full disabled={leaving} data-design-id="skip" onClick={skipStatement}>{tr("لا أحد تنطبق عليه")}</Button>
        </div>
      )}

      {state.phase === 'vote' && (
        <PassPhoneScreen key={`${state.round}:${state.voter}`} player={currentVoter(state)} api={api} designPreviewShown={!!designPreviewState} hint={tr("صوّت سرًا. لن يرى أحد اختيارك حتى الكشف.")} ready={tr("أنا أصوّت")}>
          <div className="stack">
            <MeenQuestion text={state.statement.text} art />
            <p className="meen-section-title">{tr("من تختار يا ")}<bdi>{currentVoter(state).name}</bdi>؟</p>
            <div data-design-id="options-list" className="meen-grid">
              {state.players.map(player => <MeenChoice key={player.id} player={player} selected={cast === player.id} onClick={() => castVote(player.id)} />)}
            </div>
            <p className="meen-vote-hint">{tr("اختيارك لم يُرسل بعد. يمكنك تغييره ثم تأكيده.")}</p>
            <Button data-design-id="submit" data-design-required="true" variant="accent" size="lg" full disabled={cast === null} onClick={confirmVote}>{tr("تأكيد التصويت وإخفاء الشاشة")}</Button>
          </div>
        </PassPhoneScreen>
      )}

      {state.phase === 'result' && (() => {
        const { counts, max } = tallyVotes(state);
        const winners = state.winners.map((id) => state.players.find((p) => p.id === id)).filter(Boolean);
        return (
          <div className="stack">
            <MeenQuestion text={state.statement.text} art={state.mode === 'secret'} />
            {state.mode === 'secret' && <>
              <h2 className="meen-round-pill">{tr("نتيجة التصويت")}</h2>
              <div data-design-id="results" className="meen-bars">
                {state.players.map(p => (
                  <div key={p.id} className={`meen-bar ${state.winners.includes(p.id) ? 'is-winner' : ''}`}>
                    <ChoicePortrait player={p} size={44} />
                    <span className="who" dir="auto">{p.name}</span>
                    <span className="track" aria-hidden="true"><span className="fill" style={{ width: `${max ? 100 * (counts[p.id] || 0) / max : 0}%` }} /></span>
                    <b>{counts[p.id] || 0}</b>
                  </div>
                ))}
              </div>
            </>}
            <p data-design-id="results" className="meen-result-ribbon">{winners.length ? `${new Intl.ListFormat(getUiLocale(), {style:'long',type:'conjunction'}).format(winners.map(w => w.name))} · ${winners.length > 1 ? tr("نقطة لكل واحد") : tr("نقطة واحدة")}` : tr("لم تنطبق على أحد هذه المرة.")}</p>
            <MeenScoreTotals players={state.players} score={player => state.scores[player.id]} />
            <Button data-design-id="continue" data-design-required="true" variant="accent" size="lg" full onClick={() => { api.sound.play('whoosh'); dispatch({ type: 'NEXT' }); }}>{state.round >= state.rounds ? tr("الألقاب والنتائج") : tr("العبارة التالية")}</Button>
          </div>
        );
      })()}
    </Screen>
  );
}

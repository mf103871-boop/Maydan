import React, { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Screen, Button, Podium, Segment, Card, Scoreboard } from '../../shared/ui/components.jsx';
import { Timer, useTimer } from '../../shared/ui/index.js';
import { trimSeen } from '../../shared/lib/noRepeat.js';
import { mulberry32, randomSeed } from '../../shared/lib/rng.js';
import cards from '../../data/games/mamnoo/cards.json';
import css from './mamnoo.css';
import { initialState, reduce, currentTeam, opponentLabel, standings, createCardSource, normalizeOptions, SECONDS, ROUNDS, MAX_SKIPS } from './logic.js';

const OPTIONS_KEY = 'options';
const SEEN_KEY = 'seen';

export function SetupOptions({ storage, api }) {
  const [opts, setOpts] = useState(() => normalizeOptions(storage.get(OPTIONS_KEY)));
  const update = (patch) => { const next = normalizeOptions({ ...opts, ...patch }); setOpts(next); storage.set(OPTIONS_KEY, next); api.sound.play('click'); };
  return (
    <Card className="stack">
      <span className="card-title">إعدادات الجولة</span>
      <div className="field"><span>مدة الجولة</span>
        <Segment accent label="المدة" value={opts.seconds} onChange={(v) => update({ seconds: v })} options={SECONDS.map((s) => ({ value: s, label: `${s} ث` }))} />
      </div>
      <div className="field"><span>جولات لكل فريق</span>
        <Segment accent label="الجولات" value={opts.rounds} onChange={(v) => update({ rounds: v })} options={ROUNDS.map((r) => ({ value: r, label: `${r} جولات` }))} />
      </div>
    </Card>
  );
}

function Round({ state, dispatch, api, source }) {
  const team = currentTeam(state);
  const [flash, setFlash] = useState('');
  const timer = useTimer({ seconds: state.seconds, onEnd: () => { api.sound.play('buzzer'); api.haptics.vibrate('warning'); dispatch({ type: 'TIME_UP' }); } });
  useEffect(() => { if (state.phase === 'play' && !timer.running && timer.left === state.seconds) timer.start(); if (state.phase !== 'play' && timer.running) timer.pause(); }, [state.phase]); // eslint-disable-line react-hooks/exhaustive-deps
  const act = (type, sound, haptic, cls) => {
    api.sound.play(sound); api.haptics.vibrate(haptic);
    setFlash(cls); setTimeout(() => setFlash(''), 500);
    dispatch({ type, card: source.next() });
  };
  const entries = state.teams.map((t) => ({ ...t, score: state.scores[t.id] }));

  if (state.phase === 'intro') {
    return (
      <div className="mamnoo-intro">
        <p className="muted">الجولة {state.round} من {state.rounds}</p>
        <h2 style={{ color: team.color }}>دور {team.name}</h2>
        <div className="who">
          <span>🗣 لاعب من <b style={{ color: 'var(--text)' }}>{team.name}</b> يصف، وبقية فريقه يخمّنون دون رؤية الشاشة.</span>
          <span>👀 لاعب من <b style={{ color: 'var(--text)' }}>{opponentLabel(state)}</b> يراقب الشاشة ويضغط «ممنوع!» عند المخالفة.</span>
        </div>
        <Button variant="accent" size="lg" full onClick={() => { api.sound.play('whoosh'); dispatch({ type: 'BEGIN', card: source.next() }); }}>ابدأ {state.seconds} ثانية</Button>
        <Scoreboard entries={entries} />
      </div>
    );
  }
  if (state.phase === 'play' && state.card) {
    return (
      <div className={`stack ${flash}`}>
        <div className="mamnoo-head">
          <Timer timer={timer} api={api} size={92} accent="#FF5C8A" />
          <div className="grow"><b style={{ color: team.color }}>{team.name}</b><small>صح {state.tally.correct} · ممنوع {state.tally.buzz} · تخطي {state.tally.skip}</small></div>
          <span className="badge">{state.scores[team.id]}</span>
        </div>
        <div className="mamnoo-card" key={state.card.id}>
          <div className="mamnoo-word">{state.card.word}</div>
          <div className="mamnoo-cat">{state.card.category}</div>
          <div className="mamnoo-forbidden" aria-label="الكلمات الممنوعة">{state.card.forbidden.map((w) => <span key={w}>{w}</span>)}</div>
        </div>
        <div className="mamnoo-buttons">
          <Button variant="success" onClick={() => act('CORRECT', 'correct', 'success', 'flash-good')}>✅ صح +1</Button>
          <Button variant="secondary" disabled={state.skipsLeft <= 0} onClick={() => act('SKIP', 'pass', 'light', '')}>⏭ تخطي ({state.skipsLeft})</Button>
          <Button className="mamnoo-buzz" onClick={() => act('BUZZ', 'buzzer', 'error', 'shake')}>🚫 ممنوع! −1</Button>
        </div>
      </div>
    );
  }
  if (state.phase === 'roundEnd') {
    return (
      <div className="mamnoo-intro">
        <div className="big-emoji" aria-hidden="true">⏰</div>
        <h2>انتهت جولة {team.name}</h2>
        <div className="mamnoo-tally"><span>✅ {state.tally.correct}</span><span>🚫 {state.tally.buzz}</span><span>⏭ {state.tally.skip}</span></div>
        <Scoreboard entries={entries} />
        <Button variant="accent" size="lg" full onClick={() => { api.sound.play('whoosh'); dispatch({ type: 'NEXT' }); }}>{state.turn === state.teams.length - 1 && state.round >= state.rounds ? 'النتائج النهائية' : 'الفريق التالي'}</Button>
      </div>
    );
  }
  return null;
}

export function Game({ api, teams, onExit }) {
  const seed = useRef(randomSeed());
  const random = useMemo(() => mulberry32(seed.current), []);
  const options = useMemo(() => normalizeOptions(api.storage.get(OPTIONS_KEY)), [api.storage]);
  const source = useMemo(() => createCardSource(cards, { random, seen: api.storage.get(SEEN_KEY, {}) || {} }), [random, api.storage]);
  const [state, dispatch] = useReducer(reduce, undefined, () => initialState(teams, options));
  useEffect(() => { api.setInGame(state.phase !== 'over'); }, [state.phase, api]);
  useEffect(() => {
    if (state.phase !== 'over') return;
    api.storage.set(SEEN_KEY, trimSeen(source.seen(), 1500));
    api.sound.play('fanfare'); api.haptics.vibrate('win'); api.confetti.fire();
  }, [state.phase]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Screen className="mamnoo" aria-label="ممنوع">
      <style>{css}</style>
      {state.phase === 'over' ? (
        <div className="stack">
          <Podium entries={standings(state)} />
          <Button variant="accent" size="lg" full onClick={() => { api.sound.play('whoosh'); api.restart(); }}>العب مرة أخرى</Button>
          <Button variant="secondary" full onClick={api.backToSetup}>تغيير الفرق أو الإعدادات</Button>
          <Button variant="ghost" full onClick={onExit}>العودة للمنصة</Button>
        </div>
      ) : <Round state={state} dispatch={dispatch} api={api} source={source} />}
    </Screen>
  );
}

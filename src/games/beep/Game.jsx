// واجهة «قبل ما يطق!» — تعتمد على logic.js للحالة وعلى المكونات المشتركة للمؤقت والنتائج.
import React, { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Screen, Button, Podium, Segment, Card } from '../../shared/ui/components.jsx';
import { Timer, useTimer } from '../../shared/ui/index.js';
import { trimSeen } from '../../shared/lib/noRepeat.js';
import { mulberry32, randomSeed } from '../../shared/lib/rng.js';
import prompts from '../../data/games/beep/prompts.json';
import css from './beep.css';
import { initialState, reduce, currentPlayer, standings, createPromptSource, normalizeOptions, nextBombSeconds, SECONDS, ROUNDS } from './logic.js';

const OPTIONS_KEY = 'options';
const SEEN_KEY = 'seen';

export function SetupOptions({ storage, api }) {
  const [opts, setOpts] = useState(() => normalizeOptions(storage.get(OPTIONS_KEY)));
  const update = (patch) => { const next = normalizeOptions({ ...opts, ...patch }); setOpts(next); storage.set(OPTIONS_KEY, next); api.sound.play('click'); };
  return (
    <Card className="stack">
      <span className="card-title">إعدادات الجولة</span>
      <div className="field"><span>الوضع</span>
        <Segment accent label="الوضع" value={opts.mode} onChange={(v) => update({ mode: v })} options={[{ value: 'three', label: '3 قبل الصفارة' }, { value: 'bomb', label: '💣 القنبلة' }]} />
      </div>
      {opts.mode === 'three' && (
        <>
          <div className="field"><span>ثواني كل طلب</span>
            <Segment accent label="الثواني" value={opts.seconds} onChange={(v) => update({ seconds: v })} options={SECONDS.map((s) => ({ value: s, label: `${s} ث` }))} />
          </div>
          <div className="field"><span>عدد الجولات</span>
            <Segment accent label="الجولات" value={opts.rounds} onChange={(v) => update({ rounds: v })} options={ROUNDS.map((r) => ({ value: r, label: `${r} جولات` }))} />
          </div>
        </>
      )}
      {opts.mode === 'bomb' && <p className="card-muted">مؤقت مخفي بين 20 و60 ثانية. كل لاعب 3 أرواح. آخر من يبقى يفوز.</p>}
    </Card>
  );
}

function ThreeRound({ state, dispatch, api, source }) {
  const player = currentPlayer(state);
  const timer = useTimer({ seconds: state.seconds, onEnd: () => { api.sound.play('buzzer'); api.haptics.vibrate('error'); dispatch({ type: 'FINISH', timedOut: true }); } });
  useEffect(() => { if (state.phase === 'prompt') { timer.reset(state.seconds); timer.start(); } }, [state.phase, state.prompt && state.prompt.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (state.phase === 'prompt' && timer.left <= state.seconds && timer.running) api.sound.play(timer.left <= 2 ? 'tickFast' : 'tick'); }, [timer.left]); // eslint-disable-line react-hooks/exhaustive-deps

  if (state.phase === 'intro') {
    return (
      <div className="beep-intro">
        <div className="big" aria-hidden="true">{player.emoji}</div>
        <p className="muted">الجولة {state.round} من {state.rounds}</p>
        <h2>دور {player.name}</h2>
        <p className="muted">خذ الجوال واستعد. عندما تضغط «جاهز» يظهر الطلب ويبدأ المؤقت.</p>
        <Button variant="accent" size="lg" full onClick={() => { api.sound.play('whoosh'); dispatch({ type: 'BEGIN', prompt: source.next(state.round, state.rounds) }); }}>جاهز — {state.seconds} ثوانٍ</Button>
        <PlayersStrip state={state} />
      </div>
    );
  }
  if (state.phase === 'prompt') {
    return (
      <>
        <div className="beep-turn" style={{ '--p-color': player.color }}><span className="avatar">{player.emoji}</span><div><b>{player.name}</b><small>قل ثلاثة بصوت عالٍ</small></div></div>
        <Timer timer={timer} api={api} accent="#FF4D4D" />
        <div className="beep-prompt">{state.prompt.text}<small>{state.prompt.category}</small></div>
        <Button variant="accent" size="lg" full onClick={() => { timer.pause(); api.sound.play('pop'); dispatch({ type: 'FINISH' }); }}>خلصت! ✋</Button>
      </>
    );
  }
  if (state.phase === 'judge') {
    return (
      <>
        <div className="beep-prompt">{state.prompt.text}<small>{state.timedOut ? '⏰ طقّت الصفارة' : 'أنهى قبل الوقت'}</small></div>
        <p className="center muted">هل ذكر {player.name} ثلاثة صحيحة؟</p>
        <div className="beep-judge">
          <Button variant="success" onClick={(e) => { api.sound.play('correct'); api.haptics.vibrate('success'); api.confetti.burst({ x: e.clientX, y: e.clientY }); dispatch({ type: 'JUDGE', ok: true }); }}><span aria-hidden="true">✅</span>نعم +1</Button>
          <Button variant="danger" onClick={() => { api.sound.play('wrong'); api.haptics.vibrate('error'); dispatch({ type: 'JUDGE', ok: false }); }}><span aria-hidden="true">❌</span>لا</Button>
        </div>
        <PlayersStrip state={state} />
      </>
    );
  }
  return null;
}

function BombRound({ state, dispatch, api, source, random }) {
  const player = currentPlayer(state);
  const [hot, setHot] = useState(false);
  const timer = useTimer({ seconds: state.bombSeconds, onEnd: () => { api.sound.play('explosion'); api.haptics.vibrate('explosion'); dispatch({ type: 'EXPLODE' }); } });
  useEffect(() => { if (state.phase === 'prompt' && !timer.running && !timer.paused && state.bombElapsed === 0 && timer.left === state.bombSeconds) timer.start(); }, [state.phase]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setHot(timer.running && timer.left <= 8); if (timer.running) api.sound.play(timer.left <= 8 ? 'tickFast' : 'tick'); }, [timer.left]); // eslint-disable-line react-hooks/exhaustive-deps

  if (state.phase === 'intro') {
    return (
      <div className="beep-intro">
        <div className="big" aria-hidden="true">💣</div>
        <h2>القنبلة مع {player.name}</h2>
        <p className="muted">أجب على الطلب ثم مرّر الجوال فورًا. المؤقت مخفي… قد ينفجر في أي لحظة.</p>
        <Button variant="accent" size="lg" full onClick={() => { api.sound.play('whoosh'); dispatch({ type: 'BEGIN', prompt: source.next(1, 1) }); }}>تشغيل القنبلة</Button>
        <PlayersStrip state={state} />
      </div>
    );
  }
  if (state.phase === 'prompt') {
    return (
      <>
        <div className="beep-turn" style={{ '--p-color': player.color }}><span className="avatar">{player.emoji}</span><div><b>{player.name}</b><small>أجب ثم مرّر بسرعة</small></div></div>
        <div className={`beep-bomb ${hot ? 'is-hot' : ''}`} aria-hidden="true">💣</div>
        {timer.resuming !== null && <Timer timer={timer} api={api} size={1} />}
        <div className="beep-prompt">{state.prompt.text}<small>{state.prompt.category}</small></div>
        <Button variant="accent" size="lg" full onClick={() => { api.sound.play('pass'); api.haptics.vibrate('light'); dispatch({ type: 'PASS', prompt: source.next(1, 1) }); }}>أجبت — مرّر الجوال ⬅</Button>
        <PlayersStrip state={state} />
      </>
    );
  }
  if (state.phase === 'boom') {
    const victim = state.players.find((p) => p.id === state.boomPlayerId);
    const livesLeft = state.lives[state.boomPlayerId];
    return (
      <div className="beep-boom" role="alert">
        <div className="inner">
          <div className="big" aria-hidden="true">💥</div>
          <h2>انفجرت بيد {victim.name}!</h2>
          <p>{livesLeft > 0 ? `بقي له ${livesLeft === 1 ? 'حياة واحدة' : `${livesLeft} أرواح`}` : 'خرج من اللعبة'}</p>
          <Button variant="secondary" size="lg" onClick={() => { api.sound.play('whoosh'); dispatch({ type: 'CONTINUE', bombSeconds: nextBombSeconds(random) }); }}>قنبلة جديدة</Button>
        </div>
      </div>
    );
  }
  return null;
}

function PlayersStrip({ state }) {
  return (
    <div className="beep-players" aria-label="اللاعبون">
      {state.players.map((p, i) => (
        <span key={p.id} className={`beep-chip ${state.eliminated.includes(p.id) ? 'is-out' : ''} ${i === state.turn ? 'is-turn' : ''}`}>
          {p.emoji} {p.name}
          {state.mode === 'three' ? <b>{state.scores[p.id]}</b> : <span className="beep-lives" aria-label={`${state.lives[p.id]} أرواح`}>{'❤️'.repeat(state.lives[p.id])}{'🖤'.repeat(3 - state.lives[p.id])}</span>}
        </span>
      ))}
    </div>
  );
}

export function Game({ api, players, onExit }) {
  const seed = useRef(randomSeed());
  const random = useMemo(() => mulberry32(seed.current), []);
  const options = useMemo(() => normalizeOptions(api.storage.get(OPTIONS_KEY)), [api.storage]);
  const source = useMemo(() => createPromptSource(prompts, { random, seen: api.storage.get(SEEN_KEY, {}) || {} }), [random, api.storage]);
  const [state, dispatch] = useReducer(reduce, undefined, () => initialState(players, options, { random }));
  const [session, setSession] = useState(0);

  useEffect(() => { api.setInGame(state.phase !== 'over'); }, [state.phase, api]);
  useEffect(() => {
    if (state.phase !== 'over') return;
    api.storage.set(SEEN_KEY, trimSeen(source.seen(), 1500));
    api.sound.play('fanfare');
    api.haptics.vibrate('win');
    api.confetti.fire();
  }, [state.phase]); // eslint-disable-line react-hooks/exhaustive-deps

  const restart = () => { api.sound.play('whoosh'); setSession((s) => s + 1); api.restart(); };

  return (
    <Screen className="beep" aria-label="قبل ما يطق">
      <style>{css}</style>
      {state.phase === 'over' ? (
        <div className="stack">
          <Podium entries={standings(state).map((p) => ({ ...p, score: state.mode === 'three' ? p.score : p.lives }))} unit={state.mode === 'three' ? '' : ' ❤️'} />
          <div className="beep-actions">
            <Button variant="accent" size="lg" full onClick={restart}>العب مرة أخرى</Button>
            <Button variant="secondary" full onClick={api.backToSetup}>تغيير اللاعبين أو الإعدادات</Button>
            <Button variant="ghost" full onClick={onExit}>العودة للمنصة</Button>
          </div>
        </div>
      ) : state.mode === 'three' ? (
        <ThreeRound key={session} state={state} dispatch={dispatch} api={api} source={source} />
      ) : (
        <BombRound key={session} state={state} dispatch={dispatch} api={api} source={source} random={random} />
      )}
    </Screen>
  );
}

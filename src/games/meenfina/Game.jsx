import React, { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Screen, Button, Podium, Segment, Card, Scoreboard } from '../../shared/ui/components.jsx';
import { PassPhoneScreen } from '../../shared/setup/PassPhoneScreen.jsx';
import { trimSeen } from '../../shared/lib/noRepeat.js';
import { mulberry32, randomSeed } from '../../shared/lib/rng.js';
import statements from '../../data/games/meenfina/statements.json';
import css from './meenfina.css';
import { initialState, reduce, currentVoter, standings, createStatementSource, normalizeOptions, tallyVotes, ROUNDS } from './logic.js';

const OPTIONS_KEY = 'options';
const SEEN_KEY = 'seen';

export function SetupOptions({ storage, api }) {
  const [opts, setOpts] = useState(() => normalizeOptions(storage.get(OPTIONS_KEY)));
  const update = (patch) => { const next = normalizeOptions({ ...opts, ...patch }); setOpts(next); storage.set(OPTIONS_KEY, next); api.sound.play('click'); };
  return (
    <Card className="stack">
      <span className="card-title">الوضع والجولات</span>
      <Segment accent label="الوضع" value={opts.mode} onChange={(v) => update({ mode: v })} options={[{ value: 'point', label: '👉 أشّر!' }, { value: 'secret', label: '🤫 تصويت سري' }]} />
      <div className="field"><span>عدد العبارات</span>
        <Segment accent label="الجولات" value={opts.rounds} onChange={(v) => update({ rounds: v })} options={ROUNDS.map((r) => ({ value: r, label: `${r} عبارة` }))} />
      </div>
      <p className="card-muted">{opts.mode === 'point' ? 'الجميع يشيرون في اللحظة نفسها بعد عدّ 3-2-1.' : 'يمرّ الجوال على كل لاعب ليصوّت سرًا، ثم تُكشف النتائج.'}</p>
    </Card>
  );
}

function Countdown({ api, onDone }) {
  const [n, setN] = useState(3);
  useEffect(() => {
    if (n > 0) { api.sound.play('countdown'); api.haptics.vibrate('light'); }
    else { api.sound.play('countdownGo'); api.haptics.vibrate('medium'); }
    const t = setTimeout(() => (n > 0 ? setN(n - 1) : onDone()), n > 0 ? 900 : 650);
    return () => clearTimeout(t);
  }, [n]); // eslint-disable-line react-hooks/exhaustive-deps
  return <div className="meen-count" role="status" aria-live="assertive">{n > 0 ? <div className="num" key={n}>{n}</div> : <div className="go">أشّر الآن!</div>}</div>;
}

export function Game({ api, players, onExit }) {
  const seed = useRef(randomSeed());
  const random = useMemo(() => mulberry32(seed.current), []);
  const options = useMemo(() => normalizeOptions(api.storage.get(OPTIONS_KEY)), [api.storage]);
  const source = useMemo(() => createStatementSource(statements, { random, seen: api.storage.get(SEEN_KEY, {}) || {} }), [random, api.storage]);
  const [state, dispatch] = useReducer(reduce, undefined, () => initialState(players, options));
  const [picked, setPicked] = useState([]);

  useEffect(() => { api.setInGame(state.phase !== 'over'); }, [state.phase, api]);
  useEffect(() => { setPicked([]); }, [state.round, state.phase === 'pick']);
  useEffect(() => {
    if (state.phase !== 'over') return;
    api.storage.set(SEEN_KEY, trimSeen(source.seen(), 1200));
    api.sound.play('fanfare'); api.haptics.vibrate('win'); api.confetti.fire();
  }, [state.phase]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (id) => { api.sound.play('click'); api.haptics.vibrate('selection'); setPicked((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id])); };
  const confirmPick = () => { api.sound.play('correct'); api.haptics.vibrate('success'); api.confetti.burst(); dispatch({ type: 'PICK', playerIds: picked }); };

  if (state.phase === 'over') {
    const table = standings(state);
    return (
      <Screen className="meenfina" aria-label="مين فينا">
        <style>{css}</style>
        <div className="stack">
          <Podium entries={table} />
          <div className="meen-titles">
            {table.map((p) => (
              <div key={p.id}><span aria-hidden="true">{p.emoji}</span><span className="grow"><b>{p.name}</b><small>{p.title || 'بلا لقب هذه المرة'}</small></span><span className="badge">{p.score}</span></div>
            ))}
          </div>
          <Button variant="accent" size="lg" full onClick={() => { api.sound.play('whoosh'); api.restart(); }}>العب مرة أخرى</Button>
          <Button variant="secondary" full onClick={api.backToSetup}>تغيير اللاعبين أو الوضع</Button>
          <Button variant="ghost" full onClick={onExit}>العودة للمنصة</Button>
        </div>
      </Screen>
    );
  }

  return (
    <Screen className="meenfina" aria-label="مين فينا">
      <style>{css}</style>
      {state.phase === 'intro' && (
        <div className="meen-intro">
          <div className="big" aria-hidden="true">👉</div>
          <p className="muted">العبارة {state.round} من {state.rounds}</p>
          <h2 style={{ fontSize: 26, fontWeight: 900 }}>{state.mode === 'point' ? 'جهّزوا أصابعكم' : 'تصويت سري'}</h2>
          <p className="muted">{state.mode === 'point' ? 'ستظهر العبارة ثم عدّ 3-2-1، وأشيروا جميعًا في اللحظة نفسها.' : 'سيمرّ الجوال على كل لاعب ليصوّت سرًا.'}</p>
          <Button variant="accent" size="lg" full onClick={() => { api.sound.play('whoosh'); dispatch({ type: 'BEGIN', statement: source.next() }); }}>اعرض العبارة</Button>
          <Scoreboard entries={state.players.map((p) => ({ ...p, score: state.scores[p.id] }))} />
        </div>
      )}

      {state.phase === 'countdown' && (
        <>
          <div className="meen-statement">{state.statement.text}</div>
          <Countdown api={api} onDone={() => dispatch({ type: 'COUNTDOWN_DONE' })} />
        </>
      )}

      {state.phase === 'pick' && (
        <div className="stack">
          <div className="meen-statement">{state.statement.text}</div>
          <p className="center muted">اضغطوا من حصل على أكثر إشارات (يمكن اختيار أكثر من واحد عند التعادل).</p>
          <div className="meen-grid">
            {state.players.map((p) => (
              <button key={p.id} type="button" className={`meen-pick ${picked.includes(p.id) ? 'selected' : ''}`} style={{ '--pick-color': p.color }} aria-pressed={picked.includes(p.id)} onClick={() => toggle(p.id)}>
                {picked.includes(p.id) && <span className="count" aria-hidden="true">{picked.indexOf(p.id) + 1}</span>}
                <span aria-hidden="true">{p.emoji}</span>{p.name}
              </button>
            ))}
          </div>
          <Button variant="accent" size="lg" full disabled={picked.length === 0} onClick={confirmPick}>تأكيد ({picked.length})</Button>
          <Button variant="ghost" full onClick={() => { api.sound.play('pass'); dispatch({ type: 'SKIP_STATEMENT' }); }}>لا أحد تنطبق عليه</Button>
        </div>
      )}

      {state.phase === 'vote' && (
        <PassPhoneScreen player={currentVoter(state)} api={api} hint="صوّت سرًا. لن يرى أحد اختيارك حتى الكشف." ready="أنا أصوّت">
          <div className="stack">
            <div className="meen-statement">{state.statement.text}</div>
            <p className="center muted">من تختار يا {currentVoter(state).name}؟</p>
            <div className="meen-grid">
              {state.players.map((p) => (
                <button key={p.id} type="button" className="meen-pick" style={{ '--pick-color': p.color }} onClick={() => { api.sound.play('pop'); api.haptics.vibrate('selection'); dispatch({ type: 'VOTE', targetId: p.id }); }}>
                  <span aria-hidden="true">{p.emoji}</span>{p.name}
                </button>
              ))}
            </div>
          </div>
        </PassPhoneScreen>
      )}

      {state.phase === 'result' && (() => {
        const { counts, max } = tallyVotes(state);
        const winners = state.winners.map((id) => state.players.find((p) => p.id === id)).filter(Boolean);
        return (
          <div className="stack">
            <div className="meen-statement">{state.statement.text}</div>
            {state.mode === 'secret' && (
              <div className="meen-bars">
                {state.players.map((p, i) => (
                  <div key={p.id} className="meen-bar">
                    <span className="who">{p.emoji} {p.name}</span>
                    <span className="track"><span className="fill" style={{ '--w': `${max ? ((counts[p.id] || 0) / max) * 100 : 0}%`, '--bar-color': p.color, '--delay': `${i * 70}ms` }} /></span>
                    <b>{counts[p.id] || 0}</b>
                  </div>
                ))}
              </div>
            )}
            <div className="meen-winner">
              {winners.length > 0 ? (
                <>
                  <div className="faces" aria-hidden="true">{winners.map((w) => <span key={w.id}>{w.emoji}</span>)}</div>
                  <h2>{winners.map((w) => w.name).join(' و')}</h2>
                  <p className="muted">{winners.length > 1 ? 'تعادل! نقطة لكل واحد.' : 'نقطة واحدة'}</p>
                </>
              ) : <p className="muted">لم تنطبق على أحد هذه المرة.</p>}
            </div>
            <Button variant="accent" size="lg" full onClick={() => { api.sound.play('whoosh'); dispatch({ type: 'NEXT' }); }}>{state.round >= state.rounds ? 'الألقاب والنتائج' : 'العبارة التالية'}</Button>
          </div>
        );
      })()}
    </Screen>
  );
}

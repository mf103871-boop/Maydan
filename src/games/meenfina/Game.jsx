import { SetupPresets } from '../../plus/SetupPresets.jsx';
import { Avatar, GameArtwork } from '../../shared/brand/art.jsx';
import React, { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { socialInterruption } from '../../social/interruption.js';
import { Screen, Button, Podium, Segment, Card, Scoreboard } from '../../shared/ui/components.jsx';
import { PassPhoneScreen } from '../../shared/setup/PassPhoneScreen.jsx';
import { trimSeen } from '../../shared/lib/noRepeat.js';
import { mulberry32, randomSeed } from '../../shared/lib/rng.js';
import statements from '../../data/games/meenfina/statements.json';
import css from './meenfina.css';
import { stampScreen, wait } from '../../shared/fx/index.js';
import { initialState, reduce, currentVoter, standings, createStatementSource, normalizeOptions, tallyVotes, statementsLabel, restoreSession, sessionSnapshot, ROUNDS } from './logic.js';
import { loadSession } from '../../shared/lib/session.js';
import { useSessionSave } from '../../shared/ui/useSessionSave.js';

const OPTIONS_KEY = 'options';
const SEEN_KEY = 'seen';

export function SetupOptions({ storage, api }) {
  const [opts, setOpts] = useState(() => normalizeOptions(storage.get(OPTIONS_KEY)));
  const [resume] = useState(() => loadSession(storage, restoreSession));
  const update = (patch) => { const next = normalizeOptions({ ...opts, ...patch }); setOpts(next); storage.set(OPTIONS_KEY, next); };
  return (
    <div data-design-screen="setup.meenfina" data-design-id="options" className="stack">
    {!api.designPreview && <SetupPresets game="meenfina" settings={opts} onApply={update} />}
    {resume && <Card className="stack resume-card">
      <span className="card-title">لعبتكم بانتظاركم</span>
      <p className="card-muted">العبارة {resume.state.round} من {resume.state.rounds} · {resume.players.map((p) => p.name).join('، ')}</p>
      <Button data-design-id="resume" data-design-required="true" variant="accent" full onClick={() => api.resumeGame(resume)}>استئناف اللعبة المحفوظة</Button>
      <p className="card-muted">بدء لعبة جديدة يستبدل هذا التقدم.</p>
    </Card>}
    <Card className="stack">
      <span className="card-title">الوضع والجولات</span>
      <Segment data-design-id="setting-mode" accent label="الوضع" value={opts.mode} onChange={(v) => update({ mode: v })} options={[{ value: 'point', label: '👉 أشّر!' }, { value: 'secret', label: '🤫 تصويت سري' }]} />
      <div className="field"><span>عدد العبارات</span>
        <Segment data-design-id="setting-rounds" accent label="الجولات" value={opts.rounds} onChange={(v) => update({ rounds: v })} options={ROUNDS.map((r) => ({ value: r, label: statementsLabel(r) }))} />
      </div>
      <p className="card-muted">{opts.mode === 'point' ? 'الجميع يشيرون في اللحظة نفسها بعد عدّ 3-2-1.' : 'يمرّ الجوال على كل لاعب ليصوّت سرًا، ثم تُكشف النتائج.'}</p>
    </Card>
    </div>
  );
}

// طبقة العدّ تغطي الشاشة، فالعبارة تُرسم داخلها — وإلا أُشير قبل أن تُقرأ.
function Countdown({ api, statement, onDone }) {
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
      <div data-design-id="question" className="meen-statement">{statement}</div>
      <div className="meen-count-num" role="status" aria-live="assertive">
        {n > 0 ? <div className="num" key={n}>{n}</div> : <div className="go">أشّر الآن!</div>}
      </div>
    </div>
  );
}

export function Game({ api, players, onExit, savedSession = null, designPreviewState = null }) {
  // لقطة محفوظة صالحة تعيد الحالة والمصدر بنفس البذرة والموضع؛ وإلا مباراة جديدة.
  const saved = useMemo(() => restoreSession(savedSession), [savedSession]);
  const seed = useRef(saved ? saved.seed : randomSeed());
  const random = useMemo(() => mulberry32(seed.current), []);
  const options = useMemo(() => normalizeOptions(saved ? saved.settings : api.storage.get(OPTIONS_KEY)), [api.storage, saved]);
  const source = useMemo(() => {
    const statementSource = createStatementSource(statements, { random, seen: api.storage.get(SEEN_KEY, {}) || {} });
    if (saved) statementSource.seek(saved.cursor);
    return statementSource;
  }, [random, api.storage, saved]);
  const [state, dispatch] = useReducer(reduce, undefined, () => (designPreviewState || (saved ? saved.state : initialState(players, options))));
  const profileSession = useRef(saved ? saved.profileSession || null : api.matchSnapshot?.() || null);
  useSessionSave({
    api, state, active: state.phase !== 'over', phaseKey: `${state.phase}:${state.round}:${state.voter}`,
    snapshot: (current) => sessionSnapshot({ players: current.players, settings: options, seed: seed.current, cursor: source.cursor, profileSession: profileSession.current, state: current }),
  });
  const [picked, setPicked] = useState([]);
  const [leaving, setLeaving] = useState(false);   // العبارة تطير جانبًا قبل «لا أحد» (حارس ضد الضغط المزدوج)
  const [cast, setCast] = useState(null);           // البلاطة المضغوطة في التصويت السري تنبض ثم يُرسل الصوت

  useEffect(() => { api.setInGame(state.phase !== 'over'); }, [state.phase, api]);
  useEffect(() => { setPicked([]); }, [state.round, state.phase === 'pick']);
  useEffect(() => {
    if (state.phase !== 'over') return;
    api.storage.set(SEEN_KEY, trimSeen(source.seen(), 1200));
    api.sound.play('fanfare'); api.haptics.vibrate('win'); api.confetti.fire();
    api.matchOver?.({ completed: state.completed === true });
  }, [state.phase]); // eslint-disable-line react-hooks/exhaustive-deps

  // مرجع الطور: التخطي المؤجَّل لا يُرسَل إن كان الحسم قد وقع خلال مهلته.
  const phaseRef = useRef(state.phase); phaseRef.current = state.phase;
  const toggle = (id) => { api.haptics.vibrate('selection'); setPicked((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id])); };
  const confirmPick = () => { api.sound.play('correct'); api.haptics.vibrate('success'); api.confetti.burst(); stampScreen({ text: 'صح!' }); dispatch({ type: 'PICK', playerIds: picked }); };
  const skipStatement = () => {
    if (leaving) return;
    setLeaving(true); api.sound.play('pass');
    setTimeout(() => { setLeaving(false); if (phaseRef.current === 'pick') dispatch({ type: 'SKIP_STATEMENT' }); }, wait(300));
  };
  const castVote = (id) => {
    if (cast) return;
    setCast(id); api.sound.play('pop'); api.haptics.vibrate('selection');
    setTimeout(() => { setCast(null); dispatch({ type: 'VOTE', targetId: id }); }, wait(160));
  };

  if (state.phase === 'over') {
    const table = standings(state);
    return (
      <Screen data-design-screen={`meenfina.local.${state.phase}`} className="meenfina" aria-label="مين فينا">
        <style>{css}</style>
        <div className="stack">
          <Podium data-design-id="podium" entries={table} />
          <div className="meen-titles">
            {table.map((p, i) => (
              <div key={p.id} style={{ '--i': i }}><span aria-hidden="true"><Avatar player={p} /></span><span className="grow"><b>{p.name}</b><small>{p.title || 'بلا لقب هذه المرة'}</small></span><span className="badge">{p.score}</span></div>
            ))}
          </div>
          <Button data-design-id="restart" variant="accent" size="lg" full onClick={() => { api.sound.play('whoosh'); api.restart(); }}>العب مرة أخرى</Button>
          <Button variant="secondary" full data-design-id="options" onClick={api.backToSetup}>تغيير اللاعبين أو الوضع</Button>
          <Button variant="ghost" full data-design-id="exit" data-design-required="true" onClick={onExit}>العودة للمنصة</Button>
        </div>
      </Screen>
    );
  }

  return (
    <Screen data-design-screen={`meenfina.local.${state.phase}`} className="meenfina" aria-label="مين فينا">
      <style>{css}</style>
      {state.phase === 'intro' && (
        <div data-design-id="intro" className="meen-intro">
          <div className="big clay-stage clay-idle" aria-hidden="true"><span className="clay-lift"><GameArtwork game="meenfina" /></span></div>
          <p className="muted">العبارة {state.round} من {state.rounds}</p>
          <h2 style={{ fontSize: 26, fontWeight: 900 }}>{state.mode === 'point' ? 'جهّزوا أصابعكم' : 'تصويت سري'}</h2>
          <p className="muted">{state.mode === 'point' ? 'ستظهر العبارة ثم عدّ 3-2-1، وأشيروا جميعًا في اللحظة نفسها.' : 'سيمرّ الجوال على كل لاعب ليصوّت سرًا.'}</p>
          <Button data-design-id="start" data-design-required="true" variant="accent" size="lg" full onClick={() => { api.sound.play('whoosh'); dispatch({ type: 'BEGIN', statement: source.next() }); }}>اعرض العبارة</Button>
          <Scoreboard data-design-id="scoreboard" entries={state.players.map((p) => ({ ...p, score: state.scores[p.id] }))} />
        </div>
      )}

      {state.phase === 'countdown' && (
        <Countdown api={api} statement={state.statement.text} onDone={() => dispatch({ type: 'COUNTDOWN_DONE' })} />
      )}

      {state.phase === 'pick' && (
        <div className="stack">
          <div data-design-id="question" className={`meen-statement ${leaving ? 'is-leaving' : ''}`}>{state.statement.text}</div>
          <p className="center muted">اضغطوا من حصل على أكثر إشارات (يمكن اختيار أكثر من واحد عند التعادل).</p>
          <div data-design-id="options-list" className="meen-grid">
            {state.players.map((p, i) => (
              <button key={p.id} type="button" data-design-id="option" className={`meen-pick ${picked.includes(p.id) ? 'selected' : ''}`} style={{ '--pick-color': p.color, '--i': i }} aria-pressed={picked.includes(p.id)} onClick={() => toggle(p.id)}>
                {picked.includes(p.id) && <span className="count" key={picked.indexOf(p.id)} aria-hidden="true">{picked.indexOf(p.id) + 1}</span>}
                <span className="clay-stage clay-static" aria-hidden="true"><span className="clay-lift"><Avatar player={p} /></span></span>{p.name}
              </button>
            ))}
          </div>
          <Button variant="accent" size="lg" full disabled={picked.length === 0 || leaving} data-design-id="submit" data-design-required="true" onClick={confirmPick}>تأكيد ({picked.length})</Button>
          <Button variant="ghost" full disabled={leaving} data-design-id="skip" onClick={skipStatement}>لا أحد تنطبق عليه</Button>
        </div>
      )}

      {state.phase === 'vote' && (
        <PassPhoneScreen player={currentVoter(state)} api={api} designPreviewShown={!!designPreviewState} hint="صوّت سرًا. لن يرى أحد اختيارك حتى الكشف." ready="أنا أصوّت">
          <div className="stack">
            <div data-design-id="question" className="meen-statement">{state.statement.text}</div>
            <p className="center muted">من تختار يا {currentVoter(state).name}؟</p>
            <div data-design-id="options-list" className="meen-grid">
              {state.players.map((p, i) => (
                <button key={p.id} type="button" data-design-id="option" className={`meen-pick ${cast === p.id ? 'selected' : ''}`} style={{ '--pick-color': p.color, '--i': i }} aria-pressed={cast === p.id} onClick={() => castVote(p.id)}>
                  <span className="clay-stage clay-static" aria-hidden="true"><span className="clay-lift"><Avatar player={p} /></span></span>{p.name}
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
            <div data-design-id="question" className="meen-statement">{state.statement.text}</div>
            {state.mode === 'secret' && (
              <div data-design-id="results" className="meen-bars">
                {state.players.map((p, i) => (
                  <div key={p.id} className="meen-bar">
                    <span className="who"><Avatar player={p} /> {p.name}</span>
                    <span className="track"><span className="fill" style={{ '--w-frac': max ? (counts[p.id] || 0) / max : 0, '--bar-color': p.color, '--delay': `${i * 70}ms` }} /></span>
                    <b>{counts[p.id] || 0}</b>
                  </div>
                ))}
              </div>
            )}
            <div data-design-id="results" className="meen-winner">
              {winners.length > 0 ? (
                <>
                  <div className="faces" aria-hidden="true">{winners.map((w, i) => <span key={w.id} className="clay-stage" style={{ '--i': i }}><span className="clay-lift"><Avatar player={w} /></span></span>)}</div>
                  <h2>{winners.map((w) => w.name).join(' و')}</h2>
                  <p className="muted point">{winners.length > 1 ? 'تعادل! نقطة لكل واحد.' : 'نقطة واحدة'}</p>
                </>
              ) : <p className="muted">لم تنطبق على أحد هذه المرة.</p>}
            </div>
            <Button data-design-id="continue" data-design-required="true" variant="accent" size="lg" full onClick={() => { api.sound.play('whoosh'); dispatch({ type: 'NEXT' }); }}>{state.round >= state.rounds ? 'الألقاب والنتائج' : 'العبارة التالية'}</Button>
          </div>
        );
      })()}
    </Screen>
  );
}

import React, { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Screen, Button, Podium, Segment, Card } from '../../shared/ui/components.jsx';
import { useTimer } from '../../shared/ui/useTimer.js';
import { trimSeen } from '../../shared/lib/noRepeat.js';
import { mulberry32, randomSeed } from '../../shared/lib/rng.js';
import categories from '../../data/games/jabeen/index.js';
import css from './jabeen.css';
import { initialState, reduce, currentEntrant, standings, createItemSource, normalizeOptions, SECONDS } from './logic.js';
import { useTilt } from './useTilt.js';

const OPTIONS_KEY = 'options';
const SEEN_KEY = 'seen';

export function SetupOptions({ storage, api }) {
  const [opts, setOpts] = useState(() => normalizeOptions(storage.get(OPTIONS_KEY), categories));
  const update = (patch) => { const next = normalizeOptions({ ...opts, ...patch }, categories); setOpts(next); storage.set(OPTIONS_KEY, next); api.sound.play('click'); };
  return (
    <Card className="stack">
      <span className="card-title">الفئة والمدة</span>
      <div className="jabeen-cats">
        {categories.map((c) => (
          <button key={c.id} type="button" className={`jabeen-cat ${opts.categoryId === c.id ? 'selected' : ''}`} aria-pressed={opts.categoryId === c.id} onClick={() => update({ categoryId: c.id })}>
            <span aria-hidden="true">{c.icon}</span>{c.name}<small>{c.items.length} كلمة</small>
          </button>
        ))}
      </div>
      <div className="field"><span>مدة الجولة</span>
        <Segment accent label="المدة" value={opts.seconds} onChange={(v) => update({ seconds: v })} options={SECONDS.map((s) => ({ value: s, label: `${s} ث` }))} />
      </div>
    </Card>
  );
}

function Stage({ state, dispatch, api, source, timer }) {
  const [flash, setFlash] = useState('');
  const answer = (ok) => {
    api.sound.play(ok ? 'correct' : 'wrong');
    api.haptics.vibrate(ok ? 'success' : 'light');
    setFlash(ok ? 'is-good' : 'is-skip');
    setTimeout(() => setFlash(''), 420);
    dispatch({ type: 'ANSWER', ok, item: source.next() });
  };
  const tilt = useTilt({ enabled: state.control === 'auto' && state.phase === 'play', onDecision: (d) => answer(d === 'correct') });
  const useTouch = state.control === 'touch' || !tilt.supported;
  const danger = timer.left <= 10;
  return (
    <div className={`jabeen-stage ${flash}`} role="group" aria-label="جولة على جبينك">
      <div className="jabeen-stage-top">
        <span className={`num ${danger ? 'is-danger' : ''}`} dir="ltr">{timer.left}</span>
        <span className="muted">✅ {state.results.filter((r) => r.ok).length}</span>
        <Button size="sm" variant="ghost" onClick={() => { timer.pause(); dispatch({ type: 'TIME_UP' }); }}>إنهاء</Button>
      </div>
      <div className="jabeen-word">{state.item ? state.item.text : '…'}</div>
      {useTouch ? (
        <div className="jabeen-touch">
          <button type="button" className="ok" onClick={() => answer(true)}><span aria-hidden="true">✅</span>صح</button>
          <button type="button" className="skip" onClick={() => answer(false)}><span aria-hidden="true">⏭</span>تخطي</button>
        </div>
      ) : (
        <div className="jabeen-touch"><button type="button" className="ok" style={{ gridColumn: '1 / -1', minHeight: 64 }} onClick={() => answer(true)}>أَمِل للأسفل = صح · للأعلى = تخطي</button></div>
      )}
    </div>
  );
}

export function Game({ api, players, onExit }) {
  const seed = useRef(randomSeed());
  const random = useMemo(() => mulberry32(seed.current), []);
  const options = useMemo(() => normalizeOptions(api.storage.get(OPTIONS_KEY), categories), [api.storage]);
  const category = useMemo(() => categories.find((c) => c.id === options.categoryId) || categories[0], [options.categoryId]);
  const source = useMemo(() => createItemSource(category, { random, seen: api.storage.get(SEEN_KEY, {}) || {} }), [category, random, api.storage]);
  const [state, dispatch] = useReducer(reduce, undefined, () => initialState(players, category, options));
  const [landscape, setLandscape] = useState(true);
  const timer = useTimer({ seconds: state.seconds, onEnd: () => { api.sound.play('buzzer'); api.haptics.vibrate('warning'); dispatch({ type: 'TIME_UP' }); } });
  const tilt = useTilt({ enabled: false, onDecision: () => {} });

  useEffect(() => { api.setInGame(state.phase !== 'over'); }, [state.phase, api]);
  useEffect(() => {
    const check = () => setLandscape(window.innerWidth >= window.innerHeight || window.innerWidth >= 700);
    check();
    window.addEventListener('resize', check);
    window.addEventListener('orientationchange', check);
    return () => { window.removeEventListener('resize', check); window.removeEventListener('orientationchange', check); };
  }, []);
  useEffect(() => { if (state.phase === 'play') { timer.reset(state.seconds); timer.start(); } else if (timer.running) timer.pause(); }, [state.phase]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (state.phase !== 'over') return;
    api.storage.set(SEEN_KEY, trimSeen(source.seen(), 1200));
    api.sound.play('fanfare'); api.haptics.vibrate('win'); api.confetti.fire();
  }, [state.phase]); // eslint-disable-line react-hooks/exhaustive-deps

  const entrant = state.phase === 'over' ? null : currentEntrant(state);

  return (
    <Screen className="jabeen" aria-label="على جبينك">
      <style>{css}</style>
      {state.phase === 'intro' && (
        <div className="jabeen-intro">
          <div className="big" aria-hidden="true">{entrant.emoji}</div>
          <h2>دور {entrant.name}</h2>
          <p className="muted">فئة «{state.categoryName}» · {state.seconds} ثانية</p>
          <p className="muted">ضع الجوال على جبينك والشاشة نحو الآخرين. هم يصفون وأنت تخمّن.</p>
          {tilt.needsPermission && <p className="jabeen-perm">سيطلب سفاري إذن استخدام مستشعر الحركة عند الضغط. إن رفضت، ستعمل اللعبة باللمس.</p>}
          <Button variant="accent" size="lg" full onClick={async () => { await tilt.request(); api.sound.play('whoosh'); dispatch({ type: 'BEGIN', item: source.next() }); }}>ابدأ الجولة</Button>
        </div>
      )}
      {state.phase === 'play' && (
        <>
          {!landscape && <div className="jabeen-rotate"><div><div className="big" aria-hidden="true">📱</div><p style={{ marginTop: 14, fontWeight: 800 }}>أدر الجوال أفقيًا</p><p className="muted">أسهل في القراءة من بعيد.</p><Button variant="ghost" onClick={() => setLandscape(true)}>تخطي هذا التنبيه</Button></div></div>}
          <Stage state={state} dispatch={dispatch} api={api} source={source} timer={timer} />
        </>
      )}
      {state.phase === 'review' && (
        <div className="stack">
          <h2 className="center" style={{ fontSize: 26, fontWeight: 900 }}>نتيجة {entrant.name}</h2>
          <p className="center muted">{state.results.filter((r) => r.ok).length} من {state.results.length} — المس أي كلمة لتصحيحها.</p>
          <div className="jabeen-review">
            {state.results.map((r, i) => (
              <button key={`${r.itemId}-${i}`} type="button" className={r.ok ? 'ok' : ''} aria-pressed={r.ok} onClick={() => { api.sound.play('click'); dispatch({ type: 'TOGGLE_RESULT', index: i }); }}>
                <span className="mark" aria-hidden="true">{r.ok ? '✓' : '—'}</span><span className="grow">{r.text}</span>
              </button>
            ))}
            {state.results.length === 0 && <p className="muted center">لم تُعرض كلمات في هذه الجولة.</p>}
          </div>
          <Button variant="accent" size="lg" full onClick={() => { api.sound.play('pop'); dispatch({ type: 'CONFIRM' }); }}>{state.turn === state.entrants.length - 1 ? 'النتائج النهائية' : 'اللاعب التالي'}</Button>
        </div>
      )}
      {state.phase === 'over' && (
        <div className="stack">
          <Podium entries={standings(state)} />
          <Button variant="accent" size="lg" full onClick={() => { api.sound.play('whoosh'); api.restart(); }}>العب مرة أخرى</Button>
          <Button variant="secondary" full onClick={api.backToSetup}>تغيير اللاعبين أو الفئة</Button>
          <Button variant="ghost" full onClick={onExit}>العودة للمنصة</Button>
        </div>
      )}
    </Screen>
  );
}

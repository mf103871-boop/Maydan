import React, { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Screen, Button, Podium, Segment, Card, Scoreboard } from '../../shared/ui/components.jsx';
import { PassPhoneScreen } from '../../shared/setup/PassPhoneScreen.jsx';
import { trimSeen } from '../../shared/lib/noRepeat.js';
import { mulberry32, randomSeed } from '../../shared/lib/rng.js';
import questions from '../../data/games/fabraka/questions.json';
import css from './fabraka.css';
import { initialState, reduce, currentWriter, currentVoter, standings, createQuestionSource, normalizeOptions, validateLie, votersFor, scoreRound, TRUTH_ID, ROUNDS } from './logic.js';

const OPTIONS_KEY = 'options';
const SEEN_KEY = 'seen';

export function SetupOptions({ storage, api }) {
  const [opts, setOpts] = useState(() => normalizeOptions(storage.get(OPTIONS_KEY)));
  const update = (patch) => { const next = normalizeOptions({ ...opts, ...patch }); setOpts(next); storage.set(OPTIONS_KEY, next); api.sound.play('click'); };
  return (
    <Card className="stack">
      <span className="card-title">عدد الجولات</span>
      <Segment accent label="الجولات" value={opts.rounds} onChange={(v) => update({ rounds: v })} options={ROUNDS.map((r) => ({ value: r, label: `${r} جولات` }))} />
      <p className="card-muted">كل جولة: كتابة سرية ثم تصويت ثم كشف.</p>
    </Card>
  );
}

function QuestionText({ question, filled }) {
  const parts = question.text.split('___');
  return (
    <div className="fab-q">
      {parts[0]}
      <span className="blank">{filled || '؟؟؟'}</span>
      {parts[1]}
    </div>
  );
}

export function Game({ api, players, onExit }) {
  const seed = useRef(randomSeed());
  const random = useMemo(() => mulberry32(seed.current), []);
  const options = useMemo(() => normalizeOptions(api.storage.get(OPTIONS_KEY)), [api.storage]);
  const source = useMemo(() => createQuestionSource(questions, { random, seen: api.storage.get(SEEN_KEY, {}) || {} }), [random, api.storage]);
  const [state, dispatch] = useReducer(reduce, undefined, () => initialState(players, options));
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');

  useEffect(() => { api.setInGame(state.phase !== 'over'); }, [state.phase, api]);
  useEffect(() => {
    if (state.phase !== 'over') return;
    api.storage.set(SEEN_KEY, trimSeen(source.seen(), 800));
    api.sound.play('fanfare'); api.haptics.vibrate('win'); api.confetti.fire();
  }, [state.phase]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (state.phase === 'reveal') { api.sound.play('drumroll'); } }, [state.revealIndex, state.phase]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = () => {
    const check = validateLie(draft, { truth: state.question.answer, taken: state.lies.map((l) => l.text) });
    if (!check.ok) { setError(check.message); api.haptics.vibrate('warning'); return; }
    setDraft(''); setError('');
    api.sound.play('pop');
    dispatch({ type: 'SUBMIT_LIE', text: check.text, random });
  };

  if (state.phase === 'over') {
    return (
      <Screen className="fabraka" aria-label="فبركة">
        <style>{css}</style>
        <div className="stack">
          <Podium entries={standings(state)} />
          <Button variant="accent" size="lg" full onClick={() => { api.sound.play('whoosh'); api.restart(); }}>العب مرة أخرى</Button>
          <Button variant="secondary" full onClick={api.backToSetup}>تغيير اللاعبين أو الجولات</Button>
          <Button variant="ghost" full onClick={onExit}>العودة للمنصة</Button>
        </div>
      </Screen>
    );
  }

  return (
    <Screen className="fabraka" aria-label="فبركة">
      <style>{css}</style>
      {state.phase === 'intro' && (
        <div className="fab-intro">
          <div className="big" aria-hidden="true">🕵️</div>
          <p className="muted">الجولة {state.round} من {state.rounds}</p>
          <h2 style={{ fontSize: 28, fontWeight: 900 }}>جهّزوا كذبة مقنعة</h2>
          <p className="muted">سيظهر سؤال فيه فراغ، ويمرّ الجوال على كل لاعب ليكتب إجابته المزيفة سرًا.</p>
          <Button variant="accent" size="lg" full onClick={() => { api.sound.play('whoosh'); dispatch({ type: 'BEGIN', question: source.next() }); }}>ابدأ الجولة</Button>
          <Scoreboard entries={state.players.map((p) => ({ ...p, score: state.scores[p.id] }))} />
        </div>
      )}

      {state.phase === 'write' && (
        <PassPhoneScreen player={currentWriter(state)} api={api} hint="اكتب إجابة مزيفة تبدو حقيقية، ولا تدع أحدًا يراها." ready="اكتب إجابتي">
          <div className="fab-writer">
            <QuestionText question={state.question} />
            <label className="field"><span>إجابتك المزيفة</span>
              <input className="input" value={draft} maxLength={60} autoFocus placeholder="اكتب رقمًا أو كلمة مقنعة…" onChange={(e) => { setDraft(e.target.value); setError(''); }} onKeyDown={(e) => e.key === 'Enter' && submit()} />
            </label>
            {error && <p className="setup-error" role="alert">{error}</p>}
            <p className="fab-hint">كلما بدت إجابتك حقيقية، خدعت أكثر — وكل من يخدع إجابتك يعطيك 500 نقطة.</p>
            <Button variant="accent" size="lg" full onClick={submit}>أخفِ إجابتي ومرّر ({state.writer + 1}/{state.players.length})</Button>
          </div>
        </PassPhoneScreen>
      )}

      {state.phase === 'vote' && (
        <PassPhoneScreen player={currentVoter(state)} api={api} hint="اختر ما تظنه الحقيقة. لا يمكنك اختيار إجابتك أنت." ready="أنا أصوّت">
          <div className="stack">
            <QuestionText question={state.question} />
            <p className="center muted">أيها الحقيقة يا {currentVoter(state).name}؟</p>
            <div className="stack" style={{ gap: 8 }}>
              {state.options.map((o) => (
                <button key={o.id} type="button" className="fab-opt" disabled={o.id === currentVoter(state).id}
                  onClick={() => { api.sound.play('click'); api.haptics.vibrate('selection'); dispatch({ type: 'VOTE', optionId: o.id }); }}>
                  <span className="grow">{o.text}</span>
                  {o.id === currentVoter(state).id && <span className="tag">إجابتك</span>}
                </button>
              ))}
            </div>
          </div>
        </PassPhoneScreen>
      )}

      {state.phase === 'reveal' && (() => {
        const shown = state.options.slice(0, state.revealIndex + 1);
        const option = state.options[state.revealIndex];
        const isTruth = option.id === TRUTH_ID;
        const author = isTruth ? null : state.players.find((p) => p.id === option.id);
        const fooled = votersFor(state, option.id);
        return (
          <div className="stack">
            <QuestionText question={state.question} />
            <div className="fab-reveal-head">
              <div className="big" aria-hidden="true">{isTruth ? '✅' : fooled.length ? '🎭' : '🙈'}</div>
              <h2 style={{ fontSize: 24, fontWeight: 900 }}>{option.text}</h2>
              <p className="muted">
                {isTruth ? 'هذه هي الحقيقة!' : author ? `كذبة ${author.name}` : ''}
                {fooled.length > 0 && ` — ${isTruth ? 'أصابها' : 'خدع'} ${fooled.map((f) => f.name).join('، ')}`}
                {fooled.length === 0 && !isTruth && ' — لم يخدع أحدًا'}
                {fooled.length === 0 && isTruth && ' — لم يصبها أحد!'}
              </p>
            </div>
            {isTruth && state.question.explanation && <p className="fab-explain">{state.question.explanation}</p>}
            <div className="stack" style={{ gap: 8 }}>
              {shown.map((o, i) => i === state.revealIndex ? null : (
                <div key={o.id} className={`fab-opt ${o.id === TRUTH_ID ? 'is-truth' : 'is-lie'}`}>
                  <span className="grow">{o.text}</span>
                  <span className="voters" aria-hidden="true">{votersFor(state, o.id).map((v) => v.emoji).join('')}</span>
                </div>
              ))}
            </div>
            <Button variant="accent" size="lg" full onClick={() => { api.sound.play('reveal'); dispatch({ type: 'REVEAL_NEXT' }); }}>
              {state.revealIndex + 1 < state.options.length ? 'التالي' : 'نتيجة الجولة'}
            </Button>
          </div>
        );
      })()}

      {state.phase === 'roundEnd' && (
        <div className="stack">
          <h2 className="center" style={{ fontSize: 26, fontWeight: 900 }}>نتيجة الجولة {state.round}</h2>
          <div className="fab-round-scores">
            {standings(state).map((p) => (
              <div key={p.id}>
                <span aria-hidden="true">{p.emoji}</span>
                <span className="grow">{p.name}</span>
                <b className={state.roundScores[p.id] ? '' : 'zero'}>+{state.roundScores[p.id] || 0}</b>
                <span className="badge">{p.score}</span>
              </div>
            ))}
          </div>
          <Button variant="accent" size="lg" full onClick={() => { api.sound.play('whoosh'); dispatch({ type: 'NEXT_ROUND' }); }}>{state.round >= state.rounds ? 'النتائج النهائية' : 'الجولة التالية'}</Button>
        </div>
      )}
    </Screen>
  );
}

import React, { useEffect, useReducer, useRef, useState } from 'react';
import { Screen, Button, Podium, Segment, Card, Scoreboard, Modal } from '../../shared/ui/components.jsx';
import { mulberry32, randomSeed } from '../../shared/lib/rng.js';
import { questions, pictures, personal, categories } from './content.js';
import { Illustration } from './Illustration.jsx';
import { OPTIONS_KEY, SEEN_KEY, loadSession, loadResult, saveSession } from './persistence.js';
import { initialState, reduce, currentActor, currentHost, standings, normalizeOptions, validateLie, votersFor, TRUTH_ID, ROUNDS, buildDeck, questionPool, turnKey, isSecret, multiplier, canVoteFor, restoreSession, awards, bestLies, factId } from './logic.js';
import css from './fabraka.css';

const MODE_LABELS = { classic: '🎭 حقائق', mixed: '✨ مزيج', pictures: '🖼️ صور', friends: '👋 أصحابنا' };
const MODE_HINTS = { classic: 'اكتبوا كذبة مقنعة لسؤال حقيقي غريب.', mixed: 'أسئلة حقيقية تتخللها جولة صور كل ثلاث جولات.', pictures: '12 رسمًا لأدوات حقيقية. فبركوا استخدامًا يبدو منطقيًا!', friends: 'صاحب الجولة يكتب الحقيقة عن نفسه، والبقية يفبركون ويصوّتون.' };
const PHASE_LABELS = { intro: 'استعدوا', host: 'صاحب الحقيقة', question: 'السؤال للجميع', write: 'كتابة سرية', discussion: 'نقاش', vote: 'تصويت سري', gather: 'اجتمعوا', reveal: 'وقت الكشف', roundEnd: 'حصيلة الجولة' };
const names = (state, ids) => state.players.filter((p) => ids.includes(p.id)).map((p) => p.name).join('، ');

export function SetupOptions({ storage, api }) {
  const [opts, setOpts] = useState(() => normalizeOptions(storage.get(OPTIONS_KEY)));
  const [resume] = useState(() => loadSession(storage));
  const [lastResult] = useState(() => loadResult(storage));
  const [showResult, setShowResult] = useState(false);
  const [tutorial, setTutorial] = useState(false);
  const pool = questionPool(questions, opts);
  const textNeeded = opts.mode === 'mixed' ? opts.rounds - Math.floor(opts.rounds / 3) : opts.rounds;
  const valid = !['classic', 'mixed'].includes(opts.mode) || pool.length >= textNeeded;
  const update = (patch) => {
    const next = normalizeOptions({ ...opts, ...patch });
    setOpts(next); storage.set(OPTIONS_KEY, next); api.setGameOptions?.(next); api.sound.play('click');
  };
  useEffect(() => { api.setSetupValid?.(valid); return () => api.setSetupValid?.(true); }, [api, valid]);
  useEffect(() => { api.setGameOptions?.(opts); }, [api, opts]);
  return <div className="fabraka fab-setup stack">
    <style>{css}</style>
    {resume && <Card className="fab-resume stack">
      <h2 className="card-title">لعبتكم بانتظاركم</h2>
      <p>{MODE_LABELS[resume.settings.mode]} · الجولة {resume.round} من {resume.rounds} · {resume.players.length} لاعبين</p>
      <p className="card-muted">{resume.players.map((p) => p.name).join('، ')} — {PHASE_LABELS[resume.phase]}</p>
      <Button variant="accent" full onClick={() => api.resumeGame(resume)}>استئناف اللعبة المحفوظة</Button>
      <p className="fab-hint">بدء لعبة جديدة بالزر أسفل الإعدادات يستبدل هذا التقدم.</p>
    </Card>}
    <Card className="stack">
      <h2 className="card-title">أي فبركة نلعب؟</h2>
      <div className="fab-modes" role="group" aria-label="نمط فبركة">
        {Object.entries(MODE_LABELS).map(([value, label]) => <button type="button" key={value} className={`fab-mode ${opts.mode === value ? 'selected' : ''}`} aria-pressed={opts.mode === value} onClick={() => update({ mode: value })}>{label}</button>)}
      </div>
      <p className="card-muted">{MODE_HINTS[opts.mode]}</p>
      {opts.mode === 'friends' ? <>
        <Segment accent label="دورات الأصحاب" value={opts.friendCycles} onChange={(friendCycles) => update({ friendCycles })} options={[{ value: 1, label: 'دور لكل لاعب' }, { value: 2, label: 'دوران لكل لاعب' }]} />
        <p className="fab-hint">عدد الجولات = عدد اللاعبين × عدد الأدوار. صاحب الحقيقة لا يكتب كذبة ولا يصوّت ولا يجمع نقاطًا في دوره، ولا توجد جولة مضاعفة في هذا النمط.</p>
      </> : <Segment accent label="عدد الجولات" value={opts.rounds} onChange={(rounds) => update({ rounds })} options={ROUNDS.map((r) => ({ value: r, label: `${r} جولات` }))} />}
      {['classic', 'mixed'].includes(opts.mode) && <>
        <Segment label="نوع الأسئلة" value={opts.style} onChange={(style) => update({ style })} options={[{ value: 'curious', label: 'غرائب مختارة' }, { value: 'all', label: 'كل الأسئلة' }]} />
        <details className="fab-details"><summary>المواضيع · {opts.categories.length ? `${opts.categories.length} مختارة` : 'الكل'}</summary>
          <div className="fab-categories">
            <button type="button" className="chip" aria-pressed={!opts.categories.length} onClick={() => update({ categories: [] })}>كل المواضيع</button>
            {categories.map((category) => <button key={category} type="button" className={`chip ${opts.categories.includes(category) ? 'selected' : ''}`} aria-pressed={opts.categories.includes(category)} onClick={() => update({ categories: opts.categories.includes(category) ? opts.categories.filter((c) => c !== category) : [...opts.categories, category] })}>{category}</button>)}
          </div>
        </details>
        <p className={valid ? 'fab-hint' : 'setup-error'} role={valid ? undefined : 'alert'}>{valid ? `${pool.length} سؤالًا متاحًا؛ الأولوية لما لم تلعبوه.` : `المتاح ${pool.length} أسئلة فقط. أضف موضوعًا أو اختر «كل الأسئلة» أو قلّل الجولات.`}</p>
      </>}
    </Card>
    <Card className="stack">
      <h2 className="card-title">إيقاع الجلسة</h2>
      <span>وقت الكتابة لكل لاعب</span>
      <Segment label="وقت الكتابة" value={opts.writeSeconds} onChange={(writeSeconds) => update({ writeSeconds })} options={[{ value: 0, label: 'براحتنا' }, { value: 45, label: '45 ثانية' }, { value: 30, label: 'سريع · 30' }]} />
      <span>النقاش قبل التصويت</span>
      <Segment label="وقت النقاش" value={opts.discussionSeconds} onChange={(discussionSeconds) => update({ discussionSeconds })} options={[{ value: 0, label: 'بدون' }, { value: 15, label: '15 ثانية' }, { value: 20, label: '20 ثانية' }]} />
      <label className="fab-toggle"><input type="checkbox" checked={opts.funnyVote} onChange={(e) => update({ funnyVote: e.target.checked })} /><span>😂 جائزة أكثر كذبة مضحكة<small>تصويت إضافي اختياري، بدون تغيير النقاط.</small></span></label>
      {opts.mode !== 'friends' && <label className="fab-toggle"><input type="checkbox" checked={opts.finalDouble} onChange={(e) => update({ finalDouble: e.target.checked })} /><span>🔥 مضاعفة الجولة الأخيرة<small>نقاط الحقيقة والخداع ×2.</small></span></label>}
      <p className="fab-hint">مساعدة واحدة لكل لاعب طوال اللعبة. يتوقف الوقت عند إخفاء الشاشة أو إيقاف اللعب.</p>
    </Card>
    <Button variant="secondary" full onClick={() => setTutorial(true)}>جرّبوا جولة تعليمية قصيرة</Button>
    {lastResult && <Button variant="ghost" full onClick={() => setShowResult(true)}>نتائج آخر جلسة</Button>}
    {tutorial && <Tutorial onClose={() => setTutorial(false)} />}
    {showResult && <Modal title="آخر جلسة فبركة" onClose={() => setShowResult(false)}><Results state={lastResult} /></Modal>}
  </div>;
}

function Tutorial({ onClose }) {
  const [step, setStep] = useState(0), [choice, setChoice] = useState(null);
  return <Modal title="جولة تدريبية · بلا نقاط" onClose={onClose}>
    <div className="fabraka stack">
      <p className="fab-q">للعنكبوت <span className="blank">{step === 2 ? '8' : '؟؟؟'}</span> أرجل.</p>
      {step === 0 && <><p>تخيّل أنك كتبت «6» سرًا. اختلطت إجابتك بإجابات الآخرين والحقيقة، من دون أسماء. ناقشوا الاحتمالات ثم صوّتوا سرًا.</p><Button variant="accent" onClick={() => setStep(1)}>أجرّب التصويت</Button></>}
      {step === 1 && <><p>اختر الحقيقة؛ لا يمكنك اختيار إجابتك «6».</p><div className="fab-training">{['6', '8', '10', '12'].map((n) => <button type="button" className="fab-opt" disabled={n === '6'} key={n} onClick={() => { setChoice(n); setStep(2); }}>{n}{n === '6' && ' · إجابتك'}</button>)}</div></>}
      {step === 2 && <><p>{choice === '8' ? 'أصبت! الحقيقة تمنحك 1000 نقطة.' : 'الحقيقة هي 8. صاحب الكذبة يحصل على 500 عن كل لاعب ينخدع بها.'}</p><p>تُكشف الإجابات على مراحل، وتبقى الحقيقة وأقوى كذبة للنهاية. التصويت المضحك يمنح لقبًا مستقلًا.</p><Button variant="accent" onClick={onClose}>فهمناها، جاهزون!</Button></>}
      <details className="fab-details"><summary>قواعد العدالة</summary><Rules /></details>
    </div>
  </Modal>;
}

function Rules() {
  return <ul className="fab-rules">
    <li>تثبت أول إجابة ترسلها. لا نكشف أثناء الكتابة هل طابقت الحقيقة أو إجابة أخرى.</li>
    <li>لو كتبت الحقيقة تُحسب لك 1000 مرة واحدة عند الكشف. تصويتك في هذه الجولة لا يمنح أحدًا نقاط خداع.</li>
    <li>تُدمج الإجابات المتطابقة في خيار واحد؛ كل صاحب كذبة يحصل على 500 لكل مصوّت مؤهل، ولا يختار أحد إجابته.</li>
    <li>المساعدة مرة واحدة في اللعبة؛ إجابة الجولة التي استعنت فيها لا تكسب نقاط خداع أو ضحكات. يمكنك كسب نقاط اكتشاف الحقيقة.</li>
    <li>إذا انتهى وقت الكتابة تُرسل مسودتك، أو يُمرر الدور إن كانت فارغة. وقت تمرير الجوال لا يُحسب.</li>
    <li>تظهر أسماء الكاتبين والمصوّتين وقت الكشف فقط. جائزة الضحك بلا نقاط، ويُكرّم جميع المتعادلين.</li>
  </ul>;
}

function QuestionText({ question, filled }) {
  const [before, after] = question.text.split('___');
  return <div className="fab-question">
    {question.kind === 'picture' && <Illustration question={question} />}
    <p className="fab-q">{before}<span className="blank">{filled || '؟؟؟'}</span>{after}</p>
  </div>;
}

function PrivacyGate({ state, act, children }) {
  const actor = currentActor(state);
  if (state.ready) return children;
  return <div className="fab-gate stack center" data-testid="privacy-gate">
    <span className="fab-avatar" style={{ '--player-color': actor.color }} aria-hidden="true">{actor.emoji}</span>
    <p className="muted">مرّر الجوال إلى</p><h2>{actor.name}</h2>
    <p className="muted">{state.phase === 'host' ? 'اكتب الحقيقة عن نفسك بعيدًا عن العيون.' : state.phase === 'write' ? 'إجابتك سرية. تأكد أن الشاشة لك وحدك.' : 'اختر الحقيقة ثم سلّم الجوال دون كشف اختيارك.'}</p>
    <Button variant="accent" size="lg" full onClick={() => act('READY')}>أنا {actor.name}، جاهز</Button>
    <p className="fab-hint">{state.phase === 'write' ? `الكاتب ${state.writer + 1} من ${state.order.length}` : state.phase === 'vote' ? `المصوّت ${state.voter + 1} من ${state.order.length}` : 'صاحب الجولة لا يشارك في التصويت'}</p>
  </div>;
}

function DraftPanel({ state, act }) {
  const [error, setError] = useState('');
  const host = state.phase === 'host';
  const actor = currentActor(state);
  const canSkip = host && state.deck.slice(Math.max(state.deckCursor, state.rounds)).some((q) => !state.usedFacts.includes(factId(q)));
  const submit = (e) => {
    e.preventDefault(); const check = validateLie(state.draft);
    if (!check.ok) { setError(check.message); return; }
    act(host ? 'SUBMIT_TRUTH' : 'SUBMIT_LIE');
  };
  return <form className="stack" onSubmit={submit}>
    <QuestionText question={state.question} />
    {!host && Boolean(state.settings.writeSeconds) && <div className={`fab-clock ${state.remaining <= 10 ? 'urgent' : ''}`} role="timer" aria-label="وقت الكتابة المتبقي">⏱ {state.remaining} ثانية</div>}
    <label className="field"><span>{host ? `إجابتك الحقيقية يا ${actor.name}` : `فبركتك يا ${actor.name}`}</span>
      <input className="input fab-input" value={state.draft} maxLength={60} autoFocus autoComplete="off" enterKeyHint="done" placeholder={host ? 'إجابة واضحة وقصيرة…' : 'كلمة أو رقم يبدو مقنعًا…'} onChange={(e) => { setError(''); act('DRAFT', { text: e.target.value }); }} />
    </label>
    {host && <details className="fab-details"><summary>صيغ أخرى صحيحة لنفس الإجابة (اختياري)</summary><label className="field"><span>حتى 3 صيغ، افصل بينها بـ ؛</span><input className="input" value={state.aliasesDraft} maxLength={180} placeholder="مثال: معكرونة؛ مكرونة" onChange={(e) => act('ALIASES', { text: e.target.value })} /></label></details>}
    {error && <p className="setup-error" role="alert">{error}</p>}
    <Button type="submit" variant="accent" full size="lg">{host ? 'ثبّت الحقيقة وأظهر السؤال للجميع' : 'ثبّت إجابتي وأخفِ الشاشة'}</Button>
    {host ? <><Button variant="ghost" full disabled={!canSkip} onClick={() => { setError(''); act('SKIP_PROMPT'); }}>سؤال آخر</Button><p className="fab-hint">بعد التثبيت، دع الآخرين يفبركون إجاباتك دون تلميحات منك.</p></> : <>
      <p className="fab-hint">تُثبّت الإجابة كما هي؛ تُعالج الصيغ المتطابقة عند الخلط، دون تلميح للحقيقة الآن.</p>
      {state.assisted && <p className="fab-note" role="status">استخدمت المساعدة لهذه الجولة؛ لن تكسب إجابتك نقاط خداع أو ضحكات حتى لو عدّلتها.</p>}
      <details className="fab-details"><summary>{state.helpUsed.includes(actor.id) ? 'استُخدمت مساعدتك الوحيدة' : 'تحتاج فكرة؟ مساعدة واحدة في اللعبة'}</summary><p className="fab-hint">نقترح إجابة جاهزة؛ تتنازل عن نقاط الخداع والضحك لهذه الجولة فقط، وتبقى نقاط اكتشاف الحقيقة متاحة.</p><Button variant="secondary" full disabled={state.helpUsed.includes(actor.id)} onClick={() => { setError(''); act('HELP'); }}>استخدم مساعدتي</Button></details>
      <Button variant="ghost" full onClick={() => act('SKIP_WRITE')}>أمرّر بدون إجابة</Button>
    </>}
  </form>;
}

function VotePanel({ state, act }) {
  const [choice, setChoice] = useState(undefined), [funny, setFunny] = useState(null);
  const actor = currentActor(state);
  const list = (value, onChange, label) => <div className="stack" role="group" aria-label={label}>
    {state.options.map((option) => <button key={option.id} type="button" className={`fab-opt ${value === option.id ? 'selected' : ''}`} disabled={!canVoteFor(state, actor.id, option.id)} aria-pressed={value === option.id} onClick={() => onChange(option.id)}>
      <span className="grow">{option.text}</span>{option.owners.includes(actor.id) && <span className="tag">إجابتك</span>}
    </button>)}
  </div>;
  return <div className="stack">
    <QuestionText question={state.question} />
    <h2 className="fab-heading">أين الحقيقة يا {actor.name}؟</h2>
    {list(choice, setChoice, 'اختيار الحقيقة')}
    <button type="button" className={`fab-abstain ${choice === null ? 'selected' : ''}`} aria-pressed={choice === null} onClick={() => setChoice(null)}>أمتنع عن تصويت الحقيقة</button>
    {state.settings.funnyVote && <details className="fab-details"><summary>😂 أي إجابة أضحكتك؟ (اختياري)</summary><p className="fab-hint">ترشيح مستقل بلا نقاط. لا يحتسب إن كانت الإجابة هي الحقيقة أو من المساعدة.</p>{list(funny, setFunny, 'اختيار الإجابة المضحكة')}<Button variant="ghost" full onClick={() => setFunny(null)}>بدون ترشيح مضحك</Button></details>}
    <Button variant="accent" full size="lg" disabled={choice === undefined} onClick={() => act('VOTE', { optionId: choice, funnyId: funny })}>ثبّت اختياراتي وأخفِ الشاشة</Button>
  </div>;
}

function Reveal({ state, act }) {
  const group = state.revealGroups[state.revealIndex];
  const final = state.revealIndex === state.revealGroups.length - 1;
  return <div className="stack">
    <QuestionText question={state.question} />
    <div className="fab-reveal-title center"><span aria-hidden="true">{final ? '⚡' : '🎭'}</span><h2>{final ? 'الحقيقة… أم أقوى فبركة؟' : 'نكشف هذه الإجابات'}</h2><p className="muted">{final ? 'الحقيقة بين هذين الخيارين. من أقنعكم؟' : 'نترك الحقيقة للمواجهة الأخيرة.'}</p></div>
    {group.map((id) => {
      const option = state.options.find((o) => o.id === id), truth = id === TRUTH_ID;
      const voters = votersFor(state, id), fooled = votersFor(state, id, { scoringOnly: true });
      const laughers = state.players.filter((p) => state.funnyVotes[p.id] === id);
      return <article key={id} className={`fab-reveal-card ${state.revealed ? truth ? 'is-truth' : 'is-lie' : ''}`}>
        <h3>{option.text}</h3>
        {state.revealed && <div className="stack fab-reveal-detail">
          <strong>{truth ? '✅ هذه هي الحقيقة!' : option.owners.length ? `🎭 كتبها: ${names(state, option.owners)}` : '🎲 إجابة أضافتها اللعبة'}</strong>
          <p>{voters.length ? `اختارها: ${voters.map((p) => p.name).join('، ')}` : 'لم يصوّت لها أحد.'}</p>
          {!truth && option.earners.length > 0 && <p>خدعت {fooled.length} · +{fooled.length * 500 * multiplier(state)} لكل كاتب مؤهل</p>}
          {!truth && option.owners.some((owner) => !option.earners.includes(owner)) && <p className="fab-hint">بعض الكاتبين استخدموا المساعدة؛ لا تُحسب لهم نقاط خداع أو ضحكات.</p>}
          {!truth && option.earners.length > 0 && laughers.length > 0 && <p>😂 أضحكت: {laughers.map((p) => p.name).join('، ')}</p>}
          {truth && state.truthWriters.length > 0 && <p>عرفها أثناء الكتابة: {names(state, state.truthWriters)} · تُحسب مرة واحدة.</p>}
        </div>}
      </article>;
    })}
    {state.revealed && final && <div className="fab-explain"><p>{state.question.explanation}</p>{state.question.sourceUrl && <a href={state.question.sourceUrl} target="_blank" rel="noreferrer">مصدر المعلومة ↗</a>}</div>}
    <Button variant="accent" full size="lg" onClick={() => act(state.revealed ? 'REVEAL_NEXT' : 'REVEAL')}>{state.revealed ? final ? 'حصيلة الجولة' : 'المجموعة التالية' : final ? 'اكشفوا الحقيقة!' : 'من كتبها؟ ومن صدّقها؟'}</Button>
  </div>;
}

function Results({ state }) {
  const honors = awards(state), highlights = bestLies(state);
  return <div className="fabraka stack">
    <Podium entries={standings(state)} />
    {honors.length > 0 && <div className="fab-awards">{honors.map((award) => <Card key={award.stat}><span className="fab-award-icon" aria-hidden="true">{award.emoji}</span><h3>{award.title}</h3><p>{award.players.map((p) => p.name).join('، ')}</p><small>{award.value} {award.stat === 'fooled' ? 'خدعات ناجحة' : award.stat === 'truths' ? 'حقائق مكتشفة' : 'أصوات ضحك'}</small></Card>)}</div>}
    <div className="fab-table-wrap"><table className="fab-stats"><caption>حصيلة الجلسة</caption><thead><tr><th scope="col">اللاعب</th><th scope="col">حقيقة</th><th scope="col">خداع</th>{state.settings.funnyVote && <th scope="col">ضحك</th>}<th scope="col">النقاط</th></tr></thead><tbody>{standings(state).map((p) => <tr key={p.id}><th scope="row">{p.emoji} {p.name}</th><td>{p.truths}</td><td>{p.fooled}</td>{state.settings.funnyVote && <td>{p.laughs}</td>}<td><b>{p.score}</b></td></tr>)}</tbody></table></div>
    {highlights.length > 0 && <div className="stack"><h2 className="fab-heading">فبركات تستحق التذكّر</h2>{highlights.map((h, i) => <Card key={`${h.round}-${i}`} className="stack"><small className="muted">الجولة {h.round} · {names(state, h.owners)}</small><p>{h.question}</p><blockquote>«{h.text}»</blockquote><p className="fab-hint">🎭 خدعت {h.fooled}{state.settings.funnyVote && ` · 😂 أضحكت ${h.laughs}`}</p></Card>)}</div>}
  </div>;
}

function RoundLaughAward({ state }) {
  const highlights = state.history.at(-1)?.highlights || [];
  const best = Math.max(0, ...highlights.map((h) => h.laughs));
  if (!best) return null;
  return <Card className="stack"><h3>😂 ضحكة الجولة</h3>{highlights.filter((h) => h.laughs === best).map((h, i) => <div key={i}><blockquote>«{h.text}»</blockquote><p className="fab-hint">{names(state, h.owners)} · {best} أصوات ضحك · جائزة بلا نقاط</p></div>)}</Card>;
}

function Clock({ state, act }) {
  const active = !state.paused && ((state.phase === 'write' && state.ready && state.settings.writeSeconds > 0) || state.phase === 'discussion');
  const key = turnKey(state), latest = useRef({ state, act });
  latest.current = { state, act };
  useEffect(() => {
    if (!active) return;
    const { state: start, act: send } = latest.current;
    const deadline = performance.now() + start.remaining * 1000;
    const timer = setInterval(() => {
      if (document.hidden) return;
      send('TICK', { remaining: Math.max(0, Math.ceil((deadline - performance.now()) / 1000)) });
    }, 200);
    return () => clearInterval(timer);
  }, [active, key]);
  useEffect(() => { if (active && state.remaining === 0) act('TIMEOUT'); }, [active, state.remaining, key]);
  return null;
}

export function Game({ api, players, onExit, savedSession = null, gameOptions = null }) {
  const [state, dispatch] = useReducer(reduce, null, () => {
    const saved = restoreSession(savedSession); if (saved) return saved;
    const seed = randomSeed(), settings = normalizeOptions(gameOptions || api.storage.get(OPTIONS_KEY));
    const deck = buildDeck({ questions, pictures, personal, options: settings, seen: api.storage.get(SEEN_KEY, {}) || {}, random: mulberry32(seed) });
    return initialState(players, settings, { deck, seed });
  });
  const [saveOk, setSaveOk] = useState(api.storage.persistent !== false);
  const key = turnKey(state), actor = currentActor(state);
  const act = (type, extra = {}) => {
    if (['SUBMIT_LIE', 'SUBMIT_TRUTH'].includes(type)) api.sound.play('pop');
    else if (['BEGIN', 'READY', 'START_WRITING', 'NEXT_ROUND'].includes(type)) api.sound.play('whoosh');
    else if (type === 'VOTE') { api.sound.play('click'); api.haptics.vibrate('selection'); }
    else if (type === 'TIMEOUT') api.sound.play('timeout');
    dispatch({ type, round: state.round, key, playerId: actor?.id, ...extra });
  };
  const latestAct = useRef(act); latestAct.current = act;
  useEffect(() => {
    api.setBeforeExit?.(() => latestAct.current('PAUSE'));
    return () => api.setBeforeExit?.(null);
  }, [api]);
  useEffect(() => {
    const ok = saveSession(api.storage, state); setSaveOk(ok);
    api.setExitMessage?.(ok ? 'تقدم فبركة محفوظ على هذا الجهاز. يمكنك استئناف اللعبة من إعداداتها عند العودة.' : 'تعذر حفظ آخر تقدم. مغادرة اللعبة أو إغلاق الصفحة قد يفقد هذه الجلسة.');
  }, [state, api]);
  useEffect(() => { api.setInGame(state.phase !== 'over'); }, [state.phase, api]);
  useEffect(() => {
    const hide = () => { if (document.hidden) latestAct.current('PAUSE'); };
    document.addEventListener('visibilitychange', hide);
    return () => document.removeEventListener('visibilitychange', hide);
  }, []);
  useEffect(() => {
    if (state.phase === 'over') { api.sound.play('fanfare'); api.haptics.vibrate('win'); api.confetti.fire(); }
    else if (state.phase === 'reveal') { api.sound.play(state.revealed ? 'reveal' : 'drumroll'); }
  }, [state.phase, state.revealIndex, state.revealed]);
  useEffect(() => {
    if (!state.paused && state.remaining > 0 && state.remaining <= 5 && ((state.phase === 'write' && state.ready) || state.phase === 'discussion')) api.sound.play('tick');
  }, [state.remaining, state.phase, state.ready, state.paused]);

  return <Screen className="fabraka stack" aria-label="فبركة">
    <style>{css}</style><Clock state={state} act={act} />
    {state.phase !== 'over' && <header className="fab-bar"><div><b>الجولة {state.round} / {state.rounds}</b><small>{PHASE_LABELS[state.phase]}{multiplier(state) === 2 && ' · 🔥 نقاط مضاعفة'}</small></div><Button variant="ghost" size="sm" onClick={() => act('PAUSE')}>إيقاف مؤقت</Button></header>}
    {!saveOk && <p className="fab-save-error" role="alert">تعذر حفظ التقدم على الجهاز. أبقِ الصفحة مفتوحة لإكمال الجلسة.</p>}
    {state.paused ? <div className="stack center fab-pause"><span className="fab-big" aria-hidden="true">⏸️</span><h2>خذوا راحتكم</h2><p className="muted">الوقت متوقف والإجابات مخفية.</p><p className="fab-hint">{saveOk ? 'تقدمكم محفوظ على هذا الجهاز.' : 'الحفظ غير متاح حاليًا؛ تابعوا من هذه الصفحة.'}</p><Button variant="accent" size="lg" full onClick={() => act('RESUME')}>متابعة اللعب</Button><details className="fab-details"><summary>تذكير بالقواعد</summary><Rules /></details></div> : <>
      {state.phase === 'intro' && <div className="fab-intro stack center"><span className="fab-big" aria-hidden="true">{state.settings.mode === 'friends' ? '👋' : '🎭'}</span><h2>{state.settings.mode === 'friends' ? `دور ${state.players[(state.round - 1) % state.players.length].name}` : multiplier(state) === 2 ? 'الجولة الأخيرة… كل نقطة باثنتين!' : 'جهّزوا كذبة مقنعة'}</h2><p className="muted">{state.settings.mode === 'friends' ? 'يكتب صاحب الجولة الحقيقة عن نفسه أولًا؛ البقية يحاولون تقليده وخداع بعضهم.' : 'شاهدوا السؤال معًا، ثم اكتبوا سرًا، ناقشوا، وصوّتوا.'}</p><Button variant="accent" size="lg" full onClick={() => act('BEGIN')}>ابدأ الجولة</Button><Scoreboard entries={standings(state)} />{state.round === 1 && <details className="fab-details"><summary>كيف نحسب النقاط؟</summary><Rules /></details>}</div>}
      {state.phase === 'question' && <div className="stack center"><span className="fab-eyebrow">{state.question.category} · اقرأوا السؤال معًا</span><QuestionText question={state.question} />{state.hostId && <p className="fab-note">{currentHost(state).name} ثبّت الحقيقة. البقية يكتبون؛ صاحب الحقيقة يلتزم الصمت حتى الكشف.</p>}<p className="muted">فكّروا بإجابة قصيرة تبدو حقيقية. ترتيب الكتابة يتبدّل في كل جولة.</p><Button variant="accent" size="lg" full onClick={() => act('START_WRITING')}>فهمنا السؤال، نبدأ الكتابة</Button></div>}
      {isSecret(state) && <PrivacyGate state={state} act={act}>{state.phase === 'vote' ? <VotePanel key={key} state={state} act={act} /> : <DraftPanel key={key} state={state} act={act} />}</PrivacyGate>}
      {state.phase === 'discussion' && <div className="stack"><QuestionText question={state.question} /><div className="fab-discussion center"><h2>دافعوا عن أي إجابة… أو شكّكوا فيها!</h2><p className="muted">الأسماء مخفية. لا تُظهروا إجاباتكم على الجوال.{state.hostId && ' صاحب الحقيقة يسمع فقط.'}</p><div className="fab-clock" role="timer" aria-label="وقت النقاش المتبقي">⏱ {state.remaining} ثانية</div></div>{state.options.map((o) => <div className="fab-opt" key={o.id}>{o.text}</div>)}<Button variant="secondary" full onClick={() => act('START_VOTE')}>جاهزون، نبدأ التصويت السري</Button></div>}
      {state.phase === 'gather' && <div className="stack center fab-intro"><span className="fab-big" aria-hidden="true">👀</span><h2>اجتمعوا حول الشاشة</h2><p className="muted">انتهى التصويت. سنكشف أصحاب الإجابات ومن صدّقهم، ونترك الحقيقة وأقوى كذبة للنهاية.</p><Button variant="accent" size="lg" full onClick={() => act('START_REVEAL')}>ابدأوا الكشف</Button></div>}
      {state.phase === 'reveal' && <Reveal state={state} act={act} />}
      {state.phase === 'roundEnd' && <div className="stack"><h2 className="fab-heading">حصيلة الجولة {state.round}</h2><div className="fab-round-scores">{standings(state).map((p) => { const b = state.breakdown[p.id]; return <article key={p.id}><div><span aria-hidden="true">{p.emoji}</span><b>{p.name}</b><strong>+{b.points}</strong><span className="badge">{p.score}</span></div><p>{b.host ? 'صاحب الحقيقة · يرتاح من النقاط هذا الدور' : `${b.byWriting ? 'كتب الحقيقة' : `حقيقة: ${b.truth}`} · خداع: ${b.fooled}${state.settings.funnyVote ? ` · ضحك: ${b.laughs}` : ''}`}</p></article>; })}</div>{state.settings.funnyVote && <RoundLaughAward state={state} />}<Button variant="accent" size="lg" full onClick={() => act('NEXT_ROUND')}>{state.round === state.rounds ? 'النتائج والألقاب' : 'الجولة التالية'}</Button></div>}
      {state.phase === 'over' && <div className="stack"><Results state={state} /><Button variant="accent" size="lg" full onClick={api.restart}>نلعب مرة ثانية</Button><Button variant="secondary" full onClick={api.backToSetup}>تغيير النمط أو اللاعبين</Button><Button variant="ghost" full onClick={onExit}>العودة إلى ميدان</Button></div>}
    </>}
  </Screen>;
}

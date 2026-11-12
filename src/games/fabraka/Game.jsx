import { tr } from '../../shared/i18n/core.js';
import { Avatar, GameArtwork } from '../../shared/brand/art.jsx';
import { useGameMusicScene } from '../../shared/fx/useGameMusicScene.js';
import { useCandidateDeadlineWarning } from '../../shared/fx/useDeadlineAudio.js';
import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { socialInterruption } from '../../social/interruption.js';
import { Screen, Button, Podium, Segment, Card, Scoreboard, Modal, CountUp } from '../../shared/ui/components.jsx';
import { flashScreen, stampScreen, vignette, burstConfetti, wait } from '../../shared/fx/index.js';
import { useReaction } from '../../shared/ui/useReaction.js';
import { PassPhoneLock } from '../../shared/setup/PassPhoneScreen.jsx';
import { IconCheck, IconInfo } from '../../shared/ui/icons.jsx';
import { mulberry32, randomSeed } from '../../shared/lib/rng.js';
import { pictures, getFabrakaContent, categoryCount, normalizeContentOptions } from './content.js';
import { stampContentIdentity } from '../../shared/lib/content-storage.js';
import { Illustration } from './Illustration.jsx';
import { OPTIONS_KEY, SEEN_KEY, loadSession, loadResult, saveSession, hasRetiredSession } from './persistence.js';
import { initialState, reduce, currentActor, currentHost, standings, validateLie, votersFor, TRUTH_ID, ROUNDS, buildDeck, questionPool, turnKey, isSecret, multiplier, canVoteFor, restoreSession, awards, bestLies, factId } from './logic.js';
import css from './fabraka.css';

const MODE_LABELS = { classic: '🎭 حقائق', mixed: '✨ مزيج', pictures: '🖼️ صور', friends: '👋 أصحابنا' };
const MODE_HINTS = { classic: 'اكتبوا كذبة مقنعة لسؤال حقيقي غريب.', mixed: 'أسئلة حقيقية تتخللها جولة صور كل ثلاث جولات.', pictures: "{v0} صورة توضيحية لأدوات حقيقية. فبركوا استخدامًا يبدو منطقيًا!", friends: 'صاحب الجولة يكتب الحقيقة عن نفسه، والبقية يفبركون ويصوّتون.' };
const PHASE_LABELS = { intro: 'استعدوا', host: 'صاحب الحقيقة', question: 'السؤال للجميع', write: 'كتابة سرية', discussion: 'نقاش', vote: 'تصويت سري', gather: 'اجتمعوا', reveal: 'وقت الكشف', roundEnd: 'حصيلة الجولة' };
const names = (state, ids) => state.players.filter((p) => ids.includes(p.id)).map((p) => p.name).join('، ');

export function SetupOptions({ storage, api }) {
  const { questions, categories } = useMemo(() => getFabrakaContent(api.contentLocale, api.contentVersion), [api.contentLocale, api.contentVersion]);
  const [opts, setOpts] = useState(() => normalizeContentOptions(storage.get(OPTIONS_KEY), api.contentLocale, api.contentVersion));
  const [resume] = useState(() => loadSession(storage));
  const [retiredSession] = useState(() => hasRetiredSession(storage));
  const [lastResult] = useState(() => loadResult(storage));
  const [showResult, setShowResult] = useState(false);
  const [tutorial, setTutorial] = useState(false);
  const pool = questionPool(questions, opts);
  const textNeeded = opts.mode === 'mixed' ? opts.rounds - Math.floor(opts.rounds / 3) : opts.rounds;
  const valid = !['classic', 'mixed'].includes(opts.mode) || pool.length >= textNeeded;
  const update = (patch) => {
    const next = normalizeContentOptions({ ...opts, ...patch }, api.contentLocale, api.contentVersion);
    // موضوع بلا أسئلة في النمط المختار تركيبة مسدودة، فلا نبقيه محددًا بعد تبديل النمط.
    next.categories = next.categories.filter((c) => categoryCount(c, next.style, api.contentLocale, api.contentVersion) > 0);
    setOpts(next); storage.set(OPTIONS_KEY, next); api.setGameOptions?.(next);
  };
  useEffect(() => { api.setSetupValid?.(valid); return () => api.setSetupValid?.(true); }, [api, valid]);
  useEffect(() => { api.setGameOptions?.(opts); }, [api, opts]);
  return <div data-design-screen="setup.fabraka" data-design-id="options" className="fabraka fab-setup stack">
    <style>{css}</style>
    {retiredSession && <p className="fab-note" role="status">{tr("تجدّدت أسئلة فبركة وصورها. ابدأوا جلسة جديدة؛ الجلسة القديمة غير قابلة للاستئناف، ونتائجكم السابقة محفوظة.")}</p>}
    {resume && <Card className="fab-resume stack">
      <h2 className="card-title">{tr("لعبتكم بانتظاركم")}</h2>
      <p>{tr(MODE_LABELS[resume.settings.mode])}{tr(" · الجولة ")}{resume.round}{tr(" من ")}{resume.rounds} · {resume.players.length}{tr(" لاعبين")}</p>
      <p className="card-muted">{resume.players.map((p) => p.name).join('، ')} — {tr(PHASE_LABELS[resume.phase])}</p>
      <Button data-design-id="resume" data-design-required="true" variant="accent" full onClick={() => api.resumeGame(resume)}>{tr("استئناف اللعبة المحفوظة")}</Button>
      <p className="fab-hint">{tr("بدء لعبة جديدة بالزر أسفل الإعدادات يستبدل هذا التقدم.")}</p>
    </Card>}
    <Card className="stack">
      <h2 className="card-title">{tr("أي فبركة نلعب؟")}</h2>
      <div className="fab-modes" role="group" aria-label={tr("نمط فبركة")}>
        {Object.entries(MODE_LABELS).map(([value, label]) => <button data-design-id="option" type="button" key={value} className={`fab-mode ${opts.mode === value ? 'selected' : ''}`} aria-pressed={opts.mode === value} onClick={() => update({ mode: value })}>{tr(label)}</button>)}
      </div>
      <p className="card-muted">{tr(MODE_HINTS[opts.mode], {v0:pictures.length})}</p>
      {opts.mode === 'friends' ? <>
        <Segment data-design-id="setting-cycles" accent label={tr("دورات الأصحاب")} value={opts.friendCycles} onChange={(friendCycles) => update({ friendCycles })} options={[{ value: 1, label: tr("دور لكل لاعب") }, { value: 2, label: tr("دوران لكل لاعب") }]} />
        <p className="fab-hint">{tr("عدد الجولات = عدد اللاعبين × عدد الأدوار. صاحب الحقيقة لا يكتب كذبة ولا يصوّت ولا يجمع نقاطًا في دوره، ولا توجد جولة مضاعفة في هذا النمط.")}</p>
      </> : <Segment data-design-id="setting-rounds" accent label={tr("عدد الجولات")} value={opts.rounds} onChange={(rounds) => update({ rounds })} options={ROUNDS.map((r) => ({ value: r, label: tr("{v0} جولات", {v0: r}) }))} />}
      {['classic', 'mixed'].includes(opts.mode) && <>
        <Segment data-design-id="setting-style" label={tr("نوع الأسئلة")} value={opts.style} onChange={(style) => update({ style })} options={[{ value: 'curious', label: tr("غرائب مختارة") }, { value: 'all', label: tr("كل الأسئلة") }]} />
        <details className="fab-details"><summary>{tr("المواضيع · ")}{opts.categories.length ? tr("{v0} مختارة", {v0: opts.categories.length}) : tr("الكل")}</summary>
          <div className="fab-categories">
            <button data-design-id="category-card" type="button" className="chip" aria-pressed={!opts.categories.length} onClick={() => update({ categories: [] })}>{tr("كل المواضيع")}</button>
            {categories.map((category) => { const count = categoryCount(category, opts.style, api.contentLocale, api.contentVersion); return <button data-design-id="category-card" key={category} type="button" className={`chip ${opts.categories.includes(category) ? 'selected' : ''}`} disabled={count === 0} aria-pressed={opts.categories.includes(category)} title={count === 0 ? tr("لا غرائب في هذا الموضوع؛ اختر «كل الأسئلة»") : tr("{v0} سؤالًا", {v0: count})} onClick={() => update({ categories: opts.categories.includes(category) ? opts.categories.filter((c) => c !== category) : [...opts.categories, category] })}>{category} <small>{count}</small></button>; })}
          </div>
        </details>
        <p className={valid ? 'fab-hint' : 'setup-error'} role={valid ? undefined : 'alert'}>{valid ? tr("{v0} سؤالًا متاحًا؛ الأولوية لما لم تلعبوه.", {v0: pool.length}) : tr("المتاح {v0} أسئلة فقط. أضف موضوعًا أو اختر «كل الأسئلة» أو قلّل الجولات.", {v0: pool.length})}</p>
      </>}
    </Card>
    <details className="fab-details fab-pacing">
      <summary>{tr("الإيقاع والتخصيص")}</summary>
      <Card className="stack">
        <span>{tr("وقت الكتابة لكل لاعب")}</span>
        <Segment data-design-id="setting-write-time" label={tr("وقت الكتابة")} value={opts.writeSeconds} onChange={(writeSeconds) => update({ writeSeconds })} options={[{ value: 0, label: tr("براحتنا") }, { value: 45, label: tr("45 ثانية") }, { value: 30, label: tr("سريع · 30") }]} />
        <span>{tr("النقاش قبل التصويت")}</span>
        <Segment data-design-id="setting-discussion-time" label={tr("وقت النقاش")} value={opts.discussionSeconds} onChange={(discussionSeconds) => update({ discussionSeconds })} options={[{ value: 0, label: tr("بدون") }, { value: 15, label: tr("15 ثانية") }, { value: 20, label: tr("20 ثانية") }]} />
        <label className="fab-toggle"><input data-design-id="setting-funny" type="checkbox" checked={opts.funnyVote} onChange={(e) => update({ funnyVote: e.target.checked })} /><span>{tr("😂 جائزة أكثر كذبة مضحكة")}<small>{tr("تصويت إضافي اختياري، بدون تغيير النقاط.")}</small></span></label>
        {opts.mode !== 'friends' && <label className="fab-toggle"><input data-design-id="setting-double" type="checkbox" checked={opts.finalDouble} onChange={(e) => update({ finalDouble: e.target.checked })} /><span>{tr("🔥 مضاعفة الجولة الأخيرة")}<small>{tr("نقاط الحقيقة والخداع ×2.")}</small></span></label>}
        <p className="fab-hint">{tr("مساعدة واحدة لكل لاعب طوال اللعبة. يتوقف الوقت عند إخفاء الشاشة أو إيقاف اللعب.")}</p>
      </Card>
    </details>
    <Button data-design-id="rules" variant="secondary" full onClick={() => setTutorial(true)}>{tr("جرّبوا جولة تعليمية قصيرة")}</Button>
    {lastResult && <Button data-design-id="history" variant="ghost" full onClick={() => setShowResult(true)}>{tr("نتائج آخر جلسة")}</Button>}
    {tutorial && <Tutorial onClose={() => setTutorial(false)} />}
    {showResult && <Modal title={tr("آخر جلسة فبركة")} onClose={() => setShowResult(false)}><Results state={lastResult} /></Modal>}
  </div>;
}

function Tutorial({ onClose }) {
  const [step, setStep] = useState(0), [choice, setChoice] = useState(null);
  return <Modal title={tr("جولة تدريبية · بلا نقاط")} onClose={onClose}>
    <div className="fabraka stack">
      <p className={step === 2 ? 'fab-q is-filled' : 'fab-q'}>{tr("للعنكبوت ")}<span className="blank">{step === 2 ? '8' : tr('؟؟؟')}</span>{tr(" أرجل.")}</p>
      {/* محتوى كل خطوة مفتاحه رقمها فيدخل بحركة صف عند الانتقال */}
      <div key={step} className="fab-tutorial-step stack">
        {step === 0 && <><p>{tr("تخيّل أنك كتبت «6» سرًا. اختلطت إجابتك بإجابات الآخرين والحقيقة، من دون أسماء. ناقشوا الاحتمالات ثم صوّتوا سرًا.")}</p><Button data-design-id="continue" data-design-required="true" variant="accent" onClick={() => setStep(1)}>{tr("أجرّب التصويت")}</Button></>}
        {step === 1 && <><p>{tr("اختر الحقيقة؛ لا يمكنك اختيار إجابتك «6».")}</p><div className="fab-training">{['6', '8', '10', '12'].map((n) => <button type="button" data-design-id="option" className="fab-opt" disabled={n === '6'} key={n} onClick={() => { setChoice(n); setStep(2); }}>{n}{n === '6' && tr(" · إجابتك")}</button>)}</div></>}
        {step === 2 && <><p>{choice === '8' ? tr("أصبت! الحقيقة تمنحك 1000 نقطة.") : tr("الحقيقة هي 8. صاحب الكذبة يحصل على 500 عن كل لاعب ينخدع بها.")}</p><p>{tr("تُكشف الإجابات على مراحل، وتبقى الحقيقة وأقوى كذبة للنهاية. التصويت المضحك يمنح لقبًا مستقلًا.")}</p><Button data-design-id="continue" data-design-required="true" variant="accent" onClick={onClose}>{tr("فهمناها، جاهزون!")}</Button></>}
      </div>
      <details className="fab-details"><summary>{tr("قواعد العدالة")}</summary><Rules /></details>
    </div>
  </Modal>;
}

function Rules() {
  return <ul className="fab-rules">
    <li>{tr("تثبت أول إجابة ترسلها. لا نكشف أثناء الكتابة هل طابقت الحقيقة أو إجابة أخرى.")}</li>
    <li>{tr("لو كتبت الحقيقة تُحسب لك 1000 مرة واحدة عند الكشف. تصويتك في هذه الجولة لا يمنح أحدًا نقاط خداع.")}</li>
    <li>{tr("تُدمج الإجابات المتطابقة في خيار واحد؛ كل صاحب كذبة يحصل على 500 لكل مصوّت مؤهل، ولا يختار أحد إجابته.")}</li>
    <li>{tr("المساعدة مرة واحدة في اللعبة؛ إجابة الجولة التي استعنت فيها لا تكسب نقاط خداع أو ضحكات. يمكنك كسب نقاط اكتشاف الحقيقة.")}</li>
    <li>{tr("إذا انتهى وقت الكتابة تُرسل مسودتك، أو يُمرر الدور إن كانت فارغة. وقت تمرير الجوال لا يُحسب.")}</li>
    <li>{tr("تظهر أسماء الكاتبين والمصوّتين وقت الكشف فقط. جائزة الضحك بلا نقاط، ويُكرّم جميع المتعادلين.")}</li>
  </ul>;
}

function QuestionText({ question, filled }) {
  const [before, after] = question.text.split('___');
  return <div data-design-id="question" className="fab-question">
    <p className={filled ? 'fab-q is-filled' : 'fab-q'}>{before}<span className="blank">{filled || tr('؟؟؟')}</span>{after}</p>
    {question.kind === 'picture' && <Illustration question={question} />}
  </div>;
}

// مؤقت الكتابة/النقاش: الرقم مفتاحه الثانية عند الاستعجال فيُلكم كل ثانية (الحلقة والنبض من CSS).
function ClockPill({ remaining, urgent, label }) {
  return <div data-design-id="timer" className={`fab-clock ${urgent ? 'urgent' : ''}`} role="timer" aria-label={label}>⏱ <b key={urgent ? remaining : 'n'}>{remaining}</b>{tr(" ثانية")}</div>;
}

function PrivacyGate({ state, act, children }) {
  const actor = currentActor(state);
  const [reaction, react] = useReaction();
  if (state.ready) return children;
  return <div data-design-id="privacy" data-design-required="true" className="fab-gate stack center" data-testid="privacy-gate">
    <PassPhoneLock />
    <h2>{tr("سلّم الجوال إلى ")}{actor.name}</h2>
    <p className="fab-gate-hint"><IconInfo /> {state.phase === 'host' ? tr("اكتب الحقيقة عن نفسك بعيدًا عن العيون.") : state.phase === 'write' ? tr("إجابتك سرية. تأكد أن الشاشة لك وحدك.") : tr("اختر الحقيقة ثم سلّم الجوال دون كشف اختيارك.")}</p>
    <span className={`fab-avatar clay-stage clay-idle ${reaction}`} style={{ '--player-color': actor.color }} aria-hidden="true"><span className="clay-lift"><Avatar player={actor} /></span></span>
    <Button data-design-id="continue" data-design-required="true" variant="accent" size="lg" full onClick={() => { react('clay-squash'); act('READY'); }}><IconCheck />{tr(" أنا ")}{actor.name}{tr("، جاهز")}</Button>
    <p className="fab-hint">{state.phase === 'write' ? tr("الكاتب {v0} من {v1}", {v0: state.writer + 1, v1: state.order.length}) : state.phase === 'vote' ? tr("المصوّت {v0} من {v1}", {v0: state.voter + 1, v1: state.order.length}) : tr("صاحب الجولة لا يشارك في التصويت")}</p>
  </div>;
}

function DraftPanel({ state, act }) {
  const [error, setError] = useState('');
  const [nudge, react] = useReaction();   // اهتزاز اللوحة عند التمرير (الإرسال فوري)
  const host = state.phase === 'host';
  const actor = currentActor(state);
  const canSkip = host && state.deck.slice(Math.max(state.deckCursor, state.rounds)).some((q) => !state.usedFacts.includes(factId(q)));
  const submit = (e) => {
    e.preventDefault(); const check = validateLie(state.draft, state.settings.contentLocale);
    if (!check.ok) { setError(check.message); return; }
    act(host ? 'SUBMIT_TRUTH' : 'SUBMIT_LIE');
  };
  const skip = (type) => { setError(''); react('is-skipping', 300); act(type); };
  return <form data-design-id="draft" className={`stack fab-panel ${nudge}`} onSubmit={submit}>
    <p className={`fab-mode-pill ${host ? 'is-private' : ''}`}>{host ? tr("وضع أصحابنا · خاص") : tr(MODE_LABELS[state.settings.mode])}</p>
    <QuestionText question={state.question} />
    {!host && Boolean(state.settings.writeSeconds) && <ClockPill remaining={state.remaining} urgent={state.remaining <= 10} label={tr("وقت الكتابة المتبقي")} />}
    <label className="field"><span>{host ? tr("إجابتك الحقيقية يا {v0}", {v0: actor.name}) : tr("فبركتك يا {v0}", {v0: actor.name})}</span>
      <input data-design-id="answer-input" className="input fab-input" value={state.draft} maxLength={60} autoFocus autoComplete="off" enterKeyHint="done" placeholder={host ? tr("إجابة واضحة وقصيرة…") : tr("كلمة أو رقم يبدو مقنعًا…")} onChange={(e) => { setError(''); act('DRAFT', { text: e.target.value }); }} />
    </label>
    {host && <details className="fab-details"><summary>{tr("صيغ أخرى صحيحة لنفس الإجابة (اختياري)")}</summary><label className="field"><span>{tr("حتى 3 صيغ، افصل بينها بـ ؛")}</span><input data-design-id="answer-aliases" className="input" value={state.aliasesDraft} maxLength={180} placeholder={tr("مثال: معكرونة؛ مكرونة")} onChange={(e) => act('ALIASES', { text: e.target.value })} /></label></details>}
    {error && <p className="setup-error" role="alert">{error}</p>}
    <Button data-design-id="submit" data-design-required="true" type="submit" variant="accent" full size="lg">{host ? tr("ثبّت الحقيقة وأظهر السؤال للجميع") : tr("ثبّت إجابتي وأخفِ الشاشة")}</Button>
    {host ? <><Button data-design-id="skip" variant="ghost" full disabled={!canSkip} onClick={() => skip('SKIP_PROMPT')}>{tr("سؤال آخر")}</Button><p className="fab-hint">{tr("بعد التثبيت، دع الآخرين يفبركون إجاباتك دون تلميحات منك.")}</p></> : <>
      <p className="fab-hint">{tr("تُثبّت الإجابة كما هي؛ تُعالج الصيغ المتطابقة عند الخلط، دون تلميح للحقيقة الآن.")}</p>
      {state.assisted && <p className="fab-note" role="status">{tr("استخدمت المساعدة لهذه الجولة؛ لن تكسب إجابتك نقاط خداع أو ضحكات حتى لو عدّلتها.")}</p>}
      <details className="fab-details"><summary>{state.helpUsed.includes(actor.id) ? tr("استُخدمت مساعدتك الوحيدة") : tr("تحتاج فكرة؟ مساعدة واحدة في اللعبة")}</summary><p className="fab-hint">{tr("نقترح إجابة جاهزة؛ تتنازل عن نقاط الخداع والضحك لهذه الجولة فقط، وتبقى نقاط اكتشاف الحقيقة متاحة.")}</p><Button data-design-id="assistance" variant="secondary" full disabled={state.helpUsed.includes(actor.id)} onClick={() => { setError(''); act('HELP'); }}>{tr("استخدم مساعدتي")}</Button></details>
      <Button data-design-id="skip" variant="ghost" full onClick={() => skip('SKIP_WRITE')}>{tr("أمرّر بدون إجابة")}</Button>
    </>}
  </form>;
}

function VotePanel({ state, act }) {
  const [choice, setChoice] = useState(undefined), [funny, setFunny] = useState(null);
  const actor = currentActor(state);
  const list = (value, onChange, label) => <div className="stack" role="group" aria-label={label}>
    {state.options.map((option) => <button data-design-id="option" key={option.id} type="button" className={`fab-opt ${value === option.id ? 'selected' : ''}`} disabled={!canVoteFor(state, actor.id, option.id)} aria-pressed={value === option.id} onClick={() => onChange(option.id)}>
      <span className="fab-choice-dot" aria-hidden="true" /><span className="grow">{option.text}</span>{option.owners.includes(actor.id) && <span className="tag">{tr("إجابتك")}</span>}
    </button>)}
  </div>;
  return <div className="stack">
    <QuestionText question={state.question} />
    <h2 className="fab-question-label">{tr("أين الحقيقة يا ")}{actor.name}؟</h2>
    {list(choice, setChoice, tr("اختيار الحقيقة"))}
    <button data-design-id="skip" type="button" className={`fab-abstain ${choice === null ? 'selected' : ''}`} aria-pressed={choice === null} onClick={() => setChoice(null)}>{tr("أمتنع عن تصويت الحقيقة")}</button>
    {state.settings.funnyVote && <details className="fab-details"><summary>{tr("😂 أي إجابة أضحكتك؟ (اختياري)")}</summary><p className="fab-hint">{tr("ترشيح مستقل بلا نقاط. لا يحتسب إن كانت الإجابة هي الحقيقة أو من المساعدة.")}</p><label className="field fab-funny-choice"><span>{tr("ترشيح الضحكة")}</span><select data-design-id="option" className="input" aria-label={tr("اختيار الإجابة المضحكة")} value={funny ?? ''} onChange={(e) => setFunny(e.target.value || null)}><option value="">{tr("بدون ترشيح مضحك")}</option>{state.options.map((option) => <option key={option.id} value={option.id} disabled={!canVoteFor(state, actor.id, option.id)}>{option.text}{option.owners.includes(actor.id) ? tr(" · إجابتك") : ''}</option>)}</select></label><Button data-design-id="skip" variant="ghost" full onClick={() => setFunny(null)}>{tr("بدون ترشيح مضحك")}</Button></details>}
    <Button data-design-id="submit" data-design-required="true" variant="accent" full size="lg" disabled={choice === undefined} onClick={() => act('VOTE', { optionId: choice, funnyId: funny })}>{tr("ثبّت اختياراتي وأخفِ الشاشة")}</Button>
  </div>;
}

function Reveal({ state, act, frozen = false }) {
  const group = state.revealGroups[state.revealIndex];
  const final = state.revealIndex === state.revealGroups.length - 1;
  // عند كشف الحقيقة: وميض أخضر ودفعة قصاصات عند بطاقتها (الدفعة والوميض يتخطّيان تقليل الحركة بأنفسهما).
  const truthRef = useRef(null);
  useEffect(() => {
    if (frozen || !state.revealed || !truthRef.current) return;
    flashScreen('good');
    const r = truthRef.current.getBoundingClientRect();
    burstConfetti({ x: r.left + r.width / 2, y: r.top + r.height / 2, count: 40 });
  }, [state.revealed, frozen]);
  return <div className="stack">
    <QuestionText question={state.question} />
    <div className="fab-reveal-title center"><span aria-hidden="true">{final ? '⚡' : '🎭'}</span><h2>{final ? tr("الحقيقة… أم أقوى فبركة؟") : tr("نكشف هذه الإجابات")}</h2><p className="muted">{final ? tr("الحقيقة بين هذين الخيارين. من أقنعكم؟") : tr("نترك الحقيقة للمواجهة الأخيرة.")}</p></div>
    {group.map((id, i) => {
      const option = state.options.find((o) => o.id === id), truth = id === TRUTH_ID;
      const voters = votersFor(state, id), fooled = votersFor(state, id, { scoringOnly: true });
      const laughers = state.players.filter((p) => state.funnyVotes[p.id] === id);
      return <article key={id} ref={truth ? truthRef : null} style={{ '--i': i }} data-design-id="reveal-card" className={`fab-reveal-card ${state.revealed ? truth ? 'is-truth' : 'is-lie' : ''}`}>
        {state.revealed && <strong className="fab-reveal-label">{truth ? tr("هذه هي الحقيقة") : option.owners.length ? tr("كذبة {v0}", {v0: names(state, option.owners)}) : tr("إجابة أضافتها اللعبة")}</strong>}
        <h3>{option.text}</h3>
        {state.revealed && <div className="stack fab-reveal-detail">
          <p>{voters.length ? tr("اختارها: {v0}", {v0: voters.map((p) => p.name).join('، ')}) : tr("لم يصوّت لها أحد.")}</p>
          {!truth && option.earners.length > 0 && <p>{tr("خدعت ")}{fooled.length} · +{fooled.length * 500 * multiplier(state)}{tr(" لكل كاتب مؤهل")}</p>}
          {!truth && option.owners.some((owner) => !option.earners.includes(owner)) && <p className="fab-hint">{tr("بعض الكاتبين استخدموا المساعدة؛ لا تُحسب لهم نقاط خداع أو ضحكات.")}</p>}
          {!truth && option.earners.length > 0 && laughers.length > 0 && <p>{tr("😂 أضحكت: ")}{laughers.map((p) => p.name).join('، ')}</p>}
          {truth && state.truthWriters.length > 0 && <p>{tr("عرفها أثناء الكتابة: ")}{names(state, state.truthWriters)}{tr(" · تُحسب مرة واحدة.")}</p>}
        </div>}
      </article>;
    })}
    {state.revealed && final && <div className="fab-explain"><p>{state.question.explanation}</p>{state.question.sourceUrl && <a href={state.question.sourceUrl} target="_blank" rel="noreferrer">{tr("مصدر المعلومة ↗")}</a>}</div>}
    <Button data-design-id="reveal" variant="accent" full size="lg" onClick={() => act(state.revealed ? 'REVEAL_NEXT' : 'REVEAL')}>{state.revealed ? final ? tr("حصيلة الجولة") : tr("المجموعة التالية") : final ? tr("اكشفوا الحقيقة!") : tr("من كتبها؟ ومن صدّقها؟")}</Button>
  </div>;
}

export function Results({ state }) {
  const honors = awards(state), highlights = bestLies(state);
  return <div className="fabraka stack">
    <Podium data-design-id="podium" entries={standings(state)} />
    {honors.length > 0 && <div className="fab-awards">{honors.map((award) => <Card key={award.stat}><span className="fab-award-icon" aria-hidden="true">{award.emoji}</span><h3>{tr(award.title)}</h3><p>{award.players.map((p) => p.name).join('، ')}</p><small>{award.value} {award.stat === 'fooled' ? tr("خدعات ناجحة") : award.stat === 'truths' ? tr("حقائق مكتشفة") : tr("أصوات ضحك")}</small></Card>)}</div>}
    <div className="fab-table-wrap"><table className="fab-stats"><caption>{tr("حصيلة الحقيقة والخداع")}</caption><thead><tr><th scope="col">{tr("اللاعب")}</th><th scope="col">{tr("حقيقة")}</th><th scope="col">{tr("خداع")}</th>{state.settings.funnyVote && <th scope="col">{tr("ضحك")}</th>}<th scope="col">{tr("النقاط")}</th></tr></thead><tbody>{standings(state).map((p) => <tr key={p.id}><th scope="row"><Avatar player={p} /> {p.name}</th><td>{p.truths}</td><td>{p.fooled}</td>{state.settings.funnyVote && <td>{p.laughs}</td>}<td><b>{p.score}</b></td></tr>)}</tbody></table></div>
    {highlights.length > 0 && <div className="stack fab-highlights"><h2 className="fab-heading">{tr("فبركات تستحق التذكّر")}</h2>{highlights.map((h, i) => <Card key={`${h.round}-${i}`} className="stack"><small className="muted">{tr("الجولة ")}{h.round} · {names(state, h.owners)}</small><QuestionText question={{ text: h.question }} filled={h.answer} /><blockquote>«{h.text}»</blockquote><p className="fab-hint">{tr("🎭 خدعت ")}{h.fooled}{state.settings.funnyVote && tr(" · 😂 أضحكت {v0}", {v0: h.laughs})}</p></Card>)}</div>}
  </div>;
}

function RoundLaughAward({ state }) {
  const highlights = state.history.at(-1)?.highlights || [];
  const best = Math.max(0, ...highlights.map((h) => h.laughs));
  if (!best) return null;
  return <Card data-design-id="laugh-award" className="stack fab-laugh"><h3>{tr("😂 ضحكة الجولة")}</h3>{highlights.filter((h) => h.laughs === best).map((h, i) => <div key={i}><blockquote>«{h.text}»</blockquote><p className="fab-hint">{names(state, h.owners)} · {best}{tr(" أصوات ضحك · جائزة بلا نقاط")}</p></div>)}</Card>;
}

function Clock({ state, act, frozen = false }) {
  const active = !state.paused && ((state.phase === 'write' && state.ready && state.settings.writeSeconds > 0) || state.phase === 'discussion');
  const key = turnKey(state), latest = useRef({ state, act });
  latest.current = { state, act };
  useEffect(() => {
    if (!active || frozen) return;
    const { state: start, act: send } = latest.current;
    const deadline = performance.now() + start.remaining * 1000;
    const timer = setInterval(() => {
      if (document.hidden) return;
      send('TICK', { remaining: Math.max(0, Math.ceil((deadline - performance.now()) / 1000)) });
    }, 200);
    return () => clearInterval(timer);
  }, [active, key, frozen]);
  useEffect(() => { if (!frozen && active && state.remaining === 0) act('TIMEOUT'); }, [active, state.remaining, key, frozen]);
  // آخر خمس ثوانٍ: تظليل أحمر نابض (عنصر ثابت في body، يستريح عند صفر ويُطفأ عند الخروج).
  useEffect(() => {
    vignette(active && state.remaining > 0 && state.remaining <= 5);
    return () => vignette(false);
  }, [active, state.remaining]);
  return null;
}

export function Game({ api, players, onExit, savedSession = null, gameOptions = null, designPreviewState = null }) {
  const { questions, pictures, personal } = useMemo(() => getFabrakaContent(api.contentLocale, api.contentVersion), [api.contentLocale, api.contentVersion]);
  const [state, dispatch] = useReducer(reduce, null, () => {
    if (designPreviewState) return designPreviewState;
    const saved = restoreSession(savedSession); if (saved) return saved;
    const seed = randomSeed(), settings = normalizeContentOptions(gameOptions || api.storage.get(OPTIONS_KEY), api.contentLocale, api.contentVersion);
    const deck = buildDeck({ questions, pictures, personal, options: settings, seen: api.storage.get(SEEN_KEY, {}) || {}, random: mulberry32(seed) });
    return stampContentIdentity({ ...initialState(players, settings, { deck, seed }), profileSession: api.matchSnapshot?.() || null }, api);
  });
  const [saveOk, setSaveOk] = useState(api.storage.persistent !== false);
  useGameMusicScene(api.sound, 'fabraka', state.phase, state.paused);
  const key = turnKey(state), actor = currentActor(state);
  useCandidateDeadlineWarning(api.sound, JSON.stringify(['fabraka', state.sessionId, key]), state.remaining,
    !api.designPreview && !state.paused && ((state.phase === 'write' && state.ready && state.settings.writeSeconds > 0) || state.phase === 'discussion'));
  const act = (type, extra = {}) => {
    if (['SUBMIT_LIE', 'SUBMIT_TRUTH'].includes(type)) api.sound.play('pop');
    else if (['BEGIN', 'READY', 'START_WRITING', 'NEXT_ROUND'].includes(type)) api.sound.play('whoosh');
    else if (type === 'VOTE') api.haptics.vibrate('selection');
    else if (type === 'TIMEOUT') { api.sound.play('timeout'); stampScreen({ text: tr("انتهى الوقت"), tone: 'bad' }); }
    dispatch({ type, round: state.round, key, playerId: actor?.id, ...extra });
  };
  // رسم «اجتمعوا»: يهبط ثم يقفز بعد 700ms (صفر تحت تقليل الحركة عبر useReaction/wait).
  const [gatherReaction, gatherReact] = useReaction();
  useEffect(() => {
    if (state.phase !== 'gather' || api.designPreview) return undefined;
    const t = setTimeout(() => gatherReact('clay-jump'), wait(700));
    return () => clearTimeout(t);
  }, [state.phase, api.designPreview]);
  const latestAct = useRef(act); latestAct.current = act;
  useEffect(() => {
    api.setBeforeExit?.(() => latestAct.current('PAUSE'));
    return () => api.setBeforeExit?.(null);
  }, [api]);
  // الحفظ مؤجَّل ربع ثانية: كل حرف في المسودة كان يكتب ثلاث مفاتيح في التخزين على الخيط
  // الرئيسي. تغيّر المرحلة يُحفظ فورًا، والإخفاء والخروج يفرّغان ما تأخر.
  const latestState = useRef(state); latestState.current = state;
  const privateTurnVisible = !api.designPreview && isSecret(state) && state.ready && !state.paused;
  useEffect(() => privateTurnVisible ? socialInterruption.private(Symbol('fabraka-turn')) : undefined, [privateTurnVisible]);
  useEffect(() => {
    let pausedHere = false;
    return socialInterruption.subscribe(() => {
      if (socialInterruption.getSnapshot().paused && !latestState.current.paused && !pausedHere) { pausedHere = true; latestAct.current('PAUSE'); }
      else if (!socialInterruption.getSnapshot().paused && pausedHere) { pausedHere = false; latestAct.current('RESUME'); }
    });
  }, []);
  const saveTimer = useRef(0);
  const persist = useCallback(() => {
    clearTimeout(saveTimer.current); saveTimer.current = 0;
    const ok = saveSession(api.storage, stampContentIdentity(latestState.current, api)); setSaveOk(ok);
    api.setExitMessage?.(ok ? tr("تقدم فبركة محفوظ على هذا الجهاز. يمكنك استئناف اللعبة من إعداداتها عند العودة.") : tr("تعذر حفظ آخر تقدم. مغادرة اللعبة أو إغلاق الصفحة قد يفقد هذه الجلسة."));
  }, [api]);
  const lastPhase = useRef(null);
  useEffect(() => {
    const phaseKey = `${state.phase}:${state.round}:${state.writer}:${state.voter}:${state.revealIndex}:${state.revealed}:${state.paused}`;
    if (lastPhase.current !== phaseKey) { lastPhase.current = phaseKey; persist(); return undefined; }
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(persist, 250);
    return () => clearTimeout(saveTimer.current);
  }, [state, persist]);
  useEffect(() => {
    const flush = () => { if (document.hidden && saveTimer.current) persist(); };
    document.addEventListener('visibilitychange', flush); window.addEventListener('pagehide', flush);
    return () => { document.removeEventListener('visibilitychange', flush); window.removeEventListener('pagehide', flush); if (saveTimer.current) persist(); };
  }, [persist]);
  useEffect(() => { api.setInGame(state.phase !== 'over'); }, [state.phase, api]);
  useEffect(() => {
    const hide = () => { if (document.hidden) latestAct.current('PAUSE'); };
    document.addEventListener('visibilitychange', hide);
    return () => document.removeEventListener('visibilitychange', hide);
  }, []);
  // A mounted/restored reveal is history. Only a new stage in this mounted
  // session may sound; retain its key across pause/rerender/StrictMode replay.
  const revealAudio = useRef(state.phase === 'reveal' ? `${state.sessionId}:${state.round}:${state.revealIndex}:${state.revealed}` : null);
  useEffect(() => {
    if (state.phase === 'over') {
      const completed = state.history.length >= state.rounds;
      if (completed) { api.haptics.vibrate('win'); api.confetti.fire(); }
      api.matchOver?.({ completed });
    }
    else if (state.phase === 'reveal') {
      const key = `${state.sessionId}:${state.round}:${state.revealIndex}:${state.revealed}`;
      if (revealAudio.current !== key) { revealAudio.current = key; api.sound.play(state.revealed ? 'reveal' : 'drumroll'); }
    }
  }, [state.phase, state.revealIndex, state.revealed, state.sessionId, state.round]);
  // تكّة لكل ثانية من الخمس الأخيرة؛ الاستئناف أو «جاهزون» على الثانية نفسها لا يعيدها.
  useEffect(() => {
    const s = latestState.current;
    if (!s.paused && s.remaining > 0 && s.remaining <= 5 && ((s.phase === 'write' && s.ready) || s.phase === 'discussion')) api.sound.play('tick');
  }, [state.remaining]); // eslint-disable-line react-hooks/exhaustive-deps

  return <Screen data-design-screen={`fabraka.local.${state.phase}`} className="fabraka stack" aria-label={tr("فبركة")}>
    <style>{css}</style><Clock state={state} act={act} frozen={!!api.designPreview} />
    {state.phase !== 'over' && <header data-design-id="header" className="fab-bar"><div><b>{tr("الجولة ")}{state.round}{tr(" من ")}{state.rounds}</b><small key={multiplier(state)} className={multiplier(state) === 2 ? 'fab-fire' : ''}>{tr(PHASE_LABELS[state.phase])}{multiplier(state) === 2 && tr(" · نقاط مضاعفة")}</small></div><Button data-design-id="pause" variant="ghost" size="sm" onClick={() => act('PAUSE')}>{tr("إيقاف مؤقت")}</Button></header>}
    {!saveOk && <p className="fab-save-error" role="alert">{tr("تعذر حفظ التقدم على الجهاز. أبقِ الصفحة مفتوحة لإكمال الجلسة.")}</p>}
    {state.paused ? <div data-design-id="privacy" data-design-required="true" className="stack center fab-pause"><span className="fab-big clay-stage clay-idle" aria-hidden="true"><span className="clay-lift">⏸️</span></span><h2>{tr("خذوا راحتكم")}</h2><p className="muted">{tr("الوقت متوقف والإجابات مخفية.")}</p><p className="fab-hint">{saveOk ? tr("تقدمكم محفوظ على هذا الجهاز.") : tr("الحفظ غير متاح حاليًا؛ تابعوا من هذه الصفحة.")}</p><Button data-design-id="resume" data-design-required="true" variant="accent" size="lg" full onClick={() => act('RESUME')}>{tr("متابعة اللعب")}</Button><details className="fab-details"><summary>{tr("تذكير بالقواعد")}</summary><Rules /></details></div> : <>
      {state.phase === 'intro' && <div data-design-id="intro" className="fab-intro stack center"><span className="fab-big clay-stage clay-idle" aria-hidden="true"><span className="clay-lift"><GameArtwork game={state.settings.mode === 'friends' ? 'meenfina' : 'fabraka'} /></span></span><h2>{state.settings.mode === 'friends' ? tr("دور {v0}", {v0: state.players[(state.round - 1) % state.players.length].name}) : multiplier(state) === 2 ? tr("الجولة الأخيرة… كل نقطة باثنتين!") : tr("جهّزوا كذبة مقنعة")}</h2><p className="muted">{state.settings.mode === 'friends' ? tr("يكتب صاحب الجولة الحقيقة عن نفسه أولًا؛ البقية يحاولون تقليده وخداع بعضهم.") : tr("شاهدوا السؤال معًا، ثم اكتبوا سرًا، ناقشوا، وصوّتوا.")}</p><Button data-design-id="start" data-design-required="true" variant="accent" size="lg" full onClick={() => act('BEGIN')}>{tr("ابدأ الجولة")}</Button><Scoreboard data-design-id="scoreboard" entries={standings(state)} />{state.round === 1 && <details className="fab-details"><summary>{tr("كيف نحسب النقاط؟")}</summary><Rules /></details>}</div>}
      {state.phase === 'question' && <div className="stack center"><span className="fab-eyebrow">{state.question.category}{tr(" · اقرأوا السؤال معًا")}</span><QuestionText question={state.question} />{state.hostId && <p className="fab-note">{currentHost(state).name}{tr(" ثبّت الحقيقة. البقية يكتبون؛ صاحب الحقيقة يلتزم الصمت حتى الكشف.")}</p>}<p className="muted">{tr("فكّروا بإجابة قصيرة تبدو حقيقية. ترتيب الكتابة يتبدّل في كل جولة.")}</p><Button data-design-id="continue" data-design-required="true" variant="accent" size="lg" full onClick={() => act('START_WRITING')}>{tr("فهمنا السؤال، نبدأ الكتابة")}</Button></div>}
      {isSecret(state) && <PrivacyGate state={state} act={act}>{state.phase === 'vote' ? <VotePanel key={key} state={state} act={act} /> : <DraftPanel key={key} state={state} act={act} />}</PrivacyGate>}
      {state.phase === 'discussion' && <div className="stack"><QuestionText question={state.question} /><div data-design-id="discussion" className="fab-discussion center"><h2>{tr("دافعوا عن أي إجابة… أو شكّكوا فيها!")}</h2><p className="muted">{tr("الأسماء مخفية. لا تُظهروا إجاباتكم على الجوال.")}{state.hostId && tr(" صاحب الحقيقة يسمع فقط.")}</p><ClockPill remaining={state.remaining} urgent={state.remaining <= 5} label={tr("وقت النقاش المتبقي")} /></div>{state.options.map((o) => <div data-design-id="option" className="fab-opt" key={o.id}>{o.text}</div>)}<Button data-design-id="continue" data-design-required="true" variant="secondary" full onClick={() => act('START_VOTE')}>{tr("جاهزون، نبدأ التصويت السري")}</Button></div>}
      {state.phase === 'gather' && <div className="stack center fab-intro"><span className={`fab-big clay-stage ${gatherReaction}`} aria-hidden="true"><span className="clay-lift"><GameArtwork game="meenfina" /></span></span><h2>{tr("اجتمعوا حول الشاشة")}</h2><p className="muted">{tr("انتهى التصويت. سنكشف أصحاب الإجابات ومن صدّقهم، ونترك الحقيقة وأقوى كذبة للنهاية.")}</p><Button data-design-id="continue" data-design-required="true" variant="accent" size="lg" full onClick={() => act('START_REVEAL')}>{tr("ابدأوا الكشف")}</Button></div>}
      {state.phase === 'reveal' && <Reveal state={state} act={act} frozen={!!api.designPreview} />}
      {state.phase === 'roundEnd' && <div className="stack"><h2 className="fab-heading">{tr("حصيلة الجولة ")}{state.round}</h2><div data-design-id="round-scores" className="fab-round-scores">{standings(state).map((p, i) => { const b = state.breakdown[p.id]; return <article key={p.id} style={{ '--i': i }}><div><span aria-hidden="true"><Avatar player={p} /></span><b>{p.name}</b><strong>+{b.points}</strong><span className="badge"><CountUp value={p.score} from={p.score - b.points} duration={700} delay={400 + i * 70} /></span></div><p>{b.host ? tr("صاحب الحقيقة · يرتاح من النقاط هذا الدور") : tr("{v0} · خداع: {v1}{v2}", {v0: b.byWriting ? tr("كتب الحقيقة") : tr("حقيقة: {count}", {count:b.truth}), v1: b.fooled, v2: state.settings.funnyVote ? tr(" · ضحك: {count}", {count:b.laughs}) : ''})}</p></article>; })}</div>{state.settings.funnyVote && <RoundLaughAward state={state} />}<Button data-design-id="continue" data-design-required="true" variant="accent" size="lg" full onClick={() => act('NEXT_ROUND')}>{state.round === state.rounds ? tr("النتائج والألقاب") : tr("الجولة التالية")}</Button></div>}
      {state.phase === 'over' && <div className="stack"><Results state={state} /><Button variant="accent" size="lg" full data-design-id="restart" onClick={api.restart}>{tr("نلعب مرة ثانية")}</Button><Button variant="secondary" full data-design-id="options" onClick={api.backToSetup}>{tr("تغيير النمط أو اللاعبين")}</Button><Button variant="ghost" full data-design-id="exit" data-design-required="true" onClick={onExit}>{tr("العودة إلى ميدان")}</Button></div>}
    </>}
  </Screen>;
}

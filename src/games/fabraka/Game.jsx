import { useSavedMatch } from '../../shared/ui/useSavedMatch.js';
import { tr } from '../../shared/i18n/core.js';
import { Avatar, GameArtwork } from '../../shared/brand/art.jsx';
import { useGameMusicScene } from '../../shared/fx/useGameMusicScene.js';
import { useCandidateDeadlineWarning } from '../../shared/fx/useDeadlineAudio.js';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';
import { socialInterruption } from '../../social/interruption.js';
import { Screen, Button, Segment, Card, Scoreboard, Modal, CountUp } from '../../shared/ui/components.jsx';
import { flashScreen, stampScreen, vignette, burstConfetti, wait } from '../../shared/fx/index.js';
import { useReaction } from '../../shared/ui/useReaction.js';
import { IconCheck, IconClock, IconPause } from '../../shared/ui/icons.jsx';
import { PresentationStyles } from '../../shared/ui/PresentationStyles.jsx';
import { ChoicePodium, ChoicePortrait } from '../meenfina/Studio.jsx';
import { FabrakaAwardArt, FabrakaLock, FabrakaModeArt, FabrakaRoster, fabrakaModeLabel } from './Studio.jsx';
import { mulberry32, randomSeed } from '../../shared/lib/rng.js';
import { pictures, getFabrakaContent, categoryCount, normalizeContentOptions } from './content.js';
import { stampContentIdentity } from '../../shared/lib/content-storage.js';
import { Illustration } from './Illustration.jsx';
import { OPTIONS_KEY, SEEN_KEY, loadSession, loadResult, saveSession, hasRetiredSession } from './persistence.js';
import { SAVE_KEY, initialState, reduce, currentActor, currentHost, standings, validateLie, votersFor, TRUTH_ID, ROUNDS, buildDeck, questionPool, turnKey, isSecret, multiplier, canVoteFor, restoreSession, awards, bestLies, factId } from './logic.js';
import css from './fabraka.css?sheet';
import choiceCss from '../meenfina/choice-studio.css?sheet';

const MODE_HINTS = { classic: 'اكتبوا كذبة مقنعة لسؤال حقيقي غريب.', mixed: 'أسئلة حقيقية تتخللها جولة صور كل ثلاث جولات.', pictures: "{v0} صورة توضيحية لأدوات حقيقية. فبركوا استخدامًا يبدو منطقيًا!", friends: 'صاحب الجولة يكتب الحقيقة عن نفسه، والبقية يفبركون ويصوّتون.' };
const PHASE_LABELS = { intro: 'استعدوا', host: 'صاحب الحقيقة', question: 'السؤال للجميع', write: 'كتابة سرية', discussion: 'نقاش', vote: 'تصويت سري', gather: 'اجتمعوا', reveal: 'وقت الكشف', roundEnd: 'حصيلة الجولة' };
const names = (state, ids) => state.players.filter((p) => ids.includes(p.id)).map((p) => p.name).join('، ');

export function SetupOptions({ storage, api }) {
  const { questions, categories } = useMemo(() => getFabrakaContent(api.contentLocale, api.contentVersion), [api.contentLocale, api.contentVersion]);
  const [opts, setOpts] = useState(() => normalizeContentOptions(storage.get(OPTIONS_KEY), api.contentLocale, api.contentVersion));
  const resume = useSavedMatch('fabraka', storage, api.contentLocale, SAVE_KEY, loadSession);
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
    <PresentationStyles sheet={choiceCss} />
    <PresentationStyles sheet={css} />
    {retiredSession && <p className="fab-note" role="status">{tr("تجدّدت أسئلة فبركة وصورها. ابدأوا جلسة جديدة؛ الجلسة القديمة غير قابلة للاستئناف، ونتائجكم السابقة محفوظة.")}</p>}
    {resume && <Card className="fab-resume stack">
      <h2 className="card-title">{tr("لعبتكم بانتظاركم")}</h2>
      <p>{fabrakaModeLabel(resume.settings.mode)}{tr(" · الجولة ")}{resume.round}{tr(" من ")}{resume.rounds} · {resume.players.length}{tr(" لاعبين")}</p>
      <p className="card-muted">{resume.players.map((p) => p.name).join('، ')} — {tr(PHASE_LABELS[resume.phase])}</p>
      <Button data-design-id="resume" data-design-required="true" variant="accent" full onClick={() => api.resumeGame(resume)}>{tr("استئناف اللعبة المحفوظة")}</Button>
      <p className="fab-hint">{tr("بدء لعبة جديدة بالزر أسفل الإعدادات يستبدل هذا التقدم.")}</p>
    </Card>}
    <Card className="stack fab-setup-modes">
      <div className="fab-mode-heading">
        <h2 className="card-title">{tr("أي فبركة نلعب؟")}</h2>
        <span className="online-social-slot" data-social-game-launcher />
      </div>
      <div className="fab-modes" role="group" aria-label={tr("نمط فبركة")}>
        {Object.keys(MODE_HINTS).map(value => <button data-design-id="option" type="button" key={value} className={`fab-mode ${opts.mode === value ? 'selected' : ''}`} aria-pressed={opts.mode === value} onClick={() => update({ mode: value })}><FabrakaModeArt mode={value} /><span>{fabrakaModeLabel(value)}</span></button>)}
      </div>
      <p className="card-muted">{tr(MODE_HINTS[opts.mode], {v0:pictures.length})}</p>
      {opts.mode === 'friends' ? <>
        <Segment data-design-id="setting-cycles" accent label={tr("دورات الأصحاب")} value={opts.friendCycles} onChange={(friendCycles) => update({ friendCycles })} options={[{ value: 1, label: tr("دور لكل لاعب") }, { value: 2, label: tr("دوران لكل لاعب") }]} />
        <p className="fab-hint">{tr("عدد الجولات = عدد اللاعبين × عدد الأدوار. صاحب الحقيقة لا يكتب كذبة ولا يصوّت ولا يجمع نقاطًا في دوره، ولا توجد جولة مضاعفة في هذا النمط.")}</p>
      </> : <div className="field fab-setup-field"><span>{tr("عدد الجولات")}</span><Segment data-design-id="setting-rounds" accent label={tr("عدد الجولات")} value={opts.rounds} onChange={(rounds) => update({ rounds })} options={ROUNDS.map((rounds) => ({ value: rounds, label: String(rounds) }))} /></div>}
      {['classic', 'mixed'].includes(opts.mode) && <>
        <div className="field fab-setup-field"><span>{tr("نوع الأسئلة")}</span><Segment data-design-id="setting-style" accent label={tr("نوع الأسئلة")} value={opts.style} onChange={(style) => update({ style })} options={[{ value: 'curious', label: tr("غرائب مختارة") }, { value: 'all', label: tr("كل الأسئلة") }]} /></div>
        <details className="fab-details"><summary className="fab-topic-summary"><span>{tr("المواضيع · ")}{opts.categories.length ? tr("{v0} مختارة", {v0: opts.categories.length}) : tr("الكل")}</span>{valid && <small className="fab-topic-count">{tr("{v0} سؤالًا متاحًا", {v0: pool.length})}</small>}</summary>
          <div className="fab-categories">
            <button data-design-id="category-card" type="button" className="chip" aria-pressed={!opts.categories.length} onClick={() => update({ categories: [] })}>{tr("كل المواضيع")}</button>
            {categories.map((category) => { const count = categoryCount(category, opts.style, api.contentLocale, api.contentVersion); return <button data-design-id="category-card" key={category} type="button" className={`chip ${opts.categories.includes(category) ? 'selected' : ''}`} disabled={count === 0} aria-pressed={opts.categories.includes(category)} title={count === 0 ? tr("لا غرائب في هذا الموضوع؛ اختر «كل الأسئلة»") : tr("{v0} سؤالًا", {v0: count})} onClick={() => update({ categories: opts.categories.includes(category) ? opts.categories.filter((c) => c !== category) : [...opts.categories, category] })}>{category} <small>{count}</small></button>; })}
          </div>
          <p className="fab-hint">{tr("الأولوية للأسئلة التي لم تلعبوها.")}</p>
        </details>
        {!valid && <p className="setup-error" role="alert">{tr("المتاح {v0} أسئلة فقط. أضف موضوعًا أو اختر «كل الأسئلة» أو قلّل الجولات.", {v0: pool.length})}</p>}
      </>}
    </Card>
    <details className="fab-details fab-pacing">
      <summary>{tr("الإيقاع والتخصيص")}</summary>
      <Card className="stack">
        <span>{tr("وقت الكتابة لكل لاعب")}</span>
        <Segment data-design-id="setting-write-time" label={tr("وقت الكتابة")} value={opts.writeSeconds} onChange={(writeSeconds) => update({ writeSeconds })} options={[{ value: 0, label: tr("براحتنا") }, { value: 45, label: tr("45 ثانية") }, { value: 30, label: tr("سريع · 30") }]} />
        <span>{tr("النقاش قبل التصويت")}</span>
        <Segment data-design-id="setting-discussion-time" label={tr("وقت النقاش")} value={opts.discussionSeconds} onChange={(discussionSeconds) => update({ discussionSeconds })} options={[{ value: 0, label: tr("بدون") }, { value: 15, label: tr("15 ثانية") }, { value: 20, label: tr("20 ثانية") }]} />
        <label className="fab-toggle"><span>{tr("😂 جائزة أكثر كذبة مضحكة").replace(/^\S+\s/u, '')}<small>{tr("تصويت إضافي اختياري، بدون تغيير النقاط.")}</small></span><input data-design-id="setting-funny" type="checkbox" role="switch" checked={opts.funnyVote} onChange={(e) => update({ funnyVote: e.target.checked })} /></label>
        {opts.mode !== 'friends' && <label className="fab-toggle"><span>{tr("🔥 مضاعفة الجولة الأخيرة").replace(/^\S+\s/u, '')}<small>{tr("نقاط الحقيقة والخداع ×2.")}</small></span><input data-design-id="setting-double" type="checkbox" role="switch" checked={opts.finalDouble} onChange={(e) => update({ finalDouble: e.target.checked })} /></label>}
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
    {question.kind === 'picture' && <Illustration question={question} />}
    <p dir="auto" className={filled ? 'fab-q is-filled' : 'fab-q'}>{before}<span className="blank">{filled || tr('؟؟؟')}</span>{after}</p>
  </div>;
}

// مؤقت الكتابة/النقاش: الرقم مفتاحه الثانية عند الاستعجال فيُلكم كل ثانية (الحلقة والنبض من CSS).
function ClockPill({ remaining, urgent, label }) {
  return <div data-design-id="timer" className={`fab-clock ${urgent ? 'urgent' : ''}`} role="timer" aria-label={label}><IconClock /><b key={urgent ? remaining : 'n'}>{remaining}</b>{tr(" ثانية")}</div>;
}

function PrivacyGate({ state, act, children }) {
  const actor = currentActor(state);
  const [reaction, react] = useReaction();
  if (state.ready) return children;
  return <div data-design-id="privacy" data-design-required="true" className="fab-gate stack center" data-testid="privacy-gate">
    <FabrakaLock />
    <h2 className="fab-section-title">{tr("سلّم الجوال إلى ")}<bdi>{actor.name}</bdi></h2>
    <span className={`fab-avatar ${reaction}`} aria-hidden="true"><ChoicePortrait player={actor} size={150} /></span>
    <p className="fab-gate-hint">{state.phase === 'host' ? tr("اكتب الحقيقة عن نفسك بعيدًا عن العيون.") : state.phase === 'write' ? tr("إجابتك سرية. تأكد أن الشاشة لك وحدك.") : tr("اختر الحقيقة ثم سلّم الجوال دون كشف اختيارك.")}</p>
    <p className="fab-mode-pill">{state.phase === 'write' ? tr("الكاتب {v0} من {v1}", {v0: state.writer + 1, v1: state.order.length}) : state.phase === 'vote' ? tr("المصوّت {v0} من {v1}", {v0: state.voter + 1, v1: state.order.length}) : tr("صاحب الجولة لا يشارك في التصويت")}</p>
    <Button data-design-id="continue" data-design-required="true" variant="accent" size="lg" full onClick={() => { react('clay-squash'); act('READY'); }}>{tr(" أنا ")}<bdi>{actor.name}</bdi>{tr("، جاهز")}</Button>
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
    {host ? <>
      <p className="fab-section-title">{tr("وضع أصحابنا · خاص")}</p>
      <FabrakaRoster players={state.players} />
    </> : state.question.kind !== 'picture' && <div className="fab-write-hero">
      <GameArtwork game="fabraka" />
      {Boolean(state.settings.writeSeconds) && <ClockPill remaining={state.remaining} urgent={state.remaining <= 10} label={tr("وقت الكتابة المتبقي")} />}
    </div>}
    <QuestionText question={state.question} />
    {!host && state.question.kind === 'picture' && Boolean(state.settings.writeSeconds) && <ClockPill remaining={state.remaining} urgent={state.remaining <= 10} label={tr("وقت الكتابة المتبقي")} />}
    <label className={`field fab-answer-field ${host ? 'is-truth' : ''}`}>
      <span className="fab-field-caption">{!host && <ChoicePortrait player={actor} size={42} />}{host ? tr("إجابتك الحقيقية يا {v0}", {v0: actor.name}) : tr("فبركتك يا {v0}", {v0: actor.name})}</span>
      <input data-design-id="answer-input" className="input fab-input" dir="auto" value={state.draft} maxLength={60} autoFocus autoComplete="off" enterKeyHint="done" placeholder={host ? tr("إجابة واضحة وقصيرة…") : tr("كلمة أو رقم يبدو مقنعًا…")} onChange={(e) => { setError(''); act('DRAFT', { text: e.target.value }); }} />
    </label>
    {host && <label className="field fab-answer-field is-truth"><span className="fab-field-caption">{tr("حتى 3 صيغ، افصل بينها بـ ؛")}</span><input data-design-id="answer-aliases" className="input fab-input" dir="auto" value={state.aliasesDraft} maxLength={180} placeholder={tr("مثال: معكرونة؛ مكرونة")} onChange={(e) => act('ALIASES', { text: e.target.value })} /></label>}
    {error && <p className="setup-error" role="alert">{error}</p>}
    <Button data-design-id="submit" data-design-required="true" type="submit" variant="accent" full size="lg">{host ? tr("ثبّت الحقيقة وأظهر السؤال للجميع") : tr("ثبّت إجابتي وأخفِ الشاشة")}</Button>
    {host ? <><Button data-design-id="skip" variant="secondary" full disabled={!canSkip} onClick={() => skip('SKIP_PROMPT')}>{tr("سؤال آخر")}</Button><p className="fab-hint fab-note">{tr("بعد التثبيت، دع الآخرين يفبركون إجاباتك دون تلميحات منك.")}</p></> : <>
      {state.assisted && <p className="fab-note" role="status">{tr("استخدمت المساعدة لهذه الجولة؛ لن تكسب إجابتك نقاط خداع أو ضحكات حتى لو عدّلتها.")}</p>}
      <details className="fab-details"><summary>{state.helpUsed.includes(actor.id) ? tr("استُخدمت مساعدتك الوحيدة") : tr("تحتاج فكرة؟ مساعدة واحدة في اللعبة")}</summary><p className="fab-hint">{tr("نقترح إجابة جاهزة؛ تتنازل عن نقاط الخداع والضحك لهذه الجولة فقط، وتبقى نقاط اكتشاف الحقيقة متاحة.")}</p><Button data-design-id="assistance" variant="secondary" full disabled={state.helpUsed.includes(actor.id)} onClick={() => { setError(''); act('HELP'); }}>{tr("استخدم مساعدتي")}</Button></details>
      <Button data-design-id="skip" variant="secondary" full onClick={() => skip('SKIP_WRITE')}>{tr("أمرّر بدون إجابة")}</Button>
    </>}
  </form>;
}

function VotePanel({ state, act }) {
  const [choice, setChoice] = useState(undefined), [funny, setFunny] = useState(null);
  const actor = currentActor(state);
  const list = (value, onChange, label) => <div className="fab-options" role="group" aria-label={label}>
    {state.options.map((option) => <button data-design-id="option" key={option.id} type="button" className={`fab-opt ${value === option.id ? 'selected' : ''}`} disabled={!canVoteFor(state, actor.id, option.id)} aria-pressed={value === option.id} onClick={() => onChange(option.id)}>
      <span className="fab-choice-dot" aria-hidden="true">{value === option.id && <IconCheck />}</span><span className="grow" dir="auto">{option.text}</span>{option.owners.includes(actor.id) && <span className="tag">{tr("إجابتك")}</span>}
    </button>)}
  </div>;
  return <div className="stack">
    <QuestionText question={state.question} />
    <h2 className="fab-question-label fab-field-caption"><ChoicePortrait player={actor} size={48} />{tr("أين الحقيقة يا ")}<bdi>{actor.name}</bdi>؟</h2>
    {list(choice, setChoice, tr("اختيار الحقيقة"))}
    <button data-design-id="skip" type="button" className={`fab-abstain ${choice === null ? 'selected' : ''}`} aria-pressed={choice === null} onClick={() => setChoice(null)}>{tr("أمتنع عن تصويت الحقيقة")}</button>
    {state.settings.funnyVote && <details className="fab-details"><summary>{tr("😂 أي إجابة أضحكتك؟ (اختياري)").replace(/^\S+\s/u, '')}</summary><p className="fab-hint">{tr("ترشيح مستقل بلا نقاط. لا يحتسب إن كانت الإجابة هي الحقيقة أو من المساعدة.")}</p><label className="field fab-funny-choice"><span>{tr("ترشيح الضحكة")}</span><select data-design-id="option" className="input" aria-label={tr("اختيار الإجابة المضحكة")} value={funny ?? ''} onChange={(e) => setFunny(e.target.value || null)}><option value="">{tr("بدون ترشيح مضحك")}</option>{state.options.map((option) => <option key={option.id} value={option.id} disabled={!canVoteFor(state, actor.id, option.id)}>{option.text}{option.owners.includes(actor.id) ? tr(" · إجابتك") : ''}</option>)}</select></label><Button data-design-id="skip" variant="ghost" full onClick={() => setFunny(null)}>{tr("بدون ترشيح مضحك")}</Button></details>}
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
    {state.revealed && <FabrakaRoster players={state.players} />}
    <QuestionText question={state.question} />
    <div className="fab-reveal-title center"><h2 className="fab-section-title">{final ? tr("الحقيقة… أم أقوى فبركة؟") : tr("نكشف هذه الإجابات")}</h2>{!state.revealed && <p className="muted">{final ? tr("الحقيقة بين هذين الخيارين. من أقنعكم؟") : tr("نترك الحقيقة للمواجهة الأخيرة.")}</p>}</div>
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
          {!truth && option.earners.length > 0 && laughers.length > 0 && <p>{tr("😂 أضحكت: ").replace(/^\S+\s/u, '')}{laughers.map((p) => p.name).join('، ')}</p>}
          {truth && state.truthWriters.length > 0 && <p>{tr("عرفها أثناء الكتابة: ")}{names(state, state.truthWriters)}{tr(" · تُحسب مرة واحدة.")}</p>}
        </div>}
      </article>;
    })}
    {state.revealed && final && <div className="fab-explain"><p>{state.question.explanation}</p>{state.question.sourceUrl && <a href={state.question.sourceUrl} target="_blank" rel="noreferrer">{tr("مصدر المعلومة ↗")}</a>}</div>}
    <Button data-design-id="reveal" variant="accent" full size="lg" onClick={() => act(state.revealed ? 'REVEAL_NEXT' : 'REVEAL')}>{state.revealed ? final ? tr("حصيلة الجولة") : tr("المجموعة التالية") : final ? tr("اكشفوا الحقيقة!") : tr("من كتبها؟ ومن صدّقها؟")}</Button>
  </div>;
}

function ResultTable({ players, funnyVote }) {
  const wrap = useRef(null);
  const [stacked, setStacked] = useState(false);
  const columns = [
    ['truths', tr("حقيقة")],
    ['fooled', tr("خداع")],
    ...(funnyVote ? [['laughs', tr("ضحك")]] : []),
    ['score', tr("النقاط")],
  ];

  useLayoutEffect(() => {
    const frame = wrap.current;
    const table = frame.querySelector('table');
    // Use the real type, numbers and available width. Font changes are
    // observable even when the viewport itself stays the same size.
    const measure = () => {
      const headers = Array.from(table.tHead.rows[0].cells);
      const insets = headers.map(cell => {
        const style = getComputedStyle(cell);
        return parseFloat(style.paddingInlineStart) + parseFloat(style.paddingInlineEnd) +
          parseFloat(style.borderInlineStartWidth);
      });
      const widths = headers.map(cell => cell.firstElementChild.offsetWidth);
      const range = document.createRange();
      for (const row of table.tBodies[0].rows) {
        for (const cell of row.cells) {
          const text = cell.querySelector('.fab-stat-value').lastChild;
          let width = 0;
          if (text?.nodeType === Node.TEXT_NODE) {
            range.selectNodeContents(text);
            width = Math.ceil(range.getBoundingClientRect().width);
          }
          if (cell.cellIndex === 0) {
            const identity = cell.querySelector('.fab-stat-player');
            width += identity.firstElementChild.offsetWidth + parseFloat(getComputedStyle(identity).columnGap);
          }
          widths[cell.cellIndex] = Math.max(widths[cell.cellIndex], width);
        }
      }
      setStacked(widths.reduce((sum, width, index) => sum + width + insets[index], 0) > frame.clientWidth);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(frame);
    for (const element of table.querySelectorAll('thead span, .fab-stat-value')) observer.observe(element);
    return () => observer.disconnect();
  }, [players, funnyVote]);

  return <div className="fab-table-wrap" ref={wrap}>
    <table className="fab-stats" role="table" data-stacked={stacked}>
      <caption>{tr("حصيلة الحقيقة والخداع")}</caption>
      <thead role="rowgroup"><tr role="row">
        <th role="columnheader" scope="col"><span>{tr("اللاعب")}</span></th>
        {columns.map(([key, label]) => <th role="columnheader" scope="col" key={key}><span>{label}</span></th>)}
      </tr></thead>
      <tbody role="rowgroup">{players.map(player => <tr role="row" key={player.id}>
        <th role="rowheader" scope="row">
          <span className="fab-stat-player"><Avatar player={player} /><bdi className="fab-stat-value">{player.name}</bdi></span>
        </th>
        {columns.map(([key, label]) => <td role="cell" key={key}>
          <span className="fab-stat-value"><span aria-hidden="true" className="fab-stat-label" data-label={label} />{player[key]}</span>
        </td>)}
      </tr>)}</tbody>
    </table>
  </div>;
}

export function Results({ state }) {
  const sorted = useMemo(() => standings(state), [state]);
  const honors = awards(state), highlights = bestLies(state);
  useLayoutEffect(() => { window.scrollTo({ top: 0, behavior: 'instant' }); }, []);
  return <div className="fabraka stack">
    <h2 className="fab-section-title">{tr("النتائج والألقاب")}</h2>
    <div className="stack fab-final-scroll" role="region" aria-label={tr("حصيلة الحقيقة والخداع")} tabIndex={0}>
      <ChoicePodium sorted={sorted} showScore />
      {honors.length > 0 && <div className="fab-awards">{honors.map((award) => <Card key={award.stat} className={`fab-award-${award.stat}`}><FabrakaAwardArt stat={award.stat} /><h3>{tr(award.title)}</h3><p>{award.players.map((p) => p.name).join('، ')}</p><small>{award.value} {award.stat === 'fooled' ? tr("خدعات ناجحة") : award.stat === 'truths' ? tr("حقائق مكتشفة") : tr("أصوات ضحك")}</small></Card>)}</div>}
      <ResultTable players={sorted} funnyVote={state.settings.funnyVote} />
      {highlights.length > 0 && <details className="fab-highlights"><summary className="fab-heading">{tr("فبركات تستحق التذكّر")}</summary>{highlights.map((h, i) => <Card key={`${h.round}-${i}`} className="stack"><small className="muted">{tr("الجولة ")}{h.round} · {names(state, h.owners)}</small><QuestionText question={{ text: h.question }} filled={h.answer} /><blockquote>«{h.text}»</blockquote><p className="fab-hint">{tr("🎭 خدعت ")}{h.fooled}{state.settings.funnyVote && tr(" · 😂 أضحكت {v0}", {v0: h.laughs})}</p></Card>)}</details>}
    </div>
  </div>;
}

function RoundLaughAward({ state }) {
  const highlights = state.history.at(-1)?.highlights || [];
  const best = Math.max(0, ...highlights.map((h) => h.laughs));
  if (!best) return null;
  return <Card data-design-id="laugh-award" className="fab-laugh"><GameArtwork game="fabraka" /><div className="stack"><h3 className="fab-section-title">{tr("😂 ضحكة الجولة").replace(/^\S+\s/u, '')}</h3>{highlights.filter((h) => h.laughs === best).map((h, i) => <div key={i}><blockquote>«{h.text}»</blockquote><p className="fab-hint">{names(state, h.owners)} · {best}{tr(" أصوات ضحك · جائزة بلا نقاط")}</p></div>)}</div></Card>;
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
    <PresentationStyles sheet={choiceCss} />
    <PresentationStyles sheet={css} />
    <Clock state={state} act={act} frozen={!!api.designPreview} />
    {state.phase !== 'over' && <header data-design-id="header" className="fab-bar">
      <div><b>{tr("الجولة ")}{state.round}{tr(" من ")}{state.rounds}</b>{multiplier(state) === 2 && <small className="fab-fire">{tr(" · نقاط مضاعفة")}</small>}</div>
      <Button data-design-id="pause" variant="secondary" size="sm" onClick={() => act('PAUSE')}><IconPause />{tr("إيقاف مؤقت")}</Button>
    </header>}
    {!saveOk && <p className="fab-save-error" role="alert">{tr("تعذر حفظ التقدم على الجهاز. أبقِ الصفحة مفتوحة لإكمال الجلسة.")}</p>}
    {state.paused ? <div data-design-id="privacy" data-design-required="true" className="stack center fab-pause"><span className="fab-pause-icon" aria-hidden="true"><IconPause /></span><h2>{tr("خذوا راحتكم")}</h2><p className="muted">{tr("الوقت متوقف والإجابات مخفية.")}</p><p className="fab-hint">{saveOk ? tr("تقدمكم محفوظ على هذا الجهاز.") : tr("الحفظ غير متاح حاليًا؛ تابعوا من هذه الصفحة.")}</p><Button data-design-id="resume" data-design-required="true" variant="accent" size="lg" full onClick={() => act('RESUME')}>{tr("متابعة اللعب")}</Button><details className="fab-details"><summary>{tr("تذكير بالقواعد")}</summary><Rules /></details></div> : <>
      {state.phase === 'intro' && <div data-design-id="intro" className="fab-intro stack center"><span className="fab-big clay-stage clay-idle" aria-hidden="true"><span className="clay-lift"><GameArtwork game={state.settings.mode === 'friends' ? 'meenfina' : 'fabraka'} /></span></span><h2>{state.settings.mode === 'friends' ? tr("دور {v0}", {v0: state.players[(state.round - 1) % state.players.length].name}) : multiplier(state) === 2 ? tr("الجولة الأخيرة… كل نقطة باثنتين!") : tr("جهّزوا كذبة مقنعة")}</h2><p className="muted">{state.settings.mode === 'friends' ? tr("يكتب صاحب الجولة الحقيقة عن نفسه أولًا؛ البقية يحاولون تقليده وخداع بعضهم.") : tr("شاهدوا السؤال معًا، ثم اكتبوا سرًا، ناقشوا، وصوّتوا.")}</p><Button data-design-id="start" data-design-required="true" variant="accent" size="lg" full onClick={() => act('BEGIN')}>{tr("ابدأ الجولة")}</Button><Scoreboard data-design-id="scoreboard" entries={standings(state)} />{state.round === 1 && <details className="fab-details"><summary>{tr("كيف نحسب النقاط؟")}</summary><Rules /></details>}</div>}
      {state.phase === 'question' && <div className="stack center"><span className="fab-section-title">{state.question.category}{tr(" · اقرأوا السؤال معًا")}</span><QuestionText question={state.question} />{state.hostId && <p className="fab-note"><bdi>{currentHost(state).name}</bdi>{tr(" ثبّت الحقيقة. البقية يكتبون؛ صاحب الحقيقة يلتزم الصمت حتى الكشف.")}</p>}<p className="fab-note">{tr("فكّروا بإجابة قصيرة تبدو حقيقية. ترتيب الكتابة يتبدّل في كل جولة.")}</p><Button data-design-id="continue" data-design-required="true" variant="accent" size="lg" full onClick={() => act('START_WRITING')}>{tr("فهمنا السؤال، نبدأ الكتابة")}</Button></div>}
      {isSecret(state) && <PrivacyGate state={state} act={act}>{state.phase === 'vote' ? <VotePanel key={key} state={state} act={act} /> : <DraftPanel key={key} state={state} act={act} />}</PrivacyGate>}
      {state.phase === 'discussion' && <div className="stack"><QuestionText question={state.question} /><div data-design-id="discussion" className="fab-discussion center"><h2 className="fab-section-title">{tr("دافعوا عن أي إجابة… أو شكّكوا فيها!")}</h2><p className="fab-note">{tr("الأسماء مخفية. لا تُظهروا إجاباتكم على الجوال.")}{state.hostId && tr(" صاحب الحقيقة يسمع فقط.")}</p><ClockPill remaining={state.remaining} urgent={state.remaining <= 5} label={tr("وقت النقاش المتبقي")} /></div><div className="fab-options">{state.options.map((o) => <div data-design-id="option" className="fab-opt" key={o.id} dir="auto">{o.text}</div>)}</div><Button data-design-id="continue" data-design-required="true" variant="accent" full onClick={() => act('START_VOTE')}>{tr("جاهزون، نبدأ التصويت السري")}</Button></div>}
      {state.phase === 'gather' && <div className="stack center fab-intro"><span className={`fab-big clay-stage ${gatherReaction}`} aria-hidden="true"><span className="clay-lift"><GameArtwork game="meenfina" /></span></span><h2>{tr("اجتمعوا حول الشاشة")}</h2><p className="muted">{tr("انتهى التصويت. سنكشف أصحاب الإجابات ومن صدّقهم، ونترك الحقيقة وأقوى كذبة للنهاية.")}</p><Button data-design-id="continue" data-design-required="true" variant="accent" size="lg" full onClick={() => act('START_REVEAL')}>{tr("ابدأوا الكشف")}</Button></div>}
      {state.phase === 'reveal' && <Reveal state={state} act={act} frozen={!!api.designPreview} />}
      {state.phase === 'roundEnd' && <div className="stack fab-round-summary">
        <h2 className="fab-section-title">{tr("حصيلة الجولة ")}{state.round}</h2>
        <div data-design-id="round-scores" className="fab-round-scores">
          {standings(state).map((player, index) => {
            const breakdown = state.breakdown[player.id];
            return <article key={player.id}>
              <ChoicePortrait player={player} size={48} />
              <div className="fab-score-player"><b dir="auto">{player.name}</b><strong>+{breakdown.points}</strong>
                <p>{breakdown.host ? tr("صاحب الحقيقة · يرتاح من النقاط هذا الدور") : tr("{v0} · خداع: {v1}{v2}", {v0: breakdown.byWriting ? tr("كتب الحقيقة") : tr("حقيقة: {count}", {count:breakdown.truth}), v1: breakdown.fooled, v2: state.settings.funnyVote ? tr(" · ضحك: {count}", {count:breakdown.laughs}) : ''})}</p>
              </div>
              <span className="fab-score-total"><small>{tr("إجمالي النقاط")}</small><CountUp value={player.score} from={player.score - breakdown.points} duration={700} delay={400 + index * 70} /></span>
            </article>;
          })}
        </div>
        {state.settings.funnyVote && <RoundLaughAward state={state} />}
        <Button data-design-id="continue" data-design-required="true" variant="accent" size="lg" full onClick={() => act('NEXT_ROUND')}>{state.round === state.rounds ? tr("النتائج والألقاب") : tr("الجولة التالية")}</Button>
      </div>}
      {state.phase === 'over' && <div className="stack fab-final-view"><Results state={state} /><div className="stack fab-final-actions"><Button variant="accent" size="lg" full data-design-id="restart" onClick={api.restart}>{tr("نلعب مرة ثانية")}</Button><Button variant="secondary" full data-design-id="options" onClick={api.backToSetup}>{tr("تغيير النمط أو اللاعبين")}</Button><Button variant="secondary" full data-design-id="exit" data-design-required="true" onClick={onExit}>{tr("العودة إلى ميدان")}</Button></div></div>}
    </>}
  </Screen>;
}

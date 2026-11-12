import { arabicNumber } from './format.js';
import { tr } from '../shared/i18n/core.js';
import React, { useEffect, useRef, useState } from 'react';
import { Button, Card, ConfirmModal, Podium, Scoreboard } from '../shared/ui/components.jsx';
import { Avatar } from '../shared/brand/art.jsx';
import { Illustration } from '../games/fabraka/Illustration.jsx';
import { getGameContent } from '../data/game-content.js';
import { normalizeOptions, questionPool, ROUNDS, validateLie, awards, bestLies } from '../games/fabraka/logic.js';
import css from '../games/fabraka/fabraka.css';
import { minimumOnlinePlayers } from './shared.js';
import { vignette } from '../shared/fx/index.js';
import { usePlatform } from '../platform/context.js';
import { useCandidateDeadlineWarning } from '../shared/fx/useDeadlineAudio.js';

const number = arabicNumber;
// Mirrors the single-device setup check in src/games/fabraka/Game.jsx: only the
// text modes draw from the question pool, and mixed spends every third round on a picture.
export function fabrakaTopics(value) {
  const options = normalizeOptions(value);
  const {questions}=getGameContent('fabraka',value?.contentLocale||'ar',value?.contentVersion);
  const counted = ['classic', 'mixed'].includes(options.mode);
  const needed = options.mode === 'mixed' ? options.rounds - Math.floor(options.rounds / 3) : options.rounds;
  const count = questionPool(questions, options).length;
  return { count, needed: counted ? needed : 0, enough: !counted || count >= needed };
}
export const FABRAKA_MODES = { classic: 'حقائق', mixed: 'مزيج', pictures: 'صور', friends: 'أصحابنا' };
const modeHints = {
  classic: 'فبرك إجابة مقنعة لسؤال حقيقي، ثم اكتشف الحقيقة بين إجابات أصحابك.',
  mixed: 'أسئلة حقائق تتخللها جولة صور كل ثلاث جولات.',
  pictures: '{v0} صورة توضيحية لأدوات حقيقية؛ فبركوا استخدامًا يبدو منطقيًا.',
  friends: 'يتناوب اللاعبون على كتابة حقيقة عن أنفسهم، والبقية يفبركون ويصوّتون.',
};
export function FabrakaSettings({ value, onChange, disabled }) {
  const {categories,pictures}=getGameContent('fabraka',value?.contentLocale||'ar',value?.contentVersion);
  const update = (patch) => onChange(normalizeOptions({ ...value, ...patch }));
  const topics = fabrakaTopics(value);
  return <fieldset className="online-fab-settings stack" disabled={disabled}>
    <legend>{tr("إعدادات فبركة")}</legend>
    <label className="online-field">{tr("نمط فبركة")}<select value={value.mode} onChange={(e) => update({ mode: e.target.value })}>
      {Object.entries(FABRAKA_MODES).map(([id, label]) => <option key={id} value={id}>{tr(label)}</option>)}
    </select></label>
    <p className="online-footnote">{tr(modeHints[value.mode], {v0: number(pictures.length)})}</p>
    <p className="online-footnote">{value.mode === 'friends' ? tr("نمط أصحابنا يحتاج ٣–٨ لاعبين.") : tr("متاح لشخصين أو أكثر · ٢–٨ لاعبين.")}</p>
    {value.mode === 'friends' ? <label className="online-field">{tr("دورات الأصحاب")}<select value={value.friendCycles} onChange={(e) => update({ friendCycles: Number(e.target.value) })}>
      <option value={1}>{tr("دور لكل لاعب")}</option><option value={2}>{tr("دوران لكل لاعب")}</option>
    </select></label> : <label className="online-field">{tr("عدد جولات فبركة")}<select value={value.rounds} onChange={(e) => update({ rounds: Number(e.target.value) })}>
      {ROUNDS.map((n) => <option key={n} value={n}>{number(n)}{tr(" جولات")}</option>)}
    </select></label>}
    {['classic', 'mixed'].includes(value.mode) && <>
      <label className="online-field">{tr("نوع الأسئلة")}<select value={value.style} onChange={(e) => update({ style: e.target.value })}>
        <option value="curious">{tr("غرائب مختارة")}</option><option value="all">{tr("كل الأسئلة")}</option>
      </select></label>
      <details className="online-fab-details"><summary>{tr("المواضيع · ")}{value.categories.length ? tr("{v0} مختارة", {v0: number(value.categories.length)}) : tr("الكل")}</summary>
        <div className="online-fab-categories" role="group" aria-label={tr("مواضيع فبركة")}>
          <Button size="sm" aria-pressed={!value.categories.length} onClick={() => update({ categories: [] })}>{tr("كل المواضيع")}</Button>
          {categories.map((category) => <Button size="sm" key={category} aria-pressed={value.categories.includes(category)} onClick={() => update({ categories: value.categories.includes(category) ? value.categories.filter((c) => c !== category) : [...value.categories, category] })}>{category}</Button>)}
        </div><p className="online-footnote">{number(topics.count)}{tr(" سؤالًا متاحًا في المواضيع المختارة.")}</p>
      </details>
      {/* The warning has to sit outside the collapsed block, or the host never sees why creating fails. */}
      {!topics.enough && <p className="online-notice error" role="alert">{tr("الأسئلة المتاحة (")}{number(topics.count)}{tr(") لا تكفي ")}{number(topics.needed)}{tr(" جولة. وسّع المواضيع المختارة أو اختر «كل الأسئلة».")}</p>}
    </>}
    <div className="online-fab-settings-grid">
      <label className="online-field">{tr("وقت الكتابة")}<select value={value.writeSeconds} onChange={(e) => update({ writeSeconds: Number(e.target.value) })}>
        <option value={45}>{tr("٤٥ ثانية")}</option><option value={30}>{tr("٣٠ ثانية")}</option><option value={0}>{tr("براحتنا")}</option>
      </select></label>
      <label className="online-field">{tr("وقت النقاش")}<select value={value.discussionSeconds} onChange={(e) => update({ discussionSeconds: Number(e.target.value) })}>
        <option value={20}>{tr("٢٠ ثانية")}</option><option value={15}>{tr("١٥ ثانية")}</option><option value={0}>{tr("بدون نقاش")}</option>
      </select></label>
    </div>
    <label className="online-fab-toggle"><input type="checkbox" checked={value.funnyVote} onChange={(e) => update({ funnyVote: e.target.checked })} />{tr("جائزة أكثر إجابة مضحكة · بلا نقاط")}</label>
    {value.mode !== 'friends' && <label className="online-fab-toggle"><input type="checkbox" checked={value.finalDouble} onChange={(e) => update({ finalDouble: e.target.checked })} />{tr("مضاعفة نقاط الجولة الأخيرة")}</label>}
    <p className="online-footnote">{tr("يكتب الجميع في الوقت نفسه. التصويت ٣٠ ثانية، ويستمر المؤقت عند إخفاء الصفحة.")}</p>
  </fieldset>;
}
export function FabrakaRules() {
  return <details className="online-fab-details"><summary>{tr("قواعد فبركة والنقاط")}</summary><ul className="fab-rules">
    <li>{tr("لشخصين: امزج فبركتك بخيارات اللعبة وحاول كشف الحقيقة. الحقائق والصور والمزيج تدعم ٢–٨؛ نمط الأصحاب يحتاج ٣–٨.")}</li>
    <li>{tr("١٠٠٠ نقطة لاكتشاف الحقيقة، و٥٠٠ عن كل لاعب ينخدع بفبركتك.")}</li>
    <li>{tr("إذا كتبت الحقيقة تكسب نقاطها مرة واحدة؛ تصويتك لا يمنح الآخرين نقاط خداع في تلك الجولة.")}</li>
    <li>{tr("تُدمج الإجابات المتطابقة. لا يمكنك اختيار إجابتك، ولكل كاتب مؤهل نقاط الخداع كاملة.")}</li>
    <li>{tr("مساعدة واحدة طوال اللعبة؛ تفقد نقاط الخداع والضحك في الجولة التي استعنت فيها.")}</li>
    <li>{tr("تُثبت أول إجابة ترسلها. عند انتهاء وقت الكتابة تُتجاوز الإجابة التي لم تُثبت.")}</li>
    <li>{tr("الأسماء والتصويت والحقيقة تظهر أثناء الكشف. جائزة الضحك بلا نقاط.")}</li>
  </ul></details>;
}
function Question({ value, answer = false }) {
  if (!value) return null;
  const [before, ...rest] = value.text.split('___');
  return <div data-design-id="question" className="fab-question online-fab-question">
    {value.kind === 'picture' && <Illustration question={value} />}
    <h1 className={answer ? 'fab-q is-filled' : 'fab-q'}>{before}{rest.length > 0 && <><span className="blank">{answer ? value.answer || '…' : tr("؟؟؟")}</span>{rest.join('___')}</>}</h1>
  </div>;
}
function Draft({ state, me, disabled, expired, act, truth }) {
  const key = `maydan:fabraka:draft:${state.code}:${state.matchId}:${state.round}:${truth ? state.question.text : 'lie'}:${me.id}`;
  const [draft, setDraft] = useState(() => {
    try { if (state._designPreview) return { text: state.myHelp || '', aliases: '' }; const saved = JSON.parse(localStorage.getItem(key)); if (typeof saved?.text === 'string') return { text: saved.text, aliases: typeof saved.aliases === 'string' ? saved.aliases : '' }; } catch { /* memory-only form */ }
    return { text: state.myHelp || '', aliases: '' };
  });
  const [error, setError] = useState('');
  const help = useRef(state.myHelp);
  useEffect(() => {
    if (state.myHelp && state.myHelp !== help.current) setDraft((value) => ({ ...value, text: state.myHelp }));
    help.current = state.myHelp;
  }, [state.myHelp]);
  useEffect(() => { if (state._designPreview) return; try { localStorage.setItem(key, JSON.stringify(draft)); } catch { /* memory-only form */ } }, [key, draft, state._designPreview]);
  async function submit(event) {
    event.preventDefault();
    const checked = validateLie(draft.text, state.contentLocale || 'ar');
    if (!checked.ok) { setError(checked.message); return; }
    const aliases = draft.aliases.split(/[؛;\n]/).map((x) => x.trim()).filter(Boolean);
    if (truth && (aliases.length > 3 || aliases.some((x) => !validateLie(x).ok))) { setError(tr("اكتب حتى ٣ صيغ صحيحة، كل صيغة حتى ٦٠ حرفًا.")); return; }
    if (await act(truth ? 'truth' : 'lie', { text: checked.text, ...(truth ? { aliases } : {}) })) {
      try { if (!state._designPreview) localStorage.removeItem(key); } catch { /* memory-only form */ }
    }
  }
  return <form data-design-id="draft" className="stack fab-draft" onSubmit={submit}>
    <label className="online-field">{truth ? tr("إجابتك الحقيقية عن نفسك") : tr("فبركتك السرية")}
      <input data-design-id="answer-input" autoComplete="off" maxLength={60} value={draft.text} disabled={disabled || expired} onChange={(e) => { setDraft({ ...draft, text: e.target.value }); setError(''); }} placeholder={truth ? tr("اكتب الحقيقة هنا") : tr("اكتب إجابة تبدو مقنعة")} />
    </label>
    {truth && <details className="online-fab-details"><summary>{tr("صيغ صحيحة أخرى لإجابتك (اختياري)")}</summary>
      <label className="online-field">{tr("حتى ٣ صيغ، افصل بينها بـ ؛")}<input data-design-id="answer-aliases" autoComplete="off" maxLength={180} value={draft.aliases} disabled={disabled || expired} onChange={(e) => setDraft({ ...draft, aliases: e.target.value })} placeholder={tr("معكرونة؛ مكرونة")} /></label>
    </details>}
    {error && <p role="alert" className="online-notice error">{tr(error)}</p>}
    <Button data-design-id="submit" data-sound="none" full variant="primary" size="lg" type="submit" disabled={disabled || expired}>{truth ? tr("ثبّت الحقيقة وابدأ الكتابة") : tr("ثبّت إجابتي")}</Button>
    {truth ? <Button data-design-id="skip" full variant="ghost" disabled={disabled || expired || !state.canSkipPrompt} onClick={() => act('skip_prompt')}>{tr("سؤال آخر")}</Button> : <>
      {state.myHelp && <p className="online-notice" role="status">{tr("استخدمت المساعدة؛ إجابتك لا تكسب نقاط خداع أو ضحك في هذه الجولة، ويمكنك كسب نقاط الحقيقة.")}</p>}
      <Button data-design-id="assistance" data-sound="none" full variant="secondary" disabled={disabled || expired || !state.helpAvailable} onClick={() => act('help')}>{state.helpAvailable ? tr("أحتاج فكرة · مساعدة واحدة في اللعبة") : tr("استُخدمت مساعدتي")}</Button>
      <Button data-design-id="skip" data-sound="none" full variant="ghost" disabled={disabled || expired} onClick={() => act('lie', { skip: true })}>{tr("أمرّر بدون إجابة")}</Button>
      <p className="online-footnote">{tr("اضغط «ثبّت إجابتي» قبل انتهاء الوقت. لن نكشف أثناء الكتابة هل طابقت الحقيقة أو إجابة أخرى.")}</p>
    </>}
  </form>;
}
function Vote({ state, disabled, expired, act }) {
  const [choice, setChoice] = useState(undefined), [funny, setFunny] = useState(null);
  const choices = (value, setValue, label) => <div className="stack" role="group" aria-label={label}>
    {state.options.map((o) => <button key={o.id} type="button" data-design-id="option" className={`fab-opt ${value === o.id ? 'selected' : ''}`} aria-pressed={value === o.id} disabled={disabled || expired || o.mine} onClick={() => setValue(o.id)}><span className="grow">{o.text}</span><span className="fab-choice-dot" aria-hidden="true"/>{o.mine && <small>{tr("إجابتك")}</small>}</button>)}
  </div>;
  if (state.myVote.submitted) return <div className="online-voted" role="status"><strong>{tr("وصل تصويتك ✓")}</strong><p>{tr("اختيارك: ")}{state.options.find((o) => o.id === state.myVote.optionId)?.text || tr("امتناع")}{tr(". بانتظار الباقي…")}</p></div>;
  return <div className="stack">
    <h2>{tr("أين الحقيقة؟")}</h2><p className="online-footnote">{tr("اختيارك سري، ولا يمكنك التصويت لإجابتك.")}</p>
    {choices(choice, setChoice, tr("اختيار الحقيقة"))}
    <Button data-design-id="abstain" aria-pressed={choice === null} variant={choice === null ? 'secondary' : 'ghost'} disabled={disabled || expired} onClick={() => setChoice(null)}>{tr("أمتنع عن تصويت الحقيقة")}</Button>
    {state.settings.funnyVote && <details className="online-fab-details"><summary>{tr("أي إجابة أضحكتك؟ (اختياري)")}</summary><p className="online-footnote">{tr("جائزة مستقلة بلا نقاط؛ لا تُحسب إن كانت الإجابة هي الحقيقة.")}</p>
      <label className="online-field fab-funny-choice">{tr("ترشيح الضحكة")}<select data-design-id="option" aria-label={tr("اختيار الإجابة المضحكة")} value={funny ?? ''} disabled={disabled || expired} onChange={(e) => setFunny(e.target.value || null)}><option value="">{tr("بدون ترشيح مضحك")}</option>{state.options.map((option) => <option key={option.id} value={option.id} disabled={option.mine}>{option.text}{option.mine ? tr(" · إجابتك") : ''}</option>)}</select></label><Button data-design-id="funny-clear" variant="ghost" disabled={disabled || expired} onClick={() => setFunny(null)}>{tr("بدون ترشيح مضحك")}</Button>
    </details>}
    <Button data-design-id="submit" data-sound="none" full size="lg" variant="primary" disabled={disabled || expired || choice === undefined} onClick={() => act('vote', { optionId: choice, funnyId: funny })}>{tr("ثبّت تصويتي")}</Button>
  </div>;
}
function AnswerCard({ option, members, multiplier, index = 0 }) {
  const names = (ids) => (ids || []).map((id) => members.find((m) => m.id === id)?.name).filter(Boolean).join('، ');
  const revealed = typeof option.truth === 'boolean';
  return <article style={{ '--i': index }} className={`fab-reveal-card ${revealed ? option.truth ? 'is-truth' : 'is-lie' : ''}`}>
    <h3>{option.text}</h3>
    {revealed && <div className="stack fab-reveal-detail">
      <strong className="fab-reveal-label">{option.truth ? tr("هذه هي الحقيقة!") : option.owners.length ? tr("كتبها: {v0}", {v0: names(option.owners)}) : tr("إجابة أضافتها اللعبة")}</strong>
      <p>{option.voters.length ? tr("اختارها: {v0}", {v0: names(option.voters)}) : tr("لم يصوّت لها أحد.")}</p>
      {!option.truth && option.earners.length > 0 && <p>{tr("خدعت ")}{number(option.fooled)} · +{number(option.fooled * 500 * multiplier)}{tr(" لكل كاتب مؤهل")}</p>}
      {!option.truth && option.owners.some((id) => !option.earners.includes(id)) && <p className="online-footnote">{tr("إجابات المساعدة لا تكسب نقاط خداع أو ضحك.")}</p>}
      {!option.truth && option.earners.length > 0 && option.funnyVoters.length > 0 && <p>{tr("أضحكت: ")}{names(option.funnyVoters)}</p>}
    </div>}
  </article>;
}
function Final({ state, sorted, isHost, disabled, act }) {
  const result = { players: sorted, scores: Object.fromEntries(sorted.map((m) => [m.id, m.score])),
    stats: Object.fromEntries(sorted.map((m) => [m.id, m.stats])), history: state.history };
  const honors = awards(result), highlights = bestLies(result);
  const names = (ids) => ids.map((id) => sorted.find((m) => m.id === id)?.name).filter(Boolean).join('، ');
  return <>
    {state.reason === 'players_left' && <p className="online-notice">{tr("انتهت اللعبة لأن عدد اللاعبين أصبح أقل من ")}{number(minimumOnlinePlayers('fabraka', state.settings))}{tr(". هذه نقاط الجولات المكتملة.")}</p>}
    <Podium data-design-id="podium" entries={sorted} />
    <div className="fab-awards">{honors.map((award) => <Card key={award.stat}><span className="fab-award-icon" aria-hidden="true">{award.emoji}</span><h3>{tr(award.title)}</h3><p>{award.players.map((p) => p.name).join('، ')}</p></Card>)}</div>
    <Card className="stack"><h2>{tr("حصيلة الجلسة")}</h2>{sorted.map((p, i) => <div data-design-id="round-scores" className="online-fab-total" key={p.id} style={{ '--i': i }}><Avatar index={p.avatar} /><div className="grow"><b>{p.name}</b><small>{number(p.stats.truths)}{tr(" حقائق · ")}{number(p.stats.fooled)}{tr(" خدعات")}{state.settings.funnyVote && tr(" · {v0} ضحكات", {v0: number(p.stats.laughs)})}</small></div><strong>{number(p.score)}</strong></div>)}</Card>
    {highlights.length > 0 && <Card className="stack"><h2>{tr("فبركات تستحق التذكّر")}</h2>{highlights.map((h, i) => <div key={`${h.round}-${i}`}><blockquote>«{h.text}»</blockquote><p className="online-footnote">{names(h.owners)}{tr(" · خدعت ")}{number(h.fooled)}{state.settings.funnyVote && tr(" · أضحكت {v0}", {v0: number(h.laughs)})}</p></div>)}</Card>}
    {isHost ? <Button data-design-id="restart" full size="lg" variant="primary" disabled={disabled} onClick={() => act('restart')}>{tr("العودة للانتظار ولعب مرة ثانية")}</Button> : <p className="online-footnote">{tr("بانتظار المضيف لبدء لعبة جديدة.")}</p>}
  </>;
}
export function FabrakaMatch({ state, me, isHost, disabled, act, clockOffset, spectating = false }) {
  const [now, setNow] = useState(Date.now()), [confirmFinish, setConfirmFinish] = useState(false), [confirmSkip, setConfirmSkip] = useState(false);
  useEffect(() => {
    if (!state.deadlineAt || state._designPreview) return;
    setNow(Date.now()); const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [state.deadlineAt, state._designPreview]);
  const seconds = state.deadlineAt ? Math.max(0, Math.ceil((state.deadlineAt - (now + clockOffset)) / 1000)) : null;
  const platform = usePlatform();
  useCandidateDeadlineWarning(platform?.sound, JSON.stringify(['fabraka', state.code, state.matchId, state.round, state.phase, me?.id]), seconds,
    !state._designPreview && !disabled && !spectating && ['write', 'vote'].includes(state.phase));
  const expired = seconds === 0;
  // Public reveal transitions belong to the persistent room audio projection,
  // not this mount or the truth/owner fields of an option.
  // آخر ثلاث ثوانٍ: تظليل أحمر نابض (يُطفأ عند الخروج).
  useEffect(() => {
    if (state._designPreview) return undefined;
    vignette(seconds !== null && seconds > 0 && seconds <= 3);
    return () => vignette(false);
  }, [seconds, state._designPreview]);
  const players = state.members.filter((m) => state.participants.includes(m.id));
  const sorted = [...players].sort((a, b) => b.score - a.score);
  const truthOwner = state.truthHostId === me?.id;
  const owner = state.members.find((m) => m.id === state.truthHostId);
  const ownerName = owner?.name;
  const multiplier = state.settings.finalDouble && state.round === state.rounds ? 2 : 1;
  const roundKey = `${state.code}:${state.matchId}:${state.round}`;
  return <div data-design-screen={`online.fabraka.${state.phase}`} className="fabraka stack online-fabraka"><style>{css}</style>
    {state.phase === 'over' ? <Final state={state} sorted={sorted} isHost={isHost} disabled={disabled} act={act} /> : <>
      <header className="fab-bar"><div><b>{tr("الجولة ")}{number(state.round)}{tr(" من ")}{number(state.rounds)}</b><small>{tr(FABRAKA_MODES[state.settings.mode])}{tr(" · أونلاين")}</small></div>{seconds !== null && <span data-design-id="timer" className={`online-timer ${seconds <= 5 ? 'urgent' : ''}`} role="timer" aria-label={tr("متبقي {v0} ثانية", {v0: seconds})}><b key={seconds <= 5 ? seconds : 'n'}><bdi>{number(seconds)}</bdi></b>{tr(" ث")}</span>}</header>
      {multiplier === 2 && <p className="online-notice online-double"><span className="fire" aria-hidden="true">🔥</span>{tr("الجولة الأخيرة · نقاط الحقيقة والخداع مضاعفة!")}</p>}
      <Card><Question value={state.question} answer={state.phase === 'result' && !state.roundReason} /></Card>
      {state.phase === 'host' && <Card className="stack">
        {truthOwner ? <><h2>{tr("هذه جولتك يا ")}{me.name}</h2><p className="online-footnote">{tr("اكتب الحقيقة عن نفسك. لن تشارك في الكتابة والتصويت أو تجمع نقاطًا في هذا الدور.")}</p><Draft key={`${roundKey}:truth:${state.question.text}`} state={state} me={me} truth disabled={disabled} expired={expired} act={act} /></> : <div role="status" className="online-waiting"><h2>{tr("بانتظار حقيقة ")}{ownerName}</h2><p>{owner && !owner.connected ? tr("انقطع اتصال صاحب الجولة. يستطيع المضيف تخطّي الجولة بدل انتظار المهلة.") : tr("يكتب صاحب الجولة إجابته سرًا، ثم تبدأون الفبركة معًا.")}</p></div>}
        {isHost && !truthOwner && <Button data-design-id="skip" full variant="ghost" disabled={disabled} onClick={() => setConfirmSkip(true)}>{tr("تخطّي هذه الجولة")}</Button>}
      </Card>}
      {state.phase === 'write' && <Card className="stack">
        {truthOwner ? <div role="status" className="online-waiting"><h2>{tr("أصحابك يفبركون الآن")}</h2><p>{tr("حقيقتك: ")}{state.myTruth}{tr(". تابع الجولة دون تلميحات.")}</p></div>
          : spectating ? <div role="status" className="online-waiting"><h2>{tr("اللاعبون يفبركون الآن")}</h2><p>{tr("تتفرج على هذه المباراة، وتكتب معهم من المباراة القادمة.")}</p></div>
          : state.mySubmission.submitted ? <div className="online-voted" role="status"><strong>{tr("وصلت إجابتك ✓")}</strong><p>{state.mySubmission.skipped ? tr("مرّرت بدون إجابة.") : tr("إجابتك: {v0}", {v0: state.mySubmission.text})}</p><p>{tr("بانتظار الباقي…")}</p></div>
          : <Draft key={`${roundKey}:write`} state={state} me={me} disabled={disabled} expired={expired} act={act} />}
        <p className="online-footnote" role="status">{tr("ثبّت ")}{number(state.writingCount)}{tr(" من ")}{number(state.writerCount)}{tr(" إجاباتهم.")}</p>
        {isHost && !state.deadlineAt && <Button data-design-id="continue" data-sound="none" full variant="secondary" disabled={disabled} onClick={() => setConfirmFinish(true)}>{tr("إنهاء الكتابة وخلط الإجابات")}</Button>}
      </Card>}
      {state.phase === 'discussion' && <Card className="stack"><h2>{tr("ناقشوا الإجابات")}</h2><p>{tr("أي إجابة تبدو حقيقية؟ الكتّاب مخفيون حتى الكشف.")}</p>
        {state.options.map((o) => <div key={o.id} data-design-id="option" className="fab-opt"><span className="grow">{o.text}</span>{o.mine && <small>{tr("إجابتك")}</small>}</div>)}
        {isHost && <Button data-design-id="continue" data-sound="none" full variant="primary" disabled={disabled || expired} onClick={() => act('start_vote')}>{tr("ابدأ التصويت")}</Button>}
        <p className="online-footnote">{tr("يبدأ التصويت تلقائيًا عند انتهاء النقاش.")}</p>
      </Card>}
      {state.phase === 'vote' && <Card className="stack">{truthOwner ? <div role="status" className="online-waiting"><h2>{tr("أصحابك يصوّتون")}</h2><p>{tr("صاحب الحقيقة لا يصوّت في جولته.")}</p></div> : spectating ? <div role="status" className="online-waiting"><h2>{tr("اللاعبون يصوّتون")}</h2><p>{tr("من يصدّقون؟ تابع الكشف معهم.")}</p></div> : <Vote key={`${roundKey}:vote`} state={state} disabled={disabled} expired={expired} act={act} />}
        <p className="online-footnote" role="status">{tr("وصل ")}{number(state.submittedCount)}{tr(" من ")}{number(state.writerCount)}{tr(" أصوات.")}</p>
      </Card>}
      {state.phase === 'reveal' && <Card className="stack"><h2>{state.reveal.final ? tr("الحقيقة… أم أقوى فبركة؟") : tr("من كتبها؟ ومن صدّقها؟")}</h2>
        {state.reveal.options.map((o, i) => <AnswerCard key={o.id} index={i} option={o} members={players} multiplier={multiplier} />)}
        {isHost ? <Button data-design-id="reveal" data-sound="none" full variant="primary" disabled={disabled} onClick={() => act(state.reveal.shown ? 'next_reveal' : 'reveal')}>{state.reveal.shown ? tr("المجموعة التالية") : state.reveal.final ? tr("اكشف الحقيقة!") : tr("اكشف هذه الإجابات")}</Button> : <p className="online-footnote">{tr("المضيف يكشف الإجابات للجميع.")}</p>}
      </Card>}
      {state.phase === 'result' && <>
        <Card className="stack">{state.roundReason ? <p className="online-notice">{state.roundReason === 'owner_left' ? tr("غادر صاحب الحقيقة قبل تثبيت إجابته.") : state.roundReason === 'skipped' ? tr("تجاوز المضيف هذه الجولة.") : tr("انتهى وقت كتابة الحقيقة.")}{tr(" انتقلوا للجولة التالية؛ لا نقاط في هذه الجولة.")}</p> : <>
          <h2>{tr("الحقيقة: ")}{state.question.answer}</h2><p>{state.question.explanation}</p>
          {state.question.sourceUrl && <a href={state.question.sourceUrl} target="_blank" rel="noreferrer">{tr("مصدر المعلومة")}</a>}
          {state.options.map((o, i) => <AnswerCard key={o.id} index={i} option={o} members={players} multiplier={multiplier} />)}
        </>}
        <h2>{tr("حصيلة الجولة")}</h2>{players.map((p, i) => { const row = state.breakdown[p.id] || {}; return <div key={p.id} data-design-id="round-scores" className="online-fab-total" style={{ '--i': i }}><Avatar index={p.avatar} /><div className="grow"><b>{p.name}</b><small>{row.host ? tr("صاحب الحقيقة") : row.byWriting ? tr("عرف الحقيقة أثناء الكتابة") : tr("{v0}{v1} خدعات", {v0: row.truth ? tr("اكتشف الحقيقة · ") : '', v1: number(row.fooled || 0)})}</small></div><strong>+{number(row.points || 0)}</strong></div>; })}
        {isHost ? <Button data-design-id="continue" data-sound="none" full size="lg" variant="primary" disabled={disabled} onClick={() => act('next')}>{state.round === state.rounds ? tr("عرض النتيجة النهائية") : tr("الجولة التالية")}</Button> : <p className="online-footnote">{tr("بانتظار المضيف للمتابعة.")}</p>}
        </Card>
      </>}
      {expired && <p className="online-footnote" role="status">{tr("انتهى الوقت، جاري تحديث الجولة…")}</p>}
      <Card className="stack"><h2>{tr("النقاط")}</h2><Scoreboard data-design-id="scoreboard" entries={sorted} /></Card>
    </>}
    {confirmFinish && <ConfirmModal title={tr("إنهاء الكتابة؟")} message={tr("ستُخلط الإجابات المثبتة، ويتجاوز الدور من لم يرسل إجابته.")} confirmLabel={tr("إنهاء الكتابة")} cancelLabel={tr("ننتظر الباقي")} onConfirm={async () => { setConfirmFinish(false); await act('finish_writing'); }} onCancel={() => setConfirmFinish(false)} />}
    {confirmSkip && <ConfirmModal title={tr("تخطّي الجولة؟")} message={tr("تنتهي هذه الجولة بلا نقاط وتبدأ التالية بصاحب حقيقة آخر.")} confirmLabel={tr("تخطّي")} cancelLabel={tr("ننتظر")} onConfirm={async () => { setConfirmSkip(false); await act('skip_round'); }} onCancel={() => setConfirmSkip(false)} />}
  </div>;
}

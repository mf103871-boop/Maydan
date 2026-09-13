import React, { useEffect, useRef, useState } from 'react';
import { Button, Card, ConfirmModal, Podium, Scoreboard } from '../shared/ui/components.jsx';
import { Avatar } from '../shared/brand/art.jsx';
import { Illustration } from '../games/fabraka/Illustration.jsx';
import { pictures, questions, categories } from '../games/fabraka/content.js';
import { normalizeOptions, questionPool, ROUNDS, validateLie, awards, bestLies } from '../games/fabraka/logic.js';
import css from '../games/fabraka/fabraka.css';

const number = (n) => Number(n).toLocaleString('ar');
export const FABRAKA_MODES = { classic: 'حقائق', mixed: 'مزيج', pictures: 'صور', friends: 'أصحابنا' };
const modeHints = {
  classic: 'فبرك إجابة مقنعة لسؤال حقيقي، ثم اكتشف الحقيقة بين إجابات أصحابك.',
  mixed: 'أسئلة حقائق تتخللها جولة صور كل ثلاث جولات.',
  pictures: 'شاهدوا رسم أداة حقيقية، وفبركوا استخدامًا يبدو منطقيًا.',
  friends: 'يتناوب اللاعبون على كتابة حقيقة عن أنفسهم، والبقية يفبركون ويصوّتون.',
};
export function FabrakaSettings({ value, onChange, disabled }) {
  const update = (patch) => onChange(normalizeOptions({ ...value, ...patch }));
  const count = questionPool(questions, value).length;
  return <fieldset className="online-fab-settings stack" disabled={disabled}>
    <legend>إعدادات فبركة</legend>
    <label className="online-field">نمط فبركة<select value={value.mode} onChange={(e) => update({ mode: e.target.value })}>
      {Object.entries(FABRAKA_MODES).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
    </select></label>
    <p className="online-footnote">{modeHints[value.mode]}</p>
    {value.mode === 'friends' ? <label className="online-field">دورات الأصحاب<select value={value.friendCycles} onChange={(e) => update({ friendCycles: Number(e.target.value) })}>
      <option value={1}>دور لكل لاعب</option><option value={2}>دوران لكل لاعب</option>
    </select></label> : <label className="online-field">عدد جولات فبركة<select value={value.rounds} onChange={(e) => update({ rounds: Number(e.target.value) })}>
      {ROUNDS.map((n) => <option key={n} value={n}>{number(n)} جولات</option>)}
    </select></label>}
    {['classic', 'mixed'].includes(value.mode) && <>
      <label className="online-field">نوع الأسئلة<select value={value.style} onChange={(e) => update({ style: e.target.value })}>
        <option value="curious">غرائب مختارة</option><option value="all">كل الأسئلة</option>
      </select></label>
      <details className="online-fab-details"><summary>المواضيع · {value.categories.length ? `${number(value.categories.length)} مختارة` : 'الكل'}</summary>
        <div className="online-fab-categories" role="group" aria-label="مواضيع فبركة">
          <Button size="sm" aria-pressed={!value.categories.length} onClick={() => update({ categories: [] })}>كل المواضيع</Button>
          {categories.map((category) => <Button size="sm" key={category} aria-pressed={value.categories.includes(category)} onClick={() => update({ categories: value.categories.includes(category) ? value.categories.filter((c) => c !== category) : [...value.categories, category] })}>{category}</Button>)}
        </div><p className="online-footnote">{number(count)} سؤالًا متاحًا في المواضيع المختارة.</p>
      </details>
    </>}
    <div className="online-fab-settings-grid">
      <label className="online-field">وقت الكتابة<select value={value.writeSeconds} onChange={(e) => update({ writeSeconds: Number(e.target.value) })}>
        <option value={45}>٤٥ ثانية</option><option value={30}>٣٠ ثانية</option><option value={0}>براحتنا</option>
      </select></label>
      <label className="online-field">وقت النقاش<select value={value.discussionSeconds} onChange={(e) => update({ discussionSeconds: Number(e.target.value) })}>
        <option value={20}>٢٠ ثانية</option><option value={15}>١٥ ثانية</option><option value={0}>بدون نقاش</option>
      </select></label>
    </div>
    <label className="online-fab-toggle"><input type="checkbox" checked={value.funnyVote} onChange={(e) => update({ funnyVote: e.target.checked })} />جائزة أكثر إجابة مضحكة · بلا نقاط</label>
    {value.mode !== 'friends' && <label className="online-fab-toggle"><input type="checkbox" checked={value.finalDouble} onChange={(e) => update({ finalDouble: e.target.checked })} />مضاعفة نقاط الجولة الأخيرة</label>}
    <p className="online-footnote">يكتب الجميع في الوقت نفسه. التصويت ٣٠ ثانية، ويستمر المؤقت عند إخفاء الصفحة.</p>
  </fieldset>;
}
export function FabrakaRules() {
  return <details className="online-fab-details"><summary>قواعد فبركة والنقاط</summary><ul className="fab-rules">
    <li>١٠٠٠ نقطة لاكتشاف الحقيقة، و٥٠٠ عن كل لاعب ينخدع بفبركتك.</li>
    <li>إذا كتبت الحقيقة تكسب نقاطها مرة واحدة؛ تصويتك لا يمنح الآخرين نقاط خداع في تلك الجولة.</li>
    <li>تُدمج الإجابات المتطابقة. لا يمكنك اختيار إجابتك، ولكل كاتب مؤهل نقاط الخداع كاملة.</li>
    <li>مساعدة واحدة طوال اللعبة؛ تفقد نقاط الخداع والضحك في الجولة التي استعنت فيها.</li>
    <li>تُثبت أول إجابة ترسلها. عند انتهاء وقت الكتابة تُتجاوز الإجابة التي لم تُثبت.</li>
    <li>الأسماء والتصويت والحقيقة تظهر أثناء الكشف. جائزة الضحك بلا نقاط.</li>
  </ul></details>;
}
function Question({ value, answer = false }) {
  if (!value) return null;
  const [before, ...rest] = value.text.split('___');
  return <div className="fab-question online-fab-question">
    {value.kind === 'picture' && <Illustration question={{ illustration: pictures[value.visualIndex]?.illustration, imageDescription: value.imageDescription }} />}
    <h1 className="fab-q">{before}{rest.length > 0 && <><span className="blank">{answer ? value.answer || '…' : '؟؟؟'}</span>{rest.join('___')}</>}</h1>
  </div>;
}
function Draft({ state, me, disabled, expired, act, truth }) {
  const key = `maydan:fabraka:draft:${state.code}:${state.matchId}:${state.round}:${truth ? state.question.text : 'lie'}:${me.id}`;
  const [draft, setDraft] = useState(() => {
    try { const saved = JSON.parse(localStorage.getItem(key)); if (typeof saved?.text === 'string') return { text: saved.text, aliases: typeof saved.aliases === 'string' ? saved.aliases : '' }; } catch { /* memory-only form */ }
    return { text: state.myHelp || '', aliases: '' };
  });
  const [error, setError] = useState('');
  const help = useRef(state.myHelp);
  useEffect(() => {
    if (state.myHelp && state.myHelp !== help.current) setDraft((value) => ({ ...value, text: state.myHelp }));
    help.current = state.myHelp;
  }, [state.myHelp]);
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(draft)); } catch { /* memory-only form */ } }, [key, draft]);
  async function submit(event) {
    event.preventDefault();
    const checked = validateLie(draft.text);
    if (!checked.ok) { setError(checked.message); return; }
    const aliases = draft.aliases.split(/[؛;\n]/).map((x) => x.trim()).filter(Boolean);
    if (truth && (aliases.length > 3 || aliases.some((x) => !validateLie(x).ok))) { setError('اكتب حتى ٣ صيغ صحيحة، كل صيغة حتى ٦٠ حرفًا.'); return; }
    if (await act(truth ? 'truth' : 'lie', { text: checked.text, ...(truth ? { aliases } : {}) })) {
      try { localStorage.removeItem(key); } catch { /* memory-only form */ }
    }
  }
  return <form className="stack" onSubmit={submit}>
    <label className="online-field">{truth ? 'إجابتك الحقيقية عن نفسك' : 'فبركتك السرية'}
      <input autoComplete="off" maxLength={60} value={draft.text} disabled={disabled || expired} onChange={(e) => { setDraft({ ...draft, text: e.target.value }); setError(''); }} placeholder={truth ? 'اكتب الحقيقة هنا' : 'اكتب إجابة تبدو مقنعة'} />
    </label>
    {truth && <details className="online-fab-details"><summary>صيغ صحيحة أخرى لإجابتك (اختياري)</summary>
      <label className="online-field">حتى ٣ صيغ، افصل بينها بـ ؛<input autoComplete="off" maxLength={180} value={draft.aliases} disabled={disabled || expired} onChange={(e) => setDraft({ ...draft, aliases: e.target.value })} placeholder="معكرونة؛ مكرونة" /></label>
    </details>}
    {error && <p role="alert" className="online-notice error">{error}</p>}
    <Button full variant="primary" size="lg" type="submit" disabled={disabled || expired}>{truth ? 'ثبّت الحقيقة وابدأ الكتابة' : 'ثبّت إجابتي'}</Button>
    {truth ? <Button full variant="ghost" disabled={disabled || expired || !state.canSkipPrompt} onClick={() => act('skip_prompt')}>سؤال آخر</Button> : <>
      {state.myHelp && <p className="online-notice" role="status">استخدمت المساعدة؛ إجابتك لا تكسب نقاط خداع أو ضحك في هذه الجولة، ويمكنك كسب نقاط الحقيقة.</p>}
      <Button full variant="secondary" disabled={disabled || expired || !state.helpAvailable} onClick={() => act('help')}>{state.helpAvailable ? 'أحتاج فكرة · مساعدة واحدة في اللعبة' : 'استُخدمت مساعدتي'}</Button>
      <Button full variant="ghost" disabled={disabled || expired} onClick={() => act('lie', { skip: true })}>أمرّر بدون إجابة</Button>
      <p className="online-footnote">اضغط «ثبّت إجابتي» قبل انتهاء الوقت. لن نكشف أثناء الكتابة هل طابقت الحقيقة أو إجابة أخرى.</p>
    </>}
  </form>;
}
function Vote({ state, disabled, expired, act }) {
  const [choice, setChoice] = useState(undefined), [funny, setFunny] = useState(null);
  const choices = (value, setValue, label) => <div className="stack" role="group" aria-label={label}>
    {state.options.map((o) => <button key={o.id} type="button" className={`fab-opt ${value === o.id ? 'selected' : ''}`} aria-pressed={value === o.id} disabled={disabled || expired || o.mine} onClick={() => setValue(o.id)}><span className="grow">{o.text}</span>{o.mine && <small>إجابتك</small>}</button>)}
  </div>;
  if (state.myVote.submitted) return <div className="online-voted" role="status"><strong>وصل تصويتك ✓</strong><p>اختيارك: {state.options.find((o) => o.id === state.myVote.optionId)?.text || 'امتناع'}. بانتظار الباقي…</p></div>;
  return <div className="stack">
    <h2>أين الحقيقة؟</h2><p className="online-footnote">اختيارك سري، ولا يمكنك التصويت لإجابتك.</p>
    {choices(choice, setChoice, 'اختيار الحقيقة')}
    <Button aria-pressed={choice === null} variant={choice === null ? 'secondary' : 'ghost'} disabled={disabled || expired} onClick={() => setChoice(null)}>أمتنع عن تصويت الحقيقة</Button>
    {state.settings.funnyVote && <details className="online-fab-details"><summary>أي إجابة أضحكتك؟ (اختياري)</summary><p className="online-footnote">جائزة مستقلة بلا نقاط؛ لا تُحسب إن كانت الإجابة هي الحقيقة.</p>
      {choices(funny, setFunny, 'اختيار الإجابة المضحكة')}<Button variant="ghost" disabled={disabled || expired} onClick={() => setFunny(null)}>بدون ترشيح مضحك</Button>
    </details>}
    <Button full size="lg" variant="primary" disabled={disabled || expired || choice === undefined} onClick={() => act('vote', { optionId: choice, funnyId: funny })}>ثبّت تصويتي</Button>
  </div>;
}
function AnswerCard({ option, members, multiplier }) {
  const names = (ids) => (ids || []).map((id) => members.find((m) => m.id === id)?.name).filter(Boolean).join('، ');
  const revealed = typeof option.truth === 'boolean';
  return <article className={`fab-reveal-card ${revealed ? option.truth ? 'is-truth' : 'is-lie' : ''}`}>
    <h3>{option.text}</h3>
    {revealed && <div className="stack fab-reveal-detail">
      <strong>{option.truth ? 'هذه هي الحقيقة!' : option.owners.length ? `كتبها: ${names(option.owners)}` : 'إجابة أضافتها اللعبة'}</strong>
      <p>{option.voters.length ? `اختارها: ${names(option.voters)}` : 'لم يصوّت لها أحد.'}</p>
      {!option.truth && option.earners.length > 0 && <p>خدعت {number(option.fooled)} · +{number(option.fooled * 500 * multiplier)} لكل كاتب مؤهل</p>}
      {!option.truth && option.owners.some((id) => !option.earners.includes(id)) && <p className="online-footnote">إجابات المساعدة لا تكسب نقاط خداع أو ضحك.</p>}
      {!option.truth && option.earners.length > 0 && option.funnyVoters.length > 0 && <p>أضحكت: {names(option.funnyVoters)}</p>}
    </div>}
  </article>;
}
function Final({ state, sorted, isHost, disabled, act }) {
  const result = { players: sorted, scores: Object.fromEntries(sorted.map((m) => [m.id, m.score])),
    stats: Object.fromEntries(sorted.map((m) => [m.id, m.stats])), history: state.history };
  const honors = awards(result), highlights = bestLies(result);
  const names = (ids) => ids.map((id) => sorted.find((m) => m.id === id)?.name).filter(Boolean).join('، ');
  return <>
    {state.reason === 'players_left' && <p className="online-notice">انتهت اللعبة لأن عدد اللاعبين أصبح أقل من ٣. هذه نقاط الجولات المكتملة.</p>}
    <Podium entries={sorted} />
    <div className="fab-awards">{honors.map((award) => <Card key={award.stat}><span className="fab-award-icon" aria-hidden="true">{award.emoji}</span><h3>{award.title}</h3><p>{award.players.map((p) => p.name).join('، ')}</p></Card>)}</div>
    <Card className="stack"><h2>حصيلة الجلسة</h2>{sorted.map((p) => <div className="online-fab-total" key={p.id}><Avatar index={p.avatar} /><div className="grow"><b>{p.name}</b><small>{number(p.stats.truths)} حقائق · {number(p.stats.fooled)} خدعات{state.settings.funnyVote && ` · ${number(p.stats.laughs)} ضحكات`}</small></div><strong>{number(p.score)}</strong></div>)}</Card>
    {highlights.length > 0 && <Card className="stack"><h2>فبركات تستحق التذكّر</h2>{highlights.map((h, i) => <div key={`${h.round}-${i}`}><blockquote>«{h.text}»</blockquote><p className="online-footnote">{names(h.owners)} · خدعت {number(h.fooled)}{state.settings.funnyVote && ` · أضحكت ${number(h.laughs)}`}</p></div>)}</Card>}
    {isHost ? <Button full size="lg" variant="primary" disabled={disabled} onClick={() => act('restart')}>العودة للانتظار ولعب مرة ثانية</Button> : <p className="online-footnote">بانتظار المضيف لبدء لعبة جديدة.</p>}
  </>;
}
export function FabrakaMatch({ state, me, isHost, disabled, act, clockOffset }) {
  const [now, setNow] = useState(Date.now()), [confirmFinish, setConfirmFinish] = useState(false);
  useEffect(() => {
    if (!state.deadlineAt) return;
    setNow(Date.now()); const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [state.deadlineAt]);
  const seconds = state.deadlineAt ? Math.max(0, Math.ceil((state.deadlineAt - (now + clockOffset)) / 1000)) : null;
  const expired = seconds === 0;
  const players = state.members.filter((m) => state.participants.includes(m.id));
  const sorted = [...players].sort((a, b) => b.score - a.score);
  const truthOwner = state.truthHostId === me?.id;
  const ownerName = state.members.find((m) => m.id === state.truthHostId)?.name;
  const multiplier = state.settings.finalDouble && state.round === state.rounds ? 2 : 1;
  const roundKey = `${state.code}:${state.matchId}:${state.round}`;
  return <div className="fabraka stack online-fabraka"><style>{css}</style>
    {state.phase === 'over' ? <Final state={state} sorted={sorted} isHost={isHost} disabled={disabled} act={act} /> : <>
      <div className="row-between"><b>الجولة {number(state.round)} من {number(state.rounds)}</b>{seconds !== null && <span className={`online-timer ${seconds <= 5 ? 'urgent' : ''}`} role="timer" aria-label={`متبقي ${seconds} ثانية`}><bdi>{number(seconds)}</bdi> ث</span>}</div>
      {multiplier === 2 && <p className="online-notice">الجولة الأخيرة · نقاط الحقيقة والخداع مضاعفة!</p>}
      <Card><Question value={state.question} answer={state.phase === 'result' && !state.roundReason} /></Card>
      {state.phase === 'host' && <Card className="stack">
        {truthOwner ? <><h2>هذه جولتك يا {me.name}</h2><p className="online-footnote">اكتب الحقيقة عن نفسك. لن تشارك في الكتابة والتصويت أو تجمع نقاطًا في هذا الدور.</p><Draft key={`${roundKey}:truth:${state.question.text}`} state={state} me={me} truth disabled={disabled} expired={expired} act={act} /></> : <div role="status"><h2>بانتظار حقيقة {ownerName}</h2><p>يكتب صاحب الجولة إجابته سرًا، ثم تبدأون الفبركة معًا.</p></div>}
      </Card>}
      {state.phase === 'write' && <Card className="stack">
        {truthOwner ? <div role="status"><h2>أصحابك يفبركون الآن</h2><p>حقيقتك: {state.myTruth}. تابع الجولة دون تلميحات.</p></div>
          : state.mySubmission.submitted ? <div className="online-voted" role="status"><strong>وصلت إجابتك ✓</strong><p>{state.mySubmission.skipped ? 'مرّرت بدون إجابة.' : `إجابتك: ${state.mySubmission.text}`}</p><p>بانتظار الباقي…</p></div>
          : <Draft key={`${roundKey}:write`} state={state} me={me} disabled={disabled} expired={expired} act={act} />}
        <p className="online-footnote" role="status">ثبّت {number(state.writingCount)} من {number(state.writerCount)} إجاباتهم.</p>
        {isHost && !state.deadlineAt && <Button full variant="secondary" disabled={disabled} onClick={() => setConfirmFinish(true)}>إنهاء الكتابة وخلط الإجابات</Button>}
      </Card>}
      {state.phase === 'discussion' && <Card className="stack"><h2>ناقشوا الإجابات</h2><p>أي إجابة تبدو حقيقية؟ الكتّاب مخفيون حتى الكشف.</p>
        {state.options.map((o) => <div key={o.id} className="fab-opt"><span className="grow">{o.text}</span>{o.mine && <small>إجابتك</small>}</div>)}
        {isHost && <Button full variant="primary" disabled={disabled || expired} onClick={() => act('start_vote')}>ابدأ التصويت</Button>}
        <p className="online-footnote">يبدأ التصويت تلقائيًا عند انتهاء النقاش.</p>
      </Card>}
      {state.phase === 'vote' && <Card className="stack">{truthOwner ? <div role="status"><h2>أصحابك يصوّتون</h2><p>صاحب الحقيقة لا يصوّت في جولته.</p></div> : <Vote key={`${roundKey}:vote`} state={state} disabled={disabled} expired={expired} act={act} />}
        <p className="online-footnote" role="status">وصل {number(state.submittedCount)} من {number(state.writerCount)} أصوات.</p>
      </Card>}
      {state.phase === 'reveal' && <Card className="stack"><h2>{state.reveal.final ? 'الحقيقة… أم أقوى فبركة؟' : 'من كتبها؟ ومن صدّقها؟'}</h2>
        {state.reveal.options.map((o) => <AnswerCard key={o.id} option={o} members={players} multiplier={multiplier} />)}
        {isHost ? <Button full variant="primary" disabled={disabled} onClick={() => act(state.reveal.shown ? 'next_reveal' : 'reveal')}>{state.reveal.shown ? 'المجموعة التالية' : state.reveal.final ? 'اكشف الحقيقة!' : 'اكشف هذه الإجابات'}</Button> : <p className="online-footnote">المضيف يكشف الإجابات للجميع.</p>}
      </Card>}
      {state.phase === 'result' && <>
        <Card className="stack">{state.roundReason ? <p className="online-notice">{state.roundReason === 'owner_left' ? 'غادر صاحب الحقيقة قبل تثبيت إجابته.' : 'انتهى وقت كتابة الحقيقة.'} انتقلوا للجولة التالية؛ لا نقاط في هذه الجولة.</p> : <>
          <h2>الحقيقة: {state.question.answer}</h2><p>{state.question.explanation}</p>
          {state.question.sourceUrl && <a href={state.question.sourceUrl} target="_blank" rel="noreferrer">مصدر المعلومة</a>}
          {state.options.map((o) => <AnswerCard key={o.id} option={o} members={players} multiplier={multiplier} />)}
        </>}
        <h2>حصيلة الجولة</h2>{players.map((p) => { const row = state.breakdown[p.id] || {}; return <div key={p.id} className="online-fab-total"><Avatar index={p.avatar} /><div className="grow"><b>{p.name}</b><small>{row.host ? 'صاحب الحقيقة' : row.byWriting ? 'عرف الحقيقة أثناء الكتابة' : `${row.truth ? 'اكتشف الحقيقة · ' : ''}${number(row.fooled || 0)} خدعات`}</small></div><strong>+{number(row.points || 0)}</strong></div>; })}
        {isHost ? <Button full size="lg" variant="primary" disabled={disabled} onClick={() => act('next')}>{state.round === state.rounds ? 'عرض النتيجة النهائية' : 'الجولة التالية'}</Button> : <p className="online-footnote">بانتظار المضيف للمتابعة.</p>}
        </Card>
      </>}
      {expired && <p className="online-footnote" role="status">انتهى الوقت، جاري تحديث الجولة…</p>}
      <Card className="stack"><h2>النقاط</h2><Scoreboard entries={sorted} /></Card>
    </>}
    {confirmFinish && <ConfirmModal title="إنهاء الكتابة؟" message="ستُخلط الإجابات المثبتة، ويتجاوز الدور من لم يرسل إجابته." confirmLabel="إنهاء الكتابة" cancelLabel="ننتظر الباقي" onConfirm={async () => { setConfirmFinish(false); await act('finish_writing'); }} onCancel={() => setConfirmFinish(false)} />}
  </div>;
}

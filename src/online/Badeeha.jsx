// بَديهة أونلاين: جوال لكل فريق. المضيف يقدّم ويكشف ويحكم كما في اللعبة على جهاز واحد،
// والفريق صاحب الدور يختار السؤال ويستعمل وسائله من جواله. كل جوال يحمل بنك الأسئلة،
// فالغرفة تنقل معرّفات الأسئلة فقط ويعرضها كل جوال من نسخته بالمكوّن نفسه (QuestionVisual).
import React, { useEffect, useMemo, useState } from 'react';
import { Button, Card, ConfirmModal, Podium, Scoreboard } from '../shared/ui/components.jsx';
import { usePlatform } from '../platform/context.js';
import { useAccount } from '../shared/account/context.js';
import { vignette } from '../shared/fx/index.js';
import { CATS } from '../data/categories/index.js';
import MaydanLogicBeta, { pointsAfterHints } from '../games/badeeha/logic.js';
import { QuestionVisual } from '../games/badeeha/QuestionVisual.js';
import { TOOLS, TEAM_STYLE, MAYDAN_TIER_LABELS, TYPE_PROMPT, answerText } from '../games/badeeha/constants.js';
import { questionAssistance } from '../games/badeeha/assistance.js';
import { rememberBadeehaQuestions } from '../games/badeeha/persistence.js';
import { mulberry32 } from '../shared/lib/rng.js';
import BADEEHA_CSS from '../games/badeeha/styles.css';
import { BADEEHA_TIMERS, arabicNumber as number } from './shared.js';

const { MODES, ROUND_SIZES, questionId } = MaydanLogicBeta;
// أنماط بَديهة مكتوبة لصفحة كاملة (.m-root)؛ داخل الغرفة تأخذ مكانها في البطاقة فقط.
const EMBED_CSS = `.m-root.m-embedded{min-height:0;padding:0;background:transparent;isolation:auto;overflow:visible}
.m-root.m-embedded::before{display:none}
.online-badeeha .m-board-grid{margin-top:4px}
.online-badeeha .m-tier:disabled{cursor:default}
.badeeha-turn{display:flex;align-items:center;gap:8px;font-weight:800}
.badeeha-turn i{width:12px;height:12px;border-radius:50%;background:var(--team)}
.badeeha-tools{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
.badeeha-tools button{min-height:48px;border-radius:16px;border:1px solid #e7d6b8;background:#fffaf0;font-weight:800;padding:6px}
.badeeha-tools button:disabled{opacity:.45}
.badeeha-tools small{display:block;font-weight:600;font-size:.72rem;color:#77677c}
.badeeha-cell{display:grid;gap:2px}.badeeha-cell span{font-weight:800;color:#9250bd}
.badeeha-effects{display:flex;flex-wrap:wrap;gap:6px}.badeeha-effects span{background:#fff0c5;border-radius:12px;padding:2px 10px;font-weight:800;font-size:.8rem}
.badeeha-answer{background:#dff1e9;color:#08645f;border-radius:16px;padding:10px 14px;font-weight:900;font-size:1.1rem}
.badeeha-judge{display:grid;gap:8px}
.badeeha-verdict{border-radius:16px;padding:10px 14px;font-weight:800;background:#fffaf0;border:1px solid #e7d6b8}
.badeeha-verdict.is-good{background:#dff1e9;color:#08645f}.badeeha-verdict.is-none{color:#77677c}
.badeeha-picker{display:grid;grid-template-columns:repeat(auto-fill,minmax(132px,1fr));gap:6px;max-height:300px;overflow:auto;padding:2px}
.badeeha-picker button{display:flex;align-items:center;gap:6px;min-height:44px;border-radius:14px;border:1px solid #e7d6b8;background:#fffaf0;font:inherit;font-size:.85rem;text-align:start;padding:4px 8px;cursor:pointer}
.badeeha-picker button[aria-pressed="true"]{background:#e9dcf7;border-color:#9250bd;font-weight:800}
.badeeha-picker button.is-locked{opacity:.6}
.badeeha-segment{display:flex;flex-wrap:wrap;gap:6px}
.badeeha-segment button{min-height:44px;border-radius:14px;border:1px solid #e7d6b8;background:#fffaf0;font:inherit;padding:4px 12px;cursor:pointer}
.badeeha-segment button[aria-pressed="true"]{background:#e9dcf7;border-color:#9250bd;font-weight:800}`;

// كل جوال يبحث عن السؤال بمعرّفه في بنكه؛ المعرّف نفسه الذي يبني به المضيف اللوحة.
// يُبنى الفهرس عند أول غرفة بَديهة لا عند فتح التطبيق.
let questionIndex = null;
const questionById = (qid) => (questionIndex ||= new Map(CATS.flatMap((category) => category.qs.map((question, index) => {
  const id = questionId(category.id, question, index);
  return [id, { ...question, qid: id }];
})))).get(qid) || null;
const CATEGORY = new Map(CATS.map((category) => [category.id, category]));
// ترتيب عناصر «رتّب» قبل الكشف ثابت لكل سؤال، فيرى الجميع الترتيب نفسه.
function mixedOrder(question) {
  if (!Array.isArray(question?.items)) return [];
  let seed = 2166136261;
  for (const ch of question.qid) seed = Math.imul(seed ^ ch.charCodeAt(0), 16777619);
  const random = mulberry32(seed >>> 0), items = [...question.items];
  for (let i = items.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [items[i], items[j]] = [items[j], items[i]]; }
  return items;
}

export const DEFAULT_BADEEHA_OPTIONS = Object.freeze({ mode: 'standard', roundSize: 30, timer: 60, categories: [] });
export function normalizeBadeehaOptions(value) {
  const input = value && typeof value === 'object' ? value : {};
  return {
    mode: Object.hasOwn(MODES, input.mode) ? input.mode : DEFAULT_BADEEHA_OPTIONS.mode,
    roundSize: ROUND_SIZES.includes(input.roundSize) ? input.roundSize : DEFAULT_BADEEHA_OPTIONS.roundSize,
    timer: BADEEHA_TIMERS.includes(input.timer) ? input.timer : DEFAULT_BADEEHA_OPTIONS.timer,
    categories: Array.isArray(input.categories) ? [...new Set(input.categories.filter((id) => CATEGORY.has(id)))].slice(0, 6) : [],
  };
}
// الجولة تُبنى على جوال المضيف بالدالة نفسها التي تبني بها بَديهة جولتها، مع أولوية ما لم يُلعب
// في سجله. لا يصل الغرفة إلا معرّف كل سؤال ونقاطه.
export function buildBadeehaRoom(options, history = {}) {
  const { mode, roundSize, timer, categories } = normalizeBadeehaOptions(options);
  const deck = MaydanLogicBeta.buildDeck(CATS, categories, history || {}, MODES[mode].tiers, roundSize);
  return { mode, roundSize, timer, categories, deck: Object.fromEntries(Object.entries(deck).map(([id, questions]) => [id, questions.map((q) => ({ qid: q.qid, p: q.p }))])) };
}
export function badeehaReady(options) {
  try { buildBadeehaRoom(options); return { ok: true }; } catch (error) { return { ok: false, message: error.message }; }
}

function Segment({ label, options, value, onChange, disabled, designId }) {
  return <div className="stack" role="group" aria-label={label}><span className="online-field-label">{label}</span>
    <div className="badeeha-segment">{options.map(([id, text]) => <button data-design-id={designId} key={id} type="button" aria-pressed={value === id} disabled={disabled} onClick={() => onChange(id)}>{text}</button>)}</div></div>;
}

export function BadeehaSettings({ value, onChange, disabled }) {
  const account = useAccount();
  const options = normalizeBadeehaOptions(value);
  const set = (patch) => onChange({ ...options, ...patch });
  const ready = useMemo(() => options.categories.length === 6 ? badeehaReady(options) : null, [options.mode, options.roundSize, options.categories.join()]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = (id) => {
    const chosen = options.categories.includes(id);
    if (!chosen && account.lockedPack(id)) { account.openPaywall({ reason: 'pack', pack: id }); return; }
    if (!chosen && options.categories.length >= 6) return;
    set({ categories: chosen ? options.categories.filter((item) => item !== id) : [...options.categories, id] });
  };
  const random = () => {
    const pool = CATS.filter((category) => !account.lockedPack(category.id)).map((category) => category.id);
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    for (let start = 0; start + 6 <= pool.length; start++) {
      const candidate = { ...options, categories: pool.slice(start, start + 6) };
      if (badeehaReady(candidate).ok) { set({ categories: candidate.categories }); return; }
    }
  };
  return <div data-design-screen="online.badeeha.setup" className="stack"><style>{EMBED_CSS}</style>
    <Segment designId="mode-choice" label="مستوى الأسئلة" disabled={disabled} value={options.mode} onChange={(mode) => set({ mode })} options={Object.values(MODES).map((mode) => [mode.id, `${mode.icon} ${mode.label}`])} />
    <Segment designId="round-size" label="عدد الأسئلة" disabled={disabled} value={options.roundSize} onChange={(roundSize) => set({ roundSize })} options={ROUND_SIZES.map((size) => [size, `${number(size)} سؤالًا`])} />
    <Segment designId="timer-length" label="وقت كل سؤال" disabled={disabled} value={options.timer} onChange={(timer) => set({ timer })} options={BADEEHA_TIMERS.map((seconds) => [seconds, `${number(seconds)} ثانية`])} />
    <div className="row-between"><span className="online-field-label">الفئات ({number(options.categories.length)} من ٦)</span><Button data-design-id="random-categories" size="sm" variant="ghost" disabled={disabled} onClick={random}>ست فئات عشوائية</Button></div>
    <div className="badeeha-picker" role="group" aria-label="اختر ست فئات">
      {CATS.map((category) => { const locked = account.lockedPack(category.id); return <button data-design-id="category-choice" key={category.id} type="button" className={locked ? 'is-locked' : ''} aria-pressed={options.categories.includes(category.id)} disabled={disabled}
        onClick={() => toggle(category.id)}><span aria-hidden="true">{locked ? '🔒' : category.icon}</span><span>{category.name}</span></button>; })}
    </div>
    {ready && !ready.ok && <p className="online-notice error" role="alert">{ready.message}</p>}
    <p className="online-footnote">جوال لكل فريق (من فريقين إلى أربعة). المضيف فريق أيضًا، ويكشف الإجابة ويحكم كما في بَديهة على جهاز واحد.</p>
  </div>;
}

// غرفة الانتظار: إعدادات المضيف، وتنبيه لجوال نسخته أقدم من أسئلة الجولة.
export function BadeehaLobbyInfo({ state }) {
  const { mode, roundSize, timer, categories, deck } = state.settings;
  const missing = Object.values(deck).flat().filter((cell) => !questionById(cell.qid)).length;
  return <Card className="stack"><h2>بَديهة · {MODES[mode]?.icon} {MODES[mode]?.label}</h2>
    <p>{number(roundSize)} سؤالًا، و{number(timer)} ثانية لكل سؤال.</p>
    <p className="online-footnote">الفئات: {categories.map((id) => CATEGORY.get(id)?.name || 'فئة جديدة').join('، ')}</p>
    {missing > 0 && <p className="online-notice" role="status">جوالك لا يحمل {number(missing)} من أسئلة هذه الجولة. حدّث ميدان قبل البداية لترى كل الأسئلة.</p>}
    <BadeehaRules /></Card>;
}

export function BadeehaRules() {
  return <Card className="stack"><h3>كيف تُلعب أونلاين؟</h3>
    <p className="online-footnote">الفريق صاحب الدور يختار السؤال من اللوحة ويستعمل وسائله (دبل، جوابين، وقت زيادة) من جواله. يجيب بصوته، ثم يكشف المضيف الإجابة ويحكم: صح للفريق، أو سرقة لفريق آخر، أو ولا أحد.</p></Card>;
}

export function BadeehaMatch({ state, me, isHost, disabled, act, clockOffset, spectating = false }) {
  const platform = usePlatform();
  const [now, setNow] = useState(Date.now());
  const [confirmEnd, setConfirmEnd] = useState(false);
  // A late spectator must not inherit questions played before they joined.
  const seenQuestionId = state.phase === 'reveal' ? state.current?.qid : null;
  useEffect(() => { if (!state._designPreview && seenQuestionId) rememberBadeehaQuestions(CATS, [seenQuestionId]); }, [seenQuestionId, state._designPreview]);
  useEffect(() => {
    if (state._designPreview || state.phase !== 'question' || !state.deadlineAt) return undefined;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [state.phase, state.deadlineAt, state._designPreview]);
  const seconds = state.phase === 'question' && state.deadlineAt ? Math.max(0, Math.ceil((state.deadlineAt - (now + clockOffset)) / 1000)) : null;
  useEffect(() => {
    if (state._designPreview) return undefined;
    vignette(seconds !== null && seconds > 0 && seconds <= 5);
    return () => vignette(false);
  }, [seconds, state._designPreview]);
  const verdictKey = state.verdict ? `${state.verdict.qid}:${state.verdict.teamId}` : '';
  useEffect(() => {
    if (state._designPreview || !state.verdict) return;
    platform?.sound?.play(state.verdict.teamId ? (state.verdict.steal ? 'steal' : 'correct') : 'wrong');
  }, [verdictKey, state._designPreview]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!state._designPreview && state.phase === 'reveal') platform?.sound?.play('reveal'); }, [state.phase, state.current?.qid, state._designPreview]); // eslint-disable-line react-hooks/exhaustive-deps

  const teams = state.teams.map((team, index) => {
    const seat = state.members.find((m) => m.id === team.id);
    return { ...team, name: seat?.name || 'فريق', emoji: seat?.emoji, left: seat?.left, connected: seat?.connected, color: TEAM_STYLE[index % TEAM_STYLE.length].solid };
  });
  const turn = teams.find((team) => team.id === state.turnId);
  const mine = teams.find((team) => team.id === me?.id);
  const myTurn = Boolean(mine && state.turnId === me.id && !spectating);
  const question = state.current ? questionById(state.current.qid) : null;
  const assistance = question ? questionAssistance(question) : null;
  const mode = MODES[state.settings.mode];
  const pointsNow = state.current ? pointsAfterHints(state.current.p, state.hintsUsed) : 0;
  const soundOn = platform?.settings ? platform.settings.soundOn !== false : true;
  const verdictTeam = state.verdict?.teamId ? teams.find((team) => team.id === state.verdict.teamId) : null;
  const sorted = [...teams].sort((a, b) => b.score - a.score);
  const scoreboard = <Scoreboard data-design-id="scoreboard" entries={teams.map((team) => ({ id: team.id, name: team.left ? `${team.name} (غادر)` : team.name, emoji: team.emoji, score: team.score, color: team.color }))} />;

  if (state.phase === 'over') return <section data-design-screen="online.badeeha.over" className="stack online-badeeha">
    {state.reason === 'players_left' && <p className="online-notice">انتهت المباراة لأن الفرق المتبقية أقل من اثنين.</p>}
    {state.reason === 'ended' && <p className="online-notice">أنهى المضيف المباراة قبل آخر سؤال.</p>}
    <Podium data-design-id="podium" entries={sorted.map((team) => ({ id: team.id, name: team.name, emoji: team.emoji, score: team.score, color: team.color }))} />
    <Card className="stack">{sorted.map((team) => <div className="row-between" key={team.id}><b>{team.name}</b><span>{number(team.score)} نقطة، {number(team.correct)} صح، {number(team.steals)} سرقة</span></div>)}</Card>
    <p className="online-footnote">إعادة اللعب هنا تستخدم الأسئلة نفسها. لأسئلة جديدة، اخرجوا وأنشئوا غرفة جديدة من بَديهة.</p>
    {isHost ? <Button data-design-id="restart" full size="lg" variant="primary" disabled={disabled} onClick={() => act('restart')}>العودة للانتظار وإعادة نفس الأسئلة</Button> : <p className="online-footnote">بانتظار المضيف لبدء مباراة جديدة.</p>}
  </section>;

  return <section data-design-screen={`online.badeeha.${state.phase}`} className="stack online-badeeha">
    <div className="m-root m-embedded" dir="rtl"><style>{BADEEHA_CSS}{EMBED_CSS}</style><div className="stack">
      <div className="row-between">
        <span data-design-id="turn" className="badeeha-turn" style={{ '--team': turn?.color }}><i aria-hidden="true" />{turn ? (myTurn ? 'دور فريقك' : `الدور: ${turn.name}`) : '—'}</span>
        <span data-design-id="round" className="online-footnote">{mode.icon} {mode.label} · السؤال {number(Math.min(state.round, state.rounds))} من {number(state.rounds)}</span>
      </div>
      {state.verdict && state.phase === 'board' && <p className={`badeeha-verdict ${verdictTeam ? 'is-good' : 'is-none'}`} role="status">
        {verdictTeam ? `${state.verdict.steal ? '⚡ سرقة! ' : '✓ '}${verdictTeam.name} +${number(state.verdict.points)}` : 'ولا أحد هالمرة.'}</p>}

      {state.phase === 'board' && <>
        <p className="online-footnote">{myTurn ? 'اختر سؤالًا من اللوحة.' : isHost ? `${turn?.name || 'الفريق'} يختار، وتقدر تفتح السؤال عنه.` : `بانتظار ${turn?.name || 'الفريق'} ليختار سؤالًا.`}</p>
        <div data-design-id="board" className="m-board-grid">
          {state.settings.categories.map((categoryId, categoryIndex) => {
            const category = CATEGORY.get(categoryId);
            return <article key={categoryId} className="m-board-category" style={{ '--i': categoryIndex }}>
              <h2><span aria-hidden="true">{category?.icon || '❔'}</span> {category?.name || 'فئة غير متاحة في نسختك'}</h2>
              <div className="m-question-buttons">{(state.settings.deck[categoryId] || []).map((cell, index) => {
                const done = state.used.includes(cell.qid);
                return <button key={cell.qid} data-design-id="tier" type="button" className={`m-tier m-tier-${cell.p} ${done ? 'done' : ''}`} style={{ '--n': index }}
                  disabled={done || disabled || spectating || !(isHost || myTurn)} onClick={() => act('open', { categoryId, index })}
                  aria-label={`${category?.name || ''}، سؤال ${cell.p} نقطة${done ? '، مستخدم' : ''}`}>
                  <b dir="ltr">{cell.p}</b><small>{done ? 'تم' : MAYDAN_TIER_LABELS[cell.p]}</small></button>;
              })}</div>
            </article>;
          })}
        </div>
        {isHost && <div className="row-between">
          <Button data-design-id="undo" size="sm" variant="ghost" disabled={disabled || !state.canUndo} onClick={() => act('undo')}>↶ تراجع عن آخر حكم</Button>
          <Button data-design-id="finish" size="sm" variant="ghost" disabled={disabled} onClick={() => setConfirmEnd(true)}>إنهاء المباراة</Button>
        </div>}
      </>}

      {['question', 'reveal'].includes(state.phase) && state.current && <Card data-design-id="question" className="stack">
        <div className="row-between"><div data-design-id="category" className="badeeha-cell"><b>{CATEGORY.get(state.current.categoryId)?.name}</b><span>{number(pointsNow)} نقطة{state.effect.double ? ' (دبل)' : ''}</span></div>
          {seconds !== null && <span data-design-id="timer" className={`online-timer ${seconds <= 5 ? 'urgent' : ''}`} role="timer" aria-label={`متبقي ${seconds} ثانية`}><b><bdi>{number(seconds)}</bdi></b> ث</span>}</div>
        {(state.effect.double || state.effect.two) && <div className="badeeha-effects">{state.effect.double && <span>✨ دبل النقاط</span>}{state.effect.two && <span>✌️ جوابان</span>}</div>}
        {question && TYPE_PROMPT[question.type] && <p data-design-id="prompt" className="m-prompt">{TYPE_PROMPT[question.type]}</p>}
        {state.phase === 'question' && assistance && (assistance.context || assistance.shape) && <aside data-design-id="assistance" className="m-question-assistance" aria-label="مساعدة خفيفة بلا خصم نقاط">
          {assistance.context && <span>{assistance.context}</span>}{assistance.shape && <small>{assistance.shape}</small>}
        </aside>}
        {question ? QuestionVisual({ question, packId: state.current.categoryId, revealed: state.phase === 'reveal', hintsUsed: state.hintsUsed, mixedItems: mixedOrder(question),
          onHint: state.phase === 'question' && (isHost || myTurn) && !disabled ? () => act('hint') : null,
          soundOn, volume: platform?.settings?.soundVolume, sound: platform?.sound, onSfx: (name) => platform?.sound?.play(name) })
          : <p className="online-notice">هذا السؤال غير موجود في نسخة جوالك. حدّث ميدان؛ المضيف يكمل الجولة.</p>}
        {state.phase === 'question' && seconds === 0 && <p className="online-footnote" role="status">انتهى الوقت.</p>}
        {state.phase === 'reveal' && question && <p data-design-id="answer" className="badeeha-answer" role="status">الإجابة: {answerText(question)}</p>}
        {state.phase === 'reveal' && question?.alt?.length > 0 && <p className="online-footnote">تُقبل أيضًا: {question.alt.join('، ')}</p>}
        {state.phase === 'question' && myTurn && <div data-design-id="tools" className="badeeha-tools" role="group" aria-label="وسائل فريقك">{TOOLS.map((tool) => <button data-design-id="tool" key={tool.id} type="button" disabled={disabled || !mine.tools[tool.id] || seconds === 0}
          onClick={() => act('tool', { tool: tool.id })} title={tool.hint}>{tool.icon} {tool.label}<small>{mine.tools[tool.id] ? tool.hint : 'استُعملت'}</small></button>)}</div>}
        {state.phase === 'question' && (isHost ? <Button data-design-id="reveal" full variant="primary" size="lg" disabled={disabled} onClick={() => act('reveal')}>اكشف الإجابة</Button>
          : <p className="online-footnote">{myTurn ? 'جاوبوا بصوتكم، والمضيف يكشف الإجابة.' : 'المضيف يكشف الإجابة ويحكم.'}</p>)}
        {state.phase === 'reveal' && (isHost ? <div data-design-id="judge" className="badeeha-judge" role="group" aria-label="من جاوب صح؟">
          {teams.filter((team) => !team.left).map((team) => <Button data-design-id="judge-team" key={team.id} full variant={team.id === state.turnId ? 'primary' : 'secondary'} disabled={disabled} onClick={() => act('judge', { teamId: team.id })}>
            {team.id === state.turnId ? '✓' : '⚡ سرقة:'} {team.name} +{number(team.id === state.turnId && state.effect.double ? pointsNow * 2 : pointsNow)}</Button>)}
          <Button data-design-id="judge-nobody" full variant="ghost" disabled={disabled} onClick={() => act('judge', { teamId: null })}>ولا أحد</Button>
        </div> : <p className="online-footnote">المضيف يحكم الآن.</p>)}
      </Card>}
    </div></div>
    <Card className="stack"><h2>النقاط</h2>{scoreboard}</Card>
    {confirmEnd && <ConfirmModal title="إنهاء المباراة؟" message="تنتهي المباراة الآن بالنقاط الحالية." confirmLabel="إنهاء" cancelLabel="نكمل" onConfirm={async () => { setConfirmEnd(false); await act('end'); }} onCancel={() => setConfirmEnd(false)} />}
  </section>;
}

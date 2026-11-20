import { uiDirection } from './format.js';
import { arabicNumber as number } from './format.js';
import { tr } from '../shared/i18n/core.js';
// بَديهة أونلاين: جوال لكل فريق. المضيف يقدّم ويكشف ويحكم كما في اللعبة على جهاز واحد،
// والفريق صاحب الدور يختار السؤال ويستعمل وسائله من جواله. كل جوال يحمل بنك الأسئلة،
// فالغرفة تنقل معرّفات الأسئلة فقط ويعرضها كل جوال من نسخته بالمكوّن نفسه (QuestionVisual).
import React, { useEffect, useMemo, useState } from 'react';
import { Button, Card, ConfirmModal } from '../shared/ui/components.jsx';
import { usePlatform } from '../platform/context.js';
import { useAccount } from '../shared/account/context.js';
import { vignette } from '../shared/fx/index.js';
import { useDeadlineAudio } from '../shared/fx/useDeadlineAudio.js';
import { getCategories } from '../data/game-content.js';
import { normalizeContentIdentity } from '../shared/content-locale.mjs';
import MaydanLogicBeta, { pointsAfterHints } from '../games/badeeha/logic.js';
import { QuestionVisual } from '../games/badeeha/QuestionVisual.js';
import { TOOLS, MAYDAN_TIER_LABELS, TYPE_PROMPT, answerText } from '../games/badeeha/constants.js';
import { questionAssistance } from '../games/badeeha/assistance.js';
import { rememberBadeehaQuestions } from '../games/badeeha/persistence.js';
import { badeehaContentStorage } from './badeeha-storage.js';
import { mulberry32 } from '../shared/lib/rng.js';
import BADEEHA_CSS from '../games/badeeha/styles.css?sheet';
import { PresentationStyles } from '../shared/ui/PresentationStyles.jsx';
import { BADEEHA_TIMERS} from './shared.js';
import { Avatar } from '../shared/brand/art.jsx';
import { IconFlask, IconUsers } from '../shared/ui/icons.jsx';
import { getPlayfulSceneArt } from '../shared/brand/playful-scenes.js';
import { ProfileAvatar } from '../profiles/ProfileAvatar.jsx';
import BOARD_CSS from '../games/badeeha/studio-local.css?sheet';
import STUDIO_CSS from './badeeha-studio.css?sheet';

const { MODES, ROUND_SIZES, questionId } = MaydanLogicBeta;
// أنماط بَديهة مكتوبة لصفحة كاملة (.m-root)؛ داخل الغرفة تأخذ مكانها في البطاقة فقط.
const EMBED_CSS = `.online-badeeha .m-root.m-embedded{min-height:0;padding:0;background:transparent;isolation:auto;overflow:visible}
.m-root.m-embedded::before{display:none}
.online-badeeha .m-board-grid{margin-top:4px}
.online-badeeha .m-tier:disabled{cursor:default}
.badeeha-verdict{border-radius:16px;padding:10px 14px;font-weight:800;background:#fffaf0;border:1px solid #e7d6b8}
.badeeha-verdict.is-good{background:#dff1e9;color:#08645f}.badeeha-verdict.is-none{color:#77677c}
.badeeha-picker{display:grid;grid-template-columns:repeat(auto-fill,minmax(132px,1fr));gap:6px;max-height:300px;overflow:auto;padding:2px}
.badeeha-picker button{display:flex;flex-wrap:wrap;align-content:center;align-items:center;gap:6px;min-height:44px;border-radius:14px;border:1px solid #e7d6b8;background:#fffaf0;font:inherit;font-size:.85rem;text-align:start;padding:4px 8px;cursor:pointer}
.badeeha-picker button[aria-pressed="true"]{background:#e9dcf7;border-color:#9250bd;font-weight:800}
.badeeha-picker button.is-locked{opacity:.6}
.badeeha-category-art{object-fit:contain;flex:none;vertical-align:middle}
.badeeha-picker button>span:last-child{flex:1 0 min-content;min-width:0;max-inline-size:max-content;overflow-wrap:break-word}
.badeeha-segment{display:flex;flex-wrap:wrap;gap:6px}
.badeeha-segment button{min-height:44px;border-radius:14px;border:1px solid #e7d6b8;background:#fffaf0;font:inherit;padding:4px 12px;cursor:pointer}
.badeeha-segment button[aria-pressed="true"]{background:#e9dcf7;border-color:#9250bd;font-weight:800}`;

// كل جوال يبحث عن السؤال بمعرّفه في بنكه؛ المعرّف نفسه الذي يبني به المضيف اللوحة.
// يُبنى الفهرس عند أول غرفة بَديهة لا عند فتح التطبيق.
const indexes = new Map();
function contentFor(value = {}) {
  const identity = normalizeContentIdentity(value), key = `${identity.contentLocale}:${identity.contentVersion}`;
  if (!indexes.has(key)) {
    const CATS = getCategories(identity.contentLocale, identity.contentVersion);
    const index = new Map(CATS.flatMap(category => category.qs.map((question, ordinal) => {
      const qid = questionId(category.id, question, ordinal); return [qid, { ...question, qid }];
    })));
    indexes.set(key, { CATS, CATEGORY: new Map(CATS.map(category => [category.id, category])), questionById: qid => index.get(qid) || null });
  }
  return indexes.get(key);
}
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
  const { CATEGORY } = contentFor(input);
  return {
    ...normalizeContentIdentity(input),
    mode: Object.hasOwn(MODES, input.mode) ? input.mode : DEFAULT_BADEEHA_OPTIONS.mode,
    roundSize: ROUND_SIZES.includes(input.roundSize) ? input.roundSize : DEFAULT_BADEEHA_OPTIONS.roundSize,
    timer: BADEEHA_TIMERS.includes(input.timer) ? input.timer : DEFAULT_BADEEHA_OPTIONS.timer,
    categories: Array.isArray(input.categories) ? [...new Set(input.categories.filter((id) => CATEGORY.has(id)))].slice(0, 6) : [],
  };
}
// الجولة تُبنى على جوال المضيف بالدالة نفسها التي تبني بها بَديهة جولتها، مع أولوية ما لم يُلعب
// في سجله. لا يصل الغرفة إلا معرّف كل سؤال ونقاطه.
export function buildBadeehaRoom(options, history = {}) {
  const { CATS } = contentFor(options);
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

function CategoryArtwork({ category, size = 32, lazy = false, fallback }) {
  const art = category && getPlayfulSceneArt(`category-${category.id}`, size);
  return art
    ? <img className="badeeha-category-art" data-category-art={category.id} src={art} width={size} height={size} alt="" loading={lazy ? 'lazy' : undefined} decoding="async" />
    : <span aria-hidden="true">{category?.icon || fallback}</span>;
}

export function BadeehaSettings({ value, onChange, disabled }) {
  const { CATS } = contentFor(value);
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
    <Segment designId="mode-choice" label={tr("مستوى الأسئلة")} disabled={disabled} value={options.mode} onChange={(mode) => set({ mode })} options={Object.values(MODES).map((mode) => [mode.id, `${mode.icon} ${tr(mode.label)}`])} />
    <Segment designId="round-size" label={tr("عدد الأسئلة")} disabled={disabled} value={options.roundSize} onChange={(roundSize) => set({ roundSize })} options={ROUND_SIZES.map((size) => [size, tr("{v0} سؤالًا", {v0: number(size)})])} />
    <Segment designId="timer-length" label={tr("وقت كل سؤال")} disabled={disabled} value={options.timer} onChange={(timer) => set({ timer })} options={BADEEHA_TIMERS.map((seconds) => [seconds, tr("{v0} ثانية", {v0: number(seconds)})])} />
    <div className="row-between"><span className="online-field-label">{tr("الفئات (")}{number(options.categories.length)}{tr(" من ٦)")}</span><Button data-design-id="random-categories" size="sm" variant="ghost" disabled={disabled} onClick={random}>{tr("ست فئات عشوائية")}</Button></div>
    <div className="badeeha-picker" role="group" aria-label={tr("اختر ست فئات")}>
      {CATS.map((category) => { const locked = account.lockedPack(category.id); return <button data-design-id="category-choice" key={category.id} type="button" className={locked ? 'is-locked' : ''} aria-pressed={options.categories.includes(category.id)} disabled={disabled}
        onClick={() => toggle(category.id)}>{locked ? <span aria-hidden="true">🔒</span> : <CategoryArtwork category={category} size={40} lazy />}<span>{category.name}</span></button>; })}
    </div>
    {ready && !ready.ok && <p className="online-notice error" role="alert">{ready.message}</p>}
    <p className="online-footnote">{tr("جوال لكل فريق (من فريقين إلى أربعة). المضيف فريق أيضًا، ويكشف الإجابة ويحكم كما في بَديهة على جهاز واحد.")}</p>
  </div>;
}

// غرفة الانتظار: إعدادات المضيف، وتنبيه لجوال نسخته أقدم من أسئلة الجولة.
export function BadeehaLobbyInfo({ state }) {
  const { CATEGORY, questionById } = contentFor(state);
  const { mode, roundSize, timer, categories, deck } = state.settings;
  const missing = Object.values(deck).flat().filter((cell) => !questionById(cell.qid)).length;
  return <Card className="stack"><h2>{tr("بَديهة · ")}{MODES[mode]?.icon} {tr(MODES[mode]?.label)}</h2>
    <p>{number(roundSize)}{tr(" سؤالًا، و")}{number(timer)}{tr(" ثانية لكل سؤال.")}</p>
    <p className="online-footnote">{tr("الفئات: ")}{categories.map((id) => CATEGORY.get(id)?.name || tr("فئة جديدة")).join('، ')}</p>
    {missing > 0 && <p className="online-notice" role="status">{tr("جوالك لا يحمل ")}{number(missing)}{tr(" من أسئلة هذه الجولة. حدّث ميدان قبل البداية لترى كل الأسئلة.")}</p>}
    <BadeehaRules /></Card>;
}

export function BadeehaRules() {
  return <Card className="stack"><h3>{tr("كيف تُلعب أونلاين؟")}</h3>
    <p className="online-footnote">{tr("الفريق صاحب الدور يختار السؤال من اللوحة ويستعمل وسائله (دبل، جوابين، وقت زيادة) من جواله. يجيب بصوته، ثم يكشف المضيف الإجابة ويحكم: صح للفريق، أو سرقة لفريق آخر، أو ولا أحد.")}</p></Card>;
}

export function BadeehaMatch({ state, me, isHost, disabled, act, clockOffset, spectating = false }) {
  const { CATS, CATEGORY, questionById } = contentFor(state);
  const platform = usePlatform();
  const [now, setNow] = useState(Date.now());
  const [confirmEnd, setConfirmEnd] = useState(false);
  // A late spectator must not inherit questions played before they joined.
  const seenQuestionId = state.phase === 'reveal' ? state.current?.qid : null;
  useEffect(() => { if (!state._designPreview && seenQuestionId) rememberBadeehaQuestions(CATS, [seenQuestionId], { storage: badeehaContentStorage({contentLocale:state.contentLocale,contentVersion:state.contentVersion}) }); }, [seenQuestionId, state._designPreview, state.contentLocale, state.contentVersion, CATS]);
  useEffect(() => {
    if (state._designPreview || state.phase !== 'question' || !state.deadlineAt) return undefined;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [state.phase, state.deadlineAt, state._designPreview]);
  const seconds = state.phase === 'question' && state.deadlineAt ? Math.max(0, Math.ceil((state.deadlineAt - (now + clockOffset)) / 1000)) : null;
  useDeadlineAudio(platform?.sound, state.phase === 'question' ? JSON.stringify([state.code, state.matchId, state.round, state.current?.qid, me?.id]) : null,
    seconds, !state._designPreview && !disabled && !spectating && state.phase === 'question');
  useEffect(() => {
    if (state._designPreview) return undefined;
    vignette(seconds !== null && seconds > 0 && seconds <= 5);
    return () => vignette(false);
  }, [seconds, state._designPreview]);
  // ConnectedRoom owns live authorized reveal/verdict transitions. Mounting a
  // retained question/result here must not sound its historical outcome.

  const teams = state.teams.map(team => {
    const seat = state.members.find((m) => m.id === team.id);
    return { ...team, name: seat?.name || tr("فريق"), emoji: seat?.emoji, avatar: seat?.avatar, profile: seat?.profile, left: seat?.left, connected: seat?.connected };
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
  if (state.phase === 'over') return <BadeehaResults state={state} teams={sorted} isHost={isHost && !spectating} disabled={disabled} act={act} />;
  if (['question', 'reveal'].includes(state.phase) && state.current) return <BadeehaQuestion
    state={state} teams={teams} turn={turn} mine={mine} myTurn={myTurn}
    isHost={isHost && !spectating} disabled={disabled} act={act}
    question={question} category={CATEGORY.get(state.current.categoryId)} assistance={assistance}
    seconds={seconds} pointsNow={pointsNow} soundOn={soundOn} platform={platform} />;

  return <section data-design-screen={`online.badeeha.${state.phase}`} className="online-badeeha badeeha-studio" dir={uiDirection()}>
    <PresentationStyles sheet={BADEEHA_CSS}/><PresentationStyles sheet={BOARD_CSS}/><PresentationStyles sheet={STUDIO_CSS}/>
    <StudioScores teams={teams} turnId={state.turnId}/>
    <div className="m-root m-local-studio m-embedded"><style>{EMBED_CSS}</style><div className="stack">
      <div data-design-id="turn" className="bl-board-turn"><IconUsers/><b>{turn ? (myTurn ? tr("دور فريقك") : tr("الدور: {v0}", {v0: turn.name})) : '—'}</b></div>
      <span data-design-id="round" className="bl-mode-caption">{tr(mode.label)}{tr(" · السؤال ")}{number(Math.min(state.round, state.rounds))}{tr(" من ")}{number(state.rounds)}</span>
      {state.verdict && state.phase === 'board' && <p className={`badeeha-verdict ${verdictTeam ? 'is-good' : 'is-none'}`} role="status">
        {verdictTeam ? `${state.verdict.steal ? tr("⚡ سرقة! ") : '✓ '}${verdictTeam.name} +${number(state.verdict.points)}` : tr("ولا أحد هالمرة.")}</p>}

      {state.phase === 'board' && <>
        <p className="online-footnote">{myTurn ? tr("اختر سؤالًا من اللوحة.") : isHost ? tr("{v0} يختار، وتقدر تفتح السؤال عنه.", {v0: turn?.name || tr("الفريق")}) : tr("بانتظار {v0} ليختار سؤالًا.", {v0: turn?.name || tr("الفريق")})}</p>
        <div data-design-id="board" className="m-board-grid">
          {state.settings.categories.map((categoryId, categoryIndex) => {
            const category = CATEGORY.get(categoryId);
            return <article key={categoryId} className="m-board-category" style={{ '--i': categoryIndex }}>
              <h2><CategoryArtwork category={category} size={40} fallback="❔" /> {category?.name || tr("فئة غير متاحة في نسختك")}</h2>
              <div className="m-question-buttons">{(state.settings.deck[categoryId] || []).map((cell, index) => {
                const done = state.used.includes(cell.qid);
                return <button key={cell.qid} data-design-id="tier" type="button" className={`m-tier m-tier-${cell.p} ${done ? 'done' : ''}`} style={{ '--n': index }}
                  data-sound="none" disabled={done || disabled || spectating || !(isHost || myTurn)} onClick={() => act('open', { categoryId, index })}
                  aria-label={tr("{v0}، سؤال {v1} نقطة{v2}", {v0: category?.name || '', v1: cell.p, v2: done ? tr("، مستخدم") : ''})}>
                  <b dir="ltr">{cell.p}</b><small className={done ? undefined : "sr-only"}>{done ? tr("تم") : tr(MAYDAN_TIER_LABELS[cell.p])}</small></button>;
              })}</div>
            </article>;
          })}
        </div>
        {isHost && <div className="row-between">
          <Button data-design-id="undo" data-sound="none" size="sm" variant="ghost" disabled={disabled || !state.canUndo} onClick={() => act('undo')}>{tr("↶ تراجع عن آخر حكم")}</Button>
          <Button data-design-id="finish" size="sm" variant="ghost" disabled={disabled} onClick={() => setConfirmEnd(true)}>{tr("إنهاء المباراة")}</Button>
        </div>}
      </>}


    </div></div>
    {confirmEnd && <ConfirmModal title={tr("إنهاء المباراة؟")} message={tr("تنتهي المباراة الآن بالنقاط الحالية.")} confirmLabel={tr("إنهاء")} cancelLabel={tr("نكمل")} onConfirm={async () => { setConfirmEnd(false); await act('end'); }} onCancel={() => setConfirmEnd(false)} />}
  </section>;
}


function TeamPortrait({ team, size = 76, presentation = 'cutout' }) {
  return team.profile ? <ProfileAvatar user={{ ...team.profile, name: team.name }} size={size} presentation={presentation} />
    : <Avatar player={team} style={{ width: size, height: size, flexShrink: 0 }} />;
}

function StudioScores({ teams, turnId }) {
  return <div data-design-id="scoreboard" className="bs-scores" aria-label={tr('النقاط')}>
    {teams.map(team => <div key={team.id} className={'bs-score' + (team.id === turnId ? ' is-turn' : '')}>
      <TeamPortrait team={team}/><div className="bs-score-copy"><b>{team.left ? tr('{v0} (غادر)', {v0: team.name}) : team.name}</b>
        <strong><bdi dir="ltr">{number(team.score)}</bdi></strong></div>
    </div>)}
  </div>;
}

function ToolArtwork({ id }) {
  // The aid remains identified by its original ID; art never controls its cost.
  if (id === 'double') return <span className="bs-tool-art bs-double" aria-hidden="true" dir="ltr">×2</span>;
  return <span className={'bs-tool-art bs-tool-' + id} aria-hidden="true"><img src={getPlayfulSceneArt(id === 'two' ? 'badeeha-cards' : 'badeeha-time', 80)} width={80} height={80} alt=""/></span>;
}

function BadeehaQuestion({ state, teams, turn, mine, myTurn, isHost, disabled, act, question, category, assistance, seconds, pointsNow, soundOn, platform }) {
  const revealed = state.phase === 'reveal';
  const progress = Math.max(0, Math.min(1, seconds / (state.settings.timer || 60)));
  return <section data-design-screen={'online.badeeha.' + state.phase} className={'online-badeeha badeeha-studio bs-' + state.phase} dir={uiDirection()}>
    <PresentationStyles sheet={BADEEHA_CSS}/><PresentationStyles sheet={STUDIO_CSS}/>
    <StudioScores teams={teams} turnId={state.turnId}/>
    {!revealed && <div className="bs-turn-strip">
      <IconUsers className="bs-turn-icon"/>
      <strong data-design-id="turn">{turn ? (myTurn ? tr('دور فريقك') : tr('الدور: {v0}', {v0: turn.name})) : '—'}</strong>
      {seconds !== null && <span data-design-id="timer" className={'bs-timer' + (seconds <= 5 ? ' is-urgent' : '')}
        style={{'--timer-progress': `${progress * 360}deg`}} role="timer" aria-label={tr('متبقي {v0} ثانية', {v0: seconds})}>
        <span><b><bdi dir="ltr">{number(seconds)}</bdi></b><small>{tr('ث')}</small></span>
      </span>}
    </div>}
    <div data-design-id="category" className="bs-category"><strong>{category?.id === 'science' ? <IconFlask className="bs-category-icon"/> : <CategoryArtwork category={category} />}{category?.name}</strong>
      <span className="bs-points"><bdi dir="ltr">{number(pointsNow)}</bdi>{' '}{tr('نقطة')}{state.effect.double ? tr(' (دبل)') : ''}</span>
    </div>
    <article data-design-id="question" className={'bs-question-body' + (revealed ? ' is-revealed' : '')}>
      {question ? QuestionVisual({ question, packId: state.current.categoryId, revealed, hintsUsed: state.hintsUsed, mixedItems: mixedOrder(question),
        onHint: !revealed && (isHost || myTurn) && !disabled ? () => act('hint') : null,
        soundOn, volume: platform?.settings?.soundVolume, sound: platform?.sound, onSfx: name => platform?.sound?.play(name) })
        : <p className="online-notice">{tr('هذا السؤال غير موجود في نسخة جوالك. حدّث ميدان؛ المضيف يكمل الجولة.')}</p>}
      {question && TYPE_PROMPT[question.type] && <p data-design-id="prompt" className="bs-prompt">{tr(TYPE_PROMPT[question.type])}</p>}
      {!revealed && assistance && (assistance.context || assistance.shape) && <aside data-design-id="assistance" className="bs-assistance" aria-label={tr('مساعدة خفيفة بلا خصم نقاط')}>
        {assistance.context && <span>{assistance.context}</span>}{assistance.shape && <span>{assistance.shape}</span>}
      </aside>}
    </article>
    {!revealed && seconds === 0 && <p className="bs-status" role="status">{tr('انتهى الوقت.')}</p>}
    {!revealed && (state.effect.double || state.effect.two) && <div className="bs-effects">
      {state.effect.double && <span>{tr('✨ دبل النقاط')}</span>}{state.effect.two && <span>{tr('✌️ جوابان')}</span>}
    </div>}
    {revealed && question && <p data-design-id="answer" className="badeeha-answer bs-answer" role="status">{tr('الإجابة: ')}{answerText(question)}</p>}
    {revealed && question?.alt?.length > 0 && <p className="bs-status">{tr('تُقبل أيضًا: ')}{question.alt.join('، ')}</p>}
    {!revealed && myTurn && <div data-design-id="tools" className="bs-tools" role="group" aria-label={tr('وسائل فريقك')}>
      {TOOLS.map(tool => <button data-design-id="tool" data-sound="none" key={tool.id} type="button" className="bs-tool"
        disabled={disabled || !mine.tools[tool.id] || seconds === 0} onClick={() => act('tool', {tool: tool.id})}
        aria-label={tr(tool.label) + ' · ' + tr(tool.hint)} title={tr(tool.hint)}>
        <ToolArtwork id={tool.id}/><b>{tr(tool.label)}</b>{!mine.tools[tool.id] && <small>{tr('استُعملت')}</small>}
      </button>)}
    </div>}
    {!revealed && (isHost ? <div className="bs-reveal-action"><Button data-design-id="reveal" data-sound="none" full variant="primary" size="lg" disabled={disabled} onClick={() => act('reveal')}>{tr('اكشف الإجابة')}</Button><small>{tr('للمضيف')}</small></div>
      : <p className="bs-status">{myTurn ? tr('جاوبوا بصوتكم، والمضيف يكشف الإجابة.') : tr('المضيف يكشف الإجابة ويحكم.')}</p>)}
    {revealed && (isHost ? <div data-design-id="judge" className="bs-judge" role="group" aria-label={tr('من جاوب صح؟')}>
      <h2>{tr('من جاوب صح؟')}</h2>
      {teams.filter(team => !team.left).map(team => <Button data-design-id="judge-team" data-sound="none" key={team.id} full size="lg"
        variant={team.id === state.turnId ? 'primary' : 'secondary'} disabled={disabled} onClick={() => act('judge', {teamId: team.id})}>
        <span>{team.id !== state.turnId && <span className="bs-steal">{tr('⚡ سرقة:')}{' '}</span>}{team.name}</span>
        <bdi dir="ltr">+{number(team.id === state.turnId && state.effect.double ? pointsNow * 2 : pointsNow)}</bdi>
      </Button>)}
      <Button data-design-id="judge-nobody" data-sound="none" full size="lg" variant="secondary" disabled={disabled} onClick={() => act('judge', {teamId: null})}>{tr('ولا أحد')}</Button>
      <p className="bs-status">{tr('اختيارك يسجّل الحكم ويعيد للوحة')}</p>
    </div> : <p className="bs-status">{tr('المضيف يحكم الآن.')}</p>)}
    {!revealed && <p data-design-id="round" className="bs-round">{tr('السؤال {v0} من {v1}', {v0: number(Math.min(state.round, state.rounds)), v1: number(state.rounds)})}</p>}
  </section>;
}

function BadeehaResults({ state, teams, isHost, disabled, act }) {
  const tie = teams.length > 1 && teams[0].score === teams[1].score;
  return <section data-design-screen="online.badeeha.over" className="online-badeeha badeeha-studio bs-over" dir={uiDirection()}>
    <PresentationStyles sheet={STUDIO_CSS}/>
    {state.reason === 'players_left' && <p className="bs-status">{tr('انتهت المباراة لأن الفرق المتبقية أقل من اثنين.')}</p>}
    {state.reason === 'ended' && <p className="bs-status">{tr('أنهى المضيف المباراة قبل آخر سؤال.')}</p>}
    <div data-design-id="podium" className="bs-results-podium">
      <div className="bs-trophy" aria-hidden="true"><svg className="bs-trophy-rays" viewBox="0 0 180 90"><path d="m20 26 7 6m-14 13 9 2m137-21-7 6m14 13-9 2"/></svg><img src={getPlayfulSceneArt('badeeha-trophy',144)} width="144" height="96" alt=""/></div><h1>{tr('النتيجة النهائية')}</h1>
      {tie && <p className="bs-status">{tr('تعادل جميل!')}</p>}
      <div className="bs-podium-teams">{teams.map(team => {
        const rank = teams.findIndex(other => other.score === team.score) + 1;
        return <div key={team.id} data-rank={rank} className={'bs-podium-team' + (rank === 1 ? ' is-winner' : '')}>
          <TeamPortrait team={team} size={144}/><div className="bs-podium-block"><b className="bs-rank" aria-label={tr('الترتيب')}>{number(rank)}</b>
            <b>{team.name}</b><strong><bdi dir="ltr">{number(team.score)}</bdi></strong>
          </div>
        </div>;
      })}</div>
    </div>
    <div data-design-id="result-statistics" className="bs-statistics">{teams.map(team => <div key={team.id}>
      <TeamPortrait team={team} size={40} presentation="avatar"/><b>{team.name}</b><span>{tr('{v0} صح · {v1} سرقة', {v0: number(team.correct), v1: number(team.steals)})}</span>
    </div>)}</div>
    <p data-design-id="replay-notice" className="bs-replay-notice"><span aria-hidden="true">ⓘ</span>{tr('إعادة اللعب هنا تستخدم الأسئلة نفسها. لأسئلة جديدة، اخرجوا وأنشئوا غرفة جديدة من بَديهة.')}</p>
    {isHost ? <Button data-design-id="restart" full size="lg" variant="primary" disabled={disabled} onClick={() => act('restart')}>{tr('العودة للانتظار وإعادة نفس الأسئلة')}</Button>
      : <p className="bs-status">{tr('بانتظار المضيف لبدء مباراة جديدة.')}</p>}
  </section>;
}

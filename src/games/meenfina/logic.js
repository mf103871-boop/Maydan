// منطق «مين فينا؟» — عبارة تُعرض، والكل يشير إلى من تنطبق عليه.
//
// وضعان:
//   point : عدّ تنازلي 3-2-1 ثم الكل يشير، ويُسجَّل من حصل على أكثر إشارات (التعادل يُسجَّل للجميع).
//   secret: تصويت سري بالتناوب على الجوال ثم كشف بأعمدة.
import { createNoRepeat } from '../../shared/lib/noRepeat.js';
import { isPlayerList, isCountMap, isNonNegInt, isText, isSeed } from '../../shared/lib/session.js';

export const ROUNDS = [5, 8, 12];
export const MODES = ['point', 'secret'];
export const DEFAULT_OPTIONS = Object.freeze({ mode: 'point', rounds: 8 });

// ألقاب تُمنح بحسب الوسم الذي فاز به اللاعب أكثر من غيره.
// لكل وسم في statements.json لقبٌ هنا، ولكل لقب هنا عبارةٌ تمنحه —
// يحرس ذلك اختبارُ «كل وسم له لقب» في tests/jabeen-meenfina-regression.test.js.
export const TITLES = {
  نوم: 'سفير النوم',
  جوال: 'حارس الشاشة',
  أكل: 'ذوّاقة المجموعة',
  تأخير: 'ساعة المجموعة المتأخرة',
  نسيان: 'أمين المفقودات',
  ترتيب: 'مهندس النظام',
  قهوة: 'سيد القهوة',
  ضحك: 'صانع الضحك',
  تنظيم: 'قائد الخطة',
  طبخ: 'شيف الجلسة',
  حكمة: 'حكيم المجموعة',
  تفاؤل: 'شمس المجموعة',
  خجل: 'الهادئ العميق',
  أفكار: 'مصنع الأفكار',
  أخبار: 'وكالة الأنباء',
  سفر: 'رحّالة المجموعة',
  طريق: 'ملّاح الرحلة',
  ألعاب: 'بطل التحدي',
  تصوير: 'مصوّر الجلسة',
  تسوق: 'خبير الأسواق',
  مطاعم: 'دليل المطاعم',
  حفلات: 'روح الحفلة',
  تقنية: 'خبير الأجهزة',
  موسيقى: 'دي جي المجموعة',
  فوضى: 'فنان الفوضى',
  شاي: 'سلطان الشاي',
  ذاكرة: 'أرشيف المجموعة',
  مواعيد: 'حارس المواعيد',
  قصص: 'راوي الحكايات',
  تشجيع: 'كابتن التشجيع',
  إبداع: 'صانع الأشياء',
};
export const DEFAULT_TITLE = 'نجم الجلسة';

// العربية تجمع 3–10 وتفرد ما بعدها: «5 عبارات» لكن «12 عبارة».
export function statementsLabel(count) {
  const n = Math.abs(Number(count) || 0);
  if (n === 1) return 'عبارة واحدة';
  if (n === 2) return 'عبارتان';
  return `${count} ${n >= 3 && n <= 10 ? 'عبارات' : 'عبارة'}`;
}

export function normalizeOptions(raw) {
  const o = { ...DEFAULT_OPTIONS, ...(raw || {}) };
  if (!MODES.includes(o.mode)) o.mode = DEFAULT_OPTIONS.mode;
  if (!ROUNDS.includes(o.rounds)) o.rounds = DEFAULT_OPTIONS.rounds;
  return o;
}

export function createStatementSource(statements, { random = Math.random, seen = {} } = {}) {
  return createNoRepeat(statements, { random, seen });
}

export function initialState(players, options) {
  const o = normalizeOptions(options);
  return {
    mode: o.mode,
    rounds: o.rounds,
    players: players.map((p) => ({ id: p.id, name: p.name, emoji: p.emoji, color: p.color })),
    scores: Object.fromEntries(players.map((p) => [p.id, 0])),
    tags: Object.fromEntries(players.map((p) => [p.id, {}])), // playerId → {tag: count}
    phase: 'intro', // intro | countdown | pick | vote | result | over
    completed: false,
    round: 1,
    statement: null,
    voter: 0,
    votes: {},   // voterId → targetId (وضع secret)
    winners: [], // الفائزون بهذه العبارة
  };
}

export function currentVoter(state) { return state.players[state.voter]; }

function award(state, winnerIds) {
  const scores = { ...state.scores };
  const tags = { ...state.tags };
  const tag = state.statement && state.statement.tag;
  for (const id of winnerIds) {
    scores[id] += 1;
    if (tag) tags[id] = { ...tags[id], [tag]: (tags[id][tag] || 0) + 1 };
  }
  return { scores, tags };
}

export function tallyVotes(state) {
  const counts = {};
  for (const target of Object.values(state.votes)) counts[target] = (counts[target] || 0) + 1;
  const max = Math.max(0, ...Object.values(counts));
  const winners = Object.keys(counts).filter((id) => counts[id] === max && max > 0);
  return { counts, winners, max };
}

export function reduce(state, action) {
  switch (action.type) {
    case 'BEGIN':
      if (state.phase !== 'intro') return state;
      if (!action.statement) return { ...state, phase: 'over' };
      return { ...state, statement: action.statement, votes: {}, voter: 0, winners: [], phase: state.mode === 'point' ? 'countdown' : 'vote' };

    case 'COUNTDOWN_DONE':
      if (state.phase !== 'countdown') return state;
      return { ...state, phase: 'pick' };

    case 'PICK': { // وضع الإشارة: تُسجَّل أسماء من أشير إليهم (واحد أو أكثر عند التعادل)
      if (state.phase !== 'pick') return state;
      const winnerIds = (action.playerIds || []).filter((id) => state.players.some((p) => p.id === id));
      if (winnerIds.length === 0) return state;
      return { ...state, ...award(state, winnerIds), winners: winnerIds, phase: 'result' };
    }

    case 'SKIP_STATEMENT': // لا أحد تنطبق عليه
      if (state.phase !== 'pick' && state.phase !== 'result') return state;
      return { ...state, winners: [], phase: 'result' };

    case 'VOTE': { // وضع التصويت السري
      if (state.phase !== 'vote') return state;
      const voter = currentVoter(state);
      const votes = { ...state.votes, [voter.id]: action.targetId };
      if (state.voter < state.players.length - 1) return { ...state, votes, voter: state.voter + 1 };
      const next = { ...state, votes };
      const { winners } = tallyVotes(next);
      return { ...next, ...award(next, winners), winners, phase: 'result' };
    }

    case 'NEXT': {
      if (state.phase !== 'result') return state;
      if (state.round >= state.rounds) return { ...state, phase: 'over', completed: true };
      return { ...state, phase: 'intro', round: state.round + 1, statement: null, votes: {}, voter: 0, winners: [] };
    }

    case 'END':
      return { ...state, phase: 'over', completed: false };

    default:
      return state;
  }
}

// لقب لكل لاعب من أكثر وسم فاز به
export function titleFor(state, playerId) {
  const tags = state.tags[playerId] || {};
  const best = Object.entries(tags).sort((a, b) => b[1] - a[1])[0];
  if (!best) return null;
  return TITLES[best[0]] || DEFAULT_TITLE;
}

export function standings(state) {
  return state.players.map((p) => ({ ...p, score: state.scores[p.id], title: titleFor(state, p.id) })).sort((a, b) => b.score - a.score);
}

// ── الجلسة المحفوظة ───────────────────────────────────────────────────────────
export const SESSION_VERSION = 1;
export const PHASES = ['intro', 'countdown', 'pick', 'vote', 'result', 'over'];
export const sessionSnapshot = (fields) => ({ schemaVersion: SESSION_VERSION, game: 'meenfina', ...fields });
const statementOk = (st) => !!st && typeof st === 'object' && typeof st.id === 'string' && isText(st.text, 200) && (st.tag === undefined || typeof st.tag === 'string');
export function restoreSession(raw) {
  if (!raw || typeof raw !== 'object' || raw.schemaVersion !== SESSION_VERSION || raw.game !== 'meenfina') return null;
  const s = raw.state;
  if (!s || typeof s !== 'object' || !isPlayerList(raw.players, { min: 3, max: 12 }) || !isPlayerList(s.players, { min: 3, max: 12 })) return null;
  const ids = s.players.map((p) => p.id);
  if (raw.players.map((p) => p.id).join('|') !== ids.join('|')) return null;
  const settings = normalizeOptions(raw.settings);
  if (s.mode !== settings.mode || s.rounds !== settings.rounds) return null;
  if (!PHASES.includes(s.phase) || s.phase === 'over' || typeof s.completed !== 'boolean') return null;
  if (!isCountMap(ids, s.scores)) return null;
  if (!s.tags || typeof s.tags !== 'object' || Object.keys(s.tags).some((id) => !ids.includes(id))) return null;
  if (!ids.every((id) => s.tags[id] && typeof s.tags[id] === 'object' && Object.values(s.tags[id]).every(isNonNegInt))) return null;
  if (!Number.isInteger(s.round) || s.round < 1 || s.round > s.rounds) return null;
  if (s.phase === 'intro' ? s.statement !== null : !statementOk(s.statement)) return null;
  if (!Number.isInteger(s.voter) || s.voter < 0 || s.voter >= ids.length) return null;
  if (!s.votes || typeof s.votes !== 'object' || Object.entries(s.votes).some(([voter, target]) => !ids.includes(voter) || !ids.includes(target))) return null;
  if (!Array.isArray(s.winners) || s.winners.some((id) => !ids.includes(id))) return null;
  if (!isSeed(raw.seed) || !isNonNegInt(raw.cursor)) return null;
  return { ...raw, settings, state: { ...s } };
}

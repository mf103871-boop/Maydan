// منطق «ممنوع!» — فريق يصف الكلمة دون الكلمات الممنوعة، والخصم يراقب ومعه زر «ممنوع!».
import { createNoRepeat } from '../../shared/lib/noRepeat.js';
import { isPlayerList, isCountMap, isNonNegInt, isText, isSeed } from '../../shared/lib/session.js';

export const SECONDS = [45, 60, 90];
export const ROUNDS = [2, 3, 4];
export const MAX_SKIPS = 3;
export const DEFAULT_OPTIONS = Object.freeze({ seconds: 60, rounds: 3 });

export function normalizeOptions(raw) {
  const o = { ...DEFAULT_OPTIONS, ...(raw || {}) };
  if (!SECONDS.includes(o.seconds)) o.seconds = DEFAULT_OPTIONS.seconds;
  if (!ROUNDS.includes(o.rounds)) o.rounds = DEFAULT_OPTIONS.rounds;
  return o;
}

export function createCardSource(cards, { random = Math.random, seen = {} } = {}) {
  return createNoRepeat(cards, { random, seen });
}

export function initialState(teams, options) {
  const o = normalizeOptions(options);
  return {
    seconds: o.seconds,
    rounds: o.rounds,
    teams: teams.map((t) => ({ id: t.id, name: t.name, color: t.color, emoji: t.emoji })),
    scores: Object.fromEntries(teams.map((t) => [t.id, 0])),
    phase: 'intro', // intro | play | roundEnd | over
    completed: false,
    round: 1,
    turn: 0,
    card: null,
    skipsLeft: MAX_SKIPS,
    tally: { correct: 0, buzz: 0, skip: 0 },
    log: [],
  };
}

export function currentTeam(state) {
  return state.teams[state.turn];
}

export function opponentLabel(state) {
  return state.teams.filter((_, i) => i !== state.turn).map((t) => t.name).join(' و');
}

function withNext(state, card) {
  // انتهاء البطاقات = انتهاء الجولة، لا تعطّل
  return card ? { ...state, card } : { ...state, phase: 'roundEnd', card: null };
}

export function reduce(state, action) {
  switch (action.type) {
    case 'BEGIN':
      if (state.phase !== 'intro') return state;
      if (!action.card) return { ...state, phase: 'over' };
      return { ...state, phase: 'play', card: action.card, skipsLeft: MAX_SKIPS, tally: { correct: 0, buzz: 0, skip: 0 } };
    case 'CORRECT': {
      if (state.phase !== 'play') return state;
      const team = currentTeam(state);
      const scores = { ...state.scores, [team.id]: state.scores[team.id] + 1 };
      return withNext({ ...state, scores, tally: { ...state.tally, correct: state.tally.correct + 1 }, log: [...state.log, { round: state.round, teamId: team.id, cardId: state.card.id, result: 'correct' }] }, action.card);
    }
    case 'BUZZ': {
      if (state.phase !== 'play') return state;
      const team = currentTeam(state);
      const scores = { ...state.scores, [team.id]: state.scores[team.id] - 1 };
      return withNext({ ...state, scores, tally: { ...state.tally, buzz: state.tally.buzz + 1 }, log: [...state.log, { round: state.round, teamId: team.id, cardId: state.card.id, result: 'buzz' }] }, action.card);
    }
    case 'SKIP': {
      if (state.phase !== 'play' || state.skipsLeft <= 0) return state;
      const team = currentTeam(state);
      return withNext({ ...state, skipsLeft: state.skipsLeft - 1, tally: { ...state.tally, skip: state.tally.skip + 1 }, log: [...state.log, { round: state.round, teamId: team.id, cardId: state.card.id, result: 'skip' }] }, action.card);
    }
    case 'TIME_UP':
      if (state.phase !== 'play') return state;
      return { ...state, phase: 'roundEnd' };
    case 'NEXT': {
      if (state.phase !== 'roundEnd') return state;
      const last = state.turn === state.teams.length - 1;
      const round = last ? state.round + 1 : state.round;
      if (last && state.round >= state.rounds) return { ...state, phase: 'over', card: null, completed: true };
      return { ...state, phase: 'intro', turn: last ? 0 : state.turn + 1, round, card: null };
    }
    case 'END':
      return { ...state, phase: 'over', completed: false };
    default:
      return state;
  }
}

export function standings(state) {
  return state.teams.map((t) => ({ ...t, score: state.scores[t.id] })).sort((a, b) => b.score - a.score);
}

// ── الجلسة المحفوظة ───────────────────────────────────────────────────────────
// اللقطة: حالة الـreducer كما هي + بذرة مصدر البطاقات وموضعه + الوقت المتبقي في الجولة.
export const SESSION_VERSION = 1;
export const RESULTS = ['correct', 'buzz', 'skip'];
export const sessionSnapshot = (fields) => ({ schemaVersion: SESSION_VERSION, game: 'mamnoo', ...fields });
const cardOk = (card) => !!card && typeof card === 'object' && typeof card.id === 'string' && isText(card.word, 80)
  && typeof card.category === 'string' && Array.isArray(card.forbidden) && card.forbidden.every((w) => typeof w === 'string');
export function restoreSession(raw) {
  if (!raw || typeof raw !== 'object' || raw.schemaVersion !== SESSION_VERSION || raw.game !== 'mamnoo') return null;
  const s = raw.state;
  if (!s || typeof s !== 'object' || !isPlayerList(raw.teams, { min: 2, max: 4 }) || !isPlayerList(s.teams, { min: 2, max: 4 })) return null;
  const ids = s.teams.map((t) => t.id);
  if (raw.teams.map((t) => t.id).join('|') !== ids.join('|')) return null;
  const settings = normalizeOptions(raw.settings);
  if (s.seconds !== settings.seconds || s.rounds !== settings.rounds) return null;
  if (!['intro', 'play', 'roundEnd'].includes(s.phase) || typeof s.completed !== 'boolean') return null;
  if (!isCountMap(ids, s.scores, { allowNegative: true })) return null; // «ممنوع!» يخصم نقطة
  if (!Number.isInteger(s.round) || s.round < 1 || s.round > s.rounds) return null;
  if (!Number.isInteger(s.turn) || s.turn < 0 || s.turn >= ids.length) return null;
  if (!isNonNegInt(s.skipsLeft) || s.skipsLeft > MAX_SKIPS) return null;
  if (!s.tally || typeof s.tally !== 'object' || !RESULTS.every((key) => isNonNegInt(s.tally[key]))) return null;
  if (!Array.isArray(s.log) || s.log.length > 2000 || !s.log.every((e) => e && ids.includes(e.teamId) && typeof e.cardId === 'string' && RESULTS.includes(e.result) && Number.isInteger(e.round))) return null;
  // نهاية الوقت تُبقي البطاقة الأخيرة معروضة في شاشة الحصيلة، فتُقبل بطاقة صالحة في أي مرحلة.
  if (s.card !== null && !cardOk(s.card)) return null;
  if (s.phase === 'play' && !s.card) return null;
  if (!isSeed(raw.seed) || !isNonNegInt(raw.cursor)) return null;
  if (raw.timeLeft != null && !(Number.isFinite(raw.timeLeft) && raw.timeLeft >= 0 && raw.timeLeft <= 600)) return null;
  return { ...raw, settings, state: { ...s } };
}

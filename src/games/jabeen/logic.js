// منطق «على جبينك» — الجوال على الجبين، الآخرون يصفون واللاعب يخمّن.
// إمالة للأسفل = صح، للأعلى = تخطي، مع مهلة بعد كل حركة لمنع التكرار.
import { createNoRepeat } from '../../shared/lib/noRepeat.js';

export const SECONDS = [45, 60, 90];
export const TILT_COOLDOWN_MS = 700;
export const TILT_DOWN = 45;   // beta > 45°  → الجوال مائل للأسفل → صح
export const TILT_UP = -25;    // beta < -25° → مائل للأعلى → تخطي
export const TILT_NEUTRAL = [0, 30]; // يجب العودة إلى هذا المدى قبل قبول حركة جديدة

export const DEFAULT_OPTIONS = Object.freeze({ seconds: 60, categoryId: null, control: 'auto' });

export function normalizeOptions(raw, categories) {
  const o = { ...DEFAULT_OPTIONS, ...(raw || {}) };
  if (!SECONDS.includes(o.seconds)) o.seconds = DEFAULT_OPTIONS.seconds;
  if (!['auto', 'touch'].includes(o.control)) o.control = 'auto';
  if (!categories.some((c) => c.id === o.categoryId)) o.categoryId = categories[0].id;
  return o;
}

export function createItemSource(category, { random = Math.random, seen = {} } = {}) {
  return createNoRepeat(category.items, { random, seen });
}

export function initialState(entrants, category, options) {
  return {
    seconds: options.seconds,
    control: options.control,
    categoryId: category.id,
    categoryName: category.name,
    entrants: entrants.map((e) => ({ id: e.id, name: e.name, emoji: e.emoji, color: e.color })),
    scores: Object.fromEntries(entrants.map((e) => [e.id, 0])),
    phase: 'intro', // intro | play | review | over
    turn: 0,
    item: null,
    results: [], // {itemId, text, ok} للجولة الحالية
    log: [],
  };
}

export function currentEntrant(state) {
  return state.entrants[state.turn];
}

// قرار الإمالة: يعيد 'correct' | 'skip' | null.
// armed=false يعني أن الجوال لم يعد بعد إلى الوضع المحايد بعد آخر حركة.
export function tiltDecision(beta, armed) {
  if (!Number.isFinite(beta)) return null;
  if (!armed) return null;
  if (beta >= TILT_DOWN) return 'correct';
  if (beta <= TILT_UP) return 'skip';
  return null;
}

export function isNeutral(beta) {
  return Number.isFinite(beta) && beta > TILT_NEUTRAL[0] && beta < TILT_NEUTRAL[1];
}

export function reduce(state, action) {
  switch (action.type) {
    case 'BEGIN':
      if (state.phase !== 'intro') return state;
      if (!action.item) return { ...state, phase: 'over' };
      return { ...state, phase: 'play', item: action.item, results: [] };
    case 'ANSWER': {
      if (state.phase !== 'play') return state;
      const results = [...state.results, { itemId: state.item.id, text: state.item.text, ok: !!action.ok }];
      if (!action.item) return { ...state, results, phase: 'review', item: null };
      return { ...state, results, item: action.item };
    }
    case 'TIME_UP':
      if (state.phase !== 'play') return state;
      return { ...state, phase: 'review', item: null };
    case 'TOGGLE_RESULT': {
      if (state.phase !== 'review') return state;
      return { ...state, results: state.results.map((r, i) => (i === action.index ? { ...r, ok: !r.ok } : r)) };
    }
    case 'CONFIRM': {
      if (state.phase !== 'review') return state;
      const entrant = currentEntrant(state);
      const correct = state.results.filter((r) => r.ok).length;
      const scores = { ...state.scores, [entrant.id]: state.scores[entrant.id] + correct };
      const log = [...state.log, { entrantId: entrant.id, correct, total: state.results.length }];
      const last = state.turn === state.entrants.length - 1;
      if (last) return { ...state, scores, log, phase: 'over', results: [] };
      return { ...state, scores, log, phase: 'intro', turn: state.turn + 1, results: [] };
    }
    case 'END':
      return { ...state, phase: 'over' };
    default:
      return state;
  }
}

export function standings(state) {
  return state.entrants.map((e) => ({ ...e, score: state.scores[e.id] })).sort((a, b) => b.score - a.score);
}

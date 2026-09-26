// منطق «على جبينك» — الجوال على الجبين، الآخرون يصفون واللاعب يخمّن.
// إمالة للأسفل = صح، للأعلى = تخطي، مع مهلة بعد كل حركة لمنع التكرار.
import { createNoRepeat } from '../../shared/lib/noRepeat.js';
import { isPlayerList, isCountMap, isNonNegInt, isText, isSeed } from '../../shared/lib/session.js';

export const SECONDS = [45, 60, 90];
export const TILT_COOLDOWN_MS = 700;
export const TILT_PROBE_MS = 2500;
export const TILT_DOWN = 45;   // الزاوية النسبية > 45° → الجوال مائل للأسفل → صح
export const TILT_UP = -25;    // الزاوية النسبية < -25° → مائل للأعلى → تخطي
export const TILT_NEUTRAL = [-15, 30]; // يجب العودة إلى هذا المدى (ويشمل الصفر) قبل قبول حركة جديدة
// معايرة: أول قراءات الدور تحدّد «وضع الجبين» لهذا اللاعب، والقرارات تُحسب بالفرق عنه لا
// بزوايا مطلقة — الهاتف على الجبين ليس مستويًا، ويختلف الميل الطبيعي بين لاعب وآخر.
export const TILT_BASELINE_SAMPLES = 6;
export const TILT_BASELINE_MAX = 60; // ميلٌ أكبر من هذا عند البداية ليس وضع جبين؛ لا يُعتمد أساسًا

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
    completed: false,
    turn: 0,
    item: null,
    results: [], // {itemId, text, ok} للجولة الحالية
    recycled: false, // هل أُعيد خلط كلمات الفئة لأنها نفدت؟
    log: [],
  };
}

export function currentEntrant(state) {
  return state.entrants[state.turn];
}

// الجوال يُمسك أفقيًا في هذه اللعبة، وفي الوضع الأفقي لا تتغير beta مع حركة
// «أسفل/أعلى» إطلاقًا (تقفز بين 0 و±180 بحسب ميل بسيط في الرأس)، بينما تتغير
// gamma. نصحّح المحور بحسب زاوية دوران الشاشة فنحصل على زاوية واحدة للقرار.
export function orientedTilt(event, screenAngle = 0) {
  if (!event) return NaN;
  // deviceorientation يرسل null على الأجهزة بلا مستشعر، وNumber(null) = 0 وهو رقم صالح.
  const axis = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);
  const beta = axis(event.beta);
  const gamma = axis(event.gamma);
  const angle = ((Number(screenAngle) || 0) % 360 + 360) % 360;
  if (angle >= 45 && angle < 135) return -gamma;   // أفقي (الجهاز مُدار عكس عقارب الساعة)
  if (angle >= 135 && angle < 225) return -beta;   // رأسي مقلوب
  if (angle >= 225 && angle < 315) return gamma;   // أفقي (الجهاز مُدار مع عقارب الساعة)
  return beta;                                      // رأسي طبيعي
}

export function screenAngle() {
  if (typeof window === 'undefined') return 0;
  const fromScreen = window.screen && window.screen.orientation && window.screen.orientation.angle;
  if (Number.isFinite(fromScreen)) return fromScreen;
  return Number.isFinite(window.orientation) ? window.orientation : 0;
}

// الأساس: وسيط أول العينات (مقاوم لقراءة شاذة). غير صالح إن كانت العينات قليلة أو الميل
// الابتدائي كبيرًا؛ حينها تُستعمل الزوايا المطلقة (baseline = 0) كما كان.
export function tiltBaseline(samples) {
  const finite = (samples || []).filter(Number.isFinite);
  if (finite.length < TILT_BASELINE_SAMPLES) return null;
  const sorted = [...finite].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return Math.abs(median) <= TILT_BASELINE_MAX ? median : 0;
}

// قرار الإمالة: يعيد 'correct' | 'skip' | null.
// armed=false يعني أن الجوال لم يمرّ بعد بالوضع المحايد (ويبدأ غير مسلَّح).
export function tiltDecision(angle, armed, baseline = 0) {
  if (!Number.isFinite(angle)) return null;
  if (!armed) return null;
  const relative = angle - (Number.isFinite(baseline) ? baseline : 0);
  if (relative >= TILT_DOWN) return 'correct';
  if (relative <= TILT_UP) return 'skip';
  return null;
}

export function isNeutral(angle, baseline = 0) {
  if (!Number.isFinite(angle)) return false;
  const relative = angle - (Number.isFinite(baseline) ? baseline : 0);
  return relative > TILT_NEUTRAL[0] && relative < TILT_NEUTRAL[1];
}

export function reduce(state, action) {
  switch (action.type) {
    case 'BEGIN': {
      if (state.phase !== 'intro') return state;
      const recycled = state.recycled || !!action.recycled;
      // لا كلمة أصلًا؟ ينتقل اللاعب إلى المراجعة الفارغة ثم يأتي دور من بعده،
      // فلا تنتهي المباراة قبل أن يلعب الجميع.
      if (!action.item) return { ...state, phase: 'review', item: null, results: [], recycled };
      return { ...state, phase: 'play', item: action.item, results: [], recycled };
    }
    case 'ANSWER': {
      if (state.phase !== 'play') return state;
      const results = [...state.results, { itemId: state.item.id, text: state.item.text, ok: !!action.ok }];
      const recycled = state.recycled || !!action.recycled;
      // لا كلمة حتى بعد إعادة الخلط (فئة فارغة): ينتهي الدور بالمراجعة. الواجهة تعيد
      // الخلط قبل الوصول هنا، فنفاد الفئة وحده لا يقطع دور اللاعب.
      if (!action.item) return { ...state, results, phase: 'review', item: null, recycled };
      return { ...state, results, item: action.item, recycled };
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
      if (last) return { ...state, scores, log, phase: 'over', results: [], completed: log.some((entry) => entry.total > 0) };
      return { ...state, scores, log, phase: 'intro', turn: state.turn + 1, results: [] };
    }
    case 'END':
      return { ...state, phase: 'over', completed: false };
    default:
      return state;
  }
}

export function standings(state) {
  return state.entrants.map((e) => ({ ...e, score: state.scores[e.id] })).sort((a, b) => b.score - a.score);
}

// ── الجلسة المحفوظة ───────────────────────────────────────────────────────────
export const SESSION_VERSION = 1;
export const sessionSnapshot = (fields) => ({ schemaVersion: SESSION_VERSION, game: 'jabeen', ...fields });
const itemOk = (item) => !!item && typeof item === 'object' && typeof item.id === 'string' && isText(item.text, 120);
const resultOk = (r) => !!r && typeof r === 'object' && typeof r.itemId === 'string' && typeof r.text === 'string' && typeof r.ok === 'boolean';
export function restoreSession(raw, categories) {
  if (!raw || typeof raw !== 'object' || raw.schemaVersion !== SESSION_VERSION || raw.game !== 'jabeen') return null;
  const s = raw.state;
  if (!s || typeof s !== 'object' || !isPlayerList(raw.players, { min: 2, max: 10 }) || !isPlayerList(s.entrants, { min: 2, max: 10 })) return null;
  const ids = s.entrants.map((e) => e.id);
  if (raw.players.map((p) => p.id).join('|') !== ids.join('|')) return null;
  // normalizeOptions يعود إلى أول فئة عند غياب المطلوبة؛ الاستئناف يشترط الفئة المحفوظة نفسها.
  const list = Array.isArray(categories) ? categories : [];
  if (!list.length || !raw.settings || typeof raw.settings !== 'object' || !list.some((c) => c.id === raw.settings.categoryId)) return null;
  const settings = normalizeOptions(raw.settings, list);
  const category = list.find((c) => c.id === settings.categoryId);
  if (!category || s.categoryId !== category.id || s.seconds !== settings.seconds || s.control !== settings.control) return null;
  if (typeof s.categoryName !== 'string') return null;
  if (!['intro', 'play', 'review'].includes(s.phase) || typeof s.completed !== 'boolean' || typeof s.recycled !== 'boolean') return null;
  if (!isCountMap(ids, s.scores)) return null;
  if (!Number.isInteger(s.turn) || s.turn < 0 || s.turn >= ids.length) return null;
  if (s.item !== null && !itemOk(s.item)) return null;
  if (s.phase === 'play' && !s.item) return null;
  if (!Array.isArray(s.results) || s.results.length > 500 || !s.results.every(resultOk)) return null;
  if (!Array.isArray(s.log) || s.log.length > ids.length || !s.log.every((e) => e && ids.includes(e.entrantId) && isNonNegInt(e.correct) && isNonNegInt(e.total))) return null;
  if (!isSeed(raw.seed) || !isNonNegInt(raw.cursor)) return null;
  if (raw.timeLeft != null && !(Number.isFinite(raw.timeLeft) && raw.timeLeft >= 0 && raw.timeLeft <= 600)) return null;
  return { ...raw, settings, state: { ...s } };
}

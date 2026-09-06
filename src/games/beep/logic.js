// منطق «قبل ما يطق!» — آلة حالة نقية بلا React.
//
// وضعان:
//   three: «3 قبل الصفارة» — كل لاعب بدوره يذكر 3 أشياء قبل انتهاء المؤقت، والمجموعة تحكم ✅/❌ → نقطة.
//   bomb : «القنبلة» — مؤقت مخفي عشوائي؛ يتناقل اللاعبون الجوال؛ من ينفجر بيده يخسر حياة. آخر من يبقى يفوز.
import { createNoRepeat } from '../../shared/lib/noRepeat.js';
import { randInt } from '../../shared/lib/rng.js';

export const SECONDS = [5, 7, 10];
export const ROUNDS = [3, 5, 8];
export const MODES = ['three', 'bomb'];
export const LIVES = 3;
export const BOMB_RANGE = [20, 60];

export const DEFAULT_OPTIONS = Object.freeze({ mode: 'three', seconds: 5, rounds: 5 });

export function normalizeOptions(raw) {
  const o = { ...DEFAULT_OPTIONS, ...(raw || {}) };
  if (!MODES.includes(o.mode)) o.mode = DEFAULT_OPTIONS.mode;
  if (!SECONDS.includes(o.seconds)) o.seconds = DEFAULT_OPTIONS.seconds;
  if (!ROUNDS.includes(o.rounds)) o.rounds = DEFAULT_OPTIONS.rounds;
  return o;
}

// طوابير سحب بلا تكرار، طابور لكل صعوبة، مع أولوية لما لم يُعرض في جلسات سابقة.
export function createPromptSource(prompts, { random = Math.random, seen = {} } = {}) {
  const byLevel = { 1: [], 2: [], 3: [] };
  for (const p of prompts) (byLevel[p.difficulty] || byLevel[2]).push(p);
  const queues = { 1: createNoRepeat(byLevel[1], { random, seen }), 2: createNoRepeat(byLevel[2], { random, seen }), 3: createNoRepeat(byLevel[3], { random, seen }) };
  const drawn = new Set();
  return {
    // الصعوبة تتصاعد مع الجولات: الثلث الأول سهل، ثم متوسط، ثم صعب.
    next(round = 1, rounds = 1) {
      const level = Math.min(3, Math.max(1, Math.ceil((round / Math.max(1, rounds)) * 3)));
      const order = [level, level - 1, level + 1, level - 2, level + 2].filter((l) => l >= 1 && l <= 3);
      for (const l of order) {
        const item = queues[l].next();
        if (item) { drawn.add(item.id); return item; }
      }
      return null;
    },
    get remaining() { return queues[1].remaining + queues[2].remaining + queues[3].remaining; },
    seen() { return { ...queues[1].seen(), ...queues[2].seen(), ...queues[3].seen() }; },
    drawnIds() { return [...drawn]; },
  };
}

export function initialState(players, options, { random = Math.random } = {}) {
  const o = normalizeOptions(options);
  const ids = players.map((p) => p.id);
  return {
    mode: o.mode,
    seconds: o.seconds,
    rounds: o.mode === 'three' ? o.rounds : 0,
    players: players.map((p) => ({ id: p.id, name: p.name, emoji: p.emoji, color: p.color })),
    phase: 'intro', // intro | prompt | judge | boom | over
    round: 1,
    turn: 0,
    prompt: null,
    scores: Object.fromEntries(ids.map((id) => [id, 0])),
    lives: Object.fromEntries(ids.map((id) => [id, LIVES])),
    eliminated: [],
    passes: Object.fromEntries(ids.map((id) => [id, 0])),
    bombSeconds: o.mode === 'bomb' ? randInt(random, BOMB_RANGE[0], BOMB_RANGE[1]) : 0,
    bombElapsed: 0,
    history: [],
    seed: 0,
  };
}

function alive(state) {
  return state.players.filter((p) => !state.eliminated.includes(p.id));
}

function nextTurn(state) {
  const living = alive(state);
  if (living.length === 0) return state.turn;
  let i = state.turn;
  for (let k = 0; k < state.players.length; k += 1) {
    i = (i + 1) % state.players.length;
    if (!state.eliminated.includes(state.players[i].id)) return i;
  }
  return state.turn;
}

export function currentPlayer(state) {
  return state.players[state.turn];
}

export function reduce(state, action) {
  switch (action.type) {
    case 'BEGIN': // من شاشة «دور فلان» إلى الطلب
      if (!action.prompt) return { ...state, phase: 'over' };
      return { ...state, phase: 'prompt', prompt: action.prompt };

    case 'FINISH': // اللاعب قال «خلصت!» قبل الصفارة أو انتهى الوقت (وضع three)
      if (state.mode !== 'three' || state.phase !== 'prompt') return state;
      return { ...state, phase: 'judge', timedOut: !!action.timedOut };

    case 'JUDGE': {
      if (state.mode !== 'three' || state.phase !== 'judge') return state;
      const player = currentPlayer(state);
      const scores = { ...state.scores, [player.id]: state.scores[player.id] + (action.ok ? 1 : 0) };
      const history = [...state.history, { round: state.round, playerId: player.id, promptId: state.prompt.id, ok: !!action.ok }];
      const lastPlayer = state.turn === state.players.length - 1;
      const round = lastPlayer ? state.round + 1 : state.round;
      const over = lastPlayer && state.round >= state.rounds;
      return { ...state, scores, history, turn: lastPlayer ? 0 : state.turn + 1, round, phase: over ? 'over' : 'intro', prompt: null, timedOut: false };
    }

    case 'PASS': { // وضع القنبلة: أجاب ومرّر الجوال للتالي
      if (state.mode !== 'bomb' || state.phase !== 'prompt') return state;
      const player = currentPlayer(state);
      const passes = { ...state.passes, [player.id]: state.passes[player.id] + 1 };
      const history = [...state.history, { playerId: player.id, promptId: state.prompt.id, ok: true }];
      if (!action.prompt) return { ...state, passes, history, phase: 'over' };
      return { ...state, passes, history, turn: nextTurn(state), prompt: action.prompt, bombElapsed: action.elapsed ?? state.bombElapsed };
    }

    case 'EXPLODE': { // انفجرت القنبلة بيد اللاعب الحالي
      if (state.mode !== 'bomb' || state.phase !== 'prompt') return state;
      const player = currentPlayer(state);
      const lives = { ...state.lives, [player.id]: Math.max(0, state.lives[player.id] - 1) };
      const eliminated = lives[player.id] === 0 ? [...state.eliminated, player.id] : state.eliminated;
      const history = [...state.history, { playerId: player.id, promptId: state.prompt.id, ok: false, exploded: true }];
      const living = state.players.filter((p) => !eliminated.includes(p.id));
      const over = living.length <= 1;
      return { ...state, lives, eliminated, history, phase: over ? 'over' : 'boom', boomPlayerId: player.id };
    }

    case 'CONTINUE': { // بعد شاشة الانفجار: قنبلة جديدة بمؤقت جديد
      if (state.mode !== 'bomb' || state.phase !== 'boom') return state;
      const base = { ...state, phase: 'intro', prompt: null, bombSeconds: action.bombSeconds || state.bombSeconds, bombElapsed: 0, round: state.round + 1 };
      return { ...base, turn: nextTurn({ ...state, eliminated: state.eliminated }) };
    }

    case 'END': // إنهاء مبكر
      return { ...state, phase: 'over' };

    default:
      return state;
  }
}

// ترتيب نهائي: three بحسب النقاط؛ bomb بحسب البقاء ثم الأرواح ثم عدد التمريرات.
export function standings(state) {
  if (state.mode === 'three') {
    return state.players.map((p) => ({ ...p, score: state.scores[p.id] })).sort((a, b) => b.score - a.score);
  }
  const order = state.players.map((p) => {
    const outIndex = state.eliminated.indexOf(p.id);
    return { ...p, alive: outIndex === -1, outIndex, lives: state.lives[p.id], passes: state.passes[p.id], score: (outIndex === -1 ? 100 : outIndex) + state.lives[p.id] * 10 + state.passes[p.id] };
  });
  return order.sort((a, b) => b.score - a.score);
}

export function nextBombSeconds(random = Math.random) {
  return randInt(random, BOMB_RANGE[0], BOMB_RANGE[1]);
}

// منطق «فَبْرَكة» — كل لاعب يكتب إجابة مزيفة سرًا، ثم تُخلط مع الحقيقة ويصوّت الجميع.
//
// النقاط: +1000 لمن اختار الحقيقة، +500 لصاحب الإجابة عن كل لاعب خدعه.
import { createNoRepeat } from '../../shared/lib/noRepeat.js';
import { shuffle } from '../../shared/lib/shuffle.js';
import { arabicNormalizeLoose } from '../../shared/lib/arabicNormalize.js';

export const ROUNDS = [3, 5, 7];
export const POINTS_TRUTH = 1000;
export const POINTS_FOOLED = 500;
export const TRUTH_ID = '__truth__';
export const DEFAULT_OPTIONS = Object.freeze({ rounds: 3 });

export function normalizeOptions(raw) {
  const o = { ...DEFAULT_OPTIONS, ...(raw || {}) };
  if (!ROUNDS.includes(o.rounds)) o.rounds = DEFAULT_OPTIONS.rounds;
  return o;
}

export function createQuestionSource(questions, { random = Math.random, seen = {} } = {}) {
  return createNoRepeat(questions, { random, seen });
}

// يرفض الإجابة الفارغة، أو المطابقة للحقيقة، أو المطابقة لإجابة لاعب آخر (بعد التطبيع).
export function validateLie(text, { truth, taken }) {
  const clean = String(text || '').trim().replace(/\s+/g, ' ');
  if (!clean) return { ok: false, message: 'اكتب إجابة' };
  if (clean.length > 60) return { ok: false, message: 'اجعلها أقصر' };
  const norm = arabicNormalizeLoose(clean);
  if (!norm) return { ok: false, message: 'اكتب إجابة' };
  if (norm === arabicNormalizeLoose(truth)) return { ok: false, message: 'هذه هي الحقيقة نفسها! اكتب غيرها' };
  if (taken.some((t) => arabicNormalizeLoose(t) === norm)) return { ok: false, message: 'أحدهم كتب هذه الإجابة، جرّب غيرها' };
  return { ok: true, text: clean };
}

export function initialState(players, options) {
  const o = normalizeOptions(options);
  return {
    rounds: o.rounds,
    players: players.map((p) => ({ id: p.id, name: p.name, emoji: p.emoji, color: p.color })),
    scores: Object.fromEntries(players.map((p) => [p.id, 0])),
    phase: 'intro', // intro | write | vote | reveal | roundEnd | over
    round: 1,
    question: null,
    writer: 0,       // مؤشر اللاعب الذي يكتب الآن
    lies: [],        // {playerId, text}
    voter: 0,        // مؤشر اللاعب الذي يصوّت الآن
    options: [],     // [{id, text}] مخلوطة، id = playerId أو TRUTH_ID
    votes: {},       // playerId → optionId
    revealIndex: 0,
    roundScores: {},
  };
}

export function currentWriter(state) { return state.players[state.writer]; }
export function currentVoter(state) { return state.players[state.voter]; }

export function reduce(state, action) {
  switch (action.type) {
    case 'BEGIN':
      if (state.phase !== 'intro') return state;
      if (!action.question) return { ...state, phase: 'over' };
      return { ...state, phase: 'write', question: action.question, writer: 0, lies: [], votes: {}, options: [], voter: 0, revealIndex: 0, roundScores: {} };

    case 'SUBMIT_LIE': {
      if (state.phase !== 'write') return state;
      const player = currentWriter(state);
      const lies = [...state.lies, { playerId: player.id, text: action.text }];
      if (state.writer < state.players.length - 1) return { ...state, lies, writer: state.writer + 1 };
      // كل اللاعبين كتبوا → اخلط الإجابات مع الحقيقة
      const options = shuffle([...lies.map((l) => ({ id: l.playerId, text: l.text })), { id: TRUTH_ID, text: state.question.answer }], action.random || Math.random);
      return { ...state, lies, options, phase: 'vote', voter: 0 };
    }

    case 'VOTE': {
      if (state.phase !== 'vote') return state;
      const player = currentVoter(state);
      if (action.optionId === player.id) return state; // لا يختار إجابته
      const votes = { ...state.votes, [player.id]: action.optionId };
      if (state.voter < state.players.length - 1) return { ...state, votes, voter: state.voter + 1 };
      return { ...state, votes, phase: 'reveal', revealIndex: 0 };
    }

    case 'REVEAL_NEXT': {
      if (state.phase !== 'reveal') return state;
      const next = state.revealIndex + 1;
      // الخيارات = كذبة لكل لاعب + الحقيقة، فهي أكثر من اللاعبين بواحد.
      // القياس على عدد اللاعبين كان يترك آخر خيار — وقد يكون الحقيقة — دون كشف.
      if (next < state.options.length) return { ...state, revealIndex: next };
      // كل الكشوف تمت → احسب نقاط الجولة
      const round = scoreRound(state);
      const scores = { ...state.scores };
      for (const [id, points] of Object.entries(round)) scores[id] += points;
      return { ...state, scores, roundScores: round, phase: 'roundEnd' };
    }

    case 'NEXT_ROUND': {
      if (state.phase !== 'roundEnd') return state;
      if (state.round >= state.rounds) return { ...state, phase: 'over' };
      return { ...state, phase: 'intro', round: state.round + 1, question: null, lies: [], votes: {}, options: [], writer: 0, voter: 0, revealIndex: 0, roundScores: {} };
    }

    case 'END':
      return { ...state, phase: 'over' };

    default:
      return state;
  }
}

// نقاط الجولة: من اختار الحقيقة +1000، وصاحب كل إجابة +500 عن كل من خُدع بها.
export function scoreRound(state) {
  const round = Object.fromEntries(state.players.map((p) => [p.id, 0]));
  for (const [voterId, optionId] of Object.entries(state.votes)) {
    if (optionId === TRUTH_ID) round[voterId] += POINTS_TRUTH;
    else if (round[optionId] !== undefined) round[optionId] += POINTS_FOOLED;
  }
  return round;
}

// من صوّت لهذا الخيار
export function votersFor(state, optionId) {
  return Object.entries(state.votes).filter(([, id]) => id === optionId).map(([voterId]) => state.players.find((p) => p.id === voterId));
}

export function standings(state) {
  return state.players.map((p) => ({ ...p, score: state.scores[p.id] })).sort((a, b) => b.score - a.score);
}

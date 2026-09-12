// Serializable game engine. Private actions are bound to the player and round;
// answer matching only happens after a submission has been locked.
import { createNoRepeat } from '../../shared/lib/noRepeat.js';
import { shuffle } from '../../shared/lib/shuffle.js';
import { arabicNormalize, arabicNormalizeLoose } from '../../shared/lib/arabicNormalize.js';
import { mulberry32 } from '../../shared/lib/rng.js';

export const ROUNDS = [3, 5, 7];
export const MODES = ['classic', 'mixed', 'pictures', 'friends'];
export const POINTS_TRUTH = 1000;
export const POINTS_FOOLED = 500;
export const TRUTH_ID = '__truth__';
export const SESSION_VERSION = 2;
export const SAVE_KEY = 'session-v2';
export const DEFAULT_OPTIONS = Object.freeze({ rounds: 3, mode: 'classic', style: 'curious', categories: [], writeSeconds: 45, discussionSeconds: 20, funnyVote: true, finalDouble: false, friendCycles: 1 });
const PHASES = ['intro', 'host', 'question', 'write', 'discussion', 'vote', 'gather', 'reveal', 'roundEnd', 'over'];
const SECRET_PHASES = ['host', 'write', 'vote'];
const validId = (id) => typeof id === 'string' && /^[\w-]{1,100}$/.test(id) && !['__proto__', 'constructor', 'prototype', TRUTH_ID].includes(id);

export function normalizeOptions(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  return {
    rounds: ROUNDS.includes(r.rounds) ? r.rounds : 3,
    mode: MODES.includes(r.mode) ? r.mode : 'classic',
    style: r.style === 'all' ? 'all' : 'curious',
    categories: Array.isArray(r.categories) ? [...new Set(r.categories.filter((c) => typeof c === 'string' && c.length < 80))] : [],
    writeSeconds: [0, 30, 45].includes(r.writeSeconds) ? r.writeSeconds : 45,
    discussionSeconds: [0, 15, 20].includes(r.discussionSeconds) ? r.discussionSeconds : 20,
    funnyVote: typeof r.funnyVote === 'boolean' ? r.funnyVote : true,
    finalDouble: r.mode !== 'friends' && r.finalDouble === true,
    friendCycles: r.friendCycles === 2 ? 2 : 1,
  };
}

export const factId = (q) => q.factId || q.id;
export function createQuestionSource(questions, { random = Math.random, seen = {} } = {}) {
  const facts = new Set();
  const unique = questions.filter((q) => { const id = factId(q); if (facts.has(id)) return false; facts.add(id); return true; });
  const migrated = { ...seen };
  for (const q of unique) {
    const previous = [q.id, ...(q.previousIds || [])].find((id) => seen[id]);
    if (previous) migrated[factId(q)] = seen[previous];
  }
  return createNoRepeat(unique, { random, seen: migrated, idOf: factId });
}

export function questionPool(questions, options) {
  const o = normalizeOptions(options);
  return questions.filter((q) => (o.style === 'all' || q.curious) && (!o.categories.length || o.categories.includes(q.category)));
}

export function buildDeck({ questions, pictures = [], personal = [], options, seen = {}, random = Math.random }) {
  const o = normalizeOptions(options);
  if (o.mode === 'friends') {
    const source = createQuestionSource(personal, { seen, random });
    return Array.from({ length: source.total }, () => source.next());
  }
  const text = createQuestionSource(questionPool(questions, o), { seen, random });
  const visual = createQuestionSource(pictures, { seen, random });
  const out = [];
  for (let i = 0; i < o.rounds; i += 1) {
    const source = o.mode === 'pictures' || (o.mode === 'mixed' && i % 3 === 2) ? visual : text;
    const q = source.next();
    if (!q) break;
    out.push(q);
  }
  return out;
}

export function validateLie(text) {
  const clean = String(text ?? '').trim().replace(/\s+/g, ' ');
  if (!clean || !arabicNormalizeLoose(clean)) return { ok: false, message: 'اكتب إجابة قصيرة أولًا' };
  if (clean.length > 60) return { ok: false, message: 'الإجابة حتى 60 حرفًا' };
  return { ok: true, text: clean };
}

const numberWords = new Map();
for (const [n, forms] of [
  [0, 'صفر'], [1, 'واحد واحدة احد احدى'], [2, 'اثنان اثنين اثنتان اثنتين'],
  [3, 'ثلاث ثلاثة'], [4, 'اربع اربعة'], [5, 'خمس خمسة'], [6, 'ست ستة'],
  [7, 'سبع سبعة'], [8, 'ثمان ثماني ثمانية'], [9, 'تسع تسعة'], [10, 'عشر عشرة'],
  [11, 'احدعشر احدىعشرة'], [12, 'اثناعشر اثنيعشر اثنتاعشرة اثنتيعشرة'],
  [13, 'ثلاثةعشر ثلاثعشرة'], [14, 'اربعةعشر اربععشرة'], [15, 'خمسةعشر خمسعشرة'],
  [16, 'ستةعشر ستعشرة'], [17, 'سبعةعشر سبععشرة'], [18, 'ثمانيةعشر ثمانيعشرة'], [19, 'تسعةعشر تسععشرة'],
  [20, 'عشرون عشرين'], [30, 'ثلاثون ثلاثين'], [40, 'اربعون اربعين'], [50, 'خمسون خمسين'],
  [60, 'ستون ستين'], [70, 'سبعون سبعين'], [80, 'ثمانون ثمانين'], [90, 'تسعون تسعين'],
  [100, 'مئة مائة'], [200, 'مئتان مائتان مئتين مائتين'], [300, 'ثلاثمئة ثلاثمائة'],
  [400, 'اربعمئة اربعمائة'], [500, 'خمسمئة خمسمائة'], [600, 'ستمئة ستمائة'],
  [700, 'سبعمئة سبعمائة'], [800, 'ثمانمئة ثمانمائة ثمانيمئة ثمانيمائة'], [900, 'تسعمئة تسعمائة'],
  [1000, 'الف'], [2000, 'الفان الفين'], [1000000, 'مليون'],
]) for (const form of forms.split(' ')) numberWords.set(arabicNormalize(form), n);

function writtenNumber(value) {
  const s = arabicNormalize(value).replace(/\s/g, '');
  if (numberWords.has(s)) return numberWords.get(s);
  // Unambiguous additive compounds: واحد وعشرون، مئتان وستة، ألف وثلاثة.
  for (const [word, n] of numberWords) {
    if (n >= 100 && s.startsWith(`${word}و`)) {
      const rest = writtenNumber(s.slice(word.length + 1));
      if (rest !== null && rest > 0 && rest < (n >= 1000 ? 1000 : 100)) return n + rest;
    }
    if (n >= 20 && n <= 90 && s.endsWith(`و${word}`)) {
      const first = numberWords.get(s.slice(0, -(word.length + 1)));
      if (first > 0 && first < 10) return first + n;
    }
  }
  return null;
}

// Numeric signs and decimals must survive normalization; written Arabic numbers
// also merge when they are WRONG answers, not just when listed as truth aliases.
export function numericValue(text) {
  const s = String(text).trim().replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x6f0)).replace(/٫/g, '.').replace(/٬/g, '');
  if (/^[+-]?\d+(?:\.\d+)?$/.test(s)) {
    const n = Number(s); return Number.isFinite(n) ? n : null;
  }
  if (!/^[\p{Script=Arabic}\s]+$/u.test(s)) return null;
  const negative = /^(سالب|ناقص)\s/.test(s);
  const n = writtenNumber(s.replace(/^(سالب|ناقص)\s+/, ''));
  return n === null ? null : n * (negative ? -1 : 1);
}
export function sameAnswer(a, b) {
  const x = numericValue(a), y = numericValue(b);
  if (x !== null || y !== null) return x !== null && y !== null && x === y;
  const n = arabicNormalizeLoose(a);
  return Boolean(n) && n === arabicNormalizeLoose(b);
}
export function matchesTruth(text, question) { return [question.answer, ...(question.aliases || [])].some((answer) => sameAnswer(text, answer)); }

export function initialState(players, options, { deck = [], seed = 1, sessionId = `fab-${Date.now()}` } = {}) {
  if (!Array.isArray(players) || players.length < 3 || players.length > 8 || players.some((p) => !validId(p.id) || typeof p.name !== 'string' || !p.name.trim() || p.name.length > 40 || (p.emoji !== undefined && (typeof p.emoji !== 'string' || p.emoji.length > 32)) || (p.color !== undefined && (typeof p.color !== 'string' || p.color.length > 80))) || new Set(players.map((p) => p.id)).size !== players.length) throw new Error('فبركة تحتاج 3–8 لاعبين مختلفين');
  const o = normalizeOptions(options);
  return {
    schemaVersion: SESSION_VERSION, sessionId, seed, settings: o,
    rounds: o.mode === 'friends' ? players.length * o.friendCycles : o.rounds,
    players: players.map(({ id, name, emoji, color }) => ({ id, name, emoji, color })),
    deck, deckCursor: 0, usedQuestions: [], usedFacts: [],
    scores: Object.fromEntries(players.map((p) => [p.id, 0])),
    stats: Object.fromEntries(players.map((p) => [p.id, { truths: 0, fooled: 0, laughs: 0 }])),
    helpUsed: [], history: [], round: 1, phase: 'intro', paused: false,
    question: null, hostId: null, order: [], writer: 0, voter: 0,
    lies: [], options: [], votes: {}, funnyVotes: {}, truthWriters: [],
    ready: false, draft: '', aliasesDraft: '', assisted: false, remaining: o.writeSeconds,
    revealGroups: [], revealIndex: 0, revealed: false, roundScores: {}, breakdown: {},
  };
}

export function currentWriter(state) { return state.players.find((p) => p.id === state.order[state.writer]); }
export function currentVoter(state) { return state.players.find((p) => p.id === state.order[state.voter]); }
export function currentHost(state) { return state.players.find((p) => p.id === state.hostId); }
export function currentActor(state) { return state.phase === 'host' ? currentHost(state) : state.phase === 'write' ? currentWriter(state) : state.phase === 'vote' ? currentVoter(state) : null; }
export function turnKey(state) { return `${state.round}:${state.phase}:${currentActor(state)?.id || ''}:${state.revealIndex}:${state.revealed}`; }
export const isSecret = (state) => SECRET_PHASES.includes(state.phase);
export const multiplier = (state) => state.settings.finalDouble && state.round === state.rounds ? 2 : 1;

function begin(state) {
  const raw = state.deck[state.deckCursor];
  if (!raw) return { ...state, phase: 'over' };
  const hostId = state.settings.mode === 'friends' ? state.players[(state.round - 1) % state.players.length].id : null;
  const start = (state.round - 1 + (hostId ? 1 : 0)) % state.players.length;
  const order = Array.from({ length: state.players.length }, (_, i) => state.players[(start + i) % state.players.length].id).filter((id) => id !== hostId);
  const question = hostId ? { ...raw, text: raw.text.replace('{name}', state.players.find((p) => p.id === hostId).name), answer: '', aliases: [] } : raw;
  return { ...state, question, hostId, order, deckCursor: state.deckCursor + 1,
    usedQuestions: [...state.usedQuestions, raw.id], usedFacts: [...state.usedFacts, factId(raw)],
    phase: hostId ? 'host' : 'question', ready: false, draft: '', aliasesDraft: '', remaining: state.settings.writeSeconds };
}

function makeOptions(state, lies) {
  const truth = { id: TRUTH_ID, text: state.question.answer, owners: [], earners: [] };
  const groups = [truth];
  for (const lie of lies) {
    if (!lie.text) continue;
    if (matchesTruth(lie.text, state.question)) { truth.owners.push(lie.playerId); continue; }
    let group = groups.slice(1).find((o) => sameAnswer(o.text, lie.text));
    if (!group) { group = { id: `lie-${lie.playerId}`, text: lie.text, owners: [], earners: [] }; groups.push(group); }
    group.owners.push(lie.playerId);
    if (!lie.assisted) group.earners.push(lie.playerId);
  }
  for (const text of state.question.decoys || []) {
    if (groups.length >= 4) break;
    if (matchesTruth(text, state.question) || groups.some((o) => sameAnswer(o.text, text))) continue;
    groups.push({ id: `house-${groups.length}`, text, owners: [], earners: [] });
  }
  return { options: shuffle(groups, mulberry32(state.seed + state.round * 997)), truthWriters: truth.owners };
}

function submitLie(state, text) {
  const player = currentWriter(state);
  const lies = [...state.lies, { playerId: player.id, text, assisted: state.assisted }];
  const cleared = { ...state, lies, ready: false, draft: '', assisted: false, remaining: state.settings.writeSeconds };
  if (state.writer < state.order.length - 1) return { ...cleared, writer: state.writer + 1 };
  return { ...cleared, ...makeOptions(state, lies), voter: 0,
    phase: state.settings.discussionSeconds ? 'discussion' : 'vote', remaining: state.settings.discussionSeconds };
}

export function canVoteFor(state, playerId, optionId) {
  if (!state.order.includes(playerId)) return false;
  if (optionId === null) return true;
  const option = state.options.find((o) => o.id === optionId);
  return Boolean(option) && !option.owners.includes(playerId);
}
export function votersFor(state, optionId, { scoringOnly = false } = {}) {
  return state.players.filter((p) => state.votes[p.id] === optionId && (!scoringOnly || !state.truthWriters.includes(p.id)));
}

function revealGroups(state) {
  const lies = state.options.filter((o) => o.id !== TRUTH_ID);
  const sorted = [...lies].sort((a, b) => votersFor(state, b.id, { scoringOnly: true }).length - votersFor(state, a.id, { scoringOnly: true }).length);
  const finalist = sorted[0];
  const rest = lies.filter((o) => o !== finalist);
  const quiet = rest.filter((o) => !votersFor(state, o.id, { scoringOnly: true }).length);
  const groups = quiet.length ? [quiet.map((o) => o.id)] : [];
  for (const o of rest.filter((o) => !quiet.includes(o))) groups.push([o.id]);
  groups.push(state.options.filter((o) => o.id === TRUTH_ID || o === finalist).map((o) => o.id));
  return groups;
}

export function roundBreakdown(state) {
  const result = Object.fromEntries(state.players.map((p) => [p.id, { truth: 0, fooled: 0, laughs: 0, points: 0, byWriting: false, host: p.id === state.hostId }]));
  for (const id of state.order) {
    const byWriting = state.truthWriters.includes(id);
    if (byWriting || state.votes[id] === TRUTH_ID) { result[id].truth = 1; result[id].byWriting = byWriting; }
  }
  for (const [voter, optionId] of Object.entries(state.votes)) {
    if (!state.order.includes(voter) || state.truthWriters.includes(voter) || optionId === TRUTH_ID) continue;
    const option = state.options.find((o) => o.id === optionId);
    if (option && !option.owners.includes(voter)) for (const id of option.earners) result[id].fooled += 1;
  }
  for (const [voter, optionId] of Object.entries(state.funnyVotes)) {
    const option = state.options.find((o) => o.id === optionId && o.id !== TRUTH_ID);
    if (option && state.order.includes(voter) && !option.owners.includes(voter)) for (const id of option.earners) result[id].laughs += 1;
  }
  for (const row of Object.values(result)) row.points = (row.truth * POINTS_TRUTH + row.fooled * POINTS_FOOLED) * multiplier(state);
  return result;
}
export function scoreRound(state) { return Object.fromEntries(Object.entries(roundBreakdown(state)).map(([id, r]) => [id, r.points])); }

function finishRound(state) {
  const breakdown = roundBreakdown(state), scores = { ...state.scores }, stats = { ...state.stats };
  for (const [id, row] of Object.entries(breakdown)) {
    scores[id] += row.points;
    stats[id] = { truths: stats[id].truths + row.truth, fooled: stats[id].fooled + row.fooled, laughs: stats[id].laughs + row.laughs };
  }
  const highlights = state.options.filter((o) => o.id !== TRUTH_ID && o.earners.length).map((o) => ({ text: o.text, owners: o.earners,
    fooled: votersFor(state, o.id, { scoringOnly: true }).length,
    laughs: Object.values(state.funnyVotes).filter((id) => id === o.id).length,
  }));
  return { ...state, phase: 'roundEnd', scores, stats, breakdown, roundScores: scoreRound(state),
    history: [...state.history, { round: state.round, question: state.question.text, answer: state.question.answer, highlights }] };
}

export function reduce(state, action) {
  if (!action || action.round !== state.round || (action.key && action.key !== turnKey(state))) return state;
  if (action.type === 'PAUSE') return state.phase === 'over' ? state : { ...state, paused: true, ready: false };
  if (action.type === 'RESUME') return { ...state, paused: false, ready: false };
  if (state.paused) return state;
  const actor = currentActor(state);
  const privateAction = () => actor && actor.id === action.playerId && state.ready;
  switch (action.type) {
    case 'BEGIN': return state.phase === 'intro' ? begin(state) : state;
    case 'READY': return isSecret(state) && actor?.id === action.playerId ? { ...state, ready: true } : state;
    case 'DRAFT':
      if (!['host', 'write'].includes(state.phase) || !privateAction()) return state;
      return { ...state, draft: String(action.text ?? '').slice(0, 60) };
    case 'ALIASES': return state.phase === 'host' && privateAction() ? { ...state, aliasesDraft: String(action.text ?? '').slice(0, 180) } : state;
    case 'SUBMIT_TRUTH': {
      if (state.phase !== 'host' || !privateAction()) return state;
      const check = validateLie(state.draft);
      if (!check.ok) return state;
      const aliases = state.aliasesDraft.split(/[؛;\n]/).map((s) => s.trim()).filter((s) => validateLie(s).ok).slice(0, 3);
      return { ...state, phase: 'question', ready: false, draft: '', aliasesDraft: '',
        question: { ...state.question, answer: check.text, aliases, explanation: `هذه إجابة ${actor.name} عن نفسه في هذه الجولة.` } };
    }
    case 'SKIP_PROMPT': {
      if (state.phase !== 'host' || !privateAction()) return state;
      const replacement = state.deck.slice(Math.max(state.deckCursor, state.rounds)).find((q) => !state.usedFacts.includes(factId(q)));
      if (!replacement) return state;
      const at = state.deck.findIndex((q) => q.id === replacement.id), deck = [...state.deck];
      deck[at] = state.deck[state.deckCursor - 1]; deck[state.deckCursor - 1] = replacement;
      return { ...state, deck, draft: '', aliasesDraft: '', question: { ...replacement, text: replacement.text.replace('{name}', actor.name), answer: '', aliases: [] },
        usedQuestions: [...state.usedQuestions, replacement.id], usedFacts: [...state.usedFacts, factId(replacement)] };
    }
    case 'START_WRITING': return state.phase === 'question' ? { ...state, phase: 'write', ready: false, remaining: state.settings.writeSeconds } : state;
    case 'HELP': {
      if (state.phase !== 'write' || !privateAction() || state.helpUsed.includes(actor.id)) return state;
      const choices = (state.question.decoys || []).filter((text) => !matchesTruth(text, state.question));
      if (!choices.length) return state;
      return { ...state, draft: choices[(state.writer + state.round) % choices.length], assisted: true, helpUsed: [...state.helpUsed, actor.id] };
    }
    case 'SUBMIT_LIE': {
      if (state.phase !== 'write' || !privateAction()) return state;
      const check = validateLie(state.draft);
      return check.ok ? submitLie(state, check.text) : state;
    }
    case 'SKIP_WRITE': return state.phase === 'write' && privateAction() ? submitLie(state, '') : state;
    case 'TICK': {
      if (!((state.phase === 'write' && privateAction() && state.settings.writeSeconds) || (state.phase === 'discussion' && state.settings.discussionSeconds))) return state;
      if (!Number.isInteger(action.remaining) || action.remaining < 0 || action.remaining >= state.remaining) return state;
      return { ...state, remaining: action.remaining };
    }
    case 'TIMEOUT':
      if (state.remaining !== 0) return state;
      if (state.phase === 'write' && privateAction() && state.settings.writeSeconds) return submitLie(state, validateLie(state.draft).ok ? validateLie(state.draft).text : '');
      return state.phase === 'discussion' ? { ...state, phase: 'vote', ready: false, voter: 0 } : state;
    case 'START_VOTE': return state.phase === 'discussion' ? { ...state, phase: 'vote', ready: false, voter: 0 } : state;
    case 'VOTE': {
      if (state.phase !== 'vote' || !privateAction() || !canVoteFor(state, actor.id, action.optionId)) return state;
      const funnyId = action.funnyId ?? null;
      if (funnyId !== null && (!state.settings.funnyVote || !canVoteFor(state, actor.id, funnyId))) return state;
      const next = { ...state, votes: { ...state.votes, [actor.id]: action.optionId }, funnyVotes: { ...state.funnyVotes, [actor.id]: funnyId }, ready: false };
      if (state.voter < state.order.length - 1) return { ...next, voter: state.voter + 1 };
      return { ...next, phase: 'gather', revealGroups: revealGroups(next), revealIndex: 0, revealed: false };
    }
    case 'START_REVEAL': return state.phase === 'gather' ? { ...state, phase: 'reveal' } : state;
    case 'REVEAL': return state.phase === 'reveal' && !state.revealed ? { ...state, revealed: true } : state;
    case 'REVEAL_NEXT':
      if (state.phase !== 'reveal' || !state.revealed) return state;
      return state.revealIndex + 1 < state.revealGroups.length ? { ...state, revealIndex: state.revealIndex + 1, revealed: false } : finishRound(state);
    case 'NEXT_ROUND': {
      if (state.phase !== 'roundEnd') return state;
      if (state.round >= state.rounds) return { ...state, phase: 'over' };
      return { ...state, round: state.round + 1, phase: 'intro', question: null, hostId: null, order: [], writer: 0, voter: 0,
        lies: [], options: [], votes: {}, funnyVotes: {}, truthWriters: [], ready: false, draft: '', aliasesDraft: '', assisted: false,
        revealGroups: [], revealIndex: 0, revealed: false, roundScores: {}, breakdown: {}, remaining: state.settings.writeSeconds };
    }
    default: return state;
  }
}

export function standings(state) { return state.players.map((p) => ({ ...p, score: state.scores[p.id], ...state.stats[p.id] })).sort((a, b) => b.score - a.score); }
export function awards(state) {
  return [['fooled', 'خبير الفبركة', '🎭'], ['truths', 'كاشف الحقيقة', '🔎'], ['laughs', 'نجم الضحك', '😂']].map(([stat, title, emoji]) => {
    const best = Math.max(...state.players.map((p) => state.stats[p.id][stat]));
    return { stat, title, emoji, value: best, players: best ? state.players.filter((p) => state.stats[p.id][stat] === best) : [] };
  }).filter((a) => a.value > 0);
}
export function bestLies(state) {
  const all = state.history.flatMap((r) => r.highlights.map((h) => ({ ...h, question: r.question, round: r.round })))
    .filter((h) => h.fooled || h.laughs).sort((a, b) => b.fooled - a.fooled || b.laughs - a.laughs);
  const top = all.slice(0, 3), funniest = [...all].sort((a, b) => b.laughs - a.laughs)[0];
  if (funniest?.laughs && !top.includes(funniest)) top[top.length - 1] = funniest;
  return top;
}

// Validate old/corrupt snapshots and always return to a closed privacy gate.
export function restoreSession(raw, { includeOver = false } = {}) {
  try {
    if (!raw || raw.schemaVersion !== SESSION_VERSION || !PHASES.includes(raw.phase) || (!includeOver && raw.phase === 'over')) return null;
    const players = raw.players; initialState(players, raw.settings);
    if (!Object.entries(normalizeOptions(raw.settings)).every(([k, v]) => JSON.stringify(raw.settings[k]) === JSON.stringify(v))) return null;
    if (typeof raw.sessionId !== 'string' || raw.sessionId.length > 120 || !['ready', 'paused', 'assisted', 'revealed'].every((k) => typeof raw[k] === 'boolean')) return null;
    if (!Number.isInteger(raw.round) || raw.round < 1 || raw.round > raw.rounds || raw.rounds !== (raw.settings.mode === 'friends' ? players.length * raw.settings.friendCycles : raw.settings.rounds)) return null;
    const ids = players.map((p) => p.id), list = (v) => Array.isArray(v) && v.every((id) => ids.includes(id));
    if (!list(raw.order) || new Set(raw.order).size !== raw.order.length || !list(raw.helpUsed) || !list(raw.truthWriters)) return null;
    if (!Array.isArray(raw.deck) || raw.deck.length < raw.rounds || raw.deck.length > 200 || !Number.isInteger(raw.deckCursor) || raw.deckCursor < 0 || raw.deckCursor > raw.deck.length) return null;
    const qOK = (q, empty = false) => q && typeof q.id === 'string' && typeof q.text === 'string' && q.text.split('___').length === 2 && (empty || validateLie(q.answer).ok) && Array.isArray(q.decoys) && q.decoys.length >= 3 && q.decoys.every((d) => validateLie(d).ok) && (!q.aliases || (Array.isArray(q.aliases) && q.aliases.every((a) => validateLie(a).ok)));
    if (!raw.deck.every((q) => qOK(q, raw.settings.mode === 'friends'))) return null;
    if (!['intro', 'over'].includes(raw.phase) && !qOK(raw.question, raw.phase === 'host')) return null;
    if (!Number.isInteger(raw.seed) || !Number.isInteger(raw.remaining) || raw.remaining < 0 || raw.remaining > 60) return null;
    if (typeof raw.draft !== 'string' || raw.draft.length > 60 || typeof raw.aliasesDraft !== 'string' || raw.aliasesDraft.length > 180) return null;
    if (!Array.isArray(raw.usedFacts) || !Array.isArray(raw.usedQuestions) || !raw.usedFacts.every((id) => typeof id === 'string') || !raw.usedQuestions.every((id) => typeof id === 'string')) return null;
    if (raw.hostId !== null && !ids.includes(raw.hostId)) return null;
    if (raw.hostId && raw.order.includes(raw.hostId)) return null;
    if (!['intro', 'over'].includes(raw.phase) && raw.hostId !== (raw.settings.mode === 'friends' ? players[(raw.round - 1) % players.length].id : null)) return null;
    if (!['intro', 'over'].includes(raw.phase) && raw.order.length !== players.length - (raw.hostId ? 1 : 0)) return null;
    if (!Number.isInteger(raw.writer) || !Number.isInteger(raw.voter) || raw.writer < 0 || raw.voter < 0 || (raw.order.length && (raw.writer >= raw.order.length || raw.voter >= raw.order.length))) return null;
    for (const id of ids) {
      if (!Number.isSafeInteger(raw.scores[id]) || raw.scores[id] < 0) return null;
      if (!['truths', 'fooled', 'laughs'].every((key) => Number.isSafeInteger(raw.stats[id][key]) && raw.stats[id][key] >= 0)) return null;
    }
    if (!Array.isArray(raw.lies) || new Set(raw.lies.map((l) => l.playerId)).size !== raw.lies.length || !raw.lies.every((l) => raw.order.includes(l.playerId) && typeof l.assisted === 'boolean' && typeof l.text === 'string' && l.text.length <= 60)) return null;
    if (!Array.isArray(raw.options) || new Set(raw.options.map((o) => o.id)).size !== raw.options.length || !raw.options.every((o) => typeof o.id === 'string' && validateLie(o.text).ok && list(o.owners) && list(o.earners) && o.earners.every((id) => o.owners.includes(id)))) return null;
    if (['discussion', 'vote', 'gather', 'reveal', 'roundEnd', 'over'].includes(raw.phase) && raw.question && raw.options.filter((o) => o.id === TRUTH_ID).length !== 1) return null;
    for (const ballot of [raw.votes, raw.funnyVotes]) {
      if (!ballot || typeof ballot !== 'object' || Array.isArray(ballot) || !Object.entries(ballot).every(([id, choice]) => canVoteFor(raw, id, choice))) return null;
    }
    if (!Array.isArray(raw.revealGroups) || !raw.revealGroups.every((g) => Array.isArray(g) && g.length && g.every((id) => raw.options.some((o) => o.id === id)))) return null;
    if (['gather', 'reveal', 'roundEnd'].includes(raw.phase)) {
      const flat = raw.revealGroups.flat();
      if (flat.length !== raw.options.length || new Set(flat).size !== flat.length || !raw.revealGroups[raw.revealIndex]) return null;
    }
    if (!Number.isInteger(raw.revealIndex) || raw.revealIndex < 0) return null;
    if (!Array.isArray(raw.history) || raw.history.length > raw.rounds || !raw.history.every((h) => typeof h.question === 'string' && typeof h.answer === 'string' && Array.isArray(h.highlights) && h.highlights.every((x) => typeof x.text === 'string' && list(x.owners) && Number.isInteger(x.fooled) && Number.isInteger(x.laughs)))) return null;
    if (raw.history.length !== (['roundEnd', 'over'].includes(raw.phase) ? raw.round : raw.round - 1)) return null;
    if (raw.phase === 'roundEnd' && (!raw.breakdown || !ids.every((id) => raw.breakdown[id] && ['truth', 'fooled', 'laughs', 'points'].every((k) => Number.isSafeInteger(raw.breakdown[id][k]) && raw.breakdown[id][k] >= 0) && Number.isSafeInteger(raw.roundScores[id])))) return null;
    return { ...JSON.parse(JSON.stringify(raw)), settings: normalizeOptions(raw.settings), paused: false, ready: false };
  } catch { return null; }
}

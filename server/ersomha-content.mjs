// Private, server-only word bank. Never import this module from src/ or a web
// build entry point: the answer, alternatives and drawability clues are secrets.
import animals from './data/ersomha/animals.mjs';
import nature from './data/ersomha/nature.mjs';
import food from './data/ersomha/food.mjs';
import home from './data/ersomha/home.mjs';
import places from './data/ersomha/places.mjs';
import jobs from './data/ersomha/jobs.mjs';
import sports from './data/ersomha/sports.mjs';
import transport from './data/ersomha/transport.mjs';
import technology from './data/ersomha/technology.mjs';
import actions from './data/ersomha/actions.mjs';
import situations from './data/ersomha/situations.mjs';
import expressions from './data/ersomha/expressions.mjs';
import { arabicNormalizeLoose } from '../src/shared/lib/arabicNormalize.js';
export { ERSOMHA_CATEGORIES } from '../src/online/shared.js';

export const ERSOMHA_BANK_VERSION = 1;
export const ERSOMHA_BANK = Object.freeze([animals, nature, food, home, places, jobs, sports,
  transport, technology, actions, situations, expressions].flatMap((category) => category.entries));

// Exact comparison after the established Arabic orthographic normalization.
// Deliberately no substring, stemming, word reordering, or fuzzy edit distance.
export function normalizeErsomhaGuess(value) {
  return typeof value === 'string' && value.length <= 160 ? arabicNormalizeLoose(value) : '';
}
export function matchesErsomhaAnswer(value, card) {
  const guess = normalizeErsomhaGuess(value);
  return Boolean(guess && card && [card.answer, ...(card.aliases || [])]
    .some((answer) => normalizeErsomhaGuess(answer) === guess));
}

export function getErsomhaPool({ categories = [], difficulty = 'easy' } = {}) {
  const selected = new Set(Array.isArray(categories) ? categories : []);
  return ERSOMHA_BANK.filter((entry) => entry.difficulty === difficulty && (!selected.size || selected.has(entry.category)));
}

function secureRandom() {
  return crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296;
}
function index(length, random) {
  const value = Number(random());
  if (!Number.isFinite(value) || value < 0 || value >= 1) throw new RangeError('random must return a number in [0, 1)');
  return Math.floor(value * length);
}
function shuffled(values, random) {
  const out = [...values];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = index(i + 1, random);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
function privateCard(entry) {
  const { id, conceptId, familyId, answer, aliases, category, difficulty } = entry;
  return { id, conceptId, familyId, answer, aliases: [...aliases], category, difficulty };
}

// Exhaustion is explicit: fewer than count eligible categories returns [] and
// never silently recycles an exposed concept or changes the selected tier.
export function buildErsomhaChoices({ categories = [], difficulty = 'easy', excludedConceptIds = [],
  excludedFamilyIds = [], random = secureRandom, count = 3 } = {}) {
  if (!Number.isInteger(count) || count < 1 || count > 3) return [];
  const concepts = new Set(excludedConceptIds), families = new Set(excludedFamilyIds);
  const pool = getErsomhaPool({ categories, difficulty }).filter((entry) => !concepts.has(entry.conceptId) && !families.has(entry.familyId));
  const buckets = new Map();
  for (const entry of pool) {
    if (!buckets.has(entry.category)) buckets.set(entry.category, []);
    buckets.get(entry.category).push(entry);
  }
  if (buckets.size < count) return [];
  // At exhaustion, a greedy first category/family may mask a valid assignment.
  // Search only one randomly selected representative per family per category;
  // count <= 3 bounds this search and preserves category/family diversity.
  const options = shuffled([...buckets.values()], random).map((entries) => {
    const byFamily = new Map();
    for (const entry of shuffled(entries, random)) if (!byFamily.has(entry.familyId)) byFamily.set(entry.familyId, entry);
    return [...byFamily.values()];
  });
  const choose = (start, chosen) => {
    if (chosen.length === count) return chosen;
    for (let i = start; i <= options.length - (count - chosen.length); i += 1) {
      for (const entry of options[i]) {
        if (chosen.some((other) => other.familyId === entry.familyId)) continue;
        const result = choose(i + 1, [...chosen, entry]);
        if (result) return result;
      }
    }
    return null;
  };
  return (choose(0, []) || []).map(privateCard);
}

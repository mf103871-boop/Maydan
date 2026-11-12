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
import { ENGLISH_ERSOMHA_BANK } from './data/ersomha/english.mjs';
import { ENGLISH_CONCEPT_ARABIC, ENGLISH_CONCEPT_EQUIVALENTS } from './data/ersomha/english-concepts.mjs';
import { LEGACY_ENGLISH_ANSWERS, LEGACY_ENGLISH_ALIASES } from './data/ersomha/legacy-english.mjs';
import { normalizeContentIdentity } from '../src/shared/content-locale.mjs';
export { ERSOMHA_CATEGORIES } from '../src/online/shared.js';

export const ERSOMHA_BANK_VERSION = 1;
export const ERSOMHA_BANK = Object.freeze([animals, nature, food, home, places, jobs, sports,
  transport, technology, actions, situations, expressions].flatMap((category) => category.entries));

// Keep all legacy IDs intact. English renderings of an existing drawable
// concept reuse that concept's original history identity across both languages.
const conceptIndex = new Map();
for (const entry of ERSOMHA_BANK) for (const name of [entry.answer, ...entry.aliases]) {
  const key = arabicNormalizeLoose(name), existing = conceptIndex.get(key) || [];
  if (!existing.includes(entry)) existing.push(entry);
  conceptIndex.set(key, existing);
}
const englishDrafts = ENGLISH_ERSOMHA_BANK.map(entry => {
  const [, , category, tier, ordinal] = entry.id.split('-');
  const crosswalk = ENGLISH_CONCEPT_ARABIC[category]?.[Number(tier)-1]?.split('|');
  if (crosswalk?.length !== 16) throw new Error(`Invalid private English concept crosswalk: ${category}/${tier}`);
  const names = [...crosswalk[Number(ordinal)-1].split(';'), ...(ENGLISH_CONCEPT_EQUIVALENTS[entry.answer] || [])];
  const candidates = names.flatMap(name => conceptIndex.get(arabicNormalizeLoose(name)) || []);
  const legacy = candidates.find(candidate => candidate.category === category) || candidates[0];
  return Object.freeze({ ...entry, ...(legacy ? { conceptId: legacy.conceptId, familyId: legacy.familyId } : {}),
    conceptOrigin: legacy ? 'legacy-ar' : 'new-en' });
});
const translatedLegacy = ERSOMHA_BANK.map(entry => {
  const ordinal=Number(entry.id.split('-').at(-1))-1;
  const answer=LEGACY_ENGLISH_ANSWERS[entry.category]?.[ordinal];
  if(!answer)throw new Error(`Missing private English concept translation: ${entry.id}`);
  return Object.freeze({id:entry.id,conceptId:entry.conceptId,familyId:entry.familyId,
    category:entry.category,difficulty:entry.difficulty,answer,
    aliases:Object.freeze((LEGACY_ENGLISH_ALIASES[answer]||[]).filter(alias=>alias.toLowerCase()!==answer.toLowerCase())),
    contentLocale:'en',conceptOrigin:'legacy-ar',
    review:Object.freeze({language:'translated',drawability:'inherited',independent:'pending'})});
});
const translatedNames = new Set(translatedLegacy.flatMap(entry => [entry.answer,...entry.aliases].map(value=>value.normalize('NFKC').toLowerCase().trim())));
export const ERSOMHA_ENGLISH_BANK = Object.freeze([...translatedLegacy,
  ...englishDrafts.filter(entry=>entry.conceptOrigin==='new-en'&&!translatedNames.has(entry.answer.normalize('NFKC').toLowerCase().trim())),
  Object.freeze({id:'ers-en-animals-extra-01',conceptId:'ers-en-animals-extra-01',familyId:'ers-en-animals-extra-01',category:'animals',difficulty:'hard',answer:'axolotl',aliases:Object.freeze([]),contentLocale:'en',conceptOrigin:'new-en',review:Object.freeze({language:'translated',drawability:'reviewed',independent:'pending'})})]);

// Exact comparison after the established Arabic orthographic normalization.
// Deliberately no substring, stemming, word reordering, or fuzzy edit distance.
export function normalizeErsomhaGuess(value, contentLocale = 'ar') {
  if (typeof value !== 'string' || value.length > 160) return '';
  if (contentLocale === 'en') return value.normalize('NFKC').toLocaleLowerCase('en').trim().replace(/\s+/gu, ' ');
  return arabicNormalizeLoose(value);
}
export function matchesErsomhaAnswer(value, card, contentLocale = card?.contentLocale || 'ar') {
  const guess = normalizeErsomhaGuess(value, contentLocale);
  return Boolean(guess && card && [card.answer, ...(card.aliases || [])]
    .some((answer) => normalizeErsomhaGuess(answer, contentLocale) === guess));
}

export function getErsomhaPool({ categories = [], difficulty = 'easy', contentLocale = 'ar', contentVersion } = {}) {
  normalizeContentIdentity({ contentLocale, contentVersion });
  const selected = new Set(Array.isArray(categories) ? categories : []);
  const bank = contentLocale === 'en' ? ERSOMHA_ENGLISH_BANK : ERSOMHA_BANK;
  return bank.filter((entry) => entry.difficulty === difficulty && (!selected.size || selected.has(entry.category)));
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
  return { id, conceptId, familyId, answer, aliases: [...aliases], category, difficulty, ...(entry.contentLocale ? { contentLocale: entry.contentLocale } : {}) };
}

// Exhaustion is explicit: fewer than count eligible categories returns [] and
// never silently recycles an exposed concept or changes the selected tier.
export function buildErsomhaChoices({ categories = [], difficulty = 'easy', contentLocale = 'ar', contentVersion, excludedConceptIds = [],
  excludedFamilyIds = [], random = secureRandom, count = 3 } = {}) {
  if (!Number.isInteger(count) || count < 1 || count > 3) return [];
  const concepts = new Set(excludedConceptIds), families = new Set(excludedFamilyIds);
  const pool = getErsomhaPool({ categories, difficulty, contentLocale, contentVersion }).filter((entry) => !concepts.has(entry.conceptId) && !families.has(entry.familyId));
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

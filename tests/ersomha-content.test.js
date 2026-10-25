import test from 'node:test';
import assert from 'node:assert/strict';
import { ERSOMHA_BANK, ERSOMHA_CATEGORIES, buildErsomhaChoices, getErsomhaPool,
  normalizeErsomhaGuess, matchesErsomhaAnswer } from '../server/ersomha-content.mjs';
import { validateErsomhaBank, ersomhaReviewReport, editorialContentSha256 } from '../scripts/ersomha-content.mjs';
import { ERSOMHA_ACCEPTED_OVERLAPS } from '../server/data/ersomha/accepted-answer-overlaps.mjs';
import { ERSOMHA_INDEPENDENT_REVIEW } from '../server/data/ersomha/independent-review.mjs';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { mulberry32 } from '../src/shared/lib/rng.js';

test('private authored bank has 1200 concepts, twelve full categories and editorially assigned global tiers', () => {
  const result = validateErsomhaBank();
  assert.equal(result.ok, true, result.errors.join('\n'));
  assert.equal(result.total, 1200);
  assert.deepEqual(result.tiers, { easy: 360, medium: 600, hard: 240 });
  assert.equal(ERSOMHA_CATEGORIES.length, 12);
  assert.ok(result.relatedFamilies > 30);
  for (const category of Object.values(result.categories)) assert.equal(category.total, 100);
  // Difficulty is authored globally, never padded to an artificial 30/50/20 per pack.
  assert.ok(new Set(Object.values(result.categories).map(c => `${c.easy}/${c.medium}/${c.hard}`)).size > 6);
});

test('every active alternative is accepted and only the two explicitly reviewed homonyms overlap', () => {
  const keys = new Map();
  for (const entry of ERSOMHA_BANK) for (const answer of [entry.answer, ...entry.aliases]) {
    assert.equal(matchesErsomhaAnswer(answer, entry), true, `${entry.id}: ${answer}`);
    const key = normalizeErsomhaGuess(answer);
    const ids = keys.get(key) || []; ids.push(entry.id); keys.set(key, ids);
  }
  const observed = [...keys].filter(([, ids]) => ids.length > 1).map(([normalizedText, conceptIds]) => ({ normalizedText, conceptIds: [...conceptIds].sort() }));
  assert.deepEqual(observed.sort((a,b)=>a.normalizedText.localeCompare(b.normalizedText)),
    ERSOMHA_ACCEPTED_OVERLAPS.map(({normalizedText,conceptIds})=>({normalizedText,conceptIds:[...conceptIds].sort()})).sort((a,b)=>a.normalizedText.localeCompare(b.normalizedText)));
  assert.equal(observed.length, 2);
});

test('Arabic orthography is tolerant while meaning remains exact', () => {
  const umbrella = { answer: 'مظلة', aliases: [] };
  for (const text of ['المِظَلَّة', 'مـظله', '  مَظَلَّة!  ']) assert.ok(matchesErsomhaAnswer(text, umbrella));
  assert.ok(matchesErsomhaAnswer('بطاطس', { answer: 'بطاطا', aliases: ['بطاطس'] }));
  assert.ok(matchesErsomhaAnswer('أَكَلَ', { answer: 'اكل', aliases: [] }));
  assert.equal(matchesErsomhaAnswer('مظلة شمسية', umbrella), false);
  assert.equal(matchesErsomhaAnswer('ظلة', umbrella), false);
  assert.equal(matchesErsomhaAnswer('مضلّة', umbrella), false);
  assert.equal(matchesErsomhaAnswer('طائرة', { answer: 'طائرة ورقية', aliases: [] }), false);
  assert.equal(matchesErsomhaAnswer('ورقية طائرة', { answer: 'طائرة ورقية', aliases: [] }), false);
  for (const input of [null, undefined, {}, 123, '', ' '.repeat(20), 'س'.repeat(161)]) assert.equal(normalizeErsomhaGuess(input), '');
});

test('three choices always come from distinct categories at one exact tier', () => {
  for (const difficulty of ['easy', 'medium', 'hard']) for (let seed = 0; seed < 200; seed += 1) {
    const choices = buildErsomhaChoices({ difficulty, random: mulberry32(seed) });
    assert.equal(choices.length, 3);
    assert.equal(new Set(choices.map((entry) => entry.category)).size, 3);
    assert.equal(new Set(choices.map((entry) => entry.familyId)).size, 3);
    assert.ok(choices.every((entry) => entry.difficulty === difficulty));
    assert.ok(choices.every((entry) => !('visualNote' in entry) && !('review' in entry)));
  }
});

test('settings extra fields do not affect the private pool', () => {
  assert.equal(getErsomhaPool({ difficulty: 'medium', categories: ['animals'], mode: 'classic', drawSeconds: 60 }).length,
    ERSOMHA_BANK.filter(e => e.category === 'animals' && e.difficulty === 'medium').length);
  assert.equal(getErsomhaPool({ difficulty: 'not-a-tier' }).length, 0);
  assert.equal(getErsomhaPool({ categories: ['not-a-category'] }).length, 0);
});

test('account concept and family unions are hard exclusions, including related cross-category prompts', () => {
  const needle = ERSOMHA_BANK.find((entry) => entry.answer === 'نجار');
  const excluded = new Set([needle.familyId]);
  for (let seed = 0; seed < 30; seed += 1) {
    const choices = buildErsomhaChoices({ difficulty: 'easy', excludedFamilyIds: excluded, random: mulberry32(seed) });
    assert.ok(choices.every((entry) => !excluded.has(entry.familyId)));
  }
  const fresh = buildErsomhaChoices({ random: mulberry32(17) });
  const second = buildErsomhaChoices({ excludedConceptIds: fresh.map((entry) => entry.conceptId), random: mulberry32(17) });
  assert.ok(second.every((entry) => !fresh.some((old) => old.conceptId === entry.conceptId)));
});

test('finite bank exhaustion never silently replays or changes difficulty', () => {
  const concepts = new Set(), families = new Set(), random = mulberry32(41);
  for (let turn = 0; turn < 200; turn += 1) {
    const choices = buildErsomhaChoices({ excludedConceptIds: concepts, excludedFamilyIds: families, random });
    if (!choices.length) {
      assert.ok(concepts.size > 200);
      assert.deepEqual(buildErsomhaChoices({ excludedConceptIds: concepts, excludedFamilyIds: families, random }), []);
      return;
    }
    for (const entry of choices) {
      assert.ok(!concepts.has(entry.conceptId) && !families.has(entry.familyId));
      concepts.add(entry.conceptId); families.add(entry.familyId);
    }
  }
  assert.fail('finite easy pool did not exhaust');
});

test('one or two eligible categories cannot masquerade as three choices', () => {
  assert.deepEqual(buildErsomhaChoices({ categories: ['animals', 'food'], random: mulberry32(3) }), []);
  const pool = getErsomhaPool({ difficulty: 'hard' });
  assert.deepEqual(buildErsomhaChoices({ difficulty: 'hard', excludedConceptIds: pool.map((entry) => entry.conceptId) }), []);
});

test('choice cards and pools cannot mutate the source answers or alternatives', () => {
  const choices = buildErsomhaChoices({ random: mulberry32(1) });
  const original = ERSOMHA_BANK.find((entry) => entry.id === choices[0].id);
  choices[0].aliases.push('not-a-real-alias');
  choices[0].answer = 'not-the-answer';
  assert.ok(!original.aliases.includes('not-a-real-alias'));
  assert.notEqual(original.answer, choices[0].answer);
  assert.throws(() => { original.aliases.push('corruption'); }, TypeError);
});

test('validation reports collisions and editorial evidence never claims player testing', () => {
  const corrupt = ERSOMHA_BANK.map((entry) => ({ ...entry, aliases: [...entry.aliases] }));
  corrupt[0].aliases.push(corrupt[1].answer);
  const result = validateErsomhaBank(corrupt);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((message) => message.includes('collision')));
  const report = ersomhaReviewReport();
  assert.equal(report.physicalPlaytest, false);
  assert.equal(report.entries.length, 1200);
  assert.ok(report.entries.every((entry) => /^[a-f0-9]{64}$/.test(entry.contentSha256)));
});

test('all 1200 rows have content-bound independent agent editorial reasons without claiming a player trial', () => {
  assert.deepEqual(Object.keys(ERSOMHA_INDEPENDENT_REVIEW).sort(), ERSOMHA_BANK.map(e=>e.id).sort());
  for (const entry of ERSOMHA_BANK) {
    const audit = ERSOMHA_INDEPENDENT_REVIEW[entry.id];
    assert.equal(entry.review.independent, 'reviewed');
    assert.equal(audit.mode, 'agent-editorial-not-human-playtest');
    assert.equal(audit.reviewer, 'agent-editorial/audit_games_fun_content');
    assert.ok(audit.reason.length > 60, entry.id);
    assert.equal(audit.reviewedContentSha256, editorialContentSha256(entry), entry.id);
  }
  const report = ersomhaReviewReport();
  assert.equal(report.independentEditorialReview.reviewed, 1200);
  assert.equal(report.validation.independentPending, 0);
  assert.equal(report.independentEditorialReview.timedDrawingTrial, false);
  assert.equal(report.independentEditorialReview.playerDifficultyCalibration, false);
  for (const entry of report.entries) {
    assert.ok(!Object.hasOwn(entry, 'answer') && !Object.hasOwn(entry, 'aliases') && !Object.hasOwn(entry, 'visualNote'));
    assert.equal(entry.independentReason, ERSOMHA_INDEPENDENT_REVIEW[entry.id].publicReason);
    assert.ok(!entry.independentReason.includes('القرائن التي راجعتها'));
  }
});

test('a reviewed homonym cannot silently accept a third concept, duplicate alias, or stale rule', () => {
  const clone = () => ERSOMHA_BANK.map(e=>({...e,aliases:[...e.aliases]}));
  const expanded = clone(); expanded[0].aliases.push('مدرسة');
  assert.ok(validateErsomhaBank(expanded).errors.some(e=>e.includes('collision')));
  const duplicate = clone(); const teacher=duplicate.find(e=>e.id==='ers-jobs-003'); teacher.aliases.push('مُدرّسة');
  assert.ok(validateErsomhaBank(duplicate).errors.some(e=>e.includes('collision')));
  const missing = clone(); const cauliflower=missing.find(e=>e.id==='ers-food-046'); cauliflower.aliases=cauliflower.aliases.filter(a=>normalizeErsomhaGuess(a)!=='زهره');
  assert.ok(validateErsomhaBank(missing).errors.some(e=>e.includes('rule is stale')));
});

test('an editorial content edit invalidates the old review fingerprint', () => {
  const modified=ERSOMHA_BANK.map(e=>({...e,aliases:[...e.aliases]}));
  modified[0].visualNote+=' وقرينة جديدة';
  assert.ok(validateErsomhaBank(modified).errors.some(e=>e.includes('independent review is stale')));
});

test('production bank loading keeps the full editorial evidence out of the worker dependency graph', async () => {
  const bundle=await build({ entryPoints:[fileURLToPath(new URL('../server/ersomha-content.mjs',import.meta.url))],
    bundle:true,write:false,metafile:true,platform:'neutral',format:'esm',logLevel:'silent' });
  assert.ok(Object.keys(bundle.metafile.inputs).some(path=>path.endsWith('independent-review-status.mjs')));
  assert.ok(!Object.keys(bundle.metafile.inputs).some(path=>path.endsWith('/independent-review.mjs')));
});

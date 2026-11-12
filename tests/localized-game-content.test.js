import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getGameContent, getCategories, ContentUnavailableError } from '../src/data/game-content.js';
import { buildDeck, duoQuestion, matchesTruth, numericValue, sameAnswer, normalizeOptions, validateLie } from '../src/games/fabraka/logic.js';
import { getFabrakaContent, normalizeContentOptions } from '../src/games/fabraka/content.js';

const games = ['beep', 'mamnoo', 'meenfina', 'jabeen', 'fabraka'];
const source = file => JSON.parse(readFileSync(new URL(`../src/data/games/${file}`, import.meta.url)));
const norm = text => String(text).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const flatten = (game, content) => game === 'jabeen' ? content.flatMap(c => c.items)
  : game === 'fabraka' ? [...content.questions, ...content.pictures, ...content.personal] : content;
function strings(value) {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  return value && typeof value === 'object' ? Object.values(value).flatMap(strings) : [];
}

test('every English party-game pack preserves all approved IDs and contains no Arabic fallback', () => {
  const expected = { beep: 235, mamnoo: 231, meenfina: 190, jabeen: 285, fabraka: 180 };
  for (const game of games) {
    const ar = flatten(game, getGameContent(game));
    const en = flatten(game, getGameContent(game, 'en', 'new-en'));
    assert.equal(en.length, expected[game], game);
    assert.deepEqual(en.map(x => x.id), ar.map(x => x.id), `${game}: preserve content history IDs`);
    assert.equal(new Set(en.map(x => x.id)).size, en.length, game);
    assert.ok(strings(getGameContent(game, 'en')).every(s => !/\p{Script=Arabic}/u.test(s)), `${game}: untranslated string`);
    assert.ok(en.every(x => x.contentLocale === 'en' && x.contentVersion === 'new-en'), game);
    const visible = en.map(x => norm(x.text || x.word));
    assert.ok(visible.every(Boolean), game);
    assert.equal(new Set(visible).size, en.length, `${game}: duplicate prompt`);
  }
});

test('content identity rejects unsupported locales, mismatched versions, and client access to private drawing words', () => {
  assert.throws(() => getGameContent('beep', 'fr'), /CONTENT_LOCALE/);
  assert.throws(() => getGameContent('beep', 'en', 'legacy-ar'), /CONTENT_VERSION/);
  assert.throws(() => getCategories('ar', 'new-en'), /CONTENT_VERSION/);
  assert.throws(() => getGameContent('ersomha', 'en'), ContentUnavailableError);
  assert.throws(() => getGameContent('unknown', 'ar'), ContentUnavailableError);
  assert.strictEqual(getGameContent('beep', 'en'), getGameContent('beep', 'en'));
});

test('English Beep retains difficulty distribution and its letter tasks have playable examples', () => {
  const en = getGameContent('beep', 'en');
  const ar = source('beep/prompts.json');
  assert.ok(en.every(x => x.text.startsWith('Name 3 ') && [1, 2, 3].includes(x.difficulty)));
  assert.deepEqual(en.map(x => x.difficulty), ar.map(x => x.difficulty));
  const examples = {
    'beep-w1-027': ['Banana', 'Blackberry', 'Blueberry'],
    'beep-w1-028': ['Cake', 'Cheese', 'Couscous'],
    'beep-w2-002': ['Ant', 'Alpaca', 'Armadillo'],
    'beep-w2-014': ['Blue', 'Black', 'Brown'],
    'beep-w2-028': ['Parrot', 'Penguin', 'Pelican'],
    'beep-w2-039': ['Green', 'Gray', 'Gold'],
    'beep-w3-026': ['Morocco', 'Mexico', 'Malaysia'],
    'beep-w3-027': ['Berlin', 'Beirut', 'Bangkok'],
    'beep-w3-042': ['Mechanic', 'Musician', 'Meteorologist'],
    'beep-w4-006': ['Book', 'Ball', 'Boat'],
    'beep-w4-011': ['Horse', 'Hedgehog', 'Hippopotamus'],
    'beep-w4-020': ['Zebra', 'Zero', 'Zipper'],
    'beep-w4-025': ['Peach', 'Pear', 'Plum'],
    'beep-w4-026': ['Mazda', 'Maserati', 'Mitsubishi'],
    'beep-w4-030': ['Map', 'Moon', 'Mouse'],
    'beep-w4-036': ['Spoon', 'Spatula', 'Sink'],
    'beep-w4-047': ['Sun', 'Sand', 'Star'],
    'beep-w4-049': ['Pencil', 'Pen', 'Paper'],
    'beep-w4-057': ['Gate', 'Goat', 'Garden'],
    'beep-w4-059': ['Tent', 'Toast', 'Trust'],
  };
  for (const q of en.filter(x => /starting/.test(x.text))) {
    const words = examples[q.id];
    assert.equal(words?.length, 3, q.id);
    const letter = q.text.match(/(?:starting with|starting and ending with) ([A-Z])/)[1];
    assert.ok(words.every(w => w.startsWith(letter)), q.id);
    if (/and ending/.test(q.text)) assert.ok(words.every(w => w.toUpperCase().endsWith(letter)), q.id);
  }
});

test('English Mamnoo has five distinct forbidden clues and every Jabeen category is complete', () => {
  for (const card of getGameContent('mamnoo', 'en')) {
    assert.equal(card.forbidden.length, 5, card.id);
    assert.equal(new Set(card.forbidden.map(norm)).size, 5, card.id);
    assert.ok(card.forbidden.every(x => norm(x) && norm(x) !== norm(card.word)), card.id);
  }
  const categories = getGameContent('jabeen', 'en');
  assert.equal(categories.length, 8);
  for (const c of categories) {
    assert.deepEqual(c.items.map(x => x.id), source(`jabeen/${c.id}.json`).items.map(x => x.id), c.id);
    assert.ok(c.items.length >= 30 && c.name && c.icon, c.id);
  }
});

test('English Fabraka retains neutral images and factual sources, with usable answers, aliases, and decoys', () => {
  const en = getFabrakaContent('en');
  const ar = getFabrakaContent();
  assert.equal(en.questions.length, 100);
  assert.equal(en.pictures.length, 32);
  assert.equal(en.personal.length, 48);
  for (const [key, cards] of Object.entries({ questions: en.questions, pictures: en.pictures, personal: en.personal })) {
    for (const [i, q] of cards.entries()) {
      assert.equal(q.text.split('___').length, 2, q.id);
      assert.equal(q.factId, ar[key][i].factId, q.id);
      for (const text of [...q.aliases, ...q.decoys]) assert.ok(validateLie(text, 'en').ok, `${q.id}: ${text}`);
      assert.equal(new Set(q.decoys.map(norm)).size, q.decoys.length, q.id);
      if (key === 'personal') {
        assert.equal(q.answer, '');
        assert.equal(q.text.split('{name}').length, 2, q.id);
        assert.equal(q.decoys.length, 8, q.id);
      } else {
        assert.ok(validateLie(q.answer, 'en').ok, q.id);
        assert.equal(q.sourceUrl, ar[key][i].sourceUrl, q.id);
        assert.ok(!norm(q.text).includes(norm(q.answer)), `${q.id}: answer exposed in prompt`);
        assert.ok(q.aliases.every(a => matchesTruth(a, q)), q.id);
        assert.ok(q.decoys.every(d => !matchesTruth(d, q)), `${q.id}: decoy matches truth`);
        assert.ok(duoQuestion(q), `${q.id}: insufficient unique decoys`);
      }
      if (key === 'pictures') {
        assert.equal(q.image, ar[key][i].image, q.id);
        assert.equal(q.illustration, ar[key][i].illustration, q.id);
        assert.ok(q.imageDescription && q.imageCredit, q.id);
      }
    }
  }
  for (const mode of ['classic', 'mixed', 'pictures']) for (const rounds of [3, 5, 7]) {
    assert.equal(buildDeck({ ...en, options: { mode, rounds, contentLocale: 'en' } }).length, rounds, mode);
  }
  for (const category of en.categories) {
    assert.ok(en.categoryCounts[category].all > 0, category);
    const options = normalizeContentOptions({ categories: [category], style: 'all', contentLocale: 'en' });
    assert.deepEqual(options.categories, [category]);
    assert.equal(options.contentVersion, 'new-en');
  }
});

test('English number matching merges equivalent guesses without changing Arabic behavior or signs', () => {
  for (const [words, n] of [['two', 2], ['twelve', 12], ['twenty-one', 21], ['one hundred and two', 102], ['two thousand three hundred forty-five', 2345], ['one million', 1000000], ['negative five', -5], ['1,000', 1000]]) {
    assert.equal(numericValue(words, 'en'), n, words);
    assert.ok(sameAnswer(words, String(n), 'en'), words);
  }
  for (const invalid of ['one two', 'twenty thirteen', 'one hundred and', 'one thousand and', 'minus -5', '1,5']) assert.equal(numericValue(invalid, 'en'), null, invalid);
  assert.equal(sameAnswer('minus two', '2', 'en'), false);
  assert.equal(sameAnswer('1.5', '15', 'en'), false);
  assert.ok(sameAnswer('اثنا عشر', '١٢'));
  assert.ok(sameAnswer('ناقص خمسة', '-5'));
  assert.ok(matchesTruth('two', { answer: '2', aliases: [], contentLocale: 'en' }));
  assert.ok(!matchesTruth('two', { answer: '2', aliases: [] }));
  assert.ok(!Object.hasOwn(normalizeOptions({ rounds: 3 }), 'contentLocale'), 'legacy saved settings remain unchanged');
  assert.equal(normalizeOptions({ contentLocale: 'en' }).contentVersion, 'new-en');
});

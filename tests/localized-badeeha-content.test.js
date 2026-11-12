import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getCategories, getGameContent } from '../src/data/game-content.js';
import { arabicNormalize } from '../src/shared/lib/arabicNormalize.js';
import logic, { BANK_CONTENT_VERSION } from '../src/games/badeeha/logic.js';
import { betaTeam } from '../src/games/badeeha/teams.js';
import { stampContentIdentity, readSavedContentIdentity } from '../src/shared/lib/content-storage.js';
import { ENGLISH_TITLES, titleFor } from '../src/games/meenfina/logic.js';

const en = getCategories('en');
const ar = getCategories('ar');
const displayFields = ['q', 'a', 'alt', 'topic', 'options', 'items', 'hints', 'hint'];
const stableFields = ['p', 'type', 'difficultyTarget', 'verified', 'verifiedAt', 'sourceUrl', 'source', 'verification', 'effect', 'target', 'grid', 'spot', 'origin'];
const hasArabic = value => /[\u0600-\u06ff]/u.test(JSON.stringify(value));

test('English Badeeha contains every approved category and question, preserving sources, assets, and difficulty tiers', () => {
  assert.equal(en.length, 78);
  assert.equal(en.flatMap(c => c.qs).length, 3120);
  assert.deepEqual(en.map(c => c.id), ar.map(c => c.id));
  const qids = new Set();
  for (let c = 0; c < en.length; c++) {
    const pack = en[c], original = ar[c];
    assert.equal(pack.qs.length, 40, pack.id);
    assert.equal(pack.icon, original.icon, pack.id);
    assert.equal(pack.defaultType, original.defaultType, pack.id);
    assert.equal(pack.contentLocale, 'en');
    for (const points of [200, 400, 600, 800, 1000]) assert.equal(pack.qs.filter(q => q.p === points).length, 8, pack.id);
    for (let i = 0; i < pack.qs.length; i++) {
      const q = pack.qs[i], source = original.qs[i];
      for (const key of stableFields) assert.deepEqual(q[key], source[key], `${q.qid}/${key}`);
      assert.equal(q.sourceId || q.qid, source.qid, `${q.qid}/source identity`);
      assert.ok(!qids.has(q.qid), q.qid); qids.add(q.qid);
      assert.equal(q.contentLocale, 'en'); assert.equal(q.contentVersion, 'new-en');
      if (q.media) {
        const assets = Array.isArray(q.media) ? q.media : [q.media];
        const oldAssets = Array.isArray(source.media) ? source.media : [source.media];
        assert.equal(assets.length, oldAssets.length, q.qid);
        assets.forEach((asset, at) => {
          const { title: _title, disclosure: _disclosure, ...media } = asset;
          const { title: _oldTitle, disclosure: _oldDisclosure, ...oldMedia } = oldAssets[at];
          assert.deepEqual(media, oldMedia, `${q.qid}/media provenance and paths`);
          assert.ok(!hasArabic(asset.title), q.qid);
          assert.ok(!hasArabic(asset.disclosure), q.qid);
        });
      }
    }
  }
});

test('45 adapted English challenges have independent identities and the remaining 3075 retain their equivalent Arabic identity', () => {
  const expectedSources = new Set([
    ...ar.find(c => c.id === 'code').qs.map(q => q.qid),
    ...[0, 8, 16, 24].map(i => ar.find(c => c.id === 'puzzles').qs[i].qid),
    ar.find(c => c.id === 'emoji').qs[17].qid,
  ]);
  const arabicIds = new Set(ar.flatMap(c => c.qs.map(q => q.qid)));
  let unchanged = 0;
  const adaptedSources = new Set();
  for (const category of en) for (const q of category.qs) {
    if (q.sourceId) {
      assert.ok(expectedSources.has(q.sourceId), `${q.qid}/approved adaptation`);
      assert.equal(q.qid, `${q.sourceId}-en-v1`);
      assert.ok(!arabicIds.has(q.qid), `${q.qid}/independent identity`);
      assert.ok(!adaptedSources.has(q.sourceId)); adaptedSources.add(q.sourceId);
      assert.equal(q.adaptation.sourceLocale, 'ar');
      assert.ok(q.adaptation.reason.length > 40 && !hasArabic(q.adaptation.reason));
      assert.ok(['english-wordplay', 'english-proverb'].includes(q.adaptation.kind));
    } else {
      unchanged++;
      assert.ok(arabicIds.has(q.qid));
      assert.equal(q.adaptation, undefined);
    }
  }
  assert.deepEqual(adaptedSources, expectedSources);
  assert.equal(adaptedSources.size, 45);
  assert.equal(unchanged, 3075);
});

test('all English display fields are localized, aliases are usable, and repeated media prompts identify different content', () => {
  for (const pack of en) {
    assert.ok(pack.name.trim() && !hasArabic(pack.name), pack.id);
    const identities = new Set();
    for (const q of pack.qs) {
      for (const key of displayFields) if (q[key] !== undefined) assert.ok(!hasArabic(q[key]), `${q.qid}/${key}`);
      assert.ok(typeof q.a === 'string' && q.a.trim(), q.qid);
      assert.ok(q.type === 'grid' || q.q.trim(), q.qid);
      const aliases = [q.a, ...q.alt].map(arabicNormalize);
      assert.equal(new Set(aliases).size, aliases.length, `${q.qid}/duplicate alias`);
      const identity = JSON.stringify([arabicNormalize(q.q), q.media || q.grid || null]);
      assert.ok(!identities.has(identity), `${q.qid}/duplicate playable question`); identities.add(identity);
      if (q.options) {
        assert.equal(new Set(q.options.map(arabicNormalize)).size, q.options.length, q.qid);
        assert.equal(q.options.filter(option => arabicNormalize(option) === arabicNormalize(q.a)).length, 1, q.qid);
      }
    }
  }
});

test('all 78 English packs build and restore complete rounds in all modes and round sizes', () => {
  for (let offset = 0; offset < en.length; offset += 6) {
    const selectedCategories = en.slice(offset, offset + 6).map(c => c.id);
    for (const mode of Object.values(logic.MODES)) for (const roundSize of logic.ROUND_SIZES) {
      const deck = logic.buildDeck(en, selectedCategories, {}, mode.tiers, roundSize, () => 0.37);
      const questions = Object.values(deck).flat();
      assert.equal(questions.length, roundSize);
      assert.equal(new Set(questions.map(q => q.qid)).size, roundSize);
      assert.ok(questions.every(q => q.contentLocale === 'en' && mode.tiers.includes(q.p)));
      const session = stampContentIdentity({ version: 2, contentVersion: BANK_CONTENT_VERSION,
        teams: [betaTeam(0, 'Teal'), betaTeam(1, 'Coral')], selectedCategories,
        mode: mode.id, roundSize, deck: logic.deckToIds(deck), screen: 'board' }, { contentLocale: 'en' });
      assert.equal(session.contentVersion, BANK_CONTENT_VERSION);
      assert.deepEqual(readSavedContentIdentity(session), { contentLocale: 'en', contentVersion: 'new-en' });
      assert.ok(logic.isValidSession(en, session));
      assert.deepEqual(logic.idsToDeck(en, session.deck), deck);
    }
  }
});

test('all forty English codes independently decode to their answer under the displayed rule', () => {
  const letters = value => value.replace(/[^A-Z]/g, '').split('');
  const swapPairs = input => input.map((_, i) => input[i % 2 ? i - 1 : i + 1] ?? input[i]);
  for (const q of en.find(c => c.id === 'code').qs) {
    let decoded, chars = letters(q.q);
    if (q.p === 200) decoded = chars.reverse();
    if (q.p === 400) decoded = chars.filter((_, i) => i % 2 === 0);
    if (q.p === 600) decoded = swapPairs(chars).reverse();
    if (q.p === 800) {
      const [left, right] = q.q.split('/').map(letters);
      decoded = [];
      for (let i = 0; i < Math.max(left.length, right.length); i++) {
        if (left[i]) decoded.push(left[i]); if (right[i]) decoded.push(right[i]);
      }
      decoded.reverse();
    }
    if (q.p === 1000) decoded = chars.reverse().map(letter => String.fromCharCode((letter.charCodeAt(0) - 65 + 25) % 26 + 65));
    assert.equal(decoded.join(''), q.a.toUpperCase(), q.qid);
    assert.equal(q.dir, 'ltr', q.qid);
    assert.ok(q.hint && !q.hint.toLowerCase().includes(q.a.toLowerCase()), q.qid);
  }
});

test('English grids, three-clue questions, common-ground items, and adapted word puzzles remain playable', () => {
  for (const q of en.find(c => c.id === 'hidden').qs) {
    const locations = q.grid.flatMap((row, y) => row.flatMap((cell, x) => cell === q.target ? [[y + 1, x + 1]] : []));
    assert.equal(locations.length, 1, q.qid);
    assert.equal(q.a, `Row ${locations[0][0]}, column ${locations[0][1]} from the left`, q.qid);
  }
  for (const q of en.find(c => c.id === 'hints').qs) {
    assert.equal(q.hints.length, 3); assert.equal(new Set(q.hints).size, 3);
    assert.ok(q.hints.every(hint => !hint.toLowerCase().includes(q.a.toLowerCase())), q.qid);
  }
  for (const q of en.find(c => c.id === 'commonbond').qs) {
    assert.equal(q.items.length, 3); assert.equal(new Set(q.items).size, 3);
  }
  const puzzles = en.find(c => c.id === 'puzzles').qs;
  assert.equal([...('POTS')].reverse().join('') + 'S', puzzles[0].a.toUpperCase());
  const removed = 'TMEAX'.slice(0, -1);
  assert.equal(removed.slice(1) + removed[0], puzzles[8].a.toUpperCase());
  assert.equal([...('NPPO')].map(c => String.fromCharCode(c.charCodeAt(0) - 1)).join(''), puzzles[16].a.toUpperCase());
  assert.equal(String.fromCharCode(90 - ('G'.charCodeAt(0) - 65)), puzzles[24].a);
  assert.match(en.find(c => c.id === 'emoji').qs[17].q, /×2/);
  assert.match(en.find(c => c.id === 'emoji').qs[38].hint, /2024/);
});

test('every English Meenfina tag awards a real English title, including after the last statement is cleared', () => {
  const statements = getGameContent('meenfina', 'en');
  assert.deepEqual(new Set(statements.map(s => s.tag)), new Set(Object.keys(ENGLISH_TITLES)));
  for (const statement of statements) {
    const state = { contentLocale: 'en', statement: null, tags: { player: { [statement.tag]: 1 } } };
    assert.equal(titleFor(state, 'player'), ENGLISH_TITLES[statement.tag]);
    assert.ok(!hasArabic(titleFor(state, 'player')));
  }
});

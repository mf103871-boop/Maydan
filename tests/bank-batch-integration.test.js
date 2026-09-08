import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CATS } from '../src/data/categories/index.js';
import logic from '../src/games/badeeha/logic.js';
import { seeded } from './helpers.js';

const batchIds = ['arabliterature', 'beforeafter', 'commonbond', 'hidden', 'quran', 'movies', 'onepiece', 'dragonball', 'worldcup'];
const stableFillers = ['general', 'geo', 'science', 'animals', 'history'];

test('دفعة البنك: كل حزمة جديدة أو مستكملة قابلة للعب والحفظ في جميع الأوضاع والأحجام', () => {
  for (const id of batchIds) {
    assert.ok(CATS.some(c => c.id === id), `فئة غير مسجلة: ${id}`);
    const selected = [id, ...stableFillers];
    for (const [mode, spec] of Object.entries(logic.MODES)) {
      for (const size of logic.ROUND_SIZES) {
        const deck = logic.buildDeck(CATS, selected, {}, spec.tiers, size, seeded(20260908));
        const questions = Object.values(deck).flat();
        const ids = questions.map(q => q.qid);
        assert.equal(ids.length, size, `${id}/${mode}/${size}`);
        assert.equal(new Set(ids).size, size);
        assert.ok(questions.every(q => spec.tiers.includes(q.p)));
        assert.ok(deck[id].length >= 3, id);
        const saved = logic.deckToIds(deck);
        assert.deepEqual(logic.idsToDeck(CATS, saved), deck);
        assert.equal(logic.isValidSession(CATS, {
          version: 2, teams: [{}, {}], selectedCategories: selected,
          mode, roundSize: size, deck: saved,
        }), true, `${id}/${mode}/${size}`);
      }
    }
  }
});

test('دفعة البنك: الحزم المعرفية المكتوبة من جديد تحتفظ بمراجع كل سؤال', () => {
  for (const id of ['arabliterature', 'beforeafter', 'commonbond', 'quran', 'movies']) {
    const category = CATS.find(c => c.id === id);
    assert.ok(category, id);
    for (const q of category.qs) {
      const sources = q.source ?? q.sourceUrl;
      const list = Array.isArray(sources) ? sources : [sources];
      assert.ok(list.length > 0 && list.every(s => typeof s === 'string' && /https:\/\/\S+/.test(s)), q.qid);
      assert.equal(q.verified, true, q.qid);
    }
  }
});

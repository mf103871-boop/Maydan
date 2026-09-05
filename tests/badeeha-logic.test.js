import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import logic from '../src/games/badeeha/logic.js';
import { seeded } from './helpers.js';

const dir = path.resolve('src/data/categories');
const CATS = readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(path.join(dir, f), 'utf8')));
const six = CATS.slice(0, 6).map((c) => c.id);
const deckIds = (deck) => Object.values(deck).flat().map((q) => q.qid);

test('الأوضاع وأحجام الجولة كما في اللعبة الأصلية', () => {
  assert.deepEqual(Object.keys(logic.MODES), ['family', 'standard', 'expert']);
  assert.deepEqual([...logic.MODES.family.tiers], [200, 400, 600]);
  assert.deepEqual([...logic.MODES.expert.tiers], [200, 400, 600, 800, 1000]);
  assert.deepEqual([...logic.ROUND_SIZES], [20, 30, 60]);
});

test('buildDeck يعطي العدد المطلوب بالضبط بلا تكرار داخل الجولة', () => {
  for (const size of logic.ROUND_SIZES) {
    for (const mode of Object.values(logic.MODES)) {
      const deck = logic.buildDeck(CATS, six, {}, mode.tiers, size, seeded(7));
      const ids = deckIds(deck);
      assert.equal(ids.length, size, `${mode.id}/${size}`);
      assert.equal(new Set(ids).size, size, `تكرار في ${mode.id}/${size}`);
      for (const q of Object.values(deck).flat()) assert.ok(mode.tiers.includes(q.p));
    }
  }
});

test('buildDeck يرفض غير ست فئات أو حجمًا غير مدعوم', () => {
  assert.throws(() => logic.buildDeck(CATS, six.slice(0, 5), {}, logic.MODES.expert.tiers, 30));
  assert.throws(() => logic.buildDeck(CATS, six, {}, logic.MODES.expert.tiers, 25));
  assert.throws(() => logic.buildDeck(CATS, [...six.slice(0, 5), 'nope'], {}, logic.MODES.expert.tiers, 30));
});

test('عشوائية كاملة: بذور مختلفة تعطي جولات مختلفة', () => {
  const a = deckIds(logic.buildDeck(CATS, six, {}, logic.MODES.expert.tiers, 30, seeded(1)));
  const b = deckIds(logic.buildDeck(CATS, six, {}, logic.MODES.expert.tiers, 30, seeded(2)));
  const c = deckIds(logic.buildDeck(CATS, six, {}, logic.MODES.expert.tiers, 30, seeded(3)));
  assert.notDeepEqual(a, b);
  assert.notDeepEqual(b, c);
  // ونفس البذرة تعيد نفس الجولة (قابلية إعادة الإنتاج)
  assert.deepEqual(a, deckIds(logic.buildDeck(CATS, six, {}, logic.MODES.expert.tiers, 30, seeded(1))));
});

test('لا تكرار عبر الجولات: الأسئلة المُلعبة تُؤجَّل حتى تنفد الجديدة', () => {
  const tiers = logic.MODES.expert.tiers;
  const first = logic.buildDeck(CATS, six, {}, tiers, 30, seeded(11));
  const history = Object.fromEntries(deckIds(first).map((id) => [id, Date.now()]));
  const second = logic.buildDeck(CATS, six, history, tiers, 30, seeded(12));
  const overlap = deckIds(second).filter((id) => history[id]);
  assert.equal(overlap.length, 0, `تكررت ${overlap.length} أسئلة رغم وجود بديل`);
  // بعد جولتين (60 من 144 متاحة) الثالثة أيضًا بلا تكرار
  for (const id of deckIds(second)) history[id] = Date.now();
  const third = logic.buildDeck(CATS, six, history, tiers, 30, seeded(13));
  assert.equal(deckIds(third).filter((id) => history[id]).length, 0);
});

test('أسماء الفرق: فارغ أو مكرر مرفوض، والمسافات تُنظَّف', () => {
  assert.equal(logic.validateTeamNames(['أ', '']).ok, false);
  assert.equal(logic.validateTeamNames(['الصقور', ' الصقور ']).ok, false);
  const ok = logic.validateTeamNames(['  الصقور  ', 'النمور']);
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.names, ['الصقور', 'النمور']);
});

test('الجلسة: deck → ids → deck يعيد نفس الأسئلة، والتحقق يرفض التالف', () => {
  const deck = logic.buildDeck(CATS, six, {}, logic.MODES.family.tiers, 20, seeded(5));
  const ids = logic.deckToIds(deck);
  const restored = logic.idsToDeck(CATS, ids);
  assert.deepEqual(deckIds(restored), deckIds(deck));
  const session = { version: 2, teams: [{}, {}], selectedCategories: six, mode: 'family', roundSize: 20, deck: ids };
  assert.equal(logic.isValidSession(CATS, session), true);
  assert.equal(logic.isValidSession(CATS, { ...session, version: 1 }), false);
  assert.equal(logic.isValidSession(CATS, { ...session, roundSize: 30 }), false);
  assert.equal(logic.isValidSession(CATS, { ...session, deck: { ...ids, [six[0]]: ['bad-id'] } }), false);
  assert.equal(logic.idsToDeck(CATS, { nope: ['x'] }), null);
});

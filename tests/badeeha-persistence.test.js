import test from 'node:test';
import assert from 'node:assert/strict';
import logic, { BANK_CONTENT_VERSION, currentQuestionHistoryCount } from '../src/games/badeeha/logic.js';
import { readBadeehaState, RETIRED_GAME_NOTICE } from '../src/games/badeeha/persistence.js';
import { BADEEHA_KEYS } from '../src/games/badeeha/keys.js';
import { fakeStorage } from './helpers.js';

const categories = Array.from({ length: 6 }, (_, i) => ({ id: `c${i}`, name: `فئة ${i}`,
  qs: [200, 400, 600, 800, 1000].flatMap(p => Array.from({ length: 8 }, (_, n) => ({ qid: `c${i}-${p}-${901+n}`, p, q: 'اختبار', a: 'إجابة' }))) }));
const ids = categories.map(c => c.id);
const deck = logic.buildDeck(categories, ids, {}, logic.MODES.expert.tiers, 60);
const session = { version: 2, contentVersion: BANK_CONTENT_VERSION, teams: [{}, {}], selectedCategories: ids, mode: 'expert', roundSize: 60, deck: logic.deckToIds(deck) };

test('old content cannot resume even if question IDs happen to exist, and no stored result/account/history is deleted', () => {
  const old = { ...session }; delete old.contentVersion;
  const values = { [BADEEHA_KEYS.active]: JSON.stringify(old), [BADEEHA_KEYS.results]: '[{"winner":"فريق"}]',
    [BADEEHA_KEYS.history]: '{"retired-200-001":123}', [BADEEHA_KEYS.reports]: '[{"qid":"retired-200-001"}]',
    [BADEEHA_KEYS.settings]: '{"soundOn":false}', 'maydan:account:session': 'existing-account' };
  const storage = fakeStorage(values);
  const result = readBadeehaState(categories, storage);
  assert.equal(result.active, null); assert.equal(result.retiredActive, true); assert.equal(result.invalidActive, false);
  assert.deepEqual(result.results, [{ winner: 'فريق' }]);
  for (const [key, value] of Object.entries(values)) assert.equal(storage.getItem(key), value);
  assert.match(RETIRED_GAME_NOTICE, /نتائجكم السابقة ما زالت محفوظة/);
});

test('current saved games resume, but missing cards or a different bank version never substitute new content', () => {
  const storage = fakeStorage({ [BADEEHA_KEYS.active]: JSON.stringify(session) });
  assert.deepEqual(readBadeehaState(categories, storage).active, session);
  assert.equal(logic.isValidSession(categories, { ...session, contentVersion: 'older-bank' }), false);
  assert.equal(logic.isValidSession(categories, { ...session, deck: { ...session.deck, c0: ['c0-200-001'] } }), false);
  assert.equal(readBadeehaState(categories, fakeStorage({ [BADEEHA_KEYS.active]: '{bad json' })).active, null);
});

test('new identifiers ignore retired seen history and current progress counts only current cards', () => {
  const history = { 'c0-200-001': 100, 'retired-200-999': 100, 'c0-200-901': 200 };
  assert.equal(currentQuestionHistoryCount(categories, history), 1);
  const selected = logic.buildDeck(categories, ids, history, logic.MODES.expert.tiers, 30);
  assert.ok(selected.c0.every(q => q.qid !== 'c0-200-901'), 'unseen current alternatives get priority');
  assert.equal(history['retired-200-999'], 100);
});

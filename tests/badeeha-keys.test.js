import { test } from 'node:test';
import assert from 'node:assert/strict';
import { migrateLegacyKeys, LEGACY_KEYS, BADEEHA_KEYS } from '../src/games/badeeha/keys.js';
import { fakeStorage } from './helpers.js';

test('كل مفتاح تحت النطاق maydan:badeeha:', () => {
  for (const k of Object.values(BADEEHA_KEYS)) assert.ok(k.startsWith('maydan:badeeha:'), k);
  assert.deepEqual(Object.keys(BADEEHA_KEYS), Object.keys(LEGACY_KEYS));
});

test('الترحيل ينقل المباراة المحفوظة والسجل ويحذف المفاتيح القديمة', () => {
  const active = JSON.stringify({ version: 2, teams: [] });
  const store = fakeStorage({ [LEGACY_KEYS.active]: active, [LEGACY_KEYS.results]: '[1]' });
  const migrated = migrateLegacyKeys(store);
  assert.deepEqual(migrated.sort(), ['active', 'results']);
  assert.equal(store.getItem(BADEEHA_KEYS.active), active);
  assert.equal(store.getItem(BADEEHA_KEYS.results), '[1]');
  assert.equal(store.getItem(LEGACY_KEYS.active), null);
  assert.equal(store.getItem(LEGACY_KEYS.results), null);
});

test('الترحيل لا يكتب فوق بيانات جديدة موجودة، وهو آمن للتكرار', () => {
  const store = fakeStorage({ [LEGACY_KEYS.history]: '{"old":1}', [BADEEHA_KEYS.history]: '{"new":1}' });
  assert.deepEqual(migrateLegacyKeys(store), []);
  assert.equal(store.getItem(BADEEHA_KEYS.history), '{"new":1}');
  assert.equal(store.getItem(LEGACY_KEYS.history), null);
  assert.deepEqual(migrateLegacyKeys(store), []);
  assert.deepEqual(migrateLegacyKeys(null), [], 'بلا مخزن');
});

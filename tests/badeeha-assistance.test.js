import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { questionAssistance } from '../src/games/badeeha/assistance.js';

test('light assistance covers every high-tier question without altering the bank or scores', () => {
  let count = 0;
  for (const file of readdirSync('src/data/categories').filter((f) => f.endsWith('.json'))) {
    for (const q of JSON.parse(readFileSync(`src/data/categories/${file}`, 'utf8')).qs) {
      const before = JSON.stringify(q);
      const assistance = questionAssistance(q);
      assert.equal(Boolean(assistance), [600, 800, 1000].includes(q.p), q.qid);
      assert.equal(JSON.stringify(q), before, `changed ${q.qid}`);
      if (assistance) {
        count++;
        assert.ok(assistance.context || assistance.shape, `no useful clue: ${q.qid}`);
      }
    }
  }
  assert.ok(count > 10000);
});

test('context clues never contain an accepted answer and multiple-choice answers do not disclose word counts', () => {
  assert.equal(questionAssistance({ p: 800, q: 'ما هذه المدينة؟', a: 'مكة', alt: ['مكه'], topic: 'معالم مكة' }).context, '');
  assert.equal(questionAssistance({ p: 1000, type: 'choice', a: 'الخيار الأول', topic: 'الفضاء' }).shape, '');
  assert.equal(questionAssistance({ p: 400, a: 'مكة' }), null);
  assert.equal(questionAssistance({ p: 600, qid: 'blur-600-001', type: 'image', a: 'عربة خيل', topic: 'رياضة' }).context, '');
});

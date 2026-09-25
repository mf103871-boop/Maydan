import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const { qs } = JSON.parse(fs.readFileSync(new URL('../src/data/categories/code.json', import.meta.url), 'utf8'));
const alphabet = [...'ابتثجحخدذرزسشصضطظعغفقكلمنهوي'];

test('every curated code puzzle decodes exactly to its stated answer', () => {
  assert.equal(qs.length, 40);
  assert.equal(new Set(qs.map(q => q.a)).size, 40);
  for (const q of qs) {
    let decoded;
    const parts = q.q.split(' / ').map(s => s.split(' · '));
    if (q.p === 200) decoded = parts[0].toReversed().join('');
    if (q.p === 400) decoded = parts[0].filter((_, i) => i % 2 === 0).join('');
    if (q.p === 600) {
      decoded = parts[0].map((c, i, a) => i % 2 ? a[i-1] : a[i+1] ?? c).join('');
    }
    if (q.p === 800) {
      assert.equal(parts.length, 2);
      decoded = Array.from({length:parts.flat().length}, (_, i) => parts[i%2][Math.floor(i/2)]).join('');
    }
    if (q.p === 1000) {
      assert.ok(q.hint.includes(alphabet.join(' ')));
      decoded = parts[0].toReversed().map(c => alphabet[(alphabet.indexOf(c)+alphabet.length-1)%alphabet.length]).join('');
    }
    assert.equal(decoded, q.a, q.qid);
    assert.equal(q.dir, 'rtl');
    assert.ok(q.hint);
  }
});

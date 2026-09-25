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
    if (q.p === 200) decoded = q.q.split(' · ').join('');
    if (q.p === 400) decoded = [...q.q].reverse().join('');
    if (q.p === 600) {
      assert.ok(!q.a.includes('ز'));
      decoded = q.q.replaceAll('ز', '');
      assert.match(q.hint, /ز/);
    }
    if (q.p === 800) {
      decoded = q.q.split(' - ').map(n => {
        assert.ok(Number(n) >= 1 && Number(n) <= alphabet.length);
        assert.ok(q.hint.includes(`${n}=${alphabet[Number(n)-1]}`));
        return alphabet[Number(n)-1];
      }).join('');
    }
    if (q.p === 1000) {
      assert.ok(q.hint.includes(alphabet.join(' ')));
      decoded = [...q.q].map(c => alphabet[(alphabet.indexOf(c)+alphabet.length-1)%alphabet.length]).join('');
    }
    assert.equal(decoded, q.a, q.qid);
  }
});

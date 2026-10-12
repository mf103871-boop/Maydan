import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const { qs } = JSON.parse(fs.readFileSync(new URL('../src/data/categories/code.json', import.meta.url), 'utf8'));
const { code: proofs } = JSON.parse(fs.readFileSync(new URL('../docs/bank/quality-2026-10-08/mechanics-proofs.json', import.meta.url), 'utf8'));
const alphabet = [...'ابتثجحخدذرزسشصضطظعغفقكلمنهوي'];

test('every curated code puzzle decodes using its displayed rule, independently of its point tier', () => {
  assert.equal(qs.length, 40);
  assert.equal(new Set(qs.map(q => q.a)).size, 40);
  for (const q of qs) {
    let decoded;
    let method;
    assert.equal(typeof q.hint, 'string', q.qid);
    const parts = q.q.split(' / ').map(s => s.split(' · '));
    if (q.hint.includes('أعد كل حرف خطوة للخلف')) {
      method = 'reverse-caesar';
      assert.ok(q.hint.includes('اعكس ترتيب الحروف'), q.qid);
      assert.ok(q.hint.includes(alphabet.join(' ')), q.qid);
      assert.ok(parts[0].every(c => alphabet.includes(c)), q.qid);
      decoded = parts[0].toReversed().map(c => alphabet[(alphabet.indexOf(c)+alphabet.length-1)%alphabet.length]);
    } else if (q.hint.includes('بدّل كل حرفين متجاورين')) {
      decoded = parts[0].map((c, i, a) => i % 2 ? a[i-1] : a[i+1] ?? c);
      const reverse = q.hint.includes('ثم اعكس ترتيب الحروف الناتجة');
      if (reverse) decoded.reverse();
      method = reverse ? 'reverse-pair-swap' : 'pair-swap';
    } else if (q.hint.includes('خذ حرفًا منه ثم من الآخر بالتناوب')) {
      assert.equal(parts.length, 2);
      decoded = Array.from({length:parts.flat().length}, (_, i) => parts[i%2][Math.floor(i/2)]);
      assert.ok(decoded.every(c => typeof c === 'string'), q.qid);
      const reverse = q.hint.includes('اعكس ترتيب الناتج');
      if (reverse) decoded.reverse();
      method = reverse ? 'reverse-deinterleave' : 'deinterleave';
    } else if (q.hint.includes('احتفظ بالأول والثالث والخامس')) {
      method = 'alternating';
      decoded = parts[0].filter((_, i) => i % 2 === 0);
    } else if (q.hint.includes('اقرأ الحروف من آخرها إلى أولها')) {
      method = 'reverse';
      decoded = parts[0].toReversed();
    } else {
      assert.fail(`${q.qid}: unsupported displayed rule`);
    }
    if (!method.includes('deinterleave')) assert.equal(parts.length, 1, q.qid);
    assert.equal(proofs.find(p => p.qid === q.qid)?.method, method, q.qid);
    assert.equal(decoded.join(''), q.a, q.qid);
    assert.equal(q.dir, 'rtl');
  }
});

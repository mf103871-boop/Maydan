import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {arabicNormalizeLoose} from '../src/shared/lib/arabicNormalize.js';
const read = file => JSON.parse(readFileSync(new URL('../'+file, import.meta.url), 'utf8'));
const evidence = read('docs/bank/difficulty-2026-09-25/mechanics-proofs.json');

test('every revised cipher can be solved using the displayed rule and Arabic display order', () => {
  const alphabet = [...'ابتثجحخدذرزسشصضطظعغفقكلمنهوي'];
  const cards = read('src/data/categories/code.json').qs;
  for (const card of cards) {
    const record = evidence.code.find(x => x.qid === card.qid);
    assert.ok(record, card.qid);
    const parts = card.q.split(' / ').map(s => s.split(' · '));
    let decoded;
    if (record.method === 'reverse') decoded = parts[0].toReversed();
    if (record.method === 'alternating') decoded = parts[0].filter((_, i) => i % 2 === 0);
    if (record.method === 'pair-swap') decoded = parts[0].map((c, i, a) => i % 2 ? a[i-1] : a[i+1] ?? c);
    if (record.method === 'deinterleave') decoded = Array.from({length:parts.flat().length}, (_, i) => parts[i%2][Math.floor(i/2)]);
    if (record.method === 'reverse-caesar') decoded = parts[0].toReversed().map(c => alphabet[(alphabet.indexOf(c)+27)%28]);
    assert.equal(decoded.join(''), card.a, card.qid);
    assert.equal(card.dir, 'rtl');
    assert.ok(card.hint);
  }
});

test('revised event comparisons agree with both source dates and are balanced within each tier', () => {
  const cards = read('src/data/categories/beforeafter.json').qs;
  const used = new Set();
  for (const card of cards) {
    const record = evidence.beforeafter.find(x => x.qid === card.qid);
    assert.ok(record, card.qid);
    const [a,b] = record.events;
    assert.notEqual(a.year,b.year);
    assert.equal(card.a, a.year < b.year ? 'قبل' : 'بعد');
    assert.deepEqual(card.verification.years,[a.year,b.year]);
    assert.deepEqual(card.source,[a.source,b.source]);
    const key=[a.id,b.id].sort().join('/');
    assert.ok(!used.has(key),key); used.add(key);
  }
  for(const p of [200,400,600,800,1000]) assert.equal(cards.filter(q=>q.p===p && q.a==='قبل').length,4);
});

test('original reasoning puzzles match independently computed answers for the new numerical traps', () => {
  const cards = read('src/data/categories/puzzles.json').qs;
  const answer = id => cards.find(q=>q.qid===id).a;
  assert.equal(answer('puzzles-800-913'), `${(12-1)*(10/(6-1))} ثانية`);
  assert.equal(answer('puzzles-1000-911'), `${Math.round((1.25*.8-1)*100)}%`);
  assert.equal(answer('puzzles-1000-916'), `${Array.from({length:100},(_,i)=>i+1).filter(n=>String(n).includes('9')).length} عددًا`);
  const arrangements = [[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]];
  const depth = possibilities => {
    if(possibilities.length <= 1) return 0;
    let best = Infinity;
    for(let key=0;key<3;key++) for(let lock=0;lock<3;lock++) {
      const yes=possibilities.filter(p=>p[key]===lock);
      const no=possibilities.filter(p=>p[key]!==lock);
      if(yes.length && no.length) best=Math.min(best,1+Math.max(depth(yes),depth(no)));
    }
    return best;
  };
  assert.equal(answer('puzzles-1000-918'), `${depth(arrangements)} تجارب`);
});

test('hints never spell out an accepted answer, including alternate names', () => {
  for(const card of read('src/data/categories/hints.json').qs) {
    for(const hint of card.hints) for(const answer of [card.a,...(card.alt||[])]) {
      const normalized = arabicNormalizeLoose(answer);
      assert.ok(!(` ${arabicNormalizeLoose(hint)} `).includes(` ${normalized} `), `${card.qid}: ${hint}`);
    }
  }
});

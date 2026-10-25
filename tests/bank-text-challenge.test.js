import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {arabicNormalizeLoose} from '../src/shared/lib/arabicNormalize.js';
const read = file => JSON.parse(readFileSync(new URL('../'+file, import.meta.url), 'utf8'));
const evidence = read('docs/bank/quality-2026-10-08/mechanics-proofs.json');

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
    if (record.method === 'reverse-pair-swap') decoded = parts[0].map((c, i, a) => i % 2 ? a[i-1] : a[i+1] ?? c).toReversed();
    if (record.method === 'deinterleave') decoded = Array.from({length:parts.flat().length}, (_, i) => parts[i%2][Math.floor(i/2)]);
    if (record.method === 'reverse-deinterleave') decoded = Array.from({length:parts.flat().length}, (_, i) => parts[i%2][Math.floor(i/2)]).toReversed();
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
  const answer = prefix => cards.find(q=>q.q.startsWith(prefix)).a;
  assert.equal(answer('جرس بفواصل'), `${(12-1)*(10/(6-1))} ثانية`);
  const cost = 100/1.25 + 100/.75;
  assert.equal(answer('بعت سلعتين'), `${Math.round((cost-200)/cost*10000)/100}%`);
  const open = Array(100).fill(false);
  for(let round=1;round<=100;round++) for(let door=round;door<=100;door+=round) open[door-1]=!open[door-1];
  assert.equal(answer('100 خزنة'), `${open.filter(Boolean).length} خزائن`);
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
  assert.equal(answer('ثلاثة مفاتيح'), `${depth(arrangements)} تجارب`);
});

test('hints never spell out an accepted answer, including alternate names', () => {
  for(const card of read('src/data/categories/hints.json').qs) {
    for(const hint of card.hints) for(const answer of [card.a,...(card.alt||[])]) {
      const normalized = arabicNormalizeLoose(answer);
      assert.ok(!(` ${arabicNormalizeLoose(hint)} `).includes(` ${normalized} `), `${card.qid}: ${hint}`);
    }
  }
});

test('changed ordering puzzles have unique answers even when complete arrangements differ', () => {
  const cards=read('src/data/categories/puzzles.json').qs;
  const permutations=values=>values.length<=1?[values]:values.flatMap((v,i)=>permutations(values.filter((_,j)=>i!==j)).map(p=>[v,...p]));
  const orders=permutations(['أ','ب','ج','د','هـ']).filter(a=>{
    const index=c=>a.indexOf(c);
    return index('ب')===index('أ')+1 && index('ج')===index('د')+1 && index('هـ')>Math.min(index('ب'),index('د')) && index('هـ')<Math.max(index('ب'),index('د'));
  });
  assert.equal(orders.length,2);
  const middle=new Set(orders.map(a=>a[2]));
  assert.equal(middle.size,1);
  assert.equal(cards.find(q=>q.q.startsWith('خمسة كتب:')).a,[...middle][0]);
  const circles=new Set(permutations([1,2,3,4,5,6]).map(a=>{
    const forward=a.join(','),backward=a.toReversed().join(',');
    return forward<backward?forward:backward;
  }));
  assert.equal(cards.find(q=>q.q.startsWith('سبعة أشخاص يجلسون')).a,`${circles.size} ترتيبًا`);
});

test('bridge minimum is proved by searching all permitted lantern crossings', () => {
  const times=[1,2,7,10],goal=15,dist=new Map([['0/0',0]]),queue=[{mask:0,lamp:0,cost:0}];
  let minimum;
  while(queue.length){
    queue.sort((a,b)=>a.cost-b.cost);
    const {mask,lamp,cost}=queue.shift(),key=`${mask}/${lamp}`;
    if(cost!==dist.get(key))continue;
    if(mask===goal&&lamp===1){minimum=cost;break;}
    const people=[0,1,2,3].filter(i=>((mask>>i)&1)===lamp);
    const groups=people.map(i=>[i]);
    for(let i=0;i<people.length;i++)for(let j=i+1;j<people.length;j++)groups.push([people[i],people[j]]);
    for(const group of groups){
      const next=mask^group.reduce((bits,i)=>bits|(1<<i),0),nextLamp=1-lamp,nextCost=cost+Math.max(...group.map(i=>times[i])),nextKey=`${next}/${nextLamp}`;
      if(nextCost<(dist.get(nextKey)??Infinity)){dist.set(nextKey,nextCost);queue.push({mask:next,lamp:nextLamp,cost:nextCost});}
    }
  }
  assert.equal(minimum,17);
  assert.equal(read('src/data/categories/puzzles.json').qs.find(q=>q.q.startsWith('أربعة بضفة')).a,`${minimum} دقيقة`);
});

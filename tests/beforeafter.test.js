import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const pack = JSON.parse(await readFile(new URL('../src/data/categories/beforeafter.json', import.meta.url), 'utf8'));
const evidence = JSON.parse(await readFile(new URL('../docs/bank/beforeafter-evidence.json', import.meta.url), 'utf8'));
const events = new Map(evidence.groups.flatMap(group => group.events.map(event => [event.id, event])));

test('قبل ولا بعد: 240 مقارنة مستقلة بلا أزواج معكوسة مكررة', () => {
  assert.equal(pack.qs.length, 240);
  assert.equal(events.size, 60);
  const pairs = new Set();
  for (const q of pack.qs) {
    const ids = q.verification.events;
    assert.equal(ids.length, 2, q.qid);
    assert.notEqual(ids[0], ids[1], q.qid);
    const key = [...ids].sort().join('|');
    assert.ok(!pairs.has(key), `${q.qid}: زوج مكرر أو معكوس`);
    pairs.add(key);
  }
});

test('قبل ولا بعد: الحل يطابق الحدثين وسنتيهما ومصدريهما', () => {
  for (const q of pack.qs) {
    const [left, right] = q.verification.events.map(id => events.get(id));
    assert.ok(left && right, q.qid);
    assert.ok(Number.isInteger(left.year) && Number.isInteger(right.year), q.qid);
    assert.notEqual(left.year, right.year, `${q.qid}: السنة وحدها لا تحسم المقارنة`);
    assert.equal(q.type, 'choice');
    assert.deepEqual(q.options, ['قبل', 'بعد']);
    assert.equal(q.a, left.year < right.year ? 'قبل' : 'بعد', q.qid);
    assert.deepEqual(q.verification.years, [left.year, right.year], q.qid);
    assert.deepEqual(q.source, [left.sourceUrl, right.sourceUrl], q.qid);
    assert.equal(q.q, `${left.label} مقارنة بـ${right.label}؟`, q.qid);
    for (const url of q.source) assert.equal(new URL(url).protocol, 'https:');
    assert.equal(q.verified, true, q.qid);
  }
});

test('قبل ولا بعد: هويات الإنشاء محفوظة والتصنيف المراجع لا يخفي الفجوات', () => {
  const reviewedCounts = { 200: 59, 400: 65, 600: 65, 800: 18, 1000: 33 };
  assert.equal(pack.qs.filter(q => q.p !== Number(q.qid.split('-')[1])).length, 70);
  for (const p of [200, 400, 600, 800, 1000]) {
    assert.equal(pack.qs.filter(q => q.p === p).length, reviewedCounts[p], `توزيع المراجعة ${p}`);
    // معرّف السؤال يسجل شريحة الإنشاء، وليس تصنيفه بعد المراجعة.
    const tier = pack.qs.filter(q => Number(q.qid.split('-')[1]) === p);
    assert.equal(tier.length, 48);
    assert.equal(tier.filter(q => q.a === 'قبل').length, 24);
    assert.equal(tier.filter(q => q.a === 'بعد').length, 24);
    for (const { topic } of evidence.groups) assert.equal(tier.filter(q => q.topic === topic).length, 8);
  }
});

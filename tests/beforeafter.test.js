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
    // «بـ» تُوصل بما بعدها؛ التطويل يسقط قبل الهمزة والألف. نقارن بعد حذف التطويل
    // فيبقى ترتيب الحدثين ونصّهما مثبّتين دون فرض إملاء ركيك.
    const tatweel = (text) => text.replace(/\u0640/g, '');
    assert.equal(tatweel(q.q), tatweel(`${left.label} مقارنة بـ${right.label}؟`), q.qid);
    for (const url of q.source) assert.equal(new URL(url).protocol, 'https:');
    assert.equal(q.verified, true, q.qid);
  }
});

test('قبل ولا بعد: 48 سؤالًا في كل خانة، والخانة تطابق المعرّف', () => {
  const evidenceTopics = evidence.groups.map(group => group.topic);
  for (const p of [200, 400, 600, 800, 1000]) {
    const tier = pack.qs.filter(q => q.p === p);
    assert.equal(tier.length, 48, `توزيع ${p}`);
    // المعرّف يطابق الخانة بعد إعادة التصنيف بالصعوبة الفعلية.
    for (const q of tier) assert.equal(Number(q.qid.split('-')[1]), p, q.qid);
    // لا يميل الجواب إلى جهة فيخمّنه اللاعب: يبقى كلٌّ من «قبل» و«بعد» قرب النصف.
    const before = tier.filter(q => q.a === 'قبل').length;
    assert.ok(before >= 19 && before <= 29, `${p}: ميل الجواب ${before}/48`);
    // لا يهيمن موضوع على خانة (سقف البنك 25%).
    for (const topic of evidenceTopics) {
      assert.ok(tier.filter(q => q.topic === topic).length <= 12, `${p}: الموضوع ${topic} يتجاوز الربع`);
    }
  }
  const ids = pack.qs.map(q => q.qid);
  assert.equal(new Set(ids).size, ids.length, 'معرّفات مكررة');
});

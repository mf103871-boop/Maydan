import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const dir = path.resolve('src/data/categories');
const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
const cats = files.map((f) => JSON.parse(readFileSync(path.join(dir, f), 'utf8')));

test('بنك بَديهة: 43 فئة بمعرّفات فريدة', () => {
  assert.equal(cats.length, 43);
  assert.equal(new Set(cats.map((c) => c.id)).size, 43);
  for (const c of cats) {
    assert.equal(typeof c.name, 'string');
    assert.ok(c.name.length > 0, `${c.id} بلا اسم`);
    assert.ok(Array.isArray(c.qs), `${c.id} بلا أسئلة`);
  }
});

test('كل فئة ≥ 24 سؤالًا، ولكل شريحة (200..1000) أسئلة', () => {
  for (const c of cats) {
    assert.ok(c.qs.length >= 24, `${c.id}: ${c.qs.length} سؤالًا فقط`);
    const tiers = new Set(c.qs.map((q) => q.p));
    for (const p of [200, 400, 600, 800, 1000]) assert.ok(tiers.has(p), `${c.id}: لا أسئلة بشريحة ${p}`);
  }
});

test('المعرّفات فريدة عبر البنك كله ولا نصوص فارغة', () => {
  const all = cats.flatMap((c) => c.qs.map((q) => ({ ...q, cat: c.id })));
  assert.equal(new Set(all.map((q) => q.qid)).size, all.length, 'qid مكرر');
  for (const q of all) {
    assert.ok(q.qid && typeof q.qid === 'string', `${q.cat}: سؤال بلا qid`);
    assert.ok([200, 400, 600, 800, 1000].includes(q.p), `${q.cat}/${q.qid}: نقاط غير صالحة`);
    const hasPrompt = (q.q && String(q.q).trim()) || q.type;
    assert.ok(hasPrompt, `${q.cat}/${q.qid}: سؤال بلا نص`);
    const hasAnswer = (q.a && String(q.a).trim()) || q.type === 'order' || q.type === 'odd' || q.type === 'grid';
    assert.ok(hasAnswer, `${q.cat}/${q.qid}: سؤال بلا إجابة`);
  }
});

test('index.js يستورد كل الملفات ويصدّر المجموع', async () => {
  const src = readFileSync(path.resolve('src/data/categories/index.js'), 'utf8');
  for (const f of files) assert.ok(src.includes(`./${f}`), `index.js لا يستورد ${f}`);
  const total = cats.reduce((s, c) => s + c.qs.length, 0);
  assert.ok(total >= 1032, `المجموع ${total} أقل من 1032`);
});

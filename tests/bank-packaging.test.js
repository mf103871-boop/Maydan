import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';
import { CATS } from '../src/data/categories/index.js';
import { BANK_EDITORIAL_FIELDS, bankPackagingPlugin, shippedBankPack, packedQuestionBank } from '../scripts/lib/bank-packaging.mjs';
import { unpackQuestionBank } from '../src/data/packed-bank.mjs';

const omit = (question) => Object.fromEntries(Object.entries(question).filter(([key]) => !BANK_EDITORIAL_FIELDS.includes(key)));

test('the shipped pack drops only top-level editorial fields and keeps media credits', () => {
  const media = { src: '01.webp', title: 'صورة', sourceUrl: 'https://commons.example/file', author: 'مصوّر', license: 'CC BY 4.0' };
  const pack = { id: 'demo', name: 'تجربة', icon: '🧪', qs: [{ qid: 'demo-200-1', p: 200, topic: 'علوم', q: 'سؤال؟', a: 'جواب', alt: ['إجابة'], media,
    sourceUrl: 'https://source.example', source: 'https://other.example', verified: true, verifiedAt: '2026-09-25', verification: { checkedAt: '2026-09-25' }, difficultyTarget: 0.8 }] };
  assert.deepEqual(shippedBankPack(pack), { id: 'demo', name: 'تجربة', icon: '🧪', qs: [{ qid: 'demo-200-1', p: 200, topic: 'علوم', q: 'سؤال؟', a: 'جواب', alt: ['إجابة'], media }] });
  assert.equal(pack.qs[0].verified, true, 'the source object is not mutated');
});

test('compact JSON preserves nested keys, numeric arrays, empty values and independent object instances', () => {
  const value = JSON.parse('{"__proto__":{"safe":true},"constructor":"data","empty":{},"list":[[],[0,1,2],[1,0],false,null,0,""],"qs":[{"q":"سؤال؟","a":"إجابة","p":200,"media":{"sourceUrl":"https://example.test/source","license":"CC BY 4.0"}},{"q":"سؤال؟","a":"إجابة","p":200}]}');
  const packed = packedQuestionBank(value), decoded = unpackQuestionBank(JSON.parse(JSON.stringify(packed)));
  assert.deepEqual(decoded, value);
  assert.equal(Object.getPrototypeOf(decoded), Object.prototype);
  assert.equal(Object.hasOwn(decoded, '__proto__'), true);
  assert.notEqual(decoded.qs[0], decoded.qs[1]);
  decoded.qs[0].a = 'تغيير محلي';
  assert.equal(value.qs[0].a, 'إجابة');
  assert.equal(decoded.qs[1].a, 'إجابة');
  const cycle = {}; cycle.self = cycle;
  for (const invalid of [cycle, { field: undefined }, { field: NaN }, { field: new Date() }, { field: () => true }])
    assert.throws(() => packedQuestionBank(invalid), /acyclic JSON/);
});

test('the bundled bank keeps every playable field of every question and no editorial field', { timeout: 60_000 }, async () => {
  const options = { stdin: { contents: "export { CATS } from './src/data/categories/index.js';", resolveDir: process.cwd() }, bundle: true, write: false, minify: true, format: 'esm', logLevel: 'silent' };
  const plain = await build(options), shipped = await build({ ...options, plugins: [bankPackagingPlugin()] });
  const bytes = shipped.outputFiles[0].contents;
  assert.ok(bytes.length < plain.outputFiles[0].contents.length - 300_000, 'editorial metadata no longer ships in the document');
  const { CATS: bundled } = await import(`data:text/javascript;base64,${Buffer.from(bytes).toString('base64')}`);
  assert.equal(bundled.length, CATS.length);
  let questions = 0;
  for (const [index, category] of CATS.entries()) {
    const { qs, ...meta } = category, { qs: shippedQs, ...shippedMeta } = bundled[index];
    assert.deepEqual(shippedMeta, meta, category.id);
    assert.equal(shippedQs.length, qs.length, category.id);
    for (const [n, question] of qs.entries()) {
      assert.deepEqual(shippedQs[n], omit(question), question.qid);
      for (const field of BANK_EDITORIAL_FIELDS) assert.equal(Object.hasOwn(shippedQs[n], field), false, `${question.qid} ships ${field}`);
      questions++;
    }
  }
  assert.ok(questions >= 3000, `${questions} questions compared`);
  assert.ok(bundled.some(category => category.qs.some(question => question.topic)), 'topics stay for high-tier hints');
});

test('no client module reads a stripped editorial field', async () => {
  const files = [];
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) { if (file !== path.join('src', 'data')) await walk(file); }
      else if (/\.(?:js|jsx|mjs)$/.test(entry.name)) files.push(file);
    }
  }
  await walk('src');
  // sourceUrl and source also name media credits and unrelated values, so only
  // the bank-only names are scanned; the bundled-bank test covers the rest.
  for (const file of files) {
    const text = await readFile(file, 'utf8');
    for (const field of ['verified', 'verifiedAt', 'verification', 'difficultyTarget']) {
      assert.doesNotMatch(text, new RegExp(`(?:\\.|\\[['"])${field}\\b`), `${file} reads ${field}, which the shipped bank omits`);
    }
  }
});

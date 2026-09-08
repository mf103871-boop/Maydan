import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT } from '../scripts/bank.mjs';

async function fixture(t, pack) {
  const root = await mkdtemp(path.join(tmpdir(), 'bank-pipeline-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const dir of ['scripts/bank', 'src/shared/lib', 'src/data/categories']) {
    await mkdir(path.join(root, dir), { recursive: true });
  }
  for (const file of ['scripts/bank.mjs', 'scripts/bank/append-pack.mjs', 'scripts/bank/merge-pack.mjs', 'src/shared/lib/arabicNormalize.js']) {
    await copyFile(path.join(ROOT, file), path.join(root, file));
  }
  await writeFile(path.join(root, 'package.json'), '{"type":"module"}');
  await writeFile(path.join(root, 'src/data/bank-status.json'), JSON.stringify({ categories: {
    trial: { name: 'اختبار', icon: '🧩', style: 'story', defaultType: 'image' },
  } }));
  if (pack) await writeFile(path.join(root, 'src/data/categories/trial.json'), JSON.stringify(pack));
  return root;
}

const candidate = (a = 'إجابة جديدة') => ({ p: 200, q: `سؤال تجريبي عن ${a.length}`, a, topic: 'موضوع', source: 'https://example.org/evidence' });
async function run(root, command, questions, checks) {
  const file = path.join(root, 'batch.json');
  await writeFile(file, JSON.stringify({ packs: [{ id: 'trial', questions, checks }] }));
  // تشغيل من خارج المستودع يثبت أن المسار ليس مسار جهاز قديم ولا cwd.
  return spawnSync(process.execPath, [path.join(root, 'scripts/bank', `${command}-pack.mjs`), file], { cwd: tmpdir(), encoding: 'utf8' });
}
const readPack = async (root) => JSON.parse(await readFile(path.join(root, 'src/data/categories/trial.json'), 'utf8'));

test('append preserves old ids, reassigned tiers, metadata and media; only checked questions enter', async (t) => {
  const old = [
    { p: 200, qid: 'trial-200-003', q: 'نص قديم أول', a: 'قديم أ', topic: 'موضوع', verified: true, type: 'image', media: { src: 'one.webp' }, alt: ['بديل'] },
    { p: 400, qid: 'trial-200-008', q: 'نص قديم ثان', a: 'قديم ب', topic: 'موضوع', verified: true },
  ];
  const pack = { id: 'trial', name: 'اختبار', icon: '🧩', style: 'story', defaultType: 'image', qs: old };
  const root = await fixture(t, pack);
  const result = await run(root, 'append', [candidate(), candidate('بلا تدقيق'), candidate('حكم غير صالح')], [{ i: 0, verdict: 'keep' }, { i: 2, verdict: 'unknown' }]);
  assert.equal(result.status, 0, result.stderr);
  const actual = await readPack(root);
  assert.equal(actual.style, 'story');
  assert.equal(actual.defaultType, 'image');
  for (const q of old) assert.deepEqual(actual.qs.find((x) => x.qid === q.qid), q);
  assert.equal(actual.qs.length, 3);
  const added = actual.qs.find((q) => q.qid === 'trial-200-009');
  assert.equal(added.a, 'إجابة جديدة');
  assert.equal(added.source, 'https://example.org/evidence');
  assert.equal(added.verified, true);
});

test('merge requires a verdict, retains sources and refuses to overwrite a pack', async (t) => {
  const root = await fixture(t);
  let result = await run(root, 'merge', [candidate(), candidate('بلا تدقيق')], [{ i: 0, verdict: 'keep' }]);
  assert.equal(result.status, 0, result.stderr);
  const original = await readPack(root);
  assert.equal(original.qs.length, 1);
  assert.equal(original.qs[0].source, 'https://example.org/evidence');
  assert.equal(original.style, 'story');
  result = await run(root, 'merge', [candidate('بديل')], [{ i: 0, verdict: 'keep' }]);
  assert.notEqual(result.status, 0);
  assert.deepEqual(await readPack(root), original);
});

test('append and merge allow a shared answer across categories but reject fabricated suffixes', async (t) => {
  for (const command of ['append', 'merge']) {
    const root = await fixture(t, command === 'append' ? { id: 'trial', name: 'اختبار', icon: '🧩', qs: [] } : undefined);
    await writeFile(path.join(root, 'src/data/categories/other.json'), JSON.stringify({ id: 'other', qs: [
      { p: 400, qid: 'other-400-001', q: 'من تولى رئاسة أكاديمية السينما؟', a: 'غريغوري بيك' },
    ] }));
    const questions = [
      { ...candidate('غريغوري بيك'), q: 'من جسّد أتيكوس فينش في فيلم «أن تقتل طائرًا محاكيًا»؟' },
      { ...candidate('توم هانكس، مستوى 200'), q: 'سؤال قالبي مختلف' },
    ];
    const result = await run(root, command, questions, questions.map((_, i) => ({ i, verdict: 'keep' })));
    assert.equal(result.status, 0, result.stderr);
    const pack = await readPack(root);
    assert.deepEqual(pack.qs.map((q) => q.a), ['غريغوري بيك']);
    assert.match(result.stderr, /إجابة تتكرر في فئة أخرى/);
  }
});

test('append and merge skip retired identifiers even when the old questions are absent', async (t) => {
  for (const command of ['append', 'merge']) {
    const old = { p: 400, qid: 'trial-200-008', q: 'واقعة محفوظة قديمة', a: 'جواب محفوظ', topic: 'موضوع', verified: true };
    const root = await fixture(t, command === 'append' ? { id: 'trial', name: 'اختبار', icon: '🧩', qs: [old] } : undefined);
    await mkdir(path.join(root, 'docs/bank'), { recursive: true });
    await writeFile(path.join(root, 'docs/bank/retired-qids.json'), JSON.stringify({
      ranges: [{ category: 'trial', tier: 200, start: 9, end: 48 }], qids: ['trial-200-050'],
    }));
    const result = await run(root, command, [candidate()], [{ i: 0, verdict: 'keep' }]);
    assert.equal(result.status, 0, result.stderr);
    const pack = await readPack(root);
    assert.equal(pack.qs.find(q => q.a === 'إجابة جديدة').qid, 'trial-200-051');
    if (command === 'append') assert.deepEqual(pack.qs.find(q => q.qid === old.qid), old);
  }
});

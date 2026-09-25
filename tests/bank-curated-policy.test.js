import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { validateBank, writeIndex, bankReport, formatReport } from '../scripts/bank.mjs';

const TIERS = [200, 400, 600, 800, 1000];
const targets = { 200: 0.8, 400: 0.6, 600: 0.4, 800: 0.25, 1000: 0.15 };
const record = 'docs/bank/rebuild-2026-09-18/generated-art.json';
const makeQuestions = () => TIERS.flatMap((p) => Array.from({ length: 8 }, (_, n) => ({
  qid: `curated-${p}-${901 + n}`, p, q: `سؤال تجريبي ${p} رقم ${n + 1}؟`,
  a: `جواب مستقل ${p} ${n + 1}`, verified: true, topic: ['أ', 'ب', 'ج', 'د', 'هـ', 'و'][n % 6],
  difficultyTarget: targets[p], sourceUrl: 'https://example.com/review',
})));

async function fixture(t, change = () => {}, state = 'done') {
  const root = await mkdtemp(path.join(os.tmpdir(), 'maydan-curated-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'src/data/categories'), { recursive: true });
  await mkdir(path.join(root, 'media/curated'), { recursive: true });
  await mkdir(path.dirname(path.join(root, record)), { recursive: true });
  await writeFile(path.join(root, record), JSON.stringify({ images: [{ file: 'media/curated/asset.webp', tool: 'Test image generator' }] }));
  await writeFile(path.join(root, 'media/curated/asset.webp'), 'fixture');
  const qs = makeQuestions(); change(qs);
  const meta = { name: 'منتقى', icon: '🧪', media: false, status: state, order: 1,
    counts: Object.fromEntries(TIERS.map((p) => [p, qs.filter((q) => q.p === p).length])), doneAt: state === 'done' ? '2026-09-18' : null };
  await writeFile(path.join(root, 'src/data/bank-status.json'), JSON.stringify({
    tierMin: 8, tierCount: 8, tiers: TIERS, qidRange: { start: 901, end: 908 },
    difficultyTargets: targets, difficultyCalibration: 'editorial-not-measured', requireSources: true,
    categories: { curated: meta },
  }));
  await writeFile(path.join(root, 'src/data/categories/curated.json'), JSON.stringify({ id: 'curated', name: meta.name, icon: meta.icon, qs }));
  await writeIndex(root);
  return root;
}

test('curated policy requires exactly eight per tier without presenting editorial targets as measurements', async (t) => {
  const root = await fixture(t);
  assert.deepEqual((await validateBank(root)).errors, []);
  const report = await bankReport(root);
  assert.equal(report.questions, 40);
  assert.equal(report.tierCount, 8);
  assert.match(formatReport(report), /8 بالضبط/);
  assert.match(formatReport(report), /ليست نتائج قياس/);
  for (const extra of [false, true]) {
    const bad = await fixture(t, (qs) => extra ? qs.push({ ...qs.at(-1), qid: 'curated-1000-909', q: 'إضافة زائدة؟', a: 'تجاوز' }) : qs.pop());
    assert.ok((await validateBank(bad)).errors.some((e) => e.includes(`خانة 1000: ${extra ? 9 : 7} سؤالًا والمطلوب 8 بالضبط`)));
  }
});

test('pending cannot bypass the new count, verified fields, editorial target or new identifier range', async (t) => {
  const root = await fixture(t, (qs) => {
    qs[0].qid = 'curated-200-001'; qs[0].verified = false; qs[0].difficultyTarget = 0.95; qs.pop();
  }, 'pending');
  const { errors } = await validateBank(root);
  for (const text of ['901..908', 'verified ليست true', 'difficultyTarget', 'المطلوب 8 بالضبط']) assert.ok(errors.some((e) => e.includes(text)), errors.join('\n'));
});

test('curated cards need a reviewable source; authored puzzles may reference an existing local record', async (t) => {
  const root = await fixture(t, (qs) => { qs[0].sourceUrl = record; });
  assert.deepEqual((await validateBank(root)).errors, []);
  const bad = await fixture(t, (qs) => { delete qs[0].sourceUrl; qs[1].sourceUrl = 'docs/bank/../missing.md'; });
  const { errors } = await validateBank(bad);
  assert.ok(errors.some((e) => e.includes('بلا مصدر للمراجعة')));
  assert.ok(errors.some((e) => e.includes('مصدر مراجعة غير صالح')));
});

function generated() {
  return { src: 'asset.webp', type: 'image', title: 'رسم توضيحي', author: 'ميدان', disclosure: 'صورة توضيحية مولّدة بالذكاء الاصطناعي',
    provenance: { kind: 'ai-generated', tool: 'Test image generator', createdAt: '2026-09-18', record } };
}
function withMedia(qs, media) { Object.assign(qs[0], { type: 'image', q: 'ما الأداة في الصورة؟', a: 'مطرقة', media }); }

test('AI artwork is accepted only as a local asset with an explicit disclosure and creation record', async (t) => {
  const root = await fixture(t, (qs) => withMedia(qs, generated()));
  assert.deepEqual((await validateBank(root)).errors, []);
  const cases = [
    [m => { delete m.disclosure; }, 'disclosure'],
    [m => { m.provenance.record = 'docs/bank/missing.json'; }, 'سجل إنشاء محليًا موجودًا'],
    [m => { m.provenance.createdAt = 'yesterday'; }, 'تاريخ إنشاء صالح'],
    [m => { m.provenance.tool = ''; }, 'أداة إنشاء'],
    [m => { m.license = 'CC BY 4.0'; }, 'ترخيص تصوير خارجي'],
    [m => { m.src = 'https://example.com/borrowed.webp'; }, 'ملفًا محليًا'],
  ];
  for (const [mutate, expected] of cases) {
    const bad = await fixture(t, (qs) => { const media = generated(); mutate(media); withMedia(qs, media); });
    const { errors } = await validateBank(bad);
    assert.ok(errors.some((e) => e.includes(expected)), errors.join('\n'));
  }
});

test('external media keeps its attribution and license checks; provenance cannot silently exempt it', async (t) => {
  const source = { src: 'asset.webp', type: 'image', title: 'Tool', author: 'Original photographer',
    sourceUrl: 'https://example.com/source', license: 'CC BY 4.0', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/' };
  const good = await fixture(t, (qs) => withMedia(qs, source));
  assert.deepEqual((await validateBank(good)).errors, []);
  const bad = await fixture(t, (qs) => withMedia(qs, { ...source, sourceUrl: '', license: 'CC BY-NC 4.0', provenance: { kind: 'unknown' } }));
  const { errors } = await validateBank(bad);
  for (const text of ['media بلا sourceUrl', 'ترخيص مرفوض', 'نوع provenance غير مدعوم']) assert.ok(errors.some((e) => e.includes(text)), errors.join('\n'));
});

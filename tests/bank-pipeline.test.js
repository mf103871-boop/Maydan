import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT, validateBank, writeIndex, placeholderFindings } from '../scripts/bank.mjs';

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

async function curatedPolicy(root) {
  const file = path.join(root, 'src/data/bank-status.json');
  const status = JSON.parse(await readFile(file, 'utf8'));
  await writeFile(file, JSON.stringify({ ...status, tierCount: 8, qidRange: { start: 901, end: 908 },
    difficultyTargets: { 200: .8, 400: .6, 600: .4, 800: .25, 1000: .15 } }));
}

test('curated pipeline caps tiers/topics and stamps the reviewed tier target with fresh identifiers', async (t) => {
  for (const command of ['append', 'merge']) {
    const root = await fixture(t, command === 'append' ? { id: 'trial', name: 'اختبار', icon: '🧩', qs: [] } : undefined);
    await curatedPolicy(root);
    const questions = Array.from({ length: 10 }, (_, i) => ({
      p: 200, q: `ما الحدث المرتبط بالبطاقة ${i} هنا؟`, a: `إجابة ${String.fromCharCode(0x641 + i)} خاصة`,
      topic: `مجال ${Math.floor(i / 2)}`, source: 'https://example.org/evidence',
    }));
    const checks = questions.map((_, i) => ({ i, verdict: 'fix', p: 400 }));
    const result = await run(root, command, questions, checks);
    assert.equal(result.status, 0, result.stderr);
    const pack = await readPack(root);
    assert.equal(pack.qs.length, 8);
    assert.deepEqual(pack.qs.map(q => q.qid), Array.from({ length: 8 }, (_, i) => `trial-400-${901 + i}`));
    for (const q of pack.qs) {
      assert.equal(q.p, 400);
      assert.equal(q.difficultyTarget, .6);
      assert.equal(q.source, 'https://example.org/evidence');
      assert.equal(q.verified, true);
    }
    const topicCounts = Object.values(Object.groupBy(pack.qs, q => q.topic)).map(qs => qs.length);
    assert.ok(topicCounts.every(n => n <= 2));
  }
});

test('curated pipeline cannot reuse retired range or overflow 908, and failed allocation writes nothing', async (t) => {
  for (const command of ['append', 'merge']) {
    const old = { id: 'trial', name: 'اختبار', icon: '🧩', qs: [] };
    const root = await fixture(t, command === 'append' ? old : undefined);
    await curatedPolicy(root);
    await mkdir(path.join(root, 'docs/bank'), { recursive: true });
    await writeFile(path.join(root, 'docs/bank/retired-qids.json'), JSON.stringify({
      ranges: [{ category: 'trial', tier: 200, start: 901, end: 908 }], qids: [],
    }));
    const result = await run(root, command, [candidate()], [{ i: 0, verdict: 'keep' }]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /نفدت المعرّفات/);
    if (command === 'append') assert.deepEqual(await readPack(root), old);
    else await assert.rejects(readPack(root), { code: 'ENOENT' });
  }
});

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

// ── قواعد المدقّق التي أُصلحت في هذه الجلسة ────────────────────────────────
// تعمل على مستودعات مؤقتة مُصنَّعة، فلا تتعلق بحالة البنك الحقيقي.
async function bankRoot(t, { categories, packs, index = true }) {
  const root = await mkdtemp(path.join(tmpdir(), 'bank-rules-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'src/data/categories'), { recursive: true });
  await writeFile(path.join(root, 'src/data/bank-status.json'), JSON.stringify({
    tierMin: 48, tiers: TIERS, maxQuestionWords: 22, maxAnswerWords: 6,
    mediaBudget: { imageKB: 30, audioKB: 50, categoryMB: 4 }, categories,
  }));
  for (const pack of packs) await writeFile(path.join(root, 'src/data/categories', `${pack.id}.json`), JSON.stringify(pack));
  if (index) await writeIndex(root);
  return root;
}
const TIERS = [200, 400, 600, 800, 1000];
const catMeta = (over = {}) => ({ name: 'اختبار', icon: '🧪', media: false, status: 'pending', counts: Object.fromEntries(TIERS.map((t) => [t, 0])), doneAt: null, order: 1, ...over });
// 25 سؤالًا سليمًا (فوق الحد الأدنى 24 لملف موجود) بنصوص وإجابات فريدة.
// الإجابات لا تنتهي برقم عمدًا كي لا يرصدها فحص «اسم + عدّاد».
function filler(id, start = 1) {
  const qs = [];
  let n = start;
  for (const p of TIERS) {
    for (let i = 0; i < 5; i += 1, n += 1) {
      qs.push({ p, qid: `${id}-${p}-${String(i + 1).padStart(3, '0')}`, q: `سؤال ${id} عن الموضوع ${n} ورقمه`, a: `جواب ${id} الموضوع ${n} المحدد`, topic: 'موضوع' });
    }
  }
  return qs;
}

test('تسريب الإجابة يسري على الأنواع كذلك، ولا يسري على order/odd/grid', async (t) => {
  const qs = [
    // نوع خاص وإجابته مكتوبة داخل نص سؤاله: كان يمرّ لأن للسؤال type
    { p: 200, qid: 'leak-200-901', type: 'image', q: 'أي مدينة هذه؟ إنها الإسكندرية بحرها', a: 'الإسكندرية', topic: 'موضوع' },
    // order لا إجابة مكتوبة له، فلا شيء يُسرَّب
    { p: 200, qid: 'leak-200-902', type: 'order', items: ['أ', 'ب', 'ج'], q: 'رتّب العناصر الثلاثة هنا', topic: 'موضوع' },
    ...filler('leak'),
  ].sort((a, b) => (a.p - b.p) || String(a.qid).localeCompare(String(b.qid)));
  const root = await bankRoot(t, { categories: { leak: catMeta() }, packs: [{ id: 'leak', name: 'تسريب', icon: '🧪', qs }] });
  const { errors } = await validateBank(root);
  assert.ok(errors.some((e) => e.includes('leak-200-901') && e.includes('مكتوبة داخل نص سؤالها')), errors.join('\n'));
  assert.ok(!errors.some((e) => e.includes('leak-200-902')), errors.join('\n'));
});

test('validate <id> يطبّق قواعد البنك العابرة: نص مكرر في فئة أخرى وqid مكرر', async (t) => {
  const shared = 'سؤال مشترك بين فئتين مختلفتين تمامًا هنا';
  const one = [{ p: 200, qid: 'one-200-901', q: shared, a: 'جواب الفئة الأولى هنا', topic: 'موضوع' }, ...filler('one')];
  const two = [{ p: 200, qid: 'one-200-901', q: shared, a: 'جواب الفئة الثانية هنا', topic: 'موضوع' }, ...filler('two')];
  const sort = (qs) => qs.sort((a, b) => (a.p - b.p) || String(a.qid).localeCompare(String(b.qid)));
  const root = await bankRoot(t, {
    categories: { one: catMeta({ order: 1 }), two: catMeta({ order: 2 }) },
    packs: [{ id: 'one', name: 'الأولى', icon: '١', qs: sort(one) }, { id: 'two', name: 'الثانية', icon: '٢', qs: sort(two) }],
  });
  const only = await validateBank(root, { only: 'two' });
  // الفئة الأخرى لا تُفحص هي نفسها، لكن أسئلتها مسجّلة في الجداول المشتركة
  assert.ok(only.errors.some((e) => e.startsWith('two:') && e.includes('نص مكرر عبر البنك')), only.errors.join('\n'));
  assert.ok(only.errors.some((e) => e.startsWith('two:') && e.includes('qid مكرر')), only.errors.join('\n'));
  assert.ok(!only.errors.some((e) => e.startsWith('one:')), 'لا تُبلَّغ أخطاء فئة لم تُطلب');
  assert.ok(only.categories.length === 1 && only.categories[0].id === 'two');
});

test('validate <id> يفحص index.js على مستوى البنك لا على الفئة وحدها', async (t) => {
  const sort = (qs) => qs.sort((a, b) => (a.p - b.p) || String(a.qid).localeCompare(String(b.qid)));
  const root = await bankRoot(t, {
    categories: { one: catMeta({ order: 1 }), two: catMeta({ order: 2 }) },
    packs: [{ id: 'one', name: 'الأولى', icon: '١', qs: sort(filler('one')) }, { id: 'two', name: 'الثانية', icon: '٢', qs: sort(filler('two')) }],
    index: false,
  });
  await writeFile(path.join(root, 'src/data/categories/index.js'), "import pack_one from './one.json' with { type: 'json' };\nexport const CATS = [pack_one];\n");
  const { errors } = await validateBank(root, { only: 'one' });
  assert.ok(errors.some((e) => e.includes('index.js لا يستورد two.json')), errors.join('\n'));
});

test('رصد الحشو: القوالب وسلاسل «اسم + عدّاد»، وإجابة حقيقية تنتهي برقم لا تُرصد', () => {
  const hit = (qs) => placeholderFindings(qs).map((f) => f.qid);
  assert.deepEqual(hit([
    { qid: 'a1', q: 'في «هجوم العمالقة»، ما المسمى الداخلي ق1؟', a: 'السور ق1' },
    { qid: 'a2', q: 'ما الرمز المعدود 3؟', a: 'أثر الضبع 3' },
    { qid: 'a3', q: 'ما متحف جاير تأكيدا لا؟', a: 'أندرسون فن' },
    { qid: 'a4', q: 'ما الكلمة الجامعة رقم 7؟', a: 'البتراء' },
    { qid: 'a5', q: 'ما اسم الخفير في شريحة 600؟', a: 'خفير 600' },
  ]), ['a1', 'a2', 'a3', 'a4', 'a5']);
  // «ما هذا الصوت رقم N»: يُرصد بإجابة عدّاد فقط، لا بإجابة حقيقية
  assert.deepEqual(hit([
    { qid: 's1', q: 'ما هذا الصوت رقم 53؟', a: 'نغمة 200' },
    { qid: 's2', q: 'ما هذا الصوت رقم 1؟', a: 'بيانو' },
  ]), ['s1']);
  // سلسلة «اسم + عدّاد» داخل الفئة: ثلاثة فأكثر بالجذر نفسه
  assert.deepEqual(hit([
    { qid: 'c1', q: 'أين يختلف الزوج رقم 1؟', a: 'بقعة حمراء 1' },
    { qid: 'c2', q: 'أين يختلف الزوج رقم 2؟', a: 'بقعة حمراء 2' },
    { qid: 'c3', q: 'أين يختلف الزوج رقم 3؟', a: 'بقعة حمراء 3' },
  ]), ['c1', 'c2', 'c3']);
  assert.deepEqual(hit([{ qid: 'c1', q: 'أين يختلف الزوج؟', a: 'بقعة حمراء 1' }, { qid: 'c2', q: 'أين يختلف الزوج الآخر؟', a: 'بقعة حمراء 2' }]), []);
  // إجابات حقيقية تنتهي برقم: لا تُرصد
  assert.deepEqual(hit([
    { qid: 'r1', q: 'ما اسم الرحلة التي حملت أول إنسان إلى القمر؟', a: 'أبولو 11' },
    { qid: 'r2', q: 'ما اسم أول مسبار بلغ الفضاء بين النجوم؟', a: 'فوياجر 1' },
    { qid: 'r3', q: 'ما رقم المنفذ الافتراضي لمواقع الويب غير المشفّرة؟', a: 'المنفذ 80' },
    { qid: 'r4', q: 'في أي عام هبط الإنسان على القمر؟', a: '1969' },
    { qid: 'r5', q: 'ما عاصمة مصر؟', a: 'القاهرة' },
  ]), []);
});

test('الحشو يرسب المدقّق في قناة مستقلة عن errors', async (t) => {
  const qs = [
    { p: 200, qid: 'fill-200-901', q: 'في العمل، ما المسمى الداخلي ق1؟', a: 'السور ق1', topic: 'موضوع' },
    ...filler('fill'),
  ].sort((a, b) => (a.p - b.p) || String(a.qid).localeCompare(String(b.qid)));
  const root = await bankRoot(t, { categories: { fill: catMeta() }, packs: [{ id: 'fill', name: 'حشو', icon: '🧪', qs }] });
  const { errors, placeholders } = await validateBank(root);
  assert.deepEqual(errors, [], 'الحشو لا يُخلط بأخطاء البنية');
  assert.equal(placeholders.length, 1);
  assert.equal(placeholders[0].id, 'fill');
  assert.equal(placeholders[0].count, 1);
  assert.deepEqual(placeholders[0].samples, ['fill-200-901']);
  // البنك الحقيقي خالٍ من الحشو منذ إعادة بناء sound وspotdiff (2026-09-15)، فالأمر ينجح
  const cli = spawnSync(process.execPath, [path.join(ROOT, 'scripts/bank.mjs'), 'placeholders'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(cli.status, 0, `البنك الحقيقي عاد إليه حشو:\n${cli.stdout}`);
  assert.match(cli.stdout, /^0 سؤال حشو في 0 فئة/m);
});

test('bank:status بمعرّف وحده يعرض الحالة بدل سطر الاستعمال', () => {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts/bank.mjs'), 'status', 'beforeafter'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /beforeafter/);
  assert.match(r.stdout, /الحالة:/);
  assert.match(r.stdout, /الخانات:/);
});

test('append and merge allocate within a category replacement range without reusing previous releases', async (t) => {
  for (const command of ['append', 'merge']) {
    for (const exhausted of [false, true]) {
      const initial = { id: 'trial', name: 'اختبار', icon: '🧩', qs: [] };
      const root = await fixture(t, command === 'append' ? initial : undefined);
      await curatedPolicy(root);
      const statusFile = path.join(root, 'src/data/bank-status.json');
      const status = JSON.parse(await readFile(statusFile, 'utf8'));
      status.categories.trial.qidRange = { start: 911, end: 918 };
      await writeFile(statusFile, JSON.stringify(status));
      await mkdir(path.join(root, 'docs/bank'), { recursive: true });
      await writeFile(path.join(root, 'docs/bank/retired-qids.json'), JSON.stringify({
        ranges: [{ category: 'trial', tier: 200, start: 901, end: exhausted ? 918 : 910 }], qids: [],
      }));
      const result = await run(root, command, [candidate()], [{ i: 0, verdict: 'keep' }]);
      if (!exhausted) {
        assert.equal(result.status, 0, result.stderr);
        assert.equal((await readPack(root)).qs[0].qid, 'trial-200-911');
      } else {
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /نفدت المعرّفات/);
        if (command === 'append') assert.deepEqual(await readPack(root), initial);
        else await assert.rejects(readPack(root), { code: 'ENOENT' });
      }
    }
  }
});

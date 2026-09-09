import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  ROOT,
  validateBank,
  sortQuestions,
  sortCategory,
  writeIndex,
  bankReport,
  setStatus,
  normalizeArabic,
  isAllowedLicense,
  wordCount,
  answerLeaks,
  STORY_CREDITS,
  STORY_ACTOR,
  fabricatedContentReasons,
  readRetiredQids,
} from '../scripts/bank.mjs';

// ── البنك الحقيقي ─────────────────────────────────────────────────────────
test('البنك الفعلي يجتاز bank:validate بلا أخطاء', async () => {
  const { errors } = await validateBank(ROOT);
  assert.deepEqual(errors, []);
});

test('bank-status.json: 79 فئة بترتيب فريد بعد حذف childhood، والحدود لم تُخفَّض', async () => {
  const status = JSON.parse(await readFile(path.join(ROOT, 'src/data/bank-status.json'), 'utf8'));
  // الحزم التجريبية (scripts/demo-packs.mjs) تُسجَّل مؤقتًا باسم demo[a-f] ولا تُحتسب
  const cats = Object.entries(status.categories).filter(([id]) => !/^demo[a-f]$/.test(id));
  assert.equal(cats.length, 79);
  assert.ok(!status.categories.childhood, 'childhood حُذفت بقرار صاحب المشروع');
  assert.equal(status.tierMin, 48, 'TIER_MIN لا يُخفَّض');
  assert.deepEqual(status.tiers, [200, 400, 600, 800, 1000]);
  assert.equal(status.maxQuestionWords, 22);
  assert.equal(status.maxAnswerWords, 6);
  const orders = cats.map(([, c]) => c.order);
  assert.equal(new Set(orders).size, 79, 'ترتيب مكرر');
  for (const [id, c] of cats) {
    assert.match(id, /^[a-z][a-z0-9]*$/, id);
    assert.ok(c.name && c.icon, `${id}: بلا اسم أو أيقونة`);
    assert.ok(['pending', 'done'].includes(c.status), `${id}: حالة غير صالحة`);
    assert.equal(typeof c.media, 'boolean', `${id}: media ليست منطقية`);
    for (const t of status.tiers) assert.equal(typeof c.counts[t], 'number', `${id}: عدّاد ${t}`);
  }
  assert.equal(cats.filter(([, c]) => c.media).length, 11, 'إحدى عشرة فئة وسائط بعد حذف childhood');
});

// ── أدوات صغيرة ───────────────────────────────────────────────────────────
test('normalizeArabic: تشكيل وهمزات وتاء مربوطة وترقيم', () => {
  assert.equal(normalizeArabic('ما عاصِمَةُ مِصْرَ؟'), normalizeArabic('ما عاصمه مصر'));
  assert.equal(normalizeArabic('الإسكندرية'), normalizeArabic('الاسكندريه'));
  assert.equal(normalizeArabic('مُوسى'), normalizeArabic('موسي'));
  assert.equal(normalizeArabic('  Paris,  France '), 'paris france');
  assert.notEqual(normalizeArabic('قمار'), normalizeArabic('أقمار'));
});

test('isAllowedLicense: CC0 والملك العام وBY وBY-SA فقط', () => {
  for (const ok of ['CC0 1.0', 'cc0', 'Public Domain', 'Public Domain (NASA)', 'PDM 1.0', 'CC BY 4.0', 'CC BY-SA 3.0', 'CC BY']) assert.ok(isAllowedLicense(ok), ok);
  for (const bad of ['CC BY-NC 4.0', 'CC BY-ND 4.0', 'CC BY-NC-SA 2.0', 'All rights reserved', 'Fair use', '', undefined, 'GFDL']) assert.ok(!isAllowedLicense(bad), String(bad));
});

test('wordCount وترتيب الأسئلة', () => {
  assert.equal(wordCount('  ما  عاصمة مصر؟ '), 3);
  assert.equal(wordCount(''), 0);
  const sorted = sortQuestions([{ p: 600, qid: 'x-600-002' }, { p: 200, qid: 'x-200-010' }, { p: 200, qid: 'x-200-002' }, { p: 600, qid: 'x-600-001' }]);
  assert.deepEqual(sorted.map((q) => q.qid), ['x-200-002', 'x-200-010', 'x-600-001', 'x-600-002']);
});

test('القوالب المعروفة لا تمر كحقائق، والأرقام الحقيقية لا تُرفض', () => {
  for (const q of [
    { q: 'في مستوى ٢٠٠، ما الاسم رقم ١ المرتبط بفئة «أفلام»؟', a: 'العراب، مستوى ٢٠٠' },
    { q: 'ما الفريق المرتبط بموسم 01 (200-001)؟', a: 'فريق 200-001' },
    { q: 'نص مختلف', a: 'كلمة — معنى 123' },
    { q: 'نص مختلف', a: 'اسم', alt: ['اسم، مستوى 400'] },
  ]) assert.ok(fabricatedContentReasons(q).length, JSON.stringify(q));
  for (const q of [
    { q: 'ما رقم القميص الشهير لميسي مع برشلونة؟', a: '10' },
    { q: 'ما اسم العملة اليابانية؟', a: 'الين' },
    { q: 'ما الاسم الذي يطلق على مجموعة من ألف عنصر؟', a: 'ألف' },
  ]) assert.deepEqual(fabricatedContentReasons(q), []);
});

test('المدقّق يرفض القوالب حتى مع verified وحدود وأعداد صحيحة', async () => {
  const qs = makeQuestions('fake', 5);
  qs[0] = { ...qs[0], q: 'في مستوى 200، ما الاسم رقم 1 المرتبط بفئة «أنمي»؟', a: 'إيرين، مستوى 200' };
  const root = await makeRoot({ categories: { fake: meta() }, packs: [{ id: 'fake', name: 'ف', icon: 'f', qs }] });
  try {
    const { errors } = await validateBank(root);
    assert.ok(errors.some((e) => e.includes('fake-200-001: سؤال قالبي')));
    assert.ok(errors.some((e) => e.includes('fake-200-001: إجابة تحمل لاحقة')));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('المعرّفات المتقاعدة: توسيع النطاقات ورفض إعادة الاستخدام حتى بعد تغيير الشريحة', async () => {
  const qs = makeQuestions('retired', 5);
  qs[0].p = 400;
  const root = await makeRoot({ categories: { retired: meta() }, packs: [{ id: 'retired', name: 'متقاعد', icon: 'r', qs: sortQuestions(qs) }] });
  try {
    assert.equal((await readRetiredQids(root)).size, 0);
    await mkdir(path.join(root, 'docs/bank'), { recursive: true });
    const file = path.join(root, 'docs/bank/retired-qids.json');
    await writeFile(file, JSON.stringify({ ranges: [{ category: 'retired', tier: 200, start: 1, end: 2 }], qids: ['retired-1000-099'] }));
    assert.deepEqual([...await readRetiredQids(root)].sort(), ['retired-1000-099', 'retired-200-001', 'retired-200-002']);
    const { errors } = await validateBank(root);
    assert.ok(errors.some(e => e.includes('retired-200-001: معرّف محذوف سابقًا')));
    assert.ok(errors.some(e => e.includes('retired-200-002: معرّف محذوف سابقًا')));
    await writeFile(file, JSON.stringify({ ranges: [{ tier: 200, start: 1, end: 2 }], qids: [] }));
    await assert.rejects(readRetiredQids(root), /نطاق غير صالح/);
    assert.ok((await validateBank(root)).errors.some(e => e.includes('سجل المعرّفات المحذوفة')));
  } finally { await rm(root, { recursive: true, force: true }); }
});

// ── المدقّق على مستودع مؤقت ────────────────────────────────────────────────
const TIERS = [200, 400, 600, 800, 1000];
const TOPICS = ['أ', 'ب', 'ج', 'د', 'هـ', 'و'];

function makeQuestions(id, perTier, { verified = true, topic = true } = {}) {
  const qs = [];
  for (const p of TIERS) {
    for (let n = 1; n <= perTier; n += 1) {
      const q = { p, q: `سؤال ${id} ${p} رقم ${n}؟`, a: `جواب ${id} ${p} ${n}`, qid: `${id}-${p}-${String(n).padStart(3, '0')}` };
      if (verified) q.verified = true;
      if (topic) q.topic = TOPICS[n % TOPICS.length];
      qs.push(q);
    }
  }
  return sortQuestions(qs);
}

async function makeRoot({ categories, packs, files = {} }) {
  const root = await mkdtemp(path.join(tmpdir(), 'maydan-bank-'));
  await mkdir(path.join(root, 'src/data/categories'), { recursive: true });
  const status = {
    tierMin: 48, tiers: TIERS, maxQuestionWords: 22, maxAnswerWords: 6,
    mediaBudget: { imageKB: 30, audioKB: 50, categoryMB: 4 },
    categories,
  };
  await writeFile(path.join(root, 'src/data/bank-status.json'), JSON.stringify(status));
  for (const pack of packs) await writeFile(path.join(root, 'src/data/categories', `${pack.id}.json`), JSON.stringify(pack));
  for (const [rel, body] of Object.entries(files)) {
    const full = path.join(root, 'media', rel);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, body);
  }
  await writeIndex(root);
  return root;
}

const counts = (perTier) => Object.fromEntries(TIERS.map((t) => [t, perTier]));
const meta = (over = {}) => ({ name: 'اختبار', icon: '🧪', media: false, status: 'pending', counts: counts(0), doneAt: null, order: 1, ...over });

test('فئة مكتملة سليمة: 48 لكل خانة، مواضيع، تحقق، ترتيب', async () => {
  const qs = makeQuestions('geo', 48);
  const root = await makeRoot({
    categories: { geo: meta({ status: 'done', counts: counts(48), doneAt: '2026-09-06T00:00:00Z' }) },
    packs: [{ id: 'geo', name: 'جغرافيا', icon: '🌍', qs }],
  });
  const { errors, categories } = await validateBank(root);
  assert.deepEqual(errors, []);
  assert.equal(categories[0].total, 240);
  await rm(root, { recursive: true, force: true });
});

test('فئة مكتملة ناقصة خانة، أو بلا verified، أو موضوع متضخّم → أخطاء', async () => {
  const qs = makeQuestions('geo', 48);
  qs.pop(); // ينقص سؤال من 1000
  const noVerified = makeQuestions('sci', 48, { verified: false });
  const lopsided = makeQuestions('his', 48).map((q) => ({ ...q, topic: q.p === 200 ? 'واحد' : q.topic }));
  const root = await makeRoot({
    categories: {
      geo: meta({ status: 'done', counts: { ...counts(48), 1000: 47 }, doneAt: 'x', order: 1 }),
      sci: meta({ status: 'done', counts: counts(48), doneAt: 'x', order: 2 }),
      his: meta({ status: 'done', counts: counts(48), doneAt: 'x', order: 3 }),
    },
    packs: [
      { id: 'geo', name: 'ج', icon: '🌍', qs },
      { id: 'sci', name: 'ع', icon: '🔬', qs: noVerified },
      { id: 'his', name: 'ت', icon: '📜', qs: lopsided },
    ],
  });
  const { errors } = await validateBank(root);
  const has = (s) => errors.some((e) => e.includes(s));
  assert.ok(has('geo: خانة 1000: 47 سؤالًا والحد 48'), errors.join('\n'));
  assert.ok(has('sci: sci-200-001: verified ليست true'));
  assert.ok(has('his: خانة 200: موضوع «واحد» يشغل 100% والحد 25%'));
  await rm(root, { recursive: true, force: true });
});

test('التكرار: نص السؤال عبر الفئات خطأ، والإجابة داخل الفئة خطأ، وعبر الفئات تحذير فقط', async () => {
  const a = makeQuestions('aaa', 5);
  const b = makeQuestions('bbb', 5);
  b[0].q = 'سؤال aaa 200 رقم 1؟'; // نفس نص سؤال في aaa
  a[1].a = a[2].a; // إجابة مكررة داخل aaa
  b[3].a = a[4].a; // نفس الإجابة في فئتين
  const root = await makeRoot({ categories: { aaa: meta({ order: 1 }), bbb: meta({ order: 2 }) }, packs: [{ id: 'aaa', name: 'أ', icon: 'a', qs: a }, { id: 'bbb', name: 'ب', icon: 'b', qs: b }] });
  const { errors, warnings } = await validateBank(root);
  assert.ok(errors.some((e) => e.startsWith('bbb: bbb-200-001: نص مكرر عبر البنك')), errors.join('\n'));
  assert.ok(errors.some((e) => e.includes('aaa: aaa-200-003: إجابة مكررة داخل الفئة')), errors.join('\n'));
  assert.ok(!errors.some((e) => e.includes('bbb-200-004')), 'التكرار عبر الفئات ليس خطأ');
  assert.ok(warnings.some((w) => w.includes('إجابة تتكرر في أكثر من فئة')));
  await rm(root, { recursive: true, force: true });
});

test('حدود الكلمات، الترتيب، معرّف من فئة أخرى، نوع مجهول، choice بلا خيار صحيح', async () => {
  const qs = makeQuestions('geo', 5);
  qs[0].q = Array.from({ length: 23 }, (_, i) => `كلمة${i}`).join(' ');
  qs[1].a = 'واحد اثنان ثلاثة أربعة خمسة ستة سبعة';
  qs[2].qid = 'sci-200-099';
  qs[3].type = 'weird';
  qs[4] = { ...qs[4], type: 'choice', options: ['أ', 'ب'], a: 'ج' };
  const unsorted = [qs[qs.length - 1], ...qs.slice(0, -1)];
  const root = await makeRoot({ categories: { geo: meta() }, packs: [{ id: 'geo', name: 'ج', icon: 'g', qs: unsorted }] });
  const { errors } = await validateBank(root);
  const has = (s) => errors.some((e) => e.includes(s));
  assert.ok(has('نص السؤال 23 كلمة والحد 22'), errors.join('\n'));
  assert.ok(has('الإجابة 7 كلمات والحد 6'));
  assert.ok(has('sci-200-099: qid لا يبدأ بمعرّف الفئة'));
  assert.ok(has('نوع غير معروف: weird'));
  assert.ok(has('إجابة choice ليست ضمن options'));
  assert.ok(has('الملف غير مرتّب'));
  await rm(root, { recursive: true, force: true });
});

test('الوسائط: كائن إسناد كامل وملف موجود ضمن الميزانية يمرّ؛ نص مجرد أو ترخيص NC أو ملف مفقود أو ضخم يرسب', async () => {
  const good = { src: 'ok.webp', type: 'image', title: 'Lion', sourceUrl: 'https://commons.wikimedia.org/wiki/File:Lion.jpg', author: 'Someone', license: 'CC BY-SA 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/' };
  const qs = sortQuestions([
    { p: 200, qid: 'pic-200-001', type: 'image', q: '', a: 'أسد', media: good },
    { p: 200, qid: 'pic-200-002', type: 'image', a: 'نمر', media: 'plain.webp' },
    { p: 400, qid: 'pic-400-001', type: 'image', a: 'فهد', media: { ...good, src: 'nc.webp', license: 'CC BY-NC 4.0' } },
    { p: 400, qid: 'pic-400-002', type: 'image', a: 'ذئب', media: { ...good, src: 'missing.webp' } },
    { p: 600, qid: 'pic-600-001', type: 'audio', a: 'زئير', media: { ...good, src: 'big.mp3', type: 'audio' } },
    { p: 600, qid: 'pic-600-002', q: 'سؤال نصي في فئة وسائط؟', a: 'لا' },
  ]);
  const root = await makeRoot({
    categories: { pic: meta({ media: true }) },
    packs: [{ id: 'pic', name: 'صور', icon: '🖼️', qs }],
    files: { 'pic/ok.webp': 'x'.repeat(1000), 'pic/plain.webp': 'x', 'pic/nc.webp': 'x', 'pic/big.mp3': 'x'.repeat(51 * 1024) },
  });
  const { errors } = await validateBank(root);
  const has = (s) => errors.some((e) => e.includes(s));
  assert.ok(!errors.some((e) => e.includes('pic-200-001')), `السؤال السليم رسب: ${errors.join(' | ')}`);
  assert.ok(has('pic-200-002: media نص مجرد'));
  assert.ok(has('pic-400-001: ترخيص مرفوض: CC BY-NC 4.0'));
  assert.ok(has('pic-400-002: الملف غير موجود'));
  assert.ok(has('big.mp3 حجمه 51.0 KB والحد 50 KB'));
  assert.ok(has('pic-600-002: فئة وسائط لكن السؤال من نوع نصي'));
  assert.ok(has('pic-600-002: سؤال بلا نص') === false, 'السؤال النصي له نص');
  await rm(root, { recursive: true, force: true });
});

test('الدراما: أسئلة الصنّاع ممنوعة، والممثلون في 800/1000 فقط وبحد 20%', async () => {
  const qs = makeQuestions('bab', 5);
  qs[0].q = 'من أخرج مسلسل باب الحارة؟';
  qs[1].q = 'من الممثل الذي أدى دور أبو عصام؟'; // في 200
  const root = await makeRoot({ categories: { bab: meta({ style: 'story' }) }, packs: [{ id: 'bab', name: 'باب الحارة', icon: '🚪', style: 'story', qs }] });
  const { errors } = await validateBank(root);
  assert.ok(errors.some((e) => e.includes('سؤال عن المخرج')), errors.join('\n'));
  assert.ok(errors.some((e) => e.includes('سؤال عن الممثلين يجب أن يكون في خانة 800 أو 1000')));
  const root2 = await makeRoot({ categories: { bab: meta({ style: 'story' }) }, packs: [{ id: 'bab', name: 'ب', icon: 'b', qs: makeQuestions('bab', 5) }] });
  const r2 = await validateBank(root2);
  assert.ok(r2.errors.some((e) => e.includes('فئة درامية بلا "style": "story"')));
  await rm(root, { recursive: true, force: true });
  await rm(root2, { recursive: true, force: true });
});

test('sort يرتّب الملف ويعيد توليد index.js بترتيب الحالة، وstatus done يحدّث الأعداد', async () => {
  const qs = makeQuestions('zzz', 2).reverse();
  const root = await makeRoot({ categories: { aaa: meta({ order: 2 }), zzz: meta({ order: 1 }) }, packs: [{ id: 'zzz', name: 'ز', icon: 'z', qs }, { id: 'aaa', name: 'أ', icon: 'a', qs: makeQuestions('aaa', 5) }] });
  await sortCategory(root, 'zzz');
  const pack = JSON.parse(await readFile(path.join(root, 'src/data/categories/zzz.json'), 'utf8'));
  assert.deepEqual(pack.qs.map((q) => q.qid).slice(0, 3), ['zzz-200-001', 'zzz-200-002', 'zzz-400-001']);
  await writeIndex(root);
  const index = await readFile(path.join(root, 'src/data/categories/index.js'), 'utf8');
  assert.ok(index.indexOf("'./zzz.json'") < index.indexOf("'./aaa.json'"), 'الترتيب حسب order');
  assert.ok(index.includes('export const CATS = [pack_zzz, pack_aaa];'));
  const r = await setStatus(root, 'aaa', 'done');
  assert.equal(r.counts[200], 5);
  const status = JSON.parse(await readFile(path.join(root, 'src/data/bank-status.json'), 'utf8'));
  assert.equal(status.categories.aaa.status, 'done');
  assert.ok(status.categories.aaa.doneAt);
  const report = await bankReport(root);
  assert.equal(report.done, 1);
  assert.equal(report.questions, 35);
  await rm(root, { recursive: true, force: true });
});

test('فئة pending بملف أقل من 24 سؤالًا ترسب، وفئة done بلا ملف ترسب', async () => {
  const root = await makeRoot({ categories: { tiny: meta({ order: 1 }), ghost: meta({ status: 'done', order: 2 }) }, packs: [{ id: 'tiny', name: 'ص', icon: 't', qs: makeQuestions('tiny', 4) }] });
  const { errors } = await validateBank(root);
  assert.ok(errors.some((e) => e.includes('tiny: 20 سؤالًا فقط والحد الأدنى لملف موجود 24')), errors.join('\n'));
  assert.ok(errors.some((e) => e.includes('ghost: مسجّلة done ولا ملف لها')));
  await rm(root, { recursive: true, force: true });
});

test('answerLeaks: كلمة كاملة مع السوابق، لا مقطع داخل كلمة', () => {
  const n = normalizeArabic;
  assert.ok(answerLeaks(n('مصر'), n('ما عاصمة مصر؟')));
  assert.ok(answerLeaks(n('مصر'), n('أين تقع القاهرة بمصر؟')), 'سابقة الباء');
  assert.ok(answerLeaks(n('نيل'), n('ما أطول نهر في العالم؟ النيل')), 'أل التعريف');
  assert.ok(!answerLeaks(n('مصر'), n('ما أكبر مصرف في الخليج؟')), 'مصرف ليست مصر');
  assert.ok(!answerLeaks(n('علي'), n('ما اسم عليّة البيت؟')), 'مقطع داخل كلمة');
  assert.ok(answerLeaks(n('أبو ظبي'), n('ما عاصمة الإمارات؟ أبو ظبي طبعًا')), 'إجابة من كلمتين');
});

test('أنماط الدراما: تلتقط صيغ السؤال عن الصنّاع ولا تلتقط الكلمات العادية', () => {
  const hit = (t) => STORY_CREDITS.some(([re]) => re.test(t));
  for (const bad of ['من أخرج مسلسل باب الحارة؟', 'من مخرج الجزء الثاني؟', 'من كتب سيناريو المسلسل؟', 'من مؤلف مانغا ون بيس؟', 'في أي عام عُرض المسلسل لأول مرة؟', 'كم موسمًا للمسلسل؟', 'ما اسم شركة الإنتاج؟', 'أي استوديو أنتج الأنمي؟']) {
    assert.ok(hit(bad), `يجب أن يُلتقط: ${bad}`);
  }
  for (const ok of ['ما اسم المخرج السري الذي هرب منه أبو عصام؟', 'ما المنتج الذي كان يبيعه أبو شهاب في السوق؟', 'ما اسم الاستوديو الذي اختبأ فيه البطل في الحلقة الأخيرة؟', 'من قال «الحارة كلها تحت أمرك»؟']) {
    assert.ok(!hit(ok), `لا يجب أن يُلتقط: ${ok}`);
  }
  assert.ok(STORY_ACTOR.test('من الممثل الذي أدى دور أبو عصام؟'));
  assert.ok(STORY_ACTOR.test('من يؤدي صوت لوفي بالعربية؟'));
  assert.ok(!STORY_ACTOR.test('من أدى القسم أمام الزعيم في الحلقة الأولى؟'), 'أدى بلا شخصية/دور ليس سؤال ممثلين');
});

test('صح/خطأ والاختيار: تكرار الإجابة طبيعي ولا يُعدّ خطأ', async () => {
  const qs = sortQuestions([
    { p: 200, qid: 'tf-200-001', type: 'truefalse', q: 'الشمس نجم.', a: 'صح' },
    { p: 200, qid: 'tf-200-002', type: 'truefalse', q: 'القمر كوكب.', a: 'خطأ' },
    { p: 400, qid: 'tf-400-001', type: 'truefalse', q: 'الماء يغلي عند 100 درجة.', a: 'صح' },
    { p: 400, qid: 'tf-400-002', type: 'choice', q: 'أيهما أولًا؟', options: ['أ', 'ب'], a: 'أ' },
    { p: 600, qid: 'tf-600-001', type: 'choice', q: 'أيهما أكبر؟', options: ['أ', 'ب'], a: 'أ' },
    ...makeQuestions('tf', 4).filter((q) => q.p >= 600).slice(0, 19),
  ]);
  const root = await makeRoot({ categories: { tf: meta() }, packs: [{ id: 'tf', name: 'صح أم خطأ', icon: '✅', qs }] });
  const { errors } = await validateBank(root);
  assert.ok(!errors.some((e) => e.includes('إجابة مكررة')), errors.join('\n'));
  await rm(root, { recursive: true, force: true });
});

test('وسيط data: لا يُسقط المدقّق، وvideo يُفحص عدده وامتداده، وvalidate <id> يكشف done بلا ملف', async () => {
  const credit = { type: 'image', title: 't', sourceUrl: 'https://x/y', author: 'a', license: 'CC0 1.0', licenseUrl: 'https://cc0' };
  const qs = sortQuestions([
    { p: 200, qid: 'vv-200-001', type: 'image', a: 'دائرة', media: { ...credit, src: 'data:image/png;base64,AAAA' } },
    { p: 200, qid: 'vv-200-002', type: 'video', a: 'كرة', media: { ...credit, type: 'video', src: 'clip.mp3' } },
    { p: 400, qid: 'vv-400-001', type: 'video', a: 'قطة', media: [{ ...credit, type: 'video', src: 'a.mp4' }, { ...credit, type: 'video', src: 'b.mp4' }] },
    ...makeQuestions('vv', 5).slice(3, 24),
  ]);
  const root = await makeRoot({ categories: { vv: meta({ order: 1 }), gone: meta({ status: 'done', order: 2 }) }, packs: [{ id: 'vv', name: 'ف', icon: 'v', qs }], files: { 'vv/clip.mp3': 'x', 'vv/a.mp4': 'x', 'vv/b.mp4': 'x' } });
  const { errors, warnings } = await validateBank(root, { only: 'vv' });
  assert.ok(warnings.some((w) => w.includes('vv-200-001: وسيط مضمّن data:')), warnings.join('\n'));
  assert.ok(!errors.some((e) => e.includes('vv-200-001')), errors.join('\n'));
  assert.ok(errors.some((e) => e.includes('vv-200-002: سؤال فيديو بملف ليس فيديو')), errors.join('\n'));
  assert.ok(errors.some((e) => e.includes('vv-400-001: سؤال فيديو يحتاج ملفًا واحدًا')), errors.join('\n'));
  const only = await validateBank(root, { only: 'gone' });
  assert.deepEqual(only.errors, ['gone: مسجّلة done ولا ملف لها']);
  await rm(root, { recursive: true, force: true });
});

test('أربع صور لا تقبل مؤثرًا، والمؤثر المجهول يرسب', async () => {
  const credit = { type: 'image', title: 't', sourceUrl: 'https://x/y', author: 'a', license: 'CC0 1.0', licenseUrl: 'https://cc0' };
  const four = (n) => Array.from({ length: 4 }, (_, i) => ({ ...credit, src: `${n}-${i}.webp` }));
  const qs = sortQuestions([
    { p: 200, qid: 'fp-200-001', type: 'image', effect: 'blur', a: 'أشكال', media: four('a') },
    { p: 200, qid: 'fp-200-002', type: 'image', a: 'أشكال هندسية', media: four('b') },
    { p: 400, qid: 'fp-400-001', type: 'image', effect: 'sparkle', a: 'دائرة', media: { ...credit, src: 'c.webp' } },
    ...makeQuestions('fp', 5).slice(3, 24),
  ]);
  const files = {};
  for (const n of ['a', 'b']) for (let i = 0; i < 4; i += 1) files[`fp/${n}-${i}.webp`] = 'x';
  files['fp/c.webp'] = 'x';
  const root = await makeRoot({ categories: { fp: meta({ media: true }) }, packs: [{ id: 'fp', name: 'أربع', icon: '🖼️', qs }], files });
  const { errors } = await validateBank(root);
  assert.ok(errors.some((e) => e.includes('fp-200-001: أربع صور لا تقبل مؤثرًا (blur)')), errors.join('\n'));
  assert.ok(!errors.some((e) => e.includes('fp-200-002')), 'أربع صور بلا مؤثر سليمة');
  assert.ok(errors.some((e) => e.includes('fp-400-001: مؤثر صورة غير معروف: sparkle')));
  await rm(root, { recursive: true, force: true });
});

test('التطبيع موحّد بين المدقّق والواجهة: ما يقبله المدقّق خيارًا تُبرزه الشاشة', async () => {
  const { arabicNormalize } = await import('../src/shared/lib/arabicNormalize.js');
  assert.equal(normalizeArabic, arabicNormalize, 'المدقّق يستعمل الموحّد نفسه');
  for (const [a, b] of [['بي-بي-سي', 'بي بي سي'], ['الطائف', 'الطايف'], ['١٩٤٥', '1945'], ['قال — ثم', 'قال ثم']]) {
    assert.equal(arabicNormalize(a), arabicNormalize(b), `${a} ≟ ${b}`);
  }
});

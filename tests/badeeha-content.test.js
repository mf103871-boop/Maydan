import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

// حزم أسئلة «بَديهة». البنك يُعاد بناؤه حزمة حزمة، فالاختبارات تتحقق مما هو
// موجود فعلًا بدل أن تفرض عددًا ثابتًا من الحزم.
const dir = path.resolve('src/data/categories');
const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
const cats = files.map((f) => JSON.parse(readFileSync(path.join(dir, f), 'utf8')));
const TIERS = [200, 400, 600, 800, 1000];
const MIN_PER_PACK = 24;

test('كل حزمة لها معرّف واسم وأيقونة، والمعرّفات فريدة', () => {
  assert.equal(new Set(cats.map((c) => c.id)).size, cats.length, 'معرّف حزمة مكرر');
  for (const c of cats) {
    assert.match(c.id, /^[a-z][a-z0-9]*$/, `${c.id}: معرّف غير صالح`);
    assert.ok(c.name && c.name.trim(), `${c.id}: بلا اسم`);
    assert.ok(c.icon && c.icon.trim(), `${c.id}: بلا أيقونة`);
    assert.ok(Array.isArray(c.qs), `${c.id}: بلا مصفوفة أسئلة`);
  }
});

test(`كل حزمة ≥ ${MIN_PER_PACK} سؤالًا، وفيها أسئلة بكل شريحة من 200 إلى 1000`, () => {
  for (const c of cats) {
    assert.ok(c.qs.length >= MIN_PER_PACK, `${c.id}: ${c.qs.length} سؤالًا فقط`);
    const tiers = new Set(c.qs.map((q) => q.p));
    for (const p of TIERS) assert.ok(tiers.has(p), `${c.id}: لا أسئلة بشريحة ${p}`);
  }
});

test('المعرّفات فريدة عبر البنك كله، ولا سؤال بلا نص أو إجابة', () => {
  const all = cats.flatMap((c) => c.qs.map((q) => ({ ...q, cat: c.id })));
  assert.equal(new Set(all.map((q) => q.qid)).size, all.length, 'qid مكرر');
  for (const q of all) {
    assert.match(String(q.qid || ''), /^[0-9a-f]{12}$/, `${q.cat}: qid غير صالح (${q.qid})`);
    assert.ok(TIERS.includes(q.p), `${q.cat}/${q.qid}: نقاط غير صالحة`);
    const hasPrompt = (q.q && String(q.q).trim()) || q.type;
    assert.ok(hasPrompt, `${q.cat}/${q.qid}: سؤال بلا نص`);
    const noWrittenAnswer = ['order', 'odd', 'grid'].includes(q.type);
    assert.ok(noWrittenAnswer || (q.a && String(q.a).trim()), `${q.cat}/${q.qid}: سؤال بلا إجابة`);
  }
});

test('لا سؤال مكرر نصًا داخل الحزمة، ولا إجابة مكشوفة في سؤال آخر منها', () => {
  const norm = (s) => String(s || '')
    .replace(/[ً-ْـ]/g, '')
    .replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي')
    .replace(/[«»"'؟?.,،:؛()]/g, ' ')
    .replace(/\s+/g, ' ').trim();
  for (const c of cats) {
    const texts = c.qs.filter((q) => q.q).map((q) => norm(q.q));
    // الفئات ذات النمط الواحد (مثل شبكات التركيز) تتعمّد تكرار نص الطلب
    if (!c.qs.some((q) => q.type)) {
      assert.equal(new Set(texts).size, texts.length, `${c.id}: سؤال مكرر نصًا`);
    }
    for (const q of c.qs) {
      if (!q.a || q.type) continue;
      const answer = norm(q.a);
      if (answer.length < 4) continue;
      for (const other of c.qs) {
        if (other.qid === q.qid || !other.q) continue;
        assert.ok(!norm(other.q).includes(answer), `${c.id}: إجابة ${q.qid} «${q.a}» مكشوفة في نص ${other.qid}`);
      }
    }
  }
});

// حزم الأعمال الدرامية والأنمي تُعلَّم بـ "style": "story"، فتُمنع فيها أسئلة
// الإنتاج: صاحب اللعبة يريد أسئلة عن أحداث العمل لا عن مخرجه ومؤلفه.
const CREDITS = [
  [/من أخرج|المخرج|أخرجه\b|مخرج مسلسل|مخرج فيلم/, 'المخرج'],
  [/من كتب|كاتب السيناريو|السيناريو والحوار|الكاتبان|الكاتبتان|من كتبت/, 'الكاتب'],
  [/الموسيقى التصويرية|من لحّن|الملحن/, 'الملحن'],
  [/استوديو|شركة الإنتاج|من أنتج/, 'الإنتاج'],
  [/بدأ عرض|عُرض عام|بدأ بثه|القناة التي عرضت/, 'تاريخ العرض'],
  [/عدد المواسم|عدد مواسم|كم موسمًا|عدد الحلقات|كم حلقة/, 'عدد المواسم أو الحلقات'],
  [/جائزة|أوسكار/, 'الجوائز'],
  [/مؤلف مانغا|من مبتكر|رسّام المانغا/, 'مؤلف المانغا'],
  [/قائمة طاقم|طاقم الجزء|طاقم العمل/, 'قائمة الطاقم'],
];
const ACTOR = /من الممثل الذي أدى|من الممثلة التي أدت|من أدى شخصية|من أدت شخصية|من أدى دور|من الفنان الذي أدى|من الفنانة التي أدت|الذي جسّد شخصية/;
const ACTOR_LIMIT = 2;

test('حزم المسلسلات والأنمي: أسئلة عن أحداث العمل لا عن صناعته', () => {
  for (const c of cats.filter((x) => x.style === 'story')) {
    for (const q of c.qs) {
      const text = `${q.q || ''} ${q.a || ''}`;
      for (const [pattern, label] of CREDITS) {
        assert.ok(!pattern.test(text), `${c.id}/${q.qid}: سؤال عن ${label} بدل أحداث العمل — «${q.q}»`);
      }
    }
    const actors = c.qs.filter((q) => ACTOR.test(q.q || ''));
    assert.ok(actors.length <= ACTOR_LIMIT, `${c.id}: ${actors.length} أسئلة عن الممثلين والحد ${ACTOR_LIMIT}`);
  }
});

test('index.js يستورد كل ملفات الحزم الموجودة', () => {
  const src = readFileSync(path.join(dir, 'index.js'), 'utf8');
  for (const f of files) assert.ok(src.includes(`./${f}`), `index.js لا يستورد ${f}`);
  const imported = (src.match(/from ['"]\.\/[a-z0-9]+\.json['"]/g) || []).length;
  assert.equal(imported, files.length, 'عدد الاستيرادات لا يطابق عدد ملفات الحزم');
});

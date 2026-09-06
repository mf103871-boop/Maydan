import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { STORY_CREDITS, STORY_ACTOR, answerLeaks } from '../scripts/bank.mjs';

// حزم أسئلة «بَديهة». البنك يُعاد بناؤه حزمة حزمة، فالاختبارات تتحقق مما هو
// موجود فعلًا بدل أن تفرض عددًا ثابتًا من الحزم.
const dir = path.resolve('src/data/categories');
const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
const cats = files.map((f) => JSON.parse(readFileSync(path.join(dir, f), 'utf8')));
// الحدود من ملف الحالة: الفئة «done» تُفحص بصرامة (48 لكل خانة)، و«pending» بحد أدنى 24 إجمالًا.
const STATUS = JSON.parse(readFileSync(path.resolve('src/data/bank-status.json'), 'utf8'));
const TIERS = STATUS.tiers;
const TIER_MIN = STATUS.tierMin;
const MIN_PER_PACK = 24;
const QID = /^(?:[0-9a-f]{12}|[a-z][a-z0-9]*-(?:200|400|600|800|1000)-\d{3})$/;

test('كل حزمة لها معرّف واسم وأيقونة، والمعرّفات فريدة', () => {
  assert.equal(new Set(cats.map((c) => c.id)).size, cats.length, 'معرّف حزمة مكرر');
  for (const c of cats) {
    assert.match(c.id, /^[a-z][a-z0-9]*$/, `${c.id}: معرّف غير صالح`);
    assert.ok(c.name && c.name.trim(), `${c.id}: بلا اسم`);
    assert.ok(c.icon && c.icon.trim(), `${c.id}: بلا أيقونة`);
    assert.ok(Array.isArray(c.qs), `${c.id}: بلا مصفوفة أسئلة`);
  }
});

test(`كل حزمة مسجّلة في bank-status.json، وpending ≥ ${MIN_PER_PACK} سؤالًا، وdone ≥ ${TIER_MIN} في كل شريحة`, () => {
  assert.equal(TIER_MIN, 48, 'TIER_MIN لا يُخفَّض لتمرير الاختبارات');
  for (const c of cats) {
    const meta = STATUS.categories[c.id];
    assert.ok(meta, `${c.id}: ليست في bank-status.json`);
    const perTier = Object.fromEntries(TIERS.map((t) => [t, c.qs.filter((q) => q.p === t).length]));
    if (meta.status === 'done') {
      for (const p of TIERS) assert.ok(perTier[p] >= TIER_MIN, `${c.id}: شريحة ${p} فيها ${perTier[p]} والحد ${TIER_MIN}`);
      for (const p of TIERS) assert.equal(meta.counts[p], perTier[p], `${c.id}: bank-status لا يطابق الملف في شريحة ${p}`);
      assert.ok(meta.doneAt, `${c.id}: done بلا doneAt`);
    } else {
      assert.ok(c.qs.length >= MIN_PER_PACK, `${c.id}: ${c.qs.length} سؤالًا فقط`);
      for (const p of TIERS) assert.ok(perTier[p] > 0, `${c.id}: لا أسئلة بشريحة ${p}`);
    }
  }
  for (const [id, meta] of Object.entries(STATUS.categories)) {
    if (meta.status === 'done') assert.ok(files.includes(`${id}.json`), `${id}: مسجّلة done ولا ملف لها`);
  }
});

test('المعرّفات فريدة عبر البنك كله، ولا سؤال بلا نص أو إجابة', () => {
  const all = cats.flatMap((c) => c.qs.map((q) => ({ ...q, cat: c.id })));
  assert.equal(new Set(all.map((q) => q.qid)).size, all.length, 'qid مكرر');
  for (const q of all) {
    assert.match(String(q.qid || ''), QID, `${q.cat}: qid غير صالح (${q.qid})`);
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
        assert.ok(!answerLeaks(answer, norm(other.q)), `${c.id}: إجابة ${q.qid} «${q.a}» مكشوفة في نص ${other.qid}`);
      }
    }
  }
});

// حزم الأعمال الدرامية والأنمي تُعلَّم بـ "style": "story"، فتُمنع فيها أسئلة
// الإنتاج: صاحب اللعبة يريد أسئلة عن أحداث العمل لا عن مخرجه ومؤلفه.
// الأنماط نفسها التي يستعملها bank:validate كي لا يختلف الاثنان.
const CREDITS = STORY_CREDITS;
const ACTOR = STORY_ACTOR;
// القاعدة (RUBRIC §4): أسئلة الممثلين ومؤدّي الأصوات ≤ 20% من الفئة، وفي خانتي 800 و1000 فقط.
const ACTOR_SHARE = 0.2;

test('حزم المسلسلات والأنمي: أسئلة عن أحداث العمل لا عن صناعته', () => {
  for (const c of cats.filter((x) => x.style === 'story')) {
    for (const q of c.qs) {
      const text = `${q.q || ''} ${q.a || ''}`;
      for (const [pattern, label] of CREDITS) {
        assert.ok(!pattern.test(text), `${c.id}/${q.qid}: سؤال عن ${label} بدل أحداث العمل — «${q.q}»`);
      }
    }
    const actors = c.qs.filter((q) => ACTOR.test(q.q || ''));
    assert.ok(actors.length <= Math.floor(c.qs.length * ACTOR_SHARE), `${c.id}: ${actors.length} أسئلة عن الممثلين من ${c.qs.length} والحد 20%`);
    for (const q of actors) assert.ok([800, 1000].includes(q.p), `${c.id}/${q.qid}: سؤال عن الممثلين في خانة ${q.p}؛ المسموح 800 و1000 فقط`);
  }
});

test('index.js يستورد كل ملفات الحزم الموجودة', () => {
  const src = readFileSync(path.join(dir, 'index.js'), 'utf8');
  for (const f of files) assert.ok(src.includes(`./${f}`), `index.js لا يستورد ${f}`);
  const imported = (src.match(/from ['"]\.\/[a-z0-9]+\.json['"]/g) || []).length;
  assert.equal(imported, files.length, 'عدد الاستيرادات لا يطابق عدد ملفات الحزم');
});

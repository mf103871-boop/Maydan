import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';

// سلامة وسائط حزم الصور: الملف موجود وغير فارغ، والإجابة عربية كما تُعرض على
// المضيف، والصورة الواحدة لا تخدم إجابتين مختلفتين، ولا تدخل صورة مأساة إلى
// لعبة عائلية. القواعد مكتوبة هنا لأن bank:validate يفحص الأحجام والامتدادات
// ولا يفحص مضمون الصورة ولا تطابقها مع إجابتها.

const dir = path.resolve('src/data/categories');
const mediaRoot = path.resolve('media');
const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
const cats = files.map((f) => JSON.parse(readFileSync(path.join(dir, f), 'utf8')));

// حزم الصور المفحوصة. fourpics مستثناة عمدًا: تصميمها يسحب أربع صور من مجمّع
// مشترك، فالتكرار فيها بنيوي لا خطأ، وقرار إعادة بنائها ليس قرار هذا الاختبار.
const IMAGE_PACKS = ['reveal', 'placefinder', 'spotdiff', 'flags', 'blur', 'silhouette', 'guesscar', 'zoom', 'tilepuzzle'];

// أزواج يُسمح لها بتقاسم الملف نفسه رغم اختلاف الإجابة. تُضاف هنا بمبرر مكتوب
// فقط، وتبقى فارغة ما دام كل سؤال يملك صورته.
const SHARED_FILE_ALLOW = new Set([]);

// عناوين تدل على صورة مأساة حقيقية (إعدام، مجزرة، هجمات 11 سبتمبر…). العبارات
// دقيقة عمدًا: «One World Trade Center» برج عادي في أفق نيويورك ويمرّ، بينما
// «September 11 attacks» أو «Public execution» لا يمرّان.
const HARM = [
  /public execution|execution of \d|mass execution/i,
  /september 11 attacks|\b9\/11\b|wtc[ _]fire/i,
  /massacre|genocide|holocaust|concentration camp|mass grave|lynching/i,
  /terrorist attack|suicide bombing|beheading|corpses?\b|dead bodies/i,
];

const external = (src) => /^(https?:)?\/\//i.test(src) || /^data:/i.test(src);

function entries(cat) {
  const out = [];
  for (const q of cat.qs || []) {
    const raw = Array.isArray(q.media) ? q.media : q.media ? [q.media] : [];
    for (const e of raw) {
      const src = typeof e === 'string' ? e : e && e.src;
      if (!src || external(src)) continue;
      const rel = src.startsWith('media/') ? src.slice('media/'.length) : path.join(cat.id, src);
      out.push({ q, src, file: path.join(mediaRoot, rel), meta: typeof e === 'string' ? {} : e });
    }
  }
  return out;
}

test('كل ملف وسائط مشار إليه موجود وغير فارغ', () => {
  for (const cat of cats) {
    for (const { q, src, file } of entries(cat)) {
      assert.ok(existsSync(file), `${cat.id}/${q.qid}: الملف غير موجود (${src})`);
      assert.ok(statSync(file).size > 0, `${cat.id}/${q.qid}: ملف فارغ (${src}) — اللاعب يرى «تعذّر تحميل الملف»`);
    }
  }
});

test('لا إجابة بحروف لاتينية في حزم الصور (اللعبة عربية بالكامل)', () => {
  for (const cat of cats) {
    if (!IMAGE_PACKS.includes(cat.id)) continue;
    for (const q of cat.qs) {
      if (!q.a) continue;
      assert.ok(!/[A-Za-z]/.test(q.a), `${cat.id}/${q.qid}: إجابة لاتينية «${q.a}» — الأرجح أنها عنوان ويكيميديا مقصوصًا`);
    }
  }
});

test('لا صورة واحدة بعينها تخدم إجابتين مختلفتين داخل الحزمة', () => {
  for (const cat of cats) {
    if (!IMAGE_PACKS.includes(cat.id)) continue;
    const byHash = new Map();
    for (const { q, file } of entries(cat)) {
      const hash = createHash('md5').update(readFileSync(file)).digest('hex');
      if (!byHash.has(hash)) byHash.set(hash, new Map());
      byHash.get(hash).set(q.qid, q.a ?? '');
    }
    for (const [hash, qs] of byHash) {
      const answers = new Set(qs.values());
      if (answers.size < 2) continue;
      const key = [...qs.keys()].sort().join('|');
      if (SHARED_FILE_ALLOW.has(key)) continue;
      assert.fail(`${cat.id}: ملف واحد (${hash.slice(0, 8)}) لأسئلة بإجابات مختلفة — ${[...qs].map(([id, a]) => `${id}=«${a}»`).join('، ')}`);
    }
  }
});

test('لا صورة مأساة في حزم الصور', () => {
  for (const cat of cats) {
    if (!IMAGE_PACKS.includes(cat.id)) continue;
    for (const { q, meta } of entries(cat)) {
      const text = `${meta.title || ''} ${meta.sourceUrl || ''}`;
      for (const re of HARM) {
        assert.ok(!re.test(text), `${cat.id}/${q.qid}: وسيط يطابق ${re} — «${(meta.title || '').slice(0, 90)}»`);
      }
    }
  }
});

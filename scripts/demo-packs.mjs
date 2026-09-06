// حزم تجريبية للتحقق من مسار الوسائط محليًا — ليست محتوى للّعبة.
//
//   node scripts/demo-packs.mjs            ← ينسخ وسائط الاختبار ويكتب ست حزم
//   node scripts/demo-packs.mjs --remove   ← يمسحها ويعيد بنك الأسئلة فارغًا
//
// الحزم الست تغطي كل نوع سؤال يدعمه «بَديهة»، وأول سؤال في كل شريحة هو النوع
// المقصود، فتُنتج لوحة الثلاثين خانة كل الأنواع بترتيب معلوم. مخرجاتها
// مُستثناة في .gitignore ولا تُنشر أبدًا.
import { readdir, readFile, writeFile, mkdir, cp, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeIndex, sortQuestions } from './bank.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CATS = path.join(ROOT, 'src/data/categories');
const FIXTURES = path.join(ROOT, 'tests/fixtures/media/demo');
const DEMO_MEDIA = path.join(ROOT, 'media/demo');
const IDS = ['demoa', 'demob', 'democ', 'demod', 'demoe', 'demof'];
const STATUS = path.join(ROOT, 'src/data/bank-status.json');

// الحزم التجريبية تُسجَّل مؤقتًا في bank-status.json كي يقبلها المدقّق والاختبارات، وتُمحى مع --remove.
async function registerDemo(on) {
  const status = JSON.parse(await readFile(STATUS, 'utf8'));
  for (const id of IDS) {
    if (on) status.categories[id] = { name: `تجربة ${id.slice(-1).toUpperCase()}`, icon: '🧪', media: false, status: 'pending', counts: { 200: 5, 400: 5, 600: 5, 800: 5, 1000: 5 }, doneAt: null, order: 9000 + IDS.indexOf(id), note: 'حزمة تجريبية مؤقتة — تُزال بـ demo-packs --remove' };
    else delete status.categories[id];
  }
  await writeFile(STATUS, `${JSON.stringify(status, null, 2)}\n`);
}
const TIERS = [200, 400, 600, 800, 1000];

// النوع المطلوب لأول سؤال في كل شريحة من كل حزمة
const PLAN = {
  demoa: { 200: 'image-none', 400: 'image-zoom', 600: 'image-blur', 800: 'image-silhouette', 1000: 'image-jumble' },
  demob: { 400: 'image-reveal', 600: 'audio', 800: 'video', 1000: 'diff', 200: 'fourpics' },
  democ: { 600: 'truefalse', 800: 'scramble', 1000: 'complete', 200: 'choice', 400: 'code' },
  demod: { 800: 'common', 1000: 'hints', 200: 'image-none', 400: 'plain', 600: 'plain' },
  demoe: { 1000: 'audio', 200: 'image-zoom', 400: 'video', 600: 'plain', 800: 'plain' },
  demof: { 200: 'diff', 400: 'image-reveal', 600: 'scramble', 800: 'plain', 1000: 'plain' },
};

// كل ملف تجريبي مُصنَّع هنا، فإسناده ثابت: ملك عام باسم المنصة.
const CREDIT = { title: 'ملف تجريبي مُصنَّع', sourceUrl: 'https://github.com/mf103871-boop/maydan', author: 'منصة ميدان', license: 'CC0 1.0', licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/' };
const IMG = (file) => ({ src: M(file), type: 'image', ...CREDIT });
const AUD = (file) => ({ src: M(file), type: 'audio', ...CREDIT });
const VID = (file) => ({ src: M(file), type: 'video', ...CREDIT });

const M = (file) => `media/demo/${file}`;
const qid = (seed) => createHash('sha1').update(seed).digest('hex').slice(0, 12);

// وسم قصير يجعل نص كل سؤال وإجابته فريدين عبر الحزم الست، فلا يعترض المدقّق على التكرار.
// المعرّف يحدد ترتيب الملف (p ثم qid)، وبناء الجولة الحتمي في الاختبار يلتقط أول سؤال
// في كل خانة؛ فالسؤال المقصود يبدأ بـ0 والحشو بـf كي يتقدّمه دائمًا.
function question(kind, id, p, n) {
  const base = { p, qid: `${kind === 'plain' ? 'f' : '0'}${qid(`${id}-${p}-${n}-${kind}`).slice(1)}` };
  const tag = ` ‹${id.slice(-1).toUpperCase()}${p}›`;
  const built = rawQuestion(kind, id, p, n, base);
  if (built.q) built.q = `${built.q}${tag}`;
  if (built.a && !['truefalse', 'scramble', 'choice', 'plain'].includes(kind)) built.a = `${built.a}${tag}`;
  return built;
}

function rawQuestion(kind, id, p, n, base) {
  switch (kind) {
    case 'image-none':
      return { ...base, type: 'image', media: IMG('circle.png'), q: 'ما الشكل الظاهر؟', a: 'دائرة' };
    case 'image-zoom':
      return { ...base, type: 'image', effect: 'zoom', origin: '30% 35%', media: IMG('grid.png'), q: 'ما هذا النقش؟', a: 'شبكة مربّعات' };
    case 'image-blur':
      return { ...base, type: 'image', effect: 'blur', media: IMG('stripes.png'), q: 'ما هذا النقش؟', a: 'خطوط متوازية' };
    case 'image-silhouette':
      return { ...base, type: 'image', effect: 'silhouette', media: IMG('circle.png'), q: 'ما هذا الظل؟', a: 'دائرة' };
    case 'image-reveal':
      return { ...base, type: 'image', effect: 'reveal', media: IMG('grid.png'), q: 'ماذا تُخفي القطع؟', a: 'شبكة مربّعات' };
    case 'image-jumble':
      return { ...base, type: 'image', effect: 'jumble', media: IMG('grid.png'), q: 'ركّبوا الصورة في أذهانكم', a: 'شبكة مربّعات' };
    case 'fourpics':
      return { ...base, type: 'image', media: [IMG('circle.png'), IMG('grid.png'), IMG('stripes.png'), IMG('circle2.png')], q: 'ما الكلمة الجامعة؟', a: 'أشكال هندسية' };
    case 'audio':
      return { ...base, type: 'audio', media: AUD(n % 2 ? 'siren.mp3' : 'scale.mp3'), q: 'ما هذا الصوت؟', a: n % 2 ? 'صفّارة إنذار' : 'سلّم موسيقي' };
    case 'video':
      return { ...base, type: 'video', media: VID('clip.webm'), q: 'ماذا يتحرك في المقطع؟', a: 'كرة صفراء' };
    case 'diff':
      return { ...base, type: 'diff', media: [IMG('circle.png'), IMG('circle2.png')], spot: { x: 50, y: 50, r: 14 }, q: 'أين يختلفان؟', a: 'حجم الدائرة' };
    case 'choice':
      return { ...base, type: 'choice', options: ['اختراع الهاتف', 'هبوط القمر'], q: 'أيهما حدث أولًا؟', a: 'اختراع الهاتف' };
    case 'code':
      return { ...base, type: 'code', q: '13-25-4-1-14', hint: 'كل رقم ترتيب حرف إنجليزي', a: 'MYDAN' };
    case 'truefalse':
      return { ...base, type: 'truefalse', q: 'الشمس نجم.', a: 'صح' };
    case 'scramble':
      return { ...base, type: 'scramble', letters: ['ن', 'ا', 'د', 'ي', 'م'], q: 'رتّبوا الحروف', a: 'ميدان' };
    case 'complete':
      return { ...base, type: 'complete', q: 'منصة ميدان تجمع ___ ألعاب في جهاز واحد', a: 'ست' };
    case 'common':
      return { ...base, type: 'common', items: ['القاهرة', 'بغداد', 'الرياض'], q: 'ما القاسم المشترك؟', a: 'عواصم عربية' };
    case 'hints':
      return { ...base, type: 'hints', hints: ['كوكب', 'أحمر اللون', 'رابع كواكب المجموعة'], q: 'من أنا؟', a: 'المريخ' };
    default:
      return { ...base, q: `سؤال تجريبي ${id}-${p}-${n}`, a: `جواب ${id}-${p}-${n}` };
  }
}

async function install() {
  await mkdir(DEMO_MEDIA, { recursive: true });
  await cp(FIXTURES, DEMO_MEDIA, { recursive: true });
  for (const [id, plan] of Object.entries(PLAN)) {
    const qs = [];
    for (const p of TIERS) {
      qs.push(question(plan[p], id, p, 0));
      for (let n = 1; n < 5; n += 1) qs.push(question('plain', id, p, n));
    }
    const pack = { id, name: `تجربة ${id.slice(-1).toUpperCase()}`, icon: '🧪', qs: sortQuestions(qs) };
    await writeFile(path.join(CATS, `${id}.json`), `${JSON.stringify(pack, null, 2)}\n`);
  }
  await registerDemo(true);
  await writeIndex(ROOT);
  console.log(`ركّبت ${IDS.length} حزمة تجريبية وسجّلتها مؤقتًا في bank-status.json. للإزالة: node scripts/demo-packs.mjs --remove`);
}

async function remove() {
  // إلغاء التسجيل أولًا: لو فشل حذف ملف (مفتوح في محرّر مثلًا) لا تبقى مدخلات تجريبية في bank-status.json
  await registerDemo(false);
  try {
    for (const file of await readdir(CATS)) {
      if (/^demo[a-f]\.json$/.test(file)) await rm(path.join(CATS, file));
    }
    await rm(DEMO_MEDIA, { recursive: true, force: true });
  } finally {
    await writeIndex(ROOT);
  }
  console.log('أُزيلت الحزم التجريبية ووسائطها وسجلّها المؤقت في bank-status.json.');
}

await (process.argv.includes('--remove') ? remove() : install());

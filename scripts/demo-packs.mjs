// حزم تجريبية للتحقق من مسار الوسائط محليًا — ليست محتوى للّعبة.
//
//   node scripts/demo-packs.mjs            ← ينسخ وسائط الاختبار ويكتب ست حزم
//   node scripts/demo-packs.mjs --remove   ← يمسحها ويعيد بنك الأسئلة فارغًا
//
// الحزم الست تغطي كل نوع سؤال يدعمه «بَديهة»، وأول سؤال في كل شريحة هو النوع
// المقصود، فتُنتج لوحة الثلاثين خانة كل الأنواع بترتيب معلوم. مخرجاتها
// مُستثناة في .gitignore ولا تُنشر أبدًا.
import { readdir, writeFile, mkdir, cp, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CATS = path.join(ROOT, 'src/data/categories');
const FIXTURES = path.join(ROOT, 'tests/fixtures/media/demo');
const DEMO_MEDIA = path.join(ROOT, 'media/demo');
const IDS = ['demoa', 'demob', 'democ', 'demod', 'demoe', 'demof'];
const TIERS = [200, 400, 600, 800, 1000];
const EMPTY_INDEX = `// بنك أسئلة «بَديهة».
//
// البنك فارغ عمدًا: الحزم القديمة حُذفت، ويُعاد بناؤها حزمة حزمة.
// صيغة الحزمة وأنواع الأسئلة في docs/PACK_FORMAT.md.

export const CATS = [];

export const CATEGORY_IDS = CATS.map((category) => category.id);
export const TOTAL_QUESTIONS = CATS.reduce((sum, category) => sum + category.qs.length, 0);
`;

// النوع المطلوب لأول سؤال في كل شريحة من كل حزمة
const PLAN = {
  demoa: { 200: 'image-none', 400: 'image-zoom', 600: 'image-blur', 800: 'image-silhouette', 1000: 'plain' },
  demob: { 400: 'image-reveal', 600: 'audio', 800: 'video', 1000: 'diff', 200: 'plain' },
  democ: { 600: 'truefalse', 800: 'scramble', 1000: 'complete', 200: 'plain', 400: 'plain' },
  demod: { 800: 'common', 1000: 'hints', 200: 'image-none', 400: 'plain', 600: 'plain' },
  demoe: { 1000: 'audio', 200: 'image-zoom', 400: 'video', 600: 'plain', 800: 'plain' },
  demof: { 200: 'diff', 400: 'image-reveal', 600: 'scramble', 800: 'plain', 1000: 'plain' },
};

const M = (file) => `media/demo/${file}`;
const qid = (seed) => createHash('sha1').update(seed).digest('hex').slice(0, 12);

function question(kind, id, p, n) {
  const base = { p, qid: qid(`${id}-${p}-${n}-${kind}`) };
  switch (kind) {
    case 'image-none':
      return { ...base, type: 'image', media: M('circle.png'), q: 'ما الشكل الظاهر؟', a: 'دائرة' };
    case 'image-zoom':
      return { ...base, type: 'image', effect: 'zoom', origin: '30% 35%', media: M('grid.png'), q: 'ما هذا النقش؟', a: 'شبكة مربّعات' };
    case 'image-blur':
      return { ...base, type: 'image', effect: 'blur', media: M('stripes.png'), q: 'ما هذا النقش؟', a: 'خطوط متوازية' };
    case 'image-silhouette':
      return { ...base, type: 'image', effect: 'silhouette', media: M('circle.png'), q: 'ما هذا الظل؟', a: 'دائرة' };
    case 'image-reveal':
      return { ...base, type: 'image', effect: 'reveal', media: M('grid.png'), q: 'ماذا تُخفي القطع؟', a: 'شبكة مربّعات' };
    case 'audio':
      return { ...base, type: 'audio', media: M(n % 2 ? 'siren.wav' : 'scale.wav'), q: 'ما هذا الصوت؟', a: n % 2 ? 'صفّارة إنذار' : 'سلّم موسيقي' };
    case 'video':
      return { ...base, type: 'video', media: M('clip.webm'), q: 'ماذا يتحرك في المقطع؟', a: 'كرة صفراء' };
    case 'diff':
      return { ...base, type: 'diff', media: [M('circle.png'), M('circle2.png')], spot: { x: 50, y: 50, r: 14 }, q: 'أين يختلفان؟', a: 'حجم الدائرة' };
    case 'truefalse':
      return { ...base, type: 'truefalse', q: 'الشمس نجم.', a: 'صح' };
    case 'scramble':
      return { ...base, type: 'scramble', letters: ['ن', 'ا', 'د', 'ي', 'م'], q: 'رتّبوا الحروف', a: 'ميدان' };
    case 'complete':
      return { ...base, type: 'complete', q: 'منصة ___ تجمع ست ألعاب في جهاز واحد', a: 'ميدان' };
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
    const pack = { id, name: `تجربة ${id.slice(-1).toUpperCase()}`, icon: '🧪', qs };
    await writeFile(path.join(CATS, `${id}.json`), `${JSON.stringify(pack, null, 2)}\n`);
  }
  await writeFile(
    path.join(CATS, 'index.js'),
    `${IDS.map((id) => `import ${id} from './${id}.json' with { type: 'json' };`).join('\n')}

export const CATS = [${IDS.join(', ')}];

export const CATEGORY_IDS = CATS.map((category) => category.id);
export const TOTAL_QUESTIONS = CATS.reduce((sum, category) => sum + category.qs.length, 0);
`,
  );
  console.log(`ركّبت ${IDS.length} حزمة تجريبية. للإزالة: node scripts/demo-packs.mjs --remove`);
}

async function remove() {
  for (const file of await readdir(CATS)) {
    if (/^demo[a-f]\.json$/.test(file)) await rm(path.join(CATS, file));
  }
  await rm(DEMO_MEDIA, { recursive: true, force: true });
  await writeFile(path.join(CATS, 'index.js'), EMPTY_INDEX);
  console.log('أُزيلت الحزم التجريبية ووسائطها.');
}

await (process.argv.includes('--remove') ? remove() : install());

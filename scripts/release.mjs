// Release: production build, then the single-file artifact under release/ and,
// when zip is available, a source archive next to it.
import { copyFile, mkdir, rm, readdir, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { buildOnce, ROOT, fmtKB } from './lib.mjs';

// الحزم التجريبية (scripts/demo-packs.mjs) لا تُنشر أبدًا: إن كانت مركّبة يتوقف الإصدار.
const demoFiles = (await readdir(path.join(ROOT, 'src/data/categories'))).filter((f) => /^demo[a-f]\.json$/.test(f));
const status = JSON.parse(await readFile(path.join(ROOT, 'src/data/bank-status.json'), 'utf8'));
const demoKeys = Object.keys(status.categories || {}).filter((id) => /^demo[a-f]$/.test(id));
if (demoFiles.length || demoKeys.length) {
  console.error(`الحزم التجريبية مركّبة (${[...demoFiles, ...demoKeys].join(', ')}). أزلها أولًا: node scripts/demo-packs.mjs --remove`);
  process.exit(1);
}

const r = await buildOnce({ minify: true });
const dir = path.join(ROOT, 'release');
await mkdir(dir, { recursive: true });
const html = path.join(dir, `maydan-platform-${r.version}.html`);
await copyFile(r.out, html);
console.log(`release: ${html} · ${fmtKB(r.bytes)} (${fmtKB(r.gzip)} gzip)`);

// قائمة ملفات الأرشيف: ما يتعقّبه git وما هو غير متعقَّب وغير مستثنى في
// .gitignore — أي بالضبط ما يظهر في المستودع. القائمة اليدوية السابقة كانت
// تستثني ستة مسارات فقط، فكان الأرشيف يحمل `.wrangler/` (حالة محاكي محلية)
// و`ios/Maydan/www/` (مخرجات بناء) و`.dev.vars` و`.env*` — كلها مُستثناة في
// .gitignore، وفيها اعتمادات محلية. أي استثناء جديد في .gitignore يسري تلقائيًا.
function trackedFiles() {
  const out = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const files = out.split('\0').filter(Boolean);
  if (!files.length) throw new Error('git لم يُعِد أي ملف');
  // zip -@ يقرأ الأسماء سطرًا سطرًا، فاسم فيه سطر جديد يفسد القائمة.
  if (files.some((f) => f.includes('\n'))) throw new Error('اسم ملف فيه سطر جديد');
  return files;
}

try {
  const zip = path.join(dir, `maydan-platform-${r.version}-source.zip`);
  // `zip -r` على أرشيف موجود يحدّثه ولا يحذف ما اختفى من الشجرة؛ أرشيف إصدار
  // سابق أعاد نشر ملفات محذوفة بهذه الطريقة، فيُحذف القديم أولًا.
  await rm(zip, { force: true });
  let files = null;
  try { files = trackedFiles(); } catch (error) { console.log(`source: تعذّرت قائمة git (${error.message}) — الرجوع إلى قائمة استثناءات .gitignore الثابتة`); }
  if (files) {
    execFileSync('zip', ['-q', zip, '-@'], { cwd: ROOT, input: `${files.join('\n')}\n` });
    console.log(`source: ${zip} · ${files.length} ملفًا (مطابقة لما يتعقّبه git)`);
  } else {
    // بلا git: نسخة يدوية من .gitignore. تبقى متزامنة معه باختبار
    // tests/sw-release-regression.test.js.
    const excludes = [
      'node_modules/*', 'dist/*', 'release/*', '.cache/*', '.git/*', '*.log', '.DS_Store',
      'ios/Maydan/www/*', 'ios/build/*', '*xcuserdata/*', '*.ipa', '*.xcarchive/*', '*.p12', '*.p8', '*.mobileprovision',
      // الأيقونات الصغيرة مُولَّدة من icon-1024.png، وهي وحدها المتعقَّبة؛ الأنماط
      // بثلاث خانات فأقل تستثني المُولَّد وتُبقي 1024 (أربع خانات).
      'ios/Maydan/Assets.xcassets/AppIcon.appiconset/icon-[0-9].png',
      'ios/Maydan/Assets.xcassets/AppIcon.appiconset/icon-[0-9][0-9].png',
      'ios/Maydan/Assets.xcassets/AppIcon.appiconset/icon-[0-9][0-9][0-9].png',
      'media/demo/*', 'src/data/categories/demo[a-f].json',
      '.wrangler/*', '.dev.vars', '.env', '.env.*',
    ];
    execFileSync('zip', ['-qr', zip, '.', '-x', ...excludes], { cwd: ROOT });
    console.log(`source: ${zip}`);
  }
} catch {
  console.log('source zip skipped (zip not available)');
}

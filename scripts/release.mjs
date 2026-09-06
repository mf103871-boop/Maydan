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

try {
  const zip = path.join(dir, `maydan-platform-${r.version}-source.zip`);
  // `zip -r` على أرشيف موجود يحدّثه ولا يحذف ما اختفى من الشجرة؛ أرشيف إصدار
  // سابق أعاد نشر ملفات محذوفة بهذه الطريقة، فيُحذف القديم أولًا.
  await rm(zip, { force: true });
  execFileSync('zip', ['-qr', zip, '.', '-x', 'node_modules/*', 'dist/*', 'release/*', '.git/*', '.cache/*', 'media/demo/*', 'src/data/categories/demo[a-f].json'], { cwd: ROOT });
  console.log(`source: ${zip}`);
} catch {
  console.log('source zip skipped (zip not available)');
}

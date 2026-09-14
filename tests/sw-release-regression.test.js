// انحدارات العامل الخدمي وأرشيف الإصدار وترويسات الأمان.
//
// ثلاثة أخطاء حقيقية يمنع هذا الملف عودتها:
//  • `public/sw.js` كان يخزّن المستند نفسه مرتين ('./' و'./index.html')، فيُنزَّل
//    6.9 م.ب ثلاث مرات في أول زيارة ويشغل 14.99 م.ب من مخزن المتصفح.
//  • أرشيف المصدر في `npm run release` كان يستثني ستة مسارات يدويًا، فيحمل
//    `.wrangler/` و`.dev.vars` و`.env*` و`ios/Maydan/www/` رغم استثنائها في
//    .gitignore.
//  • ترويسات الأمان كانت في `server/full-worker.mjs` وحده، و`run_worker_first`
//    في `wrangler.jsonc` يقصر تشغيل العامل على `/api` و`/health` فلا تصل
//    الملفات الثابتة؛ النسخة العاملة هي `public/_headers`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFile(path.join(ROOT, rel), 'utf8');

function swAssets(source) {
  const block = /const ASSETS = \[([\s\S]*?)\];/.exec(source);
  assert.ok(block, 'ASSETS غير موجودة في sw.js');
  return [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

test('العامل الخدمي يخزّن المستند مدخلًا واحدًا، وهو المدخل الذي يقرؤه معالج التنقل', async () => {
  const sw = await read('public/sw.js');
  const assets = swAssets(sw);
  assert.equal(new Set(assets).size, assets.length, 'مدخل مكرر حرفيًا في ASSETS');
  const documents = assets.filter((a) => a === './' || /index\.html$/.test(a));
  assert.deepEqual(documents, ['./index.html'], `المستند مذكور ${documents.length} مرة: ${documents.join('، ')}`);

  // معالج التنقل يقرأ ويكتب المفتاح نفسه الموجود في ASSETS، وإلا بقي المخزَّن معطّلًا
  const navKeys = [...sw.matchAll(/caches\.match\('(\.\/[^']*)'\)|cache\.put\('(\.\/[^']*)'/g)]
    .map((m) => m[1] || m[2]);
  assert.ok(navKeys.length >= 2, 'لم يُعثر على مفاتيح معالج التنقل');
  for (const key of navKeys) assert.ok(assets.includes(key), `معالج التنقل يستعمل «${key}» وليس في ASSETS`);
});

test('أرشيف المصدر يستثني كل ما تستثنيه .gitignore', async () => {
  const release = await read('scripts/release.mjs');
  // المسار الأساسي: قائمة git نفسها (متعقَّب + غير متعقَّب وغير مستثنى)
  assert.match(release, /git['"],\s*\['ls-files'[\s\S]*--exclude-standard/, 'الأرشيف لا يبني قائمته من git');

  // المسار الاحتياطي (بلا git) يجب أن يغطي كل سطر فعّال في .gitignore
  const fallback = /const excludes = \[([\s\S]*?)\];/.exec(release);
  assert.ok(fallback, 'لا قائمة استثناءات احتياطية في release.mjs');
  const patterns = [...fallback[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  const covered = (entry) => {
    // `**/x/` في .gitignore ↔ `*x/*` في zip؛ و`icon-*.png` تُغطّيها أنماط الخانات
    // الثلاث التي تُبقي icon-1024.png المتعقَّبة.
    const bare = entry.replace(/^!/, '').replace(/\/$/, '').replace(/^\*\*\//, '');
    const prefix = bare.replace(/\*.*$/, '');
    return patterns.some((p) => p === bare || p === `${bare}/*` || p === `${bare}*` || p === `*${bare}/*`
      || (prefix.length > 4 && p.startsWith(prefix)));
  };
  const gitignore = (await read('.gitignore')).split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#') && !l.startsWith('!'));
  const missing = gitignore.filter((entry) => !covered(entry));
  assert.deepEqual(missing, [], `قائمة release.mjs الاحتياطية لا تغطي: ${missing.join('، ')}`);

  // الأربعة التي كان الأرشيف يحملها فعلًا
  for (const leak of ['.wrangler/', '.dev.vars', '.env', 'ios/Maydan/www/']) {
    assert.ok(gitignore.includes(leak) && covered(leak), `${leak} غير مغطّى`);
  }
});

test('public/_headers يحمل سياسة server/full-worker.mjs نفسها', async () => {
  const headers = await read('public/_headers');
  const worker = await read('server/full-worker.mjs');

  const lines = Object.fromEntries([...headers.matchAll(/^ {2,}([A-Za-z-]+):\s*(.+)$/gm)].map((m) => [m[1].toLowerCase(), m[2].trim()]));
  assert.ok(/^\/\*$/m.test(headers), '_headers بلا نمط /* يشمل كل المسارات');
  assert.equal(lines['x-content-type-options'], 'nosniff');
  assert.equal(lines['x-frame-options'], 'DENY');
  assert.equal(lines['referrer-policy'], 'same-origin');

  const block = /const CONTENT_SECURITY_POLICY = \[([\s\S]*?)\]\.join/.exec(worker);
  assert.ok(block, 'لم يُعثر على سياسة العامل');
  const want = [...block[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  const got = lines['content-security-policy'].split(';').map((d) => d.trim()).filter(Boolean);
  assert.deepEqual(got, want, 'سياسة _headers تخالف سياسة full-worker.mjs');

  // المستند يحمل شيفرته وأنماطه وخطوطه بداخله، فهذه التوجيهات شرط تشغيله
  for (const directive of ["script-src 'self' 'unsafe-inline'", "style-src 'self' 'unsafe-inline'", "font-src 'self' data:"]) {
    assert.ok(want.includes(directive), `السياسة بلا ${directive} تكسر الصفحة`);
  }
});

test('README لا يطلب رفع رقم المخزن يدويًا، وsw.js ما زال يحمل الوسم', async () => {
  const readme = await read('README.md');
  const sw = await read('public/sw.js');
  assert.match(sw, /const CACHE = 'maydan-platform-__BUILD_ID__'/, 'الوسم الذي يستبدله البناء');
  assert.match(await read('scripts/lib.mjs'), /replaceAll\('__BUILD_ID__'/, 'البناء هو من يستبدل الوسم');
  assert.ok(!/ارفع رقم `CACHE`/.test(readme), 'README ما زال يطلب رفع رقم CACHE يدويًا');
  assert.match(readme, /لا يُحرَّر يدويًا/);
  assert.match(readme, /__BUILD_ID__/);
});

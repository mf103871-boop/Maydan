// ميزانية حجم الحزمة: المستند الواحد يُحلَّل على الخيط الرئيسي في كل فتح، ويُنزَّل
// مرتين في الزيارة الأولى (الصفحة ثم تثبيت عامل الخدمة). بلا حدّ صريح تضاعف حجمه
// مرة بإضافة بنك أصوات PCM خام إليه. الأرقام سقف لا هدف؛ خفّضها حين ينقص الحجم.
import test from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { build } from 'esbuild';
import { esbuildOptions, renderHtml, mediaVersions, ROOT, DIST } from '../scripts/lib.mjs';
import { WARMTH_BUNDLE_ID, warmthAudioBuild } from '../scripts/audio/warmth-preview.mjs';
import path from 'node:path';

const MB = 1024 * 1024;
const BUDGET = {
  document: 3.0 * MB,   // dist/index.html خام (6.2 MB قبل إخراج الأصوات، 3.7 MB قبل إخراج الرسوم والخطوط، 3.25 MB قبل إخراج حقول التحقق التحريرية من بنك بَديهة وكتالوج الأصوات الخاص)
  gzip: 0.85 * MB,      // ما ينزل فعليًا على الهاتف
  input: 560 * 1024,    // أكبر ملف مصدر واحد داخل الحزمة (react-dom نحو 523 KB)
};

function assertDocumentBudget(html) {
  const raw = Buffer.byteLength(html, 'utf8');
  const gzip = gzipSync(Buffer.from(html, 'utf8')).length;
  assert.ok(raw <= BUDGET.document, `index.html is ${raw} bytes, budget ${BUDGET.document} bytes`);
  assert.ok(gzip <= BUDGET.gzip, `index.html gzip is ${gzip} bytes, budget ${Math.floor(BUDGET.gzip)} bytes`);
}

test('the shipped document and its largest inputs stay inside the size budget', { timeout: 120_000 }, async () => {
  const result = await build({ ...esbuildOptions({ minify: true, version: '0.0.0-test', media: await mediaVersions(ROOT), assets: 'files' }), metafile: true });
  const js = result.outputFiles.find((f) => f.path.endsWith('.js')).text;
  assert.doesNotMatch(js, /maydanRewardedLab|maydanRewardedMetric|__rewarded_lab__/,
    'the ordinary document must never ship loopback simulation or its grant endpoint');
  // The real optional policy now uses ordinary setup/lobby entry points. Its
  // dormant UI/bridge is shared; runtime default-off and genuine account access
  // are tested by gameplay-access-local and account-gating. The native SDK is
  // still absent unless its separately verified signed-build mode is selected.
  const assets = result.outputFiles.filter(file=>!file.path.endsWith('.js')).map(file=>'./'+path.relative(DIST,file.path).replaceAll('\\','/')).sort();
  const html = await renderHtml(js, { version: '0.0.0-test', assets });
  // الرسوم والخطوط ملفات مبصومة بجانب المستند لا base64 داخله.
  assert.ok(!/data:(image\/webp|image\/png|font\/woff2)/.test(html), 'brand art and fonts must ship as files, not data: URLs inside the document');
  const gameArtwork = { badeeha:'badeeha-b-v2', mafia:'mafia-b-v2', ersomha:'ersomha-v2', beep:'beep-v2', mamnoo:'mamnoo', jabeen:'jabeen-v2', fabraka:'fabraka-v2', meenfina:'meenfina-v2' };
  for (const [game, basename] of Object.entries(gameArtwork)) {
    assert.ok(result.outputFiles.some(f => new RegExp(`assets/brand/${basename}-[A-Z0-9]+\\.webp$`).test(f.path.replaceAll('\\', '/'))), `${game} artwork is emitted as a hashed file`);
  }
  const fontPreloads = [...html.matchAll(/<link rel="preload" as="font"[^>]+href="([^"]+)"/g)].map(match => match[1]);
  assert.equal(fontPreloads.length, 4, 'only the body400 and heading800 faces load eagerly in both scripts');
  assert.deepEqual(fontPreloads.map(href => href.match(/\/(arabic|latin)-(400|800)-[A-Z0-9]+\.woff2$/)?.slice(1).join('-')).sort(),
    ['arabic-400', 'arabic-800', 'latin-400', 'latin-800']);
  assert.ok(!fontPreloads.some(href => /-(500|600|700)-/.test(href)), 'intermediate weights are requested by font use, not preloaded');
  assertDocumentBudget(html);
  const inputs = Object.entries(result.metafile.inputs).map(([file, info]) => [file, info.bytes]).sort((a, b) => b[1] - a[1]);
  assert.ok(!inputs.some(([file]) => file.replaceAll('\\', '/') === 'src/online/online-studio.css'),
    'the shared room stylesheet is packaged once as a local sheet, never duplicated as inline CSS by another consumer');
  assert.ok(!inputs.some(([file]) => /server[\\/]data[\\/]ersomha|server[\\/]ersomha-content\.mjs/.test(file)), 'private Draw It answers and aliases must never enter the client bundle');
  // Lazy JSON files are independent network assets, not code parsed at launch.
  // Keep the original code-input limit and separately bound each content pack.
  const [largest, bytes] = inputs.find(([file]) => !file.startsWith('maydan-locale-json:'));
  for (const asset of result.outputFiles.filter(f => /locale-en-.*\.json$/.test(f.path))) {
    assert.ok(asset.contents.byteLength <= MB, `${asset.path} exceeds the 1MB on-demand content budget`);
  }
  assert.ok(bytes <= BUDGET.input, `${largest} is ${(bytes / 1024).toFixed(0)} KB, budget ${(BUDGET.input / 1024).toFixed(0)} KB`);
  // الأصوات لم تعد داخل المستند: ملفات صغيرة تُجلب عند الحاجة.
  assert.ok(!inputs.some(([file, size]) => file.endsWith('sample-bank.js') && size > 8 * 1024), 'the sound bank manifest must not embed audio data');
  // ملف JSON يُستورد مرة بـ`with { type: 'json' }` ومرة بدونها يصير وحدتين منفصلتين في
  // الحزمة: نسختان كاملتان من البيانات نفسها (صور فبركة شُحنت مرتين هكذا).
  const seen = new Map();
  for (const file of Object.keys(result.metafile.inputs)) {
    const plain = file.replace(/ with \{.*\}$/, '');
    assert.ok(!seen.has(plain), `${plain} is bundled twice (${seen.get(plain)} and ${file}); import it the same way everywhere`);
    seen.set(plain, file);
  }
});

test('a signed Rewarded build ships the native ad bridge without loopback simulation', { timeout: 120_000 }, async () => {
  const options = esbuildOptions({ minify: true, version: '1.9', media: await mediaVersions(ROOT), assets: 'files',
    roomsUrl: 'https://maydan-mafia-preview.mf103871.workers.dev', rewardedPreview: true });
  const result = await build(options);
  const js = result.outputFiles.find(file => file.path.endsWith('.js')).text;
  assert.match(js, /rewardedShow/);
  assert.doesNotMatch(js, /maydanRewardedLab|maydanRewardedMetric|__rewarded_lab__/);
  if (warmthAudioBuild()) {
    assert.ok(js.includes(WARMTH_BUNDLE_ID), 'the selected Warmth pack stays available');
    assert.equal(/audio\/candidates\/|معاينة أصوات التحديث/.test(js), false,
      'a Warmth build excludes the older audition catalog and settings control');
  }
  const assets = result.outputFiles.filter(file => !file.path.endsWith('.js'))
    .map(file => './' + path.relative(DIST, file.path).replaceAll('\\', '/')).sort();
  const html = await renderHtml(js, { version: '1.9', assets, roomsUrl: JSON.parse(options.define.__MAYDAN_ROOMS_URL__) });
  assertDocumentBudget(html);
});

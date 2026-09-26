// ميزانية حجم الحزمة: المستند الواحد يُحلَّل على الخيط الرئيسي في كل فتح، ويُنزَّل
// مرتين في الزيارة الأولى (الصفحة ثم تثبيت عامل الخدمة). بلا حدّ صريح تضاعف حجمه
// مرة بإضافة بنك أصوات PCM خام إليه. الأرقام سقف لا هدف؛ خفّضها حين ينقص الحجم.
import test from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { build } from 'esbuild';
import { esbuildOptions, renderHtml, mediaVersions, ROOT } from '../scripts/lib.mjs';

const MB = 1024 * 1024;
const BUDGET = {
  document: 4.0 * MB,   // dist/index.html خام (كان 6.2 MB قبل إخراج الأصوات)
  gzip: 1.6 * MB,       // ما ينزل فعليًا على الهاتف
  input: 560 * 1024,    // أكبر ملف مصدر واحد داخل الحزمة (react-dom نحو 523 KB)
};

test('the shipped document and its largest inputs stay inside the size budget', { timeout: 120_000 }, async () => {
  const result = await build({ ...esbuildOptions({ minify: true, version: '0.0.0-test', media: await mediaVersions(ROOT) }), metafile: true });
  const js = result.outputFiles.find((f) => f.path.endsWith('.js')).text;
  const html = await renderHtml(js, { version: '0.0.0-test' });
  const raw = Buffer.byteLength(html, 'utf8');
  const gzip = gzipSync(Buffer.from(html, 'utf8')).length;
  assert.ok(raw <= BUDGET.document, `index.html is ${(raw / MB).toFixed(2)} MB, budget ${(BUDGET.document / MB).toFixed(2)} MB`);
  assert.ok(gzip <= BUDGET.gzip, `index.html gzip is ${(gzip / MB).toFixed(2)} MB, budget ${(BUDGET.gzip / MB).toFixed(2)} MB`);
  const inputs = Object.entries(result.metafile.inputs).map(([file, info]) => [file, info.bytes]).sort((a, b) => b[1] - a[1]);
  const [largest, bytes] = inputs[0];
  assert.ok(bytes <= BUDGET.input, `${largest} is ${(bytes / 1024).toFixed(0)} KB, budget ${(BUDGET.input / 1024).toFixed(0)} KB`);
  // الأصوات لم تعد داخل المستند: ملفات صغيرة تُجلب عند الحاجة.
  assert.ok(!inputs.some(([file, size]) => file.endsWith('sample-bank.js') && size > 8 * 1024), 'the sound bank manifest must not embed audio data');
});

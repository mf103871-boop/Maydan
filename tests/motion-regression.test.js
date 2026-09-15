// الحركة تحترم «تقليل الحركة» ولا تلمس الرسوم مباشرة.
// كل ملف CSS اختبار مستقل: يرسب الملف المخالف وحده ويُسمّى مالكه في الرسالة.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (rel) => readFile(new URL(`../${rel}`, import.meta.url), 'utf8');

test('tokens.css يصفّر تأخير الحركة تحت تقليل الحركة', async () => {
  const css = await read('src/shared/theme/tokens.css');
  assert.equal((css.match(/animation-delay: 0ms !important/g) || []).length, 2);
  assert.equal((css.match(/transition-delay: 0ms !important/g) || []).length, 2);
  assert.match(css, /html\[dir="ltr"\]\s*\{\s*--flow: 1;\s*\}/, 'tokens.css ينقصه --flow للاتجاه اللاتيني');
});

// الملفات ومالكوها (spec §7): الرسالة تسمّي المالك المسؤول عن إصلاح المخالفة.
const FILES = [
  ['src/shared/brand/brand.css', 'A'],
  ['src/shared/ui/ui.css', 'C'],
  ['src/platform/platform.css', 'B'],
  ['src/shared/setup/setup.css', 'C'],
  ['src/games/badeeha/styles.css', 'D'],
  ['src/games/beep/beep.css', 'E'],
  ['src/games/mamnoo/mamnoo.css', 'E'],
  ['src/games/jabeen/jabeen.css', 'E'],
  ['src/games/fabraka/fabraka.css', 'F'],
  ['src/games/meenfina/meenfina.css', 'F'],
  ['src/online/online.css', 'F'],
];

for (const [file, owner] of FILES) {
  test(`لا حركة على عناصر الرسم نفسها ولا backdrop-filter: ${file}`, async () => {
    const css = await read(file);
    const tag = `${file} (المالك ${owner})`;
    for (const rule of css.match(/[^{}]+\{[^}]*\}/g) || []) {
      const [sel, body] = rule.split('{');
      if (/\.clay-(art|avatar|trophy)\b[^,{]*$/.test(sel.trim()) && /(^|;)\s*(animation|transition)\s*:/.test(body) && !/animation:\s*none/.test(body)) {
        assert.fail(`${tag}: ${sel.trim()} يحرّك الرسم مباشرة — حرّك .clay-lift أو الحامل .clay-stage`);
      }
    }
    assert.doesNotMatch(css, /backdrop-filter:\s*blur/, `${tag}: backdrop-filter: blur ممنوع (spec §0 القرار 5)`);
  });
}

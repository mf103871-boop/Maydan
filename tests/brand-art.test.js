// لوحات الرسوم الصلصالية المستوردة في art.jsx يجب أن تكون شفافة الحواف:
// الخلفية العاجية المدمجة كانت تظهر مستطيلًا «ملصقًا» على كل سطح ملوّن.
import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkSheets, SHEETS } from '../scripts/art-alpha.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'src/shared/brand/assets');

test('لوحات الرسوم الثلاث تحمل قناة ألفا وإطارها شفاف', async () => {
  const sharp = (await import('sharp')).default;
  assert.deepEqual(await checkSheets(sharp, DIR), []);
});

test('الأصول المسطّحة محفوظة في assets/flat لإعادة التوليد', async () => {
  for (const name of SHEETS) await access(path.join(DIR, 'flat', `${name}.webp`));
});

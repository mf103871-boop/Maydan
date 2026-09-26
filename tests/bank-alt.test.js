// alt يضيف تهجئة مختلفة فعلًا: ١٧٠ سؤالًا كانت تحمل بديلًا يطابق الإجابة بعد التطبيع
// و٣١ بدائل مكررة (مراجعة ٢٦ سبتمبر). المدقّق يرفضها، والمصحّح يحذفها ويحتفظ بالمفيد.
import test from 'node:test';
import assert from 'node:assert/strict';
import { redundantAltReasons, pruneRedundantAlt } from '../scripts/bank.mjs';

test('alt المطابق للإجابة أو المكرر بعد التطبيع يُرفض، والمختلف يُقبل', () => {
  assert.deepEqual(redundantAltReasons({ a: 'أستانا', alt: ['استانا'] }).length, 1);
  assert.deepEqual(redundantAltReasons({ a: 'الضبع المرقط', alt: ['الضبع', 'الضبع المرقّط'] }).length, 1, 'التشكيل لا يصنع بديلًا');
  assert.deepEqual(redundantAltReasons({ a: 'آلان ريكمان', alt: ['Alan Rickman', 'ألان ريكمان'] }).length, 1);
  assert.deepEqual(redundantAltReasons({ a: 'القاهرة', alt: ['كايرو', 'كايرو', 'Cairo'] }).length, 1, 'المكرر مرة واحدة');
  assert.deepEqual(redundantAltReasons({ a: 'القاهرة', alt: ['كايرو', 'Cairo'] }), []);
  assert.deepEqual(redundantAltReasons({ a: 'القاهرة' }), []);
  assert.deepEqual(redundantAltReasons({ a: 'القاهرة', alt: [] }), []);
});

test('pruneRedundantAlt يحذف الزائد ويحتفظ بأول تهجئة لكل صورة، ويزيل الحقل إن فرغ', () => {
  const q = { a: 'الضبع المرقط', alt: ['الضبع', 'الضبع المرقّط', 'ضبع', 'الضبع'] };
  assert.equal(pruneRedundantAlt(q), 2);
  assert.deepEqual(q.alt, ['الضبع', 'ضبع']);
  const only = { a: 'أستانا', alt: ['استانا'] };
  assert.equal(pruneRedundantAlt(only), 1);
  assert.equal('alt' in only, false);
  assert.equal(pruneRedundantAlt({ a: 'x' }), 0);
});

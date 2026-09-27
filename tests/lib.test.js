import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStorage, clearAllPlatformData } from '../src/shared/lib/storage.js';
import { shuffle, shuffleDifferent } from '../src/shared/lib/shuffle.js';
import { createNoRepeat, drawUnique, trimSeen } from '../src/shared/lib/noRepeat.js';
import { arabicNormalize, arabicNormalizeLoose, sameText } from '../src/shared/lib/arabicNormalize.js';
import { mulberry32, randInt } from '../src/shared/lib/rng.js';
import { fakeStorage, seeded } from './helpers.js';
import { renderServiceWorker, audioCueAssets } from '../scripts/lib.mjs';
import { SAMPLE_BANK } from '../src/shared/fx/sample-bank.js';
import { readFileSync } from 'node:fs';

test('storage: نطاق لكل لعبة، JSON، ومسح بالنطاق فقط', () => {
  const backend = fakeStorage();
  const a = createStorage('beep', backend);
  const b = createStorage('mamnoo', backend);
  a.set('score', { x: 1 });
  b.set('score', 2);
  assert.deepEqual(a.get('score'), { x: 1 });
  assert.equal(b.get('score'), 2);
  assert.equal(a.get('missing', 'fallback'), 'fallback');
  assert.ok(Object.keys(backend.dump()).every((k) => k.startsWith('maydan:')));
  assert.deepEqual(a.keys(), ['score']);
  a.clear();
  assert.equal(a.get('score'), null);
  assert.equal(b.get('score'), 2, 'مسح لعبة لا يمس أخرى');
  backend.setItem('other-app', '1');
  assert.equal(clearAllPlatformData(backend), 1);
  assert.equal(backend.getItem('other-app'), '1');
});

test('storage بلا localStorage يعمل في الذاكرة ولا يرمي خطأ', () => {
  const s = createStorage('x', null);
  s.set('k', [1, 2]);
  assert.deepEqual(s.get('k'), [1, 2]);
});

test('shuffle: تبديل يحافظ على العناصر وحتمي بالبذرة', () => {
  const items = [1, 2, 3, 4, 5, 6, 7, 8];
  const a = shuffle(items, seeded(3));
  assert.deepEqual([...a].sort(), items);
  assert.deepEqual(a, shuffle(items, seeded(3)));
  assert.notDeepEqual(a, items);
  assert.notDeepEqual(shuffleDifferent([1, 2, 3], seeded(9)), [1, 2, 3]);
  assert.deepEqual(shuffleDifferent([1], seeded(1)), [1]);
});

test('noRepeat: لا تكرار داخل اللعبة، والجديد قبل القديم', () => {
  const items = Array.from({ length: 10 }, (_, i) => ({ id: `q${i}` }));
  const seen = { q0: 1, q1: 1, q2: 1 };
  const draw = createNoRepeat(items, { random: seeded(4), seen });
  const out = [];
  let x;
  while ((x = draw.next())) out.push(x.id);
  assert.equal(out.length, 10);
  assert.equal(new Set(out).size, 10);
  assert.ok(out.slice(0, 7).every((id) => !seen[id]), 'الجديد أولًا');
  assert.ok(out.slice(7).every((id) => seen[id]), 'القديم آخرًا');
  assert.equal(draw.next(), null);
  assert.equal(Object.keys(draw.seen()).length, 10);
  assert.equal(drawUnique(items, 4, { random: seeded(1) }).length, 4);
  assert.equal(Object.keys(trimSeen(Object.fromEntries(items.map((it, i) => [it.id, i])), 3)).length, 3);
});

test('arabicNormalize: تشكيل وتطويل وألف/ياء/تاء مربوطة وأرقام', () => {
  assert.equal(arabicNormalize('مَدْرَسَةٌ'), 'مدرسه');
  assert.equal(arabicNormalize('أحمد إبراهيم آدم'), 'احمد ابراهيم ادم');
  assert.equal(arabicNormalize('مصطفى'), 'مصطفي');
  assert.equal(arabicNormalize('العــــربية'), 'العربيه');
  assert.equal(arabicNormalize('  ١٢٣  '), '123');
  assert.equal(arabicNormalize('Hello, WORLD!'), 'hello world');
  assert.ok(sameText('القاهرة', 'قاهره'));
  assert.ok(sameText('مِصْر', 'مصر'));
  assert.ok(!sameText('مصر', 'سوريا'));
  assert.ok(!sameText('', ''));
});

test('arabicNormalize: NFKC وأشكال العرض والحروف الفارسية والمحارف الصفرية', () => {
  assert.equal(arabicNormalize('\uFDF2'), 'الله', 'رمز ﷲ المركّب');
  assert.equal(arabicNormalize('\uFEFB'), 'لا', 'ﻻ المركّبة');
  assert.equal(arabicNormalize('\uFEB3\uFEE0\uFEE7'), 'سلن', 'أشكال العرض تعود إلى حروفها');
  assert.equal(arabicNormalize('کتاب'), 'كتاب', 'الكاف الفارسية');
  assert.equal(arabicNormalize('علی'), 'علي', 'الياء الفارسية');
  assert.equal(arabicNormalize('مص\u200Cر\u200B'), 'مصر', 'محارف العرض الصفرية تُحذف');
  assert.equal(arabicNormalize('١٢٣ ۴۵'), '123 45');
});

test('arabicNormalizeLoose: تُحذف «ال» التعريف فقط، لا همزة الكلمة ولا أسماء الله والموصولات', () => {
  assert.ok(sameText('القاهرة', 'قاهرة'));
  assert.ok(sameText('المدرسة', 'مدرسه'));
  assert.ok(!sameText('الله', 'له'), 'الله ليست ال + له');
  assert.ok(!sameText('ألوان', 'وان'), 'ألوان تبدأ بهمزة أصلية');
  assert.ok(!sameText('ألم', 'م'));
  assert.ok(!sameText('ألمانيا', 'مانيا'));
  assert.ok(!sameText('إلى', 'ي'));
  assert.ok(!sameText('الآن', 'ان'));
  assert.ok(!sameText('التي', 'تي'));
  assert.equal(arabicNormalizeLoose('الأردن'), 'اردن', 'ال + همزة بعدها: أداة تعريف حقيقية');
  assert.equal(arabicNormalizeLoose('البحر الأحمر'), 'بحر احمر');
  assert.equal(arabicNormalizeLoose('الحب'), 'الحب', 'كلمة قصيرة لا تُبتر (يبقى أقل من ثلاثة أحرف)');
});

test('rng: حتمي وضمن الحدود', () => {
  const r = mulberry32(42);
  const seq = [r(), r(), r()];
  const r2 = mulberry32(42);
  assert.deepEqual(seq, [r2(), r2(), r2()]);
  for (let i = 0; i < 200; i += 1) {
    const n = randInt(r, 3, 5);
    assert.ok(n >= 3 && n <= 5);
  }
});

test('createNoRepeat.seek: إعادة بناء المصدر بنفس البذرة ثم seek تعيد الطابور نفسه من الموضع المحفوظ', () => {
  const items = Array.from({ length: 12 }, (_, i) => ({ id: `i${i}` }));
  const seen = { i3: 1, i7: 1 };
  const first = createNoRepeat(items, { random: mulberry32(42), seen });
  const drawn = [first.next().id, first.next().id, first.next().id, first.next().id];
  assert.equal(first.cursor, 4);
  const again = createNoRepeat(items, { random: mulberry32(42), seen });
  assert.equal(again.seek(4), 4);
  assert.deepEqual(Object.keys(again.seen()).sort(), [...new Set([...drawn, 'i3', 'i7'])].sort(), 'المسحوب قبل الموضع يُعدّ معروضًا');
  const rest = []; let next; while ((next = again.next())) rest.push(next.id);
  const restFirst = []; while ((next = first.next())) restFirst.push(next.id);
  assert.deepEqual(rest, restFirst, 'ما بعد الموضع متطابق');
  assert.equal(createNoRepeat(items, { random: mulberry32(1) }).seek(99), 12, 'الموضع محصور بطول الطابور');
  assert.equal(createNoRepeat(items, { random: mulberry32(1) }).seek(-4), 0);
});

test('renderServiceWorker: قائمة المؤثرات تأتي من manifest البناء، والموسيقى لا تُخزَّن مسبقًا', () => {
  const src = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
  const out = renderServiceWorker(src, { id: '9.9.9-abcdef01', fabrakaImages: ['./media/fabraka-v3/x.webp?v=1'], audioCues: audioCueAssets() });
  assert.ok(!out.includes('__BUILD_ID__') && out.includes('maydan-platform-9.9.9-abcdef01'));
  assert.ok(!out.includes('/*__AUDIO_CUES__*/'), 'placeholder replaced');
  for (const entry of Object.values(SAMPLE_BANK)) assert.ok(out.includes(`"./${entry.url}"`), `${entry.url} precached`);
  assert.ok(!out.includes('audio/music/'));
  assert.ok(out.includes('./media/fabraka-v3/x.webp?v=1'));
});

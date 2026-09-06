import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { arabicNormalizeLoose } from '../src/shared/lib/arabicNormalize.js';

const read = (p) => JSON.parse(readFileSync(path.resolve('src/data/games', p), 'utf8'));
const beep = read('beep/prompts.json');
const mamnoo = read('mamnoo/cards.json');
const fabraka = read('fabraka/questions.json');
const meenfina = read('meenfina/statements.json');
const jabeenFiles = readdirSync(path.resolve('src/data/games/jabeen')).filter((f) => f.endsWith('.json'));
const jabeen = jabeenFiles.map((f) => read(`jabeen/${f}`));

// كل ملفات المحتوى تخضع لنفس الفحوص الأساسية: عدد أدنى، معرّفات فريدة، لا نصوص فارغة، لا تكرار.
function assertCommon(name, items, { min, textOf }) {
  assert.ok(items.length >= min, `${name}: ${items.length} عنصرًا فقط، والمطلوب ${min} على الأقل`);
  assert.equal(new Set(items.map((i) => i.id)).size, items.length, `${name}: معرّف مكرر`);
  for (const item of items) {
    assert.ok(item.id && typeof item.id === 'string', `${name}: عنصر بلا معرّف`);
    const text = textOf(item);
    assert.ok(typeof text === 'string' && text.trim().length > 0, `${name}/${item.id}: نص فارغ`);
  }
  const keys = items.map((i) => arabicNormalizeLoose(textOf(i)));
  assert.equal(new Set(keys).size, keys.length, `${name}: نص مكرر`);
}

test('قبل ما يطق: ≥ 200 طلب، كلها «اذكر 3»، وصعوبة 1–3', () => {
  assertCommon('beep', beep, { min: 200, textOf: (i) => i.text });
  for (const p of beep) {
    assert.ok(p.text.startsWith('اذكر 3'), `beep/${p.id}: «${p.text}» لا يبدأ بـ «اذكر 3»`);
    assert.ok([1, 2, 3].includes(p.difficulty), `beep/${p.id}: صعوبة ${p.difficulty}`);
    assert.ok(p.category && p.category.trim(), `beep/${p.id}: بلا فئة`);
  }
  for (const level of [1, 2, 3]) assert.ok(beep.filter((p) => p.difficulty === level).length >= 20, `beep: أقل من 20 طلبًا بصعوبة ${level}`);
});

test('ممنوع: ≥ 200 بطاقة، 5 كلمات ممنوعة بالضبط، ولا اشتقاق من الكلمة نفسها', () => {
  assertCommon('mamnoo', mamnoo, { min: 200, textOf: (i) => i.word });
  for (const c of mamnoo) {
    assert.ok(Array.isArray(c.forbidden), `mamnoo/${c.id}: forbidden ليست مصفوفة`);
    assert.equal(c.forbidden.length, 5, `mamnoo/${c.id}: ${c.forbidden.length} كلمات ممنوعة`);
    assert.equal(new Set(c.forbidden.map(arabicNormalizeLoose)).size, 5, `mamnoo/${c.id}: كلمة ممنوعة مكررة`);
    const word = arabicNormalizeLoose(c.word);
    for (const f of c.forbidden) {
      assert.ok(f && f.trim(), `mamnoo/${c.id}: كلمة ممنوعة فارغة`);
      assert.notEqual(arabicNormalizeLoose(f), word, `mamnoo/${c.id}: «${f}» هي الكلمة نفسها`);
    }
    assert.ok([1, 2, 3].includes(c.difficulty), `mamnoo/${c.id}: صعوبة`);
    assert.ok(c.category && c.category.trim(), `mamnoo/${c.id}: بلا فئة`);
  }
});

test('على جبينك: ≥ 8 فئات × ≥ 30 عنصرًا، ولا تكرار داخل الفئة', () => {
  assert.ok(jabeen.length >= 8, `${jabeen.length} فئات فقط`);
  assert.equal(new Set(jabeen.map((c) => c.id)).size, jabeen.length, 'معرّف فئة مكرر');
  for (const c of jabeen) {
    assert.ok(c.name && c.name.trim(), `jabeen/${c.id}: بلا اسم`);
    assert.ok(c.icon && c.icon.trim(), `jabeen/${c.id}: بلا أيقونة`);
    assertCommon(`jabeen/${c.id}`, c.items, { min: 30, textOf: (i) => i.text });
  }
});

test('فبركة: ≥ 120 سؤالًا، كل نص فيه ___ مرة واحدة وإجابة غير فارغة', () => {
  assertCommon('fabraka', fabraka, { min: 120, textOf: (i) => i.text });
  for (const q of fabraka) {
    const blanks = q.text.split('___').length - 1;
    assert.equal(blanks, 1, `fabraka/${q.id}: ${blanks} فراغات`);
    assert.ok(q.answer && String(q.answer).trim(), `fabraka/${q.id}: إجابة فارغة`);
    assert.ok(String(q.answer).length <= 60, `fabraka/${q.id}: إجابة طويلة`);
    assert.ok(q.explanation && q.explanation.trim(), `fabraka/${q.id}: بلا شرح`);
    // الإجابة يجب ألا تكون مكتوبة داخل نص السؤال، وإلا انكشفت
    assert.ok(!q.text.replace('___', '').includes(String(q.answer)), `fabraka/${q.id}: الإجابة ظاهرة في السؤال`);
  }
  assert.equal(new Set(fabraka.map((q) => arabicNormalizeLoose(q.text))).size, fabraka.length, 'سؤال مكرر');
});

test('مين فينا: ≥ 150 عبارة، تبدأ بـ «مين فينا» وتنتهي بعلامة استفهام، ولكل عبارة وسم', () => {
  assertCommon('meenfina', meenfina, { min: 150, textOf: (i) => i.text });
  for (const s of meenfina) {
    assert.ok(s.text.startsWith('مين فينا'), `meenfina/${s.id}: «${s.text}» لا تبدأ بـ «مين فينا»`);
    assert.ok(s.text.trim().endsWith('؟'), `meenfina/${s.id}: لا تنتهي بعلامة استفهام`);
    assert.ok(s.tag && s.tag.trim(), `meenfina/${s.id}: بلا وسم`);
  }
});

test('لا محتوى خارج حدود الجلسة العائلية', () => {
  // فحص خشن يمنع عودة المواضيع الممنوعة عند إضافة محتوى لاحقًا.
  // المطابقة بالكلمة الكاملة: «أقمار المريخ» ليست «قمار».
  const banned = ['خمر', 'خمور', 'كحول', 'سيجارة', 'سجائر', 'تدخين', 'مخدرات', 'قمار', 'رهان',
    'غبي', 'أحمق', 'كافر', 'حزب', 'انتخابات', 'رئيس الوزراء', 'طائفة'];
  const all = [
    ...beep.map((i) => i.text),
    ...mamnoo.flatMap((c) => [c.word, ...c.forbidden]),
    ...jabeen.flatMap((c) => c.items.map((i) => i.text)),
    ...fabraka.flatMap((q) => [q.text, String(q.answer), q.explanation]),
    ...meenfina.map((i) => i.text),
  ];
  for (const word of banned) {
    const re = new RegExp(`(^|[^\\p{L}])${word}([^\\p{L}]|$)`, 'u');
    const hit = all.find((text) => re.test(text));
    assert.ok(!hit, `المحتوى يحتوي كلمة ممنوعة «${word}»: ${hit}`);
  }
});

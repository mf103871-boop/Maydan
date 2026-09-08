import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { HIDDEN_TIERS, HIDDEN_THEMES, TARGET, buildHiddenPack, targetQuadrant } from './helpers/hidden-generator.mjs';

const pack = JSON.parse(await readFile(new URL('../src/data/categories/hidden.json', import.meta.url), 'utf8'));
const graphemes = new Intl.Segmenter('ar', { granularity: 'grapheme' });
const fingerprint = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

test('البطة المخفية: 240 شبكة أصلية وستة مجالات مع 48 في كل شريحة', () => {
  assert.equal(pack.id, 'hidden');
  assert.equal(pack.name, 'البطة المخفية');
  assert.equal(pack.qs.length, 240);
  assert.equal(new Set(pack.qs.map((q) => q.qid)).size, 240);
  assert.deepEqual(new Set(pack.qs.map((q) => q.topic)), new Set(HIDDEN_THEMES.map((theme) => theme.topic)));
  for (const { p } of HIDDEN_TIERS) {
    const questions = pack.qs.filter((q) => q.p === p);
    assert.equal(questions.length, 48);
    for (const { topic } of HIDDEN_THEMES) assert.equal(questions.filter((q) => q.topic === topic).length, 8);
  }
  assert.deepEqual(pack.qs.map((q) => q.qid), [...pack.qs].sort((a, b) => a.p - b.p || a.qid.localeCompare(b.qid)).map((q) => q.qid));
});

test('البطة المخفية: هدف واحد فقط وشكل مستطيل ورمز مرئي واحد في كل خلية', () => {
  for (const q of pack.qs) {
    const { side } = HIDDEN_TIERS.find((tier) => tier.p === q.p);
    const theme = HIDDEN_THEMES.find((item) => item.topic === q.topic);
    const allowed = new Set([TARGET, ...theme.distinct, ...theme.similar]);
    assert.equal(q.type, 'grid', q.qid);
    assert.equal(q.target, TARGET, q.qid);
    assert.equal(q.verified, true, q.qid);
    assert.equal(q.q, '', 'لا تُضاف أرقام حشو لتفادي تكرار تعليمات الشبكة');
    assert.equal(q.media, undefined, 'لا ملفات أو مصادر اصطناعية');
    const targetIndex = q.grid.flat().indexOf(TARGET);
    const answerRow = '٠١٢٣٤٥٦٧٨٩'[Math.floor(targetIndex / side) + 1];
    const answerColumn = '٠١٢٣٤٥٦٧٨٩'[targetIndex % side + 1];
    assert.equal(q.a, `الصف ${answerRow}، العمود ${answerColumn} من اليسار`, 'الإحداثيات تطابق الخلية المبرزة');
    assert.equal(q.a.split(/\s+/).length, 6, 'إجابة الإحداثيات ضمن الحد');
    assert.equal(q.grid.length, side, q.qid);
    assert.ok(q.grid.every((row) => Array.isArray(row) && row.length === side), q.qid);
    assert.equal(q.grid.flat().filter((cell) => cell === TARGET).length, 1, q.qid);
    for (const cell of q.grid.flat()) {
      assert.ok(allowed.has(cell), `${q.qid}: رمز خارج موضوعه`);
      assert.equal([...graphemes.segment(cell)].length, 1, `${q.qid}: أكثر من رمز في خلية`);
    }
    assert.ok(new Set(q.grid.flat()).size >= 4, `${q.qid}: تنوع بصري ضئيل`);
  }
});

test('البطة المخفية: اختلاف الشبكات ليس مجرد نقل الهدف فوق الخلفية نفسها', () => {
  assert.equal(new Set(pack.qs.map((q) => fingerprint(q.grid))).size, 240);
  const arrangementsWithoutTarget = pack.qs.map((q) => fingerprint(q.grid.map((row) => row.map((cell) => cell === TARGET ? null : cell))));
  assert.equal(new Set(arrangementsWithoutTarget).size, 240);
  for (let i = 0; i < pack.qs.length; i += 1) {
    const first = pack.qs[i];
    for (const second of pack.qs.slice(i + 1).filter((q) => q.p === first.p && q.topic === first.topic)) {
      const a = first.grid.flat();
      const b = second.grid.flat();
      const positions = a.map((cell, index) => ({ cell, other: b[index] })).filter(({ cell, other }) => cell !== TARGET && other !== TARGET);
      const differences = positions.filter(({ cell, other }) => cell !== other).length;
      assert.ok(differences >= Math.ceil(positions.length * 0.25), `${first.qid}/${second.qid}: خلفيتان متقاربتان جدًا`);
    }
  }
});

test('البطة المخفية: مواقع الهدف تشمل الزوايا والحواف والداخل وتتوازن بين الأرباع', () => {
  for (const { p, side } of HIDDEN_TIERS) {
    const positions = [];
    const quadrants = [0, 0, 0, 0];
    for (const q of pack.qs.filter((question) => question.p === p)) {
      const index = q.grid.flat().indexOf(TARGET);
      const row = Math.floor(index / side);
      const column = index % side;
      positions.push(index);
      quadrants[targetQuadrant(row, column, side)] += 1;
    }
    assert.deepEqual(quadrants, [12, 12, 12, 12], String(p));
    for (const corner of [0, side - 1, side * (side - 1), side * side - 1]) assert.ok(positions.includes(corner), `${p}: زاوية غير مستعملة`);
    assert.ok(positions.some((index) => Math.floor(index / side) > 0 && Math.floor(index / side) < side - 1 && index % side > 0 && index % side < side - 1));
    assert.ok(new Set(positions).size >= Math.min(40, side * side), `${p}: مواقع متكررة أكثر من اللازم`);
    for (const { topic } of HIDDEN_THEMES) {
      const perTopic = [0, 0, 0, 0];
      for (const q of pack.qs.filter((question) => question.p === p && question.topic === topic)) {
        const index = q.grid.flat().indexOf(TARGET);
        perTopic[targetQuadrant(Math.floor(index / side), index % side, side)] += 1;
      }
      assert.deepEqual(perTopic, [2, 2, 2, 2], `${p}/${topic}`);
    }
  }
});

test('البطة المخفية: يزيد مجال البحث وعدد المشتتات المتقاربة تدريجيًا', () => {
  let previousCells = 0;
  let previousSimilar = 0;
  for (const { p, side, nearFraction } of HIDDEN_TIERS) {
    const cellCount = side * side;
    const expectedSimilar = Math.round((cellCount - 1) * nearFraction);
    assert.ok(cellCount > previousCells);
    assert.ok(expectedSimilar > previousSimilar);
    for (const q of pack.qs.filter((question) => question.p === p)) {
      const theme = HIDDEN_THEMES.find((item) => item.topic === q.topic);
      assert.equal(q.grid.flat().filter((cell) => theme.similar.includes(cell)).length, expectedSimilar, q.qid);
    }
    previousCells = cellCount;
    previousSimilar = expectedSimilar;
  }
});

test('البطة المخفية: البذور الثابتة تعيد إنتاج الملف بالكامل دون شبكة', () => {
  assert.deepEqual(pack, buildHiddenPack());
});

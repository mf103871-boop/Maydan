import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import badeeha from '../src/games/badeeha/meta.js';
import beep from '../src/games/beep/meta.js';
import mamnoo from '../src/games/mamnoo/meta.js';
import jabeen from '../src/games/jabeen/meta.js';
import fabraka from '../src/games/fabraka/meta.js';
import meenfina from '../src/games/meenfina/meta.js';

// meta.js لكل لعبة خالٍ من React ليُختبر في Node؛ index.js يضيف الأيقونة والمكوّن.
const METAS = [badeeha, beep, mamnoo, jabeen, fabraka, meenfina];

test('ست ألعاب بمعرّفات فريدة', () => {
  assert.equal(METAS.length, 6);
  assert.equal(new Set(METAS.map((g) => g.id)).size, 6);
  assert.deepEqual(METAS.map((g) => g.id), ['badeeha', 'beep', 'mamnoo', 'jabeen', 'fabraka', 'meenfina']);
});

test('كل manifest يحتوي الحقول المطلوبة بأنواعها', () => {
  for (const g of METAS) {
    assert.match(g.id, /^[a-z][a-z0-9-]*$/, `${g.id}: معرّف غير صالح`);
    for (const key of ['name', 'tagline', 'description', 'accent', 'duration', 'version']) {
      assert.equal(typeof g[key], 'string', `${g.id}.${key}`);
      assert.ok(g[key].length > 0, `${g.id}.${key} فارغ`);
    }
    assert.match(g.accent, /^#[0-9A-Fa-f]{6}$/, `${g.id}.accent`);
    assert.ok(Array.isArray(g.howToPlay) && g.howToPlay.length >= 3, `${g.id}.howToPlay`);
    assert.ok(g.howToPlay.every((s) => typeof s === 'string' && s.trim()), `${g.id}.howToPlay فيه نص فارغ`);
    assert.ok(Array.isArray(g.tags) && g.tags.length > 0, `${g.id}.tags`);
    assert.equal(typeof g.players, 'object', `${g.id}.players`);
    assert.ok(Number.isInteger(g.players.min) && g.players.min >= 2, `${g.id}.players.min`);
    assert.ok(Number.isInteger(g.players.max) && g.players.max >= g.players.min, `${g.id}.players.max`);
    assert.ok(['teams', 'individual', 'both'].includes(g.players.mode), `${g.id}.players.mode`);
    assert.equal(typeof g.isNew, 'boolean', `${g.id}.isNew`);
  }
});

test('لكل لعبة لون accent مختلف، ومعرّف بلون معرّف في tokens.css', () => {
  const accents = METAS.map((g) => g.accent.toUpperCase());
  assert.equal(new Set(accents).size, accents.length, 'ألوان مكررة');
  const tokens = readFileSync(path.resolve('src/shared/theme/tokens.css'), 'utf8');
  for (const g of METAS) {
    assert.ok(tokens.includes(`--g-${g.id}: ${g.accent}`), `tokens.css ينقصه --g-${g.id}`);
  }
});

test('السجل يستورد كل لعبة ويصدّر GAMES و getGame', () => {
  const src = readFileSync(path.resolve('src/platform/registry.js'), 'utf8');
  for (const g of METAS) assert.ok(src.includes(`games/${g.id}/index.js`), `السجل لا يستورد ${g.id}`);
  assert.ok(src.includes('export const GAMES'));
  assert.ok(src.includes('export function getGame'));
});

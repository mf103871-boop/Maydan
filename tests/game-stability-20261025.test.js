import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { standings } from '../src/games/beep/logic.js';
import { createItemSource, initialState, normalizeOptions, restoreSession, sessionSnapshot } from '../src/games/jabeen/logic.js';
import { createNoRepeat } from '../src/shared/lib/noRepeat.js';
import { mulberry32 } from '../src/shared/lib/rng.js';

const players = [{ id: 'early', name: 'خرج أولًا' }, { id: 'later', name: 'خرج لاحقًا' }, { id: 'winner', name: 'الناجي' }];
const bomb = (patch = {}) => ({ mode: 'bomb', players, eliminated: ['early', 'later'],
  lives: { early: 0, later: 0, winner: 1 }, passes: { early: 10000, later: 0, winner: 0 }, ...patch });

test('bomb survival and elimination placement cannot be outweighed by any number of passes', () => {
  const entries = standings(bomb());
  assert.deepEqual(entries.map(e => e.id), ['winner', 'later', 'early']);
  assert.deepEqual(entries.map(e => e.score), [1, 0, 0], 'hearts remain the visible score');
  assert.deepEqual(entries.map(e => e.rankScore), [3, 2, 1], 'distinct actual placements');
  const survivors = standings(bomb({ eliminated: [], lives: { early: 2, later: 2, winner: 3 }, passes: { early: 4, later: 4, winner: 0 } }));
  assert.equal(survivors[0].id, 'winner');
  assert.equal(survivors[1].rankScore, survivors[2].rankScore, 'equal living players retain a genuine tie');
  const tiebreak = standings(bomb({ eliminated: [], lives: { early: 2, later: 2, winner: 3 }, passes: { early: 3, later: 4, winner: 0 } }));
  assert.deepEqual(tiebreak.map(e => e.id), ['winner', 'later', 'early']);
});

const root = process.cwd(), cache = path.resolve(root, '.cache');
mkdirSync(cache, { recursive: true });
const dir = mkdtempSync(path.join(cache, 'game-stability-'));
after(() => { if (path.dirname(dir) === cache) rmSync(dir, { recursive: true, force: true }); });
await build({ stdin: { contents: `import React from 'react';import{renderToStaticMarkup}from'react-dom/server';import{Podium}from'./src/shared/ui/components.jsx';export const podium=entries=>renderToStaticMarkup(React.createElement(Podium,{entries,unit:' ❤️'}));`, resolveDir: root, loader: 'jsx' },
  outfile: path.join(dir, 'render.mjs'), bundle: true, platform: 'node', format: 'esm', packages: 'external', jsx: 'automatic',
  loader: { '.css': 'text', '.webp': 'dataurl', '.woff2': 'dataurl' }, logLevel: 'silent' });
const render = await import(pathToFileURL(path.join(dir, 'render.mjs')));

test('actual podium renders survivor first and distinct second/third places with zero-heart losers', () => {
  const html = render.podium(standings(bomb()));
  assert.ok(html.includes('فاز الناجي'));
  const columns = [...html.matchAll(/data-rank="(\d+)"[\s\S]*?<span class="name">([^<]+)<\/span>/g)].map(m => [m[1], m[2]]);
  assert.deepEqual(columns, [['2', 'خرج لاحقًا'], ['1', 'الناجي'], ['3', 'خرج أولًا']]);
  const ordinary = render.podium([{ id: 'a', name: 'أول', score: 10 }, { id: 'b', name: 'ثان', score: 10 }]);
  assert.ok(ordinary.includes('تعادل جميل!'), 'score-only games keep their established tie behavior');
  assert.equal([...ordinary.matchAll(/data-rank="1"/g)].length, 2);
});

const category = { id: 'home', name: 'أشياء', items: Array.from({ length: 7 }, (_, i) => ({ id: `item-${i}`, text: `عنصر ${i}` })) };
const cycleIds = source => Array.from({ length: source.total }, () => source.next().id);

test('explicit exhaustion reshuffles without boundary repeats even when RNG repeats a permutation', () => {
  for (const random of [() => 0, () => .999999, mulberry32(81)]) {
    const source = createItemSource(category, { random });
    let before = cycleIds(source);
    for (let cycle = 1; cycle < 8; cycle++) {
      assert.equal(source.next(), null);
      source.reset({ reshuffle: true });
      const next = cycleIds(source);
      assert.equal(new Set(next).size, category.items.length);
      assert.notDeepEqual(next, before);
      assert.notEqual(next[0], before.at(-1));
      assert.equal(source.cycle, cycle);
      before = next;
    }
  }
  for (const total of [0, 1, 2]) {
    const source = createNoRepeat(category.items.slice(0, total), { random: () => 0 });
    const before = cycleIds(source); source.reset({ reshuffle: true }); const next = cycleIds(source);
    assert.equal(next.length, total);
    if (total > 1) assert.notEqual(next[0], before.at(-1));
  }
});

test('Jabeen resume after multiple reshuffles restores the exact queue and future seeded cycles', () => {
  const people = [{ id: 'a', name: 'أحمد' }, { id: 'b', name: 'سارة' }];
  const settings = normalizeOptions({ categoryId: category.id, control: 'touch' }, [category]);
  const source = createItemSource(category, { random: mulberry32(37), seen: { 'item-0': 1 } });
  for (let c = 0; c < 3; c++) { cycleIds(source); source.reset({ reshuffle: true }); }
  source.next(); source.next();
  const raw = sessionSnapshot({ players: people, settings, seed: 37, cursor: source.cursor, cycle: source.cycle,
    timeLeft: null, state: initialState(people, category, settings) });
  const saved = restoreSession(JSON.parse(JSON.stringify(raw)), [category]);
  assert.ok(saved);
  const resumed = createItemSource(category, { random: mulberry32(saved.seed), seen: { 'item-0': 1 } });
  resumed.seek(saved.cursor, { cycles: saved.cycle });
  for (let n = 0; n < 30; n++) {
    if (!source.remaining) { source.reset({ reshuffle: true }); resumed.reset({ reshuffle: true }); }
    assert.equal(resumed.next().id, source.next().id);
  }
  assert.ok(restoreSession({ ...raw, cycle: undefined }, [category]), 'existing pre-fix snapshots remain compatible');
  for (const cycle of [-1, .5, 2001, '2']) assert.equal(restoreSession({ ...raw, cycle }, [category]), null);
});

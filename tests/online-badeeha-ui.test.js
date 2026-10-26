import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { CATS } from '../src/data/categories/index.js';

const root = process.cwd();
mkdirSync(path.join(root, '.cache'), { recursive: true });
const directory = mkdtempSync(path.join(root, '.cache', 'online-badeeha-ui-'));
after(() => rmSync(directory, { recursive: true, force: true }));
await build({ stdin: { contents: `import React from 'react'; import {renderToStaticMarkup} from 'react-dom/server'; import {BadeehaMatch} from './src/online/Badeeha.jsx'; export const match=p=>renderToStaticMarkup(React.createElement(BadeehaMatch,p)).replace(/<style>[\\s\\S]*?<\\/style>/g,'');`, resolveDir: root, loader: 'jsx' },
  outfile: path.join(directory, 'render.mjs'), bundle: true, platform: 'node', format: 'esm', packages: 'external', jsx: 'automatic', loader: { '.css': 'text', '.webp': 'dataurl', '.woff2': 'dataurl' }, logLevel: 'silent' });
const { match } = await import(pathToFileURL(path.join(directory, 'render.mjs')));

function fixture(question, category, phase = 'question') {
  const members = [{ id: 'host', name: 'المضيف', connected: true }, { id: 'guest', name: 'الضيف', connected: true }];
  const state = { game: 'badeeha', phase, code: '123456', matchId: 1, round: 1, rounds: 20, turnId: 'host',
    settings: { mode: 'standard', categories: [category.id], deck: { [category.id]: [{ qid: question.qid, p: question.p }] } },
    members, teams: members.map(m => ({ id: m.id, score: 0, correct: 0, steals: 0, tools: { double: true, two: true, time: true } })),
    used: [], current: { categoryId: category.id, qid: question.qid, p: question.p, index: 0 }, effect: { double: false, two: false }, hintsUsed: 0, verdict: null, deadlineAt: Date.now() + 60_000 };
  return { state, me: members[0], isHost: true, disabled: false, act() {}, clockOffset: 0 };
}

test('online question renderer includes the instructions omitted by the shared visual body', () => {
  const category = CATS.find(c => c.id === 'flags');
  const question = category.qs[0];
  const html = match(fixture(question, category));
  assert.match(html, /ما الذي في الصورة؟/);
  assert.doesNotMatch(html, /تُقبل أيضًا:|class="badeeha-answer"/);
});

test('accepted alternatives are visible only after the reveal so the host can judge fairly', () => {
  const category = CATS.find(c => c.qs.some(q => q.alt?.length));
  const question = category.qs.find(q => q.alt?.length);
  assert.doesNotMatch(match(fixture(question, category)), /تُقبل أيضًا:/);
  const revealed = match(fixture(question, category, 'reveal'));
  assert.match(revealed, /تُقبل أيضًا:/);
  for (const alternative of question.alt) assert.ok(revealed.includes(alternative), alternative);
});

test('restarting a Badeeha room explicitly says the deck repeats instead of promising fresh questions', () => {
  const category = CATS[0], question = category.qs[0];
  const html = match(fixture(question, category, 'over'));
  assert.match(html, /العودة للانتظار وإعادة نفس الأسئلة/);
  assert.match(html, /لأسئلة جديدة، اخرجوا وأنشئوا غرفة جديدة/);
});

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { normalizeErsomhaOptions, enoughErsomhaCategories } from '../src/games/ersomha/options.js';
import { ERSOMHA_CATEGORIES } from '../src/online/shared.js';
import meta from '../src/games/ersomha/meta.js';

const root = process.cwd();
mkdirSync(path.join(root, '.cache'), { recursive: true });
const dir = mkdtempSync(path.join(root, '.cache', 'ersomha-ui-'));
after(() => rmSync(dir, { recursive: true, force: true }));
await build({ stdin: { contents: `import React from 'react'; import {renderToStaticMarkup} from 'react-dom/server'; import {ErsomhaMatch,ErsomhaSettings,ErsomhaRules,ErsomhaHints} from './src/online/Ersomha.jsx'; import {Lobby} from './src/online/Online.jsx'; import {PlatformContext} from './src/platform/context.js'; export const match=p=>renderToStaticMarkup(React.createElement(ErsomhaMatch,p)); export const settings=p=>renderToStaticMarkup(React.createElement(ErsomhaSettings,p)); export const hints=p=>renderToStaticMarkup(React.createElement(ErsomhaHints,p)); export const rules=()=>renderToStaticMarkup(React.createElement(ErsomhaRules)); export const lobby=p=>{const previous=globalThis.location;globalThis.location={href:'https://example.test/#/room/123456'};try{return renderToStaticMarkup(React.createElement(PlatformContext.Provider,{value:{toast(){}}},React.createElement(Lobby,p)))}finally{globalThis.location=previous}};`, resolveDir: root, loader: 'jsx' }, outfile: path.join(dir, 'render.mjs'), bundle: true, platform: 'node', format: 'esm', packages: 'external', jsx: 'automatic', loader: { '.css': 'text', '.webp': 'dataurl', '.woff2': 'dataurl' }, logLevel: 'silent' });
const render = await import(pathToFileURL(path.join(dir, 'render.mjs')));
const noop = () => {};
function fixture(patch = {}) {
  return { game: 'ersomha', phase: 'draw', code: '123456', matchId: 'match-1', round: 1, rounds: 3, mode: 'competitive', drawerId: 'one', deadlineAt: Date.now() + 60_000, settings: normalizeErsomhaOptions(), participants: ['one', 'two', 'three'], members: [{ id: 'one', name: 'رسّام', avatar: 0, score: 100, connected: true }, { id: 'two', name: 'مخمّن', avatar: 1, score: 150, connected: true }, { id: 'three', name: 'صديق', avatar: 2, score: 0, connected: true }], drawing: { epoch: 1, seq: 0 }, myWord: null, myChoices: [], publicWord: { wordLengths: [], letters: [] }, guessedIds: [], recentGuesses: [], ...patch };
}
function html(state, index = 1, extra = {}) { return render.match({ state, me: state.members[index], disabled: false, isHost: index === 0, act: noop, ...extra }).replace(/<style>[\s\S]*?<\/style>/g, ''); }

test('Ersomha options and metadata expose only supported private online play', () => {
  assert.deepEqual(normalizeErsomhaOptions(), { cycles: 1, drawSeconds: 60, difficulty: 'medium', categories: [], allowReplay: false });
  for (const emptyPreference of [null, false, 0, 'old-corrupt-pref', []]) assert.deepEqual(normalizeErsomhaOptions(emptyPreference), normalizeErsomhaOptions());
  assert.deepEqual(normalizeErsomhaOptions({ cycles: 9, difficulty: 'unsafe', categories: ['animals', 'animals', 'unknown'], allowReplay: 1 }), { cycles: 1, drawSeconds: 60, difficulty: 'medium', categories: ['animals'], allowReplay: false });
  assert.equal(enoughErsomhaCategories({ categories: ['animals', 'food'] }), false);
  assert.equal(enoughErsomhaCategories({ categories: ['animals', 'food', 'home'] }), true);
  assert.deepEqual(normalizeErsomhaOptions({ categories: ERSOMHA_CATEGORIES.map(category => category.id) }).categories, []);
  assert.equal(meta.onlineOnly, true); assert.equal(meta.players.min, 2); assert.equal(meta.players.max, 8);
  const markup = render.settings({ value: normalizeErsomhaOptions(), onChange: noop });
  for (const category of ERSOMHA_CATEGORIES) assert.ok(markup.includes(category.label));
  for (const text of ['دور لكل لاعب', 'دوران لكل لاعب', 'تحدّي', 'تعاون ضد الوقت']) assert.ok(markup.includes(text));
  assert.match(render.rules(), /١٠٠ نقطة/);
});

test('only the drawer sees word choices; native mute readiness shields all private content', () => {
  const state = fixture({ phase: 'select', myChoices: [{ id: 'a', text: 'PRIVATE_ANSWER_A', category: 'home' }, { id: 'b', text: 'PRIVATE_ANSWER_B', category: 'animals' }, { id: 'c', text: 'PRIVATE_ANSWER_C', category: 'food' }] });
  assert.match(html(state, 0), /PRIVATE_ANSWER_A/);
  assert.doesNotMatch(html(state), /PRIVATE_ANSWER_[ABC]/);
  assert.doesNotMatch(html(state, 0, { drawerReady: false }), /PRIVATE_ANSWER_[ABC]/);
  assert.match(html(state, 0, { drawerReady: false }), /نكتم الميكروفون أولًا/);
  const draw = fixture({ myWord: 'PRIVATE_DRAW_WORD' });
  assert.match(html(draw, 0), /PRIVATE_DRAW_WORD/);
  assert.doesNotMatch(html(draw, 0, { drawerReady: false }), /PRIVATE_DRAW_WORD/);
  assert.doesNotMatch(html(draw), /PRIVATE_DRAW_WORD/);
});

test('drawing tools, hints, hidden correct guesses and result scores are accessible', () => {
  const draw = fixture({ myWord: 'سر', publicWord: { wordLengths: [3, 4], letters: [{ index: 1, char: 'ح' }] }, recentGuesses: [{ id: 'guess1', playerId: 'two', correct: true, text: null }], guessedIds: ['two'] });
  const drawer = html(draw, 0);
  assert.equal((drawer.match(/class="ers-colour /g) || []).length, 12);
  for (const label of ['تراجع عن آخر خط', 'إعادة الخط المتراجع عنه', 'مسح اللوحة', 'خط رفيع', 'خط متوسط', 'خط عريض']) assert.ok(drawer.includes(label));
  const guessed = html({ ...draw, myGuessed: true });
  assert.match(guessed, /عرفتها!/); assert.doesNotMatch(guessed, /placeholder="ما الرسمة/);
  const waiting = html(draw, 2); assert.match(waiting, /حرف مخفي/); assert.match(waiting, /enterKeyHint="send"/i);
  const result = html(fixture({ phase: 'result', revealedWord: 'حل مكشوف', breakdown: { one: { guess: 0, draw: 50, points: 50 }, two: { guess: 150, draw: 0, points: 150 } } }));
  assert.match(result, /حل مكشوف/); assert.match(result, /\+١٥٠/); assert.match(result, /الدور التالي يبدأ تلقائيًا/);
});

test('two-player mode displays a shared outcome and no individual winner', () => {
  const state = fixture({ mode: 'cooperative', phase: 'over', cooperative: { solvedTurns: 2, completedTurns: 2, totalTurns: 2, remainingMs: 31_000 } });
  const markup = html(state, 0);
  assert.match(markup, /معًا رسمتوها/); assert.match(markup, /لوحات محلولة/); assert.match(markup, /٣١/); assert.doesNotMatch(markup, /class="podium/);
  for (const reason of ['account_unavailable', 'active_elsewhere', 'account_active_elsewhere']) {
    const ended = html({ ...state, reason }); assert.match(ended, /حصيلة الأدوار المكتملة/); assert.doesNotMatch(ended, /معًا رسمتوها/);
    assert.match(ended, reason === 'account_unavailable' ? /لم يعد متاحًا للعب/ : /انتقل إلى غرفة أخرى/);
  }
});

test('Ersomha waiting room describes two-player cooperation and lets the host change categories explicitly', () => {
  const state = fixture({ phase: 'lobby', hostId: 'one', members: fixture().members.slice(0, 2).map(player => ({ ...player, ready: true })) });
  const markup = render.lobby({ state, me: state.members[0], isHost: true, disabled: false, act: noop }).replace(/<style>[\s\S]*?<\/style>/g, '');
  assert.match(markup, /ثنائي متعاون/); assert.match(markup, /تعديل الصعوبة والفئات/); assert.match(markup, /ابدأ اللعب/);
  assert.doesNotMatch(markup, /٣٠ ثانية لكل تصويت/);
});

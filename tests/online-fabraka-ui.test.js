import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import * as game from '../server/game-model.mjs';
import { normalizeOptions } from '../src/games/fabraka/logic.js';
import { buildFabrakaDeck } from '../server/fabraka-content.mjs';

const root = process.cwd();
mkdirSync(path.join(root, '.cache'), { recursive: true });
const dir = mkdtempSync(path.join(root, '.cache', 'online-fabraka-ui-'));
after(() => rmSync(dir, { recursive: true, force: true }));
await build({ stdin: { contents: `import React from 'react'; import {renderToStaticMarkup} from 'react-dom/server'; import {FabrakaMatch,FabrakaSettings,FabrakaRules} from './src/online/Fabraka.jsx'; export const match=p=>renderToStaticMarkup(React.createElement(FabrakaMatch,p)); export const settings=p=>renderToStaticMarkup(React.createElement(FabrakaSettings,p)); export const rules=()=>renderToStaticMarkup(React.createElement(FabrakaRules));`, resolveDir: root, loader: 'jsx' },
  outfile: path.join(dir, 'render.mjs'), bundle: true, platform: 'node', format: 'esm', packages: 'external', jsx: 'automatic', loader: { '.css': 'text', '.webp': 'dataurl', '.woff2': 'dataurl' }, logLevel: 'silent' });
const render = await import(pathToFileURL(path.join(dir, 'render.mjs')));
const noop = () => {};
function fixture(settings = {}) {
  const now = Date.now();
  const profiles = Array.from({ length: 3 }, (_, n) => ({ id: String(n + 1).repeat(32), tokenHash: String(n + 1).repeat(64), name: `كاتب ${n}`, avatar: n }));
  const room = game.createRoom('123456', { ...profiles[0], game: 'fabraka', settings: { rounds: 3, discussionSeconds: 20, ...settings } }, now);
  for (const p of profiles.slice(1)) game.joinRoom(room, p, now);
  const deck = Array.from({ length: 24 }, (_, n) => ({ id: `q${n}`, text: 'الحقيقة هي ___', kind: 'text', answer: 'CORRECT_TOKEN', aliases: [], decoys: ['HOUSE_A', 'HOUSE_B', 'HOUSE_C'], explanation: 'EXPLANATION_TOKEN' }));
  const act = (n, type, fields = {}) => game.action(room, profiles[n].id, { type, round: room.round, matchId: room.matchId, ...fields }, now, settings.mode === 'pictures' ? buildFabrakaDeck(room) : deck);
  for (const [n, p] of profiles.entries()) { game.connected(room, p.id, true, now); act(n, 'ready', { ready: true }); }
  const html = (n = 0) => {
    const state = game.snapshot(room, profiles[n].id, now);
    return render.match({ state, me: state.members[n], isHost: n === 0, disabled: false, act: noop, clockOffset: 0 }).replace(/<style>[\s\S]*?<\/style>/g, '');
  };
  act(0, 'start');
  return { room, act, html };
}

test('online writing, anonymous voting, staged reveal and final scores render from real sanitized snapshots', () => {
  const { room, act, html } = fixture();
  for (let round = 1; round <= 3; round++) {
    assert.match(html(1), /فبركتك السرية/);
    act(0, 'lie', { text: 'PRIVATE_ALPHA' });
    assert.match(html(0), /وصلت إجابتك/);
    assert.doesNotMatch(html(1), /PRIVATE_ALPHA|CORRECT_TOKEN|EXPLANATION_TOKEN/);
    act(1, 'lie', { text: 'PRIVATE_BETA' }); act(2, 'lie', { text: 'PRIVATE_GAMMA' });
    assert.match(html(1), /ناقشوا الإجابات/);
    assert.doesNotMatch(html(1), /EXPLANATION_TOKEN|is-truth/);
    act(0, 'start_vote');
    const markup = html(0);
    assert.match(markup, /اختيار الحقيقة/); assert.match(markup, /disabled=""><span class="grow">PRIVATE_ALPHA/);
    assert.doesNotMatch(markup, /EXPLANATION_TOKEN|is-truth/);
    const truth = room.fab.options.find((o) => o.truth).id;
    for (let n = 0; n < 3; n++) act(n, 'vote', { optionId: truth });
    while (room.phase === 'reveal') {
      assert.doesNotMatch(html(1), /EXPLANATION_TOKEN|is-truth/);
      act(0, room.fab.groupShown ? 'next_reveal' : 'reveal');
    }
    assert.match(html(1), /EXPLANATION_TOKEN/); assert.match(html(1), /is-truth/); assert.match(html(1), /حصيلة الجولة/);
    act(0, 'next');
  }
  assert.match(html(0), /حصيلة الجلسة/); assert.match(html(0), /كاشف الحقيقة/); assert.match(html(0), /لعب مرة ثانية/);
});

test('friends truth is shown only to its owner and picture rounds render accessible artwork', () => {
  const friends = fixture({ mode: 'friends' });
  assert.match(friends.html(0), /إجابتك الحقيقية عن نفسك/);
  assert.doesNotMatch(friends.html(1), /<input/);
  friends.act(0, 'truth', { text: 'PRIVATE_FRIEND' });
  assert.match(friends.html(0), /PRIVATE_FRIEND/);
  assert.doesNotMatch(friends.html(1), /PRIVATE_FRIEND/);
  const picture = fixture({ mode: 'pictures' });
  assert.match(picture.html(1), /<svg[^>]*role="img"/);
  assert.ok(!picture.html(1).includes(picture.room.fab.question.answer));
});

test('online settings and rules expose all supported modes and scoring choices', () => {
  for (const mode of ['classic', 'mixed', 'pictures', 'friends']) {
    const html = render.settings({ value: normalizeOptions({ mode }), onChange: noop });
    for (const word of ['حقائق', 'مزيج', 'صور', 'أصحابنا', 'وقت الكتابة', 'وقت النقاش', 'بدون نقاش', 'بلا نقاط']) assert.ok(html.includes(word), word);
    if (mode === 'friends') assert.doesNotMatch(html, /مضاعفة نقاط الجولة الأخيرة/);
  }
  assert.match(render.rules(), /١٠٠٠ نقطة/); assert.match(render.rules(), /٥٠٠/);
});

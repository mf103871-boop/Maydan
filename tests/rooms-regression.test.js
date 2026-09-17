// Regressions found while auditing the rooms server against a local Node server
// and miniflare. Every test here failed before the matching fix.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { WebSocket } from 'ws';
import { startLocalServer, MemoryStorage } from '../server/local.mjs';
import { routeRequest, RequestLimiter } from '../server/worker.mjs';
import { securityHeaders } from '../server/full-worker.mjs';
import * as model from '../server/room-model.mjs';
import { RoomClient, newCredentials } from '../src/online/client.js';
import { arabicNumber, errorText, ERRORS } from '../src/online/shared.js';

const ORIGIN = 'http://localhost:3000';
class BrowserSocket extends WebSocket { constructor(url) { super(url, { origin: ORIGIN }); } }

// Server-rendered rooms UI, built the way the app is built (a configured server URL,
// so the create button is only ever disabled by the settings under test).
const ROOMS_URL = 'https://rooms.example';
const root = process.cwd();
mkdirSync(path.join(root, '.cache'), { recursive: true });
const renderDir = mkdtempSync(path.join(root, '.cache', 'rooms-regression-'));
after(() => rmSync(renderDir, { recursive: true, force: true }));
await build({ stdin: { loader: 'jsx', resolveDir: root, contents: `
  import React from 'react';
  import { renderToStaticMarkup } from 'react-dom/server';
  import { PlatformContext } from './src/platform/context.js';
  import { Online, Lobby } from './src/online/Online.jsx';
  import { questions } from './src/games/fabraka/content.js';
  export { save } from './src/online/client.js';
  const platform = { toast() {}, sound: { play() {} }, haptics: { vibrate() {} } };
  const wrap = (Component, props) => renderToStaticMarkup(
    React.createElement(PlatformContext.Provider, { value: platform }, React.createElement(Component, props)));
  export const entry = (props) => wrap(Online, props);
  export const lobby = (props) => wrap(Lobby, props);
  // A real but temporarily small topic keeps the insufficient-pool regression
  // meaningful even when every topic in the current bank has ten questions.
  export function oneFactTopic() {
    const saved = questions.slice(), selected = saved.find(q => q.curious);
    questions.splice(0, questions.length, selected);
    return { category: selected.category, restore: () => questions.splice(0, questions.length, ...saved) };
  }
` }, outfile: path.join(renderDir, 'render.mjs'), bundle: true, platform: 'node', format: 'esm', packages: 'external',
  jsx: 'automatic', define: { __MAYDAN_ROOMS_URL__: JSON.stringify(ROOMS_URL) },
  loader: { '.css': 'text', '.webp': 'dataurl', '.woff2': 'dataurl' }, logLevel: 'silent' });
const ui = await import(pathToFileURL(path.join(renderDir, 'render.mjs')));
const submitButton = (html) => html.slice(html.lastIndexOf('<button'));

async function until(fn, label = 'condition', timeout = 3500) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (fn()) return; await new Promise((resolve) => setTimeout(resolve, 10)); }
  assert.fail(`Timed out: ${label}`);
}
async function api(app, path, data, origin = ORIGIN) {
  const res = await fetch(app.url + path, { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify(data) });
  return { status: res.status, body: await res.json() };
}
async function lobby(t, count = 3) {
  const app = await startLocalServer({ port: 0 }); t.after(() => app.close());
  const profiles = Array.from({ length: count }, (_, n) => ({ ...newCredentials(), name: `لاعب ${n}`, avatar: n % 4, rounds: 5 }));
  const created = await api(app, '/api/rooms', profiles[0]); assert.equal(created.status, 201);
  const code = created.body.code;
  for (const p of profiles.slice(1)) assert.equal((await api(app, `/api/rooms/${code}/join`, p)).status, 200);
  const clients = profiles.map((profile) => {
    const client = new RoomClient({ server: app.url, code, session: { id: profile.id, token: profile.token }, WebSocketImpl: BrowserSocket });
    client.start(); return client;
  });
  t.after(() => clients.forEach((c) => c.stop()));
  await until(() => clients.every((c) => c.state?.members.filter((m) => m.connected).length === count), 'all clients connected');
  return { app, clients, profiles, code };
}
// A raw socket, so the test can send frames the RoomClient would never produce.
async function rawSocket(app, code, session) {
  const ws = new WebSocket(`${app.url.replace('http:', 'ws:')}/api/rooms/${code}/socket`, { origin: ORIGIN });
  const inbox = []; const closes = [];
  ws.on('message', (data) => { const text = data.toString(); inbox.push(text === 'pong' ? { type: 'pong' } : JSON.parse(text)); });
  ws.on('close', (code_, reason) => closes.push({ code: code_, reason: reason.toString() }));
  await new Promise((resolve, reject) => { ws.on('open', resolve); ws.on('error', reject); });
  ws.send(JSON.stringify({ type: 'auth', ...session }));
  await until(() => inbox.some((m) => m.type === 'state'), 'authenticated socket');
  return { ws, inbox, closes, send: (value) => ws.send(JSON.stringify(value)) };
}

test('1 · kicking a seat that already left answers TARGET_GONE and keeps the host signed in', async (t) => {
  const { app, clients, profiles, code } = await lobby(t);
  // The departed player frees the seat; the host presses «إزالة» a moment later.
  assert.equal((await api(app, `/api/rooms/${code}/leave`, profiles[1])).status, 200);
  await until(() => clients[0].state.members.every((m) => m.id !== profiles[1].id), 'seat removed');
  await assert.rejects(clients[0].command('kick', { targetId: profiles[1].id }), (e) => e.code === 'TARGET_GONE');
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(clients[0].connectionStatus, 'connected');
  assert.equal(clients[0].stopped, false);
  assert.equal(clients[0].state.hostId, profiles[0].id);
  // The host is still able to act on the room afterwards.
  await clients[0].command('ready', { ready: false });
  await until(() => clients[2].state.members.find((m) => m.id === profiles[0].id).ready === false, 'host still commands the room');
  assert.equal(errorText('TARGET_GONE'), ERRORS.TARGET_GONE);
});

test('1 · memberOrNull separates a missing seat from a failed authentication', () => {
  const now = Date.now();
  const owner = { id: 'a'.repeat(32), tokenHash: 'b'.repeat(64), name: 'مضيف', avatar: 0 };
  const room = model.createRoom('123456', { ...owner, rounds: 5 }, now);
  assert.equal(model.memberOrNull(room, owner.id).id, owner.id);
  assert.equal(model.memberOrNull(room, 'c'.repeat(32)), null);
  assert.throws(() => model.member(room, 'c'.repeat(32)), (e) => e.code === 'AUTH' && e.status === 401);
  model.connected(room, owner.id, true, now);
  assert.throws(() => model.action(room, owner.id, { type: 'kick', targetId: 'c'.repeat(32), matchId: 0 }, now),
    (e) => e.code === 'TARGET_GONE' && e.status === 409);
});

test('2 · a command without a usable requestId is INVALID, never a closed session', async (t) => {
  const { app, clients, profiles, code } = await lobby(t);
  const raw = await rawSocket(app, code, { id: profiles[0].id, token: profiles[0].token });
  t.after(() => raw.ws.close());
  for (const malformed of [{}, { requestId: 'x'.repeat(81) }, { requestId: 42 }]) {
    raw.inbox.length = 0;
    raw.send({ type: 'ready', ready: true, matchId: 0, round: 0, ...malformed });
    await until(() => raw.inbox.some((m) => m.type === 'error' || m.type === 'ack'), 'server answer');
    const answer = raw.inbox.find((m) => m.type === 'error' || m.type === 'ack');
    assert.equal(answer.error, 'INVALID', JSON.stringify(answer));
    assert.deepEqual(raw.closes, []);
    assert.equal(raw.ws.readyState, WebSocket.OPEN);
  }
  // An unknown type with a valid requestId keeps answering INVALID on the same socket.
  raw.inbox.length = 0;
  raw.send({ type: 'no-such-command', requestId: 'ok-1', matchId: 0, round: 0 });
  await until(() => raw.inbox.some((m) => m.type === 'ack'), 'ack for unknown type');
  assert.equal(raw.inbox.find((m) => m.type === 'ack').error, 'INVALID');
  // And the seat still works.
  raw.inbox.length = 0;
  raw.send({ type: 'ready', ready: true, requestId: 'ok-2', matchId: 0, round: 0 });
  await until(() => raw.inbox.some((m) => m.type === 'ack' && m.ok), 'accepted command');
  assert.deepEqual(raw.closes, []);
  await until(() => clients[1].state.members.find((m) => m.id === profiles[0].id).ready === true, 'ready broadcast');
});

test('3 · rejected creation attempts do not consume the ten-minute creation quota', async (t) => {
  const app = await startLocalServer({ port: 0 }); t.after(() => app.close());
  const bad = { ...newCredentials(), name: 'x'.repeat(40), avatar: 0, rounds: 5 };
  for (let attempt = 0; attempt < 12; attempt++) {
    const refused = await api(app, '/api/rooms', { ...bad, ...newCredentials() });
    assert.equal(refused.status, 400, `attempt ${attempt}: ${JSON.stringify(refused.body)}`);
    assert.equal(refused.body.error, 'NAME');
  }
  // A fabraka topic selection the server rejects must not cost a slot either.
  for (let attempt = 0; attempt < 4; attempt++) {
    const empty = await api(app, '/api/rooms', { ...newCredentials(), name: 'هدى', avatar: 0, rounds: 5, game: 'fabraka',
      settings: { mode: 'classic', rounds: 7, style: 'curious', categories: ['لا-يوجد-موضوع-بهذا-الاسم'] } });
    assert.equal(empty.status, 400, JSON.stringify(empty.body));
    assert.equal(empty.body.error, 'QUESTIONS');
  }
  const created = await api(app, '/api/rooms', { ...newCredentials(), name: 'هدى', avatar: 0, rounds: 5 });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  // Successful creations are still charged, and the refusal names the wait.
  let limited = null;
  for (let attempt = 0; attempt < 12 && !limited; attempt++) {
    const result = await api(app, '/api/rooms', { ...newCredentials(), name: `ضيف ${attempt}`, avatar: 0, rounds: 5 });
    if (result.status === 429) limited = result;
  }
  assert.ok(limited, 'successful creations must still exhaust the quota');
  assert.equal(limited.body.error, 'CREATE_LIMIT');
  assert.match(errorText('CREATE_LIMIT'), /١٠ دقائق/);
  assert.match(errorText('RATE_LIMIT'), /دقيقة/);
});

test('3+8 · exhausted room codes answer COLLISION, refund the quota and use fresh candidates', async (t) => {
  const storage = new MemoryStorage(); t.after(() => storage.dispose());
  const limiter = new RequestLimiter({ storage });
  const attempts = [];
  const env = { ALLOWED_ORIGINS: ORIGIN,
    LIMITERS: { idFromName: () => 'ip', get: () => ({ fetch: (request) => limiter.fetch(request) }) },
    // Every candidate code is already taken by somebody else.
    ROOMS: { idFromName: (name) => name, get: (code) => ({ fetch: async () => {
      attempts.push(code);
      return new Response(JSON.stringify({ error: 'COLLISION' }), { status: 409, headers: { 'content-type': 'application/json' } });
    } }) } };
  const profile = { ...newCredentials(), name: 'سارة', avatar: 0, rounds: 5 };
  const create = () => routeRequest(new Request('https://rooms.example/api/rooms', { method: 'POST',
    headers: { origin: ORIGIN, 'content-type': 'application/json' }, body: JSON.stringify(profile) }), env);
  const first = await create();
  assert.equal(first.status, 409);
  assert.equal((await first.json()).error, 'COLLISION');
  assert.equal(attempts.length, 5);
  const firstRun = attempts.splice(0, 5);
  const second = await create();
  assert.equal(second.status, 409);
  const secondRun = attempts.splice(0, 5);
  // The retried creation keeps its idempotent first candidate, but never repeats the rest.
  assert.equal(firstRun[0], secondRun[0]);
  assert.deepEqual(firstRun.slice(1).filter((code) => secondRun.includes(code)), []);
  assert.equal(new Set([...firstRun, ...secondRun]).size, 9);
  for (const code of [...firstRun, ...secondRun]) assert.match(code, /^\d{6}$/);
  // Two failed runs, nothing charged.
  assert.equal((await storage.get('create'))?.count ?? 0, 0);
  assert.equal(errorText('COLLISION'), ERRORS.COLLISION);
});

test('9 · /health answers HEAD with an empty body and no origin check', async (t) => {
  const app = await startLocalServer({ port: 0 }); t.after(() => app.close());
  const head = await fetch(`${app.url}/health`, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.match(head.headers.get('content-type'), /application\/json/);
  assert.equal(await head.text(), '');
  const get = await fetch(`${app.url}/health`);
  assert.equal(get.status, 200);
  assert.equal((await get.json()).ok, true);
  // Other methods still fall through to the regular routing rules.
  const post = await fetch(`${app.url}/health`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(post.status, 403);
});

test('10 · hosted assets carry security headers and still serve the page', { timeout: 30_000 }, async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'maydan-headers-'));
  const assetsDir = path.join(dir, 'assets');
  let mf;
  try {
    await mkdir(assetsDir);
    // A miniature of the real build: one document, inline script and styles only.
    await writeFile(path.join(assetsDir, 'index.html'),
      '<!doctype html><html lang="ar" dir="rtl"><title>ميدان</title><style>body{margin:0}</style><body>Maydan static asset<script>window.maydan=1;</script></body></html>');
    const scriptPath = path.join(dir, 'worker.mjs');
    await build({ entryPoints: ['server/full-worker.mjs'], bundle: true, format: 'esm', platform: 'browser', outfile: scriptPath, logLevel: 'silent' });
    mf = new Miniflare(convertV4MiniflareOptions({ rootPath: dir, name: 'maydan-game', modules: true, scriptPath,
      compatibilityDate: '2026-09-01', port: 0, host: '127.0.0.1', cf: false,
      durableObjects: { ROOMS: { className: 'Room', useSQLite: true }, LIMITERS: { className: 'RequestLimiter', useSQLite: true } },
      // run_worker_first must be true for the worker to see asset requests at all;
      // with a path list Cloudflare answers them from the asset server directly.
      assets: { directory: assetsDir, binding: 'ASSETS', assetConfig: { not_found_handling: 'single-page-application' }, routerConfig: { has_user_worker: true }, run_worker_first: true },
    }));
    const origin = (await mf.ready).origin;
    const home = await fetch(origin);
    assert.equal(home.status, 200);
    assert.match(await home.text(), /Maydan static asset/); // The page still loads.
    const csp = home.headers.get('content-security-policy');
    assert.ok(csp, 'assets must carry a content security policy');
    assert.match(csp, /default-src 'self'/);
    assert.match(csp, /script-src [^;]*'unsafe-inline'/); // The build inlines its script…
    assert.match(csp, /style-src [^;]*'unsafe-inline'/); // …and its styles.
    assert.match(csp, /img-src [^;]*data:[^;]*blob:/);
    assert.match(csp, /media-src [^;]*blob:/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.equal(home.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(home.headers.get('x-frame-options'), 'DENY');
    assert.equal(home.headers.get('referrer-policy'), 'same-origin');
    assert.deepEqual(securityHeaders()['content-security-policy'], csp);
    // The SPA fallback and the room API keep working next to the headers.
    const deep = await fetch(`${origin}/room/123456`);
    assert.equal(deep.status, 200);
    assert.equal(deep.headers.get('x-content-type-options'), 'nosniff');
    const health = await fetch(`${origin}/health`);
    assert.equal(health.status, 200);
    assert.equal((await health.json()).ok, true);
    const session = newCredentials();
    const created = await fetch(`${origin}/api/rooms`, { method: 'POST', headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify({ ...session, name: 'أحمد', avatar: 0, rounds: 5 }) });
    assert.equal(created.status, 201, await created.clone().text());
    const headHealth = await fetch(`${origin}/health`, { method: 'HEAD' });
    assert.equal(headHealth.status, 200);
    assert.equal(await headHealth.text(), '');
  } finally {
    if (mf) await mf.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});

test('10 · the shipped page only needs the sources the policy allows', { skip: !existsSync('dist/index.html') }, () => {
  const html = readFileSync('dist/index.html', 'utf8');
  const sources = [...html.matchAll(/<(?:script|link|img)\b[^>]*\b(?:src|href)="([^"]*)"/g)].map((m) => m[1]);
  for (const source of sources) {
    assert.equal(/^(https?:)?\/\//.test(source), false, `${source} would need a remote host in the policy`);
  }
});

test('4 · the create button is disabled, and the warning visible, when an existing topic cannot fill the rounds', (t) => {
  const topic = ui.oneFactTopic();
  t.after(topic.restore);
  const impossible = { mode: 'classic', rounds: 7, style: 'curious', categories: [topic.category] };
  ui.save(ROOMS_URL, 'fabrakaSettings', impossible);
  const blocked = ui.entry({ game: 'fabraka' });
  assert.match(submitButton(blocked), /disabled=""/); // The server would answer QUESTIONS.
  assert.match(blocked, /\u0644\u0627 \u062a\u0643\u0641\u064a/);
  // The host must see the warning without opening the topics block.
  assert.ok(blocked.indexOf('</details>') < blocked.indexOf('\u0644\u0627 \u062a\u0643\u0641\u064a'), 'warning belongs outside <details>');
  assert.match(blocked, /\u0648\u0633\u0651\u0639 \u0627\u0644\u0645\u0648\u0627\u0636\u064a\u0639 \u0627\u0644\u0645\u062e\u062a\u0627\u0631\u0629 \u0623\u0648 \u0627\u062e\u062a\u0631/);
  topic.restore();
  ui.save(ROOMS_URL, 'fabrakaSettings', { mode: 'classic', rounds: 3, style: 'all', categories: [] });
  const ready = ui.entry({ game: 'fabraka' });
  assert.doesNotMatch(submitButton(ready), /disabled=""/);
  assert.doesNotMatch(ready, /\u0644\u0627 \u062a\u0643\u0641\u064a/);
  // Meenfina rooms are never gated by fabraka topics.
  ui.save(ROOMS_URL, 'fabrakaSettings', impossible);
  assert.doesNotMatch(submitButton(ui.entry({ game: 'meenfina' })), /disabled=""/);
  // The reworded server error points at the topics, not at the round count.
  assert.match(errorText('QUESTIONS'), /\u0627\u0644\u0645\u0648\u0627\u0636\u064a\u0639/);
  assert.doesNotMatch(errorText('QUESTIONS'), /\u0642\u0644\u0651\u0644 \u0639\u062f\u062f \u0627\u0644\u062c\u0648\u0644\u0627\u062a/);
});

test('retired saved topic names are migrated before creating a new Fabraka room', () => {
  ui.save(ROOMS_URL, 'fabrakaSettings', { mode: 'classic', rounds: 7, categories: ['RETIRED_TOPIC'] });
  const ready = ui.entry({ game: 'fabraka' });
  assert.doesNotMatch(submitButton(ready), /disabled=""/);
  assert.doesNotMatch(ready, /لا تكفي|RETIRED_TOPIC/);
});

test('5+6 · the waiting room prints Arabic-Indic digits and no zero-second discussion', () => {
  globalThis.location ??= { href: 'https://game.example/#/room/123456' };
  const state = (settings) => ({ code: '123456', game: 'fabraka', rounds: 5, hostId: 'h', members: [], settings });
  const props = { me: { id: 'h', ready: false }, isHost: true, disabled: false, act: () => {} };
  const silent = ui.lobby({ ...props, state: state({ mode: 'classic', writeSeconds: 0, discussionSeconds: 0 }) });
  assert.match(silent, /\u0628\u062f\u0648\u0646 \u0646\u0642\u0627\u0634/);
  assert.doesNotMatch(silent, /\u0660 \u062b\u0627\u0646\u064a\u0629 \u0644\u0644\u0646\u0642\u0627\u0634/);
  const talking = ui.lobby({ ...props, state: state({ mode: 'classic', writeSeconds: 45, discussionSeconds: 20 }) });
  assert.match(talking, /\u0664\u0665 \u062b\u0627\u0646\u064a\u0629 \u0644\u0644\u0643\u062a\u0627\u0628\u0629/);
  assert.match(talking, /\u0662\u0660 \u062b\u0627\u0646\u064a\u0629 \u0644\u0644\u0646\u0642\u0627\u0634/);
  // Generated counts next to the hand-written Arabic ones, in the same digits.
  assert.match(talking, /\u0660 \/ \u0668/); // ٠ / ٨ players
  assert.match(talking, /\u0665 \u062c\u0648\u0644\u0627\u062a/);
  // The room code itself stays Latin (it is typed and read out); nothing else may be.
  assert.doesNotMatch(talking.replace(/<[^>]*>/g, ' ').replaceAll('123456', ''), /[0-9]/);
});

test('5 · generated numbers use Arabic-Indic digits everywhere', () => {
  assert.equal(arabicNumber(3), '٣');
  assert.equal(arabicNumber(12), '١٢');
  assert.equal(arabicNumber(0), '٠');
  assert.equal(arabicNumber(30), '٣٠');
  for (let n = 0; n <= 120; n++) assert.doesNotMatch(arabicNumber(n), /[0-9]/, `${n} rendered Latin digits`);
  assert.equal(arabicNumber('غير رقم'), '');
});

test('7 · a protocol mismatch ends the session instead of offering a retry', () => {
  const events = [];
  class FakeSocket {
    constructor() { this.readyState = 1; FakeSocket.last = this; }
    send() {}
    close() { this.readyState = 3; }
  }
  const client = new RoomClient({ server: 'https://rooms.example', code: '123456', session: newCredentials(),
    WebSocketImpl: FakeSocket, onError: (code) => events.push(code) });
  client.start();
  FakeSocket.last.onopen();
  FakeSocket.last.onmessage({ data: JSON.stringify({ type: 'state', state: { protocol: 99, game: 'meenfina', revision: 1, serverNow: Date.now() } }) });
  assert.deepEqual(events, ['CONFIG']);
  assert.equal(client.connectionStatus, 'ended'); // 'disconnected' would render a retry button that can never work.
  assert.equal(client.stopped, true);
  assert.match(errorText('CONFIG'), /حدّث صفحة اللعبة/);
});

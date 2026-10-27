// A whole Mafia match in the real app against the real room server: one player in
// Chromium joins a public room from the directory and plays every phase through
// the actual UI while five socket players fill the table. The voice provider is
// unreachable here (LiveKit is mocked on the server and its socket is refused in
// the browser), so this also proves the match stays playable over text.
// node --test tests/e2e/mafia-match.mjs   (CHROMIUM_PATH optional)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { WebSocket } from 'ws';
import { startLocalServer } from '../../server/local.mjs';
import { createUser } from '../../server/accounts/db.mjs';
import { issueSession } from '../../server/accounts/session.mjs';
import { tick } from '../../server/mafia-model.mjs';
import { esbuildOptions, renderHtml, readPkg, mediaVersions } from '../../scripts/lib.mjs';
import { RoomClient, newCredentials } from '../../src/online/client.js';
import { environmentStorageKey } from '../../src/shared/lib/environment.js';
import { MAFIA_PHASES, MAFIA_ROLES } from '../../src/online/mafia-shared.js';
import { LIVEKIT_MODULE } from '../../src/social/media-version.js';

let web, app, browser, webOrigin, html, livekit, restoreFetch;
const clients = [];
before(async () => {
  web = http.createServer((req, res) => {
    const { pathname } = new URL(req.url, 'http://localhost');
    if (pathname === '/') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(html); return; }
    if (pathname === `/${LIVEKIT_MODULE}`) { res.writeHead(200, { 'content-type': 'text/javascript' }); res.end(livekit); return; }
    res.writeHead(404); res.end();
  });
  await new Promise((resolve) => web.listen(0, '127.0.0.1', resolve));
  webOrigin = `http://127.0.0.1:${web.address().port}`;
  app = await startLocalServer({ port: 0, origins: webOrigin, vars: { MAFIA_ENABLED: '1', LIVEKIT_URL: 'wss://mafia-tests.livekit.cloud', LIVEKIT_API_KEY: 'fixture-key', LIVEKIT_API_SECRET: 'fixture-secret' } });
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = (url, options) => String(url).includes('mafia-tests.livekit.cloud') ? Promise.resolve(Response.json({})) : nativeFetch(url, options);
  restoreFetch = () => { globalThis.fetch = nativeFetch; };
  process.env.MAYDAN_ROOMS_URL = app.url;
  const pkg = await readPkg();
  const result = await build(esbuildOptions({ minify: false, version: pkg.version, media: await mediaVersions() }));
  html = await renderHtml(result.outputFiles.find((file) => file.path.endsWith('.js')).text, { version: pkg.version });
  // The same optional calling module the build writes to dist (scripts/lib.mjs).
  livekit = (await build({ stdin: { contents: "export { Room, RoomEvent, Track } from 'livekit-client';", resolveDir: process.cwd(), sourcefile: 'lamma-web-audio.js' }, bundle: true, format: 'esm', write: false })).outputFiles[0].text;
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
});
after(async () => {
  for (const client of clients) client.stop();
  await browser?.close();
  await app?.close();
  restoreFetch?.();
  if (web?.listening) await new Promise((resolve) => web.close(resolve));
});

class OriginSocket extends WebSocket { constructor(url) { super(url, { origin: webOrigin }); } }
const until = async (predicate, label, timeout = 15_000) => {
  const started = Date.now();
  while (!(await predicate())) { if (Date.now() - started > timeout) throw new Error(`Timed out: ${label}`); await new Promise((resolve) => setTimeout(resolve, 50)); }
};
const api = async (person, path, body) => {
  const response = await fetch(`${app.url}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: webOrigin, authorization: `Bearer ${person.authorization}` }, body: JSON.stringify(body) });
  const data = await response.json();
  assert.ok(response.ok, `${path}: ${JSON.stringify(data)}`);
  return data;
};
async function person(n) {
  const user = await createUser(app.env, { name: `لاعب ${n}`, email: `${crypto.randomUUID()}@example.test` }), session = await issueSession(app.env, user.id);
  return { ...newCredentials(), accountId: user.id, authorization: session.token, name: ['ليان', 'عمر', 'سارة', 'وسام', 'هند', 'يوسف'][n], avatar: n % 4, game: 'mafia', capabilities: { mafia: 1 } };
}

test('one browser player plays a whole public Mafia match through the real UI', { timeout: 240_000 }, async () => {
  const people = []; for (let n = 0; n < 6; n++) people.push(await person(n));
  const [host] = people, player = people[5];
  const { code } = await api(host, '/api/rooms', { ...host, settings: { mode: 'classic', capacity: 6, visibility: 'public' } });
  for (const p of people.slice(1, 5)) await api(p, `/api/rooms/${code}/join`, p);
  const bots = people.slice(0, 5).map((p) => {
    const client = new RoomClient({ server: app.url, code, session: { id: p.id, token: p.token }, getAccountAuthorization: () => `Bearer ${p.authorization}`, WebSocketImpl: OriginSocket });
    clients.push(client); client.start(); return client;
  });
  await until(() => bots.every((c) => c.state?.members.filter((m) => m.connected).length === 5), 'bots connected');
  for (const c of bots.slice(1)) await c.command('ready', { ready: true });
  const room = () => app.rooms.get(code).instance.room;
  // Ends the phase as its alarm would, then holds the next one so only the test
  // advances phases while the browser is being driven.
  const endPhase = async ({ end = true } = {}) => {
    const item = app.rooms.get(code);
    await item.instance.serial(async () => {
      const r = structuredClone(item.instance.room);
      if (end) { r.deadlineAt = Date.now() - 1; tick(r, Date.now()); }
      if (r.deadlineAt) r.deadlineAt = Date.now() + 600_000;
      await item.instance.commit(r);
    });
  };

  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ar', reducedMotion: 'reduce' });
  await context.addInitScript(([key, value]) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage blocked */ } },
    [environmentStorageKey('maydan:account:', app.url) + 'session', player.authorization]);
  const page = await context.newPage();
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  // The provider cannot be reached from this machine: refuse its socket at once.
  await page.routeWebSocket(/livekit\.cloud/, (ws) => ws.close({ code: 1011, reason: 'provider unreachable in this test' }));
  await page.goto(`${webOrigin}/#/online/mafia`);
  await page.waitForFunction(() => {
    const button = [...document.querySelectorAll('.splash button')].find((b) => !b.disabled && b.textContent.includes('الدخول بالصور المتاحة'));
    if (button) button.click();
    return !document.querySelector('.splash') && document.querySelector('[data-design-screen]');
  }, null, { timeout: 30_000 });

  // The public directory lists the waiting room; its card seats the player.
  const card = page.locator(`[data-room-code="${code}"]`);
  await card.waitFor({ timeout: 20_000 });
  await card.getByRole('button', { name: 'انضم' }).click();
  await page.getByRole('button', { name: 'أنا جاهز' }).waitFor({ timeout: 15_000 });
  await page.getByRole('button', { name: 'أنا جاهز' }).click();
  await until(() => room().members.every((m) => m.connected && m.ready), 'everyone ready');
  await bots[0].command('start');
  await endPhase({ end: false });
  const title = page.locator('[data-design-id="phase-title"]');
  const showing = async (phase) => { await until(async () => (await title.textContent().catch(() => '')) === MAFIA_PHASES[phase], `browser shows ${phase}`); };
  await showing('role');
  // The app chose its own seat when it joined from the directory; find it by account.
  const seatId = room().members.find((m) => !m.left && m.accountUserId === player.accountId).id;
  const mine = () => room().roleStates[seatId];
  await page.getByRole('button', { name: /اكشف بطاقتي/ }).click();
  await page.getByRole('dialog').getByText(MAFIA_ROLES[mine().roleId].name, { exact: true }).waitFor();
  await page.getByRole('dialog').getByRole('button', { name: 'إخفاء البطاقة' }).first().click();
  await endPhase();

  await showing('opening');
  // Voice: the server grants a public seat; the unreachable provider must not break the match.
  await page.locator('[data-design-id="voice-join"]').click();
  await until(() => Boolean(room().mafiaMedia?.devices?.[player.accountId]), 'the browser asked for its voice seat');
  await page.locator('[data-design-id="message-input"]').fill('مساء الخير يا مجلس');
  await page.locator('[data-design-id="send"]').click();
  await until(() => bots[1].state.chats.public.some((m) => m.text === 'مساء الخير يا مجلس'), 'a bot reads the browser message');

  const phasesSeen = new Set();
  for (let step = 0; step < 60 && room().phase !== 'over'; step++) {
    await endPhase();
    const r = room(); if (r.phase === 'over') break;
    phasesSeen.add(r.phase);
    await showing(r.phase);
    const alive = r.participants.filter((id) => r.roleStates[id].alive);
    const me = mine();
    const botOf = (id) => bots[people.findIndex((p) => p.id === id)];
    if (r.phase === 'night') {
      const target = alive.find((id) => r.roleStates[id].faction !== 'mafia' && id !== seatId) || alive.find((id) => r.roleStates[id].faction !== 'mafia');
      for (const id of alive.filter((id) => id !== seatId && r.roleStates[id].faction === 'mafia')) await botOf(id).command('mafia_vote', { targetId: target });
      if (me.alive) {
        if (me.faction === 'mafia') {
          await page.locator('[data-design-id="mafia-vote"]').first().click();
          await until(() => room().killVotes[seatId] !== undefined, 'the browser Mafia vote reached the server');
        } else if (await page.locator('[data-design-id="ability-submit"]').count()) {
          await page.locator('[data-design-id="target"]').first().click();
          if (mine().roleId === 'analyst') await page.locator('[data-design-id="target"]').nth(1).click();
          await page.locator('[data-design-id="ability-submit"]').click();
          await until(() => Boolean(room().nightActions[seatId]), 'the browser night ability reached the server');
        } else await page.getByText('لا إجراء متاح لك الآن').waitFor();
      }
    }
    if (r.phase === 'nomination') {
      const suspect = alive.find((id) => id !== seatId && r.roleStates[id].faction === 'mafia') || alive.find((id) => id !== seatId);
      for (const id of alive.filter((id) => id !== seatId)) await botOf(id).command('nominate', { targetId: suspect });
      if (me.alive) {
        // Text stays open for the living during nomination.
        await page.locator('[data-design-id="message-input"]').waitFor();
        await page.locator('[data-design-id="target"]').first().click();
        await page.locator('[data-design-id="ability-submit"]').click();
        await page.getByRole('button', { name: 'اعتمد اختياري' }).click();
        await until(() => Object.hasOwn(room().nominationVotes, seatId), 'the browser nomination reached the server');
      }
    }
    if (r.phase === 'verdict') {
      for (const id of alive.filter((id) => id !== seatId)) await botOf(id).command('verdict', { approve: true });
      if (me.alive) {
        await page.locator('[data-design-id="verdict-yes"]').click();
        await page.getByRole('button', { name: 'اعتمد اختياري' }).click();
        await until(() => Object.hasOwn(room().verdictVotes, seatId), 'the browser verdict reached the server');
      }
    }
    if (r.phase === 'night' && !me.alive) await page.getByText('أنت الآن تتابع المجلس').waitFor();
    if (process.env.E2E_SHOTS && !phasesSeen.has(`shot:${r.phase}`)) { phasesSeen.add(`shot:${r.phase}`); await page.screenshot({ path: `${process.env.E2E_SHOTS}/mafia-${r.phase}.png`, fullPage: true }); }
  }
  assert.equal(room().phase, 'over');
  for (const phase of ['night', 'dawn', 'discussion', 'nomination']) assert.ok(phasesSeen.has(phase), `the match passed through ${phase}`);
  await page.locator('[data-design-id="results"]').waitFor({ timeout: 15_000 });
  assert.equal(await page.locator('[data-design-id="recap"] article').count(), 6, 'the recap reveals all six roles');
  if (process.env.E2E_SHOTS) await page.screenshot({ path: `${process.env.E2E_SHOTS}/mafia-over.png`, fullPage: true });
  await bots[0].command('restart');
  await page.getByText('غرفة الانتظار').waitFor({ timeout: 15_000 });
  assert.deepEqual(errors, []);
  await context.close();
});

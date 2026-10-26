// A room server deployed with a newer protocol while a match is running. The open
// page must keep its seat, offer the update, and after reloading reconnect to the
// same room, match and seat instead of being dropped with its seat cleared.
// node --test tests/e2e/room-update.mjs   (CHROMIUM_PATH optional)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { WebSocket } from 'ws';
import { startLocalServer } from '../../server/local.mjs';
import { esbuildOptions, renderHtml, readPkg, mediaVersions } from '../../scripts/lib.mjs';
import { RoomClient, newCredentials } from '../../src/online/client.js';
import { ROOM_CAPABILITIES } from '../../src/online/shared.js';

let web, app, browser, webOrigin, html;
const guests = [];
before(async () => {
  web = http.createServer((req, res) => {
    if (new URL(req.url, 'http://localhost').pathname === '/') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(html); return; }
    res.writeHead(404); res.end();
  });
  await new Promise((resolve) => web.listen(0, '127.0.0.1', resolve));
  webOrigin = `http://127.0.0.1:${web.address().port}`;
  app = await startLocalServer({ port: 0, origins: webOrigin, vars: {} });
  process.env.MAYDAN_ROOMS_URL = app.url;
  const pkg = await readPkg();
  const result = await build(esbuildOptions({ minify: false, version: pkg.version, media: await mediaVersions() }));
  html = await renderHtml(result.outputFiles.find((file) => file.path.endsWith('.js')).text, { version: pkg.version });
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
});
after(async () => {
  for (const guest of guests) guest.stop();
  await browser?.close();
  await app?.close();
  if (web?.listening) await new Promise((resolve) => web.close(resolve));
});

const api = async (path, body) => {
  const response = await fetch(`${app.url}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: webOrigin }, body: JSON.stringify(body) });
  const data = await response.json();
  assert.ok(response.ok, `${path}: ${JSON.stringify(data)}`);
  return data;
};
class OriginSocket extends WebSocket { constructor(url) { super(url, { origin: webOrigin }); } }
const until = async (predicate, label, timeout = 10_000) => {
  const started = Date.now();
  while (!(await predicate())) { if (Date.now() - started > timeout) throw new Error(`Timed out: ${label}`); await new Promise((resolve) => setTimeout(resolve, 50)); }
};

test('an updated room server keeps the seat and the reloaded page rejoins the same match', { timeout: 90_000 }, async () => {
  const host = newCredentials();
  const { code } = await api('/api/rooms', { ...host, name: 'المضيف', avatar: 0, rounds: 5, game: 'meenfina', deviceId: 'c'.repeat(32), capabilities: ROOM_CAPABILITIES });
  for (const [index, name] of ['ليان', 'عمر'].entries()) {
    const session = newCredentials();
    await api(`/api/rooms/${code}/join`, { ...session, name, avatar: index + 1, capabilities: ROOM_CAPABILITIES });
    const client = new RoomClient({ server: app.url, code, session, WebSocketImpl: OriginSocket });
    guests.push(client); client.start();
    await until(() => client.connectionStatus === 'connected', `${name} connected`);
    await client.command('ready', { ready: true });
  }

  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ar', reducedMotion: 'reduce' });
  const page = await context.newPage();
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  // Rewrites the server's protocol number on the way to the page while `newer` is set:
  // exactly what an old open page sees after a deploy that bumped the room protocol.
  let newer = false;
  await page.routeWebSocket(/\/api\/rooms\/\d{6}\/socket$/, (socket) => {
    const server = socket.connectToServer();
    server.onMessage((message) => {
      if (!newer || typeof message !== 'string' || !message.startsWith('{')) { socket.send(message); return; }
      const value = JSON.parse(message);
      if (value.type === 'state') value.state.protocol += 1;
      socket.send(JSON.stringify(value));
    });
  });
  await page.addInitScript(({ server, code, host }) => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem(`maydan:online:${server}:${code}`, JSON.stringify(host));
    localStorage.setItem(`maydan:online:${server}:persistence`, 'true');
  }, { server: app.url, code, host });
  await page.goto(`${webOrigin}/#/room/${code}`);
  const enter = () => page.waitForFunction(() => {
    const button = [...document.querySelectorAll('.splash button')].find((b) => !b.disabled && b.textContent.includes('الدخول بالصور المتاحة'));
    if (button) button.click();
    return !document.querySelector('.splash') && document.querySelector('[data-design-screen]');
  }, null, { timeout: 20_000 });
  await enter();
  // Quick reactions both ways while waiting in the lobby.
  const heard = []; const unsubscribe = guests[0].subscribeReactions((event) => heard.push(event));
  await page.getByRole('button', { name: 'أرسل 😂' }).click();
  await until(() => heard.some((event) => event.emoji === '😂' && event.seatId === host.id), 'the page reaction reached a guest');
  unsubscribe();
  await guests[0].react('👏');
  await page.locator('.room-reaction-float', { hasText: 'ليان' }).waitFor({ timeout: 5_000 });
  if (process.env.E2E_SHOTS) await page.screenshot({ path: `${process.env.E2E_SHOTS}/room-reactions.png` });
  await page.getByRole('button', { name: 'ابدأ اللعب' }).click();
  await until(() => guests[0].state?.phase === 'vote', 'match started');
  const matchId = guests[0].state.matchId;

  newer = true;
  await guests[0].command('vote', { targetId: host.id }); // any broadcast reaches the page
  const update = page.getByRole('button', { name: 'حدّث وتابع في الغرفة' });
  await update.waitFor({ timeout: 10_000 });
  assert.match(await page.locator('.online-notice.error').textContent(), /مقعدك محفوظ/);
  assert.equal(await page.locator('.online-connection').textContent(), 'نسخة اللعبة أقدم من الغرفة');
  const seat = await page.evaluate(({ server, code }) => JSON.parse(localStorage.getItem(`maydan:online:${server}:${code}`)), { server: app.url, code });
  assert.equal(seat?.id, host.id, 'the stored seat survives the mismatch');

  newer = false; // the reloaded page is the version that matches the server
  await Promise.all([page.waitForEvent('load'), update.click()]);
  await enter();
  await until(async () => (await page.locator('.online-connection').textContent().catch(() => '')) === 'متصل · كل واحد بجواله', 'reconnected after reload', 20_000);
  const room = guests[0].state;
  assert.equal(room.matchId, matchId, 'still the same match');
  assert.notEqual(room.phase, 'lobby');
  assert.equal(room.members.find((m) => m.id === host.id)?.connected, true, 'the host seat is connected again');
  assert.equal(room.members.filter((m) => !m.left).length, 3, 'no second seat was created');
  assert.deepEqual(errors, []);
  await context.close();
});

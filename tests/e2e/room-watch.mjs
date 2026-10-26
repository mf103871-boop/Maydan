// Late join: a phone opening the invite after the start enters the running match as a
// watcher, sees the round without voting controls, and plays the next match.
// node --test tests/e2e/room-watch.mjs   (CHROMIUM_PATH optional)
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
const clients = [];
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
  for (const client of clients) client.stop();
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

test('a late phone watches the running match and joins the next one', { timeout: 90_000 }, async () => {
  const seats = [newCredentials(), newCredentials(), newCredentials()];
  const { code } = await api('/api/rooms', { ...seats[0], name: 'المضيف', avatar: 0, rounds: 5, game: 'meenfina', deviceId: 'd'.repeat(32), capabilities: ROOM_CAPABILITIES });
  for (const [index, seat] of seats.slice(1).entries()) await api(`/api/rooms/${code}/join`, { ...seat, name: ['ليان', 'عمر'][index], avatar: index + 1, capabilities: ROOM_CAPABILITIES });
  for (const seat of seats) { const client = new RoomClient({ server: app.url, code, session: seat, WebSocketImpl: OriginSocket }); clients.push(client); client.start(); }
  await until(() => clients.every((c) => c.connectionStatus === 'connected'), 'players connected');
  await Promise.all(clients.slice(1).map((c) => c.command('ready', { ready: true })));
  const [host] = clients;

  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ar', reducedMotion: 'reduce' });
  const page = await context.newPage();
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${webOrigin}/#/room/${code}`);
  await page.waitForFunction(() => {
    const button = [...document.querySelectorAll('.splash button')].find((b) => !b.disabled && b.textContent.includes('الدخول بالصور المتاحة'));
    if (button) button.click();
    return !document.querySelector('.splash') && document.querySelector('[data-design-screen]');
  }, null, { timeout: 20_000 });
  await page.locator('[data-design-id="name-input"]').fill('سارة');
  // Start only now: a voting round lasts thirty seconds, and the watcher's view of it
  // must not depend on how long the page took to open.
  await host.command('start');
  await until(() => host.state?.phase === 'vote', 'match started');
  await page.getByRole('button', { name: 'ادخل الغرفة' }).click();
  await page.getByText('انضممت بعد بداية المباراة').waitFor({ timeout: 10_000 });
  await page.getByText('تتفرج على هذه الجولة').waitFor();
  assert.equal(await page.getByRole('button', { name: 'تأكيد التصويت' }).count(), 0, 'no voting controls for a watcher');
  await until(() => host.state.members.some((m) => m.name === 'سارة' && m.connected), 'the players see the watcher');
  const watcherId = host.state.members.find((m) => m.name === 'سارة').id;
  assert.equal(host.state.participants.includes(watcherId), false);
  await page.getByText(/يتفرجون الآن.*سارة/).waitFor();
  if (process.env.E2E_SHOTS) await page.screenshot({ path: `${process.env.E2E_SHOTS}/room-watcher.png`, fullPage: true });

  for (let round = 1; round <= 5; round++) {
    await until(() => clients.every((c) => c.state.round === round && ['vote', 'result'].includes(c.state.phase)), `round ${round}`);
    // A slow runner may reach a round after its own timer revealed it.
    if (host.state.phase === 'vote') await Promise.all(clients.map((c) => c.command('vote', { targetId: seats[1].id }).catch((error) => { if (!['STALE', 'PHASE'].includes(error.code)) throw error; })));
    await until(() => clients.every((c) => c.state.phase === 'result'), `result ${round}`);
    await host.command('next');
  }
  await until(() => host.state.phase === 'over', 'match over');
  await host.command('restart');
  await until(() => clients.every((c) => c.state.phase === 'lobby'), 'back in the lobby');
  await Promise.all(clients.slice(1).map((c) => c.command('ready', { ready: true })));
  await page.getByRole('button', { name: 'أنا جاهز' }).click();
  await until(() => host.state.members.find((m) => m.id === watcherId)?.ready, 'the watcher is ready in the next lobby');
  await host.command('start');
  await until(() => host.state.participants.includes(watcherId), 'the watcher plays the next match');
  await page.getByRole('button', { name: 'تأكيد التصويت' }).waitFor({ timeout: 10_000 });
  assert.equal(await page.getByText('انضممت بعد بداية المباراة').count(), 0);
  assert.deepEqual(errors, []);
  await context.close();
});

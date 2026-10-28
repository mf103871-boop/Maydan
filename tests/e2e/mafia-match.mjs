// A whole Mafia match in the real app against the real room server: one player in
// Chromium joins a public room from the directory and plays every phase through
// the actual UI while five socket players fill the table. The voice provider is
// unreachable here (LiveKit is mocked on the server and its socket is refused in
// the browser), so this also proves the match stays playable over text.
// node --test tests/e2e/mafia-match.mjs   (CHROMIUM_PATH optional)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdir,writeFile} from 'node:fs/promises';
import { build } from 'esbuild';
import { chromium, webkit } from 'playwright';
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
  const engine = process.env.MAFIA_E2E_ENGINE === 'webkit' ? webkit : chromium;
  browser = await engine.launch(engine === chromium && process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
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
  return { ...newCredentials(), accountId: user.id, authorization: session.token, name: ['ليان', 'عمر', 'سارة', 'وسام', 'هند', 'يوسف'][n], avatar: n % 4, game: 'mafia', capabilities: { mafia: 2 } };
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
  await context.addInitScript(()=>{const trace=window.__mafiaUITrace={events:[],commands:[]};for(const type of ['pointerdown','pointerup','click','focusin','focusout','submit'])document.addEventListener(type,event=>{const target=event.target;const id=target?.closest?.('[data-design-id]')?.getAttribute('data-design-id');if(['message-input','send','composer'].includes(id))trace.events.push({type,id,active:document.activeElement?.getAttribute('data-design-id'),prevented:event.defaultPrevented,inputLength:document.querySelector('[data-design-id="message-input"]')?.value.length});},true);const Native=window.WebSocket;window.WebSocket=class extends Native{send(data){try{const body=JSON.parse(data);if(body.requestId)trace.commands.push({type:body.type,requestId:body.requestId});}catch{}return super.send(data);}};});
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
  try{await until(() => bots[1].state.chats.public.some((m) => m.text === 'مساء الخير يا مجلس'), 'a bot reads the browser message');}catch(error){await mkdir('.cache/mafia-whole-match',{recursive:true});await page.screenshot({path:'.cache/mafia-whole-match/send-failure.png'});await writeFile('.cache/mafia-whole-match/send-failure.json',JSON.stringify({server:{phase:room().phase,chatCount:room().chats?.public?.length,phaseId:room().phaseId},ui:await page.evaluate(()=>({trace:window.__mafiaUITrace,phase:document.querySelector('[data-design-id="phase-title"]')?.textContent,input:document.querySelector('[data-design-id="message-input"]')?.value,sendDisabled:document.querySelector('[data-design-id="send"]')?.disabled,alerts:[...document.querySelectorAll('[role="alert"]')].map(e=>e.textContent),active:document.activeElement?.outerHTML?.slice(0,300)}))},null,2));throw error;}

  const sendTrace=await page.evaluate(()=>window.__mafiaUITrace);
  assert.equal(sendTrace.commands.filter(command=>command.type==='chat').length,1,'one click emits one real chat command');
  assert.ok(sendTrace.events.some(event=>event.type==='submit'&&event.id==='composer'),'the real form submission ran after the pointer click');
  await until(async()=>await page.locator('[data-design-id="message-input"]').inputValue()==='', 'successful acknowledgement clears the draft');
  await mkdir('.cache/mafia-whole-match',{recursive:true});await page.screenshot({path:'.cache/mafia-whole-match/send-success.png'});
  await writeFile('.cache/mafia-whole-match/send-success.json',JSON.stringify({phase:room().phase,chatCount:room().chats.public.length,trace:sendTrace,actualServer:true,providerUnavailable:true},null,2));
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
          await page.locator('[data-design-id="player-seat"].is-target').first().click();
          await page.locator('[data-design-id="mafia-vote"]').first().click();
          await until(() => room().killVotes[seatId] !== undefined, 'the browser Mafia vote reached the server');
        } else if (await page.locator('[data-design-id="ability-submit"]').count()) {
          await page.locator('[data-design-id="player-seat"].is-target').first().click();
          if (mine().roleId === 'analyst') await page.locator('[data-design-id="player-seat"].is-target').nth(1).click();
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
        await page.locator('[data-design-id="player-seat"].is-target').first().click();
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
  await page.locator('[data-design-screen="online.mafia.lobby"]').waitFor({ timeout: 15_000 });
  assert.deepEqual(errors, []);
  await context.close();
});

test('real host lobby controls remain hit-testable with the startup notice in both orientations', { timeout: 180_000 }, async () => {
  const people = []; for (let n = 0; n < 12; n++) people.push({ ...await person(n % 6), name: `لاعب العرض ${n + 1}` });
  const [host] = people;
  const { code } = await api(host, '/api/rooms', { ...host, settings: { mode: 'shadow', capacity: 12, visibility: 'public', voiceMode: 'off', roomName: 'فحص عناصر المجلس' } });
  const bots = [];
  for (const p of people.slice(1)) {
    await api(p, `/api/rooms/${code}/join`, p);
    const client = new RoomClient({ server: app.url, code, session: { id: p.id, token: p.token }, getAccountAuthorization: () => `Bearer ${p.authorization}`, WebSocketImpl: OriginSocket });
    bots.push(client); clients.push(client); client.start();
  }
  await until(() => bots.every(client => client.state?.members.filter(member => member.connected).length === 11), 'layout bots connected');
  for (const client of bots) await client.command('ready', { ready: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ar', reducedMotion: 'reduce' });
  await context.addInitScript(({ key, token, server, code, seat, owner }) => {
    localStorage.setItem(key, JSON.stringify(token));
    localStorage.setItem(`maydan:online:${server}:${code}`, JSON.stringify(seat));
    localStorage.setItem(`maydan:online:${server}:roomOwner:${code}`, JSON.stringify(owner));
  }, { key: environmentStorageKey('maydan:account:', app.url) + 'session', token: host.authorization, server: app.url, code, seat: { id: host.id, token: host.token }, owner: host.accountId });
  const page = await context.newPage(), errors = [], checks = [];
  page.on('pageerror', error => errors.push(error.message));
  const output = `.cache/mafia-layout-${process.env.MAFIA_E2E_ENGINE === 'webkit' ? 'webkit' : 'chromium'}`;
  await mkdir(output, { recursive: true });
  const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  async function controls(notice, width, height) {
    await page.locator('[data-design-id="player-rail"]').evaluate(rail => { rail.scrollTop = 0; });
    await settle();
    const values = await page.evaluate(() => {
      const result = { width: innerWidth, height: innerHeight, overflow: document.documentElement.scrollWidth > innerWidth + 1, notice: document.documentElement.hasAttribute('data-startup-background-visible'), floatingLauncherVisible: [...document.querySelectorAll('.lamma-launcher')].some(element => getComputedStyle(element).display !== 'none'), controls: [] };
      for (const id of ['message-input', 'send', 'ready', 'start', 'exit']) {
        const element = document.querySelector(`[data-design-id="${id}"]`), rect = element.getBoundingClientRect();
        const points = [[.5,.5],[.25,.25],[.75,.75]].map(([x,y]) => { const hit = document.elementFromPoint(rect.x + rect.width*x, rect.y + rect.height*y); return hit === element || element.contains(hit) || element.disabled && getComputedStyle(element).pointerEvents === 'none' && hit === element.parentElement; });
        result.controls.push({ id, x: rect.x, y: rect.y, width: rect.width, height: rect.height, bottom: rect.bottom, disabled: !!element.disabled, hit: points.every(Boolean), hits: points });
      }
      return result;
    });
    await page.screenshot({ path: `${output}/${notice}-${width}x${height}.png` }); checks.push({ notice, width, height, ...values });
    assert.equal(values.floatingLauncherVisible, false, 'Mafia hides only the redundant global launcher');
    assert.equal(values.overflow, false, `${notice} ${width}: horizontal overflow`);
    for (const control of values.controls) {
      assert.ok(control.width >= 44 && control.height >= 44, `${notice} ${width}: touch target ${JSON.stringify(control)}`);
      assert.ok(control.y >= 0 && control.bottom <= height + 1 && control.hit, `${notice} ${width}: obscured control ${JSON.stringify(control)}`);
    }
    assert.equal(values.controls.find(control => control.id === 'start').disabled, false, 'the real ready host can start');
    assert.equal(await page.locator('[data-design-id="player-seat"]').count(), 12);
    const lastCard = await page.locator('[data-design-id="player-seat"]').last().evaluate(card => {
      const rail = card.closest('.mafia-player-rail'), grid = card.closest('.mafia-seats');
      rail.scrollTop = rail.scrollHeight; grid.scrollTop = grid.scrollHeight;
      const rect = card.getBoundingClientRect(), hit = document.elementFromPoint(rect.x + rect.width/2, rect.y + rect.height/2);
      const result = { hit: hit === card || card.contains(hit), top: rect.top, bottom: rect.bottom };
      rail.scrollTop = 0; grid.scrollTop = 0; return result;
    });
    assert.ok(lastCard.hit && lastCard.top >= 0 && lastCard.bottom <= height + 1, `${notice} ${width}: twelfth player is unreachable ${JSON.stringify(lastCard)}`);
  }
  try {
    await page.goto(`${webOrigin}/#/room/${code}`);
    await page.waitForFunction(() => { const button = [...document.querySelectorAll('.splash button')].find(node => !node.disabled && node.textContent.includes('الدخول بالصور المتاحة')); button?.click(); return !document.querySelector('.splash') && document.querySelector('[data-design-screen="online.mafia.lobby"]'); }, null, { timeout: 30000 });
    await until(() => bots.every(client => client.state?.members.every(member => member.connected && member.ready)), 'layout host and bots ready');
    await page.waitForFunction(() => document.documentElement.hasAttribute('data-startup-background-visible'));
    for (const [width, height] of [[320,568],[390,844],[430,932],[844,390]]) { await page.setViewportSize({ width, height }); await page.evaluate(() => document.activeElement?.blur()); await controls('notice-visible', width, height); }
    await page.setViewportSize({ width: 390, height: 490 }); await page.locator('[data-design-id="message-input"]').fill('مسودة لا تُرسل');
    await page.waitForFunction(() => !document.documentElement.hasAttribute('data-startup-background-visible')); await controls('keyboard-focused',390,490);
    await page.locator('[data-design-id="message-input"]').fill(''); await page.evaluate(() => document.activeElement?.blur());
    await page.waitForFunction(() => document.documentElement.hasAttribute('data-startup-background-visible')); await page.getByRole('button', { name: 'إخفاء حالة الصور', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('.startup-background'));
    for (const [width, height] of [[320,568],[390,844],[430,932],[844,390]]) { await page.setViewportSize({ width, height }); await controls('notice-closed', width, height); }
    assert.deepEqual(errors, []);
  } finally {
    await writeFile(`${output}/results.json`, JSON.stringify({ checks, errors, realApp: true, realLocalRoom: true, realSplash: true, physicalIPhone: false }, null, 2));
    await context.close();
  }
});

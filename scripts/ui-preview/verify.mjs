// Runs only against the separately started, loopback-only review server.
// Uses the full product shell, real local HTTP/WS, and clearly labelled fixtures.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, webkit } from 'playwright';

const base = process.env.UI_REVIEW_ORIGIN || 'http://127.0.0.1:4178';
const target = new URL(base);
assert.ok(target.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(target.hostname), 'Review verification accepts only local servers');
const proof = path.resolve('docs/ui-rebuild-20261030/screenshots');
await mkdir(proof, { recursive: true });
async function post(route, body = {}) {
  const response = await fetch(base + route, { method: 'POST', headers: { origin: base, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json(); assert.equal(response.status, 200, `Local ${route}`); return data;
}
const rooms = (await post('/__preview__/seed')).rooms;
const auth = await post('/__preview__/login', { index: 0 });
const network = [];
for (const game of ['mafia', 'badeeha', 'ersomha', 'fabraka', 'meenfina']) {
  const route = game === 'mafia' ? '/api/rooms/public' : '/api/online/rooms/public?game=' + game;
  const response = await fetch(base + route, { headers: { origin: base, authorization: 'Bearer ' + auth.session.token } });
  const data = await response.json();
  assert.equal(response.status, 200); assert.equal(data.enabled, true);
  assert.ok(data.rooms.some(room => room.code === rooms.find(room => room.game === game && room.visibility === 'public').code), `${game} listed`);
  assert.ok(!data.rooms.some(room => room.code === rooms.find(room => room.visibility === 'private').code), 'private room is absent');
  assert.ok(data.rooms.every(room => !['answer', 'roleId', 'session', 'token', 'playerId'].some(key => key in room)), 'public rows contain no seat secrets');
  network.push({ game, status: response.status, roomCount: data.rooms.length, privateExcluded: true });
}
const results = [];
async function verifyVisibleArt(page) {
  const broken = await page.evaluate(async () => {
    const visible = element => { const r=element.getBoundingClientRect(); return r.width>0&&r.height>0&&r.bottom>0&&r.top<innerHeight; };
    const images = [...document.images].filter(visible), failures = [];
    await Promise.all(images.map(async image => { try { await image.decode(); } catch { failures.push(new URL(image.src).pathname); } }));
    for (const scene of document.querySelectorAll('.mafia-event-overlay .mafia-scene-art>span')) if (!visible(scene)) failures.push('Event scene artwork has no visible bounds');
    const backgrounds = new Set([...document.querySelectorAll('.clay-avatar,.mafia-scene-art>span')].filter(visible).map(element=>getComputedStyle(element).backgroundImage).filter(value=>value.startsWith('url(')));
    await Promise.all([...backgrounds].map(async background => { const image = new Image(); image.src=background.slice(4,-1).replace(/^["']|["']$/g,'');try { await image.decode(); } catch { failures.push(new URL(image.src).pathname); } }));
    return failures;
  });
  assert.deepEqual(broken, [], 'visible character/scene art must load, not only its placeholder');
}
const dimensions = [[360, 640], [390, 844], [430, 932], [844, 390], [768, 1024], [1180, 800]];
for (const [engineName, engine] of [['chromium', chromium], ['webkit', webkit]]) {
  const browser = await engine.launch({ headless: true });
  const errors = [], external = [];
  const makeContext = async identity => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
    context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
    await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (['data:', 'blob:'].includes(url.protocol) || url.origin === target.origin) return route.continue();
    external.push(url.origin); return route.abort();
  });
    await context.addInitScript(({ auth, origin }) => {
    if (location.origin !== origin) return; // initial opaque about:blank frames have no storage
    const prefix = `maydan:environment:${encodeURIComponent(origin)}:account:`;
    localStorage.setItem(prefix + 'session', JSON.stringify(auth.session.token));
    localStorage.setItem(prefix + 'me', JSON.stringify({ data: auth.me, fetchedAt: Date.now() }));
    localStorage.setItem('maydan:platform:settings', JSON.stringify({ soundOn: false, musicOn: false, reducedMotion: true, splashSeen: true, musicLevel: 2 }));
    }, { auth: identity, origin: target.origin });
    return context;
  };
  const identity = engineName === 'chromium' ? auth : await post('/__preview__/login', { index: 2 });
  const context = await makeContext(identity);
  const page = await context.newPage();
  try {
    await page.goto(base + '/#/');
    await page.getByRole('heading', { name: 'اختار لعبتك' }).waitFor();
    assert.equal(await page.locator('.home-game-row').count(), 8);
    await verifyVisibleArt(page);
    await page.screenshot({ path: path.join(proof, `${engineName}-home-390.png`) });
    for (const [width, height] of dimensions) {
      await page.setViewportSize({ width, height });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${engineName} Home ${width}`);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    for (const game of ['mafia', 'badeeha', 'ersomha', 'fabraka', 'meenfina']) {
      await page.goto(base + '/#/online/' + game);
      await page.locator(`[data-design-screen="online.${game}.directory"] .online-directory-row`).first().waitFor();
      assert.equal(await page.getByRole('navigation', { name: 'أقسام ميدان' }).count(), 0);
      assert.equal(await page.locator('.online-directory-profile').count(), 1);
      assert.equal(await page.locator('.lamma-launcher:visible').count(), 0, 'profile footer has no floating launcher overlap');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${engineName} real ${game}`);
      if (game === 'mafia') await page.screenshot({ path: path.join(proof, `${engineName}-real-mafia-directory-390.png`) });
    }
    // Two independent full-app browser contexts join the same real local room.
    const liveGame = engineName === 'chromium' ? 'fabraka' : 'meenfina';
    const room = rooms.find(room => room.game === liveGame && room.visibility === 'public');
    const code = room.code, expectedPlayers = room.count + 2;
    await page.goto(base + '/#/online/' + liveGame);
    await page.locator(`[data-room-code="${code}"] button`).click();
    await page.locator('[data-design-screen="online.lobby"]').waitFor();
    const peerContext = await makeContext(await post('/__preview__/login', { index: engineName === 'chromium' ? 1 : 3 }));
    try {
      const peer = await peerContext.newPage();
      await peer.goto(base + '/#/online/' + liveGame);
      await peer.locator(`[data-room-code="${code}"] button`).click();
      await peer.locator('[data-design-screen="online.lobby"]').waitFor();
      await page.waitForFunction(count => document.querySelectorAll('.online-players > li').length === count, expectedPlayers);
      assert.equal(await peer.locator('.online-players > li').count(), expectedPlayers);
      await page.locator('[data-design-id="ready"]').click();
      await peer.waitForFunction(name => [...document.querySelectorAll('.online-players > li')].some(row => row.textContent.includes(name) && row.textContent.includes('جاهز')), identity.me.user.name.split('·')[0].trim());
      await page.screenshot({ path: path.join(proof, `${engineName}-real-${liveGame}-lobby-390.png`) });
    } finally { await peerContext.close(); }
    for (const kind of ['discussion', 'night', 'defense', 'nomination', 'ending']) {
      await page.goto(base + '/__preview__/scene?kind=' + kind);
      await page.locator('.mafia-shell').waitFor();
      if (kind !== 'ending') assert.equal(await page.locator('.mafia-seats > *').count(), 12, `${kind} seats`);
      for (const [width, height] of dimensions) {
        await page.setViewportSize({ width, height });
        await page.waitForTimeout(80);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${engineName} ${kind} ${width}`);
      }
      await page.setViewportSize({ width: 390, height: 844 });
      if (['discussion', 'night'].includes(kind)) {
        await page.waitForTimeout(1700);
        await verifyVisibleArt(page);
        await page.screenshot({ path: path.join(proof, `${engineName}-mafia-${kind}-390.png`) });
        if (kind === 'night') {
          await page.getByRole('button', { name: 'إعادة المؤثر', exact: true }).click();
          await verifyVisibleArt(page);
          await page.screenshot({ path: path.join(proof, `${engineName}-mafia-night-effect-390.png`) });
        }
      }
    }
    await page.goto(base + '/__preview__/scene?kind=directory&game=badeeha');
    await page.locator('.online-directory-row').first().waitFor();
    assert.equal(await page.locator('.online-directory-row').count(), 32);
    await page.locator('.online-directory-row').last().scrollIntoViewIfNeeded();
    assert.ok(await page.locator('.online-directory-row').last().isVisible());
    await page.goto(base + '/__preview__/');
    await page.locator('#actor option').first().waitFor({ state: 'attached' });
    await page.getByRole('button', { name: 'الليل', exact: true }).click();
    await page.frameLocator('#app').locator('.mafia-shell').waitFor();
    await page.screenshot({ path: path.join(proof, `${engineName}-review-dashboard.png`), fullPage: true });
    assert.deepEqual(errors, [], 'full shell has no uncaught JavaScript errors');
    assert.deepEqual([...new Set(external)], [], 'no external backend/provider requests');
    results.push({ engine: engineName, status: 'passed', dimensions, realDirectories: 5, independentRoomClients: 2, liveGame, liveJoinedPlayers: expectedPlayers, readySynchronized: true, syntheticMafiaScenes: 5, longList: 32, uncaughtErrors: 0, externalRequests: 0 });
  } finally { await context.close(); await browser.close(); }
}
const report = { checkedAt: new Date().toISOString(), source: 'full product shell + loopback HTTP/WebSocket server', network, browser: results, physicalIPhone: false, providerCalls: false, limitations: ['Viewport sizes are browser evidence, not a physical keyboard or native iPhone test.', 'Mafia scenes and long directory are explicit synthetic visual fixtures. Real directory reads are recorded separately.'] };
await writeFile(path.resolve('docs/ui-rebuild-20261030/integration-proof.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));

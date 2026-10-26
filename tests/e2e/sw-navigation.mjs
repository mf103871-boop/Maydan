// Exercise actual browser redirect metadata; a Response mock cannot reproduce
// Chrome rejecting a redirected cached response for a manual-mode navigation.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

let server, browser, origin;
const cacheName = 'maydan-platform-navigation-test';
before(async () => {
  const sw = (await readFile(new URL('../../public/sw.js', import.meta.url), 'utf8'))
    .replaceAll('__BUILD_ID__', 'navigation-test');
  const html = '<!doctype html><html><head><meta charset="utf-8"><title>Maydan</title></head><body><main>Maydan offline shell</main><script>navigator.serviceWorker.register("./sw.js");</script></body></html>';
  server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const base = pathname.startsWith('/Maydan/') ? '/Maydan/' : '/';
    if (pathname === `${base}sw.js`) { res.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-store' }); res.end(sw); return; }
    if (pathname === `${base}index.html` || pathname === `${base}legacy-index.html`) {
      res.writeHead(307, { location: base, 'cache-control': 'no-store' }); res.end(); return;
    }
    if (pathname === base) { res.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' }); res.end(html); return; }
    res.writeHead(404); res.end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
});
after(async () => {
  await browser?.close();
  if (server?.listening) await new Promise((resolve) => server.close(resolve));
});

for (const base of ['/', '/Maydan/']) {
  test(`redirected index install permits online and offline reload at ${base}`, { timeout: 20000 }, async (t) => {
    const context = await browser.newContext(); t.after(() => context.close());
    const page = await context.newPage();
    await page.goto(origin + base);
    await page.waitForFunction(() => navigator.serviceWorker.controller);
    assert.equal(await page.evaluate(async (name) => (await (await caches.open(name)).match(new URL('./index.html', location.href))).redirected, cacheName), false);
    for (let i = 0; i < 2; i++) {
      const response = await page.reload(); assert.equal(response.status(), 200);
      assert.equal(await page.locator('main').textContent(), 'Maydan offline shell');
    }
    await context.setOffline(true);
    const response = await page.reload(); assert.equal(response.status(), 200);
    assert.equal(await page.locator('main').textContent(), 'Maydan offline shell');
  });

  test(`an already cached redirected shell is repaired offline at ${base}`, { timeout: 20000 }, async (t) => {
    const context = await browser.newContext(); t.after(() => context.close());
    const page = await context.newPage();
    await page.goto(origin + base);
    await page.waitForFunction(() => navigator.serviceWorker.controller);
    const seeded = await page.evaluate(async (name) => {
      const response = await fetch('./legacy-index.html');
      const cache = await caches.open(name);
      await cache.put(new URL('./index.html', location.href), response);
      return (await cache.match(new URL('./index.html', location.href))).redirected;
    }, cacheName);
    assert.equal(seeded, true, 'The fixture must carry real browser redirect metadata');
    await context.setOffline(true);
    const response = await page.reload(); assert.equal(response.status(), 200);
    assert.equal(await page.locator('main').textContent(), 'Maydan offline shell');
    await page.waitForFunction(async (name) => !(await (await caches.open(name)).match(new URL('./index.html', location.href))).redirected, cacheName);
    await page.reload(); assert.equal(await page.locator('main').textContent(), 'Maydan offline shell');
  });
}

// The brand art and fonts are content-hashed files the first frame needs. They are
// installed before activation, kept offline, and a release that reuses the same
// hashed name takes the copy the previous release cached instead of downloading it.
test('brand assets are installed with the shell, reused by the next release and served offline', { timeout: 30000 }, async (t) => {
  const source = await readFile(new URL('../../public/sw.js', import.meta.url), 'utf8');
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const asset = './assets/brand/art-TESTHASH.png';
  let release = 1, assetRequests = 0;
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Maydan</title></head><body><img id="art" src="${asset}" alt=""><script>navigator.serviceWorker.register("./sw.js");</script></body></html>`;
  const brandServer = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname === '/sw.js') {
      res.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-store' });
      res.end(source.replaceAll('__BUILD_ID__', `brand-${release}`).replace('/*__BRAND_ASSETS__*/[]', JSON.stringify([asset])));
      return;
    }
    if (pathname === '/' || pathname === '/index.html') { res.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' }); res.end(html); return; }
    if (pathname === '/assets/brand/art-TESTHASH.png') { assetRequests += 1; res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store' }); res.end(PNG); return; }
    res.writeHead(404); res.end();
  });
  await new Promise((resolve) => brandServer.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => brandServer.close(resolve)));
  const base = `http://127.0.0.1:${brandServer.address().port}/`;
  const context = await browser.newContext(); t.after(() => context.close());
  const page = await context.newPage();
  await page.goto(base);
  await page.waitForFunction(() => navigator.serviceWorker.controller);
  const cached = (name) => page.evaluate(async ({ name, asset }) => !!(await (await caches.open(name)).match(new URL(asset, location.href))), { name, asset });
  assert.equal(await cached('maydan-platform-brand-1'), true, 'installed with the first release');
  const afterFirst = assetRequests;

  release = 2;
  await page.evaluate(async () => { await (await navigator.serviceWorker.getRegistration()).update(); });
  // waitForFunction would take the async predicate's Promise itself as truthy: poll instead.
  const activated = async () => { const keys = await page.evaluate(() => caches.keys()); return keys.includes('maydan-platform-brand-2') && !keys.includes('maydan-platform-brand-1'); };
  for (let i = 0; i < 100 && !(await activated()); i++) await page.waitForTimeout(100);
  assert.equal(await activated(), true, 'the second release activated');
  assert.equal(await cached('maydan-platform-brand-2'), true, 'present in the second release');
  assert.equal(assetRequests, afterFirst, 'the second release reused the cached copy');

  await context.setOffline(true);
  const response = await page.reload(); assert.equal(response.status(), 200);
  await page.waitForFunction(() => document.getElementById('art').complete);
  assert.equal(await page.evaluate(() => document.getElementById('art').naturalWidth), 1, 'served offline');
});

test('an interrupted new brand release cannot replace the working offline document', { timeout: 30000 }, async (t) => {
  const source = await readFile(new URL('../../public/sw.js', import.meta.url), 'utf8');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  let release = 1, rejectNewAsset = true, failedAssetRequests = 0;
  const asset = (version) => `./assets/brand/art-RELEASE${version}.png`;
  const releaseServer = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    res.setHeader('cache-control', 'no-store');
    if (pathname === '/sw.js') {
      res.setHeader('content-type', 'text/javascript');
      res.end(source.replaceAll('__BUILD_ID__', `atomic-${release}`).replace('/*__BRAND_ASSETS__*/[]', JSON.stringify([asset(release)])));
      return;
    }
    if (pathname === '/' || pathname === '/index.html') {
      res.setHeader('content-type', 'text/html');
      res.end(`<!doctype html><html><body><main>Release ${release}</main><img id="art" src="${asset(release)}" alt=""><script>navigator.serviceWorker.register('./sw.js');</script></body></html>`);
      return;
    }
    if (pathname === '/assets/brand/art-RELEASE2.png' && rejectNewAsset) {
      failedAssetRequests += 1;
      res.writeHead(503); res.end(); return;
    }
    if (/^\/assets\/brand\/art-RELEASE[12]\.png$/.test(pathname)) {
      res.setHeader('content-type', 'image/png'); res.end(png); return;
    }
    res.writeHead(404); res.end();
  });
  await new Promise((resolve) => releaseServer.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => releaseServer.close(resolve)));
  const context = await browser.newContext(); t.after(() => context.close());
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${releaseServer.address().port}/`);
  await page.waitForFunction(() => navigator.serviceWorker.controller);
  assert.equal(await page.locator('main').textContent(), 'Release 1');

  release = 2;
  const failedState = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    const finished = new Promise((resolve) => registration.addEventListener('updatefound', () => {
      const worker = registration.installing;
      worker.addEventListener('statechange', () => {
        if (['redundant', 'activated'].includes(worker.state)) resolve(worker.state);
      });
    }, { once: true }));
    await registration.update();
    return finished;
  });
  assert.equal(failedState, 'redundant', 'the changed release really failed its required asset install');
  assert.ok(failedAssetRequests > 0, 'the new hashed asset was unavailable');

  // The old active worker must not refresh just its HTML from release 2. That
  // would leave an uncached art/font URL in the only working offline release.
  await page.reload();
  await page.waitForLoadState('networkidle');
  const oldDocument = await page.evaluate(async () => {
    const cache = await caches.open('maydan-platform-atomic-1');
    return (await cache.match(new URL('./index.html', location.href))).text();
  });
  assert.match(oldDocument, /Release 1/, 'active release HTML remains pinned after the failed upgrade');
  assert.doesNotMatch(oldDocument, /art-RELEASE2/);
  await context.setOffline(true);
  await page.reload();
  assert.equal(await page.locator('main').textContent(), 'Release 1');
  await page.waitForFunction(() => document.getElementById('art').complete);
  assert.equal(await page.evaluate(() => document.getElementById('art').naturalWidth), 1, 'old art still renders offline');

  // Recovery remains automatic: only a complete dependency set replaces the
  // release; activation still does not navigate an already open match.
  await context.setOffline(false); rejectNewAsset = false;
  await page.evaluate(async () => { await (await navigator.serviceWorker.getRegistration()).update(); });
  const recovered = async () => { const keys = await page.evaluate(() => caches.keys()); return keys.includes('maydan-platform-atomic-2') && !keys.includes('maydan-platform-atomic-1'); };
  for (let attempt = 0; attempt < 100 && !(await recovered()); attempt++) await page.waitForTimeout(100);
  assert.equal(await recovered(), true, 'the old release retires after a complete install');
  assert.equal(await page.locator('main').textContent(), 'Release 1', 'activation does not interrupt the open page');
  await context.setOffline(true);
  await page.reload();
  assert.equal(await page.locator('main').textContent(), 'Release 2');
  await page.waitForFunction(() => document.getElementById('art').complete);
  assert.equal(await page.evaluate(() => document.getElementById('art').naturalWidth), 1, 'new art renders after the complete release installs');
});

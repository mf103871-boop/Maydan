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

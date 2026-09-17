// Standalone Paddle payment-link page. All Paddle/config responses are local
// fixtures; no transaction is created and no real checkout is opened.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

let browser, server, origin;
const errors = [];
const transaction = 'txn_01h2b0qpjc0xt8k5aw6nsdec4p';
const paddleSrc = 'https://cdn.paddle.com/paddle/v2/paddle.js';
before(async () => {
  const html = await readFile(new URL('../../public/pay.html', import.meta.url), 'utf8');
  server = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end(html); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
});
after(async () => {
  await browser?.close();
  if (server?.listening) await new Promise((resolve) => server.close(resolve));
  assert.deepEqual(errors, [], 'no uncaught browser errors');
});

async function pageFor(t, { environment = 'production', configured = true, brokenScript = false, native = false, token } = {}) {
  const context = await browser.newContext();
  t.after(() => context.close());
  const page = await context.newPage();
  const seen = { config: 0, sdk: 0, otherApi: [] };
  page.on('pageerror', (error) => errors.push(error.message));
  if (native) await page.addInitScript(() => { window.MaydanNative = {}; });
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/billing/config') {
      seen.config++;
      return route.fulfill({ json: { paddle: configured ? { environment, clientToken: token || (environment === 'sandbox' ? 'test_fixture' : 'live_fixture') } : null } });
    }
    if (url.pathname.startsWith('/api/')) seen.otherApi.push(url.pathname);
    if (url.href === paddleSrc) {
      seen.sdk++;
      if (brokenScript) return route.abort();
      return route.fulfill({ contentType: 'application/javascript', body: `window.paddleCalls=[]; window.Paddle={Environment:{set(value){window.paddleCalls.push(value)}},Initialize(config){window.paddleConfig=config; window.paddleQuery=new URLSearchParams(location.search).get('_ptxn')}};` });
    }
    return url.origin === origin ? route.continue() : route.abort();
  });
  return { page, seen };
}

for (const environment of ['production', 'sandbox']) {
  test(`${environment} payment link initializes Paddle with its existing transaction`, async (t) => {
    const { page, seen } = await pageFor(t, { environment });
    await page.goto(`${origin}/pay.html?_ptxn=${transaction}`);
    await page.waitForFunction(() => !!window.paddleConfig);
    assert.equal(await page.evaluate(() => window.paddleQuery), transaction);
    assert.deepEqual(await page.evaluate(() => window.paddleCalls), environment === 'sandbox' ? ['sandbox'] : []);
    assert.equal(await page.locator('#sandbox').isVisible(), environment === 'sandbox');
    assert.deepEqual(seen, { config: 1, sdk: 1, otherApi: [] });
    await page.evaluate(() => window.paddleConfig.eventCallback({ name: 'checkout.completed' }));
    assert.match(await page.getByRole('status').textContent(), /للتحقق من حالة الاشتراك/);
    assert.equal(await page.getByRole('link', { name: 'العودة إلى حسابي' }).getAttribute('href'), '/#/settings');
    assert.equal(await page.evaluate(() => localStorage.length), 0, 'browser callback cannot grant access');
  });
}

for (const query of ['', '?_ptxn=invalid']) {
  test(`missing or invalid transaction (${query || 'none'}) does not initialize checkout`, async (t) => {
    const { page, seen } = await pageFor(t);
    await page.goto(`${origin}/pay.html${query}`);
    assert.match(await page.getByRole('status').textContent(), /افتح رابط الدفع/);
    assert.deepEqual(seen, { config: 0, sdk: 0, otherApi: [] });
  });
}

for (const [name, options] of [['unconfigured', { configured: false }], ['wrong environment token', { token: 'test_wrong' }], ['CDN failure', { brokenScript: true }]]) {
  test(`${name} leaves an actionable retry without starting a new purchase`, async (t) => {
    const { page, seen } = await pageFor(t, options);
    await page.goto(`${origin}/pay.html?_ptxn=${transaction}`);
    await page.getByRole('button', { name: 'إعادة المحاولة' }).waitFor();
    assert.match(await page.getByRole('status').textContent(), /تعذّر فتح الدفع/);
    assert.deepEqual(seen.otherApi, []);
    assert.equal(await page.evaluate(() => window.paddleConfig), undefined);
  });
}

test('native shell never loads the web payment provider', async (t) => {
  const { page, seen } = await pageFor(t, { native: true });
  await page.goto(`${origin}/pay.html?_ptxn=${transaction}`);
  assert.match(await page.getByRole('status').textContent(), /App Store/);
  assert.deepEqual(seen, { config: 0, sdk: 0, otherApi: [] });
});

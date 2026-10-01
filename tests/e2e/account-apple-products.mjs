// Actual React Paywall + AccountProvider with an isolated StoreKit bridge/API.
// No Apple services, production calls, real accounts, prices, or purchase sheets.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('../../', import.meta.url));
const userId = '00000000-0000-4000-8000-000000000001';
const monthly = { id: 'plus.monthly', price: '$3.99', period: 'شهريًا' };
const yearly = { id: 'plus.yearly', price: '$29.99', period: 'سنويًا' };
const allProducts = [monthly, yearly];
const me = (active = false) => ({ user: { id: userId, name: 'اختبار' }, serverTime: 1, trials: {}, premium: {
  active, source: active ? 'apple' : null, until: active ? Date.now() + 86400000 : 0,
  status: active ? 'active' : null, willRenew: active,
} });
let browser, server, origin, deliveries, configCalls, readiness, holdConfig;
let pendingConfig = [];
const errors = [];
const configBody = () => ({ apple: { purchasesConfigured: readiness }, providers: { apple: true } });
const reply = (res, body, status = 200) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

before(async () => {
  const bundle = await build({ stdin: { resolveDir: root, loader: 'jsx', contents: `
    import React, { useEffect } from 'react';
    import { createRoot } from 'react-dom/client';
    import { AccountProvider } from './src/shared/account/AccountProvider.jsx';
    import { useAccount } from './src/shared/account/context.js';
    import { Paywall } from './src/shared/account/Paywall.jsx';
    function View() {
      const account = useAccount();
      useEffect(() => { window.testAccount = account; }, [account]);
      return <Paywall open={account.paywall.open} onClose={account.closePaywall} />;
    }
    createRoot(document.getElementById('app')).render(<AccountProvider><View /></AccountProvider>);
  ` }, bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic',
    define: { __MAYDAN_ROOMS_URL__: JSON.stringify('same-origin') },
    loader: { '.js': 'jsx', '.css': 'text', '.webp': 'dataurl', '.png': 'dataurl', '.woff2': 'dataurl' }, logLevel: 'silent' });
  const html = `<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><body><div id="app"></div><script>${bundle.outputFiles[0].text}</script></body></html>`;
  server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname === '/api/me') { reply(res, me()); return; }
    if (pathname === '/api/billing/config') {
      configCalls++;
      if (holdConfig) pendingConfig.push(res);
      else reply(res, configBody());
      return;
    }
    if (pathname === '/api/apple/transactions') { deliveries++; reply(res, me(true)); return; }
    if (pathname.startsWith('/api/')) { reply(res, { error: 'NOT_FOUND' }, 404); return; }
    res.writeHead(200, { 'content-type': 'text/html' }); res.end(html);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
});

after(async () => {
  for (const res of pendingConfig) reply(res, configBody());
  await browser?.close();
  if (server?.listening) await new Promise((resolve) => server.close(resolve));
  assert.deepEqual(errors, [], 'no uncaught React/browser errors');
});

async function fresh(t, responses, { signedIn = true, purchaseError = null, configured = true, holdStatus = false, fakeClock = false } = {}) {
  configCalls = 0; deliveries = 0; readiness = configured; holdConfig = false; pendingConfig = [];
  const context = await browser.newContext(); t.after(() => context.close());
  await context.addInitScript(({ cached, signedIn, responses, purchaseError, holdStatus }) => {
    if (signedIn) {
      localStorage.setItem('maydan:account:session', JSON.stringify('unit-session'));
      localStorage.setItem('maydan:account:me', JSON.stringify({ data: cached, fetchedAt: Date.now() }));
    }
    window.nativeCalls = [];
    window.catalogResponses = responses;
    window.pendingCatalog = [];
    window.replyCatalog = (products) => {
      for (const id of window.pendingCatalog.splice(0)) window.maydanNative.resolve(id, { ok: true, result: { products } });
    };
    window.MaydanNative = { postMessage(raw) {
      const message = JSON.parse(raw);
      window.nativeCalls.push(message);
      let result = {}, error = null;
      if (message.type === 'products') {
        const response = window.catalogResponses.length > 1 ? window.catalogResponses.shift() : window.catalogResponses[0];
        if (response?.hold) { window.pendingCatalog.push(message.id); return; }
        result = { products: response?.products || [], diagnostics: response?.diagnostics }; error = response?.error;
      }
      if (message.type === 'storeStatus') {
        if (holdStatus) return;
        result = { bundleId: 'Maydan', version: '1.5', build: '7', storefrontCountry: 'JOR', canMakePayments: true };
      }
      if (message.type === 'getTrials') result = { marks: {} };
      if (message.type === 'pendingTransactions') result = { transactions: [] };
      if (message.type === 'purchase') { result = { jws: 'unit-purchase-jws' }; error = purchaseError; }
      if (message.type === 'restore') result = { transactions: ['unit-restore-jws'] };
      queueMicrotask(() => window.maydanNative.resolve(message.id, { ok: !error, result, error }));
    } };
  }, { cached: { ...me(), serverTime: 0 }, signedIn, responses, purchaseError, holdStatus });
  const page = await context.newPage(); page.on('pageerror', (error) => errors.push(error.message));
  if (fakeClock) await page.clock.install();
  await page.route('**/*', (route) => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await page.goto(origin);
  await page.waitForFunction(() => window.testAccount?.ready);
  await page.evaluate(() => window.testAccount.openPaywall());
  return page;
}

const calls = (page, type) => page.evaluate((type) => window.nativeCalls.filter((call) => call.type === type), type);
const subscribe = (page) => page.getByRole('button', { name: 'اشترك', exact: true });
const retry = (page) => page.getByRole('button', { name: 'إعادة تحميل الأسعار', exact: true });

test('loading catalog shows no placeholder or purchase, and concurrent loaders await one request', async (t) => {
  const page = await fresh(t, [{ hold: true }], { signedIn: false });
  await page.waitForFunction(() => window.testAccount.productsStatus === 'loading');
  assert.match(await page.getByRole('status').textContent(), /جارٍ تحميل أسعار App Store/);
  assert.equal(await page.locator('[data-plan]').count(), 0);
  assert.equal(await subscribe(page).isDisabled(), true);
  assert.doesNotMatch(await page.locator('.paywall').textContent(), /يُعرض السعر عند الشراء/);
  await page.evaluate(() => {
    window.loadedCatalog = false;
    window.catalogWait = Promise.all([window.testAccount.loadProducts(), window.testAccount.loadProducts()])
      .then((result) => { window.loadedCatalog = result; });
  });
  await page.evaluate(() => window.testAccount.purchase('monthly'));
  assert.equal((await calls(page, 'products')).length, 1);
  assert.equal((await calls(page, 'signInApple')).length, 0);
  assert.equal((await calls(page, 'purchase')).length, 0);
  assert.equal(await page.evaluate(() => window.loadedCatalog), false);
  await page.evaluate((products) => window.replyCatalog(products), allProducts);
  await page.waitForFunction(() => window.loadedCatalog && window.testAccount.productsStatus === 'ready');
  const result = await page.evaluate(() => window.loadedCatalog);
  assert.deepEqual(result.map((catalog) => catalog.monthly.price), ['$3.99', '$3.99']);
  assert.equal(await subscribe(page).isDisabled(), false);
});

test('StoreKit error diagnostics remain local and clear after successful retry', async (t) => {
  const page = await fresh(t, [{ products: [], diagnostics: { outcome: 'storekit-error', storefrontCountry: 'JOR',
    errorChain: [{ domain: 'ASDErrorDomain', code: 500, description: 'private-account' }], receipt: 'private-receipt' } }, { products: allProducts }]);
  await retry(page).waitFor();
  const details = page.locator('.paywall-support');
  assert.equal(await details.getAttribute('open'), null, 'support report starts collapsed');
  await details.locator('summary').click();
  assert.match(await details.textContent(), /storekit-error/);
  assert.match(await details.textContent(), /JOR/);
  assert.doesNotMatch(await details.textContent(), /private/);
  assert.equal(deliveries, 0);
  await retry(page).click();
  await page.waitForFunction(() => window.testAccount.productsStatus === 'ready');
  assert.equal(await details.count(), 0);
  assert.equal(await page.evaluate(() => window.testAccount.productsDiagnostics), null);
});

for (const holdStatus of [false, true]) {
  test(`one-minute catalog timeout identifies ${holdStatus ? 'unresponsive bridge' : 'StoreKit request'}`, async (t) => {
    const page = await fresh(t, [{ hold: true }], { holdStatus, fakeClock: true });
    await page.waitForFunction(() => window.testAccount.productsStatus === 'loading');
    await page.clock.fastForward(61_000);
    await retry(page).waitFor();
    const diagnostics = await page.evaluate(() => window.testAccount.productsDiagnostics);
    assert.equal(diagnostics.outcome, holdStatus ? 'bridge-timeout' : 'storekit-timeout');
    assert.equal(diagnostics.storefrontCountry, holdStatus ? undefined : 'JOR');
    assert.equal(await subscribe(page).isDisabled(), true);
    assert.equal((await calls(page, 'purchase')).length, 0);
    await page.evaluate((products) => window.replyCatalog(products), allProducts);
    assert.equal(await page.evaluate(() => window.testAccount.productsStatus), 'unavailable', 'late timed-out reply does not overwrite current state');
  });
}

test('empty catalog waits for explicit retry, then reveals actual StoreKit prices', async (t) => {
  const page = await fresh(t, [{ products: [] }, { products: allProducts }]);
  await retry(page).waitFor();
  assert.equal(await subscribe(page).isDisabled(), true);
  assert.equal(await page.getByRole('button', { name: 'استعادة المشتريات' }).isDisabled(), false);
  assert.equal(await page.locator('[data-plan]').count(), 0);
  assert.match(await page.getByRole('status').textContent(), /تعذّر تحميل أسعار الاشتراك من App Store/);
  await page.evaluate(async () => {
    await window.testAccount.loadProducts();
    window.testAccount.closePaywall();
    window.testAccount.openPaywall();
  });
  await retry(page).waitFor();
  assert.equal((await calls(page, 'products')).length, 1, 'failure is not retried by rerender/reopening');
  await retry(page).click();
  await page.waitForFunction(() => window.testAccount.productsStatus === 'ready');
  assert.equal((await calls(page, 'products')).length, 2);
  assert.equal(await page.locator('[data-plan]').count(), 2);
  assert.equal(await page.locator('[data-plan="monthly"] .paywall-plan-price').textContent(), '$3.99');
  assert.equal(await page.locator('[data-plan="yearly"] .paywall-plan-price').textContent(), '$29.99');
  assert.equal(await subscribe(page).isDisabled(), false);
});

for (const response of [{ error: 'NETWORK' }, { products: [{ ...monthly, price: '   ' }] }]) {
  test(`catalog ${response.error || 'without a real price'} is retryable and cannot purchase`, async (t) => {
    const page = await fresh(t, [response, { products: [monthly] }]);
    await retry(page).waitFor();
    await page.evaluate(() => window.testAccount.purchase('monthly'));
    assert.equal((await calls(page, 'purchase')).length, 0);
    assert.equal(configCalls, 0);
    assert.equal(await page.evaluate(() => window.testAccount.error), 'APPLE_PRODUCTS_UNAVAILABLE');
    assert.doesNotMatch(await page.locator('.paywall').textContent(), /هذا الحساب غير مؤهل/);
    await retry(page).click();
    await page.waitForFunction(() => window.testAccount.productsStatus === 'ready');
    assert.equal(await page.evaluate(() => window.testAccount.error), null);
    assert.equal(await page.locator('[data-plan]').count(), 1);
  });
}

test('yearly-only catalog selects and purchases yearly, and partial refresh preserves it', async (t) => {
  const page = await fresh(t, [{ products: [yearly] }, { hold: true }]);
  await page.waitForFunction(() => window.testAccount.productsStatus === 'ready');
  assert.equal(await page.locator('[data-plan="monthly"]').count(), 0);
  assert.equal(await page.locator('[data-plan="yearly"]').getAttribute('aria-checked'), 'true');
  assert.equal(await subscribe(page).isDisabled(), false);
  await page.evaluate(() => window.testAccount.purchase('monthly'));
  assert.equal((await calls(page, 'purchase')).length, 0, 'missing monthly product is defended at provider level');
  await retry(page).click();
  await page.waitForFunction(() => window.testAccount.productsStatus === 'loading');
  assert.equal(await page.locator('[data-plan="yearly"]').count(), 1, 'known priced yearly plan remains visible');
  assert.equal(await subscribe(page).isDisabled(), true);
  await page.evaluate((products) => window.replyCatalog(products), allProducts);
  await page.waitForFunction(() => window.testAccount.productsStatus === 'ready');
  assert.equal(await page.locator('[data-plan="yearly"]').getAttribute('aria-checked'), 'true');
  await subscribe(page).click();
  await page.waitForFunction(() => window.testAccount.premium);
  assert.deepEqual((await calls(page, 'purchase')).map(({ productId, userId }) => ({ productId, userId })), [{ productId: 'plus.yearly', userId }]);
  assert.equal(deliveries, 1);
  assert.equal((await calls(page, 'finishTransaction')).length, 1);
});

test('StoreKit unavailable-product rejection invalidates prices and offers a retry', async (t) => {
  const page = await fresh(t, [{ products: allProducts }, { products: allProducts }], { purchaseError: 'APPLE_PRODUCTS_UNAVAILABLE' });
  await page.waitForFunction(() => window.testAccount.productsStatus === 'ready');
  await subscribe(page).click();
  await retry(page).waitFor();
  assert.equal(await subscribe(page).isDisabled(), true);
  assert.equal(await page.locator('[data-plan]').count(), 0);
  assert.equal(await page.evaluate(() => window.testAccount.productsError), 'APPLE_PRODUCTS_UNAVAILABLE');
  assert.doesNotMatch(await page.locator('.paywall').textContent(), /هذا الحساب غير مؤهل/);
  assert.equal(deliveries, 0);
  await retry(page).click();
  await page.waitForFunction(() => window.testAccount.productsStatus === 'ready');
  assert.equal(await subscribe(page).isDisabled(), false);
});

test('empty catalog and disabled new purchases do not gate Restore', async (t) => {
  const page = await fresh(t, [{ products: [] }], { configured: false });
  await retry(page).waitFor();
  await page.getByRole('button', { name: 'استعادة المشتريات' }).click();
  await page.waitForFunction(() => window.testAccount.premium);
  assert.equal(configCalls, 0);
  assert.equal((await calls(page, 'restore')).length, 1);
  assert.equal((await calls(page, 'purchase')).length, 0);
  assert.equal(deliveries, 1);
});

test('simultaneous purchase calls open only one native sheet', async (t) => {
  const page = await fresh(t, [{ products: allProducts }]);
  await page.waitForFunction(() => window.testAccount.productsStatus === 'ready');
  await page.evaluate(() => Promise.all([window.testAccount.purchase('monthly'), window.testAccount.purchase('monthly')]));
  assert.equal((await calls(page, 'purchase')).length, 1);
  assert.equal(configCalls, 1);
  assert.equal(deliveries, 1);
});

test('catalog refresh during readiness preflight prevents a stale selected product purchase', async (t) => {
  const page = await fresh(t, [{ products: [monthly] }, { hold: true }]);
  await page.waitForFunction(() => window.testAccount.productsStatus === 'ready');
  holdConfig = true;
  await page.evaluate(() => { window.pendingPurchase = window.testAccount.purchase('monthly'); });
  await page.waitForFunction(() => window.testAccount.busy === 'purchase');
  const deadline = Date.now() + 5000;
  while (!pendingConfig.length && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(pendingConfig.length, 1, 'readiness request reached the local server');
  await retry(page).click();
  await page.waitForFunction(() => window.testAccount.productsStatus === 'loading');
  for (const res of pendingConfig.splice(0)) reply(res, configBody());
  await page.evaluate(() => window.pendingPurchase);
  assert.equal((await calls(page, 'purchase')).length, 0);
  assert.equal(await page.evaluate(() => window.testAccount.error), 'APPLE_PRODUCTS_UNAVAILABLE');
  await page.evaluate((products) => window.replyCatalog(products), allProducts);
  await page.waitForFunction(() => window.testAccount.productsStatus === 'ready');
  assert.equal(await page.evaluate(() => window.testAccount.error), null, 'successful catalog clears a late availability failure');
});

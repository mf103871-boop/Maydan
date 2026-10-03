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
let browser, server, origin, deliveries, configCalls, readiness, holdConfig, transactionError, apiCalls;
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
    if (pathname.startsWith('/api/')) apiCalls.push(pathname);
    if (pathname === '/api/me') { reply(res, me()); return; }
    if (pathname === '/api/billing/config') {
      configCalls++;
      if (holdConfig) pendingConfig.push(res);
      else reply(res, configBody());
      return;
    }
    if (pathname === '/api/apple/transactions') {
      deliveries++;
      reply(res, transactionError ? { error: transactionError } : me(true), transactionError ? 503 : 200);
      return;
    }
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

async function fresh(t, responses, { signedIn = true, purchaseError = null, configured = true, holdStatus = false, fakeClock = false,
  probeResponses = [], restoreResponse = { transactions: ['unit-restore-jws'] }, serverError = null, finishError = null } = {}) {
  configCalls = 0; deliveries = 0; readiness = configured; holdConfig = false; pendingConfig = [];
  transactionError = serverError; apiCalls = [];
  const context = await browser.newContext(); t.after(() => context.close());
  await context.addInitScript(({ cached, signedIn, responses, purchaseError, holdStatus, probeResponses, restoreResponse, finishError }) => {
    if (signedIn) {
      localStorage.setItem('maydan:account:session', JSON.stringify('unit-session'));
      localStorage.setItem('maydan:account:me', JSON.stringify({ data: cached, fetchedAt: Date.now() }));
    }
    window.nativeCalls = [];
    window.catalogResponses = responses;
    window.probeResponses = probeResponses;
    window.pendingCatalog = [];
    window.pendingProbe = [];
    window.replyCatalog = (products) => {
      for (const id of window.pendingCatalog.splice(0)) window.maydanNative.resolve(id, { ok: true, result: { products } });
    };
    window.replyProbe = (diagnostics) => window.pendingProbe.splice(0)
      .map((id) => window.maydanNative.resolve(id, { ok: true, result: { diagnostics } }));
    window.MaydanNative = { postMessage(raw) {
      const message = JSON.parse(raw);
      window.nativeCalls.push(message);
      let result = {}, error = null, diagnostics = null;
      if (message.type === 'products') {
        const response = window.catalogResponses.length > 1 ? window.catalogResponses.shift() : window.catalogResponses[0];
        if (response?.hold) { window.pendingCatalog.push(message.id); return; }
        result = { products: response?.products || [], diagnostics: response?.diagnostics }; error = response?.error;
      }
      if (message.type === 'storeStatus') {
        if (holdStatus) return;
        result = { bundleId: 'Maydan', version: '1.5', build: '7', storefrontCountry: 'JOR', canMakePayments: true };
      }
      if (message.type === 'storeProbe') {
        const response = window.probeResponses.length > 1 ? window.probeResponses.shift() : window.probeResponses[0];
        if (response?.hold) { window.pendingProbe.push(message.id); return; }
        result = { diagnostics: response?.diagnostics }; error = response?.error;
      }
      if (message.type === 'getTrials') result = { marks: {} };
      if (message.type === 'pendingTransactions') result = { transactions: [] };
      if (message.type === 'purchase') { result = { jws: 'unit-purchase-jws' }; error = purchaseError; }
      if (message.type === 'restore') {
        if (window.failRestoreBridge) throw new Error('private-bridge-error');
        result = { transactions: restoreResponse.transactions || [] };
        error = restoreResponse.error; diagnostics = restoreResponse.diagnostics;
      }
      if (message.type === 'finishTransaction') error = finishError;
      queueMicrotask(() => window.maydanNative.resolve(message.id, { ok: !error, result, error, diagnostics }));
    } };
  }, { cached: { ...me(), serverTime: 0 }, signedIn, responses, purchaseError, holdStatus, probeResponses, restoreResponse, finishError });
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
const probe = (page) => page.getByRole('button', { name: 'فحص المتجر للدعم', exact: true });
const storageSnapshot = (page) => page.evaluate(() => ({
  local: Object.fromEntries(Object.keys(localStorage).map((key) => [key, localStorage.getItem(key)])),
  session: Object.fromEntries(Object.keys(sessionStorage).map((key) => [key, sessionStorage.getItem(key)])),
}));

test('support probe is explicit, shared while pending, private and cannot supply prices or access', async (t) => {
  const page = await fresh(t, [{ products: [] }], { signedIn: false, probeResponses: [{ hold: true }] });
  await retry(page).waitFor();
  assert.equal((await calls(page, 'storeProbe')).length, 0);
  await page.evaluate(() => { window.testAccount.closePaywall(); window.testAccount.openPaywall(); });
  await page.locator('.paywall-support summary').click();
  assert.equal((await calls(page, 'storeProbe')).length, 0, 'opening support details never starts a probe');
  const beforeStorage = await storageSnapshot(page);
  const beforeApi = [...apiCalls];
  await probe(page).click();
  await page.waitForFunction(() => window.testAccount.storeProbeStatus === 'loading');
  await page.evaluate(() => {
    window.probeWait = Promise.all([window.testAccount.probeStore(), window.testAccount.probeStore()]);
  });
  assert.equal((await calls(page, 'storeProbe')).length, 1);
  const diagnostics = { outcome: 'success', api: 'storekit1', returnedIds: ['plus.monthly', 'plus.yearly'],
    invalidIds: ['private@example.test'], receipt: 'private-receipt', accountId: 'private-account',
    errorChain: [{ domain: 'SKErrorDomain', code: 0, description: 'private-description', userInfo: { token: 'private-token' } }] };
  await page.evaluate((details) => window.replyProbe(details), diagnostics);
  await page.waitForFunction(() => window.testAccount.storeProbeStatus === 'ready');
  const results = await page.evaluate(() => window.probeWait);
  assert.deepEqual(results[0], results[1], 'concurrent callers receive the same probe result');
  assert.equal(await page.evaluate(() => window.testAccount.productsStatus), 'unavailable');
  assert.equal(await page.evaluate(() => window.testAccount.products), null);
  assert.equal(await page.evaluate(() => window.testAccount.premium), false);
  assert.equal(await subscribe(page).isDisabled(), true);
  assert.equal(await page.locator('[data-plan]').count(), 0);
  assert.match(await page.locator('.paywall-support').textContent(), /storekit1/);
  assert.doesNotMatch(await page.locator('.paywall-support').textContent(), /private|receipt|accountId|description|userInfo/);
  assert.deepEqual(await storageSnapshot(page), beforeStorage, 'probe metadata is not persisted');
  assert.deepEqual(apiCalls, beforeApi, 'probe metadata is not sent to a server');
  for (const type of ['purchase', 'restore', 'signInApple', 'openAuth']) assert.equal((await calls(page, type)).length, 0);
  assert.equal(configCalls, 0);
});

for (const holdStatus of [false, true]) {
  test(`support probe times out as ${holdStatus ? 'bridge' : 'StoreKit'} failure and explicit retry ignores late replies`, async (t) => {
    const page = await fresh(t, [{ products: [] }], { signedIn: false, fakeClock: true, holdStatus,
      probeResponses: [{ hold: true }, { diagnostics: { outcome: 'empty', invalidIds: ['plus.monthly', 'plus.yearly'] } }] });
    await retry(page).waitFor();
    await page.locator('.paywall-support summary').click();
    await probe(page).click();
    await page.waitForFunction(() => window.testAccount.storeProbeStatus === 'loading');
    await page.clock.fastForward(19_000);
    assert.equal(await page.evaluate(() => window.testAccount.storeProbeStatus), 'loading');
    await page.clock.fastForward(2_000);
    await page.waitForFunction(() => window.testAccount.storeProbeStatus === 'ready');
    assert.equal(await page.evaluate(() => window.testAccount.storeProbeDiagnostics.outcome), holdStatus ? 'bridge-timeout' : 'storekit-timeout');
    assert.equal((await calls(page, 'storeProbe')).length, 1, 'deadline does not trigger automatic retry');
    await probe(page).click();
    await page.waitForFunction(() => window.testAccount.storeProbeDiagnostics?.outcome === 'empty');
    assert.equal((await calls(page, 'storeProbe')).length, 2);
    const current = await page.evaluate(() => window.testAccount.storeProbeDiagnostics);
    assert.deepEqual(await page.evaluate(() => window.replyProbe({ outcome: 'success', returnedIds: ['plus.monthly'] })), [false]);
    assert.deepEqual(await page.evaluate(() => window.testAccount.storeProbeDiagnostics), current);
    assert.equal(await subscribe(page).isDisabled(), true);
  });
}

test('a cancelled support probe remains retryable and a recovered catalog clears its report', async (t) => {
  const page = await fresh(t, [{ products: [] }, { products: allProducts }], { signedIn: false,
    probeResponses: [{ diagnostics: { outcome: 'probe-cancelled' } }, { hold: true }] });
  await retry(page).waitFor();
  await page.locator('.paywall-support summary').click();
  await probe(page).click();
  await page.waitForFunction(() => window.testAccount.storeProbeDiagnostics?.outcome === 'probe-cancelled');
  assert.equal(await probe(page).isDisabled(), false);
  assert.equal(await page.evaluate(() => window.testAccount.error), null);
  await probe(page).click();
  await page.waitForFunction(() => window.testAccount.storeProbeStatus === 'loading');
  await retry(page).click();
  await page.waitForFunction(() => window.testAccount.productsStatus === 'ready');
  assert.equal(await page.evaluate(() => window.testAccount.storeProbeStatus), 'idle');
  assert.equal(await page.evaluate(() => window.testAccount.storeProbeDiagnostics), null);
  await page.evaluate(() => window.replyProbe({ outcome: 'success', returnedIds: ['plus.monthly', 'plus.yearly'] }));
  assert.equal(await page.evaluate(() => window.testAccount.storeProbeDiagnostics), null, 'the old probe cannot restore cleared details');
  assert.equal(await page.locator('.paywall-support').count(), 0);
  assert.equal(await subscribe(page).isDisabled(), false);
});

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

for (const scenario of [
  { label: 'StoreKit sync', restoreResponse: { error: 'NETWORK', diagnostics: { stage: 'native-sync', api: 'storekit2',
    errorChain: [{ domain: 'ASDErrorDomain', code: 500, description: 'private-error', userInfo: { receipt: 'private-receipt' } }],
    receipt: 'private-receipt', accountId: 'private-account' } }, stage: 'native-sync', outcome: 'storekit-error', code: 'APPLE_STORE_CONNECTION', deliveries: 0 },
  { label: 'legacy bridge failure', restoreResponse: { error: 'NETWORK' }, stage: 'native-bridge', outcome: 'native-error', code: 'NETWORK', deliveries: 0 },
  { label: 'no entitlements', restoreResponse: { transactions: [] }, stage: 'native-entitlements', outcome: 'empty', code: 'RESTORE_EMPTY', deliveries: 0 },
  { label: 'server verification', serverError: 'NETWORK', stage: 'server-verify', outcome: 'native-error', code: 'NETWORK', deliveries: 1 },
]) {
  test(`restore diagnostics identify ${scenario.label} and keep failed transactions unfinished`, async (t) => {
    const page = await fresh(t, [{ products: [] }, { products: allProducts }], scenario);
    await retry(page).waitFor();
    await page.getByRole('button', { name: 'استعادة المشتريات' }).click();
    await page.waitForFunction(() => window.testAccount.restoreDiagnostics && !window.testAccount.busy);
    const state = await page.evaluate(() => ({ diagnostics: window.testAccount.restoreDiagnostics,
      error: window.testAccount.error, premium: window.testAccount.premium }));
    assert.equal(state.diagnostics.stage, scenario.stage);
    assert.equal(state.diagnostics.outcome, scenario.outcome);
    assert.equal(state.error, scenario.code);
    assert.equal(state.premium, false);
    assert.equal(deliveries, scenario.deliveries);
    assert.equal((await calls(page, 'finishTransaction')).length, 0, 'failed delivery remains retryable');
    assert.equal((await calls(page, 'purchase')).length, 0);
    const details = page.locator('.paywall-support').filter({ has: page.locator('summary', { hasText: 'تفاصيل الاستعادة للدعم' }) });
    assert.equal(await details.getAttribute('open'), null);
    await details.locator('summary').click();
    assert.match(await details.textContent(), new RegExp(scenario.stage));
    assert.doesNotMatch(await details.textContent(), /private|unit-restore-jws|receipt|accountId|description|userInfo/);
    assert.doesNotMatch(JSON.stringify(await storageSnapshot(page)), /private|native-sync|server-verify|errorChain/);
    await retry(page).click();
    await page.waitForFunction(() => window.testAccount.productsStatus === 'ready');
    assert.equal(await page.evaluate(() => window.testAccount.restoreDiagnostics), null, 'a recovered catalog clears stale support reports');
  });
}

test('restore bridge unavailability is distinct from an Apple sync error', async (t) => {
  const page = await fresh(t, [{ products: [] }]);
  await retry(page).waitFor();
  await page.evaluate(() => { window.failRestoreBridge = true; });
  await page.getByRole('button', { name: 'استعادة المشتريات' }).click();
  await page.waitForFunction(() => window.testAccount.restoreDiagnostics && !window.testAccount.busy);
  assert.deepEqual(await page.evaluate(() => window.testAccount.restoreDiagnostics), { outcome: 'bridge-unavailable', stage: 'native-bridge' });
  assert.equal(await page.evaluate(() => window.testAccount.error), 'NETWORK');
  assert.equal(deliveries, 0);
});

test('a native restore cancellation completes without delivering or acknowledging transactions', async (t) => {
  const page = await fresh(t, [{ products: [] }], { restoreResponse: { error: 'PURCHASE_CANCELLED' } });
  await retry(page).waitFor();
  await page.getByRole('button', { name: 'استعادة المشتريات' }).click();
  await page.waitForFunction(() => window.testAccount.error === 'PURCHASE_CANCELLED' && !window.testAccount.busy);
  assert.equal(await page.evaluate(() => window.testAccount.restoreDiagnostics.stage), 'native-bridge');
  assert.equal(await page.evaluate(() => window.testAccount.premium), false);
  assert.equal(deliveries, 0);
  assert.equal((await calls(page, 'finishTransaction')).length, 0);
});

test('a restore acknowledgement failure preserves the entitlement already verified by the server', async (t) => {
  const page = await fresh(t, [{ products: [] }], { finishError: 'NETWORK' });
  await retry(page).waitFor();
  await page.getByRole('button', { name: 'استعادة المشتريات' }).click();
  await page.waitForFunction(() => window.testAccount.premium && !window.testAccount.busy);
  assert.equal(deliveries, 1);
  assert.equal((await calls(page, 'finishTransaction')).length, 1);
  assert.equal(await page.evaluate(() => window.testAccount.error), null);
  assert.equal(await page.evaluate(() => window.testAccount.restoreDiagnostics), null);
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

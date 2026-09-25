// Actual React purchase/restore effects with a fake native bridge and local API.
// No Apple, Paddle, production requests, credentials, or purchase sheets.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('../../', import.meta.url));
const userId = '00000000-0000-4000-8000-000000000001';
let browser, server, origin, readiness, failConfig, configCalls, deliveries;
const errors = [];
const me = (active = false) => ({ user: { id: userId, name: 'اختبار' }, serverTime: 1, trials: {}, premium: {
  active, source: active ? 'apple' : null, until: active ? Date.now() + 86400000 : 0,
  status: active ? 'active' : null, willRenew: active,
} });

before(async () => {
  const bundle = await build({ stdin: { resolveDir: root, loader: 'jsx', contents: `
    import React, { useEffect } from 'react';
    import { createRoot } from 'react-dom/client';
    import { AccountProvider } from './src/shared/account/AccountProvider.jsx';
    import { useAccount } from './src/shared/account/context.js';
    import { accountErrorText } from './src/shared/account/errors.js';
    function View() {
      const account = useAccount();
      useEffect(() => { window.testAccount = account; }, [account]);
      return account.error ? <p role="alert">{accountErrorText(account.error)}</p> : null;
    }
    createRoot(document.getElementById('app')).render(<AccountProvider><View /></AccountProvider>);
  ` }, bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic',
    define: { __MAYDAN_ROOMS_URL__: JSON.stringify('same-origin') }, logLevel: 'silent' });
  const html = `<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><body><div id="app"></div><script>${bundle.outputFiles[0].text}</script></body></html>`;
  server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const reply = (body, status = 200) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (pathname === '/api/me') { reply(me()); return; }
    if (pathname === '/api/billing/config') {
      configCalls++;
      reply(failConfig ? { error: 'NETWORK' } : { providers: { apple: true }, ...(readiness === undefined ? {} : { apple: { purchasesConfigured: readiness } }) }, failConfig ? 503 : 200);
      return;
    }
    if (pathname === '/api/apple/transactions') { deliveries++; reply(me(true)); return; }
    if (pathname.startsWith('/api/')) { reply({ error: 'NOT_FOUND' }, 404); return; }
    res.writeHead(200, { 'content-type': 'text/html' }); res.end(html);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
});
after(async () => {
  await browser?.close();
  if (server?.listening) await new Promise((resolve) => server.close(resolve));
  assert.deepEqual(errors, []);
});

async function fresh(t, ready, { failed = false, unfinished = false } = {}) {
  readiness = ready; failConfig = failed; configCalls = 0; deliveries = 0;
  const context = await browser.newContext(); t.after(() => context.close());
  await context.addInitScript(({ cached }) => {
    localStorage.setItem('maydan:account:session', JSON.stringify('unit-session'));
    localStorage.setItem('maydan:account:me', JSON.stringify({ data: cached, fetchedAt: Date.now() }));
    window.nativeCalls = [];
    window.testUnfinished = false;
    window.MaydanNative = { postMessage(raw) {
      const message = JSON.parse(raw);
      window.nativeCalls.push(message);
      let result = {};
      if (message.type === 'getTrials') result = { marks: {} };
      if (message.type === 'pendingTransactions') result = { transactions: window.testUnfinished ? ['unit-replay-jws'] : [] };
      if (message.type === 'purchase') result = { jws: 'unit-purchase-jws' };
      if (message.type === 'restore') result = { transactions: ['unit-restore-jws'] };
      queueMicrotask(() => window.maydanNative.resolve(message.id, { ok: true, result }));
    } };
  }, { cached: { ...me(), serverTime: 0 } });
  const page = await context.newPage(); page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/*', (route) => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await page.goto(origin);
  await page.waitForFunction(() => window.testAccount?.me?.serverTime === 1 && window.nativeCalls.some((call) => call.type === 'pendingTransactions'));
  if (unfinished) await page.evaluate(() => {
    window.testUnfinished = true;
    window.dispatchEvent(new Event('online'));
  });
  return page;
}

for (const ready of [false, undefined, 'true']) test(`iOS blocks a new purchase for non-true readiness (${String(ready)})`, async (t) => {
  const page = await fresh(t, ready);
  await page.evaluate(() => window.testAccount.purchase('monthly'));
  await page.waitForFunction(() => window.testAccount.error === 'APPLE_PURCHASES_UNAVAILABLE');
  assert.match(await page.getByRole('alert').textContent(), /App Store غير متاح حاليًا/);
  assert.equal(configCalls, 1);
  assert.equal(await page.evaluate(() => window.nativeCalls.filter((call) => call.type === 'purchase').length), 0);
  assert.equal(deliveries, 0);
});

test('failed readiness request never opens StoreKit', async (t) => {
  const page = await fresh(t, true, { failed: true });
  await page.evaluate(() => window.testAccount.purchase('monthly'));
  await page.waitForFunction(() => window.testAccount.error === 'NETWORK');
  assert.equal(await page.evaluate(() => window.nativeCalls.filter((call) => call.type === 'purchase').length), 0);
  assert.equal(deliveries, 0);
});

test('configured iOS purchase proceeds and acknowledges only after delivery', async (t) => {
  const page = await fresh(t, true);
  let purchaseObserved = false;
  await page.exposeFunction('observeNativePurchase', () => { purchaseObserved = true; assert.equal(configCalls, 1); });
  await page.evaluate(() => {
    const original = window.MaydanNative.postMessage;
    window.MaydanNative.postMessage = (raw) => {
      if (JSON.parse(raw).type === 'purchase') window.observeNativePurchase();
      original(raw);
    };
  });
  await page.evaluate(() => window.testAccount.purchase('yearly'));
  await page.waitForFunction(() => window.testAccount.premium);
  const calls = await page.evaluate(() => window.nativeCalls);
  assert.equal(purchaseObserved, true);
  assert.deepEqual(calls.filter((call) => call.type === 'purchase').map(({ productId, userId }) => ({ productId, userId })), [{ productId: 'plus.yearly', userId }]);
  assert.equal(deliveries, 1);
  assert.equal(calls.filter((call) => call.type === 'finishTransaction').length, 1);
  readiness = false;
  await page.evaluate(() => window.testAccount.purchase('monthly'));
  await page.waitForFunction(() => window.testAccount.error === 'APPLE_PURCHASES_UNAVAILABLE');
  assert.equal(configCalls, 2, 'each new purchase must refresh readiness');
  assert.equal(await page.evaluate(() => window.nativeCalls.filter((call) => call.type === 'purchase').length), 1);
});

test('unavailable purchases do not prevent restoring an existing transaction', async (t) => {
  const page = await fresh(t, false);
  await page.evaluate(() => window.testAccount.restore());
  await page.waitForFunction(() => window.testAccount.premium);
  assert.equal(configCalls, 0);
  assert.equal(deliveries, 1);
  assert.equal(await page.evaluate(() => window.nativeCalls.filter((call) => call.type === 'finishTransaction').length), 1);
});

test('unavailable purchases do not prevent unfinished transaction replay', async (t) => {
  const page = await fresh(t, false, { unfinished: true });
  await page.waitForFunction(() => window.testAccount.premium && window.nativeCalls.some((call) => call.type === 'finishTransaction'));
  assert.equal(configCalls, 0);
  assert.equal(deliveries, 1);
});

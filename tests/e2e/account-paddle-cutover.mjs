// Real React browser checks with an in-memory bundle and a fake Paddle object.
// No production requests, real checkout, credentials, or shared dist writes.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('../../', import.meta.url));
let browser, server, origin;
let failMe = false, meSource = null, meCalls = 0, checkouts = 0, checkoutError = null;
const errors = [];
const me = (source) => ({ user: { id: 'browser-unit', name: 'اختبار' }, trials: {}, premium: {
  active: !!source, source, until: source ? Date.now() + 86400000 : 0, status: source ? 'active' : null, willRenew: source === 'paddle',
} });

before(async () => {
  const bundle = await build({ stdin: { resolveDir: root, loader: 'jsx', contents: `
    import React, { useEffect } from 'react';
    import { createRoot } from 'react-dom/client';
    import { AccountProvider } from './src/shared/account/AccountProvider.jsx';
    import { AccountCard } from './src/shared/account/AccountCard.jsx';
    import { Paywall } from './src/shared/account/Paywall.jsx';
    import { useAccount } from './src/shared/account/context.js';
    function View() {
      const account = useAccount();
      useEffect(() => { window.testAccount = account; }, [account]);
      return <><AccountCard /><Paywall open={account.paywall.open} onClose={account.closePaywall} /></>;
    }
    createRoot(document.getElementById('app')).render(<AccountProvider><View /></AccountProvider>);
  ` }, bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic',
    define: { __MAYDAN_ROOMS_URL__: JSON.stringify('same-origin') },
    loader: { '.js': 'jsx', '.css': 'text', '.webp': 'dataurl', '.png': 'dataurl', '.woff2': 'dataurl' }, logLevel: 'silent' });
  const html = `<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><body><div id="app"></div><script>${bundle.outputFiles[0].text}</script></body></html>`;
  server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const reply = (body, status = 200) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (pathname === '/api/me') { meCalls++; reply(failMe ? { error: 'NETWORK' } : me(meSource), failMe ? 503 : 200); return; }
    if (pathname === '/api/billing/config') { reply({ providers: { apple: true, google: true }, paddle: { environment: 'production', clientToken: 'live_unit', prices: { monthly: 'pri_month', yearly: '' } } }); return; }
    if (pathname === '/api/paddle/checkout') { checkouts++; reply(checkoutError ? { error: checkoutError } : { transactionId: 'txn_unit', clientToken: 'live_unit', environment: 'production' }, checkoutError ? 409 : 200); return; }
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

async function fresh(t, source, failed = false) {
  failMe = failed; meSource = null; meCalls = 0; checkouts = 0; checkoutError = null;
  const context = await browser.newContext(); t.after(() => context.close());
  await context.addInitScript(({ cached }) => {
    localStorage.setItem('maydan:account:session', JSON.stringify('unit-session'));
    localStorage.setItem('maydan:account:me', JSON.stringify({ data: cached, fetchedAt: Date.now() }));
    window.checkoutsOpened = [];
    window.paddleEnvironment = 'production'; // Paddle defaults to production; only sandbox uses Environment.set.
    window.Paddle = {
      Environment: { set(environment) { window.paddleEnvironment = environment; } },
      Initialize(options) { window.paddleCallback = options.eventCallback; },
      async PricePreview() { return { data: { details: { lineItems: [{ price: { id: 'pri_month', billingCycle: { interval: 'month' } }, formattedTotals: { total: '$5.00' } }] } } }; },
      Checkout: { open(options) { window.checkoutsOpened.push(options); } },
    };
  }, { cached: me(source) });
  const page = await context.newPage(); page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/*', (route) => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  const firstRefresh = page.waitForResponse((response) => response.url().endsWith('/api/me'));
  await page.goto(`${origin}/#/settings`);
  await page.waitForFunction(() => !!window.testAccount);
  await firstRefresh;
  return page;
}

test('recent cached sandbox access is refreshed on settings; only the live monthly plan is offered', async (t) => {
  const page = await fresh(t, 'paddle');
  await page.waitForFunction(() => window.testAccount.premium === false);
  assert.ok(meCalls > 0, 'a cache younger than ten minutes must still refresh');
  await page.getByRole('button', { name: 'اشترك في ميدان بلس' }).click();
  await page.waitForFunction(() => !!window.testAccount.products?.monthly?.price);
  assert.equal(await page.locator('[data-plan="monthly"]').count(), 1);
  assert.equal(await page.locator('[data-plan="yearly"]').count(), 0);
  assert.equal(await page.locator('[data-plan="monthly"]').getAttribute('aria-checked'), 'true');
  await page.getByRole('button', { name: 'اشترك', exact: true }).click();
  await page.waitForFunction(() => window.checkoutsOpened.length === 1);
  assert.equal(checkouts, 1);
  assert.equal(await page.evaluate(() => window.paddleEnvironment), 'production');
  assert.equal(await page.evaluate(() => window.testAccount.premium), false, 'opening checkout is not activation');
  await page.evaluate(() => window.paddleCallback({ name: 'checkout.closed' }));
});

test('purchase rechecks the server before a stale cached sandbox subscription can block live checkout', async (t) => {
  const page = await fresh(t, 'paddle', true);
  assert.equal(await page.evaluate(() => window.testAccount.premium), true);
  const before = meCalls; failMe = false;
  await page.evaluate(() => { window.testAccount.purchase('monthly'); });
  await page.waitForFunction(() => window.checkoutsOpened.length === 1);
  assert.ok(meCalls > before);
  assert.equal(checkouts, 1);
  assert.equal(await page.evaluate(() => window.testAccount.premium), false);
  await page.evaluate(() => window.paddleCallback({ name: 'checkout.closed' }));
});

for (const source of ['apple', 'promo']) test(`failed refresh preserves cached ${source} history and never opens checkout`, async (t) => {
  const page = await fresh(t, source, true);
  const before = meCalls;
  await page.evaluate(() => window.testAccount.purchase('monthly'));
  await page.waitForFunction(() => window.testAccount.error === 'NETWORK');
  assert.ok(meCalls > before);
  assert.equal(checkouts, 0);
  assert.equal(await page.evaluate(() => window.checkoutsOpened.length), 0);
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('maydan:account:me')).data.premium.source), source);
  assert.equal(await page.evaluate(() => window.testAccount.activationPending), false);
});

for (const code of ['CHECKOUT_PENDING', 'CHECKOUT_REVIEW']) test(`${code} explains the server hold without claiming payment or opening checkout`, async (t) => {
  const page = await fresh(t, null);
  checkoutError = code;
  await page.getByRole('button', { name: 'اشترك في ميدان بلس' }).click();
  await page.waitForFunction(() => !!window.testAccount.products?.monthly?.price);
  await page.getByRole('button', { name: 'اشترك', exact: true }).click();
  await page.waitForFunction((expected) => window.testAccount.error === expected && !window.testAccount.busy, code);
  assert.match(await page.locator('.paywall').getByRole('alert').textContent(), code === 'CHECKOUT_PENDING' ? /قيد المعالجة/ : /لمراجعتها/);
  assert.equal(await page.evaluate(() => window.checkoutsOpened.length), 0);
  assert.equal(await page.evaluate(() => window.testAccount.activationPending), false);
  assert.equal(await page.evaluate(() => window.testAccount.premium), false);
  assert.equal(await page.getByRole('button', { name: 'اشترك', exact: true }).isEnabled(), true);
  const support = page.getByRole('link', { name: 'التواصل مع الدعم' });
  assert.equal(await support.count(), code === 'CHECKOUT_REVIEW' ? 1 : 0);
  if (code === 'CHECKOUT_REVIEW') assert.match(await support.getAttribute('href'), /^mailto:/);
});

// Real React/Chromium regression for failed sign-in preflights. No provider login,
// production requests or shared dist writes. Run with node --test and CHROMIUM_PATH.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('../../', import.meta.url));
let browser, server, origin;
let mode = 'NETWORK';
let authStarts = 0;
let configRequests = 0;
const errors = [];

before(async () => {
  const bundle = await build({
    stdin: { resolveDir: root, loader: 'jsx', contents: `
      import React, { useEffect, useState } from 'react';
      import { createRoot } from 'react-dom/client';
      import { AccountProvider } from './src/shared/account/AccountProvider.jsx';
      import { useAccount } from './src/shared/account/context.js';
      import { SignInSheet } from './src/shared/account/SignInSheet.jsx';
      function View() {
        const [open, setOpen] = useState(true);
        const account = useAccount();
        useEffect(() => { window.testAccount = account; }, [account]);
        return <SignInSheet open={open} onClose={() => setOpen(false)} />;
      }
      createRoot(document.getElementById('app')).render(<AccountProvider><View /></AccountProvider>);
    ` },
    bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic',
    define: { __MAYDAN_ROOMS_URL__: JSON.stringify('same-origin') },
    loader: { '.js': 'jsx', '.css': 'text', '.webp': 'dataurl', '.png': 'dataurl', '.woff2': 'dataurl' },
    logLevel: 'silent',
  });
  const html = `<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><body><div id="app"></div><script>${bundle.outputFiles[0].text}</script></body></html>`;
  server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname === '/api/billing/config') {
      configRequests++;
      const status = mode === 'OK' || mode === 'PROVIDER_DISABLED' ? 200 : mode === 'NOT_FOUND' ? 404 : 503;
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(mode === 'NETWORK' ? 'not JSON' : JSON.stringify(mode === 'OK' || mode === 'PROVIDER_DISABLED'
        ? { providers: { apple: true, google: mode !== 'PROVIDER_DISABLED' }, paddle: null }
        : { error: mode }));
      return;
    }
    if (pathname.startsWith('/api/auth/')) {
      authStarts++;
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<p>OAuth navigation observed; no real provider contacted.</p>');
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(html);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
});

after(async () => {
  await browser?.close();
  if (server?.listening) await new Promise((resolve) => server.close(resolve));
  assert.deepEqual(errors, [], 'no uncaught browser errors');
});

async function fresh(t, nextMode) {
  mode = nextMode;
  authStarts = 0;
  configRequests = 0;
  const context = await browser.newContext();
  t.after(() => context.close());
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  // The production settings link may be displayed, but this test never opens it.
  await page.route('**/*', (route) => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await page.goto(`${origin}/#/settings`);
  await page.getByRole('button', { name: 'المتابعة بحساب Google' }).waitFor();
  return page;
}

for (const [failure, message] of [
  ['NETWORK', 'تعذّر الاتصال بالخادم.'],
  ['PREVIEW_ONLY', 'هذه معاينة محلية؛ تسجيل الدخول متاح في الموقع المنشور.'],
]) {
  test(`${failure}: failed preflight keeps the sign-in sheet and error visible without navigating`, async (t) => {
    const page = await fresh(t, failure);
    await page.getByRole('button', { name: 'المتابعة بحساب Google' }).click();
    const alert = page.getByRole('alert');
    await alert.waitFor();
    assert.equal(await alert.textContent(), message);
    assert.equal(page.url(), `${origin}/#/settings`);
    assert.equal(authStarts, 0);
    assert.equal(configRequests, 1);
    assert.equal(await page.locator('.account-signin').isVisible(), true);
    assert.equal(await page.getByRole('button', { name: 'المتابعة بحساب Google' }).isEnabled(), true);
    const link = page.getByRole('link', { name: 'فتح الموقع المنشور لتسجيل الدخول ↗' });
    assert.equal(await link.count(), failure === 'PREVIEW_ONLY' ? 1 : 0);
    if (failure === 'PREVIEW_ONLY') {
      assert.equal(await link.getAttribute('href'), 'https://maydan-game.mf103871.workers.dev/#/settings');
      assert.equal(await link.getAttribute('target'), '_blank');
      assert.equal(await link.getAttribute('rel'), 'noopener noreferrer');
    }
  });
}

test('a successful earlier config read does not bypass a later failed preflight', async (t) => {
  const page = await fresh(t, 'OK');
  await page.evaluate(() => window.testAccount.loadProducts());
  await page.waitForFunction(() => !!window.testAccount.billing);
  mode = 'NETWORK';
  await page.getByRole('button', { name: 'المتابعة بحساب Google' }).click();
  await page.getByRole('alert').waitFor();
  assert.equal(await page.getByRole('alert').textContent(), 'تعذّر الاتصال بالخادم.');
  assert.equal(page.url(), `${origin}/#/settings`);
  assert.equal(authStarts, 0);
  assert.equal(configRequests, 2);
  assert.equal(await page.locator('.account-signin').isVisible(), true);
});

test('a disabled account service leaves its explanation visible without redirecting', async (t) => {
  const page = await fresh(t, 'NOT_FOUND');
  await page.getByRole('button', { name: 'المتابعة بحساب Google' }).click();
  await page.getByRole('status').waitFor();
  assert.equal(await page.getByRole('status').textContent(), 'الحساب والاشتراك غير متاحين في هذه النسخة.');
  assert.equal(await page.locator('.account-signin').isVisible(), true);
  assert.equal(authStarts, 0);
  assert.equal(page.url(), `${origin}/#/settings`);
});

test('a provider disabled since the last config read cannot start OAuth', async (t) => {
  const page = await fresh(t, 'OK');
  await page.evaluate(() => window.testAccount.loadProducts());
  await page.waitForFunction(() => !!window.testAccount.billing);
  mode = 'PROVIDER_DISABLED';
  await page.getByRole('button', { name: 'المتابعة بحساب Google' }).click();
  await page.getByRole('alert').waitFor();
  assert.equal(await page.getByRole('alert').textContent(), 'تعذّر الاتصال بمزوّد الخدمة، جرّب لاحقًا.');
  assert.equal(await page.locator('.account-signin').isVisible(), true);
  assert.equal(await page.getByRole('button', { name: 'المتابعة بحساب Google' }).count(), 0);
  assert.equal(authStarts, 0);
  assert.equal(configRequests, 2);
  assert.equal(page.url(), `${origin}/#/settings`);
});

test('successful preflight still navigates to the selected provider start', async (t) => {
  const page = await fresh(t, 'OK');
  await Promise.all([
    page.waitForURL((url) => url.pathname === '/api/auth/google/start'),
    page.getByRole('button', { name: 'المتابعة بحساب Google' }).click(),
  ]);
  assert.equal(authStarts, 1);
  const target = new URL(page.url());
  assert.equal(target.searchParams.get('client'), 'web');
  assert.equal(target.searchParams.get('return'), `${origin}/`);
});

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
let holdConfig = false;
let pendingConfig = [];
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
      const respond = () => {
      const platformConfig = mode === 'PLATFORMS' || mode === 'PLATFORMS_NONE';
      const status = mode === 'OK' || mode === 'PROVIDER_DISABLED' || platformConfig ? 200 : mode === 'NOT_FOUND' ? 404 : 503;
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(mode === 'NETWORK' ? 'not JSON' : JSON.stringify(platformConfig ? {providers:{apple:true,google:true},providerPlatforms:{web:{apple:false,google:mode==='PLATFORMS'},ios:{apple:true,google:false}},paddle:null} : mode === 'OK' || mode === 'PROVIDER_DISABLED'
        ? { providers: { apple: true, google: mode !== 'PROVIDER_DISABLED' }, paddle: null }
        : { error: mode }));
      };
      if (holdConfig) pendingConfig.push(respond); else respond();
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
  pendingConfig.splice(0).forEach((respond) => respond());
  await browser?.close();
  if (server?.listening) await new Promise((resolve) => server.close(resolve));
  assert.deepEqual(errors, [], 'no uncaught browser errors');
});

async function fresh(t, nextMode, {native=false,hold=false}={}) {
  mode = nextMode;
  holdConfig = hold;
  pendingConfig = [];
  authStarts = 0;
  configRequests = 0;
  const context = await browser.newContext();
  t.after(() => context.close());
  if (native) await context.addInitScript(() => {
    window.nativeCalls=[];
    window.MaydanNative={postMessage(raw){
      const message=JSON.parse(raw); window.nativeCalls.push(message.type);
      const result=message.type==='getTrials'?{marks:{}}:message.type==='pendingTransactions'?{transactions:[]}:{};
      queueMicrotask(()=>window.maydanNative.resolve(message.id,message.type==='signInApple'?{ok:false,error:'PURCHASE_CANCELLED'}:{ok:true,result}));
    }};
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  // The production settings link may be displayed, but this test never opens it.
  await page.route('**/*', (route) => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await page.goto(`${origin}/#/settings`);
  await page.waitForFunction((held)=>window.testAccount && window.testAccount.signInProvidersStatus!=='idle' && (held || window.testAccount.signInProvidersStatus!=='loading'),hold);
  return page;
}

for (const [failure, message] of [
  ['NETWORK', 'تعذّر الاتصال بالخادم.'],
  ['PREVIEW_ONLY', 'هذه معاينة محلية؛ تسجيل الدخول متاح في الموقع المنشور.'],
]) {
  test(`${failure}: failed preflight keeps the sign-in sheet and error visible without navigating`, async (t) => {
    const page = await fresh(t, 'OK'); mode=failure;
    await page.getByRole('button', { name: 'المتابعة بحساب Google' }).click();
    const alert = page.getByRole('alert');
    await alert.waitFor();
    assert.equal(await alert.textContent(), message);
    assert.equal(page.url(), `${origin}/#/settings`);
    assert.equal(authStarts, 0);
    assert.equal(configRequests, 2);
    assert.equal(await page.locator('.account-signin').isVisible(), true);
    assert.equal(await page.getByRole('button', { name: 'إعادة محاولة تسجيل الدخول' }).isEnabled(), true);
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
  assert.equal(configRequests, 3);
  assert.equal(await page.locator('.account-signin').isVisible(), true);
});

test('a disabled account service leaves its explanation visible without redirecting', async (t) => {
  const page = await fresh(t, 'OK'); mode='NOT_FOUND';
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
  assert.equal(configRequests, 3);
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

test('platform-specific web availability controls rendering and blocks native-only Apple before OAuth',async(t)=>{
  const page=await fresh(t,'PLATFORMS');await page.evaluate(()=>window.testAccount.loadProducts());await page.waitForFunction(()=>!!window.testAccount.billing?.providerPlatforms);
  assert.equal(await page.locator('[data-provider="apple"]').count(),0);assert.equal(await page.locator('[data-provider="google"]').count(),1);
  await page.evaluate(()=>window.testAccount.signIn('apple'));await page.getByRole('alert').waitFor();assert.equal(authStarts,0);assert.equal(page.url(),`${origin}/#/settings`);
  await Promise.all([page.waitForURL(url=>url.pathname==='/api/auth/google/start'),page.getByRole('button',{name:'المتابعة بحساب Google'}).click()]);assert.equal(authStarts,1);assert.equal(new URL(page.url()).searchParams.get('client'),'web');
});

test('no configured web providers displays a status instead of unusable native-only sign-in buttons',async(t)=>{
  const page=await fresh(t,'PLATFORMS_NONE');await page.evaluate(()=>window.testAccount.loadProducts());await page.getByText('تسجيل الدخول غير متاح حاليًا. جرّب مجددًا بعد قليل.',{exact:true}).waitFor();
  assert.equal(await page.locator('[data-provider]').count(),0);assert.equal(authStarts,0);assert.equal(page.url(),`${origin}/#/settings`);
});

test('fresh native sheet deduplicates public capability loading and never opens unavailable Google or StoreKit',async(t)=>{
  const page=await fresh(t,'PLATFORMS',{native:true,hold:true});
  await page.getByText('نتحقق من طرق تسجيل الدخول…',{exact:true}).waitFor();
  assert.equal(await page.locator('[data-provider]').count(),0);
  await page.evaluate(()=>{window.pendingProviderChecks=Promise.all([window.testAccount.loadSignInProviders(),window.testAccount.loadSignInProviders(),window.testAccount.signIn('google')]);});
  assert.equal(configRequests,1);assert.equal(authStarts,0);
  assert.equal(await page.evaluate(()=>window.nativeCalls.some(type=>['openAuth','signInApple','products','purchase','restore'].includes(type))),false);
  holdConfig=false;pendingConfig.splice(0).forEach(respond=>respond());
  await page.evaluate(()=>window.pendingProviderChecks);
  assert.equal(await page.locator('[data-provider="google"]').count(),0);
  await page.getByRole('button',{name:'المتابعة بحساب Apple'}).click();
  await page.waitForFunction(()=>window.nativeCalls.includes('signInApple') && !window.testAccount.busy);
  assert.equal(configRequests,2,'native authorization refreshes capabilities before opening the system sheet');
  assert.equal(await page.evaluate(()=>window.nativeCalls.filter(type=>'signInApple'===type).length),1);
  assert.equal(await page.evaluate(()=>window.nativeCalls.some(type=>['openAuth','products','purchase','restore'].includes(type))),false);assert.equal(authStarts,0);
});

test('initial public capability failure offers a working retry without opening any provider',async(t)=>{
  const page=await fresh(t,'NETWORK');
  assert.equal(await page.locator('[data-provider]').count(),0);assert.equal(await page.getByRole('alert').textContent(),'تعذّر الاتصال بالخادم.');
  mode='PLATFORMS';await page.getByRole('button',{name:'إعادة محاولة تسجيل الدخول'}).click();
  await page.getByRole('button',{name:'المتابعة بحساب Google'}).waitFor();
  assert.equal(await page.locator('[data-provider="apple"]').count(),0);assert.equal(await page.getByRole('alert').count(),0);assert.equal(configRequests,2);assert.equal(authStarts,0);
  await page.evaluate(()=>Promise.all([window.testAccount.loadSignInProviders(),window.testAccount.loadSignInProviders()]));assert.equal(configRequests,2,'short public cache avoids repeated sheet requests');
});

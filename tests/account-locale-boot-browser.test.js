// Real AccountProvider + actual asynchronous English pack. Only account HTTP
// data is a local intercepted fixture; no live account, provider or API writes.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { build } from 'esbuild';
import { chromium, webkit } from 'playwright';
import { localePackagingPlugin } from '../scripts/lib/locale-packaging.mjs';

const ORIGIN = 'https://maydan-mafia-preview.mf103871.workers.dev';
const owner = '11111111-1111-4111-8111-111111111111';
const me = { user: { id: owner, name: 'Fixture account' }, premium: { active: false, until: 0 }, trials: { beep: true } };
let compiled;
const fixtureApp = () => compiled ||= build({ stdin: { contents: `
import React,{useState,useLayoutEffect,useEffect}from'react';import{createRoot}from'react-dom/client';
import{AccountProvider}from'./src/shared/account/AccountProvider.jsx';import{useAccount}from'./src/shared/account/context.js';
import{PlatformContext}from'./src/platform/context.js';import{useI18n}from'./src/shared/i18n/react.jsx';import{setUiLocale}from'./src/shared/i18n/core.js';
window.fixture={mounts:0};
function Probe(){const account=useAccount(),{locale,localeStatus}=useI18n();window.fixture.account=account;
useEffect(()=>{window.fixture.mounts++;return()=>{window.fixture.unmounts=(window.fixture.unmounts||0)+1}},[]);
return <><output data-testid="locale">{locale}:{localeStatus.loading?'loading':'ready'}</output><input aria-label="unsent draft" defaultValue=""/></>}
function App(){const[uiLocale,setLocale]=useState(()=>localStorage.getItem('fixture-locale')||new URL(location.href).searchParams.get('initial'));
window.fixture.chooseLocale=value=>{localStorage.setItem('fixture-locale',value);setLocale(value)};
useLayoutEffect(()=>{setUiLocale(uiLocale)},[uiLocale]);
const platform={settings:{uiLocale},toast:()=>{}};
return <PlatformContext.Provider value={platform}><AccountProvider><Probe/></AccountProvider></PlatformContext.Provider>}
createRoot(document.getElementById('root')).render(<App/>);`, loader: 'jsx', resolveDir: process.cwd() }, bundle: true, write: false,
format: 'iife', jsx: 'automatic', outdir: 'work/account-locale-boot', assetNames: 'assets/[name]-[hash]',
loader: { '.js': 'jsx', '.css': 'text', '.webp': 'dataurl', '.woff2': 'dataurl' }, plugins: [localePackagingPlugin()], logLevel: 'silent',
define: { __MAYDAN_ROOMS_URL__: JSON.stringify(ORIGIN), __MAYDAN_AUDIO_PREVIEW__: 'false' } });

for (const [engineName, engine] of [['chromium', chromium], ['webkit', webkit]]) for (const initial of ['en', 'ar']) {
  test(`${engineName}: ${initial} cold account banner follows delayed English without remounting account state; Arabic persists`, { timeout: 60000 }, async () => {
    const built = await fixtureApp(), js = built.outputFiles.find(file => file.path.endsWith('.js')).contents;
    const assets = new Map(built.outputFiles.filter(file => file.path.endsWith('.json')).map(file => [path.basename(file.path), file.contents]));
    const browser = await engine.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: initial === 'en' ? 'en-US' : 'ar-JO' });
    let release; const englishAllowed = new Promise(resolve => { release = resolve; });
    const errors = [], requests = [], external = []; let pendingEnglish = 0;
    try {
      await context.route('**/*', async route => {
        const request = route.request(), url = new URL(request.url());
        if (url.origin !== ORIGIN) { external.push(url.origin); return route.abort(); }
        requests.push({ path: url.pathname, method: request.method() });
        if (url.pathname === '/') return route.fulfill({ contentType: 'text/html;charset=utf-8', body: '<!doctype html><meta charset="utf-8"><div id="root"></div><script src="/bundle.js"></script>' });
        if (url.pathname === '/bundle.js') return route.fulfill({ contentType: 'text/javascript', body: Buffer.from(js) });
        const pack = assets.get(path.basename(url.pathname));
        if (pack) { pendingEnglish++; await englishAllowed; return route.fulfill({ contentType: 'application/json', body: Buffer.from(pack) }); }
        const body = url.pathname === '/api/me' ? me : url.pathname === '/api/billing/config' ? { providers: {}, apple: {}, gameplay: { access: 'free' } } : { error: 'NOT_FOUND' };
        return route.fulfill({ status: body.error ? 404 : 200, contentType: 'application/json', body: JSON.stringify(body) });
      });
      await context.addInitScript(({ origin, me }) => {
        const prefix = 'maydan:environment:' + encodeURIComponent(origin) + ':account:';
        localStorage.setItem(prefix + 'session', JSON.stringify('local-fixture-token'));
        localStorage.setItem(prefix + 'me', JSON.stringify({ data: me, fetchedAt: Date.now() }));
      }, { origin: ORIGIN, me });
      const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
      await page.goto(`${ORIGIN}/?initial=${initial}`); await page.waitForFunction(() => window.fixture?.account?.ready);
      await page.evaluate(() => window.fixture.account.loadSignInProviders());
      const banner = page.locator('[data-design-fixed="isolated-test-environment"]');
      const snapshot = () => page.evaluate(() => ({ owner: window.fixture.account.user?.id, premium: window.fixture.account.premium,
        trials: window.fixture.account.trials, paywall: window.fixture.account.paywall, mounts: window.fixture.mounts, unmounts: window.fixture.unmounts || 0 }));
      await page.getByRole('textbox', { name: 'unsent draft' }).fill('Keep my unsent draft');
      await page.evaluate(() => window.fixture.account.openPaywall({ reason: 'cosmetics' }));
      await page.waitForFunction(() => window.fixture.account.paywall.open);
      const before = await snapshot(); assert.equal(before.owner, owner); assert.equal(before.paywall.open, true);
      if (initial === 'ar') {
        assert.match(await banner.innerText(), /بيئة اختبار مافيا/); assert.equal(pendingEnglish, 0);
        await page.evaluate(() => window.fixture.chooseLocale('en'));
      }
      await page.waitForFunction(() => document.querySelector('[data-testid="locale"]').textContent === 'ar:loading');
      assert.equal(pendingEnglish, 1); assert.equal(await banner.count(), 0, 'English first boot must not flash a stale Arabic preview banner');
      release(); await page.waitForFunction(() => document.documentElement.lang === 'en');
      assert.equal(await banner.innerText(), 'Mafia test environment\nAccounts and tests are separate from the main Maydan app. Use a test account.');
      assert.deepEqual(await snapshot(), before, 'locale completion must not reset account, entitlement or paywall state');
      assert.equal(await page.getByRole('textbox', { name: 'unsent draft' }).inputValue(), 'Keep my unsent draft');
      await page.evaluate(() => window.fixture.chooseLocale('ar')); await page.getByText('بيئة اختبار مافيا', { exact: true }).waitFor();
      assert.match(await banner.innerText(), /بيئة اختبار مافيا/); assert.deepEqual(await snapshot(), before);
      assert.equal(await page.getByRole('textbox', { name: 'unsent draft' }).inputValue(), 'Keep my unsent draft');
      const packsBeforeReload = pendingEnglish; await page.reload(); await page.waitForFunction(() => window.fixture?.account?.ready);
      assert.equal(await page.locator('[data-testid="locale"]').innerText(), 'ar:ready'); assert.match(await banner.innerText(), /بيئة اختبار مافيا/);
      assert.equal(pendingEnglish, packsBeforeReload, 'retained Arabic must not fetch the English pack');
      assert.ok(requests.every(request => request.method === 'GET')); assert.deepEqual(errors, []); assert.deepEqual(external, []);
    } finally { release(); await context.close(); await browser.close(); }
  });
}

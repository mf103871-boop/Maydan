// Isolated UI lifecycle regression. Every HTTP/SDK response is a local fixture.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const A = `ctm_${'a'.repeat(26)}`, B = `ctm_${'b'.repeat(26)}`, C = `ctm_${'c'.repeat(26)}`;
const SESSION = id => `mdn1.${id.repeat(16)}.${id.repeat(32)}`;
const me = (id, customerId) => ({ user: { id, name: id }, premium: { active: false, until: 0 }, trials: {}, paddle: { environment: 'production', customerId } });
const bundle = await build({ stdin: { resolveDir: process.cwd(), contents: `
  import React from 'react'; import {createRoot} from 'react-dom/client';
  import {AccountProvider} from './src/shared/account/AccountProvider.jsx';
  import {useAccount} from './src/shared/account/context.js';
  function Probe(){const account=useAccount();window.account=account;return React.createElement('p',{id:'identity'},account.user?.id||'guest');}
  createRoot(document.getElementById('root')).render(React.createElement(AccountProvider,null,React.createElement(Probe)));
` }, bundle: true, write: false, jsx: 'automatic', loader: { '.js': 'jsx', '.webp': 'dataurl', '.woff2': 'dataurl' },
  define: { 'process.env.NODE_ENV': '"production"', __MAYDAN_ROOMS_URL__: '"same-origin"' }, logLevel: 'silent' });
const html = `<div id="root"></div><script>${bundle.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')}</script>`;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
try {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  let queuedMe = [], holdMe = true, holdLogout = true, logoutRoute, checkoutCalls = 0;
  const errors = [];
  await context.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url());
    const json = body => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.origin !== 'https://maydan.fixture') throw new Error('External requests forbidden');
    if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: html });
    if (url.pathname === '/api/me') {
      if (holdMe) { queuedMe.push(route); return; }
      return json(req.headers().authorization.includes(SESSION('c')) ? me('c', C) : me('b', B));
    }
    if (url.pathname === '/api/billing/config') return json({ paddle: { environment: 'production', clientToken: 'live_local_fixture', checkoutEnabled: false, prices: {} } });
    if (url.pathname === '/api/auth/signout') { if (holdLogout) { logoutRoute = route; return; } return route.fulfill({ status: 204 }); }
    if (url.pathname === '/api/auth/exchange') return json({ session: { token: SESSION('b') }, me: me('b', B) });
    if (url.pathname === '/api/paddle/checkout') { checkoutCalls++; throw new Error('Checkout must stay gated'); }
    throw new Error(`Unexpected fixture endpoint ${url.pathname}`);
  });
  await context.addInitScript(({ session, cached }) => {
    localStorage.setItem('maydan:account:session', JSON.stringify(session));
    localStorage.setItem('maydan:account:me', JSON.stringify({ data: cached, fetchedAt: Date.now() }));
    window.sdkCalls = [];
    window.Paddle = { Initialized: false,
      Initialize(options) { if (this.Initialized) throw new Error('Initialized twice'); this.Initialized = true; window.sdkCalls.push({ type: 'init', customer: options.pwCustomer }); },
      Update(options) { window.sdkCalls.push({ type: 'update', customer: options.pwCustomer }); },
      Environment: { set() { throw new Error('Live must use the default environment'); } },
      Checkout: { open() { throw new Error('No checkout allowed'); }, close() {} },
    };
  }, { session: SESSION('a'), cached: me('cached-profile', B) });
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.goto('https://maydan.fixture/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.account);
  assert.equal((await page.evaluate(() => window.sdkCalls)).length, 0, 'cached customer never initializes Retain');
  const waitQueued = async () => { for (let i = 0; i < 100 && !queuedMe.length; i++) await new Promise(resolve => setTimeout(resolve, 10)); assert.ok(queuedMe.length); return queuedMe.shift(); };
  await (await waitQueued()).fulfill({ contentType: 'application/json', body: JSON.stringify(me('a', A)) });
  await page.waitForFunction(id => window.sdkCalls.some(call => call.customer.id === id), A);
  await page.evaluate(() => { window.pendingRefresh = window.account.refresh(); });
  const stale = await waitQueued();
  await page.evaluate(() => { window.pendingLogout = window.account.signOut(); });
  await page.waitForFunction(() => !window.account.user && window.sdkCalls.at(-1).customer.id === undefined);
  await stale.fulfill({ contentType: 'application/json', headers: { 'x-maydan-session': SESSION('a') }, body: JSON.stringify(me('a', A)) });
  await page.evaluate(() => window.pendingRefresh);
  assert.equal(await page.evaluate(() => localStorage.getItem('maydan:account:session')), null);
  assert.equal(await page.locator('#identity').innerText(), 'guest');
  for (let i = 0; i < 100 && !logoutRoute; i++) await new Promise(resolve => setTimeout(resolve, 10));
  await logoutRoute.fulfill({ status: 204 }); await page.evaluate(() => window.pendingLogout);
  holdMe = false; holdLogout = false;
  await page.evaluate(() => { location.hash = '/auth?code=' + 'a'.repeat(48); });
  await page.waitForFunction(id => window.account.user?.id === 'b' && window.sdkCalls.at(-1).customer.id === id, B);
  holdMe = true;
  await page.evaluate(() => { window.pendingOldAccount = window.account.refresh(); });
  const oldAccount = await waitQueued();
  holdMe = false;
  await page.evaluate(token => { localStorage.setItem('maydan:account:session', JSON.stringify(token)); window.dispatchEvent(new StorageEvent('storage', { key: 'maydan:account:session' })); }, SESSION('c'));
  await page.waitForFunction(id => window.account.user?.id === 'c' && window.sdkCalls.at(-1).customer.id === id, C);
  await oldAccount.fulfill({ contentType: 'application/json', headers: { 'x-maydan-session': SESSION('b') }, body: JSON.stringify(me('b', B)) });
  await page.evaluate(() => window.pendingOldAccount);
  assert.equal(await page.locator('#identity').innerText(), 'c');
  assert.equal(await page.evaluate(() => window.sdkCalls.filter(call => call.type === 'init').length), 1);
  await page.evaluate(() => window.account.purchase('monthly'));
  assert.equal(await page.evaluate(() => window.account.error), 'CHECKOUT_DISABLED');
  assert.equal(checkoutCalls, 0);
  assert.deepEqual(errors, []);
  console.log('PASS: verified me only; immediate logout; stale me/rotation ignored; login/account switch updates Retain once; disabled checkout sends no transaction request');
  await context.close();
} finally { await browser.close(); }

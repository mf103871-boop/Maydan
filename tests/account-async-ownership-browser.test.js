// Actual AccountProvider and native JS bridge; HTTP/native replies are deferred
// synthetic fixtures. This does not contact Apple, Paddle or a real account.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { chromium, webkit } from 'playwright';

const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222', C = '33333333-3333-4333-8333-333333333333';
const me = (id, active = false) => ({ user: { id, name: id === A ? 'ألف' : id === B ? 'باء' : 'جيم' }, premium: { active, until: active ? Date.now() + 86400000 : 0, source: active ? 'apple' : null }, trials: {} });
const accountFor = token => token?.includes('token-B') ? B : token?.includes('token-C') ? C : A;
const json = (response, body, status = 200) => { response.writeHead(status, { 'content-type': 'application/json' }); response.end(JSON.stringify(body)); };
const settle = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));

test('Chromium/WebKit: deferred authentication, billing and native transactions remain with their initiating account', { timeout: 120000 }, async t => {
  const built = await build({ stdin: { contents: `import React from'react';import{createRoot}from'react-dom/client';import{AccountProvider}from'./src/shared/account/AccountProvider.jsx';import{useAccount}from'./src/shared/account/context.js';import{PlatformContext}from'./src/platform/context.js';import{navigate}from'./src/platform/router.js';
    const platform={toast:value=>window.toasts.push(value)};window.toasts=[];window.go=navigate;
    function Probe(){const account=useAccount();window.account=account;window.snapshot=()=>({user:account.user?.id,signedIn:account.signedIn,premium:account.premium,busy:account.busy,error:account.error,me:account.me,activationPending:account.activationPending});return <output>{account.user?.id||'guest'}</output>}
    window.jobs=[];window.begin=(method,...args)=>{const index=window.jobs.push({done:false})-1;Promise.resolve(window.account[method](...args)).then(value=>window.jobs[index]={done:true,value},error=>window.jobs[index]={done:true,error:error.code||error.message});return index};
    createRoot(document.getElementById('root')).render(<PlatformContext.Provider value={platform}><AccountProvider><Probe/></AccountProvider></PlatformContext.Provider>);`, loader: 'jsx', resolveDir: process.cwd() }, bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.js': 'jsx', '.css': 'text', '.webp': 'dataurl', '.woff2': 'dataurl' }, logLevel: 'silent', define: { __MAYDAN_ROOMS_URL__: JSON.stringify('same-origin'), __MAYDAN_AUDIO_PREVIEW__: 'false' } });
  let fixture;
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname === '/bundle.js') { response.writeHead(200, { 'content-type': 'text/javascript' }); response.end(built.outputFiles[0].contents); return; }
    if (!url.pathname.startsWith('/api/')) { response.writeHead(200, { 'content-type': 'text/html' }); response.end(url.pathname === '/blank' ? '<!doctype html><title>storage peer</title>' : '<!doctype html><div id="root"></div><script src="/bundle.js"></script>'); return; }
    const body = []; for await (const chunk of request) body.push(chunk);
    const token = request.headers.authorization || '';
    const record = { path: url.pathname, token, body: body.length ? JSON.parse(Buffer.concat(body).toString()) : null, response };
    fixture.requests.push(record);
    if (fixture.hold.some(rule => rule.path === record.path && (!rule.token || token === `Bearer ${rule.token}`))) { fixture.pending.push(record); return; }
    if (record.path === '/api/me') json(response, me(accountFor(token)));
    else if (record.path === '/api/billing/config') json(response, { providers: { apple: true, google: true }, apple: { purchasesConfigured: true } });
    else if (record.path === '/api/apple/transactions') json(response, me(accountFor(token), true));
    else if (record.path === '/api/trials/merge') json(response, { trials: {} });
    else if (record.path === '/api/auth/exchange') json(response, { session: { token: 'token-C' }, me: me(C) });
    else if (record.path === '/api/auth/signout') { response.writeHead(204); response.end(); }
    else json(response, { error: 'NOT_FOUND' }, 404);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`, prefix = `maydan:environment:${encodeURIComponent(origin)}:account:`;
  try {
    for (const [engineName, engine] of [['chromium', chromium], ['webkit', webkit]]) {
      const browser = await engine.launch({ headless: true });
      try {
        const run = async (name, options, execute) => t.test(`${engineName}: ${name}`, async () => {
          fixture = { requests: [], pending: [], hold: options.hold || [] };
          const context = await browser.newContext();
          const errors = [], external = [];
          try {
            await context.route('**/*', route => { if (route.request().url().startsWith(origin)) return route.continue(); external.push(route.request().url()); return route.abort(); });
            await context.addInitScript(({ prefix, initialMe, native, held, pendingOnFirst }) => {
              if (!localStorage.getItem(prefix + 'session')) { localStorage.setItem(prefix + 'session', JSON.stringify('token-A')); localStorage.setItem(prefix + 'me', JSON.stringify({ data: initialMe, fetchedAt: Date.now() })); }
              window.nativeCalls = []; window.heldNative = []; window.nativeHeldTypes = new Set(held); window.nativePendingCount = 0;
              window.unhandled = []; window.addEventListener('unhandledrejection', event => window.unhandled.push(String(event.reason)));
              if (native) window.MaydanNative = { postMessage: raw => {
                const message = JSON.parse(raw); window.nativeCalls.push(message);
                if (window.nativeHeldTypes.has(message.type)) { window.heldNative.push(message); return; }
                let result = {};
                if (message.type === 'socialSession') result = { userId: message.userId, token: message.token };
                if (message.type === 'getTrials') result = { marks: {} };
                if (message.type === 'products') result = { products: [{ id: 'plus.monthly', price: '$1.99' }, { id: 'plus.yearly', price: '$19.99' }] };
                if (message.type === 'pendingTransactions') result = { transactions: pendingOnFirst && window.nativePendingCount++ === 0 ? ['receipt-A'] : [] };
                if (message.type === 'purchase') result = { jws: 'receipt-A' };
                if (message.type === 'restore') result = { transactions: ['receipt-A'] };
                queueMicrotask(() => window.maydanNative.resolve(message.id, message.type === 'openAuth' ? { ok: false, error: 'NETWORK' } : { ok: true, result }));
              } };
            }, { prefix, initialMe: me(A), native: options.native !== false, held: options.held || [], pendingOnFirst: options.pendingOnFirst || false });
            const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
            await page.goto(origin); await page.waitForFunction(id => window.account?.ready && window.account?.user?.id === id, A);
            const peer = await context.newPage(); await peer.goto(origin + '/blank');
            const switchToB = async () => { await peer.evaluate(prefix => localStorage.setItem(prefix + 'session', JSON.stringify('token-B')), prefix); await page.waitForFunction(id => window.account?.user?.id === id, B); };
            const begin = (method, ...args) => page.evaluate(({ method, args }) => window.begin(method, ...args), { method, args });
            const done = async job => { await page.waitForFunction(job => window.jobs[job]?.done, job); await settle(page); return page.evaluate(job => window.jobs[job], job); };
            const pending = async (url, token = 'token-A') => { const authorization = token ? `Bearer ${token}` : ''; await assertEventually(() => fixture.pending.some(item => item.path === url && item.token === authorization)); return fixture.pending.find(item => item.path === url && item.token === authorization); };
            const reply = async (record, body, status) => { const received = page.waitForResponse(response => new URL(response.url()).pathname === record.path); json(record.response, body, status); await (await received).finished(); await settle(page); };
            const nativeResult = async (type, result, index = 0) => { await page.waitForFunction(({ type, index }) => window.heldNative.filter(item => item.type === type).length > index, { type, index }); await page.evaluate(({ type, result, index }) => { const request = window.heldNative.filter(item => item.type === type)[index]; window.maydanNative.resolve(request.id, { ok: true, result }); }, { type, result, index }); await settle(page); };
            const assertB = async () => { const state = await page.evaluate(() => window.snapshot()); assert.equal(state.user, B); assert.equal(state.signedIn, true); assert.equal(state.premium, false); assert.equal(state.error, null); };
            await execute({ page, begin, done, pending, reply, switchToB, nativeResult, assertB });
            assert.deepEqual(errors, []); assert.deepEqual(external, []); assert.deepEqual(await page.evaluate(() => window.unhandled), []);
          } finally { for (const item of fixture.pending) if (!item.response.writableEnded) item.response.destroy(); await context.close(); }
        });

        await run('old redeem401 cannot log out the replacement account', { native: false, hold: [{ path: '/api/redeem' }] }, async ({ begin, done, pending, reply, switchToB, assertB }) => {
          const job = await begin('redeem', 'fixture-code'), request = await pending('/api/redeem'); await switchToB(); await reply(request, { error: 'AUTH_REQUIRED' }, 401); await done(job); await assertB();
        });
        await run('a confirmation captured for A cannot delete the current B account', { native: false }, async ({ begin, done, switchToB, assertB }) => {
          await switchToB(); const job = await begin('deleteAccount', A); assert.equal((await done(job)).value, false); assert.equal(fixture.requests.filter(item => item.path === '/api/account').length, 0); await assertB();
        });
        await run('old billing portal cannot navigate the replacement account', { native: false, hold: [{ path: '/api/paddle/portal' }] }, async ({ page, begin, done, pending, reply, switchToB, assertB }) => {
          const job = await begin('manageSubscription'), request = await pending('/api/paddle/portal'); await switchToB(); await reply(request, { url: origin + '/portal-A' }); await done(job); assert.equal(new URL(page.url()).pathname, '/'); await assertB();
        });
        await run('late native restore list never claims with the new account token', { held: ['restore'] }, async ({ page, begin, done, nativeResult, switchToB, assertB }) => {
          const job = await begin('restore'); await page.waitForFunction(() => window.heldNative.some(item => item.type === 'restore')); await switchToB(); await nativeResult('restore', { transactions: ['receipt-A'] }); await done(job); assert.equal(fixture.requests.filter(item => item.path === '/api/apple/transactions').length, 0); await assertB();
        });
        for (const method of ['restore', 'purchase']) for (const status of [200, 401]) await run(`${method}: late server ${status} cannot apply A's premium or finish after replacement`, { hold: [{ path: '/api/apple/transactions' }] }, async ({ page, begin, done, pending, reply, switchToB, assertB }) => {
          if (method === 'purchase') await page.evaluate(() => window.account.loadProducts());
          const job = await begin(method), request = await pending('/api/apple/transactions'); await switchToB(); await reply(request, status === 200 ? me(A, true) : { error: 'AUTH_REQUIRED' }, status); await done(job); await assertB(); assert.equal(await page.evaluate(() => window.nativeCalls.filter(item => item.type === 'finishTransaction').length), 0);
        });
        await run('late native purchase result never submits under B', { held: ['purchase'] }, async ({ page, begin, done, nativeResult, switchToB, assertB }) => {
          await page.evaluate(() => window.account.loadProducts()); const job = await begin('purchase'); await page.waitForFunction(() => window.heldNative.some(item => item.type === 'purchase')); await switchToB(); await nativeResult('purchase', { jws: 'receipt-A' }); await done(job); assert.equal(fixture.requests.filter(item => item.path === '/api/apple/transactions').length, 0); await assertB();
        });
        await run('late observer401 cannot clear B', { hold: [{ path: '/api/apple/transactions' }] }, async ({ page, pending, reply, switchToB, assertB }) => {
          await page.evaluate(() => window.maydanNative.event('transaction', { jws: 'receipt-A' })); const request = await pending('/api/apple/transactions'); await switchToB(); await reply(request, { error: 'AUTH_REQUIRED' }, 401); await assertB();
        });
        await run('a mismatched global transaction arriving under B is not acknowledged as credited', { hold: [{ path: '/api/apple/transactions', token: 'token-B' }] }, async ({ page, pending, reply, switchToB, assertB }) => {
          await switchToB(); await page.evaluate(() => window.maydanNative.event('transaction', { jws: 'receipt-A' })); const request = await pending('/api/apple/transactions', 'token-B'); await reply(request, { error: 'ALREADY_LINKED' }, 409); await assertB(); assert.equal(await page.evaluate(() => window.nativeCalls.filter(item => item.type === 'finishTransaction').length), 0);
        });
        await run('late pendingTransactions reply is canceled before any claim', { held: ['pendingTransactions'] }, async ({ page, nativeResult, switchToB, assertB }) => {
          await page.waitForFunction(() => window.heldNative.some(item => item.type === 'pendingTransactions')); await switchToB(); await nativeResult('pendingTransactions', { transactions: ['receipt-A'] }); assert.equal(fixture.requests.filter(item => item.path === '/api/apple/transactions').length, 0); await assertB();
        });
        for (const status of [200, 401]) await run(`late replay ${status} cannot replace B or acknowledge A`, { pendingOnFirst: true, hold: [{ path: '/api/apple/transactions' }] }, async ({ page, pending, reply, switchToB, assertB }) => {
          const request = await pending('/api/apple/transactions'); await switchToB(); await reply(request, status === 200 ? me(A, true) : { error: 'AUTH_REQUIRED' }, status); await assertB(); assert.equal(await page.evaluate(() => window.nativeCalls.filter(item => item.type === 'finishTransaction').length), 0);
        });
        await run('late acknowledgment completion cannot toast or alter B after A was verified', { held: ['finishTransaction'] }, async ({ page, begin, done, switchToB, nativeResult, assertB }) => {
          await page.evaluate(() => window.account.loadProducts()); const job = await begin('purchase'); await page.waitForFunction(() => window.heldNative.some(item => item.type === 'finishTransaction')); await switchToB(); await nativeResult('finishTransaction', {}); await done(job); await assertB(); assert.equal(await page.evaluate(() => window.toasts.some(value => value.includes('فُعِّل'))), false);
        });
        await run('late authenticated data is rejected instead of escaping to a new owner', { native: false, hold: [{ path: '/api/deferred' }] }, async ({ begin, done, pending, reply, switchToB, assertB }) => {
          const job = await begin('requestAuthenticated', '/api/deferred'), request = await pending('/api/deferred'); await switchToB(); await reply(request, { privateOwner: A }); const result = await done(job); assert.equal(result.error, 'STALE_ACCOUNT'); assert.equal(result.value, undefined); await assertB();
        });
        await run('same-account native token rotation preserves an authorized purchase', { held: ['purchase'] }, async ({ page, begin, done, nativeResult }) => {
          await page.evaluate(() => window.account.loadProducts()); const job = await begin('purchase'); await page.waitForFunction(() => window.heldNative.some(item => item.type === 'purchase')); await page.evaluate(id => window.maydanNative.event('socialSessionRotated', { userId: id, previousToken: 'token-A', token: 'token-A2' }), A); await nativeResult('purchase', { jws: 'receipt-A' }); await done(job); assert.equal(await page.evaluate(() => window.snapshot().premium), true); const claim = fixture.requests.find(item => item.path === '/api/apple/transactions'); assert.equal(claim.token, 'Bearer token-A2'); assert.equal(await page.evaluate(() => window.nativeCalls.filter(item => item.type === 'finishTransaction').length), 1);
        });
        await run('old auth exchange cannot force navigation after the user leaves auth', { native: false, hold: [{ path: '/api/auth/exchange' }] }, async ({ page, pending, reply }) => {
          await page.evaluate(() => window.go('/auth?code=fixture')); const request = await pending('/api/auth/exchange', ''); await page.evaluate(() => window.go('/settings')); await page.waitForFunction(() => location.hash === '#/settings'); await reply(request, { session: { token: 'token-C' }, me: me(C) }); assert.equal(new URL(page.url()).hash, '#/settings');
        });
        await run('old auth exchange401 cannot clear B or its newer route', { native: false, hold: [{ path: '/api/auth/exchange' }] }, async ({ page, pending, reply, switchToB, assertB }) => {
          await page.evaluate(() => window.go('/auth?code=fixture')); const request = await pending('/api/auth/exchange', ''); await switchToB(); await page.evaluate(() => window.go('/settings')); await reply(request, { error: 'AUTH_REQUIRED' }, 401); await assertB(); assert.equal(new URL(page.url()).hash, '#/settings');
        });
        await run('late native Apple identity never exchanges or adopts after account replacement', { held: ['signInApple'] }, async ({ page, begin, done, nativeResult, switchToB, assertB }) => {
          const job = await begin('signIn', 'apple'); await page.waitForFunction(() => window.heldNative.some(item => item.type === 'signInApple')); await switchToB(); await nativeResult('signInApple', { identityToken: 'synthetic-A-identity' }); await done(job); assert.equal(fixture.requests.filter(item => item.path === '/api/auth/apple/native').length, 0); await assertB();
        });
        await run('native login response headers cannot adopt a new token before its principal body', {}, async ({ page, begin, done }) => {
          // WebKit's routed HTTP adapter can buffer a streaming response. Keep
          // the actual API client but control this response's body explicitly.
          await page.evaluate(() => {
            const actualFetch = window.fetch;
            window.fetch = (input, options) => new URL(input, location.href).pathname !== '/api/auth/apple/native' ? actualFetch(input, options) : Promise.resolve(new Response(new ReadableStream({ start(controller) { window.loginBody = controller; } }), { status: 200, headers: { 'content-type': 'application/json', 'x-maydan-session': 'token-C' } }));
          });
          const job = await begin('signIn', 'apple'); await page.waitForFunction(() => Boolean(window.loginBody)); await settle(page);
          assert.equal(await page.evaluate(() => window.account.authHeaders().Authorization), 'Bearer token-A');
          assert.equal(await page.evaluate(() => window.snapshot().user), A);
          await page.evaluate(body => { window.loginBody.enqueue(new TextEncoder().encode(body)); window.loginBody.close(); }, JSON.stringify({ session: { token: 'token-C' }, me: me(C) })); await done(job);
          assert.equal(await page.evaluate(() => window.snapshot().user), C);
          assert.equal(await page.evaluate(() => window.account.authHeaders().Authorization), 'Bearer token-C');
        });
        await run('auth tail trial merge cannot overwrite replacement trials or toast old user', { native: false, hold: [{ path: '/api/trials/merge', token: 'token-C' }] }, async ({ page, pending, reply, switchToB, assertB }) => {
          await page.evaluate(prefix => { localStorage.setItem(prefix + 'trials', JSON.stringify({ marks: { beep: true }, pending: ['beep'] })); window.go('/auth?code=fixture'); }, prefix); const request = await pending('/api/trials/merge', 'token-C'); await switchToB(); await reply(request, { trials: { beep: true, mafia: true } }); await assertB(); assert.deepEqual(await page.evaluate(() => window.snapshot().me.trials), {}); assert.equal(await page.evaluate(() => window.toasts.some(value => value.includes('جيم'))), false);
        });
        await run('old signout completion cannot clear a newer restore busy state', { held: ['socialLogout', 'restore'] }, async ({ page, begin, done, nativeResult, switchToB, assertB }) => {
          const job = await begin('signOut'); await page.waitForFunction(() => window.heldNative.some(item => item.type === 'socialLogout')); await switchToB(); await begin('restore'); await page.waitForFunction(() => window.heldNative.some(item => item.type === 'restore')); await nativeResult('socialLogout', {}); await done(job); await assertB(); assert.equal(await page.evaluate(() => window.snapshot().busy), 'restore');
        });
        await run('native auth opening failure consumes its canceled waiter without unhandled rejection', {}, async ({ begin, done, page }) => {
          const job = await begin('signIn', 'google'); await done(job); await settle(page); assert.equal(await page.evaluate(() => window.snapshot().busy), false);
        });
      } finally { await browser.close(); }
    }
  } finally { await new Promise(resolve => server.close(resolve)); }
});

async function assertEventually(predicate) {
  const end = Date.now() + 5000;
  while (!predicate()) { if (Date.now() > end) assert.fail('Expected deferred fixture request did not arrive'); await new Promise(resolve => setTimeout(resolve, 5)); }
}

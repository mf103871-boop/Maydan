import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { clearPaddleCustomer, loadPaddle, openCheckout, resetPaddleForTests, retainCustomer, setPaddleCustomer } from '../src/shared/account/paddle.js';

const A = `ctm_${'a'.repeat(26)}`, B = `ctm_${'b'.repeat(26)}`;
const live = { clientToken: 'live_local_fixture', environment: 'production' };
const identity = id => ({ environment: 'production', customerId: id });
function sdk() {
  const calls = { initialize: [], update: [], environment: [], open: [], close: 0 };
  const Paddle = {
    Initialized: false,
    Initialize(options) { assert.equal(this.Initialized, false); this.Initialized = true; calls.initialize.push(options); },
    Update(options) { calls.update.push(options); },
    Environment: { set(value) { calls.environment.push(value); } },
    Checkout: { open(value) { calls.open.push(value); }, close() { calls.close++; } },
  };
  globalThis.window = { Paddle };
  return { Paddle, calls };
}
afterEach(() => { resetPaddleForTests(); delete globalThis.window; delete globalThis.document; delete globalThis.location; });

test('Retain identifies only a production-scoped Paddle customer and never email/internal IDs', () => {
  assert.deepEqual(retainCustomer(identity(A), 'production'), { id: A });
  for (const value of [null, { customerId: A }, { environment: 'sandbox', customerId: A }, identity('user-internal'), identity('customer@example.test'), identity('ctm_short')]) {
    assert.deepEqual(retainCustomer(value, 'production'), {});
  }
  assert.deepEqual(retainCustomer(identity(A), 'sandbox'), {});
});

test('live uses default environment, updates customers and clears logout without reinitialization', async () => {
  const { calls } = sdk();
  setPaddleCustomer(identity(A));
  await loadPaddle(live);
  assert.deepEqual(calls.initialize[0].pwCustomer, { id: A });
  assert.deepEqual(calls.environment, []);
  setPaddleCustomer(identity(B));
  await loadPaddle(live);
  assert.deepEqual(calls.update.at(-1), { pwCustomer: { id: B } });
  clearPaddleCustomer();
  assert.deepEqual(calls.update.at(-1), { pwCustomer: {} });
  assert.equal(calls.initialize.length, 1);
});

test('sandbox is explicitly selected and always initializes anonymous Retain', async () => {
  const { calls } = sdk();
  setPaddleCustomer(identity(A));
  await loadPaddle({ clientToken: 'test_fixture', environment: 'sandbox' });
  assert.deepEqual(calls.initialize[0].pwCustomer, {});
  assert.deepEqual(calls.environment, ['sandbox']);
});

test('anonymous live initialization includes explicit empty pwCustomer', async () => {
  const { calls } = sdk();
  await loadPaddle(live);
  assert.deepEqual(calls.initialize[0].pwCustomer, {});
});

test('logout during delayed SDK load cannot restore a stale customer', async () => {
  const { Paddle, calls } = sdk(); delete window.Paddle;
  const listeners = {};
  globalThis.document = { querySelector: () => null, createElement: () => ({ addEventListener(name, fn) { listeners[name] = fn; } }), head: { appendChild() {} } };
  setPaddleCustomer(identity(A));
  const loading = loadPaddle(live);
  clearPaddleCustomer();
  window.Paddle = Paddle; listeners.load();
  await loading;
  assert.deepEqual(calls.initialize[0].pwCustomer, {});
});

test('logout cancels a pending checkout before it opens and closes an already open checkout', async () => {
  const { calls } = sdk();
  setPaddleCustomer(identity(A));
  await loadPaddle(live);
  const pending = openCheckout({ transactionId: 'txn_local', ...live });
  clearPaddleCustomer();
  await assert.rejects(pending, { code: 'PURCHASE_CANCELLED' });
  assert.equal(calls.open.length, 0);
  const opened = openCheckout({ transactionId: 'txn_local', ...live });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.open.length, 1);
  clearPaddleCustomer();
  await assert.rejects(opened, { code: 'PURCHASE_CANCELLED' });
  assert.equal(calls.close, 1);
});

test('token or environment cutover clears Retain and requires a new document', async () => {
  const { calls } = sdk();
  setPaddleCustomer(identity(A)); await loadPaddle(live);
  await assert.rejects(loadPaddle({ clientToken: 'test_fixture', environment: 'sandbox' }), { code: 'BILLING_CONFIG_CHANGED' });
  assert.deepEqual(calls.update.at(-1), { pwCustomer: {} });
  setPaddleCustomer(identity(B));
  await assert.rejects(loadPaddle(live), { code: 'BILLING_CONFIG_CHANGED' });
  assert.equal(calls.initialize.length, 1);
  assert.deepEqual(calls.environment, []);
  resetPaddleForTests();
  const other = sdk(); await loadPaddle(live);
  await assert.rejects(loadPaddle({ ...live, clientToken: 'live_other_account' }), { code: 'BILLING_CONFIG_CHANGED' });
  assert.deepEqual(other.calls.update.at(-1), { pwCustomer: {} });
});

test('disabled checkout performs no SDK initialization', async () => {
  const { calls } = sdk();
  await assert.rejects(openCheckout({ transactionId: 'txn_local', ...live, checkoutEnabled: false }), { code: 'CHECKOUT_DISABLED' });
  assert.equal(calls.initialize.length, 0);
  assert.equal(calls.open.length, 0);
});

test('Retain or price initialization cannot auto-open _ptxn while checkout is disabled', async () => {
  const { calls } = sdk();
  globalThis.location = { search: '?_ptxn=txn_fixture' };
  await assert.rejects(loadPaddle({ ...live, checkoutEnabled: false }), { code: 'CHECKOUT_DISABLED' });
  assert.equal(calls.initialize.length, 0);
});

const payScript = (await readFile(new URL('../public/pay.html', import.meta.url), 'utf8')).match(/<script>([\s\S]*?)<\/script>/)[1];
const SESSION = `mdn1.${'a'.repeat(16)}.${'s'.repeat(32)}`;
function payPage({ config = { ...live, checkoutEnabled: true }, session = SESSION, me, beforeSDK } = {}) {
  const nodes = new Map();
  const listeners = {};
  const { Paddle, calls } = sdk();
  const fetches = [];
  let stored = session ? JSON.stringify(session) : null, scripts = 0;
  const fixture = {
    calls, fetches, nodes, listeners,
    setSession(value) { stored = value ? JSON.stringify(value) : null; listeners.storage?.({ key: 'maydan:account:session' }); },
    scripts: () => scripts,
  };
  const ctx = {
    URLSearchParams, AbortController, setTimeout, clearTimeout,
    localStorage: { getItem: () => stored, setItem(_key, value) { stored = value; } },
    location: { protocol: 'https:', search: `?_ptxn=txn_${'t'.repeat(26)}`, reload() {} },
    window: { Paddle, addEventListener(type, fn) { listeners[type] = fn; } },
    document: { getElementById(id) { if (!nodes.has(id)) nodes.set(id, { hidden: true, textContent: '', addEventListener() {} }); return nodes.get(id); }, createElement: () => ({}), head: { appendChild(script) { scripts++; beforeSDK?.(fixture); queueMicrotask(() => script.onload()); } } },
    async fetch(url, init) {
      fetches.push({ url, init });
      if (url === '/api/billing/config') return new Response(JSON.stringify({ paddle: config }));
      if (url === '/api/me') return new Response(JSON.stringify(await (typeof me === 'function' ? me(fixture) : me || { user: { id: 'internal-not-sent' }, paddle: identity(A) })));
      throw new Error('Unexpected network request');
    },
  };
  fixture.done = vm.runInNewContext(payScript, ctx);
  return fixture;
}
const plain = value => JSON.parse(JSON.stringify(value));

test('payment page honors checkoutEnabled=false before identity fetch or SDK load', async () => {
  const p = payPage({ config: { ...live, checkoutEnabled: false } }); await p.done;
  assert.equal(p.scripts(), 0); assert.equal(p.calls.initialize.length, 0);
  assert.equal(p.fetches.length, 1);
  assert.match(p.nodes.get('status').textContent, /غير متاح بعد/);
});

test('payment page reads authenticated identity, sends only ctm ID and clears on cross-tab logout', async () => {
  const p = payPage(); await p.done;
  assert.equal(p.fetches[1].init.headers.authorization, `Bearer ${SESSION}`);
  assert.deepEqual(plain(p.calls.initialize[0].pwCustomer), { id: A });
  assert.deepEqual(p.calls.environment, []);
  p.setSession(null);
  assert.deepEqual(plain(p.calls.update.at(-1)), { pwCustomer: {} });
});

test('anonymous and sandbox payment pages initialize empty Retain without identity request', async () => {
  for (const options of [{ session: null }, { config: { clientToken: 'test_fixture', environment: 'sandbox', checkoutEnabled: true } }]) {
    const p = payPage(options); await p.done;
    assert.deepEqual(plain(p.calls.initialize[0].pwCustomer), {});
    assert.equal(p.fetches.length, 1);
  }
});

test('payment-page identity cannot survive logout during me or SDK loading', async () => {
  for (const options of [
    { me: async p => { p.setSession(null); return { user: { id: 'former-user' }, paddle: identity(A) }; } },
    { beforeSDK: p => p.setSession(null) },
    { me: { user: { id: 'some-user' }, paddle: { environment: 'sandbox', customerId: A } } },
  ]) {
    const p = payPage(options); await p.done;
    assert.deepEqual(plain(p.calls.initialize[0].pwCustomer), {});
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomError } from '../server/accounts/errors.mjs';
import {
  createPaddleWebhookIpGuard, PADDLE_IPS_URL, PADDLE_IPS_TTL_MS as HOUR,
  PADDLE_IPS_MAX_AGE_MS as DAY,
} from '../server/accounts/paddle-ips.mjs';

const LIVE = { PADDLE_ENV: 'production' };
// Current provider response is a test fixture, never the production allowlist.
const CIDRS = ['34.237.3.244/32', '34.195.105.136/32', '34.232.58.13/32',
  '35.155.119.135/32', '34.212.5.7/32', '52.11.166.252/32'];
const KNOWN = CIDRS[0].split('/')[0];
const FOREIGN = '203.0.113.19';
const request = (address, extra = {}) => new Request('https://maydan.test/api/paddle/webhook', {
  method: 'POST', headers: { ...(address == null ? {} : { 'cf-connecting-ip': address }), ...extra }, body: '{invalid JSON',
});
const reply = (cidrs = CIDRS) => new Response(JSON.stringify({ data: { ipv4_cidrs: cidrs } }), {
  headers: { 'content-type': 'application/json' },
});
const errorIs = (code, status) => error => error instanceof RoomError && error.code === code && error.status === status && error.message === code;
const forbidden = errorIs('IP_FORBIDDEN', 403);
const unavailable = errorIs('IP_UNAVAILABLE', 503);

test('sandbox and omitted environment preserve existing webhook behavior without fetching', async () => {
  let calls = 0;
  const guard = createPaddleWebhookIpGuard({ fetchImpl: async () => { calls++; throw new Error('not called'); } });
  await guard(request(null), { PADDLE_ENV: 'sandbox' });
  await guard(request(null));
  assert.equal(calls, 0);
});

test('production rejects missing/malformed CF address before reading body or fetching; XFF is never trusted', async () => {
  let calls = 0;
  const guard = createPaddleWebhookIpGuard({ fetchImpl: async () => { calls++; return reply(); } });
  for (const address of [null, '', '999.1.2.3', '034.237.3.244', `${KNOWN}, ${FOREIGN}`, '::1', '34.237.3.244/32', '1.2.3']) {
    const req = request(address, { 'x-forwarded-for': KNOWN, 'x-real-ip': KNOWN });
    await assert.rejects(guard(req, LIVE), forbidden);
    assert.equal(req.bodyUsed, false);
  }
  assert.equal(calls, 0);
});

test('all six dynamic /32 entries are accepted, foreign addresses rejected, and env URL overrides ignored', async () => {
  let calls = 0;
  const guard = createPaddleWebhookIpGuard({ fetchImpl: async (url, init) => {
    calls++;
    assert.equal(url, PADDLE_IPS_URL);
    assert.equal(init.method, 'GET');
    assert.equal(init.redirect, 'manual');
    assert.deepEqual(init.headers, { accept: 'application/json' });
    return reply();
  } });
  for (const cidr of CIDRS) {
    const req = request(cidr.split('/')[0]);
    await guard(req, { ...LIVE, PADDLE_IPS_URL: 'https://attacker.test/ips', PADDLE_API_URL: 'https://attacker.test', PADDLE_WEBHOOK_IP_CHECK: 'off' });
    assert.equal(req.bodyUsed, false, 'guard must not consume raw body required by HMAC');
  }
  await assert.rejects(guard(request(FOREIGN, { 'x-forwarded-for': KNOWN }), LIVE), forbidden);
  assert.equal(calls, 1);
});

test('cold concurrent requests share one in-flight provider fetch', async () => {
  let calls = 0, release;
  const gate = new Promise(resolve => { release = resolve; });
  const guard = createPaddleWebhookIpGuard({ fetchImpl: async () => { calls++; await gate; return reply(); } });
  const waiting = Array.from({ length: 30 }, () => guard(request(KNOWN), LIVE));
  assert.equal(calls, 1);
  release();
  await Promise.all(waiting);
  assert.equal(calls, 1);
});

test('provider redirects fail closed without following a different endpoint', async () => {
  let calls = 0;
  const guard = createPaddleWebhookIpGuard({ fetchImpl: async (url, init) => {
    calls++;
    assert.equal(url, PADDLE_IPS_URL);
    assert.equal(init.redirect, 'manual');
    return new Response(null, { status: 302, headers: { location: 'https://untrusted.test/ips' } });
  } });
  await assert.rejects(guard(request(KNOWN), LIVE), unavailable);
  assert.equal(calls, 1);
});

test('fresh unknown requests cannot force refresh; expiry obtains changed provider entries and removes old ones', async () => {
  let clock = 1000, calls = 0;
  const guard = createPaddleWebhookIpGuard({ now: () => clock, fetchImpl: async () => reply(++calls === 1 ? CIDRS : [`${FOREIGN}/32`]) });
  await guard(request(KNOWN), LIVE);
  clock += HOUR - 1;
  for (let n = 0; n < 25; n++) await assert.rejects(guard(request(FOREIGN), LIVE), forbidden);
  assert.equal(calls, 1);
  clock++;
  await guard(request(FOREIGN), LIVE);
  await assert.rejects(guard(request(KNOWN), LIVE), forbidden);
  assert.equal(calls, 2, 'new provider list, not hardcoded six addresses, controls acceptance');
});

test('cold failure is closed and coalesced; retries become possible after 30 seconds', async () => {
  let clock = 1000, calls = 0;
  const guard = createPaddleWebhookIpGuard({ now: () => clock, fetchImpl: async () => {
    if (++calls === 1) throw new Error('private provider details');
    return reply();
  } });
  await assert.rejects(guard(request(KNOWN), LIVE), unavailable);
  clock += 29_999;
  await Promise.all(Array.from({ length: 20 }, () => assert.rejects(guard(request(FOREIGN), LIVE), unavailable)));
  assert.equal(calls, 1);
  clock++;
  await guard(request(KNOWN), LIVE);
  assert.equal(calls, 2);
});

test('malformed provider data and HTTP/JSON failures cannot create a trusted cache', async () => {
  const responses = [
    () => reply([]), () => reply('34.237.3.244/32'), () => reply(['0.0.0.0/0']),
    () => reply([`${KNOWN}/24`]), () => reply([`${KNOWN}/32`, '999.1.1.1/32']),
    () => reply([KNOWN]), () => reply([`${KNOWN}/32`, 10]),
    () => new Response('{}'), () => new Response('not json'),
    () => new Response('{}', { status: 503 }),
  ];
  for (const make of responses) {
    const guard = createPaddleWebhookIpGuard({ fetchImpl: async () => make() });
    await assert.rejects(guard(request(KNOWN), LIVE), unavailable);
  }
});

test('failed or malformed refresh preserves known senders within 24 hours; unknown senders get retryable failure', async () => {
  let clock = 1000, calls = 0;
  const guard = createPaddleWebhookIpGuard({ now: () => clock, fetchImpl: async () => reply(++calls === 1 ? CIDRS : ['0.0.0.0/0']) });
  await guard(request(KNOWN), LIVE);
  clock += HOUR;
  await guard(request(KNOWN), LIVE);
  await assert.rejects(guard(request(FOREIGN), LIVE), unavailable);
  assert.equal(calls, 2);
  clock += 30_000;
  await guard(request(KNOWN), LIVE);
  assert.equal(calls, 3, 'known cached Paddle sender can recover a short provider outage');
  clock = 1000 + DAY;
  await assert.rejects(guard(request(KNOWN), LIVE), unavailable);
});

test('unknown addresses cannot force stale-cache refresh more than once per five minutes', async () => {
  let clock = 1000, calls = 0;
  const guard = createPaddleWebhookIpGuard({ now: () => clock, fetchImpl: async () => {
    if (++calls > 1) throw new Error('outage');
    return reply();
  } });
  await guard(request(KNOWN), LIVE);
  clock += HOUR;
  await assert.rejects(guard(request(FOREIGN), LIVE), unavailable);
  for (let n = 0; n < 29; n++) {
    clock += 10_000;
    await assert.rejects(guard(request(FOREIGN), LIVE), unavailable);
  }
  assert.equal(calls, 2);
  clock += 10_000;
  await assert.rejects(guard(request(FOREIGN), LIVE), unavailable);
  assert.equal(calls, 3);
});

test('timeout bounds an unresponsive fetch, aborts it and fails closed without cache', async () => {
  let signal;
  const guard = createPaddleWebhookIpGuard({ timeoutMs: 10, fetchImpl: async (_url, init) => {
    signal = init.signal;
    return new Promise(() => {});
  } });
  await assert.rejects(guard(request(KNOWN), LIVE), unavailable);
  assert.equal(signal.aborted, true);
});

test('timeout also bounds an unresponsive body and a late response cannot populate cache', async () => {
  let release;
  const guard = createPaddleWebhookIpGuard({ timeoutMs: 10, fetchImpl: async () => ({
    ok: true, json: () => new Promise(resolve => { release = resolve; }),
  }) });
  await assert.rejects(guard(request(KNOWN), LIVE), unavailable);
  release({ data: { ipv4_cidrs: CIDRS } });
  await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(guard(request(KNOWN), LIVE), unavailable);
});

test('cache outage fallback remains usable for known addresses when refresh times out', async () => {
  let clock = 1000, calls = 0;
  const guard = createPaddleWebhookIpGuard({ now: () => clock, timeoutMs: 10, fetchImpl: async () => {
    if (++calls === 1) return reply();
    return new Promise(() => {});
  } });
  await guard(request(KNOWN), LIVE);
  clock += HOUR;
  await guard(request(KNOWN), LIVE);
  await assert.rejects(guard(request(FOREIGN), LIVE), unavailable);
});

test('factory rejects an unbounded deadline or a stale policy shorter than the fresh TTL', () => {
  for (const options of [{ timeoutMs: 2000 }, { timeoutMs: 0 }, { ttlMs: 0 }, { ttlMs: 1000, maxStaleMs: 999 }]) {
    assert.throws(() => createPaddleWebhookIpGuard(options), TypeError);
  }
});

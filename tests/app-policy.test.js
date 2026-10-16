import test from 'node:test';
import assert from 'node:assert/strict';
import { createIOSAppPolicy } from '../server/app-policy.mjs';
import { routeRequest } from '../server/worker.mjs';

const ENV = { IOS_UPDATE_POLICY_ENABLED: '1', IOS_MIN_SUPPORTED_BUILD: '12', IOS_MIN_SUPPORTED_VERSION: '1.7' };
const request = (query = 'storefront=JOR&osVersion=26.6.1') => new Request(`https://maydan.test/api/app-policy/ios?${query}`, {
  headers: { authorization: 'Bearer private-player-session', cookie: 'private-cookie' },
});
const app = (country = 'jo', changes = {}) => ({ resultCount: 1, results: [{ trackId: 6808385717, bundleId: 'Maydan', kind: 'software',
  wrapperType: 'software', version: '1.7', minimumOsVersion: '16.4', trackViewUrl: `https://apps.apple.com/${country}/app/maydan/id6808385717?uo=4`, ...changes }] });
const reply = value => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
const data = async (handler, query, env = ENV) => (await handler(request(query), env)).json();

test('disabled by default, invalid configuration fails open without an Apple request', async () => {
  let fetches = 0;
  const handler = createIOSAppPolicy({ fetchImpl: async () => { fetches++; throw new Error('Must not fetch'); } });
  for (const env of [{}, { ...ENV, IOS_UPDATE_POLICY_ENABLED: 'true' }, { ...ENV, IOS_MIN_SUPPORTED_BUILD: '0' },
    { ...ENV, IOS_MIN_SUPPORTED_BUILD: '-12' }, { ...ENV, IOS_MIN_SUPPORTED_BUILD: '12.5' }, { ...ENV, IOS_MIN_SUPPORTED_BUILD: '12e2' }, { ...ENV, IOS_MIN_SUPPORTED_BUILD: '1000000' },
    { ...ENV, IOS_MIN_SUPPORTED_VERSION: '1.7-beta' }, { ...ENV, IOS_MIN_SUPPORTED_VERSION: '0.0' }, { ...ENV, IOS_MIN_SUPPORTED_VERSION: '' }]) {
    assert.deepEqual(await data(handler, undefined, env), { schemaVersion: 1, enabled: false, minimumBuild: 0, minimumVersion: null,
      appStoreId: '6808385717', message: 'يتوفر تحديث جديد لميدان. حدّث التطبيق من App Store للمتابعة.' });
  }
  assert.equal(fetches, 0);
});

test('enabled only for the exact publicly available app, with no caller headers or endpoint forwarded', async () => {
  let observed;
  const handler = createIOSAppPolicy({ fetchImpl: async (url, options) => { observed = { url, options }; return reply(app()); } });
  const result = await handler(request('storefront=JOR&osVersion=26.6.1&url=https://attacker.test&appStoreId=1'), ENV);
  assert.equal(result.status, 200);
  assert.equal(result.headers.get('cache-control'), 'no-store');
  assert.equal(result.headers.get('content-type'), 'application/json; charset=utf-8');
  assert.deepEqual(await result.json(), { schemaVersion: 1, enabled: true, minimumBuild: 12, minimumVersion: '1.7',
    appStoreId: '6808385717', message: 'يتوفر تحديث جديد لميدان. حدّث التطبيق من App Store للمتابعة.' });
  assert.equal(observed.url, 'https://itunes.apple.com/lookup?id=6808385717&entity=software&country=jo');
  assert.deepEqual(observed.options.headers, { accept: 'application/json' });
  assert.equal(observed.options.redirect, 'error');
  assert.equal(observed.options.method, 'GET');
});

test('maps StoreKit alpha-3 explicitly, accepts alpha-2, never guesses missing or unknown country/OS', async () => {
  const countries = [];
  const handler = createIOSAppPolicy({ fetchImpl: async url => {
    const country = new URL(url).searchParams.get('country'); countries.push(country); return reply(app(country));
  } });
  for (const [code, expected] of [['JOR', 'jo'], ['USA', 'us'], ['GBR', 'gb'], ['KOR', 'kr'], ['de', 'de']]) {
    assert.equal((await data(handler, `storefront=${code}&osVersion=26.6.1`)).enabled, true);
    assert.equal(countries.at(-1), expected);
  }
  const before = countries.length;
  for (const query of ['', 'osVersion=26.6.1', 'storefront=JOR', 'storefront=XXX&osVersion=26.6.1', 'storefront=ZZ&osVersion=26.6.1',
    'storefront=JOR%26country%3Dus&osVersion=26.6.1', 'storefront=JOR&storefront=USA&osVersion=26.6.1',
    'storefront=JOR&osVersion=26.6.1&osVersion=26', 'storefront=JOR&osVersion=unknown']) {
    assert.equal((await data(handler, query)).enabled, false);
  }
  assert.equal(countries.length, before);
});

test('uploaded future version, an older public version, or an unavailable storefront never activates', async () => {
  for (const body of [app('jo', { version: '1.5' }), { resultCount: 0, results: [] }, app('us')]) {
    const handler = createIOSAppPolicy({ fetchImpl: async () => reply(body) });
    assert.equal((await data(handler)).enabled, false);
  }
});

test('numeric marketing version comparison and minimum OS prevent an impossible update', async () => {
  for (const [version, minimum, osVersion, minimumOS, expected] of [
    ['1.10', '1.9', '26.6.1', '16.4', true], ['1.9', '1.10', '26.6.1', '16.4', false],
    ['1.7.0', '1.7', '16.4', '16.4.0', true], ['1.7', '1.7', '16.3.9', '16.4', false],
    ['1.7', '1.7', '16.9', '26.0', false], ['1.7', '1.7', '26.6.1', '27.0', false],
  ]) {
    const handler = createIOSAppPolicy({ fetchImpl: async () => reply(app('jo', { version, minimumOsVersion: minimumOS })) });
    assert.equal((await data(handler, `storefront=JOR&osVersion=${osVersion}`, { ...ENV, IOS_MIN_SUPPORTED_VERSION: minimum })).enabled, expected);
  }
});

test('unexpected Apple payload or another app cannot activate the gate', async () => {
  for (const change of [{ trackId: 1 }, { bundleId: 'Other' }, { kind: 'song' }, { wrapperType: 'track' },
    { version: 'latest' }, { minimumOsVersion: undefined }, { trackViewUrl: 'https://attacker.test/jo/app/id6808385717' },
    { trackViewUrl: 'http://apps.apple.com/jo/app/id6808385717' }, { trackViewUrl: 'https://apps.apple.com/jo/app/id1' }]) {
    const handler = createIOSAppPolicy({ fetchImpl: async () => reply(app('jo', change)) });
    assert.equal((await data(handler)).enabled, false);
  }
  for (const body of [null, {}, { resultCount: 1, results: [] }, { resultCount: 2, results: [...app().results, ...app().results] }]) {
    const handler = createIOSAppPolicy({ fetchImpl: async () => reply(body) });
    assert.equal((await data(handler)).enabled, false);
  }
});

test('network, HTTP, JSON and timeout failures fail open and are not cached', async () => {
  for (const failure of [async () => { throw new Error('Network'); }, async () => new Response('', { status: 503 }),
    async () => new Response('not JSON'), async () => new Promise(() => {})]) {
    let count = 0;
    const handler = createIOSAppPolicy({ timeoutMs: 15, fetchImpl: (...args) => ++count === 1 ? failure(...args) : Promise.resolve(reply(app())) });
    assert.equal((await data(handler)).enabled, false);
    assert.equal((await data(handler)).enabled, true);
    assert.equal(count, 2);
  }
});

test('cache is country/policy scoped, lasts five minutes, and never serves stale success on error', async () => {
  let clock = 1_000, count = 0, fail = false;
  const handler = createIOSAppPolicy({ now: () => clock, fetchImpl: async url => {
    count++; if (fail) throw new Error('Offline'); return reply(app(new URL(url).searchParams.get('country')));
  } });
  assert.equal((await data(handler)).enabled, true);
  assert.equal((await data(handler)).enabled, true);
  assert.equal(count, 1);
  assert.equal((await data(handler, 'storefront=USA&osVersion=26.6.1')).enabled, true);
  assert.equal(count, 2);
  assert.equal((await data(handler, undefined, { ...ENV, IOS_MIN_SUPPORTED_VERSION: '1.8' })).enabled, false);
  assert.equal(count, 3);
  assert.equal((await data(handler, undefined, { ...ENV, IOS_UPDATE_POLICY_ENABLED: '0' })).enabled, false);
  assert.equal(count, 3);
  clock += 5 * 60_000;
  fail = true;
  assert.equal((await data(handler)).enabled, false);
  assert.equal((await data(handler)).enabled, false);
  assert.equal(count, 5);
});

test('cached availability is evaluated separately for each device OS', async () => {
  let count = 0;
  const handler = createIOSAppPolicy({ fetchImpl: async () => { count++; return reply(app('jo', { minimumOsVersion: '26.0' })); } });
  assert.equal((await data(handler, 'storefront=JOR&osVersion=16.4')).enabled, false);
  assert.equal((await data(handler)).enabled, true);
  assert.equal(count, 1);
});

test('concurrent requests for the same availability share one Apple lookup', async () => {
  let release, count = 0;
  const wait = new Promise(resolve => { release = resolve; });
  const handler = createIOSAppPolicy({ fetchImpl: async () => { count++; await wait; return reply(app()); } });
  const first = data(handler), second = data(handler);
  release();
  assert.deepEqual((await Promise.all([first, second])).map(value => value.enabled), [true, true]);
  assert.equal(count, 1);
});

test('only GET and HEAD are public; rejected methods never make an Apple request', async () => {
  let count = 0;
  const handler = createIOSAppPolicy({ fetchImpl: async () => { count++; return reply(app()); } });
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
    const result = await handler(new Request(request().url, { method }), ENV);
    assert.equal(result.status, 405);
    assert.equal(result.headers.get('allow'), 'GET, HEAD');
  }
  assert.equal(count, 0);
  const head = await handler(new Request(request().url, { method: 'HEAD' }), ENV);
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  assert.equal(head.headers.get('cache-control'), 'no-store');
  assert.equal(head.headers.get('content-type'), 'application/json; charset=utf-8');
});

test('worker policy route is public without sessions; unrelated APIs retain origin checks', async () => {
  const env = { get DB() { throw new Error('Policy must not read accounts'); }, get LIMITERS() { throw new Error('Policy must not allocate session/IP state'); } };
  const result = await routeRequest(new Request(request().url), env);
  assert.equal(result.status, 200);
  assert.equal((await result.json()).enabled, false);
  assert.equal(result.headers.has('x-maydan-session'), false);
  assert.equal((await routeRequest(new Request(request().url, { method: 'POST' }), env)).status, 405);
  for (const pathname of ['/api/social/me', '/api/rooms', '/api/app-policy/ios/extra']) {
    const blocked = await routeRequest(new Request(`https://maydan.test${pathname}`), env);
    assert.equal(blocked.status, 403);
    assert.deepEqual(await blocked.json(), { error: 'ORIGIN' });
  }
});

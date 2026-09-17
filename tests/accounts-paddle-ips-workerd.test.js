import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { PADDLE_IPS_URL } from '../server/accounts/paddle-ips.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const KNOWN = '34.237.3.244';
const FOREIGN = '203.0.113.19';

async function runtime(t, response) {
  const source = `
    import { assertPaddleWebhookIp } from './server/accounts/paddle-ips.mjs';
    export default { async fetch(request) {
      const ip = new URL(request.url).pathname === '/known' ? '${KNOWN}' : '${FOREIGN}';
      const webhook = new Request('https://fixture.test/webhook', { headers: { 'cf-connecting-ip': ip } });
      try {
        await assertPaddleWebhookIp(webhook, { PADDLE_ENV: 'production' });
        return Response.json({ allowed: true });
      } catch (error) {
        return Response.json({ error: error.code }, { status: error.status || 500 });
      }
    }};
  `;
  const bundle = await build({ stdin: { contents: source, resolveDir: ROOT, sourcefile: 'paddle-ip-runtime-fixture.mjs' },
    bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022' });
  const calls = [];
  // Real workerd constructs/validates fetch requests. Only network transport is
  // replaced, so unsupported redirect options fail before this fixture runs.
  const mf = new Miniflare(convertV4MiniflareOptions({
    name: 'paddle-ip-runtime-fixture', modules: true, script: bundle.outputFiles[0].text,
    compatibilityDate: '2026-09-01',
    outboundService: async request => {
      calls.push({ url: request.url, method: request.method });
      return response(request);
    },
  }));
  t.after(() => mf.dispose());
  return { mf, calls };
}

test('real workerd accepts the IP fetch redirect mode and uses its validated cache', async t => {
  const { mf, calls } = await runtime(t, request => {
    assert.equal(request.url, PADDLE_IPS_URL);
    return Response.json({ data: { ipv4_cidrs: [`${KNOWN}/32`] } });
  });
  const allowed = await mf.dispatchFetch('https://fixture.test/known');
  assert.equal(allowed.status, 200);
  assert.deepEqual(await allowed.json(), { allowed: true });
  const denied = await mf.dispatchFetch('https://fixture.test/foreign');
  assert.equal(denied.status, 403);
  assert.deepEqual(await denied.json(), { error: 'IP_FORBIDDEN' });
  assert.deepEqual(calls, [{ url: PADDLE_IPS_URL, method: 'GET' }]);
});

test('real workerd rejects an IP provider redirect without issuing a request to its target', async t => {
  const { mf, calls } = await runtime(t, request => {
    if (request.url !== PADDLE_IPS_URL) return Response.json({ data: { ipv4_cidrs: [`${KNOWN}/32`] } });
    return new Response(null, { status: 302, headers: { location: 'https://untrusted.test/ips' } });
  });
  const denied = await mf.dispatchFetch('https://fixture.test/known');
  assert.equal(denied.status, 503);
  assert.deepEqual(await denied.json(), { error: 'IP_UNAVAILABLE' });
  assert.deepEqual(calls, [{ url: PADDLE_IPS_URL, method: 'GET' }]);
});

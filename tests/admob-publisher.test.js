import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import worker from '../server/full-worker.mjs';

test('the publisher URL serves only a configured seller as plain text, independently of ad rollout', async () => {
  const url = 'https://maydan-game.mf103871.workers.dev/app-ads.txt';
  const config = await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
  const routes = JSON.parse(config.match(/"run_worker_first"\s*:\s*(\[[^\]]+\])/)[1]);
  assert.ok(routes.includes('/app-ads.txt'));
  const env = { REWARDED_ADMOB_PUBLISHER_ID: 'pub-1234567890123456', REWARDED_ADS_ENABLED: '0' };
  const res = await worker.fetch(new Request(url), env);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /^text\/plain\b/);
  assert.equal(await res.text(), 'google.com, pub-1234567890123456, DIRECT, f08c47fec0942fa0\n');
  assert.equal(await (await worker.fetch(new Request(url, { method: 'HEAD' }), env)).text(), '');
  assert.equal((await worker.fetch(new Request(url, { method: 'POST' }), env)).status, 405);
  for (const id of ['', 'pub-3940256099942544', 'pub-1234567890123456\nwrong']) {
    assert.equal((await worker.fetch(new Request(url), { REWARDED_ADMOB_PUBLISHER_ID: id })).status, 404);
  }
});

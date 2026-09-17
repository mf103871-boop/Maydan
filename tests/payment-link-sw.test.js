import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

test('payment and public policy pages bypass the game cache and cannot replace its offline shell', async () => {
  const handlers = {};
  const script = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8');
  vm.runInNewContext(script, {
    URL,
    self: { location: { origin: 'https://maydan.example' }, addEventListener(name, handler) { handlers[name] = handler; } },
    // Any attempted cache access or respondWith would fail this test.
  });
  for (const pathname of ['/pay', '/pay/', '/pay.html', '/pricing', '/pricing/', '/pricing/index.html', '/refunds', '/refunds/', '/refunds/index.html', '/commerce.css']) {
    let intercepted = false;
    handlers.fetch({ request: { method: 'GET', mode: 'navigate', url: `https://maydan.example${pathname}?_ptxn=txn_fixture` }, respondWith() { intercepted = true; } });
    assert.equal(intercepted, false, pathname);
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

test('static preview explicitly reports unavailable account APIs without redirecting or forwarding credentials', async (t) => {
  const child = spawn(process.execPath, ['scripts/dev.mjs', '--serve-only'], {
    cwd: process.cwd(), env: { ...process.env, PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => child.kill());
  const base = await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error('Preview did not start')), 10000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`Preview exited: ${code}`)); });
    child.stdout.on('data', data => {
      output += data;
      const match = output.match(/http:\/\/localhost:\d+/);
      if (match) { clearTimeout(timer); resolve(match[0]); }
    });
  });
  for (const [endpoint, method] of [['/api/billing/config', 'GET'], ['/api/auth/google/start?client=web', 'GET'], ['/api/auth/exchange', 'POST']]) {
    const response = await fetch(base + endpoint, { method, redirect: 'manual' });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: 'PREVIEW_ONLY' });
    assert.equal(response.headers.get('location'), null);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
});

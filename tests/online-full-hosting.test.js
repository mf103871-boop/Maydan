import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { WebSocket } from 'ws';
import { resolveServerUrl } from '../src/online/shared.js';
import { newCredentials } from '../src/online/client.js';

test('same-host configuration follows a valid page origin and keeps separate-server builds intact', () => {
  assert.equal(resolveServerUrl('same-origin', 'https://maydan-game.example.workers.dev'), 'https://maydan-game.example.workers.dev');
  assert.equal(resolveServerUrl('same-origin', 'null'), '');
  assert.equal(resolveServerUrl('same-origin', 'http://untrusted.example'), '');
  assert.equal(resolveServerUrl('', 'https://maydan-game.example.workers.dev'), '');
  assert.equal(resolveServerUrl('https://rooms.example', 'https://game.example'), 'https://rooms.example');
});
test('PWA never intercepts or caches same-origin room endpoints, including navigation requests', async () => {
  const handlers = new Map();
  vm.runInNewContext(await readFile('public/sw.js', 'utf8'), { URL,
    self: { location: { origin: 'https://game.example' }, addEventListener: (type, fn) => handlers.set(type, fn) } });
  for (const endpoint of ['/api', '/api/rooms', '/api/rooms/123456/socket', '/health']) {
    let intercepted = false;
    handlers.get('fetch')({ request: { method: 'GET', url: `https://game.example${endpoint}`, mode: 'navigate' }, respondWith: () => { intercepted = true; } });
    assert.equal(intercepted, false, endpoint);
  }
});
test('Cloudflare serves the game and authenticated WebSockets together, with API routing ahead of SPA fallback', { timeout: 30_000 }, async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'maydan-full-'));
  const assetsDir = path.join(dir, 'assets');
  let mf; let ws;
  try {
    await mkdir(assetsDir);
    await writeFile(path.join(assetsDir, 'index.html'), '<!doctype html><html lang="ar"><title>ميدان</title><body>Maydan static asset</body></html>');
    const scriptPath = path.join(dir, 'worker.mjs');
    await build({ entryPoints: ['server/full-worker.mjs'], bundle: true, format: 'esm', platform: 'browser', outfile: scriptPath, logLevel: 'silent' });
    mf = new Miniflare(convertV4MiniflareOptions({ rootPath: dir, name: 'maydan-game', modules: true, scriptPath,
      compatibilityDate: '2026-09-01', port: 0, host: '127.0.0.1', cf: false,
      durableObjects: { ROOMS: { className: 'Room', useSQLite: true }, LIMITERS: { className: 'RequestLimiter', useSQLite: true } },
      assets: { directory: assetsDir, binding: 'ASSETS', assetConfig: { not_found_handling: 'single-page-application' }, routerConfig: { has_user_worker: true }, run_worker_first: ['/api', '/api/*', '/health'] },
    }));
    const origin = (await mf.ready).origin;
    const home = await fetch(origin); assert.equal(home.status, 200); assert.match(await home.text(), /Maydan static asset/);
    const health = await fetch(`${origin}/health`); assert.equal(health.status, 200, await health.clone().text()); assert.equal((await health.json()).game, 'meenfina');
    const unknownApi = await fetch(`${origin}/api/unknown`, { headers: { origin, 'sec-fetch-mode': 'navigate' } });
    assert.equal(unknownApi.status, 404); assert.equal((await unknownApi.json()).error, 'NOT_FOUND');
    const session = newCredentials();
    const denied = await fetch(`${origin}/api/rooms`, { method: 'POST', headers: { origin: 'https://other.example', 'content-type': 'application/json' }, body: JSON.stringify({ ...session, name: 'أحمد', avatar: 0, rounds: 5 }) });
    assert.equal(denied.status, 403);
    const created = await fetch(`${origin}/api/rooms`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ ...session, name: 'أحمد', avatar: 0, rounds: 5 }) });
    assert.equal(created.status, 201); assert.equal(created.headers.get('cache-control'), 'no-store');
    const { code } = await created.json();
    ws = new WebSocket(`${origin.replace('http:', 'ws:')}/api/rooms/${code}/socket`, { origin });
    const state = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('socket authentication timeout')), 4000);
      ws.on('open', () => ws.send(JSON.stringify({ type: 'auth', ...session })));
      ws.on('error', reject);
      ws.on('message', (value) => { const data = JSON.parse(value.toString()); if (data.type === 'state') { clearTimeout(timer); resolve(data.state); } });
    });
    assert.equal(state.hostId, session.id); assert.equal(state.phase, 'lobby'); assert.equal(state.members[0].connected, true);
  } finally {
    ws?.close(); if (mf) await mf.dispose(); await rm(dir, { recursive: true, force: true });
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { WebSocket } from 'ws';
import { RoomClient, newCredentials } from '../src/online/client.js';
const ORIGIN = 'http://localhost:3000';
class BrowserSocket extends WebSocket { constructor(url) { super(url, { origin: ORIGIN }); } }
async function until(fn, label = 'condition') {
  const until = Date.now() + 5000;
  while (Date.now() < until) { if (fn()) return; await new Promise((r) => setTimeout(r, 15)); }
  assert.fail(`Timed out: ${label}`);
}
test('Cloudflare workerd: SQLite transactions, WebSocket authentication and five-round match', { timeout: 30_000 }, async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'maydan-cloudflare-'));
  const scriptPath = path.join(dir, 'worker.mjs');
  let mf; const clients = [];
  try {
    await build({ entryPoints: ['server/worker.mjs'], bundle: true, format: 'esm', platform: 'browser', outfile: scriptPath, logLevel: 'silent' });
    mf = new Miniflare(convertV4MiniflareOptions({ rootPath: dir, name: 'maydan-rooms', modules: true, scriptPath, compatibilityDate: '2026-09-01',
      durableObjects: { ROOMS: { className: 'Room', useSQLite: true }, LIMITERS: { className: 'RequestLimiter', useSQLite: true } },
      bindings: { ALLOWED_ORIGINS: ORIGIN }, port: 0, host: '127.0.0.1', cf: false }));
    const server = (await mf.ready).origin;
    async function api(endpoint, data) {
      const res = await fetch(server + endpoint, { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json' }, body: JSON.stringify(data) });
      const body = await res.json(); assert.ok(res.ok, `${res.status}: ${body.error}`); return body;
    }
    const profiles = Array.from({ length: 3 }, (_, n) => ({ ...newCredentials(), name: `هاتف ${n}`, avatar: n, rounds: 5 }));
    const { code } = await api('/api/rooms', profiles[0]);
    for (const p of profiles.slice(1)) await api(`/api/rooms/${code}/join`, p);
    for (const p of profiles) {
      const client = new RoomClient({ server, code, session: { id: p.id, token: p.token }, WebSocketImpl: BrowserSocket });
      clients.push(client); client.start();
    }
    await until(() => clients.every((c) => c.state?.members.every((m) => m.connected)), 'authenticated sockets');
    await Promise.all(clients.slice(1).map((c) => c.command('ready', { ready: true })));
    await clients[0].command('start');
    for (let round = 1; round <= 5; round++) {
      await until(() => clients.every((c) => c.state.phase === 'vote' && c.state.round === round), `round ${round}`);
      await Promise.all(clients.map((c) => c.command('vote', { targetId: profiles[2].id })));
      await until(() => clients.every((c) => c.state.phase === 'result'), 'shared result');
      for (const c of clients) {
        assert.equal(c.state.members[2].score, round);
        assert.equal(c.state.counts[profiles[2].id], 3);
        for (const p of profiles) assert.equal(JSON.stringify(c.state).includes(p.token), false);
      }
      if (round === 2) await mf.unsafeEvictDurableObject('maydan-rooms', 'Room', { name: code, webSockets: 'hibernate' });
      await clients[0].command('next');
    }
    await until(() => clients.every((c) => c.state.phase === 'over'));
    assert.equal(clients[2].state.members[2].score, 5);
    clients[1].stop(); clients[1].start();
    await until(() => clients[1].connectionStatus === 'connected');
    assert.equal(clients[1].state.members[2].score, 5);
  } finally {
    clients.forEach((c) => c.stop());
    if (mf) await mf.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { startLocalServer } from '../server/local.mjs';
import { RoomClient, newCredentials } from '../src/online/client.js';
const ORIGIN = 'http://localhost:3000';
class BrowserSocket extends WebSocket { constructor(url) { super(url, { origin: ORIGIN }); } }
async function until(fn, label = 'condition', timeout = 3500) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (fn()) return; await new Promise((resolve) => setTimeout(resolve, 10)); }
  assert.fail(`Timed out: ${label}`);
}
async function api(app, path, data, origin = ORIGIN) {
  const res = await fetch(app.url + path, { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify(data) });
  return { status: res.status, body: await res.json(), headers: res.headers };
}
async function group(t, count = 3) {
  const app = await startLocalServer({ port: 0 }); t.after(() => app.close());
  const profiles = Array.from({ length: count }, (_, n) => ({ ...newCredentials(), name: `لاعب ${n}`, avatar: n % 4, rounds: 5 }));
  const created = await api(app, '/api/rooms', profiles[0]); assert.equal(created.status, 201);
  const code = created.body.code;
  for (const p of profiles.slice(1)) assert.equal((await api(app, `/api/rooms/${code}/join`, p)).status, 200);
  const clients = profiles.map((profile) => {
    const client = new RoomClient({ server: app.url, code, session: { id: profile.id, token: profile.token }, WebSocketImpl: BrowserSocket });
    client.start(); return client;
  });
  t.after(() => clients.forEach((c) => c.stop()));
  await until(() => clients.every((c) => c.state?.members.filter((m) => m.connected).length === count), 'all clients connected');
  for (const c of clients.slice(1)) await c.command('ready', { ready: true });
  return { app, clients, profiles, code };
}
test('three real WebSocket clients complete five rounds with private votes and identical results', async (t) => {
  const { app, clients, profiles, code } = await group(t);
  const retry = await api(app, '/api/rooms', profiles[0]); assert.equal(retry.body.code, code); assert.equal(app.rooms.size, 1);
  await assert.rejects(clients[1].command('start'), (e) => e.code === 'HOST_ONLY');
  await clients[0].command('start');
  for (let round = 1; round <= 5; round++) {
    await until(() => clients.every((c) => c.state?.phase === 'vote' && c.state.round === round));
    await clients[0].command('vote', { targetId: profiles[1].id });
    await until(() => clients[2].state.submittedCount === 1);
    assert.deepEqual(clients[2].state.counts, {});
    assert.equal(clients[2].state.myVote.submitted, false);
    for (const c of clients) for (const p of profiles) assert.equal(JSON.stringify(c.state).includes(p.token), false);
    await Promise.all(clients.slice(1).map((c) => c.command('vote', { targetId: profiles[1].id })));
    await until(() => clients.every((c) => c.state.phase === 'result'));
    assert.equal(clients[0].state.members[1].score, round);
    assert.deepEqual(clients.map((c) => c.state.counts), Array(3).fill(clients[0].state.counts));
    await assert.rejects(clients[0].command('vote', { targetId: profiles[0].id }), (e) => e.code === 'PHASE');
    await clients[0].command('next');
  }
  await until(() => clients.every((c) => c.state.phase === 'over'));
  assert.deepEqual(clients[0].state.members.map((m) => m.score), [0, 5, 0]);
  await clients[0].command('restart');
  await until(() => clients.every((c) => c.state.phase === 'lobby'));
});
test('connection replacement and object rehydration preserve identity, votes and host transfer', async (t) => {
  const { app, clients, profiles, code } = await group(t);
  await clients[0].command('start');
  await until(() => clients.every((c) => c.state.phase === 'vote'));
  await clients[1].command('vote', { targetId: profiles[2].id });
  const replacement = new RoomClient({ server: app.url, code, session: clients[1].session, WebSocketImpl: BrowserSocket });
  t.after(() => replacement.stop()); replacement.start();
  await until(() => replacement.state?.myVote.submitted && clients[1].connectionStatus === 'replaced');
  assert.equal(replacement.state.members[1].connected, true);
  await app.rehydrate(code);
  await assert.rejects(replacement.command('vote', { targetId: profiles[0].id }), (e) => e.code === 'VOTED');
  clients[0].stop();
  await until(() => replacement.state.members[0].connected === false);
  const item = app.rooms.get(code);
  await item.instance.serial(async () => { const next = structuredClone(item.instance.room); next.hostMissingSince = Date.now() - 21_000; await item.instance.commit(next); });
  await item.instance.alarm();
  await until(() => replacement.state.hostId === profiles[1].id);
  clients[0].start(); await until(() => clients[0].connectionStatus === 'connected');
  assert.equal(clients[0].state.hostId, profiles[1].id);
  await Promise.all([clients[0].command('vote', { targetId: profiles[2].id }), clients[2].command('vote', { targetId: profiles[2].id })]);
  await until(() => replacement.state.phase === 'result');
  assert.equal(replacement.state.members[2].score, 1);
  await replacement.command('next');
});
test('deadline alarms, expiry and failed persistence never duplicate or expose uncommitted scores', async (t) => {
  const { app, clients, profiles, code } = await group(t);
  await clients[0].command('start'); await until(() => clients.every((c) => c.state.phase === 'vote'));
  const item = app.rooms.get(code);
  const originalPut = item.storage.put;
  item.storage.put = async () => { throw new Error('simulated storage outage'); };
  await assert.rejects(clients[0].command('vote', { targetId: profiles[1].id }), (e) => e.code === 'INTERNAL');
  assert.deepEqual(item.instance.room.votes, {});
  item.storage.put = originalPut;
  await clients[0].command('vote', { targetId: profiles[1].id });
  await item.instance.serial(async () => { const next = structuredClone(item.instance.room); next.deadlineAt = Date.now() - 1; await item.instance.commit(next); });
  await item.instance.alarm();
  await until(() => clients.every((c) => c.state.phase === 'result'));
  assert.equal(clients[0].state.members[1].score, 1);
  await app.rehydrate(code); await item.instance.alarm();
  assert.equal(item.instance.room.scores[profiles[1].id], 1);
  await item.instance.serial(async () => { const next = structuredClone(item.instance.room); next.expiresAt = Date.now() - 1; await item.instance.commit(next); });
  await item.instance.alarm();
  await until(() => clients.every((c) => c.connectionStatus === 'ended'));
  assert.equal(await item.storage.get('room'), undefined);
  assert.equal((await api(app, `/api/rooms/${code}/join`, profiles[0])).status, 404);
});
test('HTTP origin, body size, member tokens and creation rate limits are enforced', async (t) => {
  const app = await startLocalServer({ port: 0 }); t.after(() => app.close());
  const p = { ...newCredentials(), name: 'أحمد', avatar: 0, rounds: 5 };
  const blocked = await api(app, '/api/rooms', p, 'https://untrusted.example');
  assert.equal(blocked.status, 403); assert.equal(blocked.headers.has('access-control-allow-origin'), false);
  const tooBig = await api(app, '/api/rooms', { ...p, extra: 'x'.repeat(2100) }); assert.equal(tooBig.status, 413);
  const created = await api(app, '/api/rooms', p); assert.equal(created.status, 201);
  const forged = await api(app, `/api/rooms/${created.body.code}/join`, { ...p, token: 'a'.repeat(64) }); assert.equal(forged.status, 401);
  assert.equal((await api(app, `/api/rooms/${created.body.code}/leave`, { ...p, token: 'a'.repeat(64) })).status, 401);
  let rateLimited = false;
  for (let i = 0; i < 10; i++) if ((await api(app, '/api/rooms', p)).status === 429) { rateLimited = true; break; }
  assert.equal(rateLimited, true);
});

test('silent phone loss expires presence, and an unacknowledged vote is not replayed', async (t) => {
  const { app, clients, profiles, code } = await group(t);
  await clients[0].command('start'); await until(() => clients.every((c) => c.state.phase === 'vote'));
  const item = app.rooms.get(code);
  const originalSend = item.instance.send;
  let acceptedCommands = 0;
  item.instance.send = function (ws, payload) {
    if (payload.type === 'ack' && this.attachment(ws).id === profiles[1].id) { acceptedCommands++; return; }
    return originalSend.call(this, ws, payload);
  };
  const pending = clients[1].command('vote', { targetId: profiles[2].id });
  const rejection = assert.rejects(pending, (e) => e.code === 'DISCONNECTED');
  await until(() => clients[1].state.myVote.submitted);
  clients[1].stop(); await rejection;
  clients[1].start(); await until(() => clients[1].connectionStatus === 'connected');
  assert.equal(clients[1].state.myVote.targetId, profiles[2].id);
  assert.equal(acceptedCommands, 1);
  item.instance.send = originalSend;
  // Simulate a dropped mobile network with the server socket still open.
  await item.instance.serial(async () => {
    const socket = [...item.sockets].find((ws) => ws.deserializeAttachment().id === profiles[0].id);
    socket.serializeAttachment({ ...socket.deserializeAttachment(), seenAt: Date.now() - 46_000 });
  });
  await item.instance.alarm();
  await until(() => clients[2].state.members[0].connected === false);
  assert.ok(clients[2].state.hostMissingSince);
});

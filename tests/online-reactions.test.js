// تفاعلات الغرفة السريعة: طقم رموز ثابت يُبث لكل المقاعد الحاضرة دون حفظ أو لقطة جديدة،
// بدفعة صغيرة لكل مقعد، ولا يرسلها رسّام «ارسمها» أثناء دوره.
import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { startLocalServer } from '../server/local.mjs';
import { RoomClient, newCredentials } from '../src/online/client.js';
import { ROOM_REACTIONS, REACTION_BURST, reactionsAllowed } from '../src/online/shared.js';

const ORIGIN = 'http://localhost:3000';
class BrowserSocket extends WebSocket { constructor(url) { super(url, { origin: ORIGIN }); } }
async function until(fn, label = 'condition', timeout = 3500) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (fn()) return; await new Promise((resolve) => setTimeout(resolve, 10)); }
  assert.fail(`Timed out: ${label}`);
}
async function api(app, path, data) {
  const res = await fetch(app.url + path, { method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN }, body: JSON.stringify(data) });
  return { status: res.status, body: await res.json() };
}
async function room(t, count = 3) {
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
  return { app, clients, profiles, code };
}

test('a reaction reaches every seated phone without a new room snapshot', async (t) => {
  const { app, clients, profiles, code } = await room(t);
  const received = clients.map(() => []);
  clients.forEach((client, index) => client.subscribeReactions((event) => received[index].push(event)));
  const revision = clients[0].state.revision;
  const stored = JSON.stringify(app.rooms.get(code).instance.room);
  await clients[1].react('😂');
  await until(() => received.every((list) => list.length === 1), 'broadcast to all three');
  for (const list of received) {
    assert.equal(list[0].emoji, '😂');
    assert.equal(list[0].seatId, profiles[1].id);
    assert.equal(typeof list[0].id, 'string');
  }
  assert.equal(clients[0].state.revision, revision, 'no state broadcast');
  assert.equal(JSON.stringify(app.rooms.get(code).instance.room), stored, 'nothing written to the room');
});

test('only the fixed emoji set is accepted and each seat has a small burst', async (t) => {
  const { clients } = await room(t);
  await assert.rejects(clients[0].react('hello'), (e) => e.code === 'INVALID');
  await assert.rejects(clients[0].command('react', { emoji: '<b>' }), (e) => e.code === 'INVALID');
  const results = [];
  for (let n = 0; n < REACTION_BURST + 2; n++) results.push(await clients[2].react(ROOM_REACTIONS[n % ROOM_REACTIONS.length]).then(() => 'ok', (e) => e.code));
  assert.deepEqual(results.slice(0, REACTION_BURST), Array(REACTION_BURST).fill('ok'));
  assert.ok(results.slice(REACTION_BURST).every((code) => code === 'RATE_LIMIT'), JSON.stringify(results));
  // The limit is the seat's own: another phone can still react, and the throttled
  // seat keeps its connection and game commands.
  await clients[1].react('👏');
  assert.equal(clients[2].connectionStatus, 'connected');
  await clients[2].command('ready', { ready: true });
});

test('the Ersomha drawer cannot react while choosing or drawing; everyone else can', () => {
  const draw = (phase) => ({ game: 'ersomha', phase, draw: { drawerId: 'drawer' } });
  for (const phase of ['select', 'draw']) {
    assert.equal(reactionsAllowed(draw(phase), 'drawer'), false, phase);
    assert.equal(reactionsAllowed(draw(phase), 'guesser'), true, phase);
    // The client snapshot exposes the drawer as state.drawerId.
    assert.equal(reactionsAllowed({ game: 'ersomha', phase, drawerId: 'drawer' }, 'drawer'), false, phase);
  }
  for (const phase of ['lobby', 'result', 'over']) assert.equal(reactionsAllowed(draw(phase), 'drawer'), true, phase);
  assert.equal(reactionsAllowed({ game: 'fabraka', phase: 'vote' }, 'anyone'), true);
});

test('throttled valid reactions do not consume the game command budget or disconnect the seat', async (t) => {
  const { clients } = await room(t);
  for (let n = 0; n < 38; n++) {
    await clients[0].react('👏').catch((error) => assert.equal(error.code, 'RATE_LIMIT'));
  }
  assert.equal(clients[0].connectionStatus, 'connected');
  await clients[0].command('ready', { ready: true });
});

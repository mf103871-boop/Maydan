import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { startLocalServer } from '../server/local.mjs';
import { createUser } from '../server/accounts/db.mjs';
import { issueSession } from '../server/accounts/session.mjs';
import { newCredentials, RoomClient } from '../src/online/client.js';
import { ROOM_CAPABILITIES } from '../src/online/shared.js';

const origin = 'http://localhost:3000';
class BrowserSocket extends WebSocket { constructor(url) { super(url, { origin }); } }
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, label) { for (let n = 0; n < 350; n++) { if (predicate()) return; await delay(10); } assert.fail(label); }
async function fixture(t, { game = 'meenfina', visibility = 'public', count = 2, guest = false } = {}) {
  const app = await startLocalServer({ port: 0, vars: { ONLINE_PUBLIC_DIRECTORY_ENABLED: '1' } });
  t.after(() => app.close());
  const users = [];
  for (let n = 0; n < count; n++) {
    const user = await createUser(app.env, { name: `لاعب ${n}`, email: `${crypto.randomUUID()}@example.test` });
    const session = await issueSession(app.env, user.id);
    users.push({ ...user, session });
  }
  const seats = users.map((user, n) => ({ ...newCredentials(), name: `لاعب ${n}`, avatar: 0, capabilities: ROOM_CAPABILITIES }));
  const post = async (path, body, index) => {
    const response = await fetch(app.url + path, { method: 'POST', headers: { origin, 'content-type': 'application/json', ...(!guest ? { authorization: `Bearer ${users[index].session.token}` } : {}) }, body: JSON.stringify(body) });
    const result = await response.json();
    assert.equal(response.status, index === 0 ? 201 : 200, JSON.stringify(result));
    return result;
  };
  const { code } = await post('/api/rooms', { ...seats[0], game, rounds: 5, directory: { visibility, ...(visibility === 'public' ? { name: 'غرفة التدقيق' } : {}) } }, 0);
  for (let n = 1; n < count; n++) await post(`/api/rooms/${code}/join`, seats[n], n);
  const clients = users.map((user, index) => {
    const client = new RoomClient({ server: app.url, code, session: seats[index], getAccountAuthorization: () => guest ? null : `Bearer ${user.session.token}`, WebSocketImpl: BrowserSocket });
    t.after(() => client.stop()); client.start(); return client;
  });
  await until(() => clients.every(client => client.state?.members.every(member => member.connected)), 'both actual public sockets did not authenticate');
  return { app, users, seats, clients, code };
}

test('revoked passive public-room receiver cannot receive the next accepted game snapshot', async t => {
  const { app, users, clients } = await fixture(t), receiver = clients[1], frames = [];
  receiver.onState = state => frames.push(state);
  await app.env.DB.prepare('UPDATE sessions SET revoked_at=? WHERE id=?').bind(Date.now(), users[1].session.id).run();
  // The revoked receiver sends no action: an honest host changes the room.
  // Ping-only passive sockets must not retain account-required read access.
  receiver.ws.send('ping');
  await clients[0].command('ready', { ready: false });
  await delay(60);
  assert.equal(frames.length, 0, 'a revoked passive seat received a new authoritative state');
  assert.equal(receiver.ws?.readyState === WebSocket.OPEN, false, 'revoked account socket stayed open');
});

test('closing one revoked public socket preserves a fresh session for the same seat and account', async t => {
  const { app, users, clients, code, seats } = await fixture(t), old = clients[1];
  await app.env.DB.prepare('UPDATE sessions SET revoked_at=? WHERE id=?').bind(Date.now(), users[1].session.id).run();
  const fresh = await issueSession(app.env, users[1].id);
  const replacement = new RoomClient({ server: app.url, code, session: seats[1], getAccountAuthorization: () => `Bearer ${fresh.token}`, WebSocketImpl: BrowserSocket });
  t.after(() => replacement.stop()); replacement.start();
  await until(() => replacement.connectionStatus === 'connected', 'fresh replacement was not admitted');
  const before = replacement.state.revision;
  await clients[0].command('ready', { ready: false });
  await until(() => replacement.state.revision > before, 'new same-owner session did not receive the accepted room change');
  assert.equal(old.ws?.readyState === WebSocket.OPEN, false);
  assert.equal(replacement.state.members.find(member => member.id === seats[1].id).connected, true);
});

test('public recipient fencing leaves an unrelated authenticated peer connected', async t => {
  const { app, users, clients } = await fixture(t, { count: 3 }), victimFrames = [];
  clients[1].onState = state => victimFrames.push(state);
  const healthyRevision = clients[2].state.revision;
  await app.env.DB.prepare('UPDATE sessions SET revoked_at=? WHERE id=?').bind(Date.now(), users[1].session.id).run();
  await clients[0].command('ready', { ready: false });
  await until(() => clients[2].state.revision > healthyRevision, 'healthy peer lost fanout');
  assert.equal(victimFrames.length, 0);
  assert.equal(clients[2].connectionStatus, 'connected');
});

test('private Ersomha also retains its authenticated account binding for passive recipient revocation', async t => {
  const { app, users, clients } = await fixture(t, { game: 'ersomha', visibility: 'private' }), frames = [];
  clients[1].onState = state => frames.push(state);
  await app.env.DB.prepare('UPDATE sessions SET revoked_at=? WHERE id=?').bind(Date.now(), users[1].session.id).run();
  await clients[0].command('ready', { ready: false });
  await delay(50);
  assert.equal(frames.length, 0);
  assert.equal(clients[1].ws?.readyState === WebSocket.OPEN, false);
});

test('public ephemeral reactions cannot reach a revoked passive receiver', async t => {
  const { app, users, clients } = await fixture(t), reactions = [];
  clients[1].subscribeReactions(reaction => reactions.push(reaction));
  await app.env.DB.prepare('UPDATE sessions SET revoked_at=? WHERE id=?').bind(Date.now(), users[1].session.id).run();
  await clients[0].command('react', { emoji: '👏' });
  await delay(40);
  assert.equal(reactions.length, 0);
});

test('a known account expiry bounds the fast path and closes a ping-only receiver on advance', async t => {
  const { app, users, clients, code } = await fixture(t), instance = app.rooms.get(code).instance;
  const cutoff = Date.now() + 10_000;
  await app.env.DB.prepare('UPDATE sessions SET expires_at=? WHERE id=?').bind(cutoff, users[1].session.id).run();
  await instance.serial(() => instance.advance({ force: true }));
  assert.ok(instance.alarmAt(instance.room, Date.now()) <= cutoff, 'a long game/presence deadline hid the earlier account expiry');
  const frames = []; clients[1].onState = state => frames.push(state);
  t.mock.method(Date, 'now', () => cutoff + 1);
  await instance.serial(() => instance.advance());
  await delay(40);
  assert.equal(frames.length, 0);
  assert.equal(clients[1].ws?.readyState === WebSocket.OPEN, false);
  assert.equal(clients[0].connectionStatus, 'connected');
});

test('an ephemeral sender cannot overwrite a newly learned session cutoff or postpone its alarm', async t => {
  const { app, users, clients, code, seats } = await fixture(t), item = app.rooms.get(code);
  await clients[0].command('react', { emoji: '👏' }); // Warm the unchanged-room fast path.
  const cutoff = Date.now() + 10_000;
  await app.env.DB.prepare('UPDATE sessions SET revoked_at=? WHERE id=?').bind(cutoff, users[0].session.id).run();
  await clients[0].command('react', { emoji: '👏' });
  const socket = item.instance.sockets().find(ws => item.instance.attachment(ws).id === seats[0].id);
  assert.equal(item.instance.attachment(socket).accountExpiresAt, cutoff, 'reaction serialized an older account expiry over fresh authorization');
  assert.ok(item.storage.alarmAt <= cutoff, 'the short authenticated lifetime was not scheduled');
  assert.ok(item.instance.fastAdvanceUntil <= cutoff, 'warm ping fast path outlived the newly known authorization cutoff');
});

test('account lookup failure withholds new fanout and recovers without cancelling the match', async t => {
  const { app, clients, code } = await fixture(t), DB = app.env.DB, frames = [], before = clients[0].state.revision;
  clients[1].onState = state => frames.push(state);
  app.env.DB = new Proxy(DB, { get(target, key) {
    if (key === 'prepare') return sql => {
      if (/SELECT id,user_id,expires_at,revoked_at FROM sessions WHERE id IN/.test(sql)) throw new Error('audit account lookup unavailable');
      return target.prepare(sql);
    };
    const value = target[key]; return typeof value === 'function' ? value.bind(target) : value;
  } });
  await assert.rejects(clients[0].command('ready', { ready: false }), { code: 'INTERNAL' });
  assert.equal(frames.length, 0);
  assert.equal(app.rooms.get(code).instance.room.phase, 'lobby');
  assert.equal(app.rooms.get(code).instance.room.revision, before);
  app.env.DB = DB;
  await clients[0].command('ready', { ready: false });
  await until(() => frames.some(state => state.revision > before), 'healthy room did not resume after lookup recovery');
  assert.equal(clients[1].connectionStatus, 'connected');
});

test('truly anonymous private rooms do not acquire an account or D1-session dependency', async t => {
  const { app, clients } = await fixture(t, { visibility: 'private', guest: true }), DB = app.env.DB, before = clients[1].state.revision;
  app.env.DB = new Proxy(DB, { get(target, key) {
    if (key === 'prepare') return sql => { if (/FROM sessions/.test(sql)) throw Error('guest must not read session'); return target.prepare(sql); };
    const value = target[key]; return typeof value === 'function' ? value.bind(target) : value;
  } });
  await clients[0].command('ready', { ready: false });
  await until(() => clients[1].state.revision > before, 'guest private peer lost ordinary room access');
  app.env.DB = DB;
});

test('revocation during durable room storage cannot receive the newly committed protected phase', async t => {
  const { app, users, clients, code } = await fixture(t, { game: 'fabraka', count: 3 });
  for (const client of clients.slice(1)) await client.command('ready', { ready: true });
  const frames = []; clients[1].onState = state => { if (state.phase !== 'lobby') frames.push(state); };
  const item = app.rooms.get(code), put = item.storage.put.bind(item.storage); let revoked = false;
  item.storage.put = async (key, value) => {
    if (!revoked && key === 'room' && value.phase !== 'lobby') {
      revoked = true;
      await app.env.DB.prepare('UPDATE sessions SET revoked_at=? WHERE id=?').bind(Date.now() - 1, users[1].session.id).run();
    }
    return put(key, value);
  };
  await clients[0].command('start'); await delay(50);
  assert.equal(revoked, true);
  assert.equal(frames.length, 0, 'a session revoked during durable storage received protected post-commit state');
  assert.equal(item.instance.room.phase, 'write');
  assert.equal(clients[2].state.phase, 'write', 'healthy authorized receiver lost the committed phase');
});

test('post-durable account outage withholds fanout, keeps accepted state and recovers after object rehydration', async t => {
  const { app, clients, code } = await fixture(t, { game: 'fabraka', count: 3 });
  for (const client of clients.slice(1)) await client.command('ready', { ready: true });
  const frames = []; clients[1].onState = state => { if (state.phase !== 'lobby') frames.push(state); };
  const item = app.rooms.get(code), DB = app.env.DB, put = item.storage.put.bind(item.storage);
  let outage = false;
  app.env.DB = new Proxy(DB, { get(target, key) {
    if (key === 'prepare') return sql => {
      if (outage && /SELECT id,user_id,expires_at,revoked_at FROM sessions WHERE id IN/.test(sql)) throw Error('post-durable account lookup outage');
      return target.prepare(sql);
    };
    const value = target[key]; return typeof value === 'function' ? value.bind(target) : value;
  } });
  item.storage.put = async (key, value) => {
    if (key === 'room' && value.phase === 'write') outage = true;
    return put(key, value);
  };
  const accepted = await clients[0].command('start');
  assert.equal(accepted.ok, true, 'a post-commit read failure rejected an accepted command');
  await delay(35);
  assert.equal(frames.length, 0);
  assert.equal(item.instance.room.phase, 'write');
  assert.equal(item.storage.data.get('room').phase, 'write');
  assert.equal(item.instance.room.reason, null);
  assert.ok(item.storage.alarmAt <= Date.now() + 5_000, 'withheld publication has no bounded retry');
  await assert.doesNotReject(item.instance.alarm(), 'a continuing post-commit outage lost its publication retry');
  assert.ok(item.storage.alarmAt > Date.now() && item.storage.alarmAt <= Date.now() + 5_000);
  outage = false; app.env.DB = DB;
  await app.rehydrate(code);
  await item.instance.alarm();
  await until(() => frames.some(state => state.phase === 'write'), 'rehydrated object did not recover its committed publication');
  assert.equal(item.instance.room.phase, 'write');
  assert.equal(item.instance.accountPublicationPending, false);
});

test('drawing recipient revocation during its journal write is fenced with two fixed warm-path account reads', async t => {
  const { app, users, clients, code, seats } = await fixture(t, { game: 'ersomha', visibility: 'private' });
  await clients[1].command('ready', { ready: true }); await clients[0].command('start');
  await until(() => clients.every(client => client.state.phase === 'select'), 'drawing selection did not begin');
  const drawerIndex = seats.findIndex(seat => seat.id === clients[0].state.drawerId), receiverIndex = 1 - drawerIndex;
  const drawer = clients[drawerIndex], receiver = clients[receiverIndex];
  await drawer.command('select_word', { choiceId: drawer.state.myChoices[0].id });
  await until(() => clients.every(client => client.state.phase === 'draw'), 'drawing did not begin');
  await drawer.command('drawing_sync'); // Warm unchanged-room cache before counting.
  const item = app.rooms.get(code), DB = app.env.DB, put = item.storage.put.bind(item.storage), frames = [];
  receiver.subscribeDrawing(event => frames.push(event));
  let revoked = false, sessionReads = 0, recipientReads = 0, readsAtAcceptance;
  const send = item.instance.send.bind(item.instance);
  item.instance.send = (socket, message) => {
    if (message.type === 'ack' && message.ok === true && message.drawing?.seq === 1) readsAtAcceptance = { sessionReads, recipientReads };
    return send(socket, message);
  };
  app.env.DB = new Proxy(DB, { get(target, key) {
    if (key === 'prepare') return sql => {
      if (/SELECT .*FROM sessions WHERE/.test(sql)) { sessionReads++; if (/WHERE id IN/.test(sql)) recipientReads++; }
      return target.prepare(sql);
    };
    const value = target[key]; return typeof value === 'function' ? value.bind(target) : value;
  } });
  item.storage.put = async (key, value) => {
    if (!revoked && key.startsWith('ersomha:board:') && value?.type === 'drawing') {
      revoked = true;
      await DB.prepare('UPDATE sessions SET revoked_at=? WHERE id=?').bind(Date.now() - 1, users[receiverIndex].session.id).run();
    }
    return put(key, value);
  };
  const accepted = await drawer.command('drawing_batch', { epoch: drawer.state.drawing.epoch, strokeId: 'audit-stroke', tool: 'pen', color: '#118d96', width: 6, points: [[0.2, 0.3]], end: true });
  // The transport observer captured this command's ACK before asynchronous
  // socket-close presence reconciliation, independently of browser scheduling.
  await delay(40);
  assert.equal(revoked, true);
  assert.equal(accepted.ok, true);
  assert.equal(item.instance.drawing.seq, 1, 'accepted stroke was not durable');
  assert.equal(frames.length, 0, 'revoked receiver saw a post-storage drawing delta');
  assert.deepEqual(readsAtAcceptance, { sessionReads: 2, recipientReads: 1 }, 'drawing authorization became per-viewer or duplicated its batch');
  app.env.DB = DB;
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { startLocalServer } from '../server/local.mjs';
import { createUser } from '../server/accounts/db.mjs';
import { issueSession } from '../server/accounts/session.mjs';
import { run } from '../server/lamma/common.mjs';
import { subscribePublicRooms } from '../src/online/client.js';

const origin = 'http://localhost:3000';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, description) {
  for (let n = 0; n < 300; n++) {
    if (predicate()) return;
    await delay(10);
  }
  assert.fail(description);
}
async function setup(t) {
  // Explicit vars prevent local developer credentials being read by this test.
  const app = await startLocalServer({ port: 0, vars: { MAFIA_ENABLED: '1' } });
  const sockets = [], frames = [], sent = [];
  class Socket extends WebSocket {
    constructor(url) {
      super(url, { origin });
      sockets.push(this);
      this.on('message', bytes => frames.push({ socket: this, text: String(bytes) }));
    }
    send(message, ...args) { sent.push(String(message)); return super.send(message, ...args); }
  }
  t.after(async () => { sockets.forEach(socket => socket.terminate()); await app.close(); });
  const user = await createUser(app.env, { name: 'اختبار الدليل', email: `${crypto.randomUUID()}@example.test` });
  const session = await issueSession(app.env, user.id);
  const connect = () => new Socket(app.url.replace('http:', 'ws:') + '/api/rooms/public/stream');
  const ready = () => frames.some(frame => frame.text.includes('directory-ready'));
  return { app, sockets, frames, sent, Socket, session, connect, ready };
}

test('the actual directory subscriber survives three heartbeats, then receives invalidation and session revocation', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const h = await setup(t);
  let invalidations = 0;
  const stop = subscribePublicRooms(h.app.url, {
    getAccountAuthorization: () => `Bearer ${h.session.token}`,
    WebSocketImpl: h.Socket,
    onInvalidate: () => invalidations++,
  });
  t.after(stop);
  await until(h.ready, 'subscriber did not authenticate');
  const socket = h.sockets[0];
  for (let n = 1; n <= 3; n++) {
    t.mock.timers.tick(25_000);
    await until(() => h.frames.filter(frame => frame.text === 'pong').length === n, `heartbeat ${n} was rejected`);
    assert.equal(socket.readyState, WebSocket.OPEN);
    assert.equal(h.sockets.length, 1, 'heartbeat must not cycle authenticated connections');
  }
  const item = h.app.rooms.get('mafia:directory:ar');
  await item.instance.directoryFeed.invalidate();
  item.instance.directoryFeed.state.pendingAt = Date.now() - 1;
  await item.instance.alarm();
  await until(() => invalidations === 1, 'subscriber missed invalidation after heartbeats');
  const invalidation = JSON.parse(h.frames.find(frame => frame.text.includes('directory-invalidated')).text);
  assert.deepEqual(Object.keys(invalidation).sort(), ['revision', 'type'], 'feed must carry no room or player payload');
  await run(h.app.env, 'UPDATE sessions SET revoked_at=? WHERE id=?', Date.now(), h.session.id);
  await item.instance.alarm();
  await until(() => socket.readyState === WebSocket.CLOSED, 'revoked directory session stayed connected');
  assert.equal(h.sent.filter(message => message === 'ping').length, 3, 'use the same plain heartbeat as the hibernating socket auto-response');
});

test('already shipped directory clients may send a JSON heartbeat after authentication', async t => {
  const h = await setup(t), socket = h.connect();
  await new Promise(resolve => socket.once('open', resolve));
  socket.send(JSON.stringify({ type: 'auth', accountAuthorization: `Bearer ${h.session.token}` }));
  await until(h.ready, 'legacy client did not authenticate');
  socket.send(JSON.stringify({ type: 'ping' }));
  await until(() => h.frames.some(frame => frame.text === 'pong'), 'legacy JSON heartbeat was rejected');
  assert.equal(socket.readyState, WebSocket.OPEN);
});

test('a JSON heartbeat cannot substitute for directory authentication', async t => {
  const h = await setup(t), socket = h.connect();
  await new Promise(resolve => socket.once('open', resolve));
  const closed = new Promise(resolve => socket.once('close', (code) => resolve(code)));
  socket.send(JSON.stringify({ type: 'ping' }));
  assert.equal(await closed, 4401);
  assert.deepEqual(h.frames, [], 'no directory revision or pong before authentication');
});

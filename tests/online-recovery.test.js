import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomClient } from '../src/online/client.js';

function fixture(t, extras = {}) {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 1_000_000 });
  const sockets = [], errors = [];
  class Socket {
    constructor(url) { this.url = url; this.readyState = 0; this.sent = []; this.bufferedAmount = 0; sockets.push(this); }
    send(value) { this.sent.push(value === 'ping' ? value : JSON.parse(value)); }
    close() { this.readyState = 3; } // Deliberately never fires close: suspended iOS/TCP.
    open() { this.readyState = 1; this.onopen(); }
    receive(message) { this.onmessage({ data: message === 'pong' ? message : JSON.stringify(message) }); }
    state(game = 'meenfina') { this.receive({ type: 'state', state: { game, protocol: 1, matchId: 1, round: 1, revision: 1, serverNow: Date.now() } }); }
  }
  const client = new RoomClient({ server: 'http://localhost:3000', code: '123456', session: { id: 'seat', token: 'token' }, WebSocketImpl: Socket, onError: e => errors.push(e), ...extras });
  t.after(() => client.stop()); client.start();
  return { client, sockets, errors };
}

test('foreground probes a half-open socket once and replaces it within three seconds without waiting for close', t => {
  const { client, sockets } = fixture(t), old = sockets[0]; old.open(); old.state();
  client.wake(); client.wake(); assert.equal(old.sent.filter(m => m === 'ping').length, 1);
  t.mock.timers.tick(2_999); assert.equal(sockets.length, 1);
  t.mock.timers.tick(1); assert.equal(sockets.length, 2); assert.equal(client.connectionStatus, 'reconnecting');
  sockets[1].open(); sockets[1].state();
  old.onclose({ code: 1006 }); assert.equal(client.connectionStatus, 'connected');
  old.receive({ type: 'error', error: 'AUTH' }); assert.equal(client.stopped, false);
});

test('a healthy wake response keeps the same socket and does not replay commands', async t => {
  const { client, sockets } = fixture(t), socket = sockets[0]; socket.open(); socket.state();
  const command = client.command('vote', { targetId: 'other' }), id = socket.sent.at(-1).requestId;
  client.wake(); socket.receive('pong'); t.mock.timers.tick(3_000);
  assert.equal(sockets.length, 1); assert.equal(client.pending.size, 1);
  socket.receive({ type: 'ack', requestId: id, ok: true }); await command;
  assert.equal(socket.sent.filter(m => m.type === 'vote').length, 1);
});

test('network return bypasses reconnect backoff and repeated start never opens duplicate controlling sockets', t => {
  const { client, sockets } = fixture(t), old = sockets[0]; old.open(); old.state();
  client.start(); old.receive('pong'); assert.equal(sockets.length, 1);
  client.attempt = 5; old.readyState = 3; old.onclose({ code: 1006 });
  client.wake(); assert.equal(sockets.length, 2);
  sockets[1].open(); sockets[1].state(); t.mock.timers.tick(10_200); assert.equal(sockets.length, 2);
});

test('stalled handshake recovers even when close never fires, and stop cancels foreground probes', t => {
  const { client, sockets } = fixture(t);
  t.mock.timers.tick(12_000); assert.equal(sockets.length, 2);
  sockets[1].open(); sockets[1].state(); client.wake(); client.stop();
  t.mock.timers.tick(60_000); assert.equal(sockets.length, 2);
});

test('repeated foreground/start signals during account authentication do not send unauthenticated pings', t => {
  const { client, sockets } = fixture(t); sockets[0].open();
  client.wake(); client.start(); t.mock.timers.tick(3_000);
  assert.equal(sockets.length, 1); assert.equal(sockets[0].sent.length, 1); assert.equal(sockets[0].sent[0].type, 'auth');
  t.mock.timers.tick(9_000); assert.equal(sockets.length, 2, 'original handshake timeout still recovers');
});

test('recovered Ersomha sends only the latest account bearer in its first frame and never persists it', t => {
  let authorization = 'Bearer before', reads = 0;
  const { client, sockets } = fixture(t, { getAccountAuthorization: () => { reads++; return authorization; } });
  sockets[0].open(); assert.equal(reads, 0); sockets[0].state('ersomha');
  authorization = 'Bearer fresh'; sockets[0].readyState = 3; client.wake(); sockets[1].open();
  assert.equal(sockets[1].sent[0].accountAuthorization, authorization); assert.equal(reads, 1);
  assert.equal(sockets[1].url.includes('Bearer'), false); assert.equal(client.session.accountAuthorization, undefined);
  sockets[1].state('ersomha'); authorization = null; sockets[1].readyState = 3; client.wake(); sockets[2].open();
  assert.equal(client.connectionStatus, 'ended'); assert.equal(sockets[2].sent.length, 0);
});

test('Mafia challenges authenticate with the current account and phase-bound commands retain the rendered fence', async t => {
  let authorization='Bearer first';
  const {client,sockets}=fixture(t,{getAccountAuthorization:()=>authorization}),socket=sockets[0];socket.open();
  socket.receive({type:'account-auth',game:'mafia'});
  assert.equal(socket.sent.at(-1).accountAuthorization,'Bearer first');
  socket.receive({type:'state',state:{game:'mafia',protocol:1,matchId:3,phaseId:8,round:2,revision:1,serverNow:Date.now()}});
  const sent=client.command('nominate',{targetId:'other',matchId:3,phaseId:7}),frame=socket.sent.at(-1);
  assert.equal(frame.phaseId,7,'a changed phase must reject rather than silently retarget a vote');
  assert.equal(frame.matchId,3);socket.receive({type:'ack',requestId:frame.requestId,ok:false,error:'STALE'});
  await assert.rejects(sent,{code:'STALE'});
  authorization='Bearer refreshed';socket.readyState=3;client.wake();sockets[1].open();
  assert.equal(sockets[1].sent[0].accountAuthorization,'Bearer refreshed');
  assert.equal(sockets[1].url.includes('Bearer'),false);assert.equal(client.session.accountAuthorization,undefined);
});

test('send congestion and unacknowledged commands are bounded and recover without replaying uncertain actions', async t => {
  const { client, sockets } = fixture(t); sockets[0].open(); sockets[0].state();
  const commands = Array.from({ length: 32 }, () => client.command('vote', { targetId: 'other' }).catch(e => e.code));
  assert.equal(client.pending.size, 32);
  await assert.rejects(client.command('vote'), e => e.code === 'DISCONNECTED');
  assert.deepEqual(await Promise.all(commands), Array(32).fill('DISCONNECTED'));
  assert.equal(sockets.length, 2); assert.equal(client.pending.size, 0);
  sockets[1].open(); sockets[1].state(); assert.equal(sockets[1].sent.filter(m => m.type === 'vote').length, 0);
  sockets[1].bufferedAmount = 65_537;
  await assert.rejects(client.command('next'), e => e.code === 'DISCONNECTED'); assert.equal(sockets.length, 3);
});

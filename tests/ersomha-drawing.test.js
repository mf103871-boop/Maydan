import test from 'node:test';
import assert from 'node:assert/strict';
import { ERSOMHA_PALETTE, drawingPoint, createDrawingState, applyDrawingEvent, paintDrawing } from '../src/games/ersomha/drawing.js';
import { RoomClient } from '../src/online/client.js';
import { ROOM_CAPABILITIES } from '../src/online/shared.js';

const op = (strokeId, points = [[0.1, 0.2]], end = true) => ({ strokeId, points, end, tool: 'pen', color: ERSOMHA_PALETTE[0], width: 6 });
test('drawing new ink after undo discards the redo branch exactly like the server', () => {
  const model = createDrawingState(1);
  applyDrawingEvent(model, { kind: 'append', epoch: 1, seq: 1, op: op('first') });
  applyDrawingEvent(model, { kind: 'append', epoch: 1, seq: 2, op: op('second') });
  applyDrawingEvent(model, { kind: 'undo', epoch: 1, seq: 3, strokeId: 'second' });
  assert.equal(model.undoneIds.has('second'), true);
  applyDrawingEvent(model, { kind: 'append', epoch: 1, seq: 4, op: op('replacement') });
  assert.deepEqual([...model.undoneIds], []);
  assert.deepEqual([...model.strokes.keys()], ['first', 'replacement']);
});
test('drawing coordinates clamp to the same square on any screen without nonfinite input', () => {
  assert.deepEqual(drawingPoint({ clientX: 110, clientY: 60 }, { left: 10, top: 10, width: 200, height: 100 }), [.5, .5]);
  assert.deepEqual(drawingPoint({ clientX: -10, clientY: 600 }, { left: 0, top: 0, width: 100, height: 100 }), [0, 1]);
  assert.equal(drawingPoint({ clientX: NaN, clientY: 1 }, { left: 0, top: 0, width: 100, height: 100 }), null);
  assert.equal(drawingPoint({}, { width: 0, height: 100 }), null);
});
test('authoritative sequence ignores duplicate, stale and gapped deltas and recovers through a split-stroke snapshot', () => {
  const model = createDrawingState(1);
  assert.equal(applyDrawingEvent(model, { kind: 'append', epoch: 1, seq: 1, op: op('a', [[.1, .1]], false) }), true);
  assert.equal(applyDrawingEvent(model, { kind: 'append', epoch: 1, seq: 1, op: op('a') }), false);
  assert.equal(applyDrawingEvent(model, { kind: 'append', epoch: 1, seq: 3, op: op('a') }), false);
  assert.equal(applyDrawingEvent(model, { kind: 'append', epoch: 0, seq: 2, op: op('a') }), false);
  assert.equal(model.strokes.get('a').points.length, 1);
  applyDrawingEvent(model, { kind: 'append', epoch: 1, seq: 2, closedStrokeId: 'a', op: op('new') });
  assert.equal(model.strokes.get('a').end, true, 'A resumed drawer can undo a stroke whose final packet was interrupted');
  assert.equal(applyDrawingEvent(model, { kind: 'sync', epoch: 1, seq: 8, ops: [op('a', [[.1, .1]], false), op('a', [[.2, .2]], true), op('b')], undoneIds: ['b'] }), true);
  assert.deepEqual(model.strokes.get('a').points, [[.1, .1], [.2, .2]]);
  assert.equal(model.strokes.get('a').end, true); assert.equal(model.undoneIds.has('b'), true);
  applyDrawingEvent(model, { kind: 'redo', epoch: 1, seq: 9, strokeId: 'b' }); assert.equal(model.undoneIds.has('b'), false);
  applyDrawingEvent(model, { kind: 'undo', epoch: 1, seq: 10, strokeId: 'a' }); assert.equal(model.undoneIds.has('a'), true);
  applyDrawingEvent(model, { kind: 'clear', epoch: 2, seq: 0 }); assert.equal(model.strokes.size, 0); assert.equal(model.epoch, 2);
});
test('optimistic strokes replace echoed segments and actual erasure removes pixels during replay', () => {
  const operations = [], context = { save() {}, restore() {}, clearRect() { operations.push('clear'); }, beginPath() {}, moveTo() {}, lineTo() {}, arc() {}, fill() { operations.push(this.globalCompositeOperation); }, stroke() { operations.push(this.globalCompositeOperation); } };
  const model = createDrawingState(1); model.strokes.set('a', op('a')); model.strokes.set('b', { ...op('b'), tool: 'eraser' });
  paintDrawing(context, model, new Map([['a', op('a', [[0, 0], [1, 1]])]]));
  assert.deepEqual(operations, ['clear', 'destination-out', 'source-over']);
});

test('only an Ersomha account challenge reads the current bearer and logout cannot reuse a stale value', () => {
  class FakeSocket {
    constructor(url) { this.url = url; this.readyState = 1; this.sent = []; FakeSocket.current = this; }
    send(value) { this.sent.push(JSON.parse(value)); }
    close() { this.readyState = 3; }
    receive(value) { this.onmessage({ data: JSON.stringify(value) }); }
  }
  let authorization = 'Bearer first-account', reads = 0; const errors = [];
  const client = new RoomClient({ server: 'http://localhost:3000', code: '123456', session: { id: 'seat', token: 'seat-token' },
    WebSocketImpl: FakeSocket, getAccountAuthorization: () => { reads++; return authorization; }, onError: error => errors.push(error) });
  try {
    client.start(); let socket = FakeSocket.current; socket.onopen();
    assert.equal(reads, 0, 'legacy seat authentication remains unchanged');
    assert.equal(socket.sent[0].accountAuthorization, undefined);
    authorization = 'Bearer latest-account';
    socket.receive({ type: 'account-auth', game: 'ersomha' });
    assert.equal(socket.sent.at(-1).accountAuthorization, authorization);
    assert.equal(reads, 1); assert.equal(socket.url.includes('Bearer'), false);
    client.stop(); authorization = null; client.start(); socket = FakeSocket.current; socket.onopen();
    socket.receive({ type: 'account-auth', game: 'ersomha' });
    assert.equal(client.connectionStatus, 'ended'); assert.deepEqual(errors, ['AUTH_REQUIRED']);
    assert.equal(socket.sent.length, 1, 'the signed-out reconnect sends no cached bearer');
  } finally { client.stop(); }
});

test('room transport advertises Ersomha support and isolates drawing events from full state and obsolete rounds', async () => {
  class FakeSocket {
    constructor() { this.readyState = 1; this.sent = []; FakeSocket.current = this; }
    send(value) { this.sent.push(JSON.parse(value)); }
    close() { this.readyState = 3; }
    receive(message) { this.onmessage({ data: JSON.stringify(message) }); }
  }
  const states = [], events = [], errors = [];
  const client = new RoomClient({ server: 'http://localhost:3000', code: '123456', session: { id: 'id', token: 'private-token' }, WebSocketImpl: FakeSocket, onState: state => states.push(state), onError: code => errors.push(code) });
  client.start(); const socket = FakeSocket.current;
  try {
    socket.onopen(); assert.deepEqual(socket.sent[0].capabilities, ROOM_CAPABILITIES);
    socket.receive({ type: 'state', state: { game: 'ersomha', protocol: 1, matchId: 'match', round: 2, revision: 1, serverNow: Date.now() } });
    const unsubscribe = client.subscribeDrawing(event => events.push(event));
    socket.receive({ type: 'drawing', kind: 'sync', epoch: 1, seq: 1, matchId: 'old', round: 2, ops: [] });
    socket.receive({ type: 'drawing', kind: 'sync', epoch: 1, seq: 1, matchId: 'match', round: 1, ops: [] });
    socket.receive({ type: 'drawing', kind: 'append', epoch: 1, seq: 1, matchId: 'match', round: 2, op: op('a') });
    assert.equal(events.length, 1); assert.equal(states.length, 1);
    const command = client.command('drawing_batch', { epoch: 1, ...op('a') });
    const sent = socket.sent.at(-1); assert.equal(sent.matchId, 'match'); assert.equal(sent.round, 2);
    socket.receive({ type: 'ack', requestId: sent.requestId, ok: true, seq: 1 }); assert.equal((await command).seq, 1);
    unsubscribe(); socket.receive({ type: 'drawing', kind: 'append', epoch: 1, seq: 2, matchId: 'match', round: 2, op: op('b') }); assert.equal(events.length, 1);
    socket.receive({ type: 'state', state: { game: 'unrecognized', protocol: 1, revision: 2 } }); assert.deepEqual(errors, ['CONFIG']); assert.equal(client.connectionStatus, 'ended');
  } finally { client.stop(); }
});

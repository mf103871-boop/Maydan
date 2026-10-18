import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareErsomhaDrawing, emptyErsomhaDrawing, persistErsomhaDrawing, loadErsomhaDrawing,
  checkpointErsomhaDrawing, ersomhaSyncMessages, ersomhaVisibleCanvas, ERSOMHA_MAX_POINTS } from '../server/ersomha-drawing.mjs';

class Storage {
  constructor() { this.data = new Map(); this.writes = []; this.fail = null; }
  async get(key) { return structuredClone(this.data.get(key)); }
  async put(key, value) { if (this.fail === key) throw new Error('storage unavailable'); this.writes.push([key, JSON.stringify(value).length]); this.data.set(key, structuredClone(value)); }
  async delete(key) { this.data.delete(key); }
  async transaction(fn) { const before = structuredClone(this.data); try { return await fn(this); } catch (e) { this.data = before; throw e; } }
}
const room = () => ({ game: 'ersomha', matchId: 1, round: 1, phase: 'draw', draw: { drawerId: 'p0', pauseUntil: null } });
const batch = (id, extra = {}) => ({ type: 'drawing_batch', requestId: `request-${id}`, matchId: 1, round: 1, epoch: 1,
  strokeId: `stroke-${id}`, points: [[0.1, 0.2], [0.3, 0.4]], color: '#118d96', width: 6, tool: 'pen', end: true, ...extra });
const rejects = (code, fn) => assert.throws(fn, e => e.code === code);
async function apply(storage, state, command) {
  const change = prepareErsomhaDrawing(room(), state.board, 'p0', command);
  if (change.duplicate || change.sync) return state;
  const head = await persistErsomhaDrawing(storage, change.board, change.event, state.head);
  return { board: change.board, head };
}
test('drawing validates authority, phase, epoch, finite normalized points, palette and tools', () => {
  const current = emptyErsomhaDrawing(room());
  rejects('ERSOMHA_DRAWER_ONLY', () => prepareErsomhaDrawing(room(), current, 'p1', batch(1)));
  rejects('STALE', () => prepareErsomhaDrawing(room(), current, 'p0', batch(1, { round: 2 })));
  rejects('ERSOMHA_CANVAS_STALE', () => prepareErsomhaDrawing(room(), current, 'p0', batch(1, { epoch: 9 })));
  rejects('PHASE', () => prepareErsomhaDrawing({ ...room(), phase: 'result' }, current, 'p0', batch(1)));
  rejects('PHASE', () => prepareErsomhaDrawing({ ...room(), draw: { drawerId: 'p0', pauseUntil: 999 } }, current, 'p0', batch(1)));
  for (const patch of [{ points: [[Infinity, 0]] }, { points: [[0, -0.1]] }, { points: [[0, 1.01]] }, { width: 1000 }, { tool: 'svg' }, { color: 'url(secret)' }, { strokeId: '<svg>' }, { points: Array.from({ length: 33 }, () => [0, 0]) }]) {
    rejects('INVALID', () => prepareErsomhaDrawing(room(), current, 'p0', batch(1, patch)));
  }
});
test('delta journal, undo/redo and clear survive reconstruction and stale pre-clear packets are rejected', async () => {
  const storage = new Storage(); let state = { board: emptyErsomhaDrawing(room()), head: null };
  state = await apply(storage, state, batch(1)); state = await apply(storage, state, batch(2, { tool: 'eraser', color: '#ffffff' }));
  state = await apply(storage, state, { ...batch(3), type: 'drawing_undo' }); assert.deepEqual(state.board.undoneIds, ['stroke-2']);
  state = await loadErsomhaDrawing(storage, room()); assert.equal(ersomhaVisibleCanvas(state.board).strokes.length, 1);
  state = await apply(storage, state, { ...batch(4), type: 'drawing_redo' }); assert.equal(ersomhaVisibleCanvas(state.board).strokes.length, 2);
  state = await apply(storage, state, { ...batch(5), type: 'drawing_clear' }); assert.equal(state.board.epoch, 2); assert.equal(state.board.seq, 0);
  const restored = await loadErsomhaDrawing(storage, room()); assert.deepEqual(restored.board, state.board);
  rejects('ERSOMHA_CANVAS_STALE', () => prepareErsomhaDrawing(room(), restored.board, 'p0', batch(6)));
});
test('a failed persistent delta never changes the published board, sequence or dedup receipt', async () => {
  const storage = new Storage(); const board = emptyErsomhaDrawing(room());
  const head = await checkpointErsomhaDrawing(storage, board); const change = prepareErsomhaDrawing(room(), board, 'p0', batch(1));
  storage.fail = 'ersomha:board'; await assert.rejects(persistErsomhaDrawing(storage, change.board, change.event, head), /unavailable/);
  const restored = await loadErsomhaDrawing(storage, room()); assert.equal(restored.board.seq, 0); assert.equal(restored.board.strokes.length, 0); assert.deepEqual(restored.board.receipts, []);
  storage.fail = null; const saved = await apply(storage, { board, head }, batch(1));
  assert.equal(saved.board.seq, 1); assert.equal(prepareErsomhaDrawing(room(), saved.board, 'p0', batch(1)).duplicate, true);
});
test('compaction bounds the durable delta log and resync fragments long strokes without losing points', async () => {
  const storage = new Storage(); let state = { board: emptyErsomhaDrawing(room()), head: null };
  for (let n = 0; n < 100; n++) state = await apply(storage, state, batch(n, { strokeId: 'long-stroke', end: n === 99,
    points: Array.from({ length: 32 }, (_, i) => [(n * 32 + i) / 3200, (i % 10) / 10]) }));
  assert.ok(state.head.log.length <= 64);
  state.head = await checkpointErsomhaDrawing(storage, state.board, state.head); assert.ok(state.head.parts.length > 1);
  assert.ok(storage.writes.filter(([key]) => key.includes('checkpoint')).every(([, bytes]) => bytes < 32_000));
  const restored = await loadErsomhaDrawing(storage, room()); assert.deepEqual(restored.board, state.board);
  const sync = ersomhaSyncMessages(room(), restored.board); assert.ok(sync.length > 1);
  assert.equal(sync.flatMap(m => m.ops).reduce((n, op) => n + op.points.length, 0), 3200);
  assert.ok(sync.every(m => JSON.stringify(m).length < 16_000));
  assert.ok(storage.writes.every(([key]) => key !== 'room'), 'drawing never rewrites the complete room');
});
test('new drawing discards redo history, and point/stroke limits cannot grow memory without bound', () => {
  const current = emptyErsomhaDrawing(room());
  current.strokes = [{ ...batch(1), points: Array.from({ length: ERSOMHA_MAX_POINTS }, () => [0, 0]), end: true }];
  current.pointCount = ERSOMHA_MAX_POINTS;
  rejects('ERSOMHA_CANVAS_LIMIT', () => prepareErsomhaDrawing(room(), current, 'p0', batch(2)));
  current.undoneIds = [current.strokes[0].strokeId];
  const next = prepareErsomhaDrawing(room(), current, 'p0', batch(2));
  assert.equal(next.board.strokes.length, 1); assert.deepEqual(next.board.undoneIds, []); assert.equal(next.board.pointCount, 2);
});
test('a new stroke after a mid-stroke reconnect closes the unfinished stroke instead of trapping the drawer', async () => {
  const storage = new Storage(); let state = { board: emptyErsomhaDrawing(room()), head: null };
  state = await apply(storage, state, batch(1, { end: false })); state = await loadErsomhaDrawing(storage, room());
  state = await apply(storage, state, batch(2));
  assert.equal(state.board.strokes.length, 2); assert.ok(state.board.strokes.every(stroke => stroke.end));
  const restored = await loadErsomhaDrawing(storage, room()); assert.deepEqual(restored.board, state.board);
});

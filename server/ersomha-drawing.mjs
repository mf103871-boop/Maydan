import { fail } from './room-model.mjs';

export const ERSOMHA_PALETTE = ['#35224a', '#ffffff', '#118d96', '#9250bd', '#ed6a5a', '#f4b942', '#64a66f', '#3b72b8', '#f08db4', '#8a563d', '#ef8a38', '#83929b'];
export const ERSOMHA_MAX_POINTS = 8192;
export const ERSOMHA_MAX_STROKES = 200;
const HEAD = 'ersomha:board';
const MAX_LOG = 64;
const PART_SIZE = 28_000;
export const ersomhaBoardId = room => `${room.matchId}:${room.round}`;
export function emptyErsomhaDrawing(room) {
  return { boardId: ersomhaBoardId(room), epoch: 1, seq: 0, strokes: [], undoneIds: [], pointCount: 0, receipts: [] };
}
const keyOf = (board, suffix) => `ersomha:board:${board.boardId}:${suffix}`;
const metaOf = board => ({ epoch: board.epoch, seq: board.seq });
export const ersomhaDrawingMeta = metaOf;
async function erase(storage, keys) {
  for (const key of keys || []) if (storage.delete) await storage.delete(key); else await storage.put(key, null);
}
function apply(board, event) {
  if (event.kind === 'append') {
    if (event.closedStrokeId) { const closed = board.strokes.find(s => s.strokeId === event.closedStrokeId); if (closed) closed.end = true; }
    const op = event.op; let stroke = board.strokes.find(s => s.strokeId === op.strokeId);
    if (!stroke) { stroke = { ...op, points: [] }; board.strokes.push(stroke); }
    stroke.points.push(...op.points); stroke.end = op.end;
    board.pointCount += op.points.length;
    if (board.undoneIds.length) {
      const ids = new Set(board.undoneIds); board.strokes = board.strokes.filter(s => !ids.has(s.strokeId)); board.undoneIds = [];
      board.pointCount = board.strokes.reduce((n, s) => n + s.points.length, 0);
    }
  } else if (event.kind === 'undo') {
    const stroke = board.strokes.find(s => s.strokeId === event.strokeId); if (stroke) stroke.end = true;
    board.undoneIds.push(event.strokeId);
  } else if (event.kind === 'redo') board.undoneIds = board.undoneIds.filter(id => id !== event.strokeId);
  else if (event.kind === 'clear') { board.strokes = []; board.undoneIds = []; board.pointCount = 0; }
  board.epoch = event.epoch; board.seq = event.seq;
  if (event.requestId) board.receipts = [...board.receipts.filter(r => r !== event.requestId), event.requestId].slice(-96);
}
export async function loadErsomhaDrawing(storage, room) {
  const head = await storage.get(HEAD);
  if (!head || head.boardId !== ersomhaBoardId(room)) return { board: emptyErsomhaDrawing(room), head: null };
  const parts = await Promise.all((head.parts || []).map(key => storage.get(key)));
  const board = parts.length ? JSON.parse(parts.join('')) : emptyErsomhaDrawing(room);
  const events = await Promise.all((head.log || []).map(key => storage.get(key)));
  for (const event of events) { if (!event) fail('ERSOMHA_CANVAS_UNAVAILABLE', 503); apply(board, event); }
  if (board.epoch !== head.epoch || board.seq !== head.seq) fail('ERSOMHA_CANVAS_UNAVAILABLE', 503);
  return { board, head };
}
// Called inside the same transaction as a new room/turn state, or periodically
// to compact the delta journal. Splitting the checkpoint bounds each DO value.
export async function checkpointErsomhaDrawing(storage, board, previousHead) {
  const serialized = JSON.stringify(board), parts = [];
  for (let offset = 0, n = 0; offset < serialized.length; offset += PART_SIZE, n++) {
    const key = keyOf(board, `checkpoint:${board.epoch}:${board.seq}:${n}`); parts.push(key);
    await storage.put(key, serialized.slice(offset, offset + PART_SIZE));
  }
  const head = { boardId: board.boardId, ...metaOf(board), parts, log: [] };
  await storage.put(HEAD, head);
  await erase(storage, [...(previousHead?.log || []), ...(previousHead?.parts || []).filter(k => !parts.includes(k))]);
  return head;
}
export async function persistErsomhaDrawing(storage, board, event, previousHead) {
  let head;
  await storage.transaction(async tx => {
    if (!previousHead || previousHead.boardId !== board.boardId || (previousHead.log || []).length >= MAX_LOG || event.kind === 'clear') {
      head = await checkpointErsomhaDrawing(tx, board, previousHead);
    } else {
      const key = keyOf(board, `event:${board.epoch}:${board.seq}`);
      await tx.put(key, event);
      head = { ...previousHead, ...metaOf(board), log: [...previousHead.log, key] };
      await tx.put(HEAD, head);
    }
  });
  return head;
}
export function prepareErsomhaDrawing(room, current, actorId, command) {
  if (command.matchId !== room.matchId || command.round !== room.round) fail('STALE', 409);
  if (current.boardId !== ersomhaBoardId(room)) fail('ERSOMHA_CANVAS_STALE', 409);
  if (command.type === 'drawing_sync') return { sync: true };
  if (room.phase !== 'draw' || room.draw.pauseUntil) fail('PHASE', 409);
  if (room.draw.drawerId !== actorId) fail('ERSOMHA_DRAWER_ONLY', 403);
  if (command.epoch !== current.epoch) fail('ERSOMHA_CANVAS_STALE', 409);
  if (current.receipts.includes(command.requestId)) return { duplicate: true };
  const event = { type: 'drawing', matchId: room.matchId, round: room.round, epoch: current.epoch, seq: current.seq + 1, requestId: command.requestId };
  if (command.type === 'drawing_batch') {
    const { strokeId, tool, width } = command, color = typeof command.color === 'string' ? command.color.toLowerCase() : '';
    if (typeof strokeId !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(strokeId) || !['pen', 'eraser'].includes(tool)
      || ![2, 6, 12].includes(width) || !ERSOMHA_PALETTE.includes(color) || typeof command.end !== 'boolean'
      || !Array.isArray(command.points) || command.points.length > 32) fail('INVALID');
    const points = command.points.map(point => {
      if (!Array.isArray(point) || point.length !== 2 || point.some(n => typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 1)) fail('INVALID');
      return point.map(n => Math.round(n * 1000) / 1000);
    });
    const old = current.strokes.find(s => s.strokeId === strokeId);
    if (old && (old.end || current.undoneIds.includes(strokeId) || old.color !== color || old.tool !== tool || old.width !== width)) fail('ERSOMHA_CANVAS_STALE', 409);
    if (!old && (!points.length || current.strokes.filter(s => !current.undoneIds.includes(s.strokeId)).length >= ERSOMHA_MAX_STROKES)) fail('ERSOMHA_CANVAS_LIMIT', 409);
    if (!points.length && !command.end) return { duplicate: true };
    const discardedPoints = current.strokes.filter(s => current.undoneIds.includes(s.strokeId)).reduce((sum, s) => sum + s.points.length, 0);
    if (current.pointCount - discardedPoints + points.length > ERSOMHA_MAX_POINTS) fail('ERSOMHA_CANVAS_LIMIT', 409);
    if (!old) event.closedStrokeId = current.strokes.find(s => !s.end && !current.undoneIds.includes(s.strokeId))?.strokeId;
    event.kind = 'append'; event.op = { strokeId, points, color, width, tool, end: command.end };
  } else if (command.type === 'drawing_undo') {
    const stroke = [...current.strokes].reverse().find(s => !current.undoneIds.includes(s.strokeId));
    if (!stroke) return { duplicate: true }; event.kind = 'undo'; event.strokeId = stroke.strokeId;
  } else if (command.type === 'drawing_redo') {
    const strokeId = current.undoneIds.at(-1); if (!strokeId) return { duplicate: true };
    event.kind = 'redo'; event.strokeId = strokeId;
  } else if (command.type === 'drawing_clear') {
    event.kind = 'clear'; event.epoch++; event.seq = 0;
  } else fail('INVALID');
  const board = structuredClone(current); apply(board, event);
  return { board, event };
}
export function ersomhaSyncMessages(room, board) {
  const chunks = []; let ops = [], bytes = 0;
  for (const stroke of board.strokes) {
    // An extended single stroke also obeys the resync message budget.
    for (let offset = 0; offset < stroke.points.length; offset += 256) {
      const op = { ...stroke, points: stroke.points.slice(offset, offset + 256), end: offset + 256 >= stroke.points.length ? stroke.end : false };
      const size = JSON.stringify(op).length;
      if (ops.length && bytes + size > 12_000) { chunks.push(ops); ops = []; bytes = 0; }
      ops.push(op); bytes += size;
    }
  }
  if (ops.length || !chunks.length) chunks.push(ops);
  return chunks.map((chunk, index) => ({ type: 'drawing', kind: 'sync', matchId: room.matchId, round: room.round,
    ...metaOf(board), ops: chunk, undoneIds: board.undoneIds, chunk: index, chunks: chunks.length }));
}
export function ersomhaVisibleCanvas(board) {
  return { ...metaOf(board), strokes: board.strokes.filter(s => !board.undoneIds.includes(s.strokeId)).map(s => structuredClone(s)), undoneIds: [] };
}
export async function archiveErsomhaDrawing(storage, room, board, archiveIndex = []) {
  const id = ersomhaBoardId(room), prefix = `ersomha:evidence:${id}`, parts = [], serialized = JSON.stringify(ersomhaVisibleCanvas(board));
  for (let offset = 0, n = 0; offset < serialized.length; offset += PART_SIZE, n++) {
    const key = `${prefix}:${n}`; parts.push(key); await storage.put(key, serialized.slice(offset, offset + PART_SIZE));
  }
  const record = { id, matchId: room.matchId, round: room.round, drawerUserId: room.members.find(m => m.id === room.draw.drawerId)?.accountUserId || null,
    viewers: room.draw.viewers, parts };
  const index = [...archiveIndex.filter(r => r.id !== id), record];
  for (const expired of index.slice(0, -16)) await erase(storage, expired.parts);
  const kept = index.slice(-16); await storage.put('ersomha:evidence', kept); return kept;
}
export async function deleteErsomhaDrawing(storage, head, archives) {
  await erase(storage, [HEAD, ...(head?.parts || []), ...(head?.log || []), 'ersomha:evidence', 'ersomha:plan', ...(archives || []).flatMap(r => r.parts)]);
}

// Public drawing primitives only. Answer content must never enter this module.
export const ERSOMHA_PALETTE = Object.freeze(['#35224a', '#ffffff', '#118d96', '#9250bd', '#ed6a5a', '#f4b942', '#64a66f', '#3b72b8', '#f08db4', '#8a563d', '#ef8a38', '#83929b']);
export const ERSOMHA_WIDTHS = Object.freeze([2, 6, 12]);
export const DRAW_BATCH_MS = 80;
export const DRAW_BATCH_POINTS = 32;
export const DRAW_MAX_PENDING = 6;
export const DRAW_MAX_BUFFERED_BYTES = 32 * 1024;

export function drawingPoint(event, bounds) {
  if (!(bounds?.width > 0) || !(bounds?.height > 0)) return null;
  const x = (event.clientX - bounds.left) / bounds.width;
  const y = (event.clientY - bounds.top) / bounds.height;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return [Math.round(Math.max(0, Math.min(1, x)) * 10000) / 10000, Math.round(Math.max(0, Math.min(1, y)) * 10000) / 10000];
}

export function createDrawingState(epoch = null) { return { epoch, seq: 0, strokes: new Map(), undoneIds: new Set() }; }

export function applyDrawingEvent(model, event) {
  if (!event || !['append', 'undo', 'redo', 'clear', 'sync'].includes(event.kind)) return false;
  if (event.kind === 'sync' || event.kind === 'clear') {
    model.epoch = event.epoch; model.seq = Number(event.seq) || 0;
    model.strokes.clear(); model.undoneIds = new Set(event.undoneIds || []);
    for (const op of event.ops || []) {
      const earlier = model.strokes.get(op.strokeId);
      model.strokes.set(op.strokeId, { ...op, points: [...(earlier?.points || []), ...op.points.map(point => [...point])] });
    }
    return true;
  }
  if (event.epoch !== model.epoch || !Number.isSafeInteger(event.seq) || event.seq <= model.seq) return false;
  if (event.seq !== model.seq + 1) return false;
  if (event.kind === 'append' && event.op) {
    // Starting fresh ink discards the redo branch on the authoritative board.
    // Mirror that pruning, rather than leaving a redo control for absent ink.
    for (const id of model.undoneIds) model.strokes.delete(id);
    model.undoneIds.clear();
    const closedStroke = event.closedStrokeId && model.strokes.get(event.closedStrokeId);
    if (closedStroke) closedStroke.end = true;
    const previous = model.strokes.get(event.op.strokeId);
    model.strokes.set(event.op.strokeId, { ...event.op, points: [...(previous?.points || []), ...event.op.points] });
    model.undoneIds.delete(event.op.strokeId);
  } else if (event.kind === 'undo') model.undoneIds.add(event.strokeId);
  else if (event.kind === 'redo') model.undoneIds.delete(event.strokeId);
  model.seq = event.seq;
  return true;
}

export function drawStroke(context, stroke) {
  if (!context || !stroke?.points?.length) return;
  context.save();
  // White is an actual drawing colour. Erasure removes pixels and reveals the
  // same white board on every device, rather than painting a coloured patch.
  context.globalCompositeOperation = stroke.tool === 'eraser' ? 'destination-out' : 'source-over';
  context.strokeStyle = stroke.color;
  context.fillStyle = stroke.color;
  context.lineWidth = stroke.width;
  context.lineCap = 'round'; context.lineJoin = 'round';
  context.beginPath();
  const [first, ...rest] = stroke.points;
  context.moveTo(first[0] * 1000, first[1] * 1000);
  for (const point of rest) context.lineTo(point[0] * 1000, point[1] * 1000);
  if (!rest.length) { context.arc(first[0] * 1000, first[1] * 1000, stroke.width / 2, 0, 2 * Math.PI); context.fill(); }
  else context.stroke();
  context.restore();
}

export function paintDrawing(context, model, optimistic = new Map()) {
  context.clearRect(0, 0, 1000, 1000);
  for (const [id, stroke] of model.strokes) if (!model.undoneIds.has(id) && !optimistic.has(id)) drawStroke(context, stroke);
  for (const stroke of optimistic.values()) drawStroke(context, stroke);
}

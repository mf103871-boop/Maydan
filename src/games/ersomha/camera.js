// Presentation only: every client still exchanges the same normalized1000² world.
export const DRAWING_WORLD = 1000;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function drawingCamera(width, height, { mode = 'fit', centerY = .5, dpr = 1 } = {}) {
  if (!(width > 0) || !(height > 0) || !Number.isFinite(width + height)) return null;
  const wide = mode === 'wide' && width > height;
  const scale = (wide ? width : Math.min(width, height)) / DRAWING_WORLD;
  const halfHeight = height / (scale * DRAWING_WORLD * 2);
  const y = wide ? clamp(Number.isFinite(centerY) ? centerY : .5, halfHeight, 1 - halfHeight) : .5;
  // A bounded device ratio keeps native phone ink crisp without an unbounded
  // allocation on a desktop with browser zoom or a large external monitor.
  const ratio = Math.min(3, Math.max(1, Number(dpr) || 1), 4096 / Math.max(width, height));
  return { width, height, mode: wide ? 'wide' : 'fit', scale, dpr: ratio, centerY: y,
    offsetX: (width - scale * DRAWING_WORLD) / 2, offsetY: height / 2 - y * scale * DRAWING_WORLD,
    minY: wide ? halfHeight : .5, maxY: wide ? 1 - halfHeight : .5,
    pixelWidth: Math.max(1, Math.round(width * ratio)), pixelHeight: Math.max(1, Math.round(height * ratio)) };
}

export function cameraPoint(event, bounds, view, { clampOutside = true } = {}) {
  if (!view || !(bounds?.width > 0) || !(bounds?.height > 0)) return null;
  let px = (event.clientX - bounds.left) / bounds.width * view.width, py = (event.clientY - bounds.top) / bounds.height * view.height;
  if (!Number.isFinite(px + py) || (!clampOutside && (px < 0 || px > view.width || py < 0 || py > view.height))) return null;
  if (clampOutside) { px = clamp(px, 0, view.width); py = clamp(py, 0, view.height); }
  const x = (px - view.offsetX) / (view.scale * DRAWING_WORLD);
  const y = (py - view.offsetY) / (view.scale * DRAWING_WORLD);
  if (!Number.isFinite(x + y) || (!clampOutside && (x < 0 || x > 1 || y < 0 || y > 1))) return null;
  return [Math.round(clamp(x, 0, 1) * 10000) / 10000, Math.round(clamp(y, 0, 1) * 10000) / 10000];
}

export function cameraPosition(point, view) {
  return [view.offsetX + point[0] * DRAWING_WORLD * view.scale, view.offsetY + point[1] * DRAWING_WORLD * view.scale];
}

export function inkOutsideCamera(view, model, optimistic = new Map()) {
  if (!view || view.mode === 'fit') return false;
  const strokes = [...model.strokes].filter(([id]) => !model.undoneIds.has(id) && !optimistic.has(id)).map(([, stroke]) => stroke);
  for (const stroke of [...strokes, ...optimistic.values()]) {
    const radius = (Number(stroke.width) || 0) / (DRAWING_WORLD * 2);
    for (const point of stroke.points || []) {
      const [left, top] = cameraPosition([clamp(point[0] - radius, 0, 1), clamp(point[1] - radius, 0, 1)], view);
      const [right, bottom] = cameraPosition([clamp(point[0] + radius, 0, 1), clamp(point[1] + radius, 0, 1)], view);
      if (left < -.5 || right > view.width + .5 || top < -.5 || bottom > view.height + .5) return true;
    }
  }
  return false;
}

export function setDrawingTransform(context, view) {
  if (view) context.setTransform(view.dpr * view.scale, 0, 0, view.dpr * view.scale, view.dpr * view.offsetX, view.dpr * view.offsetY);
}

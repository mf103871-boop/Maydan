// Pure editor operations. No account, preview or network state belongs in a design.
export const HISTORY_LIMIT = 100;
export const PROFILES = Object.freeze({ portrait: { label: 'هاتف رأسي', width: 390, height: 844 }, landscape: { label: 'هاتف أفقي', width: 844, height: 390 }, large: { label: 'شاشة كبيرة', width: 1440, height: 1000 } });
export const PREVIEW_SIZES = Object.freeze([
  { id: 'portrait-320', profile: 'portrait', label: 'هاتف صغير', width: 320, height: 568 },
  { id: 'portrait-390', profile: 'portrait', label: 'هاتف', width: 390, height: 844 },
  { id: 'portrait-430', profile: 'portrait', label: 'هاتف كبير', width: 430, height: 932 },
  { id: 'landscape-640', profile: 'landscape', label: 'هاتف صغير أفقي', width: 640, height: 360 },
  { id: 'landscape-844', profile: 'landscape', label: 'هاتف أفقي', width: 844, height: 390 },
  { id: 'landscape-932', profile: 'landscape', label: 'هاتف كبير أفقي', width: 932, height: 430 },
  { id: 'large-620', profile: 'large', label: 'لوحي صغير', width: 620, height: 900 },
  { id: 'large-768', profile: 'large', label: 'لوحي', width: 768, height: 1024 },
  { id: 'large-1024', profile: 'large', label: 'لوحي أفقي', width: 1024, height: 768 },
  { id: 'large-1440', profile: 'large', label: 'شاشة كبيرة', width: 1440, height: 1000 },
]);
export function clone(value) { return structuredClone(value); }
export function createHistory(document) { return { document: clone(document), past: [], future: [], serial: 0 }; }
export function recordHistory(state, document) {
  if (JSON.stringify(state.document) === JSON.stringify(document)) return state;
  return { document: clone(document), past: [...state.past, state.document].slice(-HISTORY_LIMIT), future: [], serial: state.serial + 1 };
}
export function undoHistory(state) { if (!state.past.length) return state; return { document: state.past.at(-1), past: state.past.slice(0, -1), future: [state.document, ...state.future].slice(0, HISTORY_LIMIT), serial: state.serial + 1 }; }
export function redoHistory(state) { if (!state.future.length) return state; return { document: state.future[0], past: [...state.past, state.document].slice(-HISTORY_LIMIT), future: state.future.slice(1), serial: state.serial + 1 }; }
export function patchNode(document, screenId, nodeId, patch, { decoration = false } = {}) {
  const next = clone(document);
  next.screens ||= {};
  const screen = next.screens[screenId] ||= { nodes: {}, decorations: [] };
  if (decoration) {
    const index = screen.decorations?.findIndex((node) => node.id === nodeId) ?? -1;
    if (index < 0) return document;
    screen.decorations[index] = mergeNode(screen.decorations[index], patch);
  } else {
    screen.nodes ||= {};
    screen.nodes[nodeId] = mergeNode(screen.nodes[nodeId] || {}, patch);
  }
  return next;
}
export function patchNodes(document, patches) { return patches.reduce((next, item) => patchNode(next, item.screenId, item.nodeId, item.patch, { decoration: Boolean(item.decoration) }), document); }
function mergeNode(node, patch) {
  const result = { ...node, ...patch };
  if (patch.style) result.style = { ...node.style, ...patch.style };
  if (patch.layouts) {
    result.layouts = { ...node.layouts };
    for (const [profile, layout] of Object.entries(patch.layouts)) result.layouts[profile] = { ...node.layouts?.[profile], ...layout };
  }
  return result;
}
export function resetNode(document, screenId, nodeId, defaults, decoration = false) {
  const next = clone(document);
  if (decoration) next.screens[screenId].decorations = (next.screens[screenId].decorations || []).filter((node) => node.id !== nodeId);
  else if (defaults.screens?.[screenId]?.nodes?.[nodeId]) next.screens[screenId].nodes[nodeId] = clone(defaults.screens[screenId].nodes[nodeId]);
  else delete next.screens[screenId]?.nodes?.[nodeId];
  return next;
}
export function normalizedLayout(layout, delta, size, { resize = false, snap = false } = {}) {
  const base = { x: 0, y: 0, width: 0.5, height: 'auto', anchorX: 'left', anchorY: 'top', ...layout };
  const round = (n) => snap ? Math.round(n * 100) / 100 : Math.round(n * 10000) / 10000;
  const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
  if (resize) return { ...base, width: clamp(round(Number(base.width) + delta.x / size.width), 0.04, 1), height: clamp(round((base.height === 'auto' ? 0.1 : Number(base.height)) + delta.y / size.height), 0.04, 1) };
  return { ...base, x: clamp(round(Number(base.x) + delta.x / size.width), 0, 1), y: clamp(round(Number(base.y) + delta.y / size.height), 0, 1) };
}
export function acceptPreviewMessage(event, frame, origin, nonce) {
  return event.source === frame?.contentWindow && event.origin === origin && typeof event.data === 'object' && event.data !== null && event.data.nonce === nonce && ['studio:ready', 'studio:select', 'studio:patch', 'studio:patches', 'studio:measure', 'studio:validation', 'studio:scene'].includes(event.data.type);
}
export function errorsText(errors) { return (Array.isArray(errors) ? errors : []).map((error) => typeof error === 'string' ? error : error.message || error.code || JSON.stringify(error)); }
// A diagnostic belongs to the exact rendered document and viewport. Keep other
// views until they revalidate so changing screens cannot hide a blocked action.
export function recordPreviewValidation(current, message, active) {
  if (message.sceneId !== active.sceneId || message.profile !== active.profile || message.documentSerial !== active.documentSerial) return current;
  return { ...current, [`${active.sceneId}:${active.profile}`]: { sceneId: active.sceneId, profile: active.profile, errors: errorsText(message.errors), warnings: errorsText(message.warnings) } };
}
export function fatalPreviewErrors(validation) { return Object.values(validation).flatMap((entry) => entry.errors || []); }
export function validateImageMetadata({ type, size, width, height }) {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(type)) return 'اختر صورة PNG أو JPEG أو WebP.';
  if (!Number.isFinite(size) || size <= 0 || size > 5 * 1024 * 1024) return 'حجم الصورة يجب ألا يتجاوز 5 ميغابايت.';
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1 || width > 4096 || height > 4096) return 'أبعاد الصورة يجب ألا تتجاوز 4096 × 4096 بكسل.';
  return null;
}
export function planCrop(width, height, aspect = 1, zoom = 1, offsetX = 0, offsetY = 0) {
  const safeAspect = Math.min(10, Math.max(0.1, Number(aspect) || 1));
  const scale = Math.min(4, Math.max(1, Number(zoom) || 1));
  const cropWidth = Math.min(width, height * safeAspect) / scale;
  const cropHeight = cropWidth / safeAspect;
  const x = (width - cropWidth) * Math.min(1, Math.max(0, (Number(offsetX) + 100) / 200));
  const y = (height - cropHeight) * Math.min(1, Math.max(0, (Number(offsetY) + 100) / 200));
  return { x, y, width: cropWidth, height: cropHeight };
}
export function downloadDocument(document, documentImpl = globalThis.document, URLImpl = globalThis.URL) {
  const href = URLImpl.createObjectURL(new Blob([JSON.stringify(document, null, 2)], { type: 'application/json' }));
  const anchor = documentImpl.createElement('a'); anchor.href = href; anchor.download = `maydan-design-${new Date().toISOString().slice(0, 10)}.json`; anchor.click();
  setTimeout(() => URLImpl.revokeObjectURL(href), 1000);
}

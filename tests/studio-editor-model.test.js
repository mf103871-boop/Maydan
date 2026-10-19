import test from 'node:test';
import assert from 'node:assert/strict';
import { PREVIEW_SIZES, createHistory, recordHistory, undoHistory, redoHistory, patchNode, patchNodes, resetNode, normalizedLayout, acceptPreviewMessage, validateImageMetadata, planCrop, errorsText, recordPreviewValidation, fatalPreviewErrors } from '../src/studio/editor-model.js';

const initial = () => ({ schemaVersion: 1, registryVersion: 1, tokens: {}, screens: { home: { nodes: {}, decorations: [] } }, assets: [] });

test('editor history retains precisely100 edits and redo disappears after branching', () => {
  let history = createHistory(initial());
  for (let index = 1; index <= 130; index += 1) history = recordHistory(history, { ...history.document, tokens: { '--radius': index } });
  assert.equal(history.past.length, 100);
  for (let index = 0; index < 100; index += 1) history = undoHistory(history);
  assert.equal(history.document.tokens['--radius'], 30);
  assert.equal(history.future.length, 100);
  history = redoHistory(history);
  assert.equal(history.document.tokens['--radius'], 31);
  history = recordHistory(history, { ...history.document, tokens: { '--radius': 48 } });
  assert.equal(history.future.length, 0);
  assert.equal(redoHistory(history), history);
});
test('no-op edits neitherconsume undo history norinvalidate redo', () => {
  const history = createHistory(initial());
  assert.equal(recordHistory(history, initial()), history);
});
test('property edits preserve otherprofiles andeveryunrelated property', () => {
  const before = initial();
  before.screens.home.nodes.title = { text: 'ميدان', style: { color: '#352547', fontSize: 24 }, layouts: { portrait: { x: 0.2, width: 0.5 }, landscape: { x: 0.5 } } };
  const after = patchNode(before, 'home', 'title', { style: { fontSize: 30 }, layouts: { portrait: { x: 0.1 } } });
  assert.deepEqual(after.screens.home.nodes.title, { text: 'ميدان', style: { color: '#352547', fontSize: 30 }, layouts: { portrait: { x: 0.1, width: 0.5 }, landscape: { x: 0.5 } } });
  assert.equal(before.screens.home.nodes.title.style.fontSize, 24);
});
test('decoration updates and deletes are scoped and do not fabricate absentdecorations', () => {
  const document = initial(); document.screens.home.decorations = [{ id: 'caption', type: 'text', text: 'معًا' }, { id: 'image', type: 'image', assetId: 'one' }];
  assert.equal(patchNode(document, 'home', 'absent', { text: 'bad' }, { decoration: true }), document);
  const after = patchNode(document, 'home', 'caption', { text: 'اللّمّة' }, { decoration: true });
  assert.equal(after.screens.home.decorations[0].text, 'اللّمّة');
  assert.equal(document.screens.home.decorations[0].text, 'معًا');
  const removed = resetNode(after, 'home', 'caption', initial(), true);
  assert.deepEqual(removed.screens.home.decorations.map((entry) => entry.id), ['image']);
});
test('node reset uses originaldefaults and preservesothernodes', () => {
  const before = initial(); before.screens.home.nodes.title = { text: 'عنوان' }; before.screens.home.nodes.artwork = { visible: false };
  const after = resetNode(before, 'home', 'title', initial());
  assert.equal(after.screens.home.nodes.title, undefined);
  assert.deepEqual(after.screens.home.nodes.artwork, { visible: false });
});
test('group movement isoneundoableatomic edit whilepreservingallmember styles', () => {
  const document = initial(); document.screens.home.nodes.title = { style: { color: '#087d89' } };
  const before = createHistory(document);
  const moved = recordHistory(before, patchNodes(before.document, [{ screenId: 'home', nodeId: 'title', patch: { layouts: { portrait: { x: .3, y: .4 } } } }, { screenId: 'home', nodeId: 'artwork', patch: { layouts: { portrait: { x: .5, y: .6 } } } }]));
  assert.equal(moved.past.length, 1); assert.equal(moved.document.screens.home.nodes.title.style.color, '#087d89'); assert.deepEqual(undoHistory(moved).document, document);
});
test('preview messages require exactsource,origin,nonce and documentedtype', () => {
  const frame = { contentWindow: {} }, nonce = 'unique-nonce', origin = 'https://maydan.example';
  const event = { source: frame.contentWindow, origin, data: { type: 'studio:patch', nonce, nodeId: 'title', patch: { visible: false } } };
  assert.equal(acceptPreviewMessage(event, frame, origin, nonce), true);
  for (const wrong of [{ source: {} }, { origin: 'https://attacker.example' }, { data: { ...event.data, nonce: 'other' } }, { data: { ...event.data, type: 'execute' } }, { data: null }]) assert.equal(acceptPreviewMessage({ ...event, ...wrong }, frame, origin, nonce), false);
});
test('layout drag/resize mapsphysical pixels to boundednormalizedcoordinates', () => {
  const layout = normalizedLayout({ x: 0.5, y: 0.4 }, { x: 39, y: 84.4 }, { width: 390, height: 844 });
  assert.equal(layout.x, 0.6); assert.equal(layout.y, 0.5);
  const clipped = normalizedLayout(layout, { x: 10000, y: -10000 }, { width: 390, height: 844 });
  assert.equal(clipped.x, 1); assert.equal(clipped.y, 0);
  const resized = normalizedLayout({ width: 0.3, height: 'auto' }, { x: 39, y: 84.4 }, { width: 390, height: 844 }, { resize: true });
  assert.equal(resized.width, 0.4); assert.equal(resized.height, 0.2);
});
test('privateimage validation rejects unsafe formats,bigfiles,undecodableandoversizedimages', () => {
  const valid = { type: 'image/webp', size: 5 * 1024 * 1024, width: 4096, height: 4096 };
  assert.equal(validateImageMetadata(valid), null);
  for (const patch of [{ type: 'image/svg+xml' }, { size: valid.size + 1 }, { width: 4097 }, { width: 0 }, { height: NaN }, { size: -1 }]) assert.equal(typeof validateImageMetadata({ ...valid, ...patch }), 'string');
});
test('crop staysinsideoriginalimage acrossaspectratios,zoomandoffsets', () => {
  for (const [width, height] of [[4000, 1000], [1000, 4000], [100, 100]]) for (const aspect of [1, 16 / 9, 9 / 16]) for (const zoom of [1, 2, 4]) for (const offset of [-100, 0, 100]) {
    const crop = planCrop(width, height, aspect, zoom, offset, -offset);
    assert.ok(crop.x >= -1e-9 && crop.y >= -1e-9 && crop.x + crop.width <= width + 1e-9 && crop.y + crop.height <= height + 1e-9);
    assert.ok(Math.abs(crop.width / crop.height - aspect) < 1e-9);
  }
});
test('servervalidation messages stayreadable without assumingstrings', () => { assert.deepEqual(errorsText(['خطأ', { path: 'screens.x', message: 'عنصر مطلوب' }]), ['خطأ', 'عنصر مطلوب']); });
test('device presets cover approved widths and agree with the app three profile boundaries', () => {
  assert.deepEqual([320,390,430,620,768,1024,1440].filter((width) => !PREVIEW_SIZES.some((entry) => entry.width === width)), []);
  for (const preset of PREVIEW_SIZES) assert.equal(preset.profile, Math.min(preset.width, preset.height) < 620 ? preset.width > preset.height ? 'landscape' : 'portrait' : 'large');
});


test('fatal preview diagnostics stay distinct from warnings and reject stale view/document messages', () => {
  const active = { sceneId: 'players', profile: 'portrait', documentSerial: 3 };
  const message = { ...active, errors: [{ message: 'إجراء مطلوب محجوب' }], warnings: [{ message: 'تباين منخفض' }] };
  const state = recordPreviewValidation({}, message, active);
  assert.deepEqual(fatalPreviewErrors(state), ['إجراء مطلوب محجوب']);
  for (const stale of [{ documentSerial: 2 }, { sceneId: 'home' }, { profile: 'large' }, { documentSerial: undefined }]) assert.equal(recordPreviewValidation(state, { ...message, ...stale, errors: [] }, active), state);
  const otherView = { sceneId: 'home', profile: 'large', documentSerial: 4 };
  const moved = recordPreviewValidation(state, { ...otherView, errors: [], warnings: ['ملاحظة'] }, otherView);
  assert.deepEqual(fatalPreviewErrors(moved), ['إجراء مطلوب محجوب']);
  const corrected = recordPreviewValidation(moved, { ...active, documentSerial: 5, errors: [], warnings: ['تباين منخفض'] }, { ...active, documentSerial: 5 });
  assert.deepEqual(fatalPreviewErrors(corrected), []);
  assert.deepEqual(corrected['players:portrait'].warnings, ['تباين منخفض']);
});

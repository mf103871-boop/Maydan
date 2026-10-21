import test from 'node:test';
import assert from 'node:assert/strict';
import { drawingCamera, cameraPoint, cameraPosition, inkOutsideCamera, setDrawingTransform } from '../src/games/ersomha/camera.js';
import { drawingPoint, paintDrawing, createDrawingState } from '../src/games/ersomha/drawing.js';

test('a wide viewport uses one uniform camera and preserves circles on old square clients', () => {
  const view = drawingCamera(720, 300, { mode: 'wide', dpr: 3 });
  assert.equal(view.mode, 'wide'); assert.equal(view.scale, .72);
  assert.equal(view.pixelWidth, 2160); assert.equal(view.pixelHeight, 900);
  const bounds = { left: 10, top: 20, width: 720, height: 300 };
  const points = [];
  for (let index = 0; index < 24; index++) {
    const angle = index * Math.PI / 12, css = [360 + 80 * Math.cos(angle), 150 + 80 * Math.sin(angle)];
    const point = drawingPoint({ clientX: css[0] + 10, clientY: css[1] + 20 }, bounds, { view, clampOutside: false });
    points.push(point);
    const oldClientRadius = Math.hypot(point[0] * 1000 - 500, point[1] * 1000 - 500);
    assert.ok(Math.abs(oldClientRadius - 80 / .72) < .1, 'legacy normalized square keeps the circle round');
    const projected = cameraPosition(point, view);
    assert.ok(Math.hypot(projected[0] - css[0], projected[1] - css[1]) < .1);
  }
  assert.equal(points.length, 24);
  assert.deepEqual(cameraPoint({ clientX: 10, clientY: 20 }, bounds, view), [0, .2917]);
  assert.deepEqual(cameraPoint({ clientX: 370, clientY: 900 }, bounds, view), [.5, .7083], 'continued capture stops at the visible lower edge rather than adding hidden ink');
  assert.equal(cameraPoint({ clientX: 370, clientY: 900 }, bounds, view, { clampOutside: false }), null);
});

test('fit-all rejects letterbox downs, clamps continuing strokes and never pans an inverted portrait range', () => {
  const fit = drawingCamera(720, 300, { mode: 'fit' }), bounds = { left: 0, top: 0, width: 720, height: 300 };
  assert.equal(cameraPoint({ clientX: 20, clientY: 150 }, bounds, fit, { clampOutside: false }), null);
  assert.deepEqual(cameraPoint({ clientX: 20, clientY: 150 }, bounds, fit), [0, .5]);
  assert.deepEqual(cameraPoint({ clientX: 360, clientY: 150 }, bounds, fit), [.5, .5]);
  const portrait = drawingCamera(300, 600, { mode: 'wide', centerY: 1 });
  assert.equal(portrait.mode, 'fit'); assert.equal(portrait.centerY, .5); assert.equal(portrait.minY, .5); assert.equal(portrait.maxY, .5);
  assert.equal(drawingCamera(0, 10), null);
});

test('wide panning is bounded and resize visibility includes optimistic ink but excludes undone strokes', () => {
  const top = drawingCamera(720, 300, { mode: 'wide', centerY: -1 }), bottom = drawingCamera(720, 300, { mode: 'wide', centerY: 2 });
  assert.equal(top.centerY, 300 / 1440); assert.equal(bottom.centerY, 1 - 300 / 1440);
  const model = createDrawingState(1), stroke = { width: 12, points: [[.5, .05], [.5, .95]] };
  model.strokes.set('old', stroke);
  assert.equal(inkOutsideCamera(top, model), true);
  model.undoneIds.add('old'); assert.equal(inkOutsideCamera(top, model), false);
  assert.equal(inkOutsideCamera(top, model, new Map([['live', stroke]])), true);
  assert.equal(inkOutsideCamera(drawingCamera(720, 300), model, new Map([['live', stroke]])), false);
});

test('all camera paints clear the complete backing store under identity before uniform projection', () => {
  const calls = [], context = { canvas: { width: 2160, height: 900 }, save() {}, restore() {}, setTransform(...value) { calls.push(['matrix', ...value]); }, clearRect(...value) { calls.push(['clear', ...value]); } };
  paintDrawing(context, createDrawingState(1), new Map(), drawingCamera(720, 300, { mode: 'wide', dpr: 3 }));
  assert.deepEqual(calls, [['matrix', 1, 0, 0, 1, 0, 0], ['clear', 0, 0, 2160, 900]]);
  setDrawingTransform(context, drawingCamera(720, 300, { mode: 'wide', dpr: 3 }));
  const matrix = calls.at(-1); assert.equal(matrix[1], matrix[4]); assert.equal(matrix[2], 0); assert.equal(matrix[3], 0);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { observeVisualViewport } from '../src/shared/ui/useVisualViewport.js';

function fixture() {
  const values = new Map();
  let writes = 0;
  const target = { style: {
    getPropertyValue: name => values.get(name)?.value || '',
    getPropertyPriority: name => values.get(name)?.priority || '',
    setProperty: (name, value, priority = '') => { writes += 1; values.set(name, { value, priority }); },
    removeProperty: name => { values.delete(name); },
  } };
  const viewport = Object.assign(new EventTarget(), { height: 844, offsetTop: 0, scale: 1 });
  const frames = new Map();
  let nextFrame = 0;
  const environment = {
    visualViewport: viewport,
    requestAnimationFrame: fn => { const id = nextFrame++; frames.set(id, fn); return id; },
    cancelAnimationFrame: id => frames.delete(id),
  };
  return { target, viewport, environment, frames, values, writes: () => writes,
    flush: () => { const pending = [...frames.values()]; frames.clear(); pending.forEach(fn => fn()); },
    event: name => viewport.dispatchEvent(new Event(name)),
    value: name => target.style.getPropertyValue(name),
  };
}

test('visible viewport follows keyboard height and pan while coalescing events', () => {
  const f = fixture();
  const stop = observeVisualViewport(f.target, {}, f.environment);
  assert.equal(f.value('--dialog-viewport-height'), '844px');
  assert.equal(f.value('--dialog-viewport-top'), '0px');
  f.viewport.height = 440; f.event('resize');
  f.viewport.offsetTop = 68; f.event('scroll'); f.event('resize');
  assert.equal(f.frames.size, 1);
  assert.equal(f.value('--dialog-viewport-height'), '844px');
  f.flush();
  assert.equal(f.value('--dialog-viewport-height'), '440px');
  assert.equal(f.value('--dialog-viewport-top'), '68px');
  const writes = f.writes();
  f.event('scroll'); f.flush();
  assert.equal(f.writes(), writes);
  stop();
});

test('manual pinch zoom does not resize or reposition overlays or reset scale', () => {
  const f = fixture();
  const stop = observeVisualViewport(f.target, {}, f.environment);
  f.viewport.scale = 2; f.viewport.height = 300; f.viewport.offsetTop = 111;
  f.event('resize'); f.event('scroll'); f.flush();
  assert.equal(f.value('--dialog-viewport-height'), '844px');
  assert.equal(f.value('--dialog-viewport-top'), '0px');
  assert.equal(f.viewport.scale, 2);
  f.viewport.scale = 1; f.viewport.height = 430; f.viewport.offsetTop = 24;
  f.event('resize'); f.flush();
  assert.equal(f.value('--dialog-viewport-height'), '430px');
  assert.equal(f.value('--dialog-viewport-top'), '24px');
  stop();
});

test('observer cleanup cancels queued work, removes listeners, and restores inline styles', () => {
  const f = fixture();
  f.target.style.setProperty('--lamma-height', '90vh', 'important');
  const stop = observeVisualViewport(f.target, { heightProperty: '--lamma-height', topProperty: '--lamma-top' }, f.environment);
  f.event('resize');
  assert.equal(f.frames.size, 1);
  stop();
  assert.equal(f.frames.size, 0);
  assert.equal(f.value('--lamma-height'), '90vh');
  assert.equal(f.target.style.getPropertyPriority('--lamma-height'), 'important');
  assert.equal(f.value('--lamma-top'), '');
  f.event('scroll'); f.event('resize');
  assert.equal(f.frames.size, 0);
});

test('missing APIs and invalid geometry leave existing layout alone', () => {
  const f = fixture();
  assert.doesNotThrow(() => observeVisualViewport(null, {}, f.environment)());
  assert.doesNotThrow(() => observeVisualViewport(f.target, {}, {})());
  const stop = observeVisualViewport(f.target, {}, f.environment);
  for (const patch of [{ height: 0 }, { height: NaN }, { height: 400, offsetTop: Infinity }, { height: 400, offsetTop: 0, scale: NaN }]) {
    Object.assign(f.viewport, patch); f.event('resize'); f.flush();
    assert.equal(f.value('--dialog-viewport-height'), '844px');
  }
  Object.assign(f.viewport, { height: 400, offsetTop: -8, scale: 1 });
  f.event('scroll'); f.flush();
  assert.equal(f.value('--dialog-viewport-height'), '400px');
  assert.equal(f.value('--dialog-viewport-top'), '0px');
  stop();
});

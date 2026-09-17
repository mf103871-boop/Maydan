import { test } from 'node:test';
import assert from 'node:assert/strict';
import { confetti } from '../src/shared/fx/confetti.js';

function environment(t, { contextAvailable = true } = {}) {
  const previous = Object.fromEntries(['document', 'window', 'matchMedia', 'requestAnimationFrame', 'cancelAnimationFrame'].map((key) => [key, globalThis[key]]));
  const elements = new Set(), listeners = new Set(), frames = new Map();
  let sequence = 0;
  const context = Object.fromEntries(['setTransform', 'clearRect', 'save', 'translate', 'rotate', 'beginPath', 'arc', 'fill', 'fillRect', 'restore'].map((name) => [name, () => {}]));
  const document = { hidden: false, documentElement: { dataset: {} }, createElement() { const element = { style: {}, setAttribute() {}, getContext: () => contextAvailable ? context : null, remove() { elements.delete(element); } }; return element; }, body: { appendChild(element) { elements.add(element); } } };
  globalThis.document = document;
  globalThis.window = { innerWidth: 390, innerHeight: 844, devicePixelRatio: 3, addEventListener(_name, fn) { listeners.add(fn); }, removeEventListener(_name, fn) { listeners.delete(fn); } };
  globalThis.matchMedia = () => ({ matches: false });
  globalThis.requestAnimationFrame = (callback) => { frames.set(++sequence, callback); return sequence; };
  globalThis.cancelAnimationFrame = (id) => { frames.delete(id); };
  t.after(() => { confetti.clear(); Object.assign(globalThis, previous); });
  return { document, elements, listeners, frames, frame() { const [id, callback] = frames.entries().next().value; frames.delete(id); callback(performance.now() + 16); } };
}

test('confetti cancels an active animation when reduced motion is enabled and releases its canvas', (t) => {
  const env = environment(t);
  confetti.fire({ count: 8 });
  assert.equal(env.elements.size, 1); assert.equal(env.listeners.size, 1); assert.equal(env.frames.size, 1);
  env.document.documentElement.dataset.reducedMotion = 'true'; env.frame();
  assert.equal(env.elements.size, 0); assert.equal(env.listeners.size, 0); assert.equal(env.frames.size, 0);
  confetti.fire(); assert.equal(env.elements.size, 0);
});

test('a hidden page drops particles rather than replaying the celebration on return', (t) => {
  const env = environment(t); confetti.burst();
  env.document.hidden = true; env.frame();
  assert.equal(env.frames.size, 0); assert.equal(env.elements.size, 0);
  env.document.hidden = false; confetti.burst(); assert.equal(env.elements.size, 1);
  confetti.clear(); assert.equal(env.frames.size, 0); assert.equal(env.elements.size, 0);
});

test('unavailable canvas rendering cannot crash a result screen', (t) => {
  const env = environment(t, { contextAvailable: false });
  assert.doesNotThrow(() => confetti.fire());
  assert.equal(env.elements.size, 0); assert.equal(env.frames.size, 0);
});

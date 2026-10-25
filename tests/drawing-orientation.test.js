import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createDrawingOrientationSession } from '../src/native/drawing-orientation.js';

function environment(lock = async () => {}) {
  const host = new EventTarget(), orientation = new EventTarget(), doc = new EventTarget();
  Object.assign(host, { innerWidth: 390, innerHeight: 844, location: { hash: '#/room/123456' }, document: doc, screen: { orientation } });
  doc.hidden = false;
  let unlocks = 0;
  orientation.lock = lock; orientation.unlock = () => unlocks++;
  return { host, orientation, doc, get unlocks() { return unlocks; } };
}
const settle = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

test('unsupported/rejected browser rotation leaves a measured manual-rotate fallback and no fullscreen request', async () => {
  const env = environment(async () => { throw new Error('NotSupportedError'); });
  const states = [];
  const session = createDrawingOrientationSession({ host: env.host, native: false, onStatus: value => states.push(value), ownership: { current: null, counter: 0 } });
  session.start(); await settle(); assert.equal(states.at(-1), 'rotate');
  env.host.innerWidth = 844; env.host.innerHeight = 390; env.host.dispatchEvent(new Event('resize'));
  assert.equal(states.at(-1), 'landscape');
  session.stop(); session.stop(); assert.equal(env.unlocks, 1); assert.equal(states.at(-1), 'idle');
});

test('a late old browser lock cannot unlock a newer drawing surface, and final late lock is retired', async () => {
  const pending = [], env = environment(() => new Promise(resolve => pending.push(resolve)));
  const ownership = { current: null, counter: 0 };
  const first = createDrawingOrientationSession({ host: env.host, native: false, ownership });
  const second = createDrawingOrientationSession({ host: env.host, native: false, ownership });
  first.start(); second.start(); first.stop();
  assert.equal(env.unlocks, 0);
  pending[0](); await settle(); assert.equal(env.unlocks, 0);
  second.stop(); assert.equal(env.unlocks, 1);
  pending[1](); await settle(); assert.equal(env.unlocks, 2);
});

test('native leases are unique per surface and renewal never releases the active old lease before atomic replacement', async () => {
  const env = environment(), calls = [], ownership = { current: null, counter: 0 };
  const session = createDrawingOrientationSession({ host: env.host, native: true, ownership,
    nativeCall: async (command, body, options) => { calls.push({ command, ...body, timeout: options.timeout }); return { requested: true }; } });
  session.start(); await settle(); await session.requestLandscape(); session.stop();
  assert.deepEqual(calls.map(row => row.active), [true, true, false]);
  assert.notEqual(calls[0].lease, calls[1].lease); assert.equal(calls[2].lease, calls[1].lease);
  for (const row of calls) { assert.equal(row.command, 'drawingOrientation'); assert.equal(row.game, 'ersomha'); assert.equal(row.timeout, 2000); assert.match(row.lease, /^ers-[a-zA-Z0-9_-]{1,56}$/); }
});

test('route exit releases orientation and listeners while a hidden initial surface waits for foreground', async () => {
  const env = environment(); env.doc.hidden = true;
  const calls = [], session = createDrawingOrientationSession({ host: env.host, native: true,
    ownership: { current: null, counter: 0 }, nativeCall: async (_, body) => { calls.push(body); } });
  session.start(); await settle(); assert.equal(calls.length, 0);
  env.doc.hidden = false; env.doc.dispatchEvent(new Event('visibilitychange')); await settle(); assert.equal(calls.length, 1);
  env.host.location.hash = '#/friends'; env.host.dispatchEvent(new Event('hashchange')); await settle(); assert.equal(calls.at(-1).active, false);
  env.doc.dispatchEvent(new Event('visibilitychange')); await settle(); assert.equal(calls.length, 2);
  assert.equal(await session.requestLandscape(), false);
});

test('native bridge is limited to trusted current room/drawer focus and cannot persist rotation after web reset', () => {
  const source = readFileSync(new URL('../ios/Maydan/GameViewController.swift', import.meta.url), 'utf8');
  const bridge = source.slice(source.indexOf('func userContentController('), source.indexOf('// MARK: - Account and store commands'));
  assert.match(bridge, /message\.frameInfo\.isMainFrame/); assert.match(bridge, /isTrustedGameURL\(pageURL\)/);
  const command = source.slice(source.indexOf('private func requestDrawingOrientation'), source.indexOf('override func accessibilityPerformEscape'));
  for (const requirement of ['DrawingOrientationPolicy.isRoomURL(webView.url)', 'UIDevice.current.userInterfaceIdiom == .phone', 'drawingOrientation.acquire(lease)', 'drawingOrientation.accepts(lease, generation: generation)', 'data-ersomha-drawing-focus', 'ersomha.draw.drawer']) assert.ok(command.includes(requirement), requirement);
  assert.match(source, /if command == "socialLogout" \{ releaseDrawingOrientation\(\) \}/);
  assert.match(source, /isRecoveringWebContent = true\s+releaseDrawingOrientation\(\)/);
  assert.match(source, /requestGeometryUpdate\(\.iOS\(interfaceOrientations: \.landscape\)\)/);
  assert.doesNotMatch(source, /setValue\([^\n]*orientation|UIDevice\.current\.setValue/);
  assert.match(source, /withTimeInterval: 90/);
  const release = source.slice(source.indexOf('private func releaseDrawingOrientation'), source.indexOf('private func restoreDrawingOrientationIfPossible'));
  assert.match(release, /guard drawingOrientation\.release\(lease\) else \{ return \}/);
  assert.match(release, /edgeBackGesture\?\.isEnabled = true/);
  const acquire = source.slice(source.indexOf('private func applyDrawingOrientation'), source.indexOf('private func requestDrawingOrientation'));
  assert.match(acquire, /guard drawingOrientation\.accepts\(lease, generation: generation\)/);
  assert.match(acquire, /edgeBackGesture\?\.isEnabled = false/);
});

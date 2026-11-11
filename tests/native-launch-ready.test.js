import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { reportSimulatorHomeReady } from '../src/platform/native-launch-ready.js';

const token = 'e7b0d07a-7fcb-4b58-86c7-32aff0457518';
function fixture() {
  const messages = [], frames = new Map(), timers = new Map();
  let next = 0, now = 0;
  const node = () => ({ hidden: false, disabled: false, closest: () => null,
    getBoundingClientRect: () => ({ width: 100, height: 100 }) });
  const cards = Array.from({ length: 8 }, node), home = node(), navigation = node();
  home.querySelectorAll = () => cards;
  const host = { __maydanSimulatorLaunchToken: token,
    webkit: { messageHandlers: { maydan: { postMessage: message => messages.push(message) } } },
    document: { visibilityState: 'visible', querySelector: selector => selector.includes('home') ? home : navigation },
    getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
    requestAnimationFrame: callback => { frames.set(++next, callback); return next; },
    cancelAnimationFrame: id => frames.delete(id),
    performance: { now: () => now },
    setTimeout: (callback, delay) => { timers.set(++next, { callback, at: now + delay }); return next; },
    clearTimeout: id => timers.delete(id) };
  const tick = () => { const work = [...frames.values()]; frames.clear(); work.forEach(callback => callback()); };
  const advance = ms => {
    const until = now + ms;
    while (true) {
      const entry = [...timers].filter(([, timer]) => timer.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
      if (!entry) break;
      const [id, timer] = entry; now = timer.at; timers.delete(id); timer.callback();
    }
    now = until;
  };
  return { host, cards, home, navigation, messages, frames, timers, tick, advance };
}

test('transient hidden document or navigation is re-measured after two fresh painted frames', () => {
  for (const kind of ['document', 'navigation']) {
    const f = fixture();
    if (kind === 'document') f.host.document.visibilityState = 'hidden';
    else f.navigation.hidden = true;
    const stop = reportSimulatorHomeReady({ accountReady: true, gameCount: 8, host: f.host });
    f.tick(); f.tick(); assert.equal(f.messages.length, 0);
    f.host.document.visibilityState = 'visible'; f.navigation.hidden = false;
    f.advance(100); f.tick(); assert.equal(f.messages.length, 0);
    f.tick(); assert.equal(f.messages.length, 1, `${kind} recovery must be measured, not abandoned`);
    stop(); assert.equal(f.frames.size + f.timers.size, 0);
  }
});

test('receipt retries until matching native acknowledgment, without trusting another launch acknowledgment', () => {
  const f = fixture();
  f.host.__maydanSimulatorLaunchReady = '00000000-0000-4000-8000-000000000002';
  reportSimulatorHomeReady({ accountReady: true, gameCount: 8, host: f.host });
  f.tick(); f.tick(); assert.equal(f.messages.length, 1);
  f.advance(100); f.tick(); f.tick(); assert.equal(f.messages.length, 2);
  f.host.__maydanSimulatorLaunchReady = token;
  f.advance(100); f.tick(); f.tick();
  assert.equal(f.messages.length, 2);
  assert.equal(f.frames.size + f.timers.size, 0);
});

test('a transient bridge rejection is retried; synchronous or pre-existing native ACK retires all work', () => {
  const f = fixture(); let calls = 0;
  f.host.webkit.messageHandlers.maydan.postMessage = message => {
    if (++calls === 1) throw new Error('bridge not ready');
    f.messages.push(message); f.host.__maydanSimulatorLaunchReady = token;
  };
  reportSimulatorHomeReady({ accountReady: true, gameCount: 8, host: f.host });
  f.tick(); f.tick(); assert.equal(f.messages.length, 0);
  f.advance(100); f.tick(); f.tick(); assert.equal(f.messages.length, 1);
  assert.equal(f.frames.size + f.timers.size, 0);
  const g = fixture(); g.host.__maydanSimulatorLaunchReady = token;
  reportSimulatorHomeReady({ accountReady: true, gameCount: 8, host: g.host });
  assert.equal(g.frames.size + g.timers.size, 0); assert.deepEqual(g.messages, []);
});

test('bounded expiry retires hidden, rejected, missing bridge delivery and suspended-frame attempts without success', () => {
  for (const kind of ['hidden', 'partial', 'bridge', 'suspended']) {
    const f = fixture();
    if (kind === 'hidden') f.host.document.visibilityState = 'hidden';
    if (kind === 'partial') f.cards.pop();
    if (kind === 'bridge') f.host.webkit.messageHandlers.maydan.postMessage = () => { throw new Error('not delivered'); };
    reportSimulatorHomeReady({ accountReady: true, gameCount: 8, host: f.host });
    if (kind !== 'suspended') { f.tick(); f.tick(); }
    f.advance(10000);
    f.host.document.visibilityState = 'visible';
    f.tick(); f.tick(); f.advance(1000);
    assert.deepEqual(f.messages, []);
    assert.equal(f.frames.size + f.timers.size, 0, `${kind} must leave no scheduled work`);
  }
});

test('unmount and token changes retire retry work as well as painted-frame callbacks', () => {
  for (const kind of ['unmount', 'token']) {
    const f = fixture(); f.navigation.hidden = true;
    const stop = reportSimulatorHomeReady({ accountReady: true, gameCount: 8, host: f.host });
    f.tick(); f.tick();
    if (kind === 'unmount') stop();
    else f.host.__maydanSimulatorLaunchToken = '00000000-0000-4000-8000-000000000002';
    f.navigation.hidden = false; f.advance(100); f.tick(); f.tick();
    assert.deepEqual(f.messages, []);
    assert.equal(f.frames.size + f.timers.size, 0);
  }
});

test('a missing native acknowledgment expires without producing any success flag or accepting delayed frames', () => {
  const f = fixture();
  reportSimulatorHomeReady({ accountReady: true, gameCount: 8, host: f.host });
  for (let attempt = 0; attempt < 100; attempt++) { f.tick(); f.tick(); f.advance(100); }
  assert.equal(f.messages.length, 100);
  assert.equal(f.host.__maydanSimulatorLaunchReady, undefined, 'only native may acknowledge a persisted receipt');
  assert.equal(f.frames.size + f.timers.size, 0);
  f.tick(); f.tick(); f.advance(10000); assert.equal(f.messages.length, 100);
});

test('home-ready requires initialized account, simulator opt-in, mounted visible controls and two frames', () => {
  const f = fixture();
  reportSimulatorHomeReady({ accountReady: false, gameCount: 8, host: f.host });
  assert.equal(f.frames.size, 0);
  const stop = reportSimulatorHomeReady({ accountReady: true, gameCount: 8, host: f.host });
  assert.equal(f.messages.length, 0);
  f.tick(); assert.equal(f.messages.length, 0);
  f.tick();
  assert.deepEqual(f.messages, [{ type: 'simulatorGameReady', token, route: 'home', gameCardCount: 8, initialized: true }]);
  stop();
});

test('blank/error/hidden/partial pages never produce game readiness despite a valid native token', () => {
  const cases = [f => { f.host.document.querySelector = () => null; },
    f => { f.navigation.hidden = true; }, f => { f.cards.pop(); },
    f => { f.cards[0].disabled = true; }, f => { f.home.closest = () => ({}); },
    f => { f.home.getBoundingClientRect = () => ({ width: 0, height: 0 }); },
    f => { f.host.document.visibilityState = 'hidden'; },
    f => { f.host.getComputedStyle = () => ({ display: 'none', visibility: 'visible' }); }];
  for (const change of cases) {
    const f = fixture(); change(f);
    const stop = reportSimulatorHomeReady({ accountReady: true, gameCount: 8, host: f.host });
    for (let retry = 0; retry < 3; retry++) {
      f.tick(); f.tick(); assert.deepEqual(f.messages, []); f.advance(100);
    }
    stop(); assert.equal(f.frames.size + f.timers.size, 0);
  }
});

test('no simulator token means no scheduling; unmount or token change retires a pending receipt', () => {
  for (const value of [undefined, '', 'previous-run', token.toUpperCase()]) {
    const f = fixture(); f.host.__maydanSimulatorLaunchToken = value;
    assert.equal(reportSimulatorHomeReady({ accountReady: true, gameCount: 8, host: f.host }), undefined);
    assert.equal(f.frames.size, 0);
    assert.equal(f.timers.size, 0);
  }
  const f = fixture(), stop = reportSimulatorHomeReady({ accountReady: true, gameCount: 8, host: f.host });
  f.tick(); stop(); f.tick(); assert.deepEqual(f.messages, []);
  const g = fixture(); reportSimulatorHomeReady({ accountReady: true, gameCount: 8, host: g.host });
  g.tick(); g.host.__maydanSimulatorLaunchToken = '00000000-0000-4000-8000-000000000002'; g.tick();
  assert.deepEqual(g.messages, []);
});

test('native acknowledgment is simulator-only and follows exact-process receipt persistence; launch deadlines are unchanged', () => {
  const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  const native = read('ios/Maydan/GameViewController.swift');
  const method = native.slice(native.indexOf('    private func recordSimulatorLaunchReady('), native.indexOf('    private func recordSimulatorOrientation('));
  assert.match(native, /#if targetEnvironment\(simulator\)\s+private func recordSimulatorLaunchReady/);
  assert.match(method, /payload\["token"\] as\? String == token/);
  assert.match(method, /"pid": ProcessInfo\.processInfo\.processIdentifier/);
  assert.match(method, /!isCollectingMigration, !isCommittingMigration, migration\?\.isDone == true/);
  assert.match(method, /options: \.atomic\)[\s\S]+simulatorLaunchRecorded = true[\s\S]+Self\.json\(\["token": token\]\)[\s\S]+window\.__maydanSimulatorLaunchReady/);
  const python = read('scripts/ios/smoke_simulator_launch.py');
  assert.match(python, /cold[^\n]*45|45[^\n]*cold/);
  assert.match(python, /relaunch[^\n]*15|15[^\n]*relaunch/);
});

test('actual Home initialization owns the receipt, not a document-load or splash callback', () => {
  const source = readFileSync(new URL('../src/platform/screens/Home.jsx', import.meta.url), 'utf8');
  assert.match(source, /useEffect\(\(\) => reportSimulatorHomeReady\(\{ accountReady: account\.ready, gameCount: GAMES\.length \}\), \[account\.ready\]\)/);
});

test('the exact eight-game launch gate follows the current catalog across JS, native and Python', () => {
  const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  const catalog = read('src/platform/registry.js').match(/export const GAMES = \[([^\]]+)\]/)?.[1].split(',').map(id => id.trim());
  assert.equal(catalog?.length, 8, 'adding/removing a game must intentionally update every readiness gate');
  assert.ok(catalog.includes('mafia'));
  const native = read('ios/Maydan/GameViewController.swift');
  assert.match(native, /payload\["gameCardCount"\] as\? Int == 8 else \{ return \}/);
  assert.match(native, /"phase": "home-ready", "route": "home", "gameCardCount": 8/);
  assert.match(read('scripts/ios/smoke_simulator_launch.py'), /type\(value\.get\("gameCardCount"\)\) is not int or value\["gameCardCount"\] != 8/);
  const missing = fixture(); missing.cards.pop();
  reportSimulatorHomeReady({ accountReady: true, gameCount: 8, host: missing.host });
  missing.tick(); missing.tick(); assert.deepEqual(missing.messages, [], 'seven mounted controls cannot pass the current catalog');
});

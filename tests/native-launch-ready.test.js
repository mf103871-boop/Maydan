import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { reportSimulatorHomeReady } from '../src/platform/native-launch-ready.js';

const token = 'e7b0d07a-7fcb-4b58-86c7-32aff0457518';
function fixture() {
  const messages = [], frames = new Map();
  let next = 0;
  const node = () => ({ hidden: false, disabled: false, closest: () => null,
    getBoundingClientRect: () => ({ width: 100, height: 100 }) });
  const cards = Array.from({ length: 8 }, node), home = node(), navigation = node();
  home.querySelectorAll = () => cards;
  const host = { __maydanSimulatorLaunchToken: token,
    webkit: { messageHandlers: { maydan: { postMessage: message => messages.push(message) } } },
    document: { visibilityState: 'visible', querySelector: selector => selector.includes('home') ? home : navigation },
    getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
    requestAnimationFrame: callback => { frames.set(++next, callback); return next; },
    cancelAnimationFrame: id => frames.delete(id) };
  const tick = () => { const work = [...frames.values()]; frames.clear(); work.forEach(callback => callback()); };
  return { host, cards, home, navigation, messages, frames, tick };
}

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
    reportSimulatorHomeReady({ accountReady: true, gameCount: 8, host: f.host });
    f.tick(); f.tick(); assert.deepEqual(f.messages, []);
  }
});

test('no simulator token means no scheduling; unmount or token change retires a pending receipt', () => {
  for (const value of [undefined, '', 'previous-run', token.toUpperCase()]) {
    const f = fixture(); f.host.__maydanSimulatorLaunchToken = value;
    assert.equal(reportSimulatorHomeReady({ accountReady: true, gameCount: 8, host: f.host }), undefined);
    assert.equal(f.frames.size, 0);
  }
  const f = fixture(), stop = reportSimulatorHomeReady({ accountReady: true, gameCount: 8, host: f.host });
  f.tick(); stop(); f.tick(); assert.deepEqual(f.messages, []);
  const g = fixture(); reportSimulatorHomeReady({ accountReady: true, gameCount: 8, host: g.host });
  g.tick(); g.host.__maydanSimulatorLaunchToken = '00000000-0000-4000-8000-000000000002'; g.tick();
  assert.deepEqual(g.messages, []);
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

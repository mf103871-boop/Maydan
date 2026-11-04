import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const swift = readFileSync(new URL('../ios/Maydan/GameViewController.swift', import.meta.url), 'utf8');
const marker = 'private static let simulatorAudioScript = #"""';
const scriptAt = swift.indexOf(marker);
assert.ok(scriptAt >= 0);
const script = swift.slice(scriptAt + marker.length, swift.indexOf('"""#', scriptAt + marker.length));
const bossa = 'maydan://app/audio-warmth-preview/audio/music-bossa-8173a990b555.m4a';

function fixture() {
  let now = 10000;
  const listeners = new Map();
  class Context {
    constructor() { this.state = 'running'; this.currentTime = 1; }
    createMediaElementSource(media) { const node = { media }; this.lastNode = node; return node; }
  }
  const window = { AudioContext: Context, addEventListener: (type, fn) => listeners.set(type, fn) };
  const document = { dispatchEvent() {} };
  vm.runInNewContext(script, { window, document, localStorage: { setItem() {} },
    location: { href: 'maydan://app/index.html' }, Event: class {}, CustomEvent: class {},
    Date: { now: () => now }, performance: { now: () => now } });
  const proof = window.__maydanAudioSmoke;
  const media = (url = bossa) => {
    const handlers = new Map();
    return { src: url, currentSrc: url, currentTime: 3, duration: 78.8, readyState: 1,
      networkState: 2, paused: true, seeking: false, ended: false, error: null, actions: [],
      addEventListener(type, fn) { const fns = handlers.get(type) || []; fns.push(fn); handlers.set(type, fns); },
      emit(type) { for (const fn of handlers.get(type) || []) fn({ type }); },
      play() { this.actions.push('play'); }, pause() { this.actions.push('pause'); }, load() { this.actions.push('load'); } };
  };
  return { proof, window, media, advance: ms => { now += ms; },
    snapshot: () => JSON.parse(JSON.stringify(proof.snapshot())) };
}

test('audio event instrumentation is injected only by the opted-in simulator fixture', () => {
  assert.match(swift, /#if targetEnvironment\(simulator\)[\s\S]*MAYDAN_SIMULATOR_AUDIO/);
  assert.match(swift, /if simulatorAudioFixture\s*\{\s*configuration\.userContentController\.addUserScript\(WKUserScript\(\s*source: Self\.simulatorAudioScript/);
  assert.ok(swift.lastIndexOf('#if targetEnvironment(simulator)', scriptAt) > swift.lastIndexOf('#endif', scriptAt));
  assert.match(script, /mediaEvents/);
});

test('captures seek and metadata transitions before teardown, retaining the known local file after emptied', () => {
  const f = fixture(), context = new f.window.AudioContext(), media = f.media();
  const node = context.createMediaElementSource(media);
  assert.equal(node, context.lastNode);
  media.emit('loadedmetadata');
  media.seeking = true; media.emit('seeking');
  f.advance(100); media.currentTime = 3.25; media.seeking = false; media.emit('seeked');
  media.paused = false; media.emit('play'); media.emit('playing');
  media.error = { code: 3, message: 'private text must not be copied' }; media.emit('error');
  media.currentSrc = ''; media.src = ''; media.currentTime = 0; media.duration = NaN;
  media.readyState = 0; media.paused = true; media.emit('emptied');
  const events = f.snapshot().mediaEvents;
  assert.deepEqual(events.map(event => event.event), ['source-attached', 'loadedmetadata', 'seeking', 'seeked', 'play', 'playing', 'error', 'emptied']);
  const seeked = events.find(event => event.event === 'seeked');
  assert.equal(seeked.time, 3.25); assert.equal(seeked.seeking, false);
  assert.equal(seeked.contextIndex, 0); assert.equal(seeked.mediaIndex, 0); assert.equal(seeked.contextTime, 1);
  assert.equal(events.at(-1).url, bossa); assert.equal(events.at(-1).readyState, 0);
  assert.equal(events.at(-1).duration, null);
  assert.equal(events.find(event => event.event === 'error').error, 3);
  assert.equal(JSON.stringify(events).includes('private text'), false);
  assert.deepEqual(media.actions, [], 'observation must not call media playback/load methods');
});

test('timeupdate is sampled per media without suppressing seek, stall, ended or teardown events', () => {
  const f = fixture(), context = new f.window.AudioContext(), media = f.media();
  context.createMediaElementSource(media);
  for (let i = 0; i < 1000; i++) { media.emit('timeupdate'); f.advance(10); }
  for (const type of ['waiting', 'stalled', 'seeking', 'seeked', 'ended', 'emptied']) media.emit(type);
  const state = f.snapshot();
  assert.equal(state.mediaEvents.filter(event => event.event === 'timeupdate').length, 10);
  for (const type of ['waiting', 'stalled', 'seeking', 'seeked', 'ended', 'emptied']) assert.ok(state.mediaEvents.some(event => event.event === type));
  assert.equal(state.mediaEventPolicy.timeupdateMinIntervalMs, 1000);
  assert.deepEqual(media.actions, []);
});

test('recent history stays bounded and identifies dropped older events', () => {
  const f = fixture(), context = new f.window.AudioContext(), media = f.media();
  context.createMediaElementSource(media);
  for (let i = 0; i < 160; i++) { f.advance(1); media.emit('seeking'); }
  const state = f.snapshot();
  assert.equal(state.mediaEvents.length, 128);
  assert.equal(state.mediaEventPolicy.limit, 128);
  assert.equal(state.mediaEventsDropped, 33);
  assert.equal(state.mediaEvents.at(-1).sequence, 161);
  assert.equal(state.mediaEvents[0].sequence, 34);
});

test('separate media and contexts remain distinguishable and capture only approved local file URLs', () => {
  const f = fixture(), first = new f.window.AudioContext(), second = new f.window.AudioContext();
  const a = f.media(), b = f.media('https://example.invalid/audio.m4a?token=private'), c = f.media(`${bossa}?token=private`);
  first.createMediaElementSource(a); second.createMediaElementSource(b); second.createMediaElementSource(c);
  a.emit('seeked'); b.emit('loadedmetadata'); c.emit('error');
  const events = f.snapshot().mediaEvents;
  assert.deepEqual(events.slice(0, 3).map(event => [event.mediaIndex, event.contextIndex]), [[0, 0], [1, 1], [2, 1]]);
  assert.equal(events[0].url, bossa); assert.equal(events[1].url, null); assert.equal(events[2].url, null);
  assert.equal(JSON.stringify(events).includes('token='), false);
  assert.equal(JSON.stringify(events).includes('example.invalid'), false);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MAFIA_CUES, MAFIA_PHASE_CUES, createMafiaPhaseAudio, createMafiaPublicAudio, renderMafiaCue } from '../src/games/mafia/audio.js';
import { createSound } from '../src/shared/fx/sound.js';
import { SAMPLE_BANK } from '../src/shared/fx/sample-bank.js';
import { MUSIC_BANK } from '../src/shared/fx/music-bank.js';
import { createAudioEvents } from '../src/shared/fx/audio-events.js';
import { build } from 'esbuild';

const state = (phase, n, extra = {}) => ({ matchId: 'match', phaseId: `phase-${n}`, phase, ...extra });
const settle = async () => { for (let i = 0; i < 8; i += 1) await new Promise(resolve => setImmediate(resolve)); };
function recorder() {
  const calls = [], stops = [];
  const sound = { play: (name, options) => calls.push({ name, ...options }), stopCues: names => stops.push(names) };
  return { sound, calls, stops };
}

test('Mafia phase sound is neutral to secret state and does not replay an initial or repeated snapshot', () => {
  const { sound, calls } = recorder(), audio = createMafiaPhaseAudio(sound);
  audio.update(state('night', 1));
  assert.equal(calls.length, 0);
  const dawn = state('dawn', 2);
  Object.defineProperty(dawn, 'you', { get() { throw new Error('audio must never inspect a private role'); } });
  Object.defineProperty(dawn, 'log', { get() { throw new Error('audio must never inspect an outcome'); } });
  audio.update(dawn); audio.update(dawn);
  assert.deepEqual(calls.map(call => call.name), ['mafiaDawn']);
  assert.equal(calls[0].guard(), true);
  audio.update(state('discussion', 3));
  assert.equal(calls[0].guard(), false);
  assert.equal(calls.length, 1);
  audio.update(state('night', 4));
  assert.equal(calls[1].name, 'mafiaNight');
  assert.equal(calls[1].guard(), true);
});

test('background, waiting, design preview and disposal cancel pending phase cues without returning them on foreground', () => {
  const { sound, calls } = recorder(), audio = createMafiaPhaseAudio(sound);
  audio.update(state('opening', 1));
  audio.update(state('night', 2));
  audio.suspend(); assert.equal(calls[0].guard(), false);
  audio.update(state('night', 2)); assert.equal(calls.length, 1);
  audio.update(state('dawn', 3), { hidden: true });
  audio.update(state('dawn', 3), { hidden: false });
  audio.update(state('night', 4, { waiting: true }));
  audio.update(state('night', 4, { waiting: false }));
  audio.update(state('verdict', 5), { preview: true });
  audio.update(state('verdict', 5), { preview: false });
  assert.equal(calls.length, 1);
  audio.update(state('over', 6)); assert.equal(calls.at(-1).name, 'mafiaFinal');
  audio.dispose(); assert.equal(calls.at(-1).guard(), false);
  audio.update(state('night', 7)); assert.equal(calls.length, 2);
});

test('a new match/phase cannot inherit a previous phase guard or request duplicate clock taps', () => {
  const { sound, calls } = recorder(), audio = createMafiaPhaseAudio(sound);
  audio.update(state('opening', 1));
  audio.update(state('night', 2));
  audio.update(state('night', 2, { matchId: 'next-match' }));
  assert.equal(calls.length, 2);
  assert.equal(calls[0].guard(), false); assert.equal(calls[1].guard(), true);
  assert.deepEqual(Object.keys(MAFIA_PHASE_CUES).sort(), ['dawn', 'night', 'nomination', 'over']);
});

test('server cancellations never request the Mafia match-ending cue', () => {
  for (const reason of ['players_left', 'voice_unavailable', 'technical_abort', 'cancelled', 'expired']) {
    const { sound, calls } = recorder(), audio = createMafiaPhaseAudio(sound);
    audio.update(state('opening', 1)); audio.update(state('over', 2, { reason }));
    assert.deepEqual(calls, [], reason);
  }
  for (const reason of ['faction', 'day_limit', 'time_limit']) {
    const { sound, calls } = recorder(), audio = createMafiaPhaseAudio(sound);
    audio.update(state('opening', 1)); audio.update(state('over', 2, { reason }));
    assert.equal(calls.at(-1).name, 'mafiaFinal', reason);
  }
});

test('public Mafia cues consume initial/history snapshots and never read private roles or reports', () => {
  const calls = [], sound = { emit: (type, options) => calls.push({ type, ...options }) }, audio = createMafiaPublicAudio(sound);
  const publicState = (phase, log) => {
    const value = state(phase, phase === 'night' ? 1 : 2, { code: 'ABCD12', log });
    Object.defineProperty(value, 'you', { get() { throw new Error('private role read'); } });
    Object.defineProperty(value, 'privateEvents', { get() { throw new Error('private reports read'); } });
    return value;
  };
  const old = { id: 1, type: 'eliminated', reason: 'night', at: 100 };
  audio.update(publicState('night', [old]));
  assert.deepEqual(calls, []);
  const events = [old,
    { id: 2, type: 'eliminated', reason: 'forfeit', at: 200 },
    { id: 3, type: 'eliminated', reason: 'verdict', at: 300 },
    { id: 4, type: 'eliminated', reason: 'night', at: 400 },
    { id: 5, type: 'verdict_closed', passed: false, at: 500 },
  ];
  audio.update(publicState('dawn', events)); audio.update(publicState('dawn', events));
  assert.deepEqual(calls.map(value => value.type), ['mafia.assassination.public', 'mafia.judgment.public']);
  assert.deepEqual(calls.map(value => value.at), [400, 500], 'preserve event time instead of making old events fresh');
  assert.ok(calls.every(value => value.publicEvent && value.guard()));
  audio.update(publicState('night', events));
  assert.ok(calls.every(value => !value.guard()), 'phase change fences queued public cues');
  audio.update(publicState('night', [old]));
  assert.equal(calls.length, 2, 'older history cannot replay a previous public sequence');
});

test('public Mafia cues stay silent on hidden/preview/waiting snapshots and after suspension or disposal', () => {
  const calls = [], audio = createMafiaPublicAudio({ emit: (type, options) => calls.push({ type, ...options }) });
  const log = [];
  const next = (id, options = {}, extra = {}) => {
    log.push({ id, type: 'eliminated', reason: 'night', at: Date.now() });
    audio.update(state('dawn', 2, { log: [...log], ...extra }), options);
  };
  next(1); next(2, { hidden: true }); next(3, { preview: true }); next(4, {}, { waiting: true });
  assert.deepEqual(calls, []);
  audio.suspend(); next(5); assert.deepEqual(calls, []);
  next(6); assert.equal(calls.length, 1); assert.equal(calls[0].guard(), true);
  audio.dispose(); assert.equal(calls[0].guard(), false); next(7); assert.equal(calls.length, 1);
});

test('public Mafia event age survives both positive and negative phone clock skew', () => {
  const serverNow = 1_800_000_000_000;
  for (const skew of [-86_400_000, 86_400_000]) {
    const localNow = serverNow + skew, played = [], emitted = [];
    const bus = createAudioEvents((cue, options) => { played.push({ cue, ...options }); return true; }, { now: () => localNow });
    const audio = createMafiaPublicAudio({ emit(type, options) { emitted.push(options); return bus.emit(type, options); } }, { now: () => localNow });
    audio.update(state('night', 1, { serverNow, log: [] }));
    audio.update(state('dawn', 2, { serverNow, log: [
      { id: 1, type: 'eliminated', reason: 'night', at: serverNow - 5_000 },
      { id: 2, type: 'verdict_closed', at: serverNow - 100 },
    ] }));
    assert.deepEqual(emitted.map(event => localNow - event.at), [5_000, 100], `age preserved for skew ${skew}`);
    assert.deepEqual(played.map(event => event.cue), ['mafiaJudgment'], 'fresh cue accepted, old cue silent');
  }
});

test('a public event without a timestamp is consumed silently, while a projection without serverNow retains its original timestamp', () => {
  const emitted = [], audio = createMafiaPublicAudio({ emit: (type, options) => emitted.push(options) }, { now: () => 100_000 });
  audio.update(state('night', 1, { log: [] }));
  audio.update(state('dawn', 2, { log: [
    { id: 1, type: 'eliminated', reason: 'night' },
    { id: 2, type: 'verdict_closed', at: 5_000 },
  ] }));
  assert.equal(emitted.length, 1); assert.equal(emitted[0].at, 5_000, 'no fabricated receipt time');
  audio.update(state('dawn', 2, { serverNow: 100_000, log: [{ id: 1, type: 'eliminated', reason: 'night', at: 99_999 }] }));
  assert.equal(emitted.length, 1, 'adding a timestamp later does not replay an already consumed event');
});

test('Mafia phase scenes update one stable owner without an intervening lobby release', async t => {
  const hooks = `
    let slots = [], index = 0, pending = [];
    const same = (a,b) => a && b && a.length === b.length && a.every((x,i) => Object.is(x,b[i]));
    export function useRef(value) { const at=index++; return slots[at] ||= {current:value}; }
    export function useEffect(fn,deps) {
      const at=index++, previous=slots[at];
      if(!previous || !same(previous.deps,deps)) {
        slots[at]={deps,cleanup:previous?.cleanup}; pending.push({at,fn,cleanup:previous?.cleanup});
      }
    }
    export function render(fn) { index=0; pending=[]; fn(); for(const effect of pending){effect.cleanup?.();slots[effect.at].cleanup=effect.fn();} }
    export function unmount(){for(const slot of slots)slot?.cleanup?.();slots=[];}
  `;
  const result = await build({
    stdin: { contents: "export { useMafiaSound } from './src/games/mafia/useMafiaSound.js'; export { render, unmount } from 'react';", resolveDir: process.cwd() },
    bundle: true, write: false, platform: 'node', format: 'esm', logLevel: 'silent',
    plugins: [{ name: 'hook-driver', setup(builder) {
      builder.onResolve({ filter: /^react$/ }, () => ({ path: 'react', namespace: 'hook-driver' }));
      builder.onLoad({ filter: /.*/, namespace: 'hook-driver' }, () => ({ contents: hooks, loader: 'js' }));
    } }],
  });
  const { useMafiaSound, render, unmount } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
  const old = { document: globalThis.document, window: globalThis.window };
  globalThis.document = Object.assign(new EventTarget(), { hidden: false }); globalThis.window = new EventTarget();
  t.after(() => { unmount(); Object.assign(globalThis, old); });
  const scenes = [], releases = [];
  const sound = { play() {}, stopCues() {}, emit() {}, music: {
    scene: (owner, game, phase, priority) => scenes.push({ owner, game, phase, priority }),
    releaseScene: owner => releases.push(owner),
  } };
  render(() => useMafiaSound(state('night', 1), { sound }));
  render(() => useMafiaSound(state('dawn', 2), { sound }));
  render(() => useMafiaSound(state('discussion', 3), { sound }));
  assert.deepEqual(releases, [], 'phase update never releases the higher-priority match owner');
  const phases = scenes.filter(scene => scene.priority === 30);
  assert.deepEqual(phases.map(scene => scene.phase), ['night', 'dawn', 'discussion']);
  assert.equal(new Set(phases.map(scene => scene.owner)).size, 1);
  assert.equal(scenes.filter(scene => scene.phase === 'lobby').length, 1, 'only the initial ambience requested lobby');
  unmount(); assert.equal(releases.length, 2, 'unmount releases both ambience and match owners');
});

test('Mafia recipes only use reviewed CC0 recordings, stay short/quiet, and retain shared ownership metadata', () => {
  const provenance = JSON.parse(readFileSync(new URL('../assets/audio/maydan-v3/provenance.json', import.meta.url)));
  for (const [name, cue] of Object.entries(MAFIA_CUES)) {
    const original = provenance.cues[cue.sample];
    assert.equal(original.origin, 'sourced'); assert.equal(original.source.license, 'CC0 1.0');
    assert.ok(cue.gain > 0 && cue.gain <= 0.6); assert.ok(cue.rate >= 0.7 && cue.rate <= 1);
    const seconds = SAMPLE_BANK[cue.sample].frames / 48000 / cue.rate;
    assert.ok(cue.offsets.at(-1) + seconds < 2);
    for (let i = 1; i < cue.offsets.length; i += 1) assert.ok(cue.offsets[i] - cue.offsets[i - 1] >= seconds, 'clock notes do not stack');
    const calls = [];
    const first = renderMafiaCue({ sample: (id, meta) => { const call = { id, ...meta }; calls.push(call); return call; } }, name, { name, gain: 0.3, requested: 123, ordinal: 4 });
    assert.equal(first, calls[0]); assert.equal(calls.length, cue.offsets.length);
    assert.ok(calls.every(call => call.id === cue.sample && call.name === name && call.ordinal === 4 && call.requested === 123 && call.gain === 0.3 * cue.gain));
  }
});

function environment(t) {
  const old = { window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch };
  const contexts = [], listeners = new Map();
  const param = () => ({ value: 0, setTargetAtTime(v) { this.value = v; }, setValueAtTime(v) { this.value = v; } });
  const node = extra => ({ connect() {}, disconnect() {}, ...extra });
  class Context {
    constructor() { this.state = 'running'; this.currentTime = 1; this.destination = {}; this.sources = []; this.gains = []; contexts.push(this); }
    createGain() { const gain = node({ gain: param() }); this.gains.push(gain); return gain; }
    createDynamicsCompressor() { return node(Object.fromEntries(['threshold', 'knee', 'ratio', 'attack', 'release'].map(key => [key, param()]))); }
    createBufferSource() { const source = node({ playbackRate: param(), starts: [], stops: [], start(t) { this.starts.push(t); }, stop(t) { this.stops.push(t); } }); this.sources.push(source); return source; }
    decodeAudioData(data) { return Promise.resolve({ duration: data.byteLength / 48000, length: data.byteLength }); }
    resume() { this.state = 'running'; return Promise.resolve(); }
    suspend() { this.state = 'suspended'; return Promise.resolve(); }
    close() { this.state = 'closed'; return Promise.resolve(); }
  }
  const document = { hidden: false, addEventListener(name, fn) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); }, removeEventListener(name, fn) { listeners.get(name)?.delete(fn); } };
  globalThis.document = document;
  globalThis.window = { AudioContext: Context, addEventListener: document.addEventListener, removeEventListener: document.removeEventListener };
  globalThis.fetch = async url => {
    const entry = [...Object.values(SAMPLE_BANK), ...Object.values(MUSIC_BANK)].find(item => item.url === url);
    return entry ? new Response(new Uint8Array(entry.frames)) : new Response('', { status: 404 });
  };
  t.after(() => Object.assign(globalThis, old));
  return { contexts, dispatch: (name, detail) => { for (const fn of listeners.get(name) || []) fn({ detail }); } };
}

test('Mafia music suppression is leased, stops competing home requests and preserves preferences on exit', async t => {
  const env = environment(t), sound = createSound({ musicVolume: 0.3 });
  await sound.preload(); sound.music.play('home'); await settle();
  assert.equal(sound.music.current, 'home');
  const a = Symbol('entry'), b = Symbol('match');
  sound.music.setSuppressed(true, a); sound.music.setSuppressed(true, b);
  sound.music.play('home'); await settle();
  assert.equal(sound.music.current, null); assert.equal(sound.music.wanted, 'home');
  assert.equal(sound.music.enabled, true); assert.equal(sound.music.volume, 0.3);
  const count = env.contexts[0].sources.length;
  sound.play('mafiaRole'); assert.equal(env.contexts[0].sources.length, count + 1, 'effects remain independently enabled');
  sound.music.setSuppressed(false, a); await settle(); assert.equal(sound.music.current, null);
  sound.music.setSuppressed(false, b); await settle(); assert.equal(sound.music.current, 'home');
  sound.music.setSuppressed(true, a); sound.music.enable(false);
  sound.music.setSuppressed(false, a); await settle(); assert.equal(sound.music.current, null);
  assert.equal(sound.music.enabled, false, 'a lease cannot re-enable the user setting');
  sound.dispose();
});

test('a delayed Mafia cue is fenced after phase change, while matching cue cleanup leaves unrelated effects alone', async t => {
  const env = environment(t), sound = createSound();
  let valid = true;
  sound.play('mafiaNight', { guard: () => valid }); valid = false;
  await settle(); assert.equal(env.contexts[0].sources.length, 0);
  sound.play('mafiaNight'); sound.play('wrong');
  const sources = env.contexts[0].sources;
  assert.equal(sources.length, 4);
  sound.stopCues(Object.keys(MAFIA_CUES));
  assert.ok(sources.slice(0, 3).every(source => source.stops.length));
  assert.equal(sources[3].stops.length, 0);
  sound.dispose();
});

test('Mafia effects obey master mute, call ducking and native background recovery without spoken feedback', async t => {
  const env = environment(t), sound = createSound({ voice: true });
  sound.attach(); await sound.preload();
  sound.enable(false); sound.play('mafiaDawn'); assert.equal(env.contexts[0].sources.length, 0);
  sound.enable(true); sound.setDucking(true, 'mafia-call');
  sound.play('mafiaDawn'); assert.equal(env.contexts[0].sources.length, 1);
  assert.equal(env.contexts[0].gains[0].gain.value, 0.75 ** 2 * 0.3);
  assert.equal(env.contexts[0].sources[0].playbackRate.value, MAFIA_CUES.mafiaDawn.rate);
  env.dispatch('maydan-audio-lifecycle', { state: 'background' });
  assert.ok(env.contexts[0].sources[0].stops.length);
  sound.play('mafiaNight'); assert.equal(env.contexts[0].sources.length, 1);
  env.dispatch('maydan-audio-lifecycle', { state: 'foreground' }); await settle();
  assert.equal(env.contexts[0].sources.length, 1, 'no abandoned cue returns');
  sound.dispose();
});

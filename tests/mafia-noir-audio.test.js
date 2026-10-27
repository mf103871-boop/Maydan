import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MAFIA_CUES, MAFIA_PHASE_CUES, createMafiaPhaseAudio, renderMafiaCue } from '../src/games/mafia/audio.js';
import { createSound } from '../src/shared/fx/sound.js';
import { SAMPLE_BANK } from '../src/shared/fx/sample-bank.js';
import { MUSIC_BANK } from '../src/shared/fx/music-bank.js';

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
  assert.deepEqual(Object.keys(MAFIA_PHASE_CUES).sort(), ['dawn', 'night', 'nomination', 'over', 'verdict']);
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

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createSound } from '../src/shared/fx/sound.js';

function audioEnvironment(t, { state = 'running', resume } = {}) {
  const instances = [];
  const listeners = new Map();
  const param = () => ({ value: 0, setValueAtTime(value) { this.value = value; }, exponentialRampToValueAtTime() {}, setTargetAtTime(value) { this.value = value; } });
  class Context {
    constructor() { this.state = state; this.currentTime = 4; this.sampleRate = 8000; this.nodes = []; this.sources = []; this.buffers = []; this.destination = {}; instances.push(this); }
    node(extra = {}) { const node = { connections: [], disconnected: false, connect(to) { this.connections.push(to); }, disconnect() { this.disconnected = true; }, ...extra }; this.nodes.push(node); return node; }
    createGain() { return this.node({ gain: param() }); }
    createDynamicsCompressor() { return this.node(Object.fromEntries(['threshold', 'knee', 'ratio', 'attack', 'release'].map((key) => [key, param()]))); }
    createBiquadFilter() { return this.node({ frequency: param() }); }
    source(extra) { const node = this.node({ starts: [], stops: [], start(time) { this.starts.push(time); }, stop(time) { this.stops.push(time); }, ...extra }); this.sources.push(node); return node; }
    createOscillator() { return this.source({ frequency: param() }); }
    createBufferSource() { return this.source({ playbackRate: param() }); }
    createBuffer(count, size, rate) { const channels = Array.from({ length: count }, () => new Float32Array(size)); const buffer = { length: size, sampleRate: rate, numberOfChannels: count, duration: size / rate, getChannelData: (i) => channels[i] }; this.buffers.push(buffer); return buffer; }
    async resume() { if (resume) await resume(); this.state = 'running'; }
    async suspend() { this.state = 'suspended'; }
    async close() { this.state = 'closed'; }
  }
  const oldWindow = globalThis.window, oldDocument = globalThis.document;
  const document = { hidden: false, addEventListener(name, fn) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); }, removeEventListener(name, fn) { listeners.get(name)?.delete(fn); } };
  globalThis.window = { AudioContext: Context };
  globalThis.document = document;
  t.after(() => { globalThis.window = oldWindow; globalThis.document = oldDocument; });
  return { instances, listeners, document, dispatch(name) { for (const fn of listeners.get(name) || []) fn(); } };
}
const flush = () => new Promise((resolve) => setImmediate(resolve));

test('audio is lazy, respects saved mute, and attaches/disposes without listener leaks', async (t) => {
  const env = audioEnvironment(t);
  const sound = createSound({ enabled: false });
  sound.attach(); sound.attach();
  assert.equal(env.listeners.get('pointerdown').size, 1);
  env.dispatch('pointerdown'); sound.play('correct');
  assert.equal(env.instances.length, 0);
  sound.enable(true); sound.play('correct');
  assert.equal(env.instances.length, 1);
  assert.equal(env.instances[0].sources.length, 1);
  sound.dispose(); sound.dispose();
  assert.equal(env.instances[0].state, 'closed');
  assert.ok([...env.listeners.values()].every((set) => !set.size));
});

test('muting cancels current and scheduled voices and never replays them on unmute', (t) => {
  const env = audioEnvironment(t);
  const sound = createSound();
  sound.play('drumroll');
  const c = env.instances[0], count = c.sources.length;
  assert.ok(count > 1);
  assert.ok(c.sources.some((source) => source.starts[0] > c.currentTime), 'anticipation includes scheduled bubbles');
  sound.enable(false);
  assert.ok(c.sources.every((source) => source.stops.includes(undefined) && source.disconnected));
  assert.equal(c.state, 'running', 'mute uses gain/cancellation, not a paused timeline');
  sound.enable(true);
  assert.equal(c.sources.length, count);
  sound.dispose();
});

test('pending browser unlock cannot resurrect a cancelled cue', async (t) => {
  let release;
  const env = audioEnvironment(t, { state: 'suspended', resume: () => new Promise((resolve) => { release = resolve; }) });
  const sound = createSound();
  sound.play('fanfare'); sound.enable(false); sound.enable(true);
  release(); await flush();
  assert.equal(env.instances[0].sources.length, 0);
  sound.play('correct');
  assert.equal(env.instances[0].sources.length, 1);
  sound.dispose();
});

test('backgrounding stops voices; a later gesture recovers an interrupted context', async (t) => {
  const env = audioEnvironment(t);
  const sound = createSound(); sound.attach(); sound.play('fanfare');
  const c = env.instances[0], count = c.sources.length;
  env.document.hidden = true; env.dispatch('visibilitychange');
  assert.equal(c.state, 'suspended');
  sound.play('correct'); assert.equal(c.sources.length, count);
  env.document.hidden = false; env.dispatch('visibilitychange'); c.state = 'interrupted';
  env.dispatch('pointerdown'); await flush();
  sound.play('correct'); assert.equal(c.sources.length, count + 1);
  sound.dispose();
});

test('master volume, compression, aliases and cached samples reach one output bus', (t) => {
  const env = audioEnvironment(t);
  const sound = createSound({ volume: 0.5 }); sound.play('open'); sound.play('win');
  const c = env.instances[0], master = c.nodes[0], compressor = c.nodes[1];
  assert.equal(master.gain.value, 0.25);
  assert.equal(master.connections[0], compressor); assert.equal(compressor.connections[0], c.destination);
  assert.equal(c.sources.length, 2);
  sound.stop(); sound.play('open'); sound.play('win');
  assert.equal(c.buffers.length, 2, 'repeated cues reuse their decoded PCM buffers');
  assert.equal(c.sources[0].buffer, c.sources[2].buffer);
  assert.equal(c.sources[1].buffer, c.sources[3].buffer);
  sound.setVolume(0.8); assert.equal(master.gain.value, 0.8 ** 2);
  sound.setDucking(true); assert.equal(master.gain.value, 0.8 ** 2 * 0.3);
  sound.setVolume(2); assert.equal(sound.volume, 1);
  sound.setVolume(-1); assert.equal(sound.volume, 0);
  const count = c.sources.length; sound.play('correct'); assert.equal(c.sources.length, count);
  sound.dispose();
});

test('repeated clicks are limited and all ended voice nodes disconnect', (t) => {
  const env = audioEnvironment(t);
  const sound = createSound(); sound.play('click'); sound.play('click');
  const c = env.instances[0]; assert.equal(c.sources.length, 1);
  c.sources[0].onended();
  assert.equal(c.sources[0].onended, null);
  assert.ok(c.nodes.slice(2).every((node) => node.disconnected));
  sound.dispose();
});

test('resume rejection is harmless and can be retried by the next gesture', async (t) => {
  let reject = true;
  const env = audioEnvironment(t, { state: 'suspended', resume: async () => { if (reject) throw new Error('not allowed'); } });
  const sound = createSound(); sound.attach(); sound.play('correct'); await flush();
  assert.equal(env.instances[0].sources.length, 0);
  reject = false; env.dispatch('pointerdown'); await flush();
  sound.play('reveal'); assert.equal(env.instances[0].sources.length, 1);
  sound.dispose();
});

test('all approved masters reach playback as identical 24-bit PCM without fetching', (t) => {
  const env = audioEnvironment(t);
  t.mock.method(globalThis, 'fetch', () => { throw new Error('SFX must not fetch'); });
  let now = 1000;
  t.mock.method(Date, 'now', () => now);
  const sound = createSound();
  const cases = [['click', 'tap'], ['click', 'tap-2'], ['click', 'tap-3'],
    ['correct', 'correct'], ['wrong', 'wrong'], ['reveal', 'reveal'], ['win', 'win']];
  for (const [name, file] of cases) {
    sound.play(name); now += 1000;
    const buffer = env.instances[0].sources.at(-1).buffer;
    assert.equal(buffer.sampleRate, 48000);
    assert.equal(buffer.numberOfChannels, 2);
    const actual = Buffer.alloc(buffer.length * 6);
    for (let frame = 0; frame < buffer.length; frame++) {
      for (let ch = 0; ch < 2; ch++) actual.writeIntLE(Math.round(buffer.getChannelData(ch)[frame] * 8388608), frame * 6 + ch * 3, 3);
    }
    const wav = readFileSync(new URL(`../assets/audio/maydan-bubbles/${file}.wav`, import.meta.url));
    let expected;
    for (let pos = 12; pos + 8 <= wav.length;) {
      const size = wav.readUInt32LE(pos + 4);
      if (wav.toString('ascii', pos, pos + 4) === 'data') expected = wav.subarray(pos + 8, pos + 8 + size);
      pos += 8 + size + size % 2;
    }
    const hash = (value) => createHash('sha256').update(value).digest('hex');
    assert.equal(hash(actual), hash(expected), `approved waveform changed: ${file}`);
  }
  assert.equal(env.instances[0].buffers.length, 7);
  sound.dispose();
});

test('every public cue plays a sample and the overlap budget stops old voices', (t) => {
  const env = audioEnvironment(t);
  const sound = createSound();
  let now = 1000;
  t.mock.method(Date, 'now', () => now);
  for (const name of sound.names) {
    const before = env.instances[0]?.sources.length || 0;
    sound.play(name); now += 2000;
    assert.ok(env.instances[0].sources.length > before, `silent cue: ${name}`);
  }
  const c = env.instances[0];
  assert.ok(c.sources.every((s) => s.buffer && s.playbackRate.value > 0));
  assert.ok(c.sources.filter((s) => !s.disconnected).length <= 20);
  assert.ok(c.sources.some((s) => s.stops.includes(undefined)));
  sound.dispose();
});

test('a closed context is rebuilt with fresh buffers and keeps question-audio ducking', (t) => {
  const env = audioEnvironment(t);
  const sound = createSound(); sound.setDucking(true); sound.play('correct');
  assert.equal(env.instances[0].nodes[0].gain.value, 0.75 ** 2 * 0.3);
  const oldBuffer = env.instances[0].sources[0].buffer;
  env.instances[0].state = 'closed';
  sound.play('reveal');
  assert.equal(env.instances.length, 2);
  assert.equal(env.instances[1].nodes[0].gain.value, 0.75 ** 2 * 0.3);
  assert.notEqual(env.instances[1].sources[0].buffer, oldBuffer);
  sound.dispose();
});

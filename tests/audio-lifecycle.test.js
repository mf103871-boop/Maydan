import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createSound } from '../src/shared/fx/sound.js';
import { SAMPLE_BANK } from '../src/shared/fx/sample-bank.js';

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
    // Decoding yields a buffer whose length identifies the cue (see fetch below).
    decodeAudioData(data) { this.decoded = (this.decoded || 0) + 1; return Promise.resolve(this.createBuffer(2, data.byteLength, 48000)); }
  }
  const oldWindow = globalThis.window, oldDocument = globalThis.document, oldFetch = globalThis.fetch;
  const fetched = [];
  globalThis.fetch = async (url) => {
    fetched.push(String(url));
    const id = /audio\/([a-z]+)\.m4a$/.exec(String(url))?.[1];
    if (!id) return new Response('missing', { status: 404 });
    return new Response(new Uint8Array(SAMPLE_BANK[id].frames), { status: 200, headers: { 'content-type': 'audio/mp4' } });
  };
  const document = { hidden: false, addEventListener(name, fn) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); }, removeEventListener(name, fn) { listeners.get(name)?.delete(fn); } };
  globalThis.window = { AudioContext: Context };
  globalThis.document = document;
  t.after(() => { globalThis.window = oldWindow; globalThis.document = oldDocument; globalThis.fetch = oldFetch; });
  return { instances, listeners, document, fetched, dispatch(name) { for (const fn of listeners.get(name) || []) fn(); } };
}
const flush = () => new Promise((resolve) => setImmediate(resolve));
// The cues are fetched and decoded before the first play; tests warm the bank first
// where they assert synchronous playback.
async function warm(sound) { assert.equal(await sound.preload(), true); return sound; }

test('audio is lazy, respects saved mute, and attaches/disposes without listener leaks', async (t) => {
  const env = audioEnvironment(t);
  const sound = createSound({ enabled: false });
  sound.attach(); sound.attach();
  assert.equal(env.listeners.get('pointerdown').size, 1);
  env.dispatch('pointerdown'); sound.play('correct');
  assert.equal(env.instances.length, 0, 'muted: no context');
  await flush();
  assert.equal(env.fetched.length, 6, 'the encoded cues are prefetched on attach without a context');
  sound.enable(true); sound.play('correct');
  assert.equal(env.instances.length, 1);
  await flush(); await flush();
  assert.equal(env.instances[0].sources.length, 1, 'the first cue plays once the bank has decoded');
  sound.dispose(); sound.dispose();
  assert.equal(env.instances[0].state, 'closed');
  assert.ok([...env.listeners.values()].every((set) => !set.size));
});

test('muting cancels current and scheduled voices and never replays them on unmute', async (t) => {
  const env = audioEnvironment(t);
  const sound = await warm(createSound());
  sound.play('drumroll');
  const c = env.instances[0], count = c.sources.length;
  assert.ok(count > 1);
  assert.ok(c.sources.some((source) => source.starts[0] > c.currentTime), 'anticipation includes scheduled taps');
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
  release(); await flush(); await flush();
  assert.equal(env.instances[0].sources.length, 0);
  sound.play('correct'); await flush();
  assert.equal(env.instances[0].sources.length, 1);
  sound.dispose();
});

test('backgrounding stops voices; a later gesture recovers an interrupted context', async (t) => {
  const env = audioEnvironment(t);
  const sound = await warm(createSound()); sound.attach(); sound.play('fanfare');
  const c = env.instances[0], count = c.sources.length;
  env.document.hidden = true; env.dispatch('visibilitychange');
  assert.equal(c.state, 'suspended');
  sound.play('correct'); assert.equal(c.sources.length, count);
  env.document.hidden = false; env.dispatch('visibilitychange'); c.state = 'interrupted';
  env.dispatch('pointerdown'); await flush();
  sound.play('correct'); assert.equal(c.sources.length, count + 1);
  sound.dispose();
});

test('master volume, compression, aliases and cached samples reach one output bus', async (t) => {
  const env = audioEnvironment(t);
  const sound = await warm(createSound({ volume: 0.5 })); sound.play('open'); sound.play('win');
  const c = env.instances[0], master = c.nodes[0], compressor = c.nodes[1];
  assert.equal(master.gain.value, 0.25);
  assert.equal(master.connections[0], compressor); assert.equal(compressor.connections[0], c.destination);
  assert.equal(c.sources.length, 2);
  sound.stop(); sound.play('open'); sound.play('win');
  assert.equal(c.buffers.length, 6, 'each cue is decoded once and reused');
  assert.equal(c.sources[0].buffer, c.sources[2].buffer);
  assert.equal(c.sources[1].buffer, c.sources[3].buffer);
  sound.setVolume(0.8); assert.equal(master.gain.value, 0.8 ** 2);
  sound.setDucking(true); assert.equal(master.gain.value, 0.8 ** 2 * 0.3);
  sound.setVolume(2); assert.equal(sound.volume, 1);
  sound.setVolume(-1); assert.equal(sound.volume, 0);
  const count = c.sources.length; sound.play('correct'); assert.equal(c.sources.length, count);
  sound.dispose();
});

test('repeated clicks are limited and all ended voice nodes disconnect', async (t) => {
  const env = audioEnvironment(t);
  const sound = await warm(createSound()); sound.play('click'); sound.play('click');
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
  reject = false; env.dispatch('pointerdown'); await flush(); await flush();
  sound.play('reveal'); await flush(); assert.equal(env.instances[0].sources.length, 1);
  sound.dispose();
});

test('the shipped AAC cues match the manifest and the manifest matches the approved masters', () => {
  const ids = Object.keys(SAMPLE_BANK);
  assert.deepEqual(ids.sort(), ['correct', 'reveal', 'start', 'tap', 'win', 'wrong']);
  let total = 0;
  for (const [id, entry] of Object.entries(SAMPLE_BANK)) {
    const file = readFileSync(new URL(`../public/${entry.url}`, import.meta.url));
    assert.equal(createHash('sha256').update(file).digest('hex'), entry.sha256, `encoded cue changed: ${id}`);
    assert.equal(file.length, entry.bytes);
    total += file.length;
    const wav = readFileSync(new URL(`../assets/audio/maydan-casual/${id}.wav`, import.meta.url));
    let data;
    for (let pos = 12; pos + 8 <= wav.length;) {
      const size = wav.readUInt32LE(pos + 4);
      if (wav.toString('ascii', pos, pos + 4) === 'data') data = wav.subarray(pos + 8, pos + 8 + size);
      pos += 8 + size + size % 2;
    }
    assert.equal(createHash('sha256').update(data).digest('hex'), entry.masterSha256, `approved master changed: ${id}`);
    assert.equal(data.length / 6, entry.frames);
  }
  assert.ok(total < 160 * 1024, `the six cues stay small (${total} bytes)`);
});

test('cues are fetched once, decoded once per context, and a late first cue is dropped rather than played out of place', async (t) => {
  const env = audioEnvironment(t);
  let now = 1000;
  t.mock.method(Date, 'now', () => now);
  const sound = createSound();
  sound.play('correct');
  assert.equal(env.instances[0].sources.length, 0, 'nothing sounds before the bank is decoded');
  now += 5000; // the network took too long: this cue belongs to a moment that passed
  await flush(); await flush();
  assert.equal(env.instances[0].sources.length, 0);
  assert.equal(env.fetched.length, 6);
  assert.equal(env.instances[0].decoded, 6);
  now += 1000; sound.play('correct');
  assert.equal(env.instances[0].sources.length, 1, 'decoded cues play synchronously from then on');
  assert.equal(env.fetched.length, 6, 'no second fetch');
  sound.dispose();
});

test('every public cue plays a sample and the overlap budget stops old voices', async (t) => {
  const env = audioEnvironment(t);
  const sound = await warm(createSound());
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

test('a closed context is rebuilt with fresh buffers and keeps question-audio ducking', async (t) => {
  const env = audioEnvironment(t);
  const sound = await warm(createSound()); sound.setDucking(true); sound.play('correct');
  assert.equal(env.instances[0].nodes[0].gain.value, 0.75 ** 2 * 0.3);
  const oldBuffer = env.instances[0].sources[0].buffer;
  env.instances[0].state = 'closed';
  sound.play('reveal'); await flush(); await flush();
  assert.equal(env.instances.length, 2);
  assert.equal(env.instances[1].nodes[0].gain.value, 0.75 ** 2 * 0.3);
  assert.notEqual(env.instances[1].sources[0].buffer, oldBuffer);
  sound.dispose();
});

test('synth renders a caller recipe inside the shared context behind the master gain, and never outside it', async (t) => {
  const env = audioEnvironment(t);
  const sound = await warm(createSound({ volume: 0.5 }));
  const c = env.instances[0];
  const master = c.nodes[0];
  let seen = null;
  sound.synth((ctx) => {
    seen = ctx;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination); o.start(ctx.currentTime); o.stop(ctx.currentTime + 0.2);
  });
  assert.equal(env.instances.length, 1, 'no second AudioContext for a recipe');
  assert.equal(seen.destination, master, 'the recipe output lands on the master gain, not the speakers directly');
  assert.equal(seen.currentTime, 4, 'context properties read through');
  const gainNode = c.nodes.at(-1);
  assert.deepEqual(gainNode.connections, [master]);
  assert.equal(c.sources.at(-1).starts.length, 1);
  const before = c.sources.length;
  sound.enable(false);
  sound.synth((ctx) => { ctx.createOscillator().start(0); });
  assert.equal(c.sources.length, before, 'muted: the recipe is not rendered at all');
  sound.enable(true);
  sound.synth(() => { throw new Error('bad recipe'); });
  sound.synth('not a function');
  assert.equal(c.state, 'running', 'a failing recipe never breaks the bus');
});

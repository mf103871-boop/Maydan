import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createSound } from '../src/shared/fx/sound.js';
import { SAMPLE_BANK } from '../src/shared/fx/sample-bank.js';
import { MUSIC_BANK } from '../src/shared/fx/music-bank.js';

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
    // Channel data is allocated on demand: a decoded music track is millions of frames.
    createBuffer(count, size, rate) { const channels = []; const buffer = { length: size, sampleRate: rate, numberOfChannels: count, duration: size / rate, getChannelData: (i) => (channels[i] ||= new Float32Array(size)) }; this.buffers.push(buffer); return buffer; }
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
    const path = String(url).replace(/^.*?(audio\/)/, '$1');
    const id = Object.keys(SAMPLE_BANK).find((key) => SAMPLE_BANK[key].url === path);
    const track = Object.keys(MUSIC_BANK).find((key) => MUSIC_BANK[key].url === path);
    const entry = id ? SAMPLE_BANK[id] : track ? MUSIC_BANK[track] : null;
    if (!entry) return new Response('missing', { status: 404 });
    return new Response(new Uint8Array(entry.frames), { status: 200, headers: { 'content-type': 'audio/mp4' } });
  };
  const document = { hidden: false, addEventListener(name, fn) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); }, removeEventListener(name, fn) { listeners.get(name)?.delete(fn); } };
  globalThis.window = { AudioContext: Context };
  globalThis.document = document;
  t.after(() => { globalThis.window = oldWindow; globalThis.document = oldDocument; globalThis.fetch = oldFetch; });
  return { instances, listeners, document, fetched, dispatch(name) { for (const fn of listeners.get(name) || []) fn(); } };
}
const flush = () => new Promise((resolve) => setImmediate(resolve));
const settle = async () => { await flush(); await flush(); await flush(); };
// The PCM payload of a RIFF/WAVE file (the manifests hash the data chunk only).
function wavData(wav) {
  let data;
  for (let pos = 12; pos + 8 <= wav.length;) {
    const size = wav.readUInt32LE(pos + 4);
    if (wav.toString('ascii', pos, pos + 4) === 'data') data = wav.subarray(pos + 8, pos + 8 + size);
    pos += 8 + size + size % 2;
  }
  return data;
}
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
  assert.equal(env.fetched.length, Object.keys(SAMPLE_BANK).length, 'the encoded cues are prefetched on attach without a context');
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
  sound.play('drumroll'); sound.play('win');
  const c = env.instances[0], count = c.sources.length;
  assert.equal(count, 2, 'two cues, two voices');
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
  assert.equal(c.buffers.length, Object.keys(SAMPLE_BANK).length, 'each cue is decoded once and reused');
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
  // nodes 0-2 are the bus itself (cue master, compressor, music gain); the rest are voices.
  assert.ok(c.nodes.slice(3).every((node) => node.disconnected));
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
  assert.deepEqual([...ids].sort(), ['buzzer', 'click', 'correct', 'countdown', 'drumroll', 'explosion', 'pass', 'pop', 'reveal', 'start', 'tick', 'tickFast', 'timeout', 'whoosh', 'win', 'wrong']);
  let total = 0;
  for (const [id, entry] of Object.entries(SAMPLE_BANK)) {
    const file = readFileSync(new URL(`../public/${entry.url}`, import.meta.url));
    assert.equal(createHash('sha256').update(file).digest('hex'), entry.sha256, `encoded cue changed: ${id}`);
    assert.equal(file.length, entry.bytes);
    total += file.length;
    const data = wavData(readFileSync(new URL(`../assets/audio/maydan-v2/${entry.url.split('/').pop().replace(/\.m4a$/, '.wav')}`, import.meta.url)));
    assert.equal(createHash('sha256').update(data).digest('hex'), entry.masterSha256, `approved master changed: ${id}`);
    assert.equal(data.length / 6, entry.frames);
  }
  assert.ok(total < 512 * 1024, `the cue bank stays under half a megabyte (${total} bytes)`);
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
  assert.equal(env.fetched.length, Object.keys(SAMPLE_BANK).length);
  assert.equal(env.instances[0].decoded, Object.keys(SAMPLE_BANK).length);
  now += 1000; sound.play('correct');
  assert.equal(env.instances[0].sources.length, 1, 'decoded cues play synchronously from then on');
  assert.equal(env.fetched.length, Object.keys(SAMPLE_BANK).length, 'no second fetch');
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

test('background music: a screen request starts a loop on its own gain behind the compressor, crossfades between tracks and outlives sound.stop()', async (t) => {
  const env = audioEnvironment(t);
  const sound = createSound();
  assert.equal(sound.music.current, null);
  assert.deepEqual(sound.music.names, ['home', 'calm', 'tense', 'finale']);
  sound.music.play('home');
  await settle();
  const c = env.instances[0];
  const [master, compressor, musicGain] = c.nodes;
  assert.deepEqual(master.connections, [compressor]);
  assert.deepEqual(musicGain.connections, [compressor], 'music joins the sum after the cue master');
  assert.equal(musicGain.gain.value, 0.5 ** 2, 'music volume defaults to half, on its own gain');
  assert.equal(sound.music.current, 'home');
  const home = c.sources.at(-1);
  assert.equal(home.loop, true);
  assert.equal(Math.round(home.buffer.duration * 10) / 10, 53.3, 'the loop is the decoded track');
  assert.equal(home.starts.length, 1);
  assert.equal(c.nodes.at(-1).connections[0], musicGain, 'the track gain feeds the music gain, not the cue master');
  assert.deepEqual(env.fetched.filter((u) => u.includes('music/')), ['audio/music/home.m4a', 'audio/music/finale.m4a'], 'the track is fetched, then the finale is warmed');
  sound.stop();
  assert.equal(home.stops.length, 0, 'stopping cues leaves the music alone');
  sound.music.play('tense');
  await settle();
  assert.equal(sound.music.current, 'tense');
  assert.equal(home.stops.length, 1, 'the old loop fades out');
  const tense = c.sources.at(-1);
  assert.notEqual(tense, home);
  assert.equal(tense.loop, true);
  sound.music.play('tense');
  await settle();
  assert.equal(c.sources.at(-1), tense, 'asking for the playing track again does nothing');
  sound.music.play('unknown-track');
  await settle();
  assert.equal(sound.music.wanted, null);
  assert.equal(tense.stops.length, 1, 'an unknown track id fades the music out instead of throwing');
  sound.music.play('tense');
  await settle();
  assert.equal(sound.music.current, 'tense');
  sound.music.stop();
  assert.equal(c.sources.at(-1).stops.length, 1);
  assert.equal(sound.music.current, null);
  assert.equal(sound.music.wanted, null);
  assert.equal(c.decoded, 2, 'each track decodes once per context');
  sound.dispose();
});

test('music honours the master switch, its own toggle and volume, ducks under question audio and big cues, and keeps its place while hidden', async (t) => {
  const env = audioEnvironment(t);
  const sound = await warm(createSound({ music: false, musicVolume: 0.8 })); sound.attach();
  const c = env.instances[0];
  const musicGain = c.nodes[2];
  const before = c.sources.length;
  sound.music.play('calm');
  await settle();
  assert.equal(c.sources.length, before, 'music off: the request is remembered, nothing plays');
  assert.equal(sound.music.wanted, 'calm');
  assert.equal(sound.music.enabled, false);
  sound.music.enable(true);
  await settle();
  assert.equal(sound.music.current, 'calm');
  const calm = c.sources.at(-1);
  assert.equal(musicGain.gain.value, 0.8 ** 2);
  sound.music.setVolume(0.5);
  assert.equal(sound.music.volume, 0.5);
  assert.equal(musicGain.gain.value, 0.25);
  sound.setDucking(true);
  assert.equal(musicGain.gain.value, 0.25 * 0.25, 'question audio ducks the music');
  sound.setDucking(false);
  assert.equal(musicGain.gain.value, 0.25);
  env.document.hidden = true; env.dispatch('visibilitychange');
  assert.equal(musicGain.gain.value, 0, 'hidden: silent (the context suspends)');
  assert.equal(calm.stops.length, 0, 'but the loop keeps its place for the return');
  env.document.hidden = false; env.dispatch('visibilitychange');
  assert.equal(musicGain.gain.value, 0.25);
  sound.play('fanfare');
  assert.equal(musicGain.gain.value, 0.25 * 0.3, 'a win pulls the music under it');
  sound.play('click');
  assert.equal(musicGain.gain.value, 0.25 * 0.3, 'a click does not change the duck');
  sound.setVolume(0);
  assert.equal(calm.stops.length, 0, 'the effects volume does not touch the music');
  sound.enable(false);
  assert.equal(calm.stops.length, 1, 'the master switch stops the music');
  assert.equal(sound.music.current, null);
  sound.enable(true);
  await settle();
  assert.equal(sound.music.current, 'calm', 'and brings it back');
  assert.notEqual(c.sources.at(-1), calm);
  sound.music.setVolume(0);
  assert.equal(c.sources.at(-1).stops.length, 1, 'music volume zero fades the loop out');
  sound.dispose();
});

test('the finale sting replaces the loop, holds new tracks while it sounds, and hands over to the after-track when it ends', async (t) => {
  const env = audioEnvironment(t);
  const sound = createSound();
  sound.music.play('tense');
  await settle();
  const c = env.instances[0];
  const tense = c.sources.at(-1);
  sound.music.sting('finale', { after: 'home' });
  await settle();
  assert.equal(tense.stops.length, 1, 'the loop steps aside');
  const finale = c.sources.at(-1);
  assert.notEqual(finale, tense);
  assert.equal(!!finale.loop, false);
  assert.equal(Math.round(finale.buffer.duration * 10) / 10, 6.5);
  assert.equal(sound.music.stingId, 'finale');
  assert.equal(sound.music.wanted, 'home');
  assert.equal(sound.music.current, null, 'no loop under the sting');
  sound.music.play('home');
  await settle();
  assert.equal(c.sources.at(-1), finale, 'the after-track waits for the sting to end');
  finale.onended();
  await settle();
  assert.equal(sound.music.stingId, null);
  assert.equal(sound.music.current, 'home');
  assert.equal(c.sources.at(-1).loop, true);
  sound.music.enable(false);
  const count = c.sources.length;
  sound.music.sting('finale', { after: 'calm' });
  await settle();
  assert.equal(c.sources.length, count, 'with music off the sting is skipped');
  assert.equal(sound.music.wanted, 'calm', 'but the after-track is remembered');
  sound.dispose();
});

test('a track asked for while the page is hidden starts when the page returns', async (t) => {
  const env = audioEnvironment(t);
  const sound = createSound(); sound.attach();
  env.document.hidden = true;
  sound.music.play('home');
  await settle();
  assert.equal(env.instances.length, 0, 'nothing is built for a hidden page');
  env.document.hidden = false; env.dispatch('visibilitychange');
  await settle();
  assert.equal(sound.music.current, 'home');
  sound.dispose();
  assert.equal(env.instances[0].sources.at(-1).stops.length, 1, 'dispose stops the loop');
});

test('the shipped music matches its manifest and the manifest matches the masters', () => {
  assert.deepEqual(Object.keys(MUSIC_BANK).sort(), ['calm', 'finale', 'home', 'tense']);
  let total = 0;
  for (const [id, entry] of Object.entries(MUSIC_BANK)) {
    const file = readFileSync(new URL(`../public/${entry.url}`, import.meta.url));
    assert.equal(createHash('sha256').update(file).digest('hex'), entry.sha256, `encoded track changed: ${id}`);
    assert.equal(file.length, entry.bytes);
    total += file.length;
    const data = wavData(readFileSync(new URL(`../assets/audio/maydan-v2/music/${id}.wav`, import.meta.url)));
    assert.equal(createHash('sha256').update(data).digest('hex'), entry.masterSha256, `music master changed: ${id}`);
    assert.equal(data.length / 6, entry.frames);
    assert.ok(Math.abs(entry.frames / 48000 - entry.seconds) < 0.001, `seconds follow the frame count: ${id}`);
    assert.equal(entry.loop, id !== 'finale');
  }
  assert.ok(total < 5 * 1024 * 1024, `the music stays under five megabytes (${total} bytes)`);
  assert.ok(!readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8').includes('audio/music/'), 'music is fetched on demand, never precached');
});

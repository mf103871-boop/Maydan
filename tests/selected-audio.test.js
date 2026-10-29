import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { SELECTED_AUDIO } from '../src/shared/fx/selected-audio.js';
import { SAMPLE_BANK } from '../src/shared/fx/sample-bank.js';
import { MUSIC_BANK } from '../src/shared/fx/music-bank.js';
import { createStreamingMusic } from '../src/shared/fx/streaming-music.js';
import { createSound } from '../src/shared/fx/sound.js';

const settle = async () => { for (let i = 0; i < 6; i += 1) await new Promise((resolve) => setImmediate(resolve)); };

function environment(t) {
  const media = [], contexts = [], fetched = [], listeners = new Map();
  const param = () => ({ value: 0, events: [], setValueAtTime(value) { this.value = value; }, setTargetAtTime(value) { this.value = value; }, cancelScheduledValues() {}, linearRampToValueAtTime(value, at) { this.value = value; this.events.push({ value, at }); } });
  const node = (extra = {}) => ({ connected: [], connect(to) { this.connected.push(to); }, disconnect() { this.disconnected = true; }, ...extra });
  class Media {
    constructor() { this.paused = true; this.currentTime = 0; this.duration = 480; this.plays = 0; media.push(this); }
    setAttribute() {}
    removeAttribute(name) { delete this[name]; }
    load() {}
    play() { this.paused = false; this.plays += 1; return Promise.resolve(); }
    pause() { this.paused = true; }
  }
  class Context {
    constructor() { this.state = 'running'; this.currentTime = 10; this.destination = {}; this.sources = []; this.mediaNodes = []; this.decoded = []; this.nodes = []; this.resumes = 0; contexts.push(this); }
    createGain() { const result = node({ gain: param() }); this.nodes.push(result); return result; }
    createDynamicsCompressor() { return node(Object.fromEntries(['threshold', 'knee', 'ratio', 'attack', 'release'].map((key) => [key, param()]))); }
    createBufferSource() { const result = node({ playbackRate: param(), starts: [], stops: [], start(at) { this.starts.push(at); }, stop(at) { this.stops.push(at); } }); this.sources.push(result); return result; }
    createMediaElementSource(element) { const result = node({ media: element }); this.mediaNodes.push(result); return result; }
    decodeAudioData(data) { const buffer = { duration: data.byteLength / 48000, length: data.byteLength }; this.decoded.push(buffer); return Promise.resolve(buffer); }
    resume() { this.resumes += 1; this.state = 'running'; return Promise.resolve(); }
    suspend() { this.state = 'suspended'; return Promise.resolve(); }
    close() { this.state = 'closed'; return Promise.resolve(); }
  }
  const old = { window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch };
  const document = { hidden: false, addEventListener(name, fn) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); }, removeEventListener(name, fn) { listeners.get(name)?.delete(fn); } };
  globalThis.window = { Audio: Media, AudioContext: Context, addEventListener: document.addEventListener, removeEventListener: document.removeEventListener };
  globalThis.document = document;
  let fetchHook = null;
  globalThis.fetch = async (url) => {
    fetched.push(url);
    const overridden = fetchHook?.(url);
    if (overridden) return overridden;
    const sample = Object.values(SAMPLE_BANK).find((entry) => entry.url === url);
    const track = Object.values(MUSIC_BANK).find((entry) => entry.url === url);
    const voice = SELECTED_AUDIO.voices.find((entry) => entry.url === url);
    return new Response(new Uint8Array(sample?.frames || track?.frames || Math.round((voice?.seconds || 0) * 48000)));
  };
  t.after(() => { Object.assign(globalThis, old); });
  return { media, contexts, fetched, Context, setFetchHook(fn) { fetchHook = fn; }, dispatch(name, detail) { for (const fn of listeners.get(name) || []) fn({ detail }); } };
}

test('selected artifacts are exact audition files, hashed and private, with native-resolution spoken clips', () => {
  assert.equal(SELECTED_AUDIO.music.seconds, 480);
  assert.equal(SELECTED_AUDIO.music.chapters.length, 14);
  assert.equal(SELECTED_AUDIO.voicesProductionApproved, false);
  assert.equal(SELECTED_AUDIO.voices.length, 12);
  const total = [SELECTED_AUDIO.music, ...SELECTED_AUDIO.voices].reduce((bytes, entry) => {
    const data = readFileSync(new URL(`../public/${entry.url}`, import.meta.url));
    assert.equal(data.length, entry.bytes); assert.equal(createHash('sha256').update(data).digest('hex'), entry.sha256);
    if (entry.synthetic) {
      assert.equal(data.toString('ascii', 0, 4), 'RIFF');
      assert.equal(data.readUInt16LE(22), 1); assert.equal(data.readUInt32LE(24), 24000); assert.equal(data.readUInt16LE(34), 16);
      for (let at = 44; at + 1 < data.length; at += 2) assert.ok(Math.abs(data.readInt16LE(at)) < 32767, `unclipped ${entry.id}`);
    }
    return bytes + data.length;
  }, 0);
  assert.ok(total < 17 * 1024 * 1024);
  for (const event of ['correct', 'wrong']) assert.equal(SELECTED_AUDIO.voices.filter((entry) => entry.event === event).length, 6);
});

test('long music streams through the shared mix without PCM decoding, and scene changes preserve position', async (t) => {
  const env = environment(t), sound = createSound(); sound.attach();
  sound.music.play('home'); await settle();
  assert.equal(sound.music.transport, 'stream');
  assert.equal(env.media.length, 1); assert.equal(env.media[0].src, SELECTED_AUDIO.music.url);
  assert.equal(env.fetched.includes(SELECTED_AUDIO.music.url), false, 'no full-recording JavaScript fetch');
  const c = env.contexts[0], musicGain = c.nodes[1];
  assert.equal(c.mediaNodes[0].connected[0].connected[0], musicGain);
  assert.ok(c.decoded.every((buffer) => buffer.duration < 10), 'only short cue buffers decoded');
  env.media[0].currentTime = 83.25;
  sound.music.play('calm'); sound.music.play('tense');
  assert.equal(sound.music.current, 'tense'); assert.equal(sound.music.position, 83.25);
  assert.equal(env.media.length, 1, 'navigation does not restart or duplicate the music');
  sound.music.setVolume(0.4); sound.setDucking(true, 'lamma');
  assert.equal(musicGain.gain.value, 0.4 ** 2 * 0.25);
  sound.setDucking(false, 'lamma'); assert.equal(musicGain.gain.value, 0.4 ** 2);
  sound.stop(); assert.equal(env.media[0].paused, false, 'stopping effects leaves music playing');
  sound.dispose(); assert.equal(env.media[0].paused, true);
});

test('stream lifecycle pauses, restores its place, and replaces media after an audio graph reset', async (t) => {
  const env = environment(t), sound = createSound(); sound.attach(); sound.music.play('home'); await settle();
  const first = env.media[0]; first.currentTime = 121;
  env.dispatch('maydan-audio-lifecycle', { state: 'background' });
  assert.equal(first.paused, true);
  env.dispatch('maydan-audio-lifecycle', { state: 'foreground' }); await settle();
  assert.equal(first.paused, false); assert.equal(sound.music.position, 121);
  env.dispatch('maydan-audio-lifecycle', { state: 'media-reset' }); await settle();
  assert.equal(env.contexts.length, 2); assert.equal(first.paused, true);
  assert.equal(env.media.length, 2); assert.equal(env.media[1].currentTime, 121); assert.equal(sound.music.current, 'home');
  sound.music.enable(false); assert.equal(env.media[1].paused, true);
  const count = env.media.length; const staleEnd = env.media[1].onended; staleEnd();
  assert.equal(env.media.length, count, 'a queued ended event cannot restart disabled music');
  sound.music.enable(true); assert.equal(env.media.length, count); assert.equal(env.media[1].paused, false);
  sound.dispose();
});

test('loop overlap is limited to two streaming decoders and backgrounding drops the outgoing copy', (t) => {
  const env = environment(t), context = new env.Context(), output = context.createGain();
  const stream = createStreamingMusic(SELECTED_AUDIO.music);
  stream.play(context, output, 'home'); env.media[0].currentTime = 478.5; env.media[0].ontimeupdate();
  assert.equal(stream.decoderCount, 2); assert.equal(env.media.length, 2); assert.equal(env.media[1].currentTime, 0);
  env.media[0].ontimeupdate(); assert.equal(stream.decoderCount, 2);
  stream.pause(); assert.equal(stream.decoderCount, 1); assert.ok(env.media.every((audio) => audio.paused));
  stream.play(context, output, 'home'); assert.equal(env.media[1].paused, false); assert.equal(env.media.length, 2);
  stream.dispose(); assert.equal(stream.decoderCount, 0);
});

test('scene recordings crossfade on playback, retain per-track positions and pause both decoders immediately', t => {
  const env = environment(t), context = new env.Context(), output = context.createGain();
  const stream = createStreamingMusic(SELECTED_AUDIO.music);
  stream.play(context, output, 'home'); const first = env.media[0]; first.currentTime = 83.25;
  const calm = { ...MUSIC_BANK.calm, crossfadeSeconds: 1.5 };
  stream.setTrack(calm); stream.play(context, output, 'calm'); const second = env.media[1];
  assert.equal(first.paused, false, 'keep the old recording audible during loading');
  assert.equal(second.currentTime, 0); assert.equal(stream.decoderCount, 2);
  const incomingGain = context.mediaNodes[1].connected[0];
  assert.equal(incomingGain.gain.value, 0); second.onplaying();
  assert.deepEqual(incomingGain.gain.events.at(-1), { value: 1, at: context.currentTime + 1.5 });
  second.currentTime = 12.5; const oldPlaying = second.onplaying;
  stream.pause(); assert.equal(stream.decoderCount, 1);
  assert.ok(env.media.every(media => media.paused));
  assert.equal(oldPlaying, null);
  stream.play(context, output, 'calm');
  stream.setTrack(SELECTED_AUDIO.music); stream.play(context, output, 'home');
  assert.equal(env.media.at(-1).currentTime, 83.25, 'return to the stored position of this recording');
  assert.equal(stream.decoderCount, 2); stream.dispose();
});

test('rapid scene changes retire the unstarted recording and ignore stale playback callbacks', t => {
  const env = environment(t), context = new env.Context(), output = context.createGain();
  const stream = createStreamingMusic(SELECTED_AUDIO.music);
  stream.play(context, output, 'home'); const first = env.media[0]; first.currentTime = 44;
  stream.setTrack(MUSIC_BANK.calm); stream.play(context, output, 'calm');
  const intermediate = env.media[1], stalePlaying = intermediate.onplaying;
  stream.setTrack(MUSIC_BANK.tense); stream.play(context, output, 'tense');
  assert.equal(first.paused, false); assert.equal(intermediate.paused, true);
  assert.equal(stream.decoderCount, 2); stalePlaying();
  assert.equal(first.paused, false); assert.equal(stream.current, 'tense');
  const currentPlaying = env.media.at(-1).onplaying;
  stream.pause(); currentPlaying();
  assert.ok(env.media.every(media => media.paused));
  assert.equal(stream.decoderCount, 1, 'late onplaying cannot resurrect the outgoing recording');
  stream.dispose();
});

test('a graph replacement during a scene change starts the new recording at its own stored position', t => {
  const env = environment(t), firstContext = new env.Context();
  const stream = createStreamingMusic(SELECTED_AUDIO.music);
  stream.play(firstContext, firstContext.createGain(), 'home'); env.media[0].currentTime = 100;
  stream.setTrack(MUSIC_BANK.calm);
  const nextContext = new env.Context(); stream.play(nextContext, nextContext.createGain(), 'calm');
  assert.equal(env.media.at(-1).currentTime, 0, 'do not apply the retired recording position to another track');
  assert.equal(stream.decoderCount, 1); stream.dispose();
});

test('a stale media play rejection cannot fail a replacement graph or a newer loop slot', async (t) => {
  const env = environment(t), firstContext = new env.Context(), output = firstContext.createGain();
  let failures = 0, rejectOld;
  const stream = createStreamingMusic(SELECTED_AUDIO.music, { onFailure: () => failures += 1 });
  stream.play(firstContext, output, 'home'); stream.pause();
  env.media[0].play = () => new Promise((_, reject) => { rejectOld = reject; });
  stream.play(firstContext, output, 'home');
  const nextContext = new env.Context(); stream.play(nextContext, nextContext.createGain(), 'calm');
  rejectOld(new Error('old decoder failed')); await settle();
  assert.equal(failures, 0); assert.equal(stream.current, 'calm'); assert.equal(stream.decoderCount, 1);
  stream.dispose();
});

test('a suspended music-only graph is resumed and media failure falls back to a bounded short loop', async (t) => {
  const env = environment(t), sound = createSound(); sound.attach(); await settle();
  const c = env.contexts[0]; c.state = 'suspended'; sound.music.play('home'); await settle();
  assert.ok(c.resumes > 0); assert.equal(sound.music.transport, 'stream');
  env.media[0].onerror(); await settle();
  assert.equal(sound.music.transport, 'buffer'); assert.equal(sound.music.current, 'home');
  assert.ok(c.decoded.every((buffer) => buffer.duration < 61));
  sound.dispose();
});

test('a direct finale request retires the long recording before the short musical cue', async (t) => {
  const env = environment(t), sound = createSound(); sound.attach(); sound.music.play('home'); await settle();
  sound.music.play('finale'); await settle();
  assert.equal(env.media[0].paused, true); assert.equal(sound.music.transport, 'buffer'); assert.equal(sound.music.current, 'finale');
  sound.dispose();
});

test('spoken responses are varied, never overlap or queue, stop for calls, and obey their separate switch', async (t) => {
  const env = environment(t); let now = 10000; t.mock.method(Date, 'now', () => now); t.mock.method(Math, 'random', () => 0);
  const sound = createSound({ voice: true, allowPreviewVoices: true }); sound.attach(); sound.music.play('home'); await settle();
  const c = env.contexts[0]; const speech = () => c.sources.filter((source) => source.buffer?.duration > 0.5 && !Object.values(SAMPLE_BANK).some((entry) => entry.frames === source.buffer.length));
  assert.equal(env.fetched.filter((url) => SELECTED_AUDIO.voices.some((entry) => entry.url === url)).length, 12);
  sound.play('correct'); const first = speech().at(-1); assert.ok(first);
  now += 2000; sound.play('wrong'); assert.equal(speech().length, 1, 'no overlapping or delayed second phrase');
  first.onended(); now += 2000; sound.play('correct');
  assert.equal(speech().length, 2); assert.notEqual(speech()[0].buffer, speech()[1].buffer, 'immediate repeat excluded even with fixed RNG');
  sound.setDucking(true, 'lamma'); assert.ok(speech().at(-1).stops.length);
  speech().at(-1).onended(); // complete the scheduled 30 ms fade before the next response
  now += 3000; sound.play('wrong'); assert.equal(speech().length, 2, 'call/recording takes priority');
  sound.setDucking(false, 'lamma'); sound.voice.enable(false); now += 3000; sound.play('wrong');
  assert.equal(speech().length, 2); assert.equal(sound.voice.enabled, false);
  sound.voice.enable(true); now += 3000; sound.play('wrong'); assert.equal(speech().length, 3);
  sound.enable(false); assert.ok(speech().at(-1).stops.length); sound.dispose();
});

test('a stalled spoken request expires; its late completion cannot clear or play over a newer response', async (t) => {
  const env = environment(t); t.mock.timers.enable({ apis: ['setTimeout'] });
  let now = 10000; t.mock.method(Date, 'now', () => now); t.mock.method(Math, 'random', () => 0);
  let mode = 'fail'; const release = {};
  env.setFetchHook((url) => {
    const entry = SELECTED_AUDIO.voices.find((item) => item.url === url);
    if (!entry) return null;
    if (mode === 'fail') return new Response('missing', { status: 404 });
    return new Promise((resolve) => { release[entry.event] = () => resolve(new Response(new Uint8Array(Math.round(entry.seconds * 48000)))); });
  });
  const sound = createSound({ voice: true, allowPreviewVoices: true }); sound.attach(); await settle(); mode = 'hold';
  const c = env.contexts[0];
  sound.play('correct'); await settle(); assert.ok(release.correct);
  now += 501; t.mock.timers.tick(501);
  sound.play('wrong'); await settle(); assert.ok(release.wrong);
  const before = c.sources.length;
  release.correct(); await settle(); assert.equal(c.sources.length, before, 'expired phrase is not replayed');
  release.wrong(); await settle(); assert.equal(c.sources.length, before + 1, 'old finally does not clear the new request');
  sound.dispose();
});

test('context replacement invalidates a hung spoken request and nonverbal feedback remains immediate', async (t) => {
  const env = environment(t); t.mock.timers.enable({ apis: ['setTimeout'] });
  let now = 10000; t.mock.method(Date, 'now', () => now);
  let mode = 'fail'; let aborted = false;
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = (url, options) => {
    if (SELECTED_AUDIO.voices.some((entry) => entry.url === url) && mode === 'hold') {
      options?.signal?.addEventListener('abort', () => { aborted = true; }); return new Promise(() => {});
    }
    return nativeFetch(url, options);
  };
  env.setFetchHook((url) => SELECTED_AUDIO.voices.some((entry) => entry.url === url) && mode === 'fail' ? new Response('missing', { status: 404 }) : null);
  const sound = createSound({ voice: true, allowPreviewVoices: true }); sound.attach(); await settle(); mode = 'hold';
  const old = env.contexts[0]; sound.play('correct'); await settle();
  assert.equal(old.sources.length, 1, 'short correct effect never waits for speech');
  env.dispatch('maydan-audio-lifecycle', { state: 'media-reset' }); await settle();
  mode = 'ready'; now += 3600; t.mock.timers.tick(3600); await settle(); assert.equal(aborted, true);
  const fresh = env.contexts.at(-1); sound.play('wrong'); await settle();
  assert.ok(fresh.sources.length >= 2, 'new graph can play its effect and spoken response');
  sound.dispose();
});

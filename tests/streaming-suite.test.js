import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { build } from 'esbuild';
import { createStreamingSuite } from '../src/shared/fx/streaming-suite.js';

const settle = async () => { for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve)); };
function suite({ intro = true, repeat = true } = {}) {
  const tracks = ['intro', 'a', 'b', 'c'].map(id => ({ id: `music-${id}`, title: id, url: `/audio/${id}.m4a`, seconds: id === 'intro' ? 79 : 100, loop: false }));
  return { id: 'warmth-long', title: 'warmth', url: '/audio/suite/warmth-long', seconds: 379, suiteTracks: tracks, introTrackId: intro ? 'music-intro' : null, transitionSeconds: 1.2, repeat, loop: false };
}
function environment(t) {
  const previous = globalThis.window, media = [], contexts = [];
  const param = () => ({ value: 0, events: [], cancelScheduledValues(at) { this.events.push({ cancel: at }); }, setValueAtTime(v, at) { this.value = v; this.events.push({ value: v, at }); }, linearRampToValueAtTime(v, at) { this.value = v; this.events.push({ ramp: v, at }); } });
  const node = extra => ({ connected: [], connect(to) { this.connected.push(to); }, disconnect() { this.disconnected = true; }, ...extra });
  class Audio {
    constructor() { this.paused = true; this.currentTime = 0; this.duration = NaN; this.plays = 0; media.push(this); }
    setAttribute() {} removeAttribute(name) { delete this[name]; } load() {}
    pause() { this.paused = true; }
    play() { this.paused = false; this.plays++; return Promise.resolve(); }
  }
  class Context {
    constructor() { this.currentTime = 10; this.mediaNodes = []; this.gains = []; contexts.push(this); }
    createMediaElementSource(audio) { const n = node({ audio }); this.mediaNodes.push(n); return n; }
    createGain() { const n = node({ gain: param() }); this.gains.push(n); return n; }
  }
  globalThis.window = { Audio };
  t.after(() => { globalThis.window = previous; });
  return { Audio, Context, media, contexts, sounding: () => media.filter(audio => !audio.paused && audio.src), current: () => media.find(audio => !audio.paused && audio.src) };
}

test('suite advances through distinct chapters; intro plays once and bag boundaries never immediately repeat', async t => {
  const env = environment(t), context = new env.Context(), output = context.createGain();
  const music = createStreamingSuite(suite(), { random: () => 0 });
  music.play(context, output, 'warmth-long'); await settle();
  const ids = [];
  for (let i = 0; i < 14; i++) {
    ids.push(music.getStatus().trackId);
    const audio = env.current(); assert.ok(audio);
    audio.onended(); await settle();
    assert.ok(music.decoderCount <= 2); assert.ok(env.sounding().length <= 1);
  }
  assert.equal(ids.filter(id => id === 'music-intro').length, 1);
  for (let i = 1; i < ids.length; i++) assert.notEqual(ids[i], ids[i - 1]);
  for (let i = 1; i + 2 < ids.length; i += 3) assert.equal(new Set(ids.slice(i, i + 3)).size, 3);
  assert.equal(music.getStatus().cycle, 5); music.dispose();
});

test('near a boundary only one silent next decoder is prepared, and the outgoing chapter fades before the next plays', async t => {
  const env = environment(t), context = new env.Context(), output = context.createGain(), music = createStreamingSuite(suite(), { random: () => .5 });
  music.play(context, output, 'home'); await settle();
  const first = env.current(); first.currentTime = 65; first.ontimeupdate();
  assert.equal(music.decoderCount, 2); assert.equal(env.media.length, 2); assert.equal(env.media[1].plays, 0); assert.equal(env.sounding().length, 1);
  first.currentTime = 78; first.ontimeupdate(); first.ontimeupdate();
  assert.equal(music.decoderCount, 2); assert.equal(env.media[1].plays, 0);
  assert.deepEqual(context.mediaNodes[0].connected[0].gain.events.at(-1), { ramp: 0, at: 11 });
  first.onended(); await settle();
  assert.equal(first.paused, true); assert.equal(env.media[1].plays, 1); assert.equal(env.sounding().length, 1); assert.equal(music.decoderCount, 1);
  music.dispose();
});

test('pause and silent phase resume the same chapter/position without consuming the prepared chapter', async t => {
  const env = environment(t), context = new env.Context(), output = context.createGain(), music = createStreamingSuite(suite());
  music.play(context, output, 'home'); await settle(); const first = env.current(); first.currentTime = 70; first.ontimeupdate();
  const staleEnd = first.onended, staleUpdate = first.ontimeupdate; assert.equal(music.decoderCount, 2);
  music.pause({ clear: true }); staleEnd(); staleUpdate();
  assert.equal(music.decoderCount, 1); assert.equal(env.sounding().length, 0); assert.equal(music.skipNext(), false);
  const before = music.getStatus(); assert.equal(before.position, 70); assert.equal(before.trackId, 'music-intro');
  music.play(context, output, 'waiting'); await settle();
  assert.equal(env.current(), first); assert.equal(first.currentTime, 70); assert.equal(music.getStatus().cycle, 1); assert.equal(music.current, 'waiting'); music.dispose();
});

test('audio graph replacement preserves the chapter and position but retires the old callback generation', async t => {
  const env = environment(t), firstContext = new env.Context(), music = createStreamingSuite(suite());
  music.play(firstContext, firstContext.createGain(), 'home'); await settle();
  const old = env.current(), ended = old.onended, updated = old.ontimeupdate; old.currentTime = 33.2;
  const nextContext = new env.Context(); music.play(nextContext, nextContext.createGain(), 'lobby'); await settle();
  assert.equal(env.current().currentTime, 33.2); assert.equal(music.getStatus().trackId, 'music-intro');
  ended(); updated(); assert.equal(music.decoderCount, 1); assert.equal(music.getStatus().trackId, 'music-intro'); assert.equal(old.paused, true); music.dispose();
});

test('queued play resolution after privacy pause cannot restart audio; autoplay refusal is retryable', async t => {
  const env = environment(t), context = new env.Context(), output = context.createGain(); let resolveOld;
  env.Audio.prototype.play = function () { this.plays++; return new Promise(resolve => { resolveOld = () => { this.paused = false; resolve(); }; }); };
  const music = createStreamingSuite(suite()); music.play(context, output, 'home'); const first = env.media[0], playing = first.onplaying;
  music.pause(); resolveOld(); await settle(); playing(); assert.equal(first.paused, true); assert.equal(music.current, null);
  first.play = () => Promise.reject(Object.assign(Error('gesture'), { name: 'NotAllowedError' }));
  music.play(context, output, 'home'); await settle(); assert.equal(music.getStatus().state, 'gesture-required');
  first.play = function () { this.paused = false; return Promise.resolve(); };
  music.play(context, output, 'home'); await settle(); assert.equal(music.getStatus().state, 'playing'); assert.equal(env.media.length, 1); music.dispose();
});

test('failed speculative preload leaves the healthy chapter playing and skips the failed chapter without retry loops', async t => {
  const env = environment(t), context = new env.Context(), output = context.createGain(); let failures = 0;
  const music = createStreamingSuite(suite(), { onFailure: () => failures++, random: () => 0 }); music.play(context, output, 'home'); await settle();
  const first = env.current(); first.currentTime = 65; first.ontimeupdate(); const failed = env.media[1], failedUrl = failed.src, staleFailure = failed.onerror;
  staleFailure(); assert.equal(failures, 0); assert.equal(music.getStatus().state, 'playing'); assert.equal(env.current(), first); assert.equal(music.decoderCount, 1);
  staleFailure(); first.ontimeupdate(); assert.equal(env.media.length, 3); assert.notEqual(env.media[2].src, failedUrl);
  for (let i = 0; i < 10; i++) { env.current().onended(); await settle(); assert.notEqual(env.current().src, failedUrl); assert.ok(music.decoderCount <= 2); assert.ok(env.sounding().length <= 1); }
  assert.equal(music.getStatus().degraded, true); assert.equal(failures, 0); music.dispose();
});

test('active failures visit other candidate chapters once; exhausted audio requires explicit manual retry', async t => {
  const env = environment(t), context = new env.Context(), output = context.createGain(); let failures = 0;
  const music = createStreamingSuite(suite(), { onFailure: () => failures++ }); music.play(context, output, 'home'); await settle();
  for (let i = 0; i < 4; i++) { env.current().onerror(); await settle(); }
  assert.equal(failures, 1); assert.equal(music.getStatus().state, 'failed'); assert.equal(music.decoderCount, 0); assert.equal(env.sounding().length, 0);
  assert.equal(music.play(context, output, 'home'), false); assert.equal(env.media.length, 4);
  assert.equal(music.retry(), true); assert.equal(music.retry(), false); assert.equal(env.media.length, 4);
  music.play(context, output, 'home'); await settle(); assert.equal(music.getStatus().state, 'playing'); assert.equal(env.media.length, 5); assert.equal(music.getStatus().degraded, false); music.dispose();
});

test('silent play demand obtains deferred metadata, seeks the same chapter, then opens its gain', async t => {
  const env = environment(t), context = new env.Context(), output = context.createGain(), music = createStreamingSuite(suite());
  music.play(context, output, 'home'); await settle(); env.current().currentTime = 37; music.reset();
  window.Audio = class extends env.Audio {
    constructor() { super(); this.readyState = 0; }
    play() {
      const pending = super.play();
      if (!this.readyState) queueMicrotask(() => { this.readyState = 4; this.onloadedmetadata?.(); });
      return pending;
    }
  };
  music.play(context, output, 'home'); const restored = env.media.at(-1), level = context.gains.at(-1).gain;
  assert.equal(restored.plays, 1, 'a silent demand starts resource selection');
  assert.equal(level.value, 0); assert.equal(music.current, null); assert.equal(music.skipNext(), false);
  assert.equal(music.position, 37); assert.equal(music.getStatus().state, 'paused');
  await settle(); assert.equal(restored.currentTime, 37); assert.equal(level.value, 1);
  assert.equal(music.getStatus().trackId, 'music-intro'); assert.equal(env.sounding().length, 1); music.dispose();
});

test('a refused seek stays silent at the saved checkpoint, without declaring the recording unavailable', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] }); let failures = 0;
  const env = environment(t), context = new env.Context(), output = context.createGain();
  const music = createStreamingSuite(suite(), { onFailure: () => failures++ });
  music.play(context, output, 'home'); await settle(); env.current().currentTime = 37; music.reset();
  window.Audio = class extends env.Audio { constructor() { super(); this.readyState = 1; Object.defineProperty(this, 'currentTime', { get: () => 0, set: () => { throw Error('seek refused'); } }); } };
  music.play(context, output, 'home'); const rejected = env.media.at(-1), level = context.gains.at(-1).gain;
  rejected.readyState = 4; rejected.oncanplay(); t.mock.timers.tick(5000); await settle();
  assert.equal(level.value, 0); assert.equal(rejected.paused, true); assert.equal(music.position, 37);
  assert.equal(music.getStatus().trackId, 'music-intro'); assert.equal(music.getStatus().state, 'failed');
  assert.deepEqual(music.getStatus().resumeFailedTrackIds, ['music-intro']); assert.deepEqual(music.getStatus().unavailableTrackIds, []);
  assert.equal(failures, 0, 'the shared bus must not blacklist the suite'); assert.equal(music.decoderCount, 0);
  window.Audio = env.Audio; assert.equal(music.retry(), true); music.play(context, output, 'home'); await settle();
  assert.equal(env.current().currentTime, 37); assert.equal(music.getStatus().trackId, 'music-intro'); music.dispose();
});

test('a deferred seek is verified by media progress even when the setter initially reports zero and seeking is false', async t => {
  const env = environment(t), context = new env.Context(), output = context.createGain(), music = createStreamingSuite(suite());
  music.play(context, output, 'home'); await settle(); env.current().currentTime = 37; music.reset();
  window.Audio = class extends env.Audio { constructor() { super(); this.readyState = 4; this.seeking = false; this.actual = 0; Object.defineProperty(this, 'currentTime', {get: () => this.actual, set: at => { this.requested = at; }}); } };
  music.play(context, output, 'home'); await settle(); const restored = env.media.at(-1), level = context.gains.at(-1).gain;
  assert.equal(restored.requested, 37); assert.equal(restored.currentTime, 0); assert.equal(level.value, 0); assert.equal(music.position, 37);
  restored.onended(); assert.equal(music.getStatus().trackId, 'music-intro', 'an event from a priming decoder cannot consume its chapter');
  restored.actual = 37; restored.ontimeupdate(); await settle();
  assert.equal(level.value, 1); assert.equal(music.getStatus().state, 'playing'); assert.equal(music.decoderCount, 1); music.dispose();
});

test('resume timeout is bounded and cancelled during privacy pause; disposal rejects late metadata', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const env = environment(t), context = new env.Context(), output = context.createGain(), music = createStreamingSuite(suite());
  music.play(context, output, 'home'); await settle(); env.current().currentTime = 37; music.reset();
  window.Audio = class extends env.Audio { constructor() { super(); this.readyState = 0; } };
  music.play(context, output, 'home'); const pending = env.media.at(-1), oldMetadata = pending.onloadedmetadata;
  t.mock.timers.tick(4999); assert.equal(context.gains.at(-1).gain.value, 0); music.pause(); t.mock.timers.tick(5001);
  assert.equal(pending.paused, true); assert.equal(music.position, 37); assert.equal(music.getStatus().state, 'paused');
  music.play(context, output, 'home'); t.mock.timers.tick(5000); await settle();
  assert.equal(pending.paused, true); assert.equal(music.getStatus().state, 'failed'); assert.equal(music.getStatus().trackId, 'music-intro');
  assert.equal(music.position, 37); assert.equal(env.sounding().length, 0); assert.equal(music.decoderCount, 0);
  music.dispose(); oldMetadata(); await settle(); assert.equal(env.sounding().length, 0); assert.equal(music.decoderCount, 0);
});

test('late priming promises or seek callbacks cannot open gain after privacy pause, graph reset or account disposal', async t => {
  for (const action of ['pause', 'reset', 'dispose']) {
    const env = environment(t), context = new env.Context(), output = context.createGain(), music = createStreamingSuite(suite());
    music.play(context, output, 'home'); await settle(); env.current().currentTime = 37; music.reset();
    let complete;
    window.Audio = class extends env.Audio {
      constructor() { super(); this.readyState = 0; }
      play() { return new Promise(resolve => { complete = () => { this.paused = false; resolve(); }; }); }
    };
    music.play(context, output, 'home'); const stale = env.media.at(-1), oldSeek = stale.onseeked, gain = context.gains.at(-1).gain;
    music[action](); stale.readyState = 4; oldSeek(); complete(); await settle();
    assert.equal(stale.paused, true); assert.equal(gain.value, 0); assert.equal(music.current, null);
    if (action !== 'dispose') assert.equal(music.position, 37);
    music.dispose(); window.Audio = env.Audio;
  }
});

test('gesture refusal cancels the priming timeout and the next authorised gesture resumes the same element', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const name of ['NotAllowedError', 'AbortError']) {
    const env = environment(t), context = new env.Context(), output = context.createGain(), music = createStreamingSuite(suite());
    music.play(context, output, 'home'); await settle(); env.current().currentTime = 37; music.reset();
    window.Audio = class extends env.Audio {
      constructor() { super(); this.readyState = 0; this.attempts = 0; }
      play() { if (++this.attempts === 1) return Promise.reject(Object.assign(new Error('blocked'), { name })); return super.play(); }
    };
    music.play(context, output, 'home'); await settle(); const pending = env.media.at(-1), gain = context.gains.at(-1).gain;
    assert.equal(music.getStatus().state, 'gesture-required'); pending.readyState = 4; pending.oncanplay();
    t.mock.timers.tick(20000); assert.equal(pending.attempts, 1); assert.equal(gain.value, 0); assert.equal(music.position, 37);
    assert.equal(music.getStatus().state, 'gesture-required'); assert.deepEqual(music.getStatus().resumeFailedTrackIds, []);
    music.play(context, output, 'home'); await settle(); assert.equal(env.current(), pending); assert.equal(pending.currentTime, 37);
    assert.equal(music.getStatus().trackId, 'music-intro'); assert.equal(gain.value, 1); music.dispose(); window.Audio = env.Audio;
  }
});

test('metadata alone does not open gain and current data arriving during privacy pause must wait for resume', async t => {
  const env = environment(t), context = new env.Context(), output = context.createGain(), music = createStreamingSuite(suite());
  music.play(context, output, 'home'); await settle(); env.current().currentTime = 37; music.reset();
  window.Audio = class extends env.Audio { constructor() { super(); this.readyState = 1; } };
  music.play(context, output, 'home'); await settle(); const pending = env.media.at(-1), gain = context.gains.at(-1).gain;
  assert.equal(pending.currentTime, 37); assert.equal(gain.value, 0); assert.equal(music.current, null);
  music.pause(); pending.readyState = 4; pending.oncanplay(); await settle(); assert.equal(pending.paused, true); assert.equal(gain.value, 0);
  music.play(context, output, 'home'); await settle(); assert.equal(env.current(), pending); assert.equal(gain.value, 1); music.dispose();
});

test('a real decoder error during resume retains the recording-failure fallback', async t => {
  const env = environment(t), context = new env.Context(), output = context.createGain(), music = createStreamingSuite(suite());
  music.play(context, output, 'home'); await settle(); env.current().currentTime = 37; music.reset();
  window.Audio = class extends env.Audio { constructor() { super(); this.readyState = 0; } };
  music.play(context, output, 'home'); const corrupt = env.media.at(-1); corrupt.onerror(); await settle();
  assert.deepEqual(music.getStatus().unavailableTrackIds, ['music-intro']); assert.deepEqual(music.getStatus().resumeFailedTrackIds, []);
  assert.notEqual(music.getStatus().trackId, 'music-intro'); assert.equal(corrupt.paused, true); assert.equal(music.decoderCount, 1); music.dispose();
});

test('late completion of a prior play attempt cannot pause the newer authorised resume on the same element', async t => {
  const env = environment(t), context = new env.Context(), output = context.createGain(); let resolveOld;
  env.Audio.prototype.play = function () { return new Promise(resolve => { resolveOld = () => { this.paused = false; resolve(); }; }); };
  const music = createStreamingSuite(suite()); music.play(context, output, 'home'); const first = env.media[0];
  music.pause(); first.play = function () { this.paused = false; return Promise.resolve(); };
  music.play(context, output, 'home'); await settle(); resolveOld(); await settle();
  assert.equal(first.paused, false); assert.equal(music.getStatus().state, 'playing'); assert.equal(music.decoderCount, 1); music.dispose();
});

test('nonrepeating suite ends once; ordinary sync never starts it again', async t => {
  const env = environment(t), context = new env.Context(), output = context.createGain(), music = createStreamingSuite(suite({ repeat: false }));
  music.play(context, output, 'home'); await settle();
  for (let i = 0; i < 4; i++) { env.current().onended(); await settle(); }
  const count = env.media.length;
  assert.equal(music.getStatus().state, 'ended'); assert.equal(music.getStatus().elapsedSeconds, 379); music.play(context, output, 'home'); assert.equal(env.media.length, count); assert.equal(music.decoderCount, 0); music.dispose();
});

test('identity disposal erases chapter history, while an ordinary scene change retains it', async t => {
  const env = environment(t), context = new env.Context(), output = context.createGain(), music = createStreamingSuite(suite());
  music.play(context, output, 'home'); await settle(); env.current().onended(); await settle(); env.current().currentTime = 42;
  const chapter = music.getStatus().trackId; music.play(context, output, 'creative'); assert.equal(music.getStatus().trackId, chapter); assert.equal(music.position, 42);
  music.dispose(); music.play(context, output, 'home'); await settle(); assert.equal(music.getStatus().trackId, 'music-intro'); assert.equal(music.position, 0); assert.equal(music.getStatus().cycle, 1); music.dispose();
});

test('preview next fades before switching, cannot double skip, and a pause cancels the pending switch', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const env = environment(t), context = new env.Context(), output = context.createGain(), music = createStreamingSuite(suite());
  music.play(context, output, 'home'); await settle(); const first = env.current();
  assert.equal(music.skipNext(), true); assert.equal(music.skipNext(), false); assert.equal(music.getStatus().transitioning, true);
  t.mock.timers.tick(1199); assert.equal(env.current(), first);
  music.pause(); t.mock.timers.tick(10); assert.equal(music.getStatus().trackId, 'music-intro'); assert.equal(music.current, null);
  music.play(context, output, 'home'); await settle(); assert.equal(music.skipNext(), true); t.mock.timers.tick(1201); await settle();
  assert.notEqual(music.getStatus().trackId, 'music-intro'); assert.equal(env.sounding().length, 1); assert.equal(first.paused, true); music.dispose();
});

test('status subscriptions are readonly snapshots and unsubscribe without affecting playback', async t => {
  const env = environment(t), context = new env.Context(), output = context.createGain(), music = createStreamingSuite(suite());
  const events = [], off = music.subscribeStatus(value => events.push(value)); music.play(context, output, 'home'); await settle();
  assert.ok(events.every(Object.isFrozen)); assert.equal(events.at(-1).chapterCount, 4); assert.equal(events.at(-1).uniqueSeconds, 379);
  off(); const count = events.length; env.current().currentTime = 20; env.current().ontimeupdate(); assert.equal(events.length, count); assert.equal(music.position, 20); music.dispose();
});

async function localRegistry() {
  const result = await build({ stdin: { contents: "export * from './src/shared/fx/local-audition.js';", resolveDir: process.cwd() }, bundle: true, write: false, format: 'cjs', platform: 'node', define: { __MAYDAN_LOCAL_AUDIO_REVIEW__: 'true' } });
  const sandbox = { module: { exports: {} }, exports: {}, URL, window: { location: { href: 'http://127.0.0.1:4186/' } } };
  vm.runInNewContext(result.outputFiles[0].text, sandbox); return sandbox.module.exports;
}
function registryPack() {
  const assets = Object.fromEntries(['intro', 'a', 'b', 'c'].map((key, i) => {
    const id = `music-${key}`, hash = String(i + 1).repeat(64); return [id, { id, titleAr: key, kind: 'music', localPreviewOnly: true, approval: false, loop: false,
      file: { url: `audio/${id}-${hash.slice(0, 12)}.m4a`, sha256: hash, bytes: 10, frames: 48000 * 100, sampleRate: 48000, channels: 2, durationSeconds: 100 } }];
  }));
  return { schemaVersion: 1, localPreviewOnly: true, approval: false, assets, cueMap: {}, musicSuites: { 'warmth-long': { title: 'warmth', trackIds: Object.keys(assets), introTrackId: 'music-intro', transitionSeconds: 1.2, repeat: true } }, musicDirections: { bossaAlternative: { home: 'warmth-long', lobby: 'warmth-long', creativeSetup: 'warmth-long', mafiaLobby: null, mafiaNight: null } } };
}

test('local suite validation rejects missing, duplicate, unapproved, foreign and oversized declarations atomically', async () => {
  const api = await localRegistry();
  for (const change of [p => p.musicSuites['warmth-long'].trackIds.push('missing'), p => p.musicSuites['warmth-long'].trackIds.push('music-a'), p => { p.assets['music-a'].approval = true; }, p => { p.assets['music-a'].file.url = 'https://elsewhere.test/a.m4a'; }, p => { p.musicSuites['warmth-long'].transitionSeconds = 4; }, p => { p.musicSuites['warmth-long'].introTrackId = 'unknown'; }]) {
    const pack = registryPack(); change(pack); const value = api.createLocalAudition({ pack, mode: 'candidate', directionId: 'bossaAlternative', baseUrl: '/audio-preview/' });
    assert.equal(value.suites['warmth-long'], undefined); assert.equal(value.directions.bossaAlternative.home, null);
  }
  const pack = registryPack(), before = JSON.stringify(pack), value = api.createLocalAudition({ pack, mode: 'candidate', directionId: 'bossaAlternative', baseUrl: '/audio-preview/' });
  assert.equal(value.suites['warmth-long'].suiteTracks.length, 4); assert.equal(value.suites['warmth-long'].seconds, 400); assert.equal(JSON.stringify(pack), before);
  const ordinary = { gain: 1 }, unavailable = new Set();
  assert.equal(api.localAuditionScene(value, 'home', 'idle', ordinary, unavailable).track.id, 'warmth-long');
  assert.equal(api.localAuditionScene(value, 'mafia', 'night', ordinary, unavailable).track, null);
  unavailable.add(value.suites['warmth-long'].url); assert.equal(api.localAuditionScene(value, 'home', 'idle', ordinary, unavailable).track, null);
});

test('normal builds remove the suite engine and its preview control', async () => {
  const result = await build({ stdin: { contents: "export {createSound} from './src/shared/fx/sound.js';", resolveDir: process.cwd() }, bundle: true, write: false, minify: true, format: 'esm', define: { __MAYDAN_LOCAL_AUDIO_REVIEW__: 'false', __MAYDAN_AUDIO_PREVIEW__: 'false', __MAYDAN_WARMTH_PREVIEW__: 'false' } });
  const source = result.outputFiles[0].text;
  assert.equal(source.includes('fade-out-then-in'), false); assert.equal(source.includes('musicSuites'), false); assert.equal(source.includes('introTrackId'), false);
});

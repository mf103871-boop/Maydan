import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createHash, webcrypto } from 'node:crypto';
import { build } from 'esbuild';
import { SAMPLE_BANK } from '../src/shared/fx/sample-bank.js';
import { SELECTED_AUDIO } from '../src/shared/fx/selected-audio.js';

const ORIGIN = 'http://127.0.0.1:4184', BASE = ORIGIN + '/audio-lab/media/';
const KEYS = ['click', 'pop', 'tick', 'tickFast', 'countdown', 'start', 'correct', 'wrong', 'buzzer', 'timeout', 'whoosh', 'reveal', 'win', 'explosion', 'drumroll', 'pass'];
const pending = () => ({ listeningApproved: false, deviceTested: false, productionApproved: false, loopApproved: false });
const sha = data => createHash('sha256').update(data).digest('hex');
function fixture() {
  const payloads = new Map();
  const asset = (id, kind, bytes) => {
    const data = new Uint8Array(bytes).fill(bytes), hash = sha(data), frames = kind === 'effect' ? 24000 : 48000 * 117;
    const entry = { id, kind, localPreviewOnly: true, approval: pending(), loop: false,
      file: { url: `audio/${id}-${hash.slice(0, 12)}.m4a`, sha256: hash, bytes, frames, sampleRate: 48000, channels: 2, durationSeconds: frames / 48000 } };
    payloads.set(BASE + entry.file.url, data); return entry;
  };
  const pack = { schemaVersion: 1, localPreviewOnly: true, approval: pending(),
    assets: Object.fromEntries([asset('sfx-tap', 'effect', 24), asset('sfx-success', 'effect', 32), asset('music-mission', 'music', 48), asset('music-eye', 'music', 52), asset('music-plan', 'music', 56), asset('music-bossa', 'music', 60)].map(entry => [entry.id, entry])),
    cueMap: Object.fromEntries(KEYS.map(key => [key, { decision: 'silence', assetId: null, rate: 1 }])),
    mafiaCueMap: {}, mafiaPublicSpecialCueMap: {},
    musicDirections: { primary: { home: 'music-mission', lobby: 'music-mission', creativeSetup: 'music-eye', mafiaLobby: 'music-plan', mafiaNight: 'music-plan' }, bossaAlternative: { home: 'music-bossa', lobby: 'music-bossa', creativeSetup: 'music-bossa', mafiaLobby: null, mafiaNight: null } } };
  for (const key of ['click', 'pop', 'start', 'whoosh', 'pass']) pack.cueMap[key] = { decision: 'candidate', assetId: 'sfx-tap', rate: 1 };
  for (const key of ['correct', 'win']) pack.cueMap[key] = { decision: 'candidate', assetId: 'sfx-success', rate: 1 };
  for (const key of ['mafiaSelect', 'mafiaRole', 'mafiaNight', 'mafiaDawn', 'mafiaVerdict', 'mafiaFinal']) pack.mafiaCueMap[key] = { decision: 'candidate', assetId: 'sfx-tap', rate: 1 };
  return { pack, payloads, options: { pack, mode: 'candidate', baseUrl: BASE } };
}
const bundle = new Map();
async function compiled(flag = true, origin = ORIGIN, privateFlag = false) {
  const key = `${flag}/${privateFlag}`;
  if (!bundle.has(key)) bundle.set(key, build({ stdin: { contents: `export {createSound} from './src/shared/fx/sound.js';export * from './src/shared/fx/local-audition.js';export {createStreamingMusic} from './src/shared/fx/streaming-music.js';export {createAudioEvents} from './src/shared/fx/audio-events.js';`, resolveDir: process.cwd() },
    bundle: true, write: false, format: 'cjs', platform: 'node', define: { ...(flag === 'absent' ? {} : { __MAYDAN_LOCAL_AUDIO_REVIEW__: JSON.stringify(flag) }), __MAYDAN_AUDIO_PREVIEW__: JSON.stringify(privateFlag), __MAYDAN_ROOMS_URL__: JSON.stringify('https://maydan-mafia-preview.mf103871.workers.dev') }, logLevel: 'silent' }).then(result => result.outputFiles[0].text));
  const sandbox = { module: { exports: {} }, exports: {}, console, URL, Date, setTimeout, clearTimeout, Response, AbortController, crypto: webcrypto };
  vm.runInNewContext(await bundle.get(key), sandbox);
  sandbox.window = { location: { href: origin + '/audio-lab/' } };
  return { ...sandbox.module.exports, sandbox, source: await bundle.get(key) };
}
const settle = async () => { for (let i = 0; i < 12; i++) await new Promise(resolve => setImmediate(resolve)); };
function environment(module, data, { missing = false, corrupt = false, deferred = false, stream = true } = {}) {
  const fetched = [], contexts = [], media = [], listeners = new Map(), decodes = [];
  const param = () => ({ value: 0, setValueAtTime(v) { this.value = v; }, setTargetAtTime(v) { this.value = v; }, cancelScheduledValues() {}, linearRampToValueAtTime(v) { this.value = v; } });
  const node = extra => ({ connect() {}, disconnect() { this.disconnected = true; }, ...extra });
  class Media {
    constructor() { this.currentTime = 0; this.duration = 117; this.paused = true; media.push(this); }
    setAttribute() {} removeAttribute(name) { delete this[name]; } load() {}
    play() { this.paused = false; return Promise.resolve(); } pause() { this.paused = true; }
  }
  class Context {
    constructor() { this.state = 'running'; this.currentTime = 1; this.destination = {}; this.sources = []; this.nodes = []; contexts.push(this); }
    createGain() { const result = node({ gain: param() }); this.nodes.push(result); return result; }
    createDynamicsCompressor() { return node(Object.fromEntries(['threshold', 'knee', 'ratio', 'attack', 'release'].map(key => [key, param()]))); }
    createBufferSource() { const source = node({ playbackRate: param(), start() { this.started = true; }, stop() { this.stopped = true; } }); this.sources.push(source); return source; }
    createMediaElementSource(audio) { return node({ audio }); }
    decodeAudioData(bytes) {
      const buffer = { length: bytes.byteLength, duration: 0.5 };
      return deferred ? new Promise(resolve => decodes.push(() => resolve(buffer))) : Promise.resolve(buffer);
    }
    resume() { this.state = 'running'; return Promise.resolve(); } suspend() { this.state = 'suspended'; return Promise.resolve(); } close() { this.state = 'closed'; return Promise.resolve(); }
  }
  const events = { addEventListener(name, fn) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); }, removeEventListener(name, fn) { listeners.get(name)?.delete(fn); } };
  Object.assign(module.sandbox.window, events, { AudioContext: Context, ...(stream ? { Audio: Media } : {}) });
  module.sandbox.document = { ...events, hidden: false };
  module.sandbox.fetch = async url => {
    fetched.push(url);
    if (missing && String(url).startsWith(BASE)) return new Response('missing', { status: 404 });
    let bytes = data.payloads.get(url);
    if (bytes && corrupt) bytes = new Uint8Array(bytes.length).fill(255);
    if (!bytes) { const old = Object.values(SAMPLE_BANK).find(entry => entry.url === url); if (old) bytes = new Uint8Array(old.frames); }
    return bytes ? new Response(bytes) : new Response('missing', { status: 404 });
  };
  return { fetched, contexts, media, decodes, dispatch(name, detail) { for (const fn of listeners.get(name) || []) fn({ detail }); } };
}

test('only the dedicated compile flag and a real HTTP loopback origin accept dependency injection', async () => {
  for (const [flag, origin, allowed] of [[false, ORIGIN, false], ['absent', ORIGIN, false], [true, 'https://maydan-mafia-preview.mf103871.workers.dev', false], [true, 'https://maydan-game.mf103871.workers.dev', false], [true, 'file://', false], [true, ORIGIN, true]]) {
    const module = await compiled(flag, origin), data = fixture();
    assert.equal(module.createLocalAudition(data.options) !== null, allowed, `${flag}/${origin}`);
  }
  const module = await compiled(false);
  module.sandbox.window = new Proxy({}, { get() { throw Error('must not read browser state'); } });
  assert.doesNotThrow(() => module.createSound({ localAudition: { get pack() { throw Error('must not inspect candidate'); } } }));
  const production = await build({ stdin: { contents: `export {createSound} from './src/shared/fx/sound.js';`, resolveDir: process.cwd() }, bundle: true, write: false, minify: true, format: 'esm', define: { __MAYDAN_LOCAL_AUDIO_REVIEW__: 'false', __MAYDAN_AUDIO_PREVIEW__: 'false', __MAYDAN_WARMTH_PREVIEW__: 'false' }, logLevel: 'silent' });
  assert.equal(production.outputFiles[0].text.includes('musicDirections'), false, 'the real production entry drops the local registry implementation');
});

test('current mode never reads the pack and preserves the existing bank and selected music', async () => {
  const module = await compiled(), data = fixture(), env = environment(module, data);
  const sound = module.createSound({ localAudition: { mode: 'current', get pack() { throw Error('current must not inspect pack'); } } });
  assert.equal(await sound.preload(), true);
  assert.equal(env.fetched.length, Object.keys(SAMPLE_BANK).length);
  sound.music.play('home'); assert.equal(env.media[0].src, SELECTED_AUDIO.music.url); sound.dispose();
});

test('candidate maps all16 decisions, aliases and six Mafia cues to rate1, never old buffers or spoken feedback', async () => {
  const module = await compiled(), data = fixture(), env = environment(module, data);
  const sound = module.createSound({ localAudition: data.options, voice: true, allowPreviewVoices: true });
  assert.equal(await sound.preload(), true); assert.equal(sound.voice.enabled, false);
  assert.equal(env.fetched.length, 2, 'shared sample ids fetch/decode once');
  assert.equal(sound.play('win'), true); assert.equal(env.contexts[0].sources.at(-1).buffer.length, 32);
  assert.equal(sound.play('start'), true); assert.equal(env.contexts[0].sources.at(-1).buffer.length, 24);
  for (const cue of ['mafiaSelect', 'mafiaRole', 'mafiaNight', 'mafiaDawn', 'mafiaVerdict', 'mafiaFinal']) {
    const before = env.contexts[0].sources.length; assert.equal(sound.play(cue), true);
    assert.equal(env.contexts[0].sources.length, before + 1, `${cue} is one neutral sample`);
    assert.equal(env.contexts[0].sources.at(-1).playbackRate.value, 1);
  }
  const count = env.contexts[0].sources.length;
  for (const cue of ['tick', 'tickFast', 'countdown', 'wrong', 'buzzer', 'timeout', 'reveal', 'explosion', 'drumroll', 'mafiaAssassination', 'mafiaJudgment']) assert.equal(sound.play(cue), false, cue);
  assert.equal(env.contexts[0].sources.length, count);
  assert.ok(env.fetched.every(url => url.startsWith(BASE)));
  assert.ok(env.contexts[0].sources.filter(source => !source.disconnected).length <= 3, 'actual composite voices obey the existing cap'); sound.dispose();
});

test('bad approval, metadata, rate, path and incomplete decisions fail silent without changing manifest approvals', async () => {
  const module = await compiled();
  for (const alter of [pack => { pack.approval.listeningApproved = true; }, pack => { pack.assets['sfx-tap'].file.url = '../outside.m4a'; }, pack => { pack.assets['sfx-tap'].file.frames = 1; }, pack => { pack.assets['sfx-tap'].approval.productionApproved = true; }, pack => { pack.cueMap.click.rate = 0.8; }, pack => { delete pack.cueMap.click; }]) {
    const data = fixture(); alter(data.pack);
    const registry = module.createLocalAudition(data.options); assert.ok(registry); assert.equal(registry.cues.click, null);
  }
  const data = fixture(), before = JSON.stringify(data.pack); module.createLocalAudition(data.options); assert.equal(JSON.stringify(data.pack), before);
  for (const baseUrl of ['https://evil.test/', ORIGIN + '/media/?token=x', 'http://user:password@127.0.0.1:4184/media/']) {
    const registry = module.createLocalAudition({ ...data.options, baseUrl });
    assert.ok(registry); assert.equal(registry.cues.click, null, 'an invalid lab base fails silent instead of selecting current mode');
  }
});

test('missing, byte-corrupt and hash-corrupt candidate responses stay silent even in a privateTF build', async () => {
  for (const fault of [{ missing: true }, { corrupt: true }]) {
    const module = await compiled(true, ORIGIN, true), data = fixture(), env = environment(module, data, fault);
    const sound = module.createSound({ localAudition: data.options }); assert.equal(await sound.preload(), false);
    sound.play('correct'); await settle(); assert.equal(env.contexts[0].sources.length, 0);
    assert.ok(env.fetched.every(url => url.startsWith(BASE)), 'no privateTF or legacy fallback inside candidate mode'); sound.dispose();
  }
});

test('delayed decode is canceled by caller guards, identity reset and independent recording leases', async () => {
  for (const interrupt of ['guard', 'identity', 'recording']) {
    const module = await compiled(), data = fixture(), env = environment(module, data, { deferred: true });
    let current = true;
    const sound = module.createSound({ localAudition: data.options });
    sound.emit('game.correct', { id: 'accepted-before-decode', guard: () => current });
    await settle(); assert.equal(env.decodes.length, 1);
    if (interrupt === 'guard') current = false;
    if (interrupt === 'identity') sound.resetIdentity('account-B');
    if (interrupt === 'recording') { sound.setSuppressed(true, 'recorder-A'); sound.setSuppressed(true, 'recorder-B'); sound.resetIdentity('account-B'); sound.setSuppressed(false, 'recorder-A'); }
    env.decodes.splice(0).forEach(done => done()); await settle();
    assert.equal(env.contexts[0].sources.length, 0, interrupt);
    if (interrupt === 'recording') assert.equal(sound.play('correct'), false, 'another owner still reserves silence'); sound.dispose();
  }
});

test('candidate music is lazy streamed, scene-stable, nonlooping and cannot fall back to old tracks or stings', async () => {
  const module = await compiled(), data = fixture(), env = environment(module, data);
  const sound = module.createSound({ localAudition: data.options }); await sound.preload();
  sound.music.scene('shell', 'home', 'idle'); assert.equal(env.media.length, 1); assert.ok(env.media[0].src.includes('music-mission-'));
  const first = env.media[0]; first.currentTime = 17;
  sound.music.scene('shell', 'home', 'idle'); assert.equal(env.media.length, 1); assert.equal(first.currentTime, 17);
  sound.setDucking(true, 'call'); assert.equal(env.contexts[0].nodes[1].gain.value, 0.5 ** 2 * 0.25);
  sound.music.setSuppressed(true, 'recorder'); assert.equal(first.paused, true);
  sound.music.setSuppressed(false, 'recorder'); sound.setDucking(false, 'call'); assert.equal(first.paused, false);
  first.currentTime = 116.9; first.ontimeupdate(); assert.equal(env.media.length, 1, 'unapproved musical phrases never overlap-loop');
  first.onended(); sound.music.setVolume(0.6); assert.equal(env.media.length, 1, 'normal resync does not restart the ended full track');
  sound.music.sting('finale'); await sound.music.prefetch('finale'); assert.ok(env.fetched.every(url => url.startsWith(BASE)));
  sound.dispose();
});

test('Mafia audience speech, secret Beep play and thinking games remain silent across scene changes', async () => {
  const module = await compiled(), data = fixture(), env = environment(module, data);
  const sound = module.createSound({ localAudition: data.options }); sound.music.scene('game', 'mafia', 'night');
  assert.ok(env.media.at(-1).src.includes('music-plan-'));
  for (const [game, phase] of [['mafia', 'opening'], ['mafia', 'discussion'], ['mafia', 'defense'], ['beep', 'play'], ['beep', 'bomb'], ['beep', 'three'], ['badeeha', 'play'], ['badeeha', 'question'], ['mamnoo', 'play'], ['jabeen', 'play'], ['meenfina', 'vote'], ['fabraka', 'vote'], ['fabraka', 'discuss'], ['fabraka', 'discussion']]) {
    sound.music.scene('game', game, phase); assert.equal(sound.music.current, null, `${game}/${phase}`); assert.ok(env.media.every(audio => audio.paused));
  }
  sound.music.scene('game', 'mafia', 'night'); assert.ok(sound.music.current); env.media.at(-1).onerror(); await settle();
  assert.equal(sound.music.current, null); assert.ok(env.fetched.every(url => url.startsWith(BASE))); sound.dispose();
  const alt = module.createSound({ localAudition: { ...data.options, directionId: 'bossaAlternative' } });
  for (const [game, phase] of [['home', 'idle'], ['meenfina', 'lobby'], ['ersomha', 'setup'], ['fabraka', 'write']]) { alt.music.scene('game', game, phase); assert.ok(env.media.at(-1).src.includes('music-bossa-')); }
  assert.equal(env.media.filter(audio => audio.src?.includes('music-bossa-')).length, 1, 'one alternative identity remains stable across game scenes');
  alt.music.scene('game', 'mafia', 'lobby'); assert.equal(alt.music.current, null);
  alt.music.scene('game', 'mafia', 'night'); assert.equal(alt.music.current, null); alt.dispose();
});

test('unsupported streaming and background/manual holds cannot resurrect an old music fallback', async () => {
  const module = await compiled(), data = fixture(), env = environment(module, data, { stream: false });
  const sound = module.createSound({ localAudition: data.options }); sound.attach(); sound.music.scene('shell', 'home', 'idle'); await settle();
  assert.equal(sound.music.current, null); assert.ok(env.fetched.every(url => url.startsWith(BASE))); sound.dispose();
  const next = await compiled(), mediaEnv = environment(next, data), current = next.createSound({ localAudition: data.options }); current.attach(); current.music.scene('shell', 'home', 'idle');
  mediaEnv.dispatch('maydan-audio-lifecycle', { state: 'interruption-began' }); assert.ok(mediaEnv.media.every(audio => audio.paused));
  mediaEnv.dispatch('maydan-audio-lifecycle', { state: 'interruption-ended', shouldResume: false }); await settle(); assert.equal(current.music.current, null);
  mediaEnv.dispatch('maydan-audio-lifecycle', { state: 'foreground' }); await settle(); assert.equal(current.music.current, null); current.dispose();
});

test('room event names retain separate coalescing, accepted guards and silent baselines', async () => {
  const module = await compiled(), calls = [];
  let at = 1000, visible = true;
  const bus = module.createAudioEvents((cue, options) => { calls.push({ cue, options }); return true; }, { now: () => at }); bus.reset('A/room/seat');
  bus.emit('room.admitted', { id: 1, initial: true }); bus.emit('room.admitted', { id: 1 }); assert.equal(calls.length, 0);
  bus.emit('room.members', { id: 2 }); bus.emit('room.members', { id: 3 }); assert.equal(calls.length, 1, 'one cue for a batched roster change');
  bus.emit('room.host', { id: 4, guard: () => visible }); assert.equal(calls.length, 2, 'a different meaning is not swallowed by the member cooldown');
  visible = false; assert.equal(calls[1].options.guard(), false); at += 2000;
  for (const type of ['room.ready', 'room.all-ready', 'room.started', 'room.connection-lost', 'room.connection-restored', 'room.exit', 'game.turn', 'game.hint', 'draw.correct']) assert.equal(bus.emit(type, { id: type }), true, type);
  const last = calls.at(-1); bus.suspend(); assert.equal(last.options.guard(), false); bus.reset('B/room/seat'); assert.equal(bus.emit('room.started', { scope: 'A/room/seat' }), false);
});

test('integrated candidate suite keeps chapters through scene silence and respects mix, recording and call holds', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const module = await compiled(), data = fixture();
  data.pack.musicSuites = { 'warmth-long': { title: 'warmth', trackIds: ['music-bossa', 'music-mission', 'music-eye', 'music-plan'], introTrackId: 'music-bossa', transitionSeconds: 1.2, repeat: true } };
  data.pack.musicDirections.bossaAlternative = { home: 'warmth-long', lobby: 'warmth-long', creativeSetup: 'warmth-long', mafiaLobby: null, mafiaNight: null };
  const env = environment(module, data), sound = module.createSound({ localAudition: { ...data.options, directionId: 'bossaAlternative' }, musicVolume: .3 });
  sound.music.scene('game', 'home', 'idle'); await settle();
  assert.equal(sound.music.getStatus().trackId, 'music-bossa');
  assert.ok(env.media[0].src.includes('/music-bossa-')); assert.ok(env.media.every(audio => !audio.src?.includes('/suite/')));
  env.media[0].currentTime = 35;
  sound.music.scene('game', 'ersomha', 'setup'); assert.equal(env.media.length, 1); assert.equal(sound.music.position, 35);
  sound.setDucking(true, 'call'); assert.equal(sound.music.skipNext(), false); assert.equal(env.contexts[0].nodes[1].gain.value, .3 ** 2 * .25 * .8);
  sound.setDucking(false, 'call'); sound.music.setSuppressed(true, 'recorder'); assert.equal(sound.music.skipNext(), false); assert.equal(sound.music.getStatus().state, 'paused');
  sound.music.setSuppressed(false, 'recorder'); await settle(); assert.equal(sound.music.position, 35);
  sound.music.scene('game', 'mafia', 'night'); assert.equal(sound.music.current, null); assert.equal(sound.music.skipNext(), false);
  sound.music.scene('game', 'beep', 'prompt'); assert.equal(sound.music.current, null); assert.equal(sound.music.skipNext(), false);
  sound.music.scene('game', 'home', 'idle'); await settle(); assert.equal(sound.music.position, 35);
  assert.equal(sound.music.skipNext(), true); t.mock.timers.tick(1201); await settle(); assert.notEqual(sound.music.getStatus().trackId, 'music-bossa');
  const current = env.media.find(audio => audio.src && !audio.paused); current.currentTime = 19;
  sound.music.enable(false); assert.equal(sound.music.skipNext(), false); sound.music.enable(true); await settle(); assert.equal(sound.music.position, 19);
  sound.resetIdentity('next-account'); sound.music.scene('game', 'home', 'idle'); await settle(); assert.equal(sound.music.getStatus().trackId, 'music-bossa'); assert.equal(sound.music.position, 0);
  assert.ok(env.fetched.every(url => url.startsWith(BASE))); sound.dispose();
});

test('explicit suite retry clears failed candidate state only when the current scene and privacy policy permit playback', async () => {
  const module = await compiled(), data = fixture();
  data.pack.musicSuites = { 'warmth-long': { title: 'warmth', trackIds: ['music-bossa', 'music-mission', 'music-eye', 'music-plan'], introTrackId: 'music-bossa', transitionSeconds: 1.2, repeat: true } };
  data.pack.musicDirections.bossaAlternative = { home: 'warmth-long', lobby: 'warmth-long', creativeSetup: 'warmth-long', mafiaLobby: null, mafiaNight: null };
  const env = environment(module, data), sound = module.createSound({ localAudition: { ...data.options, directionId: 'bossaAlternative' } });
  sound.music.scene('game', 'home', 'idle'); await settle();
  for (let i = 0; i < 4; i++) { env.media.find(audio => audio.src && !audio.paused).onerror(); await settle(); }
  assert.equal(sound.music.getStatus().state, 'failed'); assert.equal(env.media.length, 4); assert.equal(sound.music.current, null);
  sound.setDucking(true, 'call'); assert.equal(sound.music.retry(), false); sound.setDucking(false, 'call');
  sound.music.setSuppressed(true, 'recorder'); assert.equal(sound.music.retry(), false); sound.music.setSuppressed(false, 'recorder');
  sound.music.scene('game', 'mafia', 'night'); assert.equal(sound.music.retry(), false);
  sound.music.scene('game', 'home', 'idle'); sound.music.enable(false); assert.equal(sound.music.retry(), false); sound.music.enable(true);
  assert.equal(env.media.length, 4); assert.equal(sound.music.retry(), true); await settle();
  assert.equal(sound.music.getStatus().state, 'playing'); assert.equal(sound.music.retry(), false); assert.equal(env.media.length, 5);
  assert.ok(env.media.every(audio => !audio.src || audio.src.startsWith(BASE))); assert.ok(env.fetched.every(url => url.startsWith(BASE))); sound.dispose();
});

test('public timer warning requires a rate-one sample no longer than 850ms including codec padding', async () => {
  const module = await compiled();
  for (const [seconds, rate, valid] of [[.5, 1, true], [.76625, 1, true], [.85, 1, true], [.851, 1, false], [.5, .8, false]]) {
    const data = fixture(), file = data.pack.assets['sfx-tap'].file;
    file.frames = Math.round(seconds * file.sampleRate); file.durationSeconds = file.frames / file.sampleRate;
    data.pack.cueMap.timerWarning = { decision: 'candidate', assetId: 'sfx-tap', rate };
    assert.equal(module.createLocalAudition(data.options).cues.timerWarning, valid ? 'sfx-tap' : null);
  }
});

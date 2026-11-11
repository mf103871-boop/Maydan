import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { build } from 'esbuild';
import { createDeadlineAudio } from '../src/shared/fx/deadline-audio.js';
import { bindNetworkAudio } from '../src/shared/fx/network-audio.js';
import { emitCallFeedback } from '../src/social/call-feedback.js';

const pending = { listeningApproved: false, deviceTested: false, productionApproved: false, loopApproved: false };
function pack() {
  const asset = (id, kind) => ({ id, kind, localPreviewOnly: true, approval: pending, loop: false,
    file: { sha256: 'a'.repeat(64), url: `audio/${id}-${'a'.repeat(12)}.m4a`, bytes: 500, frames: 48000, sampleRate: 48000, channels: 2, durationSeconds: 1 } });
  return { schemaVersion: 1, localPreviewOnly: true, approval: pending,
    assets: { 'sfx-tap': asset('sfx-tap', 'effect'), 'music-bossa': asset('music-bossa', 'music') },
    cueMap: { click: { decision: 'candidate', rate: 1, assetId: 'sfx-tap' } },
    musicDirections: { bossaAlternative: { home: 'music-bossa', lobby: 'music-bossa', creativeSetup: 'music-bossa' } } };
}
async function bootstrap(flag, origin = 'http://127.0.0.1:4185/') {
  const bundle = await build({ entryPoints: ['src/shared/fx/integrated-preview-audio.js'], bundle: true, write: false, format: 'cjs', platform: 'node',
    define: { __MAYDAN_LOCAL_AUDIO_REVIEW__: JSON.stringify(flag) }, logLevel: 'silent' });
  const sandbox = { module: { exports: {} }, exports: {}, URL, window: { location: { href: origin } } };
  vm.runInNewContext(bundle.outputFiles[0].text, sandbox);
  return { api: sandbox.module.exports, sandbox };
}
test('integrated candidates require compile-time opt-in and loopback; normal/release hosts cannot activate them', async () => {
  for (const [flag, origin] of [[false, 'http://127.0.0.1:4185/'], [true, 'https://maydan.example/'], [true, 'http://192.168.1.5/']]) {
    const { api } = await bootstrap(flag, origin);
    assert.equal(api.configureIntegratedPreviewAudio({ pack: pack() }), false);
    assert.equal(api.integratedPreviewAudio(), undefined);
    assert.deepEqual({ ...api.integratedPreviewDefaults() }, {});
  }
});
test('actual game bootstrap selects one Bossa identity and pending assets, with local defaults; malformed/cross-origin media fails silent', async () => {
  const { api, sandbox } = await bootstrap(true);
  const candidate = pack();
  assert.equal(api.configureIntegratedPreviewAudio({ pack: candidate }), true);
  assert.equal(api.integratedPreviewAudio().directionId, 'bossaAlternative');
  assert.deepEqual({ ...api.integratedPreviewDefaults() }, { soundVolume: .65, musicVolume: .30, voiceOn: false });
  assert.deepEqual(candidate.approval, pending);
  assert.equal(api.configureIntegratedPreviewAudio({ pack: candidate, baseUrl: 'https://other.example/audio/' }), false);
  assert.equal(api.integratedPreviewAudio().mode, 'candidate');
  sandbox.window.location.href = 'https://public.example/';
  assert.equal(api.integratedPreviewAudio(), undefined);
});
test('Beep prompt remains silent in ordinary and private TestFlight candidate builds, independent of the local audition mapping', async () => {
  for (const privatePreview of [false, true]) {
    const bundle = await build({ entryPoints: ['src/shared/fx/audio-scenes.js'], bundle: true, write: false, format: 'cjs', platform: 'node',
      define: { __MAYDAN_AUDIO_PREVIEW__: JSON.stringify(privatePreview), __MAYDAN_ROOMS_URL__: JSON.stringify('https://maydan-mafia-preview.mf103871.workers.dev'), __MAYDAN_LOCAL_AUDIO_REVIEW__: 'false' }, logLevel: 'silent' });
    const sandbox = { module: { exports: {} }, exports: {}, URL };
    vm.runInNewContext(bundle.outputFiles[0].text, sandbox);
    const scene = sandbox.module.exports.resolveAudioScene('beep', 'prompt');
    assert.equal(scene.gain, 0); assert.equal(scene.track, null); assert.equal(scene.fallback, null); assert.equal(scene.privateCandidate, false);
  }
});
test('server deadline emits one live warning and timeout, not an initial/duplicate/extended countdown backlog', () => {
  const emitted = [], sound = { emit: (type, options) => emitted.push({ type, options }) };
  const audio = createDeadlineAudio(sound);
  audio.update('room:round1', 7); audio.update('room:round1', 5); audio.update('room:round1', 5); audio.update('room:round1', 4);
  audio.update('room:round1', 15); audio.update('room:round1', 5); audio.update('room:round1', 0); audio.update('room:round1', 0);
  assert.deepEqual(emitted.map(x => x.type), ['game.timer-warning', 'game.timeout']);
  audio.update('room:round2', 0); assert.equal(emitted.length, 2);
  audio.update('room:round3', 5); audio.update('room:round3', 4); assert.equal(emitted.length, 2);
});
test('deadline reconnect/background/spectator and disposal consume baselines and cancel delayed media guards', () => {
  const emitted = [], audio = createDeadlineAudio({ emit: (type, options) => emitted.push({ type, options }) });
  audio.update('q', 10); audio.update('q', 5); const old = emitted[0].options;
  audio.suspend(); assert.equal(old.guard(), false);
  audio.update('q', 3); audio.update('q', 2); assert.equal(emitted.length, 1);
  audio.update('q', 0, { active: false }); audio.update('q', 0); assert.equal(emitted.length, 1);
  audio.update('q2', 7); audio.update('q2', 4); assert.equal(emitted.length, 2);
  audio.dispose(); assert.equal(emitted[1].options.guard(), false); audio.update('q2', 0); assert.equal(emitted.length, 2);
});
const events = () => { const listeners = new Map(); return { addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name), fire: name => listeners.get(name)?.(), listeners }; };
test('network notices are debounced link transitions; initial state, flapping, hidden and active games stay quiet', () => {
  const target = events(), doc = { ...events(), hidden: false }, nav = { onLine: true }, jobs = new Map(), emitted = [];
  let available = true, timer = 0;
  const stop = bindNetworkAudio({ emit: (type, options) => emitted.push({ type, options }) }, { target, documentTarget: doc, navigatorTarget: nav,
    available: () => available, schedule: fn => { jobs.set(++timer, fn); return timer; }, cancel: id => jobs.delete(id) });
  const flush = () => { for (const [id, fn] of jobs) { jobs.delete(id); fn(); } };
  assert.equal(jobs.size, 0);
  nav.onLine = false; target.fire('offline'); nav.onLine = true; target.fire('online'); flush();
  assert.deepEqual(emitted, []);
  nav.onLine = false; target.fire('offline'); doc.hidden = true; doc.fire('visibilitychange'); flush(); assert.equal(emitted.length, 0);
  doc.hidden = false; doc.fire('visibilitychange'); available = false; nav.onLine = true; target.fire('online'); flush(); assert.equal(emitted.length, 0);
  available = true; nav.onLine = false; target.fire('offline'); flush(); assert.equal(emitted.at(-1).type, 'network.offline');
  stop(); assert.equal(emitted.at(-1).options.guard(), false); assert.equal(target.listeners.size, 0); assert.equal(doc.listeners.size, 0);
});
test('social call feedback excludes native CallKit, private roles, Mafia locks, stale owners and late decoded audio', () => {
  let native = false, current = true, privateTurn = false, locked = false;
  const emitted = [], sound = { emit: (type, options) => { emitted.push({ type, options }); return true; } };
  const policy = { isNative: () => native, current: () => current, privacy: () => ({ privateTurn, communicationLocked: locked }) };
  assert.equal(emitCallFeedback(sound, 'call.connected', policy), true); const accepted = emitted[0].options;
  native = true; assert.equal(emitCallFeedback(sound, 'call.ended', policy), false); assert.equal(accepted.guard(), false);
  native = false; privateTurn = true; assert.equal(emitCallFeedback(sound, 'call.muted', policy), false);
  privateTurn = false; locked = true; assert.equal(emitCallFeedback(sound, 'call.connected', policy), false);
  locked = false; current = false; assert.equal(emitCallFeedback(sound, 'call.failed', policy), false);
  current = true; assert.equal(emitCallFeedback(sound, 'call.ringing', policy), false); assert.equal(emitted.length, 1);
});

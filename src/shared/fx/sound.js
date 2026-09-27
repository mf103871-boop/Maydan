import { SAMPLE_BANK, SAMPLE_RATE } from './sample-bank.js';
import { MUSIC_BANK } from './music-bank.js';

// Maydan's cue bank: sixteen mastered AAC files (scripts/audio/build.mjs), in-house
// designs and cues from licensed libraries alike, all tuned to D so they sit inside the
// music (assets/audio/maydan-v3/provenance.json records where each came from). They are
// fetched and decoded as soon as the bus attaches (decoding needs no gesture); each public
// cue name maps to exactly one mastered file.
export const CUE_SAMPLES = {
  click: 'click', pop: 'pop', tick: 'tick', tickFast: 'tickFast', correct: 'correct', wrong: 'wrong',
  buzzer: 'buzzer', whoosh: 'whoosh', fanfare: 'win', explosion: 'explosion', drumroll: 'drumroll',
  countdown: 'countdown', countdownGo: 'start', reveal: 'reveal', pass: 'pass', timeout: 'timeout',
};
export const RECIPES = Object.fromEntries(Object.entries(CUE_SAMPLES).map(([name, id]) => [name, (c, meta) => c.sample(id, meta)]));

const clampVolume = (value, fallback = 0.75) => typeof value === 'number' && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : fallback;
// A repeat inside the cooldown restarts a user cue (the tap happened, the sound must
// follow) and is dropped for an automatic one (ticks and countdowns keep their rhythm).
const COOLDOWNS = { click: 65, pop: 70, tick: 100, tickFast: 100, countdown: 120, correct: 150, wrong: 180,
  buzzer: 300, whoosh: 100, fanfare: 500, explosion: 400, drumroll: 300, countdownGo: 180, reveal: 160, timeout: 300, pass: 80 };
const USER_CUES = new Set(['click', 'pop', 'whoosh', 'correct', 'wrong', 'buzzer', 'pass', 'reveal', 'drumroll']);
// Below this gap a repeat is one gesture seen twice (pointerdown + click), never two taps.
const RETRIGGER_FLOOR_MS = 40;
const ALIASES = { open: 'whoosh', steal: 'correct', win: 'fanfare', start: 'countdownGo', tool: 'reveal', scoreUp: 'pop', scoreDown: 'wrong' };
// A cue that arrives while the bank is still decoding or the context resuming plays a
// little late; feedback for a tap is still welcome after a second, a timer tick is not.
const LATE_MS = { default: 1200, tick: 400, tickFast: 400, countdown: 400, countdownGo: 400, timeout: 400 };
const lateFor = (name) => LATE_MS[name] ?? LATE_MS.default;
const RESUME_TIMEOUT_MS = 1500;
const CUE_IDS = Object.keys(SAMPLE_BANK);
// Every activation of a control sounds, without wiring each handler: a capture `click`
// listener on document plays `data-sound` (default `click`) for anything matching
// TAP_SELECTOR; `data-sound="none"` on the element or an ancestor keeps it silent, as do
// disabled, busy and inert controls. `click` (not pointerdown) so a scroll that starts on a
// button, a drag away, or a disabled control never sounds, and keyboard and assistive
// activations do.
export const TAP_SELECTOR = 'button, [role="button"], a[href], summary, select, input[type="checkbox"], input[type="radio"], [data-sound]';
export const TAP_SKIP = '[data-sound="none"]';
const GESTURE_EVENTS = ['pointerdown', 'pointerup', 'touchstart', 'touchend', 'keydown', 'click'];
// A handler cue arriving this soon after a tap click replaces it: one sound per tap.
const TAP_SUPERSEDE_MS = 180;
const TAP_FADE_S = 0.03;
// Background music (scripts/audio/music.mjs): seamless loops fetched on first use, never
// precached, played on their own gain behind the shared compressor so the sound-effects
// volume, cooldowns and stop() leave them alone. Cues that carry a moment pull the music
// down under them for their own length; clicks and ticks ride on top untouched.
const DUCKS = { fanfare: 0.3, explosion: 0.35, drumroll: 0.4, countdownGo: 0.45, reveal: 0.5, timeout: 0.45, buzzer: 0.5 };
const MUSIC_FADE_IN = 1.4;
const MUSIC_FADE_OUT = 0.8;
const MUSIC_BUFFERS = 3;
// A sting that arrives this long after its moment (slow network) is dropped.
const LATE_STING_MS = 2500;

export function createSound({ enabled = true, volume = 0.75, music = true, musicVolume = 0.5 } = {}) {
  let on = !!enabled;
  let level = clampVolume(volume);
  let musicOn = !!music;
  let musicLevel = clampVolume(musicVolume, 0.5);
  let context = null;
  let master = null;
  let musicGain = null;
  let voiceContext = null;
  let attached = false;
  // Every request and voice carries an ordinal and the wall-clock time it was asked for.
  // A full stop() voids everything asked for up to its ordinal; stop({ spare }) voids only
  // what was asked for before `spare` milliseconds ago, so a tap that changes the screen
  // keeps its own sound while the previous screen's long cues end.
  let seq = 0;
  let cutoffSeq = 0;
  let cutoffAt = 0;
  let ducked = false;
  let bankFetch = null;
  let bankDecode = null;
  let unlockWaiters = [];
  let unlockTimer = null;
  const encoded = new Map();
  const fetches = new Map();
  const buffers = new Map();
  const decodes = new Map();
  const voices = new Set();
  const lastPlayed = new Map();
  const lastVoice = new Map();
  // The tap delegate's pending click (rendered a tick later unless a handler cue
  // supersedes it) and the last tap voice (cut when a handler cue follows shortly).
  const tap = { pending: null, superseded: false, voice: null, timer: null };
  // Music state: the track the current screen wants, the loop actually sounding, a
  // one-shot sting, and the cue duck (a level held until a wall-clock deadline).
  let musicWanted = null;
  let playing = null;
  let sting = null;
  let musicToken = 0;
  let stingToken = 0;
  let stingHold = 0;
  let stingTimer = null;
  let duckLevel = 1;
  let duckUntil = 0;
  let duckTimer = null;
  const musicEncoded = new Map();
  const musicFetches = new Map();
  const musicBuffers = new Map();
  const musicDecodes = new Map();
  const hidden = () => typeof document !== 'undefined' && document.hidden;
  const canPlay = () => on && level > 0 && !hidden();
  const canPlayMusic = () => on && musicOn && musicLevel > 0 && !hidden();
  // Per cue when named, the whole bank otherwise.
  const ready = (name = null) => (name ? buffers.has(CUE_SAMPLES[name]) : CUE_IDS.every((id) => buffers.has(id)));

  function musicMix(tc = 0.08) {
    if (!musicGain || !context) return;
    const duck = (Date.now() < duckUntil ? duckLevel : 1) * (ducked ? 0.25 : 1);
    const gain = canPlayMusic() ? musicLevel * musicLevel * duck : 0;
    try { musicGain.gain.setTargetAtTime(gain, context.currentTime, tc); } catch { musicGain.gain.value = gain; }
  }
  function mix() {
    musicMix();
    if (!master || !context) return;
    const gain = canPlay() ? level * level * (ducked ? 0.3 : 1) : 0;
    try { master.gain.setTargetAtTime(gain, context.currentTime, 0.012); } catch { master.gain.value = gain; }
  }
  function duckFor(levelUnder, seconds) {
    if (!playing && !sting) return;
    duckLevel = Date.now() < duckUntil ? Math.min(duckLevel, levelUnder) : levelUnder;
    duckUntil = Math.max(duckUntil, Date.now() + seconds * 1000);
    musicMix(0.02);
    clearTimeout(duckTimer);
    duckTimer = setTimeout(() => musicMix(0.3), duckUntil - Date.now() + 20);
  }
  // Stop what is sounding and void what is pending. `spare` keeps the last few hundred
  // milliseconds alive: a route change must not swallow the tap that caused it.
  const voided = (ordinal, at) => ordinal <= cutoffSeq || at < cutoffAt;
  function stop({ spare = 0 } = {}) {
    if (spare) {
      cutoffAt = Math.max(cutoffAt, Date.now() - spare);
      for (const voice of [...voices]) if (voice.at < cutoffAt) cutVoice(voice);
      return;
    }
    cutoffSeq = seq;
    lastPlayed.clear(); lastVoice.clear(); tap.pending = null; tap.voice = null;
    for (const voice of [...voices]) cutVoice(voice);
  }
  function cutVoice(voice, seconds = 0) {
    if (!voice || !voices.has(voice)) return;
    try {
      if (seconds && voice.gain && context) {
        voice.gain.gain.setTargetAtTime(0, context.currentTime, seconds / 3);
        voice.source.stop(context.currentTime + seconds);
      } else { voice.source.stop(); voice.cleanup(); }
    } catch { voice.cleanup(); }
  }
  function track(source, nodes, { name = null, at = Date.now(), ordinal = ++seq, gain = null } = {}) {
    if (voices.size >= 20) cutVoice(voices.values().next().value);
    const voice = { source, name, at, ordinal, gain, cleanup() {
      voices.delete(voice);
      source.onended = null;
      for (const node of nodes) { try { node.disconnect(); } catch { /* disconnected */ } }
    } };
    voices.add(voice);
    if (name) lastVoice.set(name, voice);
    source.onended = voice.cleanup;
    return voice;
  }
  // The encoded files need no AudioContext, so they are fetched as soon as the bus
  // attaches, one promise per cue: a file that fails leaves the other fifteen playable.
  function fetchCue(id) {
    if (encoded.has(id)) return Promise.resolve(true);
    if (fetches.has(id)) return fetches.get(id);
    if (typeof fetch !== 'function') return Promise.resolve(false);
    const task = Promise.resolve().then(() => fetch(SAMPLE_BANK[id].url)).then(async (response) => {
      if (!response || !response.ok) throw new Error('cue unavailable');
      encoded.set(id, await response.arrayBuffer());
      return true;
    }).catch(() => false);
    fetches.set(id, task);
    void task.finally(() => { if (fetches.get(id) === task) fetches.delete(id); });
    return task;
  }
  function fetchBank() {
    if (bankFetch) return bankFetch;
    const task = Promise.all(CUE_IDS.map(fetchCue)).then((results) => results.every(Boolean));
    bankFetch = task;
    void task.finally(() => { if (bankFetch === task) bankFetch = null; });
    return task;
  }
  function decode(c, data) {
    return new Promise((resolve, reject) => {
      try {
        // Older WebKit only knows the callback form; newer engines return a promise.
        const result = c.decodeAudioData(data, resolve, reject);
        if (result && typeof result.then === 'function') result.then(resolve, reject);
      } catch (error) { reject(error); }
    });
  }
  // One cue, decoded once per context (decodeAudioData detaches its input: hand it a copy).
  function decodeCue(c, id) {
    if (c !== context) return Promise.resolve(false);
    if (buffers.has(id)) return Promise.resolve(true);
    if (decodes.has(id)) return decodes.get(id);
    const task = fetchCue(id).then(async (ok) => {
      if (!ok || c !== context) return false;
      const buffer = await decode(c, encoded.get(id).slice(0));
      if (c !== context) return false;
      buffers.set(id, buffer);
      return true;
    }).catch(() => false);
    decodes.set(id, task);
    void task.finally(() => { if (decodes.get(id) === task) decodes.delete(id); });
    return task;
  }
  // The whole bank; `firstId` (the cue somebody is waiting for) goes first.
  function decodeBank(c, firstId = null) {
    if (c !== context) return Promise.resolve(false);
    const all = () => {
      if (!bankDecode) {
        const task = Promise.all(CUE_IDS.map((id) => decodeCue(c, id))).then((results) => c === context && results.every(Boolean));
        bankDecode = task;
        void task.finally(() => { if (bankDecode === task && !ready()) bankDecode = null; });
      }
      return bankDecode;
    };
    return firstId && !buffers.has(firstId) ? decodeCue(c, firstId).then(all) : all();
  }
  function sample(id, { at = 0, gain = 1, rate = 1, name = null, requested = Date.now(), ordinal = undefined } = {}) {
    const buffer = buffers.get(id);
    if (!buffer) return null;
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = rate;
    const voiceGain = context.createGain();
    voiceGain.gain.value = gain;
    source.connect(voiceGain);
    voiceGain.connect(master);
    const voice = track(source, [source, voiceGain], { name, at: requested, ordinal, gain: voiceGain });
    source.start(context.currentTime + at);
    return voice;
  }
  // Music files are large (a minute of stereo AAC each), so a track is fetched the first
  // time a screen asks for it and decoded once per context; decoded loops are kept for
  // the last few tracks only, the encoded bytes for all of them.
  function fetchTrack(id) {
    if (!MUSIC_BANK[id]) return Promise.resolve(null);
    if (musicEncoded.has(id)) return Promise.resolve(musicEncoded.get(id));
    if (musicFetches.has(id)) return musicFetches.get(id);
    if (typeof fetch !== 'function') return Promise.resolve(null);
    const task = Promise.resolve().then(() => fetch(MUSIC_BANK[id].url)).then(async (response) => {
      if (!response || !response.ok) throw new Error('track unavailable');
      const data = await response.arrayBuffer();
      musicEncoded.set(id, data);
      return data;
    }).catch(() => null);
    musicFetches.set(id, task);
    void task.finally(() => { if (musicFetches.get(id) === task) musicFetches.delete(id); });
    return task;
  }
  function trimMusicBuffers() {
    for (const id of musicBuffers.keys()) {
      if (musicBuffers.size <= MUSIC_BUFFERS) return;
      if (id === musicWanted || id === playing?.id || id === sting?.id) continue;
      musicBuffers.delete(id);
    }
  }
  function loadTrack(c, id) {
    if (!MUSIC_BANK[id]) return Promise.resolve(null);
    if (musicBuffers.has(id)) {
      const buffer = musicBuffers.get(id);
      musicBuffers.delete(id); musicBuffers.set(id, buffer); // most recently used last
      return Promise.resolve(buffer);
    }
    if (musicDecodes.has(id)) return musicDecodes.get(id);
    // المؤثرات أولًا: مقطع بدقيقة كاملة لا يحجز المُفكِّك قبل ستة عشر مؤثرًا قصيرًا.
    const task = Promise.resolve(bankDecode || decodeBank(c)).then(() => fetchTrack(id)).then(async (data) => {
      if (!data || c !== context) return null;
      const buffer = await decode(c, data.slice(0));
      if (c !== context) return null;
      musicBuffers.set(id, buffer);
      trimMusicBuffers();
      return buffer;
    }).catch(() => null);
    musicDecodes.set(id, task);
    void task.finally(() => { if (musicDecodes.get(id) === task) musicDecodes.delete(id); });
    return task;
  }
  function musicVoice(c, id, buffer, { loop, fadeIn }) {
    const source = c.createBufferSource();
    source.buffer = buffer;
    source.loop = !!loop;
    const gainNode = c.createGain();
    gainNode.gain.value = fadeIn ? 0 : 1;
    source.connect(gainNode);
    gainNode.connect(musicGain);
    const voice = { id, source, gain: gainNode, done: false, cleanup() {
      if (voice.done) return;
      voice.done = true;
      source.onended = null;
      for (const node of [source, gainNode]) { try { node.disconnect(); } catch { /* disconnected */ } }
    } };
    source.onended = voice.cleanup;
    if (fadeIn) { try { gainNode.gain.setTargetAtTime(1, c.currentTime, fadeIn / 3); } catch { gainNode.gain.value = 1; } }
    source.start(c.currentTime);
    return voice;
  }
  function fadeOutVoice(voice, seconds) {
    if (!voice || voice.done) return;
    const c = context;
    try {
      if (!c || !seconds) throw new Error('stop now');
      voice.gain.gain.setTargetAtTime(0, c.currentTime, seconds / 4);
      voice.source.stop(c.currentTime + seconds);
    } catch {
      try { voice.source.stop(); } catch { /* already ended */ }
      voice.cleanup();
    }
  }
  function haltMusic() {
    musicToken += 1; stingToken += 1; stingHold = 0;
    clearTimeout(stingTimer); clearTimeout(duckTimer); duckUntil = 0;
    fadeOutVoice(playing, 0); fadeOutVoice(sting, 0);
    playing = null; sting = null;
  }
  // Bring the sounding loop in line with what the screen wants: fade it out when music
  // is off or unwanted, keep it while merely hidden (the context suspends anyway), and
  // otherwise start the wanted track once the context runs and the file is decoded.
  function syncMusic(tc) {
    musicMix(tc);
    if (!on || !musicOn || !musicLevel) {
      if (playing) { fadeOutVoice(playing, 0.35); playing = null; }
      if (sting) { fadeOutVoice(sting, 0.35); sting = null; stingHold = 0; }
      musicToken += 1; stingToken += 1;
      return;
    }
    if (hidden()) return;
    if (!musicWanted) {
      if (playing) { fadeOutVoice(playing, MUSIC_FADE_OUT); playing = null; }
      musicToken += 1;
      return;
    }
    if (playing?.id === musicWanted || Date.now() < stingHold) return;
    const id = musicWanted;
    const c = getContext();
    if (!c) return;
    const token = ++musicToken;
    void Promise.all([unlock(), loadTrack(c, id)]).then(([running, buffer]) => {
      if (!running || !buffer || token !== musicToken || c !== context || c.state !== 'running') return;
      if (musicWanted !== id || !canPlayMusic() || Date.now() < stingHold || playing?.id === id) return;
      if (playing) fadeOutVoice(playing, MUSIC_FADE_OUT);
      playing = musicVoice(c, id, buffer, { loop: MUSIC_BANK[id].loop, fadeIn: MUSIC_FADE_IN });
    });
  }
  // A one-shot musical moment (the match finale): the loop steps aside for it and the
  // wanted track (possibly a new one, `after`) returns once it has ended.
  function playSting(id, { after } = {}) {
    if (typeof after === 'string' && MUSIC_BANK[after]) musicWanted = after;
    if (!MUSIC_BANK[id] || !canPlayMusic()) { syncMusic(); return; }
    const c = getContext();
    if (!c) { syncMusic(); return; }
    const token = ++stingToken;
    const asked = Date.now();
    stingHold = asked + LATE_STING_MS;
    void Promise.all([unlock(), loadTrack(c, id)]).then(([running, buffer]) => {
      if (token !== stingToken) return;
      if (!running || !buffer || c !== context || c.state !== 'running' || !canPlayMusic() || Date.now() - asked > LATE_STING_MS) {
        stingHold = 0; syncMusic(); return;
      }
      if (sting) fadeOutVoice(sting, 0.2);
      if (playing) { fadeOutVoice(playing, 1); playing = null; }
      const seconds = buffer.duration || MUSIC_BANK[id].seconds;
      const voice = musicVoice(c, id, buffer, { loop: false, fadeIn: 0 });
      sting = voice;
      stingHold = Date.now() + seconds * 1000;
      const finish = () => {
        voice.cleanup();
        if (sting !== voice) return;
        clearTimeout(stingTimer);
        sting = null; stingHold = 0;
        syncMusic();
      };
      voice.source.onended = finish;
      clearTimeout(stingTimer);
      stingTimer = setTimeout(finish, seconds * 1000 + 250);
    });
  }
  function settleUnlock() {
    const waiters = unlockWaiters;
    unlockWaiters = [];
    clearTimeout(unlockTimer); unlockTimer = null;
    const ok = !!context && context.state === 'running';
    for (const resolve of waiters) resolve(ok);
  }
  function onStateChange() {
    if (context?.state === 'running') settleUnlock();
    mix(); syncMusic();
  }
  function getContext() {
    if (context && context.state !== 'closed') return context;
    try {
      const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
      if (!AC) return null;
      stop(); haltMusic(); buffers.clear(); decodes.clear(); musicBuffers.clear(); musicDecodes.clear(); bankDecode = null; settleUnlock();
      context = new AC({ latencyHint: 'interactive' });
      master = context.createGain();
      const compressor = context.createDynamicsCompressor();
      // Preserve mastered single cues; limit peaks from overlapping events.
      compressor.threshold.value = -8;
      compressor.knee.value = 6;
      compressor.ratio.value = 4;
      compressor.attack.value = 0.003;
      compressor.release.value = 0.12;
      master.connect(compressor);
      compressor.connect(context.destination);
      // Music joins the sum after the cue master: the compressor still protects the
      // total, but the effects volume, ducking and stop() do not reach the loop.
      musicGain = context.createGain();
      musicGain.gain.value = canPlayMusic() ? musicLevel * musicLevel * (ducked ? 0.25 : 1) : 0;
      musicGain.connect(compressor);
      voiceContext = { sample };
      master.gain.value = canPlay() ? level * level * (ducked ? 0.3 : 1) : 0;
      // iOS moves the context to "interrupted" during a call and back; resolve waiters
      // the moment it runs again instead of trusting a resume() promise that may never settle.
      try { context.onstatechange = onStateChange; } catch { /* read-only in a fake */ }
      return context;
    } catch {
      try { Promise.resolve(context?.close()).catch(() => {}); } catch { /* unavailable */ }
      context = null; master = null; musicGain = null; voiceContext = null; buffers.clear(); musicBuffers.clear();
      return null;
    }
  }
  // Ask the context to run and resolve when it does (statechange or the resume promise),
  // or after RESUME_TIMEOUT_MS with the truth. WebKit only honours resume() issued inside a
  // user gesture, so every caller asks again rather than waiting on an earlier attempt.
  function unlock() {
    const c = getContext();
    if (!c) return Promise.resolve(false);
    if (c.state === 'running') return Promise.resolve(true);
    try { Promise.resolve(c.resume()).then(() => { if (c === context && c.state === 'running') settleUnlock(); }, () => {}); } catch { /* unavailable */ }
    return new Promise((resolve) => {
      unlockWaiters.push(resolve);
      if (!unlockTimer) unlockTimer = setTimeout(settleUnlock, RESUME_TIMEOUT_MS);
    });
  }
  // Resume and decode together; render only once the cue can actually sound.
  function prepare(name = null) {
    const c = getContext();
    if (!c) return Promise.resolve(false);
    const decoded = name ? decodeCue(c, CUE_SAMPLES[name]).then((ok) => { void decodeBank(c); return ok; }) : decodeBank(c);
    return Promise.all([unlock(), decoded]).then(([running, ok]) => running && ok && c === context);
  }
  function onVisibility() {
    if (hidden()) {
      stop(); mix();
      try { Promise.resolve(context?.suspend()).catch(() => {}); } catch { /* unavailable */ }
    } else {
      // Ask to run again (it works outside a gesture on most engines; a gesture will
      // repeat the request otherwise) and let the music gain climb back with a short fade.
      try { Promise.resolve(context?.resume()).then(() => { if (context?.state === 'running') settleUnlock(); }, () => {}); } catch { /* unavailable */ }
      mix(); syncMusic(0.4);
    }
  }
  function onGesture() {
    const c = getContext();
    if (!c) return;
    if (c.state !== 'running') { try { Promise.resolve(c.resume()).then(() => { if (c === context && c.state === 'running') settleUnlock(); }, () => {}); } catch { /* unavailable */ } }
    void decodeBank(c);
    syncMusic();
  }
  function tapTarget(event) {
    const target = event?.target;
    if (!target || typeof target.closest !== 'function') return null;
    try {
      const el = target.closest(TAP_SELECTOR);
      if (!el || el.closest(TAP_SKIP) || el.closest('[inert]')) return null;
      if (el.matches(':disabled') || el.matches('[aria-disabled="true"], [aria-busy="true"]')) return null;
      return el;
    } catch { return null; }
  }
  function onTap(event) {
    const el = tapTarget(event);
    if (!el) return;
    const wanted = (el.dataset && el.dataset.sound) || 'click';
    const name = ALIASES[wanted] || wanted;
    tap.pending = { name: RECIPES[name] ? name : 'click', at: Date.now() };
    tap.superseded = false;
    clearTimeout(tap.timer);
    // Handlers and the effects React flushes for a click run before this timeout; a cue
    // they play supersedes the click so one tap never sounds twice.
    tap.timer = setTimeout(() => {
      const pending = tap.pending;
      tap.pending = null;
      if (!pending || tap.superseded) return;
      play(pending.name, { source: 'tap' });
    }, 0);
  }
  function attach() {
    if (attached || typeof document === 'undefined') return;
    attached = true;
    void fetchBank();
    const c = getContext();
    if (c) void decodeBank(c);
    for (const type of GESTURE_EVENTS) document.addEventListener(type, onGesture, type.startsWith('touch') ? { capture: true, passive: true } : true);
    document.addEventListener('click', onTap, true);
    document.addEventListener('visibilitychange', onVisibility);
  }
  function dispose() {
    stop(); haltMusic(); buffers.clear(); decodes.clear(); musicBuffers.clear(); musicDecodes.clear(); bankDecode = null;
    clearTimeout(tap.timer); tap.pending = null;
    if (attached) {
      for (const type of GESTURE_EVENTS) document.removeEventListener(type, onGesture, true);
      document.removeEventListener('click', onTap, true);
      document.removeEventListener('visibilitychange', onVisibility);
      attached = false;
    }
    const c = context;
    context = null; master = null; musicGain = null; voiceContext = null; settleUnlock();
    try { Promise.resolve(c?.close()).catch(() => {}); } catch { /* already closed */ }
  }
  // A caller's own Web Audio recipe (Badeeha's question sounds) rendered inside this
  // context: `render(ctx)` receives a view of the context whose `destination` is the
  // master gain, so volume, ducking and the hidden-page mute apply to it as well.
  function synthContext(c) {
    return new Proxy(c, {
      get(target, key) {
        if (key === 'destination') return master;
        const value = target[key];
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  }
  function synth(render) {
    if (!canPlay() || typeof render !== 'function') return false;
    const c = getContext();
    if (!c) return false;
    const at = Date.now(), ordinal = ++seq;
    const run = () => {
      if (!canPlay() || voided(ordinal, at) || c !== context || c.state !== 'running') return;
      try { render(synthContext(c)); } catch { /* never break the game */ }
    };
    if (c.state === 'running') run();
    else void unlock().then((ok) => { if (ok) run(); });
    return true;
  }
  // `source: 'tap'` marks the delegate's own click; any other cue requested while a tap
  // click is pending replaces it, and one arriving shortly after cuts the click voice.
  function play(rawName, { source = 'code' } = {}) {
    const name = ALIASES[rawName] || rawName;
    if (!canPlay() || !RECIPES[name]) return false;
    const now = Date.now();
    const last = lastPlayed.get(name) ?? -Infinity;
    if (now - last < RETRIGGER_FLOOR_MS) return false;
    if (now - last < COOLDOWNS[name]) { if (!USER_CUES.has(name)) return false; cutVoice(lastVoice.get(name), 0.02); }
    const c = getContext();
    if (!c) return false;
    const ordinal = ++seq;
    if (source !== 'tap') {
      if (tap.pending) tap.superseded = true;
      if (tap.voice && tap.voice.name !== name && USER_CUES.has(name) && now - tap.voice.at < TAP_SUPERSEDE_MS) { cutVoice(tap.voice, TAP_FADE_S); tap.voice = null; }
    }
    const render = () => {
      if (!canPlay() || voided(ordinal, now) || c !== context || c.state !== 'running' || !ready(name)) return false;
      // The cooldown clock starts when the cue actually sounds, not when it was asked for.
      lastPlayed.set(name, Date.now());
      if (DUCKS[name]) duckFor(DUCKS[name], SAMPLE_BANK[CUE_SAMPLES[name]].frames / SAMPLE_RATE);
      let voice = null;
      try { voice = RECIPES[name](voiceContext, { name, requested: now, ordinal }); } catch { /* never break the game */ }
      if (source === 'tap') tap.voice = voice;
      return true;
    };
    if (c.state === 'running' && ready(name)) return render();
    void prepare(name).then((ok) => { if (ok && Date.now() - now < lateFor(name)) render(); });
    return true;
  }
  return {
    play,
    // Fetch and decode every cue ahead of the first play (tests, splash warm-up).
    preload() { return prepare(); },
    get enabled() { return on; },
    get volume() { return level; },
    get ready() { return ready(); },
    enable(value) { on = !!value; if (!on) stop(); mix(); syncMusic(); },
    setVolume(value) { level = clampVolume(value); if (!level) stop(); mix(); },
    setDucking(value) { ducked = !!value; mix(); },
    attach, dispose, stop, unlock, synth,
    names: [...Object.keys(RECIPES), ...Object.keys(ALIASES)],
    // Background music: `play(id)` names the track a screen wants (it starts on the next
    // gesture if the browser has not unlocked audio yet and crossfades from the current
    // one), `stop()` fades out, `sting(id, { after })` plays a one-shot over silence.
    music: {
      play(id) {
        const next = MUSIC_BANK[id] ? id : null;
        if (next === musicWanted) { syncMusic(); return; }
        musicWanted = next;
        syncMusic();
        if (next) void Promise.resolve(bankDecode).then(() => fetchTrack('finale'));
      },
      stop() { musicWanted = null; syncMusic(); },
      sting: playSting,
      prefetch(id) { return fetchTrack(id).then((data) => !!data); },
      enable(value) { musicOn = !!value; syncMusic(); },
      setVolume(value) { musicLevel = clampVolume(value, 0.5); syncMusic(); },
      get enabled() { return musicOn; },
      get volume() { return musicLevel; },
      get current() { return playing?.id ?? null; },
      get wanted() { return musicWanted; },
      get stingId() { return sting?.id ?? null; },
      names: Object.keys(MUSIC_BANK),
    },
  };
}

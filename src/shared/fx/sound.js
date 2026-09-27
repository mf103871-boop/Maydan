import { SAMPLE_BANK, SAMPLE_RATE } from './sample-bank.js';
import { MUSIC_BANK } from './music-bank.js';

// Maydan's cue bank: sixteen mastered AAC files (scripts/audio/build.mjs), in-house
// designs and cues from licensed libraries alike, all tuned to D so they sit inside the
// music (assets/audio/maydan-v3/provenance.json records where each came from). They are
// fetched once (the service worker precaches them, the iOS shell bundles them) and decoded
// on the first gesture; each public cue name maps to exactly one mastered file.
export const CUE_SAMPLES = {
  click: 'click', pop: 'pop', tick: 'tick', tickFast: 'tickFast', correct: 'correct', wrong: 'wrong',
  buzzer: 'buzzer', whoosh: 'whoosh', fanfare: 'win', explosion: 'explosion', drumroll: 'drumroll',
  countdown: 'countdown', countdownGo: 'start', reveal: 'reveal', pass: 'pass', timeout: 'timeout',
};
export const RECIPES = Object.fromEntries(Object.entries(CUE_SAMPLES).map(([name, id]) => [name, (c) => c.sample(id)]));

const clampVolume = (value, fallback = 0.75) => typeof value === 'number' && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : fallback;
const COOLDOWNS = { click: 65, pop: 70, tick: 100, tickFast: 100, countdown: 120, correct: 150, wrong: 180,
  buzzer: 300, whoosh: 100, fanfare: 500, explosion: 400, drumroll: 1250, countdownGo: 180, reveal: 160, timeout: 300 };
const ALIASES = { open: 'whoosh', steal: 'correct', win: 'fanfare', start: 'countdownGo', tool: 'reveal', scoreUp: 'pop', scoreDown: 'wrong' };
// A cue that arrives while the bank is still decoding may play a little late; a
// cue this old belongs to a moment that has passed.
const LATE_CUE_MS = 400;
const RESUME_TIMEOUT_MS = 1500;
const CUE_IDS = Object.keys(SAMPLE_BANK);
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
  let generation = 0;
  let ducked = false;
  let resumePromise = null;
  let bankPromise = null;
  let decodePromise = null;
  const encoded = new Map();
  const buffers = new Map();
  const voices = new Set();
  const lastPlayed = new Map();
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
  const audible = () => canPlay() || canPlayMusic();
  const ready = () => CUE_IDS.every((id) => buffers.has(id));

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
  function stop() {
    generation += 1;
    lastPlayed.clear();
    for (const voice of [...voices]) {
      try { voice.source.stop(); } catch { /* already ended */ }
      voice.cleanup();
    }
  }
  function track(source, nodes) {
    if (voices.size >= 20) {
      const oldest = voices.values().next().value;
      try { oldest.source.stop(); } catch { /* ended */ }
      oldest.cleanup();
    }
    const voice = { source, cleanup() {
      voices.delete(voice);
      source.onended = null;
      for (const node of nodes) { try { node.disconnect(); } catch { /* disconnected */ } }
    } };
    voices.add(voice);
    source.onended = voice.cleanup;
  }
  // The encoded files need no AudioContext, so they are fetched as soon as the bus
  // attaches; the first gesture then only has to decode ~100 KB.
  function fetchBank() {
    if (bankPromise) return bankPromise;
    if (typeof fetch !== 'function') return Promise.resolve(false);
    bankPromise = Promise.all(CUE_IDS.map(async (id) => {
      if (encoded.has(id)) return;
      const response = await fetch(SAMPLE_BANK[id].url);
      if (!response || !response.ok) throw new Error('cue unavailable');
      encoded.set(id, await response.arrayBuffer());
    })).then(() => true, () => { bankPromise = null; return false; });
    return bankPromise;
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
  function decodeBank(c) {
    if (decodePromise) return decodePromise;
    const task = fetchBank().then(async (fetched) => {
      if (!fetched || c !== context) return false;
      await Promise.all(CUE_IDS.map(async (id) => {
        if (buffers.has(id)) return;
        // decodeAudioData detaches its input; hand each context a copy.
        const buffer = await decode(c, encoded.get(id).slice(0));
        if (c === context) buffers.set(id, buffer);
      }));
      return c === context && ready();
    }).catch(() => false);
    decodePromise = task;
    void task.finally(() => { if (decodePromise === task) decodePromise = null; });
    return task;
  }
  function sample(id, { at = 0, gain = 1, rate = 1 } = {}) {
    const buffer = buffers.get(id);
    if (!buffer) return;
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = rate;
    const voiceGain = context.createGain();
    voiceGain.gain.value = gain;
    source.connect(voiceGain);
    voiceGain.connect(master);
    track(source, [source, voiceGain]);
    source.start(context.currentTime + at);
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
    const task = fetchTrack(id).then(async (data) => {
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
  function getContext() {
    if (context && context.state !== 'closed') return context;
    try {
      const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
      if (!AC) return null;
      stop(); haltMusic(); buffers.clear(); musicBuffers.clear(); musicDecodes.clear(); resumePromise = null; decodePromise = null;
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
      return context;
    } catch {
      try { Promise.resolve(context?.close()).catch(() => {}); } catch { /* unavailable */ }
      context = null; master = null; musicGain = null; voiceContext = null; buffers.clear(); musicBuffers.clear();
      return null;
    }
  }
  function unlock() {
    if (!audible()) return Promise.resolve(false);
    const c = getContext();
    if (!c) return Promise.resolve(false);
    if (c.state === 'running') return Promise.resolve(true);
    // iOS can become "interrupted" after a call. Retain gesture listeners
    // so every return to the app can recover instead of unlocking only once.
    // A resume() that never settles (WebKit outside a gesture) must not pin the
    // shared promise forever, or later gestures could never try again.
    if (!resumePromise) {
      try {
        let timer = null;
        const attempt = Promise.resolve(c.resume()).then(() => c.state === 'running', () => false);
        const deadline = new Promise((resolve) => { timer = setTimeout(() => resolve(c.state === 'running'), RESUME_TIMEOUT_MS); });
        const pending = Promise.race([attempt, deadline]);
        resumePromise = pending;
        void pending.finally(() => { clearTimeout(timer); if (resumePromise === pending) resumePromise = null; });
      } catch { return Promise.resolve(false); }
    }
    return resumePromise;
  }
  // Fetch, resume and decode together; render only once the cue can actually sound.
  function prepare() {
    const c = getContext();
    if (!c) return Promise.resolve(false);
    return Promise.all([unlock(), decodeBank(c)]).then(([running, decoded]) => running && decoded && c === context);
  }
  function onVisibility() {
    if (hidden()) {
      stop(); mix();
      try { Promise.resolve(context?.suspend()).catch(() => {}); } catch { /* unavailable */ }
    } else {
      // The music gain climbs back on the audio clock, which only moves again once a
      // gesture resumes the context: the loop returns with a short fade, not a jolt.
      mix(); syncMusic(0.4);
    }
  }
  function onGesture() {
    if (!audible()) return;
    const c = getContext();
    if (!c) return;
    // WebKit only honours resume() issued inside a user gesture: call it here even
    // while an earlier attempt is still pending.
    if (c.state !== 'running') { try { Promise.resolve(c.resume()).catch(() => {}); } catch { /* unavailable */ } }
    if (canPlay()) void prepare();
    syncMusic();
  }
  function attach() {
    if (attached || typeof document === 'undefined') return;
    attached = true;
    void fetchBank();
    document.addEventListener('pointerdown', onGesture, true);
    document.addEventListener('touchstart', onGesture, { capture: true, passive: true });
    document.addEventListener('keydown', onGesture, true);
    document.addEventListener('visibilitychange', onVisibility);
  }
  function dispose() {
    stop(); haltMusic(); buffers.clear(); musicBuffers.clear(); musicDecodes.clear(); decodePromise = null;
    if (attached) {
      document.removeEventListener('pointerdown', onGesture, true);
      document.removeEventListener('touchstart', onGesture, true);
      document.removeEventListener('keydown', onGesture, true);
      document.removeEventListener('visibilitychange', onVisibility);
      attached = false;
    }
    const c = context;
    context = null; master = null; musicGain = null; voiceContext = null; resumePromise = null;
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
    if (!canPlay() || typeof render !== 'function') return;
    const c = getContext();
    if (!c) return;
    const token = generation;
    const run = () => {
      if (!canPlay() || token !== generation || c !== context || c.state !== 'running') return;
      try { render(synthContext(c)); } catch { /* never break the game */ }
    };
    if (c.state === 'running') run();
    else void unlock().then((ok) => { if (ok) run(); });
  }
  return {
    play(name) {
      name = ALIASES[name] || name;
      if (!canPlay() || !RECIPES[name]) return;
      const now = Date.now();
      if (now - (lastPlayed.get(name) ?? -Infinity) < (COOLDOWNS[name] || 80)) return;
      const c = getContext();
      if (!c) return;
      lastPlayed.set(name, now);
      if (DUCKS[name]) duckFor(DUCKS[name], SAMPLE_BANK[CUE_SAMPLES[name]].frames / SAMPLE_RATE);
      const token = generation;
      const render = () => {
        if (!canPlay() || token !== generation || c !== context || c.state !== 'running' || !ready()) return;
        try { RECIPES[name](voiceContext); } catch { /* never break the game */ }
      };
      if (c.state === 'running' && ready()) render();
      else void prepare().then((ok) => { if (ok && Date.now() - now < LATE_CUE_MS) render(); });
    },
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
        if (next) void fetchTrack('finale');
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

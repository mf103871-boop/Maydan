import { SAMPLE_BANK } from './sample-bank.js';

// Approved option A, with a +6 dB tap master. The cues are small AAC files fetched
// once (the service worker precaches them, the iOS shell bundles them) and decoded
// on the first gesture, instead of 2.8 MB of PCM parsed on every cold start.
export const RECIPES = {
  click: (c) => c.sample('tap'),
  pop: (c) => c.sample('tap', { gain: 0.9 }),
  tick: (c) => c.sample('tap', { gain: 0.16 }),
  tickFast: (c) => c.sample('tap', { gain: 0.25 }),
  correct: (c) => c.sample('correct'),
  wrong: (c) => c.sample('wrong'),
  buzzer: (c) => c.sample('wrong'),
  whoosh: (c) => c.sample('reveal', { gain: 0.55 }),
  fanfare: (c) => c.sample('win'),
  explosion: (c) => {
    c.sample('wrong');
    c.sample('tap', { at: 0.12, gain: 0.5 });
  },
  drumroll: (c) => {
    [0, 0.23, 0.44, 0.63, 0.8, 0.95, 1.08, 1.19].forEach((at, i) => {
      c.sample('tap', { at, gain: 0.14 + i * 0.025 });
    });
  },
  countdown: (c) => c.sample('tap', { gain: 0.45 }),
  countdownGo: (c) => c.sample('start'),
  reveal: (c) => c.sample('reveal'),
  pass: (c) => c.sample('tap', { gain: 0.65 }),
  timeout: (c) => c.sample('wrong'),
};

const clampVolume = (value) => typeof value === 'number' && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0.75;
const COOLDOWNS = { click: 65, pop: 70, tick: 100, tickFast: 100, countdown: 120, correct: 150, wrong: 180,
  buzzer: 300, whoosh: 100, fanfare: 500, explosion: 400, drumroll: 1250, countdownGo: 180, reveal: 160, timeout: 300 };
const ALIASES = { open: 'whoosh', steal: 'correct', win: 'fanfare', start: 'countdownGo', tool: 'reveal', scoreUp: 'pop', scoreDown: 'wrong' };
// A cue that arrives while the bank is still decoding may play a little late; a
// cue this old belongs to a moment that has passed.
const LATE_CUE_MS = 400;
const RESUME_TIMEOUT_MS = 1500;
const CUE_IDS = Object.keys(SAMPLE_BANK);

export function createSound({ enabled = true, volume = 0.75 } = {}) {
  let on = !!enabled;
  let level = clampVolume(volume);
  let context = null;
  let master = null;
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
  const hidden = () => typeof document !== 'undefined' && document.hidden;
  const canPlay = () => on && level > 0 && !hidden();
  const ready = () => CUE_IDS.every((id) => buffers.has(id));

  function mix() {
    if (!master || !context) return;
    const gain = canPlay() ? level * level * (ducked ? 0.3 : 1) : 0;
    try { master.gain.setTargetAtTime(gain, context.currentTime, 0.012); } catch { master.gain.value = gain; }
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
  function getContext() {
    if (context && context.state !== 'closed') return context;
    try {
      const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
      if (!AC) return null;
      stop(); buffers.clear(); resumePromise = null; decodePromise = null;
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
      voiceContext = { sample };
      master.gain.value = canPlay() ? level * level * (ducked ? 0.3 : 1) : 0;
      return context;
    } catch {
      try { Promise.resolve(context?.close()).catch(() => {}); } catch { /* unavailable */ }
      context = null; master = null; voiceContext = null; buffers.clear();
      return null;
    }
  }
  function unlock() {
    if (!canPlay()) return Promise.resolve(false);
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
    } else mix();
  }
  function onGesture() {
    if (!canPlay()) return;
    const c = getContext();
    if (!c) return;
    // WebKit only honours resume() issued inside a user gesture: call it here even
    // while an earlier attempt is still pending.
    if (c.state !== 'running') { try { Promise.resolve(c.resume()).catch(() => {}); } catch { /* unavailable */ } }
    void prepare();
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
    stop(); buffers.clear(); decodePromise = null;
    if (attached) {
      document.removeEventListener('pointerdown', onGesture, true);
      document.removeEventListener('touchstart', onGesture, true);
      document.removeEventListener('keydown', onGesture, true);
      document.removeEventListener('visibilitychange', onVisibility);
      attached = false;
    }
    const c = context;
    context = null; master = null; voiceContext = null; resumePromise = null;
    try { Promise.resolve(c?.close()).catch(() => {}); } catch { /* already closed */ }
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
    enable(value) { on = !!value; if (!on) stop(); mix(); },
    setVolume(value) { level = clampVolume(value); if (!level) stop(); mix(); },
    setDucking(value) { ducked = !!value; mix(); },
    attach, dispose, stop, unlock,
    names: [...Object.keys(RECIPES), ...Object.keys(ALIASES)],
  };
}

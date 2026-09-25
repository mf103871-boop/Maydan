import { BUBBLE_BANK, BUBBLE_RATE } from './bubble-bank.js';

// Approved cartoon bubble samples, embedded for instant offline playback.
const TAPS = ['tap', 'tap-2', 'tap-3'];
export const RECIPES = {
  click: (c) => c.sample(c.nextTap()),
  pop: (c) => c.sample('tap-3', { gain: 0.9 }),
  tick: (c) => c.sample('tap-2', { gain: 0.32, rate: 0.94 }),
  tickFast: (c) => c.sample('tap', { gain: 0.42, rate: 1.08 }),
  correct: (c) => c.sample('correct'),
  wrong: (c) => c.sample('wrong'),
  buzzer: (c) => c.sample('wrong', { rate: 0.9 }),
  whoosh: (c) => c.sample('reveal', { gain: 0.65, rate: 1.1 }),
  fanfare: (c) => c.sample('win'),
  explosion: (c) => {
    c.sample('wrong', { rate: 0.85 });
    c.sample('tap-3', { at: 0.12, gain: 0.6, rate: 0.8 });
  },
  drumroll: (c) => {
    [0, 0.23, 0.44, 0.63, 0.8, 0.95, 1.08, 1.19].forEach((at, i) => {
      c.sample(TAPS[i % TAPS.length], { at, gain: 0.28 + i * 0.035, rate: 0.9 + i * 0.035 });
    });
  },
  countdown: (c) => c.sample('tap-3', { gain: 0.55, rate: 0.9 }),
  countdownGo: (c) => c.sample('correct'),
  reveal: (c) => c.sample('reveal'),
  pass: (c) => c.sample('tap-3', { gain: 0.7, rate: 0.85 }),
  timeout: (c) => c.sample('wrong', { rate: 0.9 }),
};

const clampVolume = (value) => typeof value === 'number' && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0.75;
const COOLDOWNS = { click: 65, pop: 70, tick: 100, tickFast: 100, countdown: 120, correct: 150, wrong: 180,
  buzzer: 300, whoosh: 100, fanfare: 500, explosion: 400, drumroll: 1250, countdownGo: 180, reveal: 160, timeout: 300 };
const ALIASES = { open: 'whoosh', steal: 'correct', win: 'fanfare', start: 'countdownGo', tool: 'reveal', scoreUp: 'pop', scoreDown: 'wrong' };

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
  let tapIndex = 0;
  const buffers = new Map();
  const voices = new Set();
  const lastPlayed = new Map();
  const hidden = () => typeof document !== 'undefined' && document.hidden;
  const canPlay = () => on && level > 0 && !hidden();

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
  function bufferFor(id) {
    if (buffers.has(id)) return buffers.get(id);
    const entry = BUBBLE_BANK[id];
    const bytes = atob(entry.pcm);
    const buffer = context.createBuffer(2, entry.frames, BUBBLE_RATE);
    const channels = [buffer.getChannelData(0), buffer.getChannelData(1)];
    for (let frame = 0, offset = 0; frame < entry.frames; frame += 1) {
      for (let channel = 0; channel < 2; channel += 1, offset += 3) {
        const value = bytes.charCodeAt(offset) | (bytes.charCodeAt(offset + 1) << 8) | (bytes.charCodeAt(offset + 2) << 16);
        channels[channel][frame] = ((value << 8) >> 8) / 8388608;
      }
    }
    buffers.set(id, buffer);
    return buffer;
  }
  function sample(id, { at = 0, gain = 1, rate = 1 } = {}) {
    const buffer = bufferFor(id);
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
      stop(); buffers.clear(); resumePromise = null;
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
      voiceContext = { sample, nextTap: () => TAPS[tapIndex++ % TAPS.length] };
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
    if (!resumePromise) {
      try {
        const pending = Promise.resolve(c.resume()).then(() => c.state === 'running', () => false);
        resumePromise = pending;
        void pending.finally(() => { if (resumePromise === pending) resumePromise = null; });
      } catch { return Promise.resolve(false); }
    }
    return resumePromise;
  }
  function onVisibility() {
    if (hidden()) {
      stop(); mix();
      try { Promise.resolve(context?.suspend()).catch(() => {}); } catch { /* unavailable */ }
    } else mix();
  }
  function onGesture() { void unlock(); }
  function attach() {
    if (attached || typeof document === 'undefined') return;
    attached = true;
    document.addEventListener('pointerdown', onGesture, true);
    document.addEventListener('touchstart', onGesture, { capture: true, passive: true });
    document.addEventListener('keydown', onGesture, true);
    document.addEventListener('visibilitychange', onVisibility);
  }
  function dispose() {
    stop(); buffers.clear();
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
        if (!canPlay() || token !== generation || c !== context || c.state !== 'running') return;
        try { RECIPES[name](voiceContext); } catch { /* never break the game */ }
      };
      if (c.state === 'running') render();
      else void unlock().then((ready) => { if (ready && Date.now() - now < 180) render(); });
    },
    get enabled() { return on; },
    get volume() { return level; },
    enable(value) { on = !!value; if (!on) stop(); mix(); },
    setVolume(value) { level = clampVolume(value); if (!level) stop(); mix(); },
    setDucking(value) { ducked = !!value; mix(); },
    attach, dispose, stop, unlock,
    names: [...Object.keys(RECIPES), ...Object.keys(ALIASES)],
  };
}

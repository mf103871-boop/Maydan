// Gesture-unlocked Web Audio mixer. Voices feed a master gain + compressor.
// Muting cancels scheduled cues instead of freezing them until the next unmute.

function tone(c, { f = 440, f2 = null, t = 0, d = 0.2, type = 'sine', v = 0.1, a = 0.008 } = {}) {
  const o = c.createOscillator();
  const g = c.createGain();
  const T = c.currentTime + t;
  o.type = type;
  o.frequency.setValueAtTime(f, T);
  if (f2) o.frequency.exponentialRampToValueAtTime(Math.max(20, f2), T + d);
  g.gain.setValueAtTime(0.0001, T);
  g.gain.exponentialRampToValueAtTime(v, T + a);
  g.gain.exponentialRampToValueAtTime(0.0001, T + d);
  c.track(o, [o, g]);
  o.connect(g);
  g.connect(c.destination);
  o.start(T);
  o.stop(T + d + 0.05);
}

function noise(c, { t = 0, d = 0.3, v = 0.1, lp = null, hp = null, a = 0.005 } = {}) {
  const T = c.currentTime + t;
  const source = c.createBufferSource();
  source.buffer = c.noiseBuffer;
  source.loop = true;
  const nodes = [source];
  let node = source;
  if (lp) {
    const filter = c.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = lp;
    nodes.push(filter);
    node.connect(filter);
    node = filter;
  }
  if (hp) {
    const filter = c.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = hp;
    nodes.push(filter);
    node.connect(filter);
    node = filter;
  }
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, T);
  g.gain.exponentialRampToValueAtTime(v, T + a);
  g.gain.setValueAtTime(v, T + Math.max(a, d - 0.05));
  g.gain.exponentialRampToValueAtTime(0.0001, T + d);
  c.track(source, [...nodes, g]);
  node.connect(g);
  g.connect(c.destination);
  source.start(T);
  source.stop(T + d + 0.05);
}

export const RECIPES = {
  click: (c) => tone(c, { f: 720, f2: 980, d: 0.05, v: 0.03, type: 'sine' }),
  pop: (c) => tone(c, { f: 520, f2: 880, d: 0.09, v: 0.05, type: 'triangle' }),
  tick: (c) => tone(c, { f: 1320, f2: 1180, d: 0.045, v: 0.045, type: 'triangle' }),
  tickFast: (c) => tone(c, { f: 1650, f2: 1400, d: 0.04, v: 0.045, type: 'triangle' }),
  correct: (c) =>
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(c, { f, t: i * 0.075, d: i === 3 ? 0.55 : 0.28, v: 0.065, type: 'triangle' })),
  wrong: (c) => {
    tone(c, { f: 246.94, f2: 174.61, d: 0.34, v: 0.06, type: 'triangle' });
    tone(c, { f: 196, f2: 130.81, t: 0.11, d: 0.42, v: 0.05, type: 'sine' });
  },
  buzzer: (c) => {
    tone(c, { f: 180, d: 0.4, v: 0.07, type: 'triangle', a: 0.008 });
    tone(c, { f: 120, d: 0.4, v: 0.045, type: 'sine', a: 0.008 });
  },
  whoosh: (c) => noise(c, { d: 0.32, v: 0.06, hp: 900, lp: 5000, a: 0.04 }),
  fanfare: (c) => {
    [523.25, 659.25, 783.99, 1046.5, 1318.51].forEach((f, i) => tone(c, { f, t: i * 0.13, d: i === 4 ? 0.95 : 0.38, v: 0.07, type: 'triangle' }));
    noise(c, { t: 0.44, d: 0.55, v: 0.02, hp: 2800, a: 0.03 });
  },
  explosion: (c) => {
    noise(c, { d: 0.65, v: 0.12, lp: 900, a: 0.008 });
    noise(c, { d: 0.25, v: 0.07, hp: 1200, a: 0.008 });
    tone(c, { f: 110, f2: 32, d: 0.6, v: 0.1, type: 'triangle', a: 0.008 });
  },
  drumroll: (c) => {
    for (let i = 0; i < 28; i += 1) noise(c, { t: i * 0.055, d: 0.04, v: 0.05 + (i / 28) * 0.08, lp: 700 });
    noise(c, { t: 1.6, d: 0.35, v: 0.14, hp: 2000 });
  },
  countdown: (c) => tone(c, { f: 880, d: 0.14, v: 0.055, type: 'sine' }),
  countdownGo: (c) => tone(c, { f: 1320, f2: 1760, d: 0.45, v: 0.07, type: 'triangle' }),
  reveal: (c) => [392, 523.25, 783.99].forEach((f, i) => tone(c, { f, t: i * 0.075, d: 0.3, v: 0.05 })),
  pass: (c) => tone(c, { f: 660, f2: 330, d: 0.22, v: 0.05, type: 'triangle' }),
  timeout: (c) => [0, 0.28].forEach((t, i) => tone(c, { f: i ? 146.83 : 196, f2: i ? 98 : 130.81, t, d: 0.42, v: 0.06, type: 'triangle' })),
};

const clampVolume = (value) => typeof value === 'number' && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0.75;
const COOLDOWNS = { click: 45, pop: 45, tick: 80, tickFast: 80, countdown: 120 };
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
    if (voices.size >= 96) {
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
  function getContext() {
    if (context && context.state !== 'closed') return context;
    try {
      const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
      if (!AC) return null;
      context = new AC({ latencyHint: 'interactive' });
      master = context.createGain();
      const compressor = context.createDynamicsCompressor();
      compressor.threshold.value = -18;
      compressor.knee.value = 12;
      compressor.ratio.value = 5;
      compressor.attack.value = 0.003;
      compressor.release.value = 0.18;
      master.connect(compressor);
      compressor.connect(context.destination);
      const noiseBuffer = context.createBuffer(1, context.sampleRate, context.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
      voiceContext = {
        get currentTime() { return context.currentTime; },
        destination: master, noiseBuffer, track,
        createOscillator: () => context.createOscillator(),
        createGain: () => context.createGain(),
        createBufferSource: () => context.createBufferSource(),
        createBiquadFilter: () => context.createBiquadFilter(),
      };
      master.gain.value = canPlay() ? level * level : 0;
      return context;
    } catch {
      try { Promise.resolve(context?.close()).catch(() => {}); } catch { /* unavailable */ }
      context = null; master = null; voiceContext = null;
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
    stop();
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
      if (now - (lastPlayed.get(name) ?? -Infinity) < (COOLDOWNS[name] || 30)) return;
      lastPlayed.set(name, now);
      const c = getContext();
      if (!c) return;
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

// صوت المنصة: مُصنَّع بالكامل بـ WebAudio (مذبذبات + ضجيج)، بلا ملفات صوت.
// يُفتح السياق الصوتي عند أول لمسة (iOS يمنعه قبلها)، والكتم محفوظ في الإعدادات.
let context = null;

function getContext() {
  try {
    const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
    if (!AC) return null;
    if (!context) context = new AC();
    if (context.state === 'suspended') context.resume().catch(() => {});
    return context;
  } catch (error) {
    return null;
  }
}

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
  o.connect(g);
  g.connect(c.destination);
  o.start(T);
  o.stop(T + d + 0.05);
}

function noise(c, { t = 0, d = 0.3, v = 0.1, lp = null, hp = null, a = 0.005 } = {}) {
  const T = c.currentTime + t;
  const buffer = c.createBuffer(1, Math.ceil(c.sampleRate * d), c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
  const source = c.createBufferSource();
  source.buffer = buffer;
  let node = source;
  if (lp) {
    const filter = c.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = lp;
    node.connect(filter);
    node = filter;
  }
  if (hp) {
    const filter = c.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = hp;
    node.connect(filter);
    node = filter;
  }
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, T);
  g.gain.exponentialRampToValueAtTime(v, T + a);
  g.gain.setValueAtTime(v, T + Math.max(a, d - 0.05));
  g.gain.exponentialRampToValueAtTime(0.0001, T + d);
  node.connect(g);
  g.connect(c.destination);
  source.start(T);
  source.stop(T + d + 0.05);
}

export const RECIPES = {
  click: (c) => tone(c, { f: 720, f2: 980, d: 0.05, v: 0.03, type: 'sine' }),
  pop: (c) => tone(c, { f: 520, f2: 880, d: 0.09, v: 0.05, type: 'triangle' }),
  tick: (c) => tone(c, { f: 1320, f2: 1180, d: 0.045, v: 0.045, type: 'triangle' }),
  tickFast: (c) => tone(c, { f: 1650, f2: 1400, d: 0.04, v: 0.06, type: 'square' }),
  correct: (c) =>
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(c, { f, t: i * 0.075, d: i === 3 ? 0.55 : 0.28, v: 0.065, type: 'triangle' })),
  wrong: (c) => {
    tone(c, { f: 246.94, f2: 174.61, d: 0.34, v: 0.06, type: 'triangle' });
    tone(c, { f: 196, f2: 130.81, t: 0.11, d: 0.42, v: 0.05, type: 'sine' });
  },
  buzzer: (c) => {
    tone(c, { f: 180, d: 0.55, v: 0.12, type: 'sawtooth', a: 0.004 });
    tone(c, { f: 120, d: 0.55, v: 0.1, type: 'square', a: 0.004 });
  },
  whoosh: (c) => noise(c, { d: 0.32, v: 0.06, hp: 900, lp: 5000, a: 0.04 }),
  fanfare: (c) => {
    [523.25, 659.25, 783.99, 1046.5, 1318.51].forEach((f, i) => tone(c, { f, t: i * 0.13, d: i === 4 ? 0.95 : 0.38, v: 0.07, type: 'triangle' }));
    noise(c, { t: 0.44, d: 0.55, v: 0.02, hp: 2800, a: 0.03 });
  },
  explosion: (c) => {
    noise(c, { d: 0.9, v: 0.22, lp: 900, a: 0.003 });
    noise(c, { d: 0.35, v: 0.14, hp: 1200, a: 0.002 });
    tone(c, { f: 110, f2: 32, d: 0.8, v: 0.22, type: 'sawtooth', a: 0.003 });
  },
  drumroll: (c) => {
    for (let i = 0; i < 28; i += 1) noise(c, { t: i * 0.055, d: 0.04, v: 0.05 + (i / 28) * 0.08, lp: 700 });
    noise(c, { t: 1.6, d: 0.35, v: 0.14, hp: 2000 });
  },
  countdown: (c) => tone(c, { f: 880, d: 0.14, v: 0.07, type: 'square' }),
  countdownGo: (c) => tone(c, { f: 1320, f2: 1760, d: 0.45, v: 0.08, type: 'square' }),
  reveal: (c) => [392, 523.25, 783.99].forEach((f, i) => tone(c, { f, t: i * 0.075, d: 0.3, v: 0.05 })),
  pass: (c) => tone(c, { f: 660, f2: 330, d: 0.22, v: 0.05, type: 'triangle' }),
  timeout: (c) => [0, 0.28].forEach((t, i) => tone(c, { f: i ? 146.83 : 196, f2: i ? 98 : 130.81, t, d: 0.42, v: 0.06, type: 'triangle' })),
};

export function createSound({ enabled = true } = {}) {
  let on = enabled;
  let unlocked = false;

  function unlock() {
    const c = getContext();
    if (!c) return;
    if (!unlocked) {
      unlocked = true;
      // A silent, near-zero-length tone counts as user-gesture playback on iOS.
      try {
        tone(c, { f: 440, d: 0.01, v: 0.0001 });
      } catch (error) {
        // ignore
      }
    }
  }

  if (typeof document !== 'undefined') {
    const once = () => {
      unlock();
      document.removeEventListener('pointerdown', once, true);
      document.removeEventListener('touchstart', once, true);
      document.removeEventListener('keydown', once, true);
    };
    document.addEventListener('pointerdown', once, true);
    document.addEventListener('touchstart', once, true);
    document.addEventListener('keydown', once, true);
  }

  return {
    play(name) {
      if (!on) return;
      const recipe = RECIPES[name];
      if (!recipe) return;
      const c = getContext();
      if (!c) return;
      try {
        recipe(c);
      } catch (error) {
        // never let audio break the game
      }
    },
    get enabled() {
      return on;
    },
    enable(value) {
      on = !!value;
      try {
        if (!on && context && context.state === 'running') context.suspend();
        if (on && context && context.state === 'suspended') context.resume();
      } catch (error) {
        // ignore
      }
    },
    unlock,
    names: Object.keys(RECIPES),
  };
}

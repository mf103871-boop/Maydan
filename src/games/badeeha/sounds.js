// مؤثرات بَديهة المركّبة بـWeb Audio: احتياط حين لا يتوفر ناقل صوت المنصة (المعاينات والاختبارات).
let _ctx = null;
const getCtx = () => {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      return AC
        ? ((_ctx = _ctx || new AC()), _ctx.state === "suspended" && _ctx.resume(), _ctx)
        : null;
    } catch (e) {
      return null;
    }
  },
  tone = (c, { f = 440, f2 = null, t = 0, d = 0.2, type = "sine", v = 0.12, a = 0.01 }) => {
    const o = c.createOscillator(),
      g = c.createGain(),
      T = c.currentTime + t;
    ((o.type = type),
      o.frequency.setValueAtTime(f, T),
      f2 && o.frequency.exponentialRampToValueAtTime(f2, T + d),
      g.gain.setValueAtTime(1e-4, T),
      g.gain.exponentialRampToValueAtTime(v, T + a),
      g.gain.exponentialRampToValueAtTime(1e-4, T + d),
      o.connect(g),
      g.connect(c.destination),
      o.start(T),
      o.stop(T + d + 0.05));
  },
  noise = (c, { t = 0, d = 0.3, v = 0.1, lp = null, hp = null, a = 0.005, chop = null }) => {
    const T = c.currentTime + t,
      buf = c.createBuffer(1, Math.ceil(c.sampleRate * d), c.sampleRate),
      data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const src = c.createBufferSource();
    src.buffer = buf;
    let node = src;
    if (lp) {
      const f = c.createBiquadFilter();
      ((f.type = "lowpass"), (f.frequency.value = lp), node.connect(f), (node = f));
    }
    if (hp) {
      const f = c.createBiquadFilter();
      ((f.type = "highpass"), (f.frequency.value = hp), node.connect(f), (node = f));
    }
    const g = c.createGain();
    if ((g.gain.setValueAtTime(1e-4, T), g.gain.exponentialRampToValueAtTime(v, T + a), chop)) {
      const step = 1 / chop;
      for (let x = a; x < d - step; x += step)
        (g.gain.setValueAtTime(v, T + x), g.gain.setValueAtTime(v * 0.12, T + x + step * 0.5));
    }
    (g.gain.setValueAtTime(v, T + Math.max(a, d - 0.05)),
      g.gain.exponentialRampToValueAtTime(1e-4, T + d),
      node.connect(g),
      g.connect(c.destination),
      src.start(T),
      src.stop(T + d + 0.05));
  },
  SFX = {
    click: (c) => tone(c, { f: 900, d: 0.05, v: 0.05, type: "triangle" }),
    tick: (c) => tone(c, { f: 1400, d: 0.04, v: 0.06 }),
    open: (c) => {
      (noise(c, { d: 0.35, v: 0.05, hp: 900 }),
        tone(c, { f: 300, f2: 700, d: 0.35, v: 0.08, type: "triangle" }));
    },
    reveal: (c) => {
      (tone(c, { f: 520, d: 0.12, v: 0.08 }), tone(c, { f: 780, t: 0.1, d: 0.2, v: 0.08 }));
    },
    correct: (c) =>
      [523, 659, 784, 1047].forEach((f, i) =>
        tone(c, { f, t: i * 0.09, d: 0.28, v: 0.1, type: "triangle" }),
      ),
    steal: (c) =>
      [392, 523, 784, 1047].forEach((f, i) =>
        tone(c, { f, t: i * 0.07, d: 0.22, v: 0.08, type: "square" }),
      ),
    wrong: (c) => {
      (tone(c, { f: 220, f2: 110, d: 0.4, v: 0.1, type: "sawtooth" }),
        tone(c, { f: 165, f2: 82, t: 0.15, d: 0.45, v: 0.08, type: "sawtooth" }));
    },
    timeout: (c) => {
      (tone(c, { f: 150, d: 0.5, v: 0.12, type: "square" }),
        tone(c, { f: 100, t: 0.5, d: 0.6, v: 0.12, type: "square" }));
    },
    tool: (c) =>
      [880, 1175, 1760, 2349].forEach((f, i) => tone(c, { f, t: i * 0.05, d: 0.16, v: 0.06 })),
    win: (c) =>
      [0, 0.15, 0.3, 0.45, 0.6, 0.8].forEach((t, i) =>
        tone(c, {
          f: [523, 523, 523, 659, 784, 1047][i],
          t,
          d: i === 5 ? 0.9 : 0.18,
          v: 0.1,
          type: "triangle",
        }),
      ),
    start: (c) => {
      (noise(c, { d: 0.5, v: 0.04, hp: 500 }),
        [392, 523, 659, 784].forEach((f, i) =>
          tone(c, { f, t: i * 0.08, d: 0.3, v: 0.08, type: "triangle" }),
        ));
    },
  },
  SOUND_RECIPES = {
    doorbell: (c) => {
      (tone(c, { f: 659, d: 0.7, v: 0.15 }), tone(c, { f: 523, t: 0.45, d: 1.1, v: 0.15 }));
    },
    alarm: (c) => {
      for (let i = 0; i < 12; i++)
        tone(c, { f: 2e3, t: i * 0.14, d: 0.07, v: 0.08, type: "square" });
    },
    siren: (c) => {
      const o = c.createOscillator(),
        g = c.createGain(),
        T = c.currentTime;
      ((o.type = "sine"), o.frequency.setValueAtTime(650, T));
      for (let i = 0; i < 6; i++)
        o.frequency.linearRampToValueAtTime(i % 2 ? 650 : 950, T + (i + 1) * 0.5);
      (g.gain.setValueAtTime(0.12, T),
        g.gain.setValueAtTime(0.12, T + 2.9),
        g.gain.linearRampToValueAtTime(1e-4, T + 3.1),
        o.connect(g),
        g.connect(c.destination),
        o.start(T),
        o.stop(T + 3.2));
    },
    horn: (c) => {
      [0, 0.9].forEach((t) => {
        (tone(c, { f: 400, t, d: 0.7, v: 0.09, type: "sawtooth" }),
          tone(c, { f: 500, t, d: 0.7, v: 0.09, type: "sawtooth" }));
      });
    },
    heartbeat: (c) => {
      [0, 0.2, 0.95, 1.15, 1.9, 2.1].forEach((t) =>
        tone(c, { f: 90, f2: 45, t, d: 0.18, v: 0.25, a: 0.005 }),
      );
    },
    rain: (c) => {
      noise(c, { d: 3, v: 0.08, lp: 4e3, hp: 800, a: 0.3 });
      for (let i = 0; i < 20; i++) noise(c, { t: Math.random() * 2.8, d: 0.03, v: 0.05, hp: 2e3 });
    },
    clock: (c) => {
      for (let i = 0; i < 6; i++)
        noise(c, { t: i * 0.5, d: 0.02, v: i % 2 ? 0.12 : 0.08, hp: 3e3 });
    },
    knock: (c) => {
      [0, 0.28, 0.56].forEach((t) => {
        (noise(c, { t, d: 0.08, v: 0.2, lp: 300 }),
          tone(c, { f: 110, f2: 70, t, d: 0.12, v: 0.2 }));
      });
    },
    helicopter: (c) => {
      (noise(c, { d: 3, v: 0.12, lp: 500, a: 0.2, chop: 13 }),
        tone(c, { f: 45, d: 3, v: 0.08, type: "sawtooth", a: 0.3 }));
    },
    morse: (c) => {
      [
        [0, 0.1],
        [0.2, 0.1],
        [0.4, 0.1],
        [0.75, 0.3],
        [1.15, 0.3],
        [1.55, 0.3],
        [2.05, 0.1],
        [2.25, 0.1],
        [2.45, 0.1],
      ].forEach(([t, d]) => tone(c, { f: 800, t, d, v: 0.1, a: 0.005 }));
    },
    sonar: (c) => {
      [0, 1.6].forEach((t) => tone(c, { f: 1300, f2: 1e3, t, d: 1.3, v: 0.12, a: 0.005 }));
    },
    laser: (c) => {
      [0, 0.35, 0.7].forEach((t) =>
        tone(c, { f: 1800, f2: 150, t, d: 0.25, v: 0.1, type: "sawtooth", a: 0.005 }),
      );
    },
  };
Object.assign(SOUND_RECIPES, {
  phone: (c) => {
    [0, 0.18, 1.1, 1.28].forEach((t) => {
      (tone(c, { f: 440, t, d: 0.13, v: 0.09, type: "square" }),
        tone(c, { f: 480, t, d: 0.13, v: 0.07, type: "square" }));
    });
  },
  camera: (c) => {
    (noise(c, { d: 0.035, v: 0.2, hp: 1800 }),
      noise(c, { t: 0.07, d: 0.06, v: 0.16, lp: 900 }),
      tone(c, { f: 120, f2: 65, t: 0.06, d: 0.12, v: 0.12 }));
  },
  keyboard: (c) => {
    [0, 0.12, 0.25, 0.38, 0.55, 0.7, 0.83, 0.98, 1.14, 1.3].forEach((t, i) => {
      (noise(c, { t, d: 0.025, v: 0.08, hp: 2200 }),
        tone(c, { f: 170 + (i % 3) * 25, t, d: 0.035, v: 0.04 }));
    });
  },
  coins: (c) => {
    [0, 0.08, 0.17, 0.34, 0.48, 0.7].forEach((t, i) => {
      (tone(c, {
        f: 1800 + (i % 3) * 420,
        f2: 900 + (i % 2) * 250,
        t,
        d: 0.22,
        v: 0.07,
        type: "sine",
      }),
        noise(c, { t, d: 0.02, v: 0.04, hp: 3500 }));
    });
  },
  geiger: (c) => {
    [0, 0.11, 0.39, 0.44, 0.82, 1.15, 1.21, 1.66, 2.05, 2.12, 2.5].forEach((t) => {
      (noise(c, { t, d: 0.012, v: 0.16, hp: 4500 }),
        tone(c, { f: 2400, t, d: 0.01, v: 0.04, type: "square" }));
    });
  },
  morseV: (c) => {
    [
      [0, 0.12],
      [0.24, 0.12],
      [0.48, 0.12],
      [0.72, 0.36],
    ].forEach(([t, d]) => tone(c, { f: 760, t, d, v: 0.1, a: 0.004 }));
  },
  metronome: (c) => {
    for (let i = 0; i < 7; i++)
      (noise(c, { t: i * 0.5, d: 0.018, v: i % 4 === 0 ? 0.18 : 0.1, hp: 2800 }),
        tone(c, { f: i % 4 === 0 ? 1200 : 900, t: i * 0.5, d: 0.025, v: 0.06 }));
  },
  vinyl: (c) => {
    (noise(c, { d: 3, v: 0.035, hp: 900, a: 0.2 }),
      [0.22, 0.71, 1.04, 1.65, 1.72, 2.31, 2.77].forEach((t) =>
        noise(c, { t, d: 0.012, v: 0.15, hp: 3200 }),
      ));
  },
  tuningA: (c) => tone(c, { f: 440, d: 3, v: 0.1, a: 0.02 }),
  dtmf5: (c) => {
    (tone(c, { f: 770, d: 2.2, v: 0.07, a: 0.01 }), tone(c, { f: 1336, d: 2.2, v: 0.07, a: 0.01 }));
  },
  morseCQ: (c) => {
    [
      [0, 0.36],
      [0.48, 0.12],
      [0.72, 0.36],
      [1.2, 0.12],
      [1.8, 0.36],
      [2.28, 0.36],
      [2.76, 0.12],
      [3, 0.36],
    ].forEach(([t, d]) => tone(c, { f: 720, t, d, v: 0.1, a: 0.004 }));
  },
  dialup: (c) => {
    ([0, 0.35, 0.7, 1.05].forEach((t, i) =>
      tone(c, { f: 600 + i * 280, f2: 1100 + i * 180, t, d: 0.3, v: 0.065, type: "square" }),
    ),
      noise(c, { t: 1.4, d: 1.8, v: 0.055, hp: 700, lp: 4200 }),
      [1.5, 1.72, 1.94, 2.16, 2.38, 2.6, 2.82].forEach((t, i) =>
        tone(c, { f: i % 2 ? 1650 : 980, t, d: 0.13, v: 0.05, type: "sawtooth" }),
      ));
  },
});
(Object.assign(SOUND_RECIPES, {
  typewriterBell: (context) => {
    ([0, 0.13, 0.28, 0.41, 0.59, 0.72, 0.91, 1.07, 1.23, 1.39, 1.58, 1.77].forEach(
      (time, index) => {
        (noise(context, { t: time, d: 0.018, v: 0.09, hp: 1800 }),
          tone(context, { f: 125 + (index % 4) * 12, t: time, d: 0.04, v: 0.045, type: "square" }));
      },
    ),
      tone(context, { f: 1500, f2: 1180, t: 1.94, d: 0.62, v: 0.13, type: "sine" }),
      [2.14, 2.23, 2.31, 2.38, 2.44, 2.5, 2.56, 2.62].forEach((time) =>
        noise(context, { t: time, d: 0.012, v: 0.055, hp: 2300 }),
      ));
  },
  filmProjector: (context) => {
    (tone(context, { f: 78, f2: 92, d: 3.15, v: 0.07, type: "sawtooth", a: 0.15 }),
      noise(context, { d: 3.15, v: 0.025, lp: 1500, a: 0.12 }));
    for (let index = 0; index < 25; index += 1) {
      const time = index * 0.126;
      (noise(context, { t: time, d: 0.011, v: 0.07, hp: 2300 }),
        tone(context, { f: 950 + (index % 3) * 105, t: time, d: 0.014, v: 0.025, type: "square" }));
    }
  },
  dotMatrixPrinter: (context) => {
    [0, 1.08, 2.17].forEach((start, pass) => {
      tone(context, {
        f: pass % 2 ? 1700 : 650,
        f2: pass % 2 ? 720 : 1800,
        t: start,
        d: 0.62,
        v: 0.055,
        type: "sawtooth",
      });
      for (let index = 0; index < 17; index += 1)
        noise(context, { t: start + index * 0.034, d: 0.009, v: 0.075, hp: 3e3 });
      [start + 0.69, start + 0.77, start + 0.84].forEach((time, index) =>
        tone(context, { f: 220 + index * 60, t: time, d: 0.05, v: 0.045, type: "square" }),
      );
    });
  },
  shortwaveRadio: (context) => {
    (noise(context, { d: 3.5, v: 0.075, hp: 500, lp: 4200, a: 0.12 }),
      tone(context, { f: 430, f2: 2700, t: 0.18, d: 1.22, v: 0.035, type: "sine" }),
      tone(context, { f: 3100, f2: 720, t: 1.72, d: 1.35, v: 0.032, type: "sine" }),
      [1.47, 1.53, 1.6].forEach((time) =>
        tone(context, { f: 980, t: time, d: 0.05, v: 0.025, type: "triangle" }),
      ));
  },
}),
  Object.assign(SFX, {
    click: (context) => {
      tone(context, { f: 720, f2: 980, d: 0.055, v: 0.032, type: "sine", a: 0.004 });
    },
    tick: (context) => {
      tone(context, { f: 1320, f2: 1180, d: 0.045, v: 0.04, type: "triangle", a: 0.003 });
    },
    open: (context) => {
      (noise(context, { d: 0.18, v: 0.022, hp: 2200, a: 0.006 }),
        [293.66, 440, 659.25].forEach((frequency, index) =>
          tone(context, {
            f: frequency,
            t: index * 0.055,
            d: 0.24,
            v: 0.045,
            type: "triangle",
            a: 0.006,
          }),
        ));
    },
    reveal: (context) => {
      [392, 523.25, 783.99].forEach((frequency, index) =>
        tone(context, { f: frequency, t: index * 0.075, d: 0.3, v: 0.052, type: "sine", a: 0.008 }),
      );
    },
    correct: (context) => {
      [523.25, 659.25, 783.99, 1046.5].forEach((frequency, index) =>
        tone(context, {
          f: frequency,
          t: index * 0.075,
          d: index === 3 ? 0.55 : 0.28,
          v: 0.065,
          type: "triangle",
          a: 0.006,
        }),
      );
    },
    steal: (context) => {
      [349.23, 523.25, 698.46, 987.77].forEach((frequency, index) =>
        tone(context, {
          f: frequency,
          t: index * 0.065,
          d: index === 3 ? 0.5 : 0.24,
          v: 0.057,
          type: index < 2 ? "triangle" : "sine",
          a: 0.006,
        }),
      );
    },
    wrong: (context) => {
      (tone(context, { f: 246.94, f2: 174.61, d: 0.34, v: 0.055, type: "triangle", a: 0.008 }),
        tone(context, { f: 196, f2: 130.81, t: 0.11, d: 0.42, v: 0.045, type: "sine", a: 0.008 }));
    },
    timeout: (context) => {
      [0, 0.28].forEach((time, index) =>
        tone(context, {
          f: index ? 146.83 : 196,
          f2: index ? 98 : 130.81,
          t: time,
          d: 0.42,
          v: 0.06,
          type: "triangle",
          a: 0.008,
        }),
      );
    },
    tool: (context) => {
      [880, 1174.66, 1760].forEach((frequency, index) =>
        tone(context, {
          f: frequency,
          t: index * 0.055,
          d: 0.24,
          v: 0.042,
          type: "sine",
          a: 0.004,
        }),
      );
    },
    scoreUp: (context) => {
      [880, 1318.51].forEach((frequency, index) =>
        tone(context, {
          f: frequency,
          t: index * 0.065,
          d: index ? 0.24 : 0.16,
          v: 0.038,
          type: "sine",
          a: 0.004,
        }),
      );
    },
    scoreDown: (context) => {
      (tone(context, { f: 329.63, f2: 246.94, d: 0.2, v: 0.038, type: "triangle", a: 0.005 }),
        tone(context, { f: 220, t: 0.07, d: 0.23, v: 0.032, type: "sine", a: 0.005 }));
    },
    win: (context) => {
      ([523.25, 659.25, 783.99, 1046.5, 1318.51].forEach((frequency, index) =>
        tone(context, {
          f: frequency,
          t: index * 0.13,
          d: index === 4 ? 0.95 : 0.38,
          v: 0.068,
          type: "triangle",
          a: 0.008,
        }),
      ),
        noise(context, { t: 0.44, d: 0.55, v: 0.018, hp: 2800, a: 0.03 }));
    },
    start: (context) => {
      [261.63, 392, 523.25, 783.99].forEach((frequency, index) =>
        tone(context, {
          f: frequency,
          t: index * 0.075,
          d: index === 3 ? 0.55 : 0.3,
          v: 0.055,
          type: "triangle",
          a: 0.006,
        }),
      );
    },
  }));
// السياق الاحتياطي يُغلق عند كتم الصوت والخروج من اللعبة، فلا يبقى يستهلك الصوت.
export function closeSoundContext() {
  try {
    if (_ctx) { Promise.resolve(_ctx.close()).catch(() => {}); _ctx = null; }
  } catch (error) {}
}
export { getCtx, SFX, SOUND_RECIPES };

// لعبة «بَديهة» (ميدان سابقًا) — الكود الأصلي منقول كما هو بأسلوب React.createElement.
// التعديلات الوحيدة: الاستيرادات أعلاه بدل المتغيرات العامة، اسم اللعبة في النصوص،
// ومفاتيح التخزين تحت النطاق maydan:badeeha (انظر keys.js).
import React from "react";
import { CATS } from "../../data/categories/index.js";
import MAYDAN_BETA_CSS from "./styles.css";
import MaydanLogicBeta from "./logic.js";
import { BADEEHA_KEYS as MAYDAN_BETA_KEYS } from "./keys.js";
import { questionMedia, deckMedia } from "../../shared/media/resolve.js";
import { mulberry32 } from "../../shared/lib/rng.js";
import { arabicNormalize } from "../../shared/lib/arabicNormalize.js";
import {
  preloadMedia,
  cacheForOffline,
  isLoaded as mediaIsLoaded,
  hasFailed as mediaHasFailed,
} from "../../shared/media/preload.js";

const { useState, useEffect, useRef, useMemo } = React;
const TOOLS = [
    { id: "double", label: "دبل النقاط", icon: "✨", hint: "نقاط هذا السؤال ×2 إذا جاوبتوا صح" },
    { id: "two", label: "جوابين", icon: "✌️", hint: "يحق لفريقكم قول إجابتين" },
    { id: "time", label: "وقت زيادة", icon: "⏳", hint: "+30 ثانية على المؤقت" },
  ],
  TEAM_STYLE = [
    {
      solid: "#22d3ee",
      soft: "rgba(34,211,238,0.14)",
      text: "text-cyan-300",
      border: "border-cyan-400",
      name: "الفريق الأزرق",
    },
    {
      solid: "#fb7185",
      soft: "rgba(251,113,133,0.14)",
      text: "text-rose-300",
      border: "border-rose-400",
      name: "الفريق الوردي",
    },
    {
      solid: "#34d399",
      soft: "rgba(52,211,153,0.14)",
      text: "text-emerald-300",
      border: "border-emerald-400",
      name: "الفريق الأخضر",
    },
    {
      solid: "#a78bfa",
      soft: "rgba(167,139,250,0.14)",
      text: "text-violet-300",
      border: "border-violet-400",
      name: "الفريق البنفسجي",
    },
  ],
  STORE_KEY = "maydan-used-questions-v3",
  RESULTS_KEY = "maydan-results-v1",
  TOTAL_Q = CATS.reduce((n, c) => n + c.qs.length, 0),
  // حزم الوسائط تحتاج الشبكة أول مرة، فلا نَعِد اللاعب بما لا نفي به.
  HAS_MEDIA = CATS.some((c) => c.qs.some((q) => q.media)),
  TYPE_PROMPT = {
    zoom: "ما هذا الشيء؟ الصورة مقرّبة جدًا",
    pic: "خمّنوا ما هذا من ظلّه",
    emoji: "ما الذي تعبّر عنه هذه الإيموجي؟",
    order: "رتّبوا العناصر بالترتيب الصحيح",
    closest: "كل فريق يقول رقمًا، والأقرب يأخذ النقاط",
    odd: "أي عنصر هو الدخيل؟ ولماذا؟",
    flag: "علم أي دولة هذا؟",
    sound: "استمعوا وخمّنوا مصدر الصوت",
    grid: "ركّزوا في الصورة قبل انتهاء الوقت",
    image: "ما الذي في الصورة؟",
    audio: "استمعوا إلى المقطع وخمّنوا",
    video: "شاهدوا المقطع وخمّنوا",
    diff: "ما الفرق بين الصورتين؟",
    truefalse: "هل العبارة صحيحة أم خاطئة؟",
    scramble: "رتّبوا الحروف لتكوين الكلمة",
    complete: "أكملوا الناقص",
    common: "ما القاسم المشترك بينها؟",
    hints: "خمّنوا، ولكم أن تطلبوا تلميحًا بثمن",
    choice: "اختاروا الإجابة الصحيحة",
    code: "فكّوا الشفرة",
  },
  // مقطع الصوت يُسمع ثلاث مرات قبل كشف الإجابة، ثم بلا حدّ.
  MAX_AUDIO_PLAYS = 3,
  JUMBLE_TILES = 12,
  // كل تلميح يُطلب يخصم من نقاط السؤال، ولا تقل أبدًا عن الربع.
  HINT_COST_PERCENT = 25,
  shuffle = (arr) => {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  },
  BASE_TIERS = [200, 400, 600],
  PACK_TIERS = [200, 400, 600, 800, 1e3],
  pickTier = (cat, p, hist, n = 2) => {
    const pool = cat.qs.map((q, i) => ({ ...q, id: cat.id + "-" + i })).filter((q) => q.p === p),
      fresh = shuffle(pool.filter((q) => !hist[q.id])),
      old = shuffle(pool.filter((q) => hist[q.id]));
    return [...fresh, ...old].slice(0, n);
  },
  buildDeck = (catIds, hist) => {
    const deck = {};
    return (
      catIds.forEach((cid) => {
        const cat = CATS.find((c) => c.id === cid),
          tiers = PACK_TIERS;
        deck[cid] = tiers.flatMap((p) => pickTier(cat, p, hist));
      }),
      deck
    );
  },
  freshTools = () => ({ double: !0, two: !0, time: !0 }),
  makeTeam = (i, name) => ({
    name: name || TEAM_STYLE[i].name,
    score: 0,
    correct: 0,
    steals: 0,
    tools: freshTools(),
  }),
  answerText = (q) =>
    q.type === "order" ? q.items.map((it, i) => i + 1 + ". " + it).join("  ←  ") : q.a,
  loadKey = async (key) => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  },
  saveKey = async (key, val) => {
    try {
      localStorage.setItem(key, JSON.stringify(val));
    } catch (e) {}
  };
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
function Flag({ spec }) {
  const s = spec;
  let body = null;
  const hStripes = (cols, x0 = 0) =>
    cols.map((col, i) =>
      React.createElement("rect", {
        key: i,
        x: x0,
        y: (200 / cols.length) * i,
        width: 300 - x0,
        height: 200 / cols.length,
        fill: col,
      }),
    );
  if (s.t === "h") body = hStripes(s.c);
  else if (s.t === "v")
    body = s.c.map((col, i) =>
      React.createElement("rect", {
        key: i,
        x: (300 / s.c.length) * i,
        y: "0",
        width: 300 / s.c.length,
        height: 200,
        fill: col,
      }),
    );
  else if (s.t === "circle")
    body = React.createElement(
      React.Fragment,
      null,
      React.createElement("rect", { width: 300, height: 200, fill: s.bg }),
      React.createElement("circle", { cx: s.cx || 150, cy: "100", r: s.r || 60, fill: s.c }),
    );
  else if (s.t === "nordic")
    body = React.createElement(
      React.Fragment,
      null,
      React.createElement("rect", { width: 300, height: 200, fill: s.bg }),
      React.createElement("rect", { x: "85", y: "0", width: "34", height: 200, fill: s.cross }),
      React.createElement("rect", { x: "0", y: "83", width: 300, height: "34", fill: s.cross }),
    );
  else if (s.t === "swiss")
    body = React.createElement(
      React.Fragment,
      null,
      React.createElement("rect", { x: "50", width: "200", height: 200, fill: "#DA291C" }),
      React.createElement("rect", { x: "135", y: "40", width: "30", height: "120", fill: "#fff" }),
      React.createElement("rect", { x: "90", y: "85", width: "120", height: "30", fill: "#fff" }),
    );
  else if (s.t === "hoist")
    body = React.createElement(
      React.Fragment,
      null,
      hStripes(s.c, 75),
      React.createElement("rect", { x: "0", y: "0", width: "75", height: 200, fill: s.bar }),
    );
  else if (s.t === "tri")
    body = React.createElement(
      React.Fragment,
      null,
      hStripes(s.c),
      React.createElement("polygon", { points: "0,0 " + (s.w || 110) + ",100 0,200", fill: s.tri }),
    );
  else if (s.t === "kuwait")
    body = React.createElement(
      React.Fragment,
      null,
      hStripes(["#007A3D", "#fff", "#CE1126"]),
      React.createElement("polygon", { points: "0,0 75,67 75,133 0,200", fill: "#000" }),
    );
  else if (s.t === "serrated") {
    const n = s.n,
      bw = 90,
      pts = ["0,0", bw + ",0"];
    for (let i = 1; i <= 2 * n; i++)
      pts.push((i % 2 ? bw + 30 : bw) + "," + (i * (200 / (2 * n))).toFixed(1));
    (pts.push("0,200"),
      (body = React.createElement(
        React.Fragment,
        null,
        React.createElement("rect", { width: 300, height: 200, fill: s.bg }),
        React.createElement("polygon", { points: pts.join(" "), fill: "#fff" }),
      )));
  }
  return React.createElement(
    "svg",
    {
      viewBox: "0 0 300 200",
      className: "w-full max-w-xs mx-auto rounded-lg",
      style: { display: "block", boxShadow: "0 10px 30px rgba(0,0,0,.45)" },
    },
    body,
  );
}
var hBeta = React.createElement;
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
var MAYDAN_TIER_LABELS = Object.freeze({
  200: "سهل",
  400: "متوسط",
  600: "صعب",
  800: "صعب جدًا",
  1e3: "مستحيل",
});
function betaFreshTools() {
  return { double: !0, two: !0, time: !0 };
}
function betaTeam(index, name) {
  return {
    id: `team-${index + 1}`,
    name: name || TEAM_STYLE[index].name,
    score: 0,
    correct: 0,
    steals: 0,
    tools: betaFreshTools(),
  };
}
function betaCloneTeams(teams) {
  return teams.map((team) => ({ ...team, tools: { ...team.tools } }));
}
function betaRemoveKey(key) {
  try {
    localStorage.removeItem(key);
  } catch (error) {}
}
function betaNativeMessage(payload) {
  try {
    if (window.MaydanNative && typeof window.MaydanNative.postMessage == "function")
      return (window.MaydanNative.postMessage(JSON.stringify(payload)), !0);
    const handler =
      window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.maydan;
    if (handler && typeof handler.postMessage == "function")
      return (handler.postMessage(payload), !0);
  } catch (error) {}
  return !1;
}
function MaydanModal({ title, onClose, children, bottom = !1 }) {
  const modalRef = useRef(null),
    previousFocusRef = useRef(null);
  return (
    useEffect(() => {
      previousFocusRef.current = document.activeElement;
      const modal = modalRef.current;
      if (!modal) return;
      const focusable = () =>
          Array.from(
            modal.querySelectorAll(
              "button:not([disabled]),input:not([disabled]),[tabindex]:not([tabindex='-1'])",
            ),
          ),
        first = focusable()[0];
      first && window.setTimeout(() => first.focus(), 0);
      const onKeyDown = (event) => {
        if (event.key === "Escape") {
          (event.preventDefault(), onClose());
          return;
        }
        if (event.key !== "Tab") return;
        const items = focusable();
        if (!items.length) return;
        const firstItem = items[0],
          lastItem = items[items.length - 1];
        event.shiftKey && document.activeElement === firstItem
          ? (event.preventDefault(), lastItem.focus())
          : !event.shiftKey &&
            document.activeElement === lastItem &&
            (event.preventDefault(), firstItem.focus());
      };
      return (
        document.addEventListener("keydown", onKeyDown),
        () => {
          document.removeEventListener("keydown", onKeyDown);
          const previous = previousFocusRef.current;
          previous && typeof previous.focus == "function" && previous.focus();
        }
      );
    }, []),
    hBeta(
      "div",
      {
        className: `m-modal-layer ${bottom ? "is-bottom" : ""}`,
        role: "presentation",
        onClick: onClose,
      },
      hBeta(
        "section",
        {
          ref: modalRef,
          className: "m-modal",
          role: "dialog",
          "aria-modal": "true",
          "aria-label": title,
          onClick: (event) => event.stopPropagation(),
        },
        hBeta(
          "div",
          { className: "m-modal-head" },
          hBeta("h2", null, title),
          hBeta(
            "button",
            { type: "button", className: "m-icon-btn", onClick: onClose, "aria-label": "إغلاق" },
            "✕",
          ),
        ),
        children,
      ),
    )
  );
}
// ── مكوّنات الوسائط ──────────────────────────────────────────────────────
// خارج مكوّن اللعبة عمدًا: مكوّن يُعرَّف داخل دالة العرض يتغير هويته مع كل إعادة
// عرض (مؤقت الثواني مثلًا)، فيُفكّ ويُركَّب من جديد ويفقد حالته — يتوقف الصوت
// وتعود قطع «إكشفني» إلى الغطاء. هنا الهوية ثابتة والحالة تبقى.
// مرجع الملف في السؤال قصير («01.webp»)، ومجلد الحزمة يكمله. الأخطاء تُعرض
// للاعب بدل أن تترك مربعًا فارغًا لا يفهمه أحد.
function MediaBox({ url, kind, className, alt, children }) {
  // المحمَّل يُفحص أولًا: ملف أخفق مرة (جولة بلا شبكة) ثم نجح لاحقًا يبقى في
  // سجل الإخفاقات، فترتيبٌ معكوس كان يُظهر خطأً دائمًا لملف موجود فعلًا.
  const [state, setState] = useState(mediaIsLoaded(url) ? "ready" : mediaHasFailed(url) ? "error" : "loading");
  useEffect(() => {
    setState(mediaIsLoaded(url) ? "ready" : mediaHasFailed(url) ? "error" : "loading");
  }, [url]);
  if (!url) {
    return hBeta("div", { className: "m-media-box is-error" }, hBeta("p", null, "لا ملف لهذا السؤال"));
  }
  return hBeta(
    "div",
    { className: `m-media-box ${className || ""} ${state === "loading" ? "is-loading" : ""}` },
    state === "error"
      ? hBeta(
          "div",
          { className: "m-media-error", role: "status" },
          hBeta("span", { "aria-hidden": "true" }, "📡"),
          hBeta("b", null, "تعذّر تحميل الملف"),
          hBeta("small", null, navigator.onLine === false ? "لا يوجد اتصال بالإنترنت" : "تحقق من الاتصال ثم أعد المحاولة"),
          hBeta(
            "button",
            { type: "button", className: "m-secondary m-small", onClick: () => { setState("loading"); preloadMedia([url]).then((r) => setState(r.failed === 0 ? "ready" : "error")); } },
            "أعد المحاولة",
          ),
        )
      : children({ onReady: () => setState("ready"), onError: () => setState("error") }),
    state === "loading" && hBeta("span", { className: "m-media-spinner", "aria-label": "جارٍ التحميل" }),
  );
}

// ترتيب قطع «ركّبها صح» ثابت لكل سؤال (مشتق من معرّفه) كي لا يتغير عند إعادة الرسم أو الاستئناف.
// مقارنة الإجابات بالموحّد نفسه الذي يستعمله bank:validate، فما يقبله المدقّق
// خيارًا صحيحًا تُبرزه الشاشة حتمًا.
const arabicKey = arabicNormalize;

function jumbleOrder(seed) {
  let h = 2166136261;
  for (const ch of String(seed)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  const random = mulberry32(h >>> 0),
    order = Array.from({ length: JUMBLE_TILES }, (_, i) => i);
  for (let i = order.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  if (order.every((v, i) => v === i)) [order[0], order[1]] = [order[1], order[0]];
  return order;
}

function MediaImage({ question, url, effect, revealed, onSfx }) {
  const [tiles, setTiles] = useState(() => (effect === "reveal" ? Array.from({ length: 12 }, (_, i) => i) : []));
  const [enlarged, setEnlarged] = useState(false);
  // شبكة القطع تأخذ نسبة الصورة الحقيقية، وإلا مطّت صورةً مربّعة داخل إطار 4:3
  const [ratio, setRatio] = useState(null);
  useEffect(() => { if (effect === "reveal") setTiles(Array.from({ length: 12 }, (_, i) => i)); setEnlarged(false); setRatio(null); }, [url, effect]);
  useEffect(() => { if (!enlarged) return undefined; const onKey = (e) => { if (e.key === "Escape") setEnlarged(false); }; window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey); }, [enlarged]);
  const shown = revealed ? [] : tiles;
  const cls = ["m-media-img", `fx-${effect}`, revealed ? "is-revealed" : ""].join(" ");
  // التكبير باللمس لا يكشف ما يخفيه المؤثّر: يُتاح للصورة العادية دائمًا، وللبقية بعد الكشف.
  const canEnlarge = effect === "none" || revealed;
  const jumbled = effect === "jumble" && !revealed;
  const order = jumbled ? jumbleOrder(question.qid || url) : null;
  return hBeta(
    MediaBox,
    { url, className: `fx-frame-${effect}`, alt: question.q || "صورة السؤال" },
    ({ onReady, onError }) =>
      hBeta(
        "div",
        {
          className: `m-media-stage ${canEnlarge ? "can-enlarge" : ""}`,
          onClick: canEnlarge ? () => { setEnlarged(true); onSfx && onSfx("click"); } : undefined,
          role: canEnlarge ? "button" : undefined,
          "aria-label": canEnlarge ? "تكبير الصورة" : undefined,
        },
        hBeta("img", {
          src: url,
          alt: revealed ? question.a || "صورة السؤال" : "صورة السؤال",
          className: jumbled ? `${cls} is-hidden-src` : cls,
          style: effect === "zoom" ? { transformOrigin: question.origin || "50% 50%" } : null,
          onLoad: (event) => {
            const img = event.currentTarget;
            if (img && img.naturalWidth && img.naturalHeight) setRatio(img.naturalWidth / img.naturalHeight);
            onReady();
          },
          onError,
          draggable: false,
        }),
        jumbled &&
          hBeta(
            "div",
            { className: "m-jumble", "aria-hidden": "true", style: ratio ? { aspectRatio: String(ratio) } : null },
            order.map((source, slot) =>
              hBeta("i", {
                key: slot,
                style: {
                  backgroundImage: `url("${url}")`,
                  backgroundPosition: `${(source % 4) * (100 / 3)}% ${Math.floor(source / 4) * 50}%`,
                },
              }),
            ),
          ),
        enlarged &&
          hBeta(
            "div",
            {
              className: "m-lightbox",
              role: "dialog",
              "aria-label": "الصورة مكبّرة — اضغط للإغلاق",
              onClick: (e) => { e.stopPropagation(); setEnlarged(false); },
            },
            hBeta("img", { src: url, alt: revealed ? question.a || "صورة السؤال" : "صورة السؤال", className: cls, draggable: false }),
          ),
        effect === "reveal" &&
          hBeta(
            "div",
            { className: "m-reveal-tiles", "aria-hidden": "true" },
            Array.from({ length: 12 }, (_, i) =>
              hBeta("i", { key: i, className: shown.includes(i) ? "" : "is-open" }),
            ),
          ),
        effect === "reveal" &&
          !revealed &&
          hBeta(
            "button",
            {
              type: "button",
              className: "m-secondary m-small m-reveal-tile-btn",
              disabled: shown.length === 0,
              onClick: () => {
                setTiles((list) => list.filter((_, index) => index !== Math.floor(Math.random() * list.length)));
                onSfx && onSfx("click");
              },
            },
            `اكشف قطعة (${shown.length})`,
          ),
      ),
  );
}

function MediaAudio({ url, revealed }) {
  const ref = useRef(null);
  const [playing, setPlaying] = useState(false);
  // تُحتسب المرة عند بدء التشغيل من أوله؛ الإيقاف المؤقت ثم الاستئناف لا يُحتسب.
  const [plays, setPlays] = useState(0);
  // متوقف في منتصف المقطع: استئنافه ليس مرة جديدة، فلا يُقفل الزر بعد نفاد المرات
  const [midway, setMidway] = useState(false);
  useEffect(() => { setPlays(0); setPlaying(false); setMidway(false); }, [url]);
  useEffect(() => () => { if (ref.current) ref.current.pause(); }, []);
  const spent = !revealed && plays >= MAX_AUDIO_PLAYS,
    left = Math.max(0, MAX_AUDIO_PLAYS - plays);
  const start = (fromStart) => {
    const el = ref.current;
    if (!el) return;
    const fresh = fromStart || el.currentTime === 0 || el.ended;
    if (fresh && spent) return;
    if (fromStart) el.currentTime = 0;
    // العدّ بعد تأكد التشغيل: ضغطة على مقطع ما زال يُحمَّل ثم إيقافها كانت تحرق مرة بلا صوت
    el.play().then(() => { setPlaying(true); if (fresh) setPlays((n) => n + 1); }).catch(() => setPlaying(false));
  };
  const toggle = () => {
    const el = ref.current;
    if (!el) return;
    if (el.paused) start(false);
    else { el.pause(); setPlaying(false); }
  };
  return hBeta(
    MediaBox,
    { url, className: "is-audio" },
    ({ onReady, onError }) =>
      hBeta(
        "div",
        { className: `m-audio ${spent ? "is-spent" : ""}` },
        hBeta("audio", {
          ref,
          src: url,
          preload: "auto",
          onCanPlay: onReady,
          onError,
          // الحالة تتبع العنصر نفسه لا الأزرار فقط (إيقاف من النظام، انتهاء المقطع…)
          onPlay: () => { setPlaying(true); setMidway(false); },
          onPause: () => { const el = ref.current; setPlaying(false); setMidway(!!el && el.currentTime > 0 && !el.ended); },
          onEnded: () => { setPlaying(false); setMidway(false); },
        }),
        hBeta(
          "button",
          {
            type: "button",
            className: "m-audio-btn",
            onClick: toggle,
            disabled: spent && !playing && !midway,
            "aria-label": playing ? "إيقاف" : "تشغيل",
          },
          hBeta("span", { "aria-hidden": "true" }, playing ? "⏸" : "▶"),
        ),
        hBeta(
          "div",
          { className: "m-audio-meta" },
          hBeta("b", null, playing ? "يعمل الآن" : spent ? "انتهت مرات السماع" : "اضغط للاستماع"),
          hBeta(
            "small",
            null,
            revealed
              ? "بعد الكشف يمكنكم إعادة السماع بلا حدّ"
              : spent
                ? "اكشفوا الإجابة لإعادة السماع"
                : `${left === 1 ? "مرة واحدة متبقية" : left === 2 ? "مرتان متبقيتان" : `${left} مرات متبقية`} من ${MAX_AUDIO_PLAYS}`,
          ),
        ),
        hBeta(
          "button",
          {
            type: "button",
            className: "m-secondary m-small",
            disabled: spent,
            onClick: () => start(true),
          },
          "↻ من البداية",
        ),
      ),
  );
}

// «أربع صور وكلمة»: شبكة 2×2، كل صورة بصندوقها كي لا يعطّل ملفٌ واحد البقية.
function FourPics({ question, urls, revealed }) {
  return hBeta(
    "div",
    { className: "m-fourpics" },
    urls.map((one, index) =>
      hBeta(MediaBox, { key: one, url: one }, ({ onReady, onError }) =>
        hBeta("img", {
          src: one,
          alt: revealed ? `${question.a} — صورة ${index + 1}` : `صورة ${index + 1}`,
          className: "m-media-img",
          onLoad: onReady,
          onError,
          draggable: false,
        }),
      ),
    ),
  );
}

function MediaVideo({ url }) {
  const ref = useRef(null);
  return hBeta(
    MediaBox,
    { url, className: "is-video" },
    ({ onReady, onError }) =>
      hBeta("video", {
        ref,
        src: url,
        className: "m-media-video",
        controls: true,
        playsInline: true,
        preload: "auto",
        onLoadedData: onReady,
        onError,
      }),
  );
}


function MaydanBeta() {
  const logic = MaydanLogicBeta,
    [hydrated, setHydrated] = useState(!1),
    [screen, setScreen] = useState("home"),
    [teams, setTeams] = useState([betaTeam(0), betaTeam(1)]),
    [selectedCategories, setSelectedCategories] = useState([]),
    [timerLength, setTimerLength] = useState(60),
    [mode, setMode] = useState("expert"),
    [roundSize, setRoundSize] = useState(30),
    [deck, setDeck] = useState({}),
    [used, setUsed] = useState({}),
    [turn, setTurn] = useState(0),
    [current, setCurrent] = useState(null),
    [timeLeft, setTimeLeft] = useState(60),
    [paused, setPaused] = useState(!1),
    [revealed, setRevealed] = useState(!1),
    [mixedItems, setMixedItems] = useState([]),
    [effect, setEffect] = useState({ double: !1, two: !1 }),
    [hintsUsed, setHintsUsed] = useState(0),
    [offlineMedia, setOfflineMedia] = useState({ state: "idle", done: 0, total: 0 }),
    [questionBaseTeams, setQuestionBaseTeams] = useState(null),
    [history, setHistory] = useState({}),
    [results, setResults] = useState([]),
    [reports, setReports] = useState([]),
    [favorites, setFavorites] = useState([]),
    [savedActive, setSavedActive] = useState(null),
    [finalResult, setFinalResult] = useState(null),
    [soundOn, setSoundOn] = useState(!0),
    [categoryFilter, setCategoryFilter] = useState("all"),
    [categorySearch, setCategorySearch] = useState(""),
    [setupError, setSetupError] = useState(""),
    [showRules, setShowRules] = useState(!1),
    [showScore, setShowScore] = useState(!1),
    [confirmEnd, setConfirmEnd] = useState(!1),
    [reportQuestion, setReportQuestion] = useState(null),
    [lastAction, setLastAction] = useState(null),
    [notice, setNotice] = useState(""),
    deadlineRef = useRef(null),
    soundTimerRef = useRef(null),
    saveTimerRef = useRef(null),
    timeoutPlayedRef = useRef(!1),
    activeSnapshotRef = useRef(null),
    lastQuestionSoundRef = useRef(0),
    totalQuestions = Object.values(deck).reduce((sum, questions) => sum + questions.length, 0),
    usedCount = Object.keys(used).length,
    activeMode = logic.MODES[mode] || logic.MODES.expert,
    currentQuestion =
      current && deck[current.categoryId] ? deck[current.categoryId][current.index] : null,
    currentCategory = current ? CATS.find((category) => category.id === current.categoryId) : null;
  function playSfx(name) {
    if (!soundOn || !SFX[name]) return;
    const context = getCtx();
    if (context)
      try {
        SFX[name](context);
      } catch (error) {}
  }
  function playQuestionSound(recipe) {
    if (!soundOn || !SOUND_RECIPES[recipe]) return;
    const now = Date.now();
    if (now - lastQuestionSoundRef.current < 450) return;
    lastQuestionSoundRef.current = now;
    const context = getCtx();
    if (context)
      try {
        SOUND_RECIPES[recipe](context);
      } catch (error) {}
  }
  function haptic(kind) {
    const presets = {
        selection: { style: "selection", pattern: 12 },
        light: { style: "light", pattern: 18 },
        medium: { style: "medium", pattern: 32 },
        success: { style: "success", pattern: [25, 28, 55] },
        warning: { style: "warning", pattern: [42, 28, 42] },
        error: { style: "error", pattern: 85 },
        win: { style: "success", pattern: [28, 24, 28, 32, 75] },
      },
      preset = presets[kind] || presets.selection;
    if (!betaNativeMessage({ type: "haptic", style: preset.style, pattern: preset.pattern }))
      try {
        navigator.vibrate && navigator.vibrate(preset.pattern);
      } catch (error) {}
  }
  function toast(message) {
    (setNotice(message),
      window.setTimeout(() => setNotice((value) => (value === message ? "" : value)), 2400));
  }
  async function shareText(title, text) {
    if (!betaNativeMessage({ type: "share", title, text })) {
      try {
        if (navigator.share) {
          await navigator.share({ title, text });
          return;
        }
        if (navigator.clipboard && navigator.clipboard.writeText) {
          (await navigator.clipboard.writeText(text), toast("تم نسخ النص"));
          return;
        }
      } catch (error) {
        if (error && error.name === "AbortError") return;
      }
      toast("تعذرت المشاركة على هذا الجهاز");
    }
  }
  (useEffect(() => {
    let cancelled = !1;
    return (
      (async () => {
        const [loadedHistory, loadedResults, loadedActive, loadedSettings, loadedReports] =
          await Promise.all([
            loadKey(MAYDAN_BETA_KEYS.history),
            loadKey(MAYDAN_BETA_KEYS.results),
            loadKey(MAYDAN_BETA_KEYS.active),
            loadKey(MAYDAN_BETA_KEYS.settings),
            loadKey(MAYDAN_BETA_KEYS.reports),
          ]);
        cancelled ||
          (loadedHistory &&
            typeof loadedHistory == "object" &&
            !Array.isArray(loadedHistory) &&
            setHistory(loadedHistory),
          Array.isArray(loadedResults) && setResults(loadedResults),
          Array.isArray(loadedReports) && setReports(loadedReports),
          loadedSettings &&
            typeof loadedSettings == "object" &&
            (typeof loadedSettings.soundOn == "boolean" && setSoundOn(loadedSettings.soundOn),
            [30, 60, 90].includes(loadedSettings.timerLength) &&
              setTimerLength(loadedSettings.timerLength),
            logic.MODES[loadedSettings.mode] && setMode(loadedSettings.mode),
            logic.ROUND_SIZES.includes(loadedSettings.roundSize) &&
              setRoundSize(loadedSettings.roundSize),
            Array.isArray(loadedSettings.favorites) &&
              setFavorites(loadedSettings.favorites.filter((id) => CATS.some((c) => c.id === id)))),
          logic.isValidSession(CATS, loadedActive)
            ? setSavedActive(loadedActive)
            : loadedActive && betaRemoveKey(MAYDAN_BETA_KEYS.active),
          setHydrated(!0));
      })(),
      () => {
        cancelled = !0;
      }
    );
  }, []),
    useEffect(() => {
      hydrated &&
        saveKey(MAYDAN_BETA_KEYS.settings, { soundOn, timerLength, mode, roundSize, favorites });
    }, [hydrated, soundOn, timerLength, mode, roundSize, favorites]),
    useEffect(() => {
      if (!soundOn) {
        closeQuestionSoundTimer();
        try {
          _ctx && _ctx.state === "running" && _ctx.suspend();
        } catch (error) {}
      }
    }, [soundOn]),
    useEffect(() => {
      if (!hydrated || (screen !== "board" && screen !== "question")) return;
      const session = {
        version: 2,
        updatedAt: Date.now(),
        screen,
        teams: betaCloneTeams(teams),
        selectedCategories: [...selectedCategories],
        timerLength,
        mode,
        roundSize,
        deck: logic.deckToIds(deck),
        used: { ...used },
        turn,
        current: current ? { ...current } : null,
        timeLeft,
        paused: screen === "question" ? !0 : paused,
        revealed,
        mixedItems: [...mixedItems],
        effect: { ...effect },
        questionBaseTeams: questionBaseTeams ? betaCloneTeams(questionBaseTeams) : null,
        lastAction,
      };
      return (
        (activeSnapshotRef.current = session),
        saveTimerRef.current && window.clearTimeout(saveTimerRef.current),
        (saveTimerRef.current = window.setTimeout(
          () => saveKey(MAYDAN_BETA_KEYS.active, session),
          250,
        )),
        () => {
          saveTimerRef.current && window.clearTimeout(saveTimerRef.current);
        }
      );
    }, [
      hydrated,
      screen,
      teams,
      selectedCategories,
      timerLength,
      mode,
      roundSize,
      deck,
      used,
      turn,
      current,
      timeLeft,
      paused,
      revealed,
      mixedItems,
      effect,
      questionBaseTeams,
      lastAction,
    ]),
    useEffect(() => {
      const saveOnLeave = () => {
        activeSnapshotRef.current && saveKey(MAYDAN_BETA_KEYS.active, activeSnapshotRef.current);
      };
      return (
        window.addEventListener("pagehide", saveOnLeave),
        () => window.removeEventListener("pagehide", saveOnLeave)
      );
    }, []),
    useEffect(() => {
      try {
        window.scrollTo({ top: 0, left: 0, behavior: "auto" });
      } catch (error) {
        window.scrollTo(0, 0);
      }
    }, [screen]),
    useEffect(() => {
      if (screen !== "question" || !current || revealed || paused || timeLeft <= 0) return;
      deadlineRef.current || (deadlineRef.current = Date.now() + timeLeft * 1e3);
      const tick = () => {
        const next = Math.max(0, Math.ceil((deadlineRef.current - Date.now()) / 1e3));
        (setTimeLeft(
          (previous) => (next !== previous && next > 0 && next <= 5 && playSfx("tick"), next),
        ),
          next === 0 &&
            !timeoutPlayedRef.current &&
            ((timeoutPlayedRef.current = !0),
            (deadlineRef.current = null),
            playSfx("timeout"),
            haptic("warning")));
      };
      tick();
      const interval = window.setInterval(tick, 250);
      return () => window.clearInterval(interval);
    }, [screen, current && `${current.categoryId}:${current.index}`, revealed, paused, soundOn]),
    useEffect(() => {
      const onVisibility = () => {
        document.hidden &&
          screen === "question" &&
          !revealed &&
          ((deadlineRef.current = null), setPaused(!0));
      };
      return (
        document.addEventListener("visibilitychange", onVisibility),
        () => document.removeEventListener("visibilitychange", onVisibility)
      );
    }, [screen, revealed]));
  function closeQuestionSoundTimer() {
    soundTimerRef.current &&
      (window.clearTimeout(soundTimerRef.current), (soundTimerRef.current = null));
  }
  function cancelQuestion() {
    if (revealed) {
      toast("احسم نتيجة السؤال أولًا");
      return;
    }
    (closeQuestionSoundTimer(),
      questionBaseTeams && setTeams(betaCloneTeams(questionBaseTeams)),
      (deadlineRef.current = null),
      setCurrent(null),
      setQuestionBaseTeams(null),
      setEffect({ double: !1, two: !1 }),
      setHintsUsed(0),
      setPaused(!1),
      setScreen("board"),
      playSfx("click"));
  }
  useEffect(
    () => (
      (window.maydanBack = () =>
        reportQuestion
          ? (setReportQuestion(null), !0)
          : showScore
            ? (setShowScore(!1), !0)
            : showRules
              ? (setShowRules(!1), !0)
              : screen === "question"
                ? (revealed ? toast("احسم نتيجة السؤال أولًا") : cancelQuestion(), !0)
                : screen === "board"
                  ? (setConfirmEnd(!0), !0)
                  : screen !== "home"
                    ? (setScreen("home"), !0)
                    : !1),
      () => {
        delete window.maydanBack;
      }
    ),
    [screen, revealed, reportQuestion, showScore, showRules, questionBaseTeams],
  );
  function setTeamCount(count) {
    (setTeams((existing) =>
      Array.from({ length: count }, (_, index) => existing[index] || betaTeam(index)),
    ),
      setSetupError(""),
      playSfx("click"));
  }
  function setTeamName(index, name) {
    (setTeams((existing) =>
      existing.map((team, teamIndex) => (teamIndex === index ? { ...team, name } : team)),
    ),
      setSetupError(""));
  }
  function toggleCategory(categoryId) {
    (setSetupError(""),
      setSelectedCategories((existing) =>
        existing.includes(categoryId)
          ? existing.filter((id) => id !== categoryId)
          : existing.length < 6
            ? [...existing, categoryId]
            : existing,
      ),
      playSfx("click"));
  }
  function toggleFavorite(categoryId) {
    (setFavorites((existing) =>
      existing.includes(categoryId)
        ? existing.filter((id) => id !== categoryId)
        : [...existing, categoryId],
    ),
      playSfx("click"));
  }
  const visibleCategories = CATS.filter((category) =>
    !categorySearch.trim() || category.name.includes(categorySearch.trim())
      ? categoryFilter === "special"
        ? !!category.special
        : categoryFilter === "pack"
          ? !!category.pack
          : categoryFilter === "info"
            ? !category.special && !category.pack
            : categoryFilter === "favorites"
              ? favorites.includes(category.id)
              : !0
      : !1,
  );
  function randomCategories() {
    if (visibleCategories.length < 6) {
      setSetupError("وسّع التصفية أولًا؛ النتائج الحالية أقل من ست فئات");
      return;
    }
    (setSelectedCategories(
      logic.shuffled(visibleCategories.map((category) => category.id)).slice(0, 6),
    ),
      setSetupError(""),
      playSfx("tool"));
  }
  function beginGame() {
    const validation = logic.validateTeamNames(teams.map((team) => team.name));
    if (!validation.ok) {
      setSetupError(validation.message);
      return;
    }
    if (selectedCategories.length !== 6) {
      setSetupError("اختر ست فئات بالضبط");
      return;
    }
    let nextDeck;
    try {
      nextDeck = logic.buildDeck(CATS, selectedCategories, history, activeMode.tiers, roundSize);
    } catch (error) {
      setSetupError(error.message || "تعذر تجهيز الجولة");
      return;
    }
    const freshTeams = teams.map((team, index) => betaTeam(index, validation.names[index]));
    (setTeams(freshTeams),
      setDeck(nextDeck),
      setUsed({}),
      setTurn(0),
      setCurrent(null),
      setTimeLeft(timerLength),
      setPaused(!1),
      setRevealed(!1),
      setEffect({ double: !1, two: !1 }),
      setQuestionBaseTeams(null),
      setLastAction(null),
      setFinalResult(null),
      setConfirmEnd(!1),
      setShowScore(!1),
      setSavedActive(null),
      setSetupError(""),
      (deadlineRef.current = null),
      (timeoutPlayedRef.current = !1),
      betaRemoveKey(MAYDAN_BETA_KEYS.active),
      // وسائط الجولة تُجلب في الخلفية فور بناء اللوحة، فلا ينتظر أحد عند فتح السؤال.
      preloadMedia(deckMedia(nextDeck, CATS)),
      setScreen("board"),
      playSfx("start"),
      haptic("medium"));
  }
  function resumeGame() {
    if (!logic.isValidSession(CATS, savedActive)) {
      (betaRemoveKey(MAYDAN_BETA_KEYS.active),
        setSavedActive(null),
        toast("تعذر استعادة المباراة القديمة"));
      return;
    }
    const restoredDeck = logic.idsToDeck(CATS, savedActive.deck);
    (setTeams(betaCloneTeams(savedActive.teams)),
      setSelectedCategories([...savedActive.selectedCategories]),
      setTimerLength(savedActive.timerLength),
      setMode(savedActive.mode),
      setRoundSize(savedActive.roundSize),
      setDeck(restoredDeck),
      setUsed({ ...(savedActive.used || {}) }),
      setTurn(savedActive.turn || 0),
      setCurrent(savedActive.current ? { ...savedActive.current } : null),
      setTimeLeft(
        Number.isFinite(savedActive.timeLeft) ? savedActive.timeLeft : savedActive.timerLength,
      ),
      setPaused(!0),
      setRevealed(!!savedActive.revealed),
      setMixedItems(Array.isArray(savedActive.mixedItems) ? [...savedActive.mixedItems] : []),
      setEffect(savedActive.effect ? { ...savedActive.effect } : { double: !1, two: !1 }),
      setQuestionBaseTeams(
        savedActive.questionBaseTeams ? betaCloneTeams(savedActive.questionBaseTeams) : null,
      ),
      setLastAction(savedActive.lastAction || null),
      (deadlineRef.current = null),
      (timeoutPlayedRef.current = savedActive.timeLeft <= 0),
      setScreen(savedActive.screen === "question" && savedActive.current ? "question" : "board"),
      playSfx("start"));
  }
  function discardSavedGame() {
    (betaRemoveKey(MAYDAN_BETA_KEYS.active),
      setSavedActive(null),
      toast("تم حذف المباراة المحفوظة"));
  }
  function openQuestion(categoryId, index) {
    const question = deck[categoryId] && deck[categoryId][index];
    if (!(!question || used[question.qid])) {
      if (
        (closeQuestionSoundTimer(),
        setQuestionBaseTeams(betaCloneTeams(teams)),
        setCurrent({ categoryId, index }),
        setTimeLeft(timerLength),
        setPaused(!1),
        setRevealed(!1),
        setEffect({ double: !1, two: !1 }),
        setHintsUsed(0),
        (timeoutPlayedRef.current = !1),
        (deadlineRef.current = Date.now() + timerLength * 1e3),
        question.type === "order")
      ) {
        let items = logic.shuffled(question.items),
          attempts = 0;
        for (; items.join("|") === question.items.join("|") && attempts < 5;)
          ((items = logic.shuffled(question.items)), (attempts += 1));
        setMixedItems(items);
      } else setMixedItems([]);
      (setScreen("question"),
        playSfx("open"),
        haptic("selection"),
        question.type === "sound" &&
          (soundTimerRef.current = window.setTimeout(() => {
            (playQuestionSound(question.sound), (soundTimerRef.current = null));
          }, 450)));
    }
  }
  function togglePause() {
    (paused
      ? ((deadlineRef.current = Date.now() + timeLeft * 1e3), setPaused(!1))
      : ((deadlineRef.current = null), setPaused(!0)),
      playSfx("click"));
  }
  function useTool(toolId) {
    !currentQuestion ||
      revealed ||
      timeLeft <= 0 ||
      !teams[turn].tools[toolId] ||
      (toolId === "double" && revealed) ||
      (setTeams((existing) =>
        existing.map((team, index) =>
          index === turn ? { ...team, tools: { ...team.tools, [toolId]: !1 } } : team,
        ),
      ),
      toolId === "double" && setEffect((value) => ({ ...value, double: !0 })),
      toolId === "two" && setEffect((value) => ({ ...value, two: !0 })),
      toolId === "time" &&
        (setTimeLeft((seconds) => seconds + 30),
        !paused && deadlineRef.current && (deadlineRef.current += 3e4)),
      playSfx("tool"),
      haptic("light"));
  }
  function revealAnswer() {
    (closeQuestionSoundTimer(),
      (deadlineRef.current = null),
      setRevealed(!0),
      setPaused(!1),
      playSfx("reveal"),
      haptic("light"));
  }
  function snapshotAction(label) {
    return {
      label,
      teams: betaCloneTeams(teams),
      used: { ...used },
      turn,
      history: { ...history },
    };
  }
  function finishGame(early, finishedTeams = teams, finishedUsed = used) {
    const maximum = Math.max(...finishedTeams.map((team) => team.score)),
      winners = finishedTeams.filter((team) => team.score === maximum),
      record = {
        id: Date.now(),
        date: new Date().toLocaleDateString("ar-EG", {
          year: "numeric",
          month: "short",
          day: "numeric",
        }),
        teams: finishedTeams.map((team) => ({
          id: team.id,
          name: team.name,
          score: team.score,
          correct: team.correct,
          steals: team.steals,
        })),
        winner: winners.length === 1 ? winners[0].name : null,
        answered: Object.keys(finishedUsed).length,
        total: totalQuestions || roundSize,
        mode,
        roundSize,
        early: !!early,
      },
      nextResults = [record, ...results].slice(0, 80);
    (setTeams(betaCloneTeams(finishedTeams)),
      setResults(nextResults),
      setFinalResult(record),
      saveKey(MAYDAN_BETA_KEYS.results, nextResults),
      saveTimerRef.current &&
        (window.clearTimeout(saveTimerRef.current), (saveTimerRef.current = null)),
      betaRemoveKey(MAYDAN_BETA_KEYS.active),
      (activeSnapshotRef.current = null),
      setSavedActive(null),
      setConfirmEnd(!1),
      setShowScore(!1),
      setCurrent(null),
      setScreen("result"),
      window.setTimeout(() => playSfx("win"), 360),
      haptic("win"));
  }
  function judgeQuestion(winnerIndex) {
    const question = currentQuestion;
    if (!question) return;
    const action = snapshotAction(`نتيجة سؤال ${question.p}`);
    let nextTeams = betaCloneTeams(teams);
    if (winnerIndex !== null) {
      const sameTeam = winnerIndex === turn,
        base = hintsUsed > 0
          ? Math.max(
              Math.round(question.p * 0.25),
              Math.round((question.p * (100 - hintsUsed * HINT_COST_PERCENT)) / 100),
            )
          : question.p,
        points = sameTeam && effect.double ? base * 2 : base,
        isSteal = question.type !== "closest" && !sameTeam;
      ((nextTeams = nextTeams.map((team, index) =>
        index === winnerIndex
          ? {
              ...team,
              score: team.score + points,
              correct: team.correct + 1,
              steals: team.steals + (isSteal ? 1 : 0),
            }
          : team,
      )),
        playSfx(isSteal ? "steal" : "correct"),
        haptic("success"));
    } else (playSfx("wrong"), haptic("error"));
    const nextUsed = { ...used, [question.qid]: !0 },
      nextHistory = { ...history, [question.qid]: Date.now() },
      nextTurn = (turn + 1) % teams.length;
    (setTeams(nextTeams),
      setUsed(nextUsed),
      setHistory(nextHistory),
      saveKey(MAYDAN_BETA_KEYS.history, nextHistory),
      setTurn(nextTurn),
      setLastAction(action),
      setCurrent(null),
      setQuestionBaseTeams(null),
      setEffect({ double: !1, two: !1 }),
      setHintsUsed(0),
      setRevealed(!1),
      (deadlineRef.current = null),
      Object.keys(nextUsed).length >= totalQuestions
        ? finishGame(!1, nextTeams, nextUsed)
        : setScreen("board"));
  }
  function undoLastAction() {
    lastAction &&
      (setTeams(betaCloneTeams(lastAction.teams)),
      setUsed({ ...lastAction.used }),
      setTurn(lastAction.turn),
      setHistory({ ...lastAction.history }),
      saveKey(MAYDAN_BETA_KEYS.history, lastAction.history),
      setLastAction(null),
      setConfirmEnd(!1),
      playSfx("click"),
      haptic("selection"),
      toast("تم التراجع عن آخر تعديل"));
  }
  function adjustScore(teamIndex, delta) {
    (setLastAction(snapshotAction(`تعديل ${delta > 0 ? "+" : ""}${delta} نقطة`)),
      setTeams((existing) =>
        existing.map((team, index) =>
          index === teamIndex ? { ...team, score: team.score + delta } : team,
        ),
      ),
      playSfx(delta > 0 ? "scoreUp" : "scoreDown"),
      haptic(delta > 0 ? "light" : "selection"));
  }
  function submitReport(reason) {
    if (!reportQuestion) return;
    const category = CATS.find((item) => item.id === reportQuestion.categoryId),
      question = reportQuestion.question,
      next = [
        {
          id: Date.now(),
          qid: question.qid,
          categoryId: category.id,
          category: category.name,
          points: question.p,
          question: question.q || TYPE_PROMPT[question.type] || question.type,
          answer: answerText(question),
          reason,
          date: new Date().toISOString(),
        },
        ...reports,
      ].slice(0, 300);
    (setReports(next),
      saveKey(MAYDAN_BETA_KEYS.reports, next),
      setReportQuestion(null),
      toast("شكرًا، حُفظ البلاغ على الجهاز"));
  }
  function shareResult() {
    const record = finalResult;
    if (!record) return;
    const scores = record.teams.map((team) => `${team.name}: ${team.score}`).join(" — "),
      title = record.winner ? `فاز ${record.winner} في بَديهة` : "تعادل في بَديهة";
    shareText(
      "بَديهة",
      `${title}
${scores}
${record.answered} من ${record.total} سؤالًا`,
    );
  }
  function shareReports() {
    if (!reports.length) return;
    const text = reports.slice(0, 100).map((report, index) =>
      [
        `${index + 1}. [${report.category} — ${report.points}] ${report.reason}`,
        `السؤال: ${report.question}`,
        `الإجابة: ${report.answer}`,
        `المعرّف: ${report.qid}`,
      ].join(`
`),
    ).join(`

`);
    shareText("تقارير أسئلة بَديهة", text);
  }
  function clearQuestionHistory() {
    window.confirm("هل تريد تصفير سجل الأسئلة التي لُعبت؟") &&
      (setHistory({}), saveKey(MAYDAN_BETA_KEYS.history, {}), toast("تم تصفير سجل الأسئلة"));
  }
  function clearResults() {
    window.confirm("هل تريد مسح سجل النتائج؟") &&
      (setResults([]), saveKey(MAYDAN_BETA_KEYS.results, []), toast("تم مسح سجل النتائج"));
  }
  function SoundButton() {
    return hBeta(
      "button",
      {
        type: "button",
        className: "m-icon-btn",
        onClick: () => {
          if (soundOn) {
            (playSfx("click"), setSoundOn(!1));
            return;
          }
          const context = getCtx();
          (context && typeof context.resume == "function" && context.resume().catch(() => {}),
            setSoundOn(!0),
            context && SFX.click && SFX.click(context));
        },
        "aria-label": soundOn ? "كتم الصوت" : "تشغيل الصوت",
        "aria-pressed": !soundOn,
      },
      hBeta("span", { "aria-hidden": "true" }, soundOn ? "🔊" : "🔇"),
    );
  }
  function Header({ title, back }) {
    return hBeta(
      "header",
      { className: "m-header" },
      hBeta(
        "div",
        null,
        hBeta("div", { className: "m-kicker" }, "بَديهة · لعبة جماعية"),
        hBeta("h1", { className: "m-title" }, title),
      ),
      hBeta(
        "div",
        { className: "m-header-actions" },
        SoundButton(),
        back &&
          hBeta(
            "button",
            {
              type: "button",
              className: "m-secondary m-small",
              onClick: () => {
                (playSfx("click"), back());
              },
            },
            "رجوع",
          ),
      ),
    );
  }
  function TeamScoreCards({ detailed = !1 }) {
    const stableTeams = teams.map((team, index) => ({ ...team, originalIndex: index })),
      rankById = new Map(
        stableTeams
          .slice()
          .sort((left, right) => right.score - left.score)
          .map((team, rank) => [team.id, rank]),
      );
    return hBeta(
      "div",
      { className: "m-team-scores" },
      stableTeams.map((team) => {
        const rank = rankById.get(team.id);
        return hBeta(
          "div",
          {
            key: team.id,
            className: `m-score-card ${turn === team.originalIndex && screen === "board" ? "is-turn" : ""}`,
            style: { "--team-color": TEAM_STYLE[team.originalIndex].solid },
          },
          hBeta(
            "span",
            { className: "m-rank", "aria-hidden": "true" },
            ["🥇", "🥈", "🥉", "4️⃣"][rank],
          ),
          hBeta(
            "div",
            { className: "m-score-main" },
            hBeta("strong", { className: "m-team-name" }, team.name),
            detailed
              ? hBeta("small", null, `إجابات ${team.correct} · سرقات ${team.steals}`)
              : turn === team.originalIndex &&
                  screen === "board" &&
                  hBeta("small", { className: "m-now-label" }, "الدور الآن"),
          ),
          hBeta("b", { className: "m-points", dir: "ltr" }, team.score),
        );
      }),
    );
  }
  function QuestionVisual({ question }) {
    const packId = current ? current.categoryId : null;
    const urls = questionMedia(question, packId),
      url = urls[0] || null,
      // نصّ السؤال يظهر فوق الوسائط حين يضيف شيئًا: الترويسة تعرض عبارة النوع
      // العامة، فلا داعي لتكرارها إن كتبها كاتب الحزمة كما هي.
      ownText =
        question.q && question.q.trim() && question.q.trim() !== TYPE_PROMPT[question.type]
          ? hBeta("p", { className: "m-question-text" }, question.q)
          : null;

    if (question.type === "image")
      return hBeta(
        "div",
        null,
        ownText,
        urls.length === 4
          ? hBeta(FourPics, { question, urls, revealed })
          : hBeta(MediaImage, { question, url, effect: question.effect || "none", revealed, onSfx: playSfx }),
      );
    if (question.type === "choice") {
      const options = question.options || [],
        isAnswer = (option) => arabicKey(option) === arabicKey(question.a);
      return hBeta(
        "div",
        null,
        hBeta("p", { className: "m-statement" }, question.q),
        hBeta(
          "div",
          { className: `m-options ${options.some((o) => String(o).length > 18) ? "is-long" : ""}` },
          options.map((option, index) =>
            hBeta(
              "span",
              { key: `${option}-${index}`, className: revealed && isAnswer(option) ? "is-answer" : "" },
              option,
            ),
          ),
        ),
      );
    }
    if (question.type === "code")
      return hBeta(
        "div",
        null,
        hBeta("div", { className: "m-code", dir: question.dir || "ltr", lang: /[A-Za-z]/.test(question.q || "") ? "en" : undefined }, question.q),
        question.hint && hBeta("p", { className: "m-hint" }, `تلميح: ${question.hint}`),
      );
    if (question.type === "audio") return hBeta("div", null, ownText, hBeta(MediaAudio, { url, revealed }));
    if (question.type === "video") return hBeta("div", null, ownText, hBeta(MediaVideo, { url }));
    if (question.type === "diff")
      return hBeta(
        "div",
        null,
        ownText,
        hBeta(
          "div",
          { className: "m-diff" },
          urls.map((one, index) =>
            hBeta(
              "div",
              { key: one, className: "m-diff-side" },
              hBeta(MediaBox, { url: one }, ({ onReady, onError }) =>
                hBeta("img", { src: one, alt: `الصورة ${index + 1}`, className: "m-media-img", onLoad: onReady, onError }),
              ),
              revealed &&
                question.spot &&
                hBeta("span", {
                  className: "m-diff-spot",
                  style: { insetInlineStart: `${question.spot.x}%`, top: `${question.spot.y}%`, width: `${question.spot.r * 2}%` },
                  "aria-hidden": "true",
                }),
            ),
          ),
        ),
      );
    if (question.type === "truefalse")
      return hBeta(
        "div",
        null,
        hBeta("p", { className: "m-statement" }, question.q),
        hBeta(
          "div",
          { className: "m-tf" },
          ["صح", "خطأ"].map((label) =>
            hBeta(
              "span",
              { key: label, className: revealed && String(question.a).trim() === label ? "is-answer" : "" },
              label,
            ),
          ),
        ),
      );
    if (question.type === "scramble") {
      const letters = question.letters || String(question.a || "").replace(/\s+/g, "").split("");
      return hBeta(
        "div",
        null,
        ownText,
        hBeta(
          "div",
          { className: "m-scramble", dir: "rtl" },
          (revealed ? String(question.a).replace(/\s+/g, "").split("") : letters).map((ch, index) =>
            hBeta("span", { key: `${ch}-${index}`, className: revealed ? "is-answer" : "" }, ch),
          ),
        ),
      );
    }
    if (question.type === "complete") {
      const parts = String(question.q || "").split("___");
      return hBeta(
        "p",
        { className: "m-complete" },
        parts[0],
        hBeta("span", { className: revealed ? "m-blank is-answer" : "m-blank" }, revealed ? question.a : "؟؟؟"),
        parts[1] || "",
      );
    }
    if (question.type === "common")
      return hBeta(
        "div",
        null,
        ownText,
        hBeta(
          "div",
          { className: "m-item-list" },
          (question.items || []).map((item, index) => hBeta("span", { key: `${item}-${index}` }, item)),
        ),
      );
    if (question.type === "hints") {
      const hints = question.hints || [];
      return hBeta(
        "div",
        null,
        ownText,
        hBeta(
          "div",
          { className: "m-hints" },
          hints.map((hint, index) =>
            hBeta(
              "div",
              { key: index, className: index < hintsUsed || revealed ? "is-open" : "" },
              index < hintsUsed || revealed ? hint : `تلميح ${index + 1}`,
            ),
          ),
        ),
        !revealed &&
          hintsUsed < hints.length &&
          hBeta(
            "button",
            {
              type: "button",
              className: "m-secondary m-small",
              onClick: () => { setHintsUsed((n) => n + 1); playSfx("click"); },
            },
            `اطلب تلميحًا (تُخصم ${HINT_COST_PERCENT}% من النقاط)`,
          ),
      );
    }
    if (question.type === "zoom")
      return hBeta(
        "div",
        { className: "m-visual-frame" },
        question.image
          ? hBeta("img", {
              src: question.image,
              alt: "صورة السؤال",
              className: revealed ? "m-zoom-image revealed" : "m-zoom-image",
            })
          : hBeta(
              "span",
              {
                className: revealed ? "m-zoom-emoji revealed" : "m-zoom-emoji",
                style: { transformOrigin: question.origin || "50% 50%" },
                role: "img",
                "aria-label": "صورة مقرّبة",
              },
              question.emoji,
            ),
      );
    if (question.type === "pic")
      return hBeta(
        "div",
        { className: "m-silhouette" },
        question.image
          ? hBeta("img", {
              src: question.image,
              alt: "ظل الصورة",
              className: revealed ? "revealed" : "",
            })
          : hBeta(
              "span",
              { className: revealed ? "revealed" : "", role: "img", "aria-label": "ظل صورة" },
              question.emoji,
            ),
      );
    if (question.type === "emoji")
      return hBeta(
        "div",
        null,
        hBeta("div", { className: "m-emoji-line", dir: "ltr" }, question.q),
        question.hint && hBeta("p", { className: "m-hint" }, `تلميح: ${question.hint}`),
      );
    if (question.type === "order") {
      const items = revealed ? question.items : mixedItems;
      return hBeta(
        "div",
        null,
        hBeta("p", { className: "m-question-text" }, question.q),
        hBeta(
          "div",
          { className: "m-item-list" },
          items.map((item, index) =>
            hBeta(
              "span",
              { key: `${item}-${index}`, className: revealed ? "is-answer" : "" },
              `${revealed ? `${index + 1}. ` : ""}${item}`,
            ),
          ),
        ),
      );
    }
    return question.type === "odd"
      ? hBeta(
          "div",
          { className: "m-odd-grid" },
          question.items.map((item, index) =>
            hBeta(
              "div",
              {
                key: `${item}-${index}`,
                className: revealed && index === question.odd ? "is-answer" : "",
              },
              item,
            ),
          ),
        )
      : question.type === "flag"
        ? hBeta(Flag, { spec: question.flag })
        : question.type === "grid"
          ? hBeta(
              "div",
              null,
              hBeta("p", { className: "m-question-text" }, question.q),
              hBeta(
                "div",
                { className: "m-focus-grid", dir: "ltr" },
                question.grid.map((row, rowIndex) =>
                  hBeta(
                    "div",
                    { key: rowIndex, className: "m-focus-row" },
                    row.map((cell, cellIndex) =>
                      hBeta(
                        "span",
                        {
                          key: `${rowIndex}-${cellIndex}`,
                          className: revealed && cell === question.target ? "is-answer" : "",
                        },
                        cell,
                      ),
                    ),
                  ),
                ),
              ),
            )
          : question.type === "sound"
            ? hBeta(
                "button",
                {
                  type: "button",
                  className: "m-sound-play",
                  onClick: () => playQuestionSound(question.sound),
                  disabled: !soundOn,
                  "aria-label": "تشغيل صوت السؤال",
                },
                hBeta("span", { "aria-hidden": "true" }, soundOn ? "🔊" : "🔇"),
                hBeta("b", null, soundOn ? "شغّل الصوت" : "الصوت مكتوم"),
              )
            : hBeta("p", { className: "m-question-text" }, question.q);
  }
  function HomeScreen() {
    const savedProgress = savedActive ? Object.keys(savedActive.used || {}).length : 0;
    return hBeta(
      "section",
      { className: "m-home" },
      hBeta("div", { className: "m-home-orbit", "aria-hidden": "true" }, "؟"),
      hBeta(
        "div",
        { className: "m-home-eyebrow" },
        hBeta("span", { "aria-hidden": "true" }),
        "لعبة مسابقات جماعية",
      ),
      hBeta(
        "div",
        { className: "m-logo", "aria-label": "بَديهة" },
        hBeta("span", null, "بَديهة"),
        hBeta("small", null, "BADEEHA"),
      ),
      hBeta(
        "div",
        { className: "m-home-copy" },
        hBeta("h1", { className: "m-home-title" }, "المعرفة تُحسم بالنقاط"),
        hBeta(
          "p",
          { className: "m-muted m-center" },
          "اختاروا الفئات، نافسوا أصدقاءكم، واحسموا الميدان.",
        ),
      ),
      hBeta(
        "div",
        { className: "m-home-stats", "aria-label": "معلومات اللعبة" },
        hBeta("span", null, hBeta("b", { dir: "ltr" }, CATS.length), " فئة"),
        hBeta("span", null, hBeta("b", { dir: "ltr" }, TOTAL_Q), " سؤال"),
        hBeta("span", null, HAS_MEDIA ? "الوسائط تُحفظ في الجهاز" : "تعمل دون إنترنت"),
      ),
      savedActive &&
        hBeta(
          "div",
          { className: "m-saved-card" },
          hBeta(
            "div",
            null,
            hBeta("b", null, "مباراة محفوظة"),
            hBeta("small", null, `${savedProgress} من ${savedActive.roundSize} سؤالًا`),
            hBeta(
              "span",
              { className: "m-saved-progress", "aria-hidden": "true" },
              hBeta("i", {
                style: {
                  width: `${Math.min(100, (savedProgress / savedActive.roundSize) * 100)}%`,
                },
              }),
            ),
          ),
          hBeta(
            "button",
            { type: "button", className: "m-primary", onClick: resumeGame },
            "متابعة",
          ),
          hBeta(
            "button",
            { type: "button", className: "m-link", onClick: discardSavedGame },
            "حذفها",
          ),
        ),
      hBeta(
        "div",
        { className: "m-home-actions" },
        hBeta(
          "button",
          {
            type: "button",
            className: "m-primary m-large m-hero-cta",
            onClick: () => {
              (setScreen("setup"), playSfx("click"), haptic("selection"));
            },
          },
          hBeta("span", { className: "m-cta-icon", "aria-hidden": "true" }, "▶"),
          hBeta(
            "span",
            null,
            hBeta("b", null, "ابدأ لعبة جديدة"),
            hBeta("small", null, "من فريقين إلى أربعة"),
          ),
        ),
        hBeta(
          "div",
          { className: "m-two" },
          hBeta(
            "button",
            {
              type: "button",
              className: "m-secondary",
              onClick: () => {
                (playSfx("click"), setScreen("history"));
              },
            },
            hBeta("span", { "aria-hidden": "true" }, "🏆"),
            " النتائج",
          ),
          hBeta(
            "button",
            {
              type: "button",
              className: "m-secondary",
              onClick: () => {
                (playSfx("click"), setShowRules(!0));
              },
            },
            hBeta("span", { "aria-hidden": "true" }, "؟"),
            " طريقة اللعب",
          ),
        ),
      ),
      hBeta("div", { className: "m-beta-badge" }, "نسخة تجريبية · يُحفظ تقدمك تلقائيًا"),
    );
  }
  function SetupScreen() {
    const filters = [
      ["all", "الكل"],
      ["info", "معلومات"],
      ["special", "خاصة"],
      ["pack", "الحزم"],
      ["favorites", "المفضلة"],
    ];
    return hBeta(
      "section",
      { className: "m-screen" },
      Header({ title: "جهّزوا الميدان", back: () => setScreen("home") }),
      hBeta(
        "div",
        { className: "m-panel m-setup-panel", "data-step": "١" },
        hBeta("h2", { className: "m-section-title" }, "الفرق"),
        hBeta(
          "div",
          { className: "m-segment", role: "group", "aria-label": "عدد الفرق" },
          [2, 3, 4].map((count) =>
            hBeta(
              "button",
              {
                key: count,
                type: "button",
                className: teams.length === count ? "selected" : "",
                onClick: () => setTeamCount(count),
                "aria-pressed": teams.length === count,
              },
              `${count} فرق`,
            ),
          ),
        ),
        hBeta(
          "div",
          { className: "m-team-inputs" },
          teams.map((team, index) =>
            hBeta(
              "label",
              {
                key: team.id,
                className: "m-team-input",
                style: { "--team-color": TEAM_STYLE[index].solid },
              },
              hBeta("span", null, `الفريق ${index + 1}`),
              hBeta("input", {
                value: team.name,
                onChange: (event) => setTeamName(index, event.target.value),
                maxLength: 28,
                autoComplete: "off",
              }),
            ),
          ),
        ),
      ),
      hBeta(
        "div",
        { className: "m-panel m-setup-panel", "data-step": "٢" },
        hBeta("h2", { className: "m-section-title" }, "نمط الصعوبة"),
        hBeta(
          "div",
          { className: "m-mode-grid" },
          Object.values(logic.MODES).map((item) =>
            hBeta(
              "button",
              {
                key: item.id,
                type: "button",
                className: `m-choice ${mode === item.id ? "selected" : ""}`,
                onClick: () => {
                  (setMode(item.id), playSfx("click"), haptic("selection"));
                },
                "aria-pressed": mode === item.id,
              },
              hBeta("span", { className: "m-choice-icon", "aria-hidden": "true" }, item.icon),
              hBeta("b", null, item.label),
              hBeta("small", null, item.description),
            ),
          ),
        ),
        hBeta("h2", { className: "m-section-title m-top" }, "طول الجولة"),
        hBeta(
          "div",
          { className: "m-segment", role: "group", "aria-label": "عدد الأسئلة" },
          logic.ROUND_SIZES.map((size) =>
            hBeta(
              "button",
              {
                key: size,
                type: "button",
                className: roundSize === size ? "selected" : "",
                onClick: () => {
                  (setRoundSize(size), playSfx("click"));
                },
                "aria-pressed": roundSize === size,
              },
              `${size} سؤالًا`,
            ),
          ),
        ),
        hBeta("h2", { className: "m-section-title m-top" }, "وقت السؤال"),
        hBeta(
          "div",
          { className: "m-segment", role: "group", "aria-label": "وقت السؤال" },
          [30, 60, 90].map((seconds) =>
            hBeta(
              "button",
              {
                key: seconds,
                type: "button",
                className: timerLength === seconds ? "selected" : "",
                onClick: () => {
                  (setTimerLength(seconds), playSfx("click"));
                },
                "aria-pressed": timerLength === seconds,
              },
              `${seconds} ثانية`,
            ),
          ),
        ),
      ),
      hBeta(
        "div",
        { className: "m-panel m-setup-panel", "data-step": "٣" },
        hBeta(
          "div",
          { className: "m-row-between" },
          hBeta("h2", { className: "m-section-title" }, "اختر 6 فئات"),
          hBeta(
            "b",
            { className: selectedCategories.length === 6 ? "m-count ok" : "m-count" },
            `${selectedCategories.length}/6`,
          ),
        ),
        hBeta(
          "label",
          { className: "m-search" },
          hBeta("span", { className: "sr-only" }, "ابحث عن فئة"),
          hBeta("span", { "aria-hidden": "true" }, "🔎"),
          hBeta("input", {
            value: categorySearch,
            onChange: (event) => setCategorySearch(event.target.value),
            placeholder: "ابحث عن فئة…",
          }),
        ),
        hBeta(
          "div",
          { className: "m-filter-row", role: "group", "aria-label": "تصفية الفئات" },
          filters.map(([id, label]) =>
            hBeta(
              "button",
              {
                key: id,
                type: "button",
                className: categoryFilter === id ? "selected" : "",
                onClick: () => {
                  (setCategoryFilter(id), playSfx("click"));
                },
                "aria-pressed": categoryFilter === id,
              },
              label,
            ),
          ),
        ),
        hBeta(
          "div",
          { className: "m-category-actions" },
          hBeta(
            "button",
            { type: "button", className: "m-secondary", onClick: randomCategories },
            "🎲 اختيار عشوائي",
          ),
          hBeta(
            "button",
            {
              type: "button",
              className: "m-secondary",
              onClick: () => {
                (setSelectedCategories([]), playSfx("click"));
              },
            },
            "مسح الاختيار",
          ),
        ),
        hBeta(
          "div",
          { className: "m-category-picker" },
          visibleCategories.map((category) => {
            const selected = selectedCategories.includes(category.id),
              favorite = favorites.includes(category.id),
              order = selectedCategories.indexOf(category.id) + 1;
            return hBeta(
              "div",
              { key: category.id, className: `m-category-pick ${selected ? "selected" : ""}` },
              hBeta(
                "button",
                {
                  type: "button",
                  className: "m-category-main",
                  onClick: () => toggleCategory(category.id),
                  "aria-pressed": selected,
                  "aria-label": `${selected ? "إلغاء" : "اختيار"} فئة ${category.name}`,
                },
                selected && hBeta("span", { className: "m-order-badge" }, order),
                hBeta(
                  "span",
                  { className: "m-category-icon", "aria-hidden": "true" },
                  category.icon,
                ),
                hBeta("b", null, category.name),
                hBeta("small", null, activeMode.tiers.length > 3 ? "حتى 1000" : "حتى 600"),
              ),
              hBeta(
                "button",
                {
                  type: "button",
                  className: "m-favorite",
                  onClick: () => toggleFavorite(category.id),
                  "aria-label": favorite
                    ? `إزالة ${category.name} من المفضلة`
                    : `إضافة ${category.name} إلى المفضلة`,
                  "aria-pressed": favorite,
                },
                favorite ? "★" : "☆",
              ),
            );
          }),
        ),
        visibleCategories.length === 0 &&
          hBeta("p", { className: "m-empty" }, "لا توجد فئات مطابقة."),
        hBeta(
          "div",
          { className: "m-history-note" },
          hBeta("span", null, `لُعب ${Object.keys(history).length} سؤالًا؛ الجديد له الأولوية.`),
          hBeta(
            "button",
            { type: "button", className: "m-link", onClick: clearQuestionHistory },
            "تصفير السجل",
          ),
        ),
      ),
      selectedMediaUrls.length > 0 && hBeta(OfflineMediaRow, null),
      setupError && hBeta("p", { className: "m-error", role: "alert" }, setupError),
      hBeta(
        "button",
        {
          type: "button",
          className: "m-primary m-large m-sticky-action",
          onClick: beginGame,
          disabled: selectedCategories.length !== 6,
        },
        `ابدأ ${roundSize} سؤالًا · ${activeMode.label}`,
      ),
    );
  }
  // الحزم ذات الوسائط تحتاج الإنترنت أول مرة فقط؛ هذا الزر يجلبها مقدّمًا
  // ويضعها في مخزن العامل الخدمي، فتُلعب بعدها بلا شبكة. لا يظهر للحزم النصية.
  const selectedMediaUrls = useMemo(() => {
    const urls = [];
    for (const categoryId of selectedCategories) {
      const category = CATS.find((item) => item.id === categoryId);
      if (!category) continue;
      for (const question of category.qs) urls.push(...questionMedia(question, categoryId));
    }
    return [...new Set(urls)];
  }, [selectedCategories]);

  function OfflineMediaRow() {
    const { state, done, total } = offlineMedia,
      count = selectedMediaUrls.length;
    return hBeta(
      "div",
      { className: "m-offline-row" },
      hBeta(
        "div",
        { className: "m-offline-text" },
        hBeta("b", null, "وسائط الفئات المختارة"),
        hBeta(
          "small",
          null,
          state === "busy"
            ? `يُحمَّل ${done} من ${total}…`
            : state === "done"
              ? "جاهزة للّعب دون إنترنت"
              : state === "error"
                ? "تعذّر تحميل بعض الملفات؛ ستُجلب عند فتح السؤال"
                : `${count} ملفًا · حمّلها الآن لتلعبوا دون إنترنت`,
        ),
      ),
      hBeta(
        "button",
        {
          type: "button",
          className: "m-secondary m-small",
          disabled: state === "busy" || state === "done",
          onClick: async () => {
            setOfflineMedia({ state: "busy", done: 0, total: count });
            const result = await cacheForOffline(selectedMediaUrls, {
              onProgress: ({ done: n, total: t }) =>
                setOfflineMedia({ state: "busy", done: n, total: t || count }),
            });
            setOfflineMedia({
              state: result && result.failed ? "error" : "done",
              done: count,
              total: count,
            });
          },
        },
        state === "busy" ? "…" : state === "done" ? "✓ جاهزة" : "حمّل",
      ),
    );
  }

  function BoardScreen() {
    return hBeta(
      "section",
      { className: "m-screen" },
      hBeta(
        "header",
        { className: "m-board-header" },
        hBeta(
          "div",
          null,
          hBeta(
            "div",
            { className: "m-kicker" },
            `${activeMode.icon} ${activeMode.label} · ${roundSize} سؤالًا`,
          ),
          hBeta(
            "div",
            { className: "m-current-turn", style: { "--team-color": TEAM_STYLE[turn].solid } },
            hBeta("span", { "aria-hidden": "true" }),
            hBeta("b", null, `الدور الآن: ${teams[turn].name}`),
          ),
        ),
        hBeta(
          "div",
          { className: "m-header-actions" },
          SoundButton(),
          hBeta(
            "button",
            {
              type: "button",
              className: "m-icon-btn",
              onClick: () => setShowScore(!0),
              "aria-label": "فتح النتائج وتعديل النقاط",
            },
            "📊",
          ),
        ),
      ),
      TeamScoreCards({}),
      hBeta(
        "div",
        { className: "m-board-grid" },
        selectedCategories.map((categoryId) => {
          const category = CATS.find((item) => item.id === categoryId),
            questions = deck[categoryId] || [];
          return hBeta(
            "article",
            { key: categoryId, className: "m-board-category" },
            hBeta(
              "h2",
              null,
              hBeta("span", { "aria-hidden": "true" }, category.icon),
              " ",
              category.name,
            ),
            hBeta(
              "div",
              { className: "m-question-buttons" },
              questions.map((question, index) => {
                const done = !!used[question.qid];
                return hBeta(
                  "button",
                  {
                    key: question.qid,
                    type: "button",
                    className: `m-tier m-tier-${question.p} ${done ? "done" : ""}`,
                    disabled: done,
                    onClick: () => openQuestion(categoryId, index),
                    "aria-label": `${category.name}، سؤال ${question.p} نقطة${done ? "، مستخدم" : ""}`,
                  },
                  hBeta("b", { dir: "ltr" }, question.p),
                  hBeta("small", null, done ? "تم" : MAYDAN_TIER_LABELS[question.p]),
                );
              }),
            ),
          );
        }),
      ),
      hBeta(
        "div",
        { className: "m-progress-wrap" },
        hBeta(
          "div",
          {
            className: "m-progress",
            role: "progressbar",
            "aria-valuemin": 0,
            "aria-valuemax": totalQuestions,
            "aria-valuenow": usedCount,
          },
          hBeta("span", {
            style: { width: `${totalQuestions ? (usedCount / totalQuestions) * 100 : 0}%` },
          }),
        ),
        hBeta("small", null, `${usedCount} من ${totalQuestions} سؤالًا`),
      ),
      hBeta(
        "div",
        { className: "m-board-actions" },
        hBeta(
          "button",
          {
            type: "button",
            className: "m-secondary",
            onClick: undoLastAction,
            disabled: !lastAction,
          },
          `↶ تراجع${lastAction ? `: ${lastAction.label}` : ""}`,
        ),
        confirmEnd
          ? hBeta(
              "div",
              { className: "m-confirm-inline" },
              hBeta("span", null, "إنهاء المباراة؟"),
              hBeta(
                "button",
                { type: "button", className: "m-danger", onClick: () => finishGame(!0) },
                "نعم",
              ),
              hBeta(
                "button",
                { type: "button", className: "m-secondary", onClick: () => setConfirmEnd(!1) },
                "لا",
              ),
            )
          : hBeta(
              "button",
              { type: "button", className: "m-link", onClick: () => setConfirmEnd(!0) },
              "إنهاء المباراة",
            ),
      ),
    );
  }
  function QuestionScreen() {
    if (!currentQuestion || !currentCategory) return null;
    const prompt = TYPE_PROMPT[currentQuestion.type],
      fraction = Math.max(0, Math.min(1, timeLeft / timerLength)),
      danger = timeLeft <= 10;
    return hBeta(
      "section",
      { className: "m-screen m-question-screen" },
      hBeta(
        "header",
        { className: "m-question-header" },
        hBeta(
          "button",
          {
            type: "button",
            className: "m-secondary m-small",
            onClick: cancelQuestion,
            disabled: revealed,
          },
          "إلغاء السؤال",
        ),
        hBeta(
          "div",
          { className: "m-question-meta" },
          hBeta("span", null, `${currentCategory.icon} ${currentCategory.name}`),
          hBeta(
            "b",
            { className: `m-tier-text m-tier-text-${currentQuestion.p}` },
            hBeta(
              "span",
              { dir: "ltr" },
              effect.double ? currentQuestion.p * 2 : currentQuestion.p,
            ),
            " نقطة",
            hBeta(
              "small",
              null,
              effect.double ? "×2 مفعّل" : MAYDAN_TIER_LABELS[currentQuestion.p],
            ),
          ),
        ),
        SoundButton(),
      ),
      hBeta(
        "div",
        { className: "m-turn-banner", style: { "--team-color": TEAM_STYLE[turn].solid } },
        hBeta("span", { "aria-hidden": "true" }),
        hBeta("strong", null, `السؤال لـ ${teams[turn].name}`),
        effect.two && hBeta("b", null, "جوابان مفعّلان"),
      ),
      hBeta(
        "div",
        {
          className: `m-timer ${danger ? "danger" : ""} ${paused ? "paused" : ""}`,
          style: { "--timer-fill": `${fraction * 360}deg` },
        },
        hBeta(
          "div",
          {
            className: "m-timer-inner",
            role: "timer",
            "aria-live": [10, 5, 0].includes(timeLeft) ? "assertive" : "off",
            "aria-label": `${timeLeft} ثانية متبقية`,
          },
          hBeta("b", { dir: "ltr" }, timeLeft),
          paused && hBeta("small", null, "متوقف"),
        ),
      ),
      !revealed &&
        timeLeft > 0 &&
        hBeta(
          "button",
          { type: "button", className: "m-secondary m-pause", onClick: togglePause },
          paused ? "▶ متابعة الوقت" : "⏸ إيقاف مؤقت",
        ),
      !revealed &&
        timeLeft <= 0 &&
        hBeta("p", { className: "m-timeout", role: "alert" }, "انتهى الوقت ⏰"),
      hBeta(
        "article",
        { className: `m-question-card ${revealed ? "is-revealed" : ""}` },
        prompt && hBeta("p", { className: "m-prompt" }, prompt),
        QuestionVisual({ question: currentQuestion }),
        revealed &&
          hBeta(
            "div",
            { className: "m-answer", role: "status" },
            hBeta("small", null, "الإجابة"),
            hBeta("strong", null, answerText(currentQuestion)),
            // الصيغ المقبولة الأخرى (اسم بلغتين، لقب) تظهر للمضيف كي لا يظلم إجابة صحيحة بصياغة مختلفة
            Array.isArray(currentQuestion.alt) &&
              currentQuestion.alt.length > 0 &&
              hBeta("span", { className: "m-answer-alt" }, `يُقبل أيضًا: ${currentQuestion.alt.join(" · ")}`),
          ),
      ),
      !revealed &&
        hBeta(
          "div",
          { className: "m-tools" },
          hBeta("p", null, `وسائل ${teams[turn].name}`),
          hBeta(
            "div",
            null,
            TOOLS.map((tool) => {
              const available = teams[turn].tools[tool.id] && timeLeft > 0;
              return hBeta(
                "button",
                {
                  key: tool.id,
                  type: "button",
                  className: `${available ? "" : "used"} ${effect[tool.id] ? "active" : ""}`,
                  disabled: !available,
                  onClick: () => useTool(tool.id),
                  title: tool.hint,
                },
                hBeta("span", { "aria-hidden": "true" }, tool.icon),
                hBeta("b", null, tool.label),
                hBeta("small", null, effect[tool.id] ? "مفعّلة" : available ? "متاحة" : "استُخدمت"),
              );
            }),
          ),
        ),
      revealed
        ? hBeta(
            "div",
            { className: "m-judge" },
            hBeta(
              "div",
              { className: "m-row-between" },
              hBeta(
                "h2",
                null,
                currentQuestion.type === "closest" ? "من كان الأقرب؟" : "من أجاب إجابة صحيحة؟",
              ),
              hBeta(
                "button",
                {
                  type: "button",
                  className: "m-link",
                  onClick: () =>
                    setReportQuestion({
                      categoryId: current.categoryId,
                      question: currentQuestion,
                    }),
                },
                "⚑ بلّغ عن السؤال",
              ),
            ),
            hBeta(
              "div",
              { className: "m-judge-grid" },
              teams.map((team, index) =>
                hBeta(
                  "button",
                  {
                    key: team.id,
                    type: "button",
                    style: { "--team-color": TEAM_STYLE[index].solid },
                    onClick: () => judgeQuestion(index),
                  },
                  hBeta("span", { "aria-hidden": "true" }, "✓"),
                  hBeta("b", null, team.name),
                  hBeta(
                    "small",
                    null,
                    index === turn && effect.double
                      ? "إجابة صحيحة · نقاط مضاعفة"
                      : currentQuestion.type !== "closest" && index !== turn
                        ? "إجابة صحيحة · سرقة"
                        : "إجابة صحيحة",
                  ),
                ),
              ),
            ),
            hBeta(
              "button",
              {
                type: "button",
                className: "m-secondary m-nobody",
                onClick: () => judgeQuestion(null),
              },
              "لم يجب أحد",
            ),
          )
        : hBeta(
            "button",
            {
              type: "button",
              className: "m-primary m-large m-reveal-action",
              onClick: revealAnswer,
            },
            hBeta("span", { "aria-hidden": "true" }, "◉"),
            " أظهر الإجابة",
          ),
    );
  }
  function ResultScreen() {
    const record = finalResult || results[0];
    if (!record) return HomeScreen();
    const winners = record.winner
      ? [record.winner]
      : record.teams
          .filter((team) => team.score === Math.max(...record.teams.map((team2) => team2.score)))
          .map((team) => team.name);
    return hBeta(
      "section",
      { className: "m-result" },
      hBeta(
        "div",
        { className: "m-confetti", "aria-hidden": "true" },
        Array.from({ length: 28 }, (_, index) =>
          hBeta("i", { key: index, style: { "--i": index } }),
        ),
      ),
      hBeta(
        "div",
        { className: "m-winner-spotlight" },
        hBeta(
          "div",
          { className: "m-result-icon", "aria-hidden": "true" },
          record.winner ? "🏆" : "🤝",
        ),
        hBeta(
          "p",
          { className: "m-kicker" },
          record.early ? "انتهت المباراة مبكرًا" : "اكتملت الجولة",
        ),
        hBeta(
          "h1",
          { className: "m-result-title" },
          record.winner ? `فاز ${winners[0]}` : "تعادل جميل!",
        ),
      ),
      hBeta(
        "div",
        { className: "m-result-scores" },
        record.teams
          .slice()
          .sort((a, b) => b.score - a.score)
          .map((team) =>
            hBeta(
              "div",
              { key: team.id },
              hBeta("b", null, team.name),
              hBeta("strong", null, team.score),
              hBeta("small", null, `✅ ${team.correct} · 🥷 ${team.steals}`),
            ),
          ),
      ),
      hBeta(
        "p",
        { className: "m-muted" },
        `${record.answered} من ${record.total} سؤالًا · ${logic.MODES[record.mode] ? logic.MODES[record.mode].label : "بَديهة"}`,
      ),
      hBeta(
        "div",
        { className: "m-result-actions" },
        hBeta(
          "button",
          { type: "button", className: "m-primary m-large", onClick: beginGame },
          "إعادة بنفس الإعدادات",
        ),
        hBeta(
          "button",
          { type: "button", className: "m-secondary", onClick: shareResult },
          "مشاركة النتيجة",
        ),
        hBeta(
          "div",
          { className: "m-two" },
          hBeta(
            "button",
            { type: "button", className: "m-secondary", onClick: () => setScreen("setup") },
            "لعبة جديدة",
          ),
          hBeta(
            "button",
            { type: "button", className: "m-secondary", onClick: () => setScreen("history") },
            "سجل النتائج",
          ),
        ),
      ),
    );
  }
  function HistoryScreen() {
    const leaderboard = {};
    results.forEach((result) =>
      result.teams.forEach((team) => {
        const key = logic.normalizeTeamName(team.name),
          item = leaderboard[key] || { name: team.name, games: 0, wins: 0, points: 0 };
        ((item.games += 1),
          (item.points += team.score),
          result.winner && logic.normalizeTeamName(result.winner) === key && (item.wins += 1),
          (leaderboard[key] = item));
      }),
    );
    const honor = Object.values(leaderboard)
      .sort((left, right) => right.wins - left.wins || right.points - left.points)
      .slice(0, 10);
    return hBeta(
      "section",
      { className: "m-screen" },
      Header({ title: "النتائج والتقارير", back: () => setScreen("home") }),
      hBeta(
        "div",
        { className: "m-panel" },
        hBeta("h2", { className: "m-section-title" }, "لوحة الشرف"),
        honor.length
          ? hBeta(
              "div",
              { className: "m-honor" },
              honor.map((item, index) =>
                hBeta(
                  "div",
                  { key: logic.normalizeTeamName(item.name) },
                  hBeta("span", null, ["🥇", "🥈", "🥉"][index] || index + 1),
                  hBeta("b", null, item.name),
                  hBeta("small", null, `${item.wins} فوز · ${item.games} مباراة`),
                  hBeta("strong", null, item.points),
                ),
              ),
            )
          : hBeta("p", { className: "m-empty" }, "تظهر لوحة الشرف بعد أول مباراة."),
      ),
      hBeta(
        "div",
        { className: "m-panel" },
        hBeta(
          "div",
          { className: "m-row-between" },
          hBeta("h2", { className: "m-section-title" }, "آخر المباريات"),
          results.length > 0 &&
            hBeta(
              "button",
              { type: "button", className: "m-link", onClick: clearResults },
              "مسح السجل",
            ),
        ),
        results.length
          ? hBeta(
              "div",
              { className: "m-games-list" },
              results.slice(0, 20).map((result) =>
                hBeta(
                  "article",
                  { key: result.id },
                  hBeta(
                    "div",
                    { className: "m-row-between" },
                    hBeta("small", null, result.date),
                    hBeta("small", null, `${result.answered}/${result.total}`),
                  ),
                  hBeta(
                    "div",
                    null,
                    result.teams.map((team) =>
                      hBeta(
                        "span",
                        {
                          key: `${result.id}-${team.id || team.name}`,
                          className: result.winner === team.name ? "winner" : "",
                        },
                        `${result.winner === team.name ? "🏆 " : ""}${team.name}: ${team.score}`,
                      ),
                    ),
                  ),
                ),
              ),
            )
          : hBeta("p", { className: "m-empty" }, "لا توجد مباريات محفوظة بعد."),
      ),
      hBeta(
        "div",
        { className: "m-panel" },
        hBeta(
          "div",
          { className: "m-row-between" },
          hBeta("h2", { className: "m-section-title" }, "بلاغات الأسئلة"),
          hBeta("b", { className: "m-count" }, reports.length),
        ),
        hBeta(
          "p",
          { className: "m-muted" },
          "تُحفظ البلاغات على هذا الجهاز لتجميع ملاحظات النسخة التجريبية.",
        ),
        reports.length > 0 &&
          hBeta(
            "button",
            { type: "button", className: "m-secondary m-full", onClick: shareReports },
            "مشاركة تقرير الاختبار",
          ),
      ),
    );
  }
  function RulesModal() {
    return hBeta(
      MaydanModal,
      { title: "كيف نلعب؟", onClose: () => setShowRules(!1) },
      hBeta(
        "ol",
        { className: "m-rules" },
        hBeta("li", null, "أنشئ من فريقين إلى أربعة بأسماء مختلفة، ثم اختر ست فئات."),
        hBeta("li", null, "اختر الجولة: 20 سريعة، 30 متوسطة، أو 60 كاملة."),
        hBeta("li", null, "الوضع العائلي يصل إلى 600، التحدّي يضيف 800، والخبراء يضيف 1000."),
        hBeta("li", null, "800 صعب جدًا، و1000 مستوى مستحيل؛ لا يظهران إلا في الوضع المناسب."),
        hBeta(
          "li",
          null,
          "بعد كشف الإجابة، اختر الفريق الذي أجاب. في «الأقرب» لا تُحسب الإجابة سرقة.",
        ),
        hBeta("li", null, "لكل فريق: مضاعفة النقاط، جوابان، و30 ثانية إضافية؛ كل أداة مرة واحدة."),
        hBeta(
          "li",
          null,
          "يمكن إلغاء السؤال قبل كشف الإجابة، والتراجع عن آخر نتيجة أو تعديل النقاط يدويًا.",
        ),
        hBeta("li", null, "تُحفظ المباراة تلقائيًا، ويمكن متابعتها بعد إغلاق التطبيق."),
      ),
      hBeta(
        "button",
        { type: "button", className: "m-primary m-full", onClick: () => setShowRules(!1) },
        "فهمت",
      ),
    );
  }
  function ScoreModal() {
    return hBeta(
      MaydanModal,
      { title: "النتائج وتعديل النقاط", onClose: () => setShowScore(!1), bottom: !0 },
      TeamScoreCards({ detailed: !0 }),
      hBeta(
        "div",
        { className: "m-adjust-list" },
        teams.map((team, index) =>
          hBeta(
            "div",
            { key: team.id },
            hBeta("b", null, team.name),
            hBeta(
              "button",
              {
                type: "button",
                className: "m-danger",
                onClick: () => adjustScore(index, -100),
                "aria-label": `خصم 100 من ${team.name}`,
              },
              "−100",
            ),
            hBeta(
              "button",
              {
                type: "button",
                className: "m-success",
                onClick: () => adjustScore(index, 100),
                "aria-label": `إضافة 100 إلى ${team.name}`,
              },
              "+100",
            ),
          ),
        ),
      ),
      hBeta(
        "button",
        {
          type: "button",
          className: "m-secondary m-full",
          onClick: undoLastAction,
          disabled: !lastAction,
        },
        "↶ تراجع عن آخر تعديل",
      ),
    );
  }
  function ReportModal() {
    const reasons = [
      "معلومة أو إجابة خاطئة",
      "السؤال غامض",
      "الصعوبة في غير مكانها",
      "مشكلة في الصورة أو الصوت",
    ];
    return hBeta(
      MaydanModal,
      { title: "بلاغ عن السؤال", onClose: () => setReportQuestion(null) },
      hBeta("p", { className: "m-muted" }, "اختر سبب البلاغ. سيُحفظ محليًا ضمن تقرير الاختبار."),
      hBeta(
        "div",
        { className: "m-report-reasons" },
        reasons.map((reason) =>
          hBeta(
            "button",
            {
              key: reason,
              type: "button",
              className: "m-secondary",
              onClick: () => submitReport(reason),
            },
            reason,
          ),
        ),
      ),
    );
  }
  let content = null;
  return (
    screen === "home"
      ? (content = HomeScreen())
      : screen === "setup"
        ? (content = SetupScreen())
        : screen === "board"
          ? (content = BoardScreen())
          : screen === "question"
            ? (content = QuestionScreen())
            : screen === "result"
              ? (content = ResultScreen())
              : screen === "history" && (content = HistoryScreen()),
    hBeta(
      "div",
      { dir: "rtl", className: `m-root m-screen-${screen}` },
      hBeta("style", null, MAYDAN_BETA_CSS),
      content,
      showRules && RulesModal(),
      showScore && ScoreModal(),
      reportQuestion && ReportModal(),
      notice && hBeta("div", { className: "m-toast", role: "status" }, notice),
      !hydrated &&
        hBeta("div", { className: "m-hydrating", "aria-label": "جارٍ استعادة البيانات" }, "…"),
    )
  );
}


export default MaydanBeta;

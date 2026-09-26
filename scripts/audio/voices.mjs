// آلات ميدان: ألوان خشبية ومعدنية دافئة (كالمبا، ماريمبا، أجراس زجاجية، عود مقطوف)، بطانة
// ناعمة، ناي، ودفّ ورقّ. كل دالة تُرجع Float64Array أحادية بطول n عينة (أو Stereo حيث ذُكر).
import { SR, TAU, secs, tone, fm, partials, noise, filter, sweep, applyEnv, gain, sum, pluck, perc, adsr, expDecay, rng, Stereo, chorus, stereo } from './engine.mjs';

const hi = (f) => f; // اختصار للقراءة
export const NOTE = { C: 0, Db: 1, D: 2, Eb: 3, E: 4, F: 5, Gb: 6, G: 7, Ab: 8, A: 9, Bb: 10, B: 11 };
export const m = (name, octave) => 12 * (octave + 1) + NOTE[name]; // m('D', 4) = 62

// ── كالمبا: أساس قوي مع شريك لا متناسق حاد يتلاشى بسرعة، ونقرة إبهام قصيرة ─────
export function kalimba(freq, dur = 1.2, { bright = 1, seed = 3 } = {}) {
  const n = secs(dur);
  const body = partials(n, freq, [
    { r: 1, g: 1, tau: 0.55 + 90 / freq }, { r: 5.42, g: 0.32 * bright, tau: 0.09 }, { r: 12.6, g: 0.06 * bright, tau: 0.04 },
  ], { attack: 0.0015, pitchDip: 0.006 });
  const click = applyEnv(filter(noise(secs(0.006), { seed }), 'bandpass', 3800, 1.2), perc(0.0005, 0.0015));
  return sum(body, gain(click, 0.35));
}
// ── ماريمبا: خشب دافئ (1 : 3.93 : 9.9) وضربة مضرب لبّادية ──────────────────────
export function marimba(freq, dur = 1.0, { soft = 0.5, seed = 5 } = {}) {
  const n = secs(dur);
  const decay = Math.min(1.1, 0.25 + 260 / freq);
  const body = partials(n, freq, [
    { r: 1, g: 1, tau: decay }, { r: 3.93, g: 0.22 * (1 - soft * 0.5), tau: decay * 0.18 }, { r: 9.9, g: 0.05 * (1 - soft), tau: decay * 0.06 },
  ], { attack: 0.002, pitchDip: 0.003 });
  const thump = applyEnv(filter(noise(secs(0.02), { seed }), 'lowpass', 1400 + 2200 * (1 - soft), 0.8), perc(0.0008, 0.004));
  return sum(body, gain(thump, 0.6));
}
// ── جرس زجاجي: FM بنسبة لا متناسقة ودليل يتلاشى، ذيل طويل ناعم ───────────────
export function bell(freq, dur = 2.2, { ratio = 1.4, index = 2.2, tau = 0.9 } = {}) {
  const n = secs(dur);
  const core = fm(n, freq, { ratio, index: (t) => index * Math.exp(-t / (tau * 0.5)), env: perc(0.002, tau) });
  const shimmer = fm(n, freq * 2.01, { ratio: 3.5, index: (t) => 0.8 * Math.exp(-t / 0.2), env: perc(0.001, tau * 0.35) });
  return sum(core, gain(shimmer, 0.2));
}
// ── نقر زجاجي قصير لامع (للكشف والاختيار) ────────────────────────────────────
export function glass(freq, dur = 0.6) {
  const n = secs(dur);
  return sum(
    partials(n, freq, [{ r: 1, g: 1, tau: 0.28 }, { r: 2.76, g: 0.35, tau: 0.12 }, { r: 5.4, g: 0.15, tau: 0.06 }], { attack: 0.001 }),
    gain(applyEnv(filter(noise(secs(0.004), { seed: 9 }), 'highpass', 5000, 0.9), perc(0.0003, 0.001)), 0.25),
  );
}
// ── وتر مقطوف (عود/قانون دافئ): Karplus–Strong مع جسم رنّان ─────────────────────
export function oud(freq, dur = 1.6, { seed = 4, bright = 0.42 } = {}) {
  const n = secs(dur);
  const string = pluck(n, freq, { decay: 0.9965 - 60 / SR, brightness: bright, seed, pick: 0.17 });
  filter(string, 'peak', 240, 1.1, 4); filter(string, 'lowpass', 5200, 0.7);
  return applyEnv(string, (t) => (t < 0.003 ? t / 0.003 : 1) * Math.min(1, (dur - t) / 0.05));
}
// ── بطانة: ثلاثة مناشير منزاحة + جيب فرعي، مرشّح منخفض يتنفّس، ثم كورس ─────────
export function pad(freq, dur = 4, { a = 1.2, r = 1.8, cutoff = 900, sweepAmt = 500, lfo = 0.12 } = {}) {
  const n = secs(dur + r + 0.2), env = adsr({ a, d: 0.6, s: 0.85, r, curve: 2.5 }, dur);
  const voices = sum(
    tone(n, freq, { type: 'saw', detune: -6 }), tone(n, freq, { type: 'saw', detune: 7 }), gain(tone(n, freq * 2, { type: 'tri', detune: 3 }), 0.35),
    gain(tone(n, freq / 2, { type: 'sine' }), 0.5),
  );
  sweep(voices, 'lowpass', (t) => cutoff + sweepAmt * (1 - Math.exp(-t / 1.4)) + 120 * Math.sin(TAU * lfo * t), 0.8);
  applyEnv(voices, env);
  return gain(voices, 0.22);
}
// ── ناي: جيب + توافقية ثانية، نفس هوائي، اهتزاز يبدأ متأخرًا ─────────────────────
export function ney(freq, dur = 1.5, { vib = 6, vibDepth = 7, breath = 0.35 } = {}) {
  const n = secs(dur + 0.3), env = adsr({ a: 0.09, d: 0.2, s: 0.8, r: 0.25, curve: 2 }, dur);
  const drift = (t) => (t > 0.25 ? vibDepth * Math.sin(TAU * vib * (t - 0.25)) * Math.min(1, (t - 0.25) / 0.4) : 0) - 12 * Math.exp(-t / 0.05);
  const body = sum(tone(n, freq, { type: 'sine', drift }), gain(tone(n, freq * 2, { type: 'sine', drift }), 0.28), gain(tone(n, freq * 3, { type: 'sine', drift }), 0.07));
  const air = filter(noise(n, { seed: 21, color: 'pink' }), 'bandpass', freq * 2, 2.5);
  filter(air, 'highpass', 1200, 0.7);
  const mix = sum(body, gain(air, breath * 0.6));
  return applyEnv(mix, env);
}
// ── دفّ: «دُم» غليظ (مسح تردد) و«تَك» جاف ─────────────────────────────────────
export function dum(dur = 0.5, { f0 = 95, f1 = 52, seed = 31 } = {}) {
  const n = secs(dur);
  const body = tone(n, (t) => f1 + (f0 - f1) * Math.exp(-t / 0.06), { type: 'sine', env: perc(0.002, 0.16) });
  const skin = applyEnv(filter(noise(secs(0.03), { seed }), 'bandpass', 900, 1.0), perc(0.001, 0.006));
  return sum(body, gain(skin, 0.5));
}
export function tak(dur = 0.18, { seed = 37, tone: f = 2600 } = {}) {
  const n = secs(dur);
  const snap = applyEnv(filter(noise(n, { seed }), 'bandpass', f, 1.6), perc(0.0005, 0.02));
  const ring = applyEnv(tone(n, f * 0.62, { type: 'sine' }), perc(0.0005, 0.03));
  return sum(snap, gain(ring, 0.5));
}
export function shaker(dur = 0.12, { seed = 41, open = 0.4 } = {}) {
  const n = secs(dur);
  return applyEnv(filter(noise(n, { seed }), 'highpass', 5200, 0.8), perc(0.004, 0.02 + open * 0.05));
}
// ── هواء: ضوضاء وردية بمرشّح نطاقي يُمسَح — «هوش» الانتقال ──────────────────────
export function whoosh(dur = 0.42, { from = 320, to = 2600, q = 0.9, seed = 51, shape = 0.5 } = {}) {
  const n = secs(dur);
  const air = noise(n, { seed, color: 'pink' });
  sweep(air, 'bandpass', (t) => from * (to / from) ** Math.min(1, t / (dur * 0.85)), q);
  return applyEnv(air, (t) => { const x = t / dur; return Math.sin(Math.PI * Math.min(1, x)) ** (1 / Math.max(0.2, shape)); });
}
// ── ضربة سفلية ناعمة ────────────────────────────────────────────────────────────
export function thump(dur = 0.6, { f0 = 140, f1 = 38 } = {}) {
  const n = secs(dur);
  return tone(n, (t) => f1 + (f0 - f1) * Math.exp(-t / 0.045), { type: 'sine', env: perc(0.001, 0.2) });
}
// ── تكّة خشبية (مؤقت) ───────────────────────────────────────────────────────────
export function woodTick(freq = 2100, dur = 0.05, { seed = 61 } = {}) {
  const n = secs(dur);
  return sum(
    applyEnv(tone(n, freq, { type: 'sine' }), perc(0.0005, 0.011)),
    gain(applyEnv(filter(noise(n, { seed }), 'bandpass', freq * 1.7, 2.2), perc(0.0003, 0.004)), 0.6),
  );
}
// ── صفّارة دافئة (انتهاء الوقت): موجة مربعة منخفضة بمرشّح ورعشة، لا حادة ─────────
export function buzz(freq = 112, dur = 0.55, { trem = 13 } = {}) {
  const n = secs(dur);
  const raw = sum(tone(n, freq, { type: 'square' }), gain(tone(n, freq * 1.005, { type: 'saw' }), 0.5));
  filter(raw, 'lowpass', 900, 0.9); filter(raw, 'highpass', 70, 0.7);
  return applyEnv(raw, (t) => adsr({ a: 0.01, d: 0.05, s: 0.9, r: 0.08, curve: 2 }, dur - 0.08)(t) * (0.72 + 0.28 * Math.sin(TAU * trem * t)));
}

// ── ستيريو مساعد: توزيع يمين/يسار مع اتساع خفيف ────────────────────────────────
export const place = (mono, pan = 0, width = 0.15) => stereo(mono, { pan, width, delayMs: 7 });
export const padStereo = (mono) => chorus(stereo(mono, { pan: 0, width: 0.35, delayMs: 11 }), { rate: 0.3, depth: 0.0035, mix: 0.45 });

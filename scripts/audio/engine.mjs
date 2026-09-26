// محرّك تركيب صوتي حتمي بلا اعتماديات: كل مؤثر ومقطع موسيقى في ميدان يُولَّد من هذا
// الملف ونصوص التصميم المجاورة، فيعاد إنتاج البتات نفسها من البذرة نفسها. يُصدِر
// موجات 48 kHz ستيريو PCM24، ويستعين بـ ffmpeg-static للصدى الالتفافي (afir) والقياس
// (EBU R128) والحدّ الأعلى الحقيقي للذروة عند الإتقان النهائي.
import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import path from 'node:path';

export const SR = 48000;
export const TAU = Math.PI * 2;
export const midi = (n) => 440 * 2 ** ((n - 69) / 12);
export const db = (x) => 10 ** (x / 20);
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const secs = (n) => Math.round(n * SR);
const run = promisify(execFile);
export const ffmpeg = createRequire(import.meta.url)('ffmpeg-static');

// ── عشوائية حتمية ─────────────────────────────────────────────────────────
export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── مخازن ─────────────────────────────────────────────────────────────────
export class Stereo {
  // بالثواني؛ ولعدد عينات صريح استعمل Stereo.ofSamples(n).
  constructor(seconds) { const n = secs(seconds); this.L = new Float64Array(n); this.R = new Float64Array(n); }
  static ofSamples(n) { const st = new Stereo(0); st.L = new Float64Array(n); st.R = new Float64Array(n); return st; }
  get length() { return this.L.length; }
  get seconds() { return this.L.length / SR; }
  // خلط أحادي أو ستيريو عند زمن معيّن مع كسب وتوزيع (pan في [-1, 1]، قانون ثابت الطاقة).
  mix(source, at = 0, { gain = 1, pan = 0 } = {}) {
    const start = secs(at);
    const angle = (pan + 1) * Math.PI / 4;
    const gl = Math.cos(angle) * Math.SQRT2 * gain, gr = Math.sin(angle) * Math.SQRT2 * gain;
    if (source instanceof Stereo) {
      const n = Math.min(source.length, this.length - start);
      for (let i = 0; i < n; i++) { this.L[start + i] += source.L[i] * (pan <= 0 ? 1 : 1 - pan) * gain; this.R[start + i] += source.R[i] * (pan >= 0 ? 1 : 1 + pan) * gain; }
      return this;
    }
    const n = Math.min(source.length, this.length - start);
    for (let i = 0; i < n; i++) { const v = source[i]; this.L[start + i] += v * gl; this.R[start + i] += v * gr; }
    return this;
  }
  peak() { let p = 0; for (let i = 0; i < this.length; i++) { const a = Math.abs(this.L[i]), b = Math.abs(this.R[i]); if (a > p) p = a; if (b > p) p = b; } return p; }
  scale(g) { for (let i = 0; i < this.length; i++) { this.L[i] *= g; this.R[i] *= g; } return this; }
  normalize(peakDb = -3) { const p = this.peak(); if (p > 0) this.scale(db(peakDb) / p); return this; }
  fade(inSec = 0.002, outSec = 0.01) {
    const a = secs(inSec), r = secs(outSec), n = this.length;
    for (let i = 0; i < a && i < n; i++) { const g = i / a; this.L[i] *= g; this.R[i] *= g; }
    for (let i = 0; i < r && i < n; i++) { const g = i / r; this.L[n - 1 - i] *= g; this.R[n - 1 - i] *= g; }
    return this;
  }
  slice(fromSec, toSec) {
    const a = secs(fromSec), b = Math.min(this.length, secs(toSec));
    const out = Stereo.ofSamples(b - a); out.L.set(this.L.subarray(a, b)); out.R.set(this.R.subarray(a, b)); return out;
  }
  // منحنى كسب زمني (لتلاشٍ أو تنفّس أو نبض جانبي).
  gainCurve(fn) { for (let i = 0; i < this.length; i++) { const g = fn(i / SR); this.L[i] *= g; this.R[i] *= g; } return this; }
  softClip(drive = 1) { for (let i = 0; i < this.length; i++) { this.L[i] = Math.tanh(this.L[i] * drive) / Math.tanh(drive); this.R[i] = Math.tanh(this.R[i] * drive) / Math.tanh(drive); } return this; }
}

// ── مغلّفات ───────────────────────────────────────────────────────────────
// ADSR بزمن ثوانٍ؛ يعيد دالة t → مستوى، مع دوام dur قبل الإطلاق.
export function adsr({ a = 0.01, d = 0.1, s = 0.7, r = 0.2, curve = 3 } = {}, dur = 0.5) {
  return (t) => {
    if (t < 0) return 0;
    if (t < a) return t / a;
    if (t < a + d) { const x = (t - a) / d; return 1 - (1 - s) * (1 - Math.exp(-curve * x)) / (1 - Math.exp(-curve)); }
    if (t < dur) return s;
    const x = (t - dur) / r; return x >= 1 ? 0 : s * Math.exp(-curve * x) * (1 - x);
  };
}
export const expDecay = (tau) => (t) => (t < 0 ? 0 : Math.exp(-t / tau));
export const perc = (attack, tau) => (t) => (t < 0 ? 0 : t < attack ? t / attack : Math.exp(-(t - attack) / tau));

// ── مولّدات أحادية ───────────────────────────────────────────────────────
export function tone(n, freq, { type = 'sine', phase = 0, detune = 0, drift = null, env = null } = {}) {
  const out = new Float64Array(n);
  let ph = phase;
  const base = typeof freq === 'function' ? freq : () => freq;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    let f = base(t) * 2 ** (detune / 1200);
    if (drift) f *= 2 ** (drift(t) / 1200);
    const dt = f / SR;
    let v;
    if (type === 'sine') v = Math.sin(TAU * ph);
    else if (type === 'tri') v = 1 - 4 * Math.abs(Math.round(ph - 0.25) - (ph - 0.25));
    else if (type === 'saw') { v = 2 * ph - 1; v -= polyBlep(ph, dt); }
    else if (type === 'square') { v = ph < 0.5 ? 1 : -1; v += polyBlep(ph, dt); v -= polyBlep((ph + 0.5) % 1, dt); }
    else v = Math.sin(TAU * ph);
    out[i] = env ? v * env(t) : v;
    ph += dt; if (ph >= 1) ph -= 1;
  }
  return out;
}
function polyBlep(t, dt) {
  if (t < dt) { t /= dt; return t + t - t * t - 1; }
  if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
  return 0;
}
// تعديل ترددي (Chowning): حامل × معدِّل بنسبة ratio ودليل index(t).
export function fm(n, freq, { ratio = 1.4, index = () => 2, env = null, phase = 0 } = {}) {
  const out = new Float64Array(n);
  let pc = phase, pm = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const m = Math.sin(TAU * pm) * index(t);
    out[i] = Math.sin(TAU * pc + m) * (env ? env(t) : 1);
    pc += freq / SR; pm += freq * ratio / SR;
    if (pc >= 1) pc -= 1; if (pm >= 1) pm -= 1;
  }
  return out;
}
// جمع توافقيات (لا متناسقة للخشب والمعدن): كل شريك بنسبة تردد وكسب وزمن تلاشٍ.
export function partials(n, freq, list, { attack = 0.002, pitchDip = 0 } = {}) {
  const out = new Float64Array(n);
  for (const { r, g, tau, phase = 0 } of list) {
    let ph = phase;
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      const f = freq * r * (1 + pitchDip * Math.exp(-t / 0.012));
      const e = (t < attack ? t / attack : 1) * Math.exp(-t / tau);
      out[i] += Math.sin(TAU * ph) * g * e;
      ph += f / SR; if (ph >= 1) ph -= 1;
    }
  }
  return out;
}
export function noise(n, { seed = 7, color = 'white' } = {}) {
  const random = rng(seed), out = new Float64Array(n);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < n; i++) {
    const w = random() * 2 - 1;
    if (color === 'pink') {
      b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
      out[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
    } else out[i] = w;
  }
  return out;
}
export function applyEnv(arr, env) { for (let i = 0; i < arr.length; i++) arr[i] *= env(i / SR); return arr; }
export function gain(arr, g) { for (let i = 0; i < arr.length; i++) arr[i] *= g; return arr; }
export function sum(...arrs) { const n = Math.max(...arrs.map((a) => a.length)); const out = new Float64Array(n); for (const a of arrs) for (let i = 0; i < a.length; i++) out[i] += a[i]; return out; }

// ── مرشّحات (RBJ biquad) ─────────────────────────────────────────────────
export function biquad(type, f0, Q = 0.707, gainDb = 0) {
  const w0 = TAU * clamp(f0, 10, SR / 2 - 100) / SR, cw = Math.cos(w0), sw = Math.sin(w0), alpha = sw / (2 * Q), A = 10 ** (gainDb / 40);
  let b0, b1, b2, a0, a1, a2;
  if (type === 'lowpass') { b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = (1 - cw) / 2; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha; }
  else if (type === 'highpass') { b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = (1 + cw) / 2; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha; }
  else if (type === 'bandpass') { b0 = alpha; b1 = 0; b2 = -alpha; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha; }
  else if (type === 'notch') { b0 = 1; b1 = -2 * cw; b2 = 1; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha; }
  else if (type === 'peak') { b0 = 1 + alpha * A; b1 = -2 * cw; b2 = 1 - alpha * A; a0 = 1 + alpha / A; a1 = -2 * cw; a2 = 1 - alpha / A; }
  else if (type === 'lowshelf') { const s = 2 * Math.sqrt(A) * alpha; b0 = A * ((A + 1) - (A - 1) * cw + s); b1 = 2 * A * ((A - 1) - (A + 1) * cw); b2 = A * ((A + 1) - (A - 1) * cw - s); a0 = (A + 1) + (A - 1) * cw + s; a1 = -2 * ((A - 1) + (A + 1) * cw); a2 = (A + 1) + (A - 1) * cw - s; }
  else if (type === 'highshelf') { const s = 2 * Math.sqrt(A) * alpha; b0 = A * ((A + 1) + (A - 1) * cw + s); b1 = -2 * A * ((A - 1) + (A + 1) * cw); b2 = A * ((A + 1) + (A - 1) * cw - s); a0 = (A + 1) - (A - 1) * cw + s; a1 = 2 * ((A - 1) - (A + 1) * cw); a2 = (A + 1) - (A - 1) * cw - s; }
  else throw new Error(`filter ${type}`);
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}
export function filter(arr, type, f0, Q, gainDb, { passes = 1 } = {}) {
  const c = biquad(type, f0, Q, gainDb);
  for (let p = 0; p < passes; p++) {
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < arr.length; i++) {
      const x = arr[i], y = c.b0 * x + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
      x2 = x1; x1 = x; y2 = y1; y1 = y; arr[i] = y;
    }
  }
  return arr;
}
// مرشّح بتردد قطع متغيّر مع الزمن (مسح ضوضاء «هوش»، فتح المرشح على البطانة).
export function sweep(arr, type, f0, Q = 0.9) {
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0, c = biquad(type, f0(0), Q);
  for (let i = 0; i < arr.length; i++) {
    if (i % 32 === 0) c = biquad(type, f0(i / SR), Q);
    const x = arr[i], y = c.b0 * x + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y; arr[i] = y;
  }
  return arr;
}

// ── أوتار (Karplus–Strong) ───────────────────────────────────────────────
export function pluck(n, freq, { decay = 0.996, brightness = 0.5, seed = 3, pick = 0.2, level = 1 } = {}) {
  const period = Math.max(2, Math.round(SR / freq)), out = new Float64Array(n), random = rng(seed);
  const line = new Float64Array(period);
  for (let i = 0; i < period; i++) line[i] = random() * 2 - 1;
  // تصفية موضع الريشة: مشط يخفف الشريك عند pick.
  const comb = Math.max(1, Math.round(period * pick));
  for (let i = 0; i < period; i++) line[i] -= 0.5 * line[(i - comb + period) % period];
  let idx = 0, last = 0;
  const lp = clamp(brightness, 0.05, 0.95);
  for (let i = 0; i < n; i++) {
    const cur = line[idx], next = line[(idx + 1) % period];
    const v = decay * (lp * cur + (1 - lp) * (cur + next) / 2 + (1 - lp) * 0.02 * last);
    out[i] = cur * level; last = v; line[idx] = v; idx = (idx + 1) % period;
  }
  return out;
}

// ── تأثيرات في JavaScript ────────────────────────────────────────────────
export function delayFx(st, { time = 0.35, feedback = 0.35, mix = 0.25, damp = 4500, spread = 0.012 } = {}) {
  const out = Stereo.ofSamples(st.length), dl = secs(time), dr = secs(time + spread);
  const bufL = new Float64Array(dl), bufR = new Float64Array(dr);
  const cl = biquad('lowpass', damp, 0.7), cr = biquad('lowpass', damp, 0.7);
  let il = 0, ir = 0, xl1 = 0, xl2 = 0, yl1 = 0, yl2 = 0, xr1 = 0, xr2 = 0, yr1 = 0, yr2 = 0;
  for (let i = 0; i < st.length; i++) {
    const wl = bufL[il], wr = bufR[ir];
    out.L[i] = st.L[i] + wl * mix; out.R[i] = st.R[i] + wr * mix;
    // تغذية راجعة متقاطعة مع تخميد ترددي.
    let fl = st.L[i] + wr * feedback, fr = st.R[i] + wl * feedback;
    let y = cl.b0 * fl + cl.b1 * xl1 + cl.b2 * xl2 - cl.a1 * yl1 - cl.a2 * yl2; xl2 = xl1; xl1 = fl; yl2 = yl1; yl1 = y; fl = y;
    y = cr.b0 * fr + cr.b1 * xr1 + cr.b2 * xr2 - cr.a1 * yr1 - cr.a2 * yr2; xr2 = xr1; xr1 = fr; yr2 = yr1; yr1 = y; fr = y;
    bufL[il] = fl; bufR[ir] = fr; il = (il + 1) % dl; ir = (ir + 1) % dr;
  }
  return out;
}
export function chorus(st, { rate = 0.35, depth = 0.004, base = 0.018, mix = 0.4, voices = 2 } = {}) {
  const out = Stereo.ofSamples(st.length), maxD = secs(base + depth * 2) + 2;
  for (let i = 0; i < st.length; i++) {
    const t = i / SR; let wl = 0, wr = 0;
    for (let v = 0; v < voices; v++) {
      const ph = TAU * (rate * (1 + v * 0.13)) * t + v * 1.7;
      const dL = (base + depth * (1 + Math.sin(ph))) * SR, dR = (base + depth * (1 + Math.sin(ph + 1.1))) * SR;
      wl += tap(st.L, i - dL); wr += tap(st.R, i - dR);
    }
    out.L[i] = st.L[i] * (1 - mix * 0.5) + (wl / voices) * mix; out.R[i] = st.R[i] * (1 - mix * 0.5) + (wr / voices) * mix;
  }
  void maxD;
  return out;
}
function tap(arr, pos) { if (pos < 0) return 0; const i = Math.floor(pos), f = pos - i; const a = arr[i] || 0, b = arr[i + 1] || 0; return a + (b - a) * f; }
export function stereo(mono, { pan = 0, width = 0, delayMs = 0 } = {}) {
  const st = Stereo.ofSamples(mono.length);
  const angle = (pan + 1) * Math.PI / 4, gl = Math.cos(angle), gr = Math.sin(angle), d = secs(delayMs / 1000);
  for (let i = 0; i < mono.length; i++) {
    const v = mono[i], w = width ? mono[Math.max(0, i - d)] * width : 0;
    st.L[i] = v * gl + w * gr * 0.5; st.R[i] = v * gr + w * gl * 0.5;
  }
  return st;
}
// استجابة نبضية لغرفة/قاعة: ضوضاء متلاشية أُسّيًا مع تخميد يزداد مع الزمن، وقناتان غير مترابطتين.
export function impulseResponse({ seconds = 1.8, damp = 5000, predelay = 0.015, seed = 11, tail = 0.35 } = {}) {
  const n = secs(seconds + predelay), ir = Stereo.ofSamples(n), pd = secs(predelay);
  const l = noise(n - pd, { seed }), r = noise(n - pd, { seed: seed + 101 });
  const tau = seconds / 6.9; // -60 dB عند نهاية الزمن
  for (let i = 0; i < n - pd; i++) {
    const t = i / SR, e = Math.exp(-t / tau) * (1 - tail * Math.exp(-t / 0.05));
    ir.L[pd + i] = l[i] * e; ir.R[pd + i] = r[i] * e;
  }
  // تخميد الترددات العليا مع الزمن: مرشّح ثم مزج مع نسخة أكثر تخميدًا نحو الذيل.
  const dampedL = filter(Float64Array.from(ir.L), 'lowpass', damp * 0.35, 0.7), dampedR = filter(Float64Array.from(ir.R), 'lowpass', damp * 0.35, 0.7);
  filter(ir.L, 'lowpass', damp, 0.7); filter(ir.R, 'lowpass', damp, 0.7);
  for (let i = 0; i < n; i++) { const x = Math.min(1, (i / SR) / seconds); ir.L[i] = ir.L[i] * (1 - x) + dampedL[i] * x; ir.R[i] = ir.R[i] * (1 - x) + dampedR[i] * x; }
  ir.fade(0, 0.02);
  return ir;
}

// ── WAV 24-bit ────────────────────────────────────────────────────────────
export function encodeWav24(st) {
  const n = st.length, data = Buffer.alloc(n * 6);
  for (let i = 0, p = 0; i < n; i++) {
    for (const v of [st.L[i], st.R[i]]) {
      const s = Math.round(clamp(v, -1, 1) * 8388607);
      data[p++] = s & 255; data[p++] = (s >> 8) & 255; data[p++] = (s >> 16) & 255;
    }
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + data.length, 4); header.write('WAVE', 8);
  header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(2, 22);
  header.writeUInt32LE(SR, 24); header.writeUInt32LE(SR * 6, 28); header.writeUInt16LE(6, 32); header.writeUInt16LE(24, 34);
  header.write('data', 36); header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}
export async function writeWav(file, st) { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, encodeWav24(st)); return file; }
export function decodeWav24(buf) {
  let format, data;
  for (let pos = 12; pos + 8 <= buf.length;) {
    const name = buf.toString('ascii', pos, pos + 4), size = buf.readUInt32LE(pos + 4);
    if (name === 'fmt ') format = buf.subarray(pos + 8, pos + 8 + size);
    if (name === 'data') data = buf.subarray(pos + 8, pos + 8 + size);
    pos += 8 + size + (size % 2);
  }
  if (!format || !data || format.readUInt16LE(14) !== 24 || format.readUInt16LE(2) !== 2) throw new Error('expected stereo PCM24');
  const n = data.length / 6, st = Stereo.ofSamples(n);
  for (let i = 0, p = 0; i < n; i++) {
    for (const ch of ['L', 'R']) { let s = data[p] | (data[p + 1] << 8) | (data[p + 2] << 16); if (s & 0x800000) s -= 0x1000000; st[ch][i] = s / 8388608; p += 3; }
  }
  return st;
}

// ── ffmpeg: صدى التفافي، قياس، إتقان ─────────────────────────────────────
async function ff(args) { return run(ffmpeg, ['-hide_banner', '-nostdin', '-y', '-loglevel', 'info', ...args], { maxBuffer: 64 * 1024 * 1024 }); }
// صدى التفافي على مرحلتين: afir يُخرج الإشارة المبتلّة وحدها (dry هنا كسب الدخل، لا مرور
// جاف)، فتُقاس RMS المبتلّة والجافة ثم تُمزجان بحيث تكون المبتلّة أخفض من الجافة بـ wetDb.
export async function reverbFile(dryWav, irWav, outWav, { wetDb = -12, highpass = 0, wetHighpass = 120 } = {}) {
  const wetWav = outWav.replace(/\.wav$/, '.wet.wav');
  await ff(['-i', dryWav, '-i', irWav, '-filter_complex', `[0:a][1:a]afir=dry=1:wet=1:gtype=gn,highpass=f=${wetHighpass}`, '-c:a', 'pcm_s24le', '-ar', String(SR), wetWav]);
  const [d, w] = await Promise.all([measure(dryWav), measure(wetWav)]);
  if (!Number.isFinite(w.rms) || !Number.isFinite(d.rms)) throw new Error(`reverb produced silence for ${dryWav}`);
  const k = db(d.rms + wetDb - w.rms);
  const hp = highpass ? `,highpass=f=${highpass}` : '';
  await ff(['-i', dryWav, '-i', wetWav, '-filter_complex', `[0:a][1:a]amix=inputs=2:weights='1 ${k.toFixed(5)}':normalize=0:duration=longest${hp}`, '-c:a', 'pcm_s24le', '-ar', String(SR), outWav]);
  return outWav;
}
// قياس EBU R128: صوت متكامل ونطاق ديناميكي وذروة حقيقية.
export async function measure(wav) {
  const { stderr } = await ff(['-i', wav, '-af', 'ebur128=peak=true,astats=measure_perchannel=none:measure_overall=RMS_peak+RMS_level+Peak_level', '-f', 'null', '-']);
  // كتلة الملخص فقط (سطور التقدّم تحمل I: أيضًا)، و-inf للصمت.
  const summary = stderr.slice(stderr.lastIndexOf('Summary:'));
  const num = (re) => { const m = re.exec(summary); return m ? (m[1] === '-inf' ? -Infinity : Number(m[1])) : null; };
  // المؤثرات القصيرة تُقاس بذروة RMS (المتكامل LUFS يُبوَّب على ما دون الثانية).
  return {
    lufs: num(/I:\s*(-?[\d.]+|-inf) LUFS/), lra: num(/LRA:\s*([\d.]+) LU/), truePeak: num(/Peak:\s*(-?[\d.]+|-inf) dBFS/),
    rmsPeak: num(/RMS peak dB:\s*(-?[\d.]+|-inf)/), rms: num(/RMS level dB:\s*(-?[\d.]+|-inf)/), samplePeak: num(/Peak level dB:\s*(-?[\d.]+|-inf)/),
  };
}
// إتقان: كسب لبلوغ ذروة حقيقية مستهدفة (مع حدّ أعلى آمن)، أو مستوى صوت متكامل للموسيقى.
export async function master(inWav, outWav, { truePeakDb = -3, lufs = null, highpass = 30, extra = '' } = {}) {
  const m = await measure(inWav);
  let filters = [`highpass=f=${highpass}`];
  if (lufs !== null && m.lufs !== null && Number.isFinite(m.lufs)) filters.push(`volume=${(lufs - m.lufs).toFixed(3)}dB`);
  else if (m.truePeak !== null) filters.push(`volume=${(truePeakDb - m.truePeak).toFixed(3)}dB`);
  if (extra) filters.push(extra);
  filters.push(`alimiter=limit=${db(truePeakDb + 0.3).toFixed(4)}:attack=3:release=60:level=false`);
  await ff(['-i', inWav, '-af', filters.join(','), '-c:a', 'pcm_s24le', '-ar', String(SR), '-map_metadata', '-1', '-fflags', '+bitexact', outWav]);
  return measure(outWav);
}
export async function encodeAac(inWav, outFile, { bitrate = '128k' } = {}) {
  await ff(['-i', inWav, '-vn', '-c:a', 'aac', '-b:a', bitrate, '-ar', String(SR), '-map_metadata', '-1', '-fflags', '+bitexact', '-flags:a', '+bitexact', '-movflags', '+faststart', outFile]);
  return readFile(outFile);
}

// قياسات صوتية خالصة (بلا ffmpeg) على Stereo بمعدل 48 kHz: طيف، طبقة، مفتاح، مغلّف، صمت،
// نقاء، توافق أحادي، ووصلات الحلقات. يستعملها screen.mjs لفرز المرشّحين وmusic.mjs للوصلات.
import { SR, Stereo, secs } from './engine.mjs';

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const dbOf = (v) => (v > 0 ? 20 * Math.log10(v) : -Infinity);
export function mono(st) { const n = st.length, x = new Float64Array(n); for (let i = 0; i < n; i++) x[i] = (st.L[i] + st.R[i]) / 2; return x; }
export function rms(x, from = 0, to = x.length) { let s = 0; for (let i = from; i < to; i++) s += x[i] * x[i]; return Math.sqrt(s / Math.max(1, to - from)); }
export function peakAbs(x) { let p = 0; for (let i = 0; i < x.length; i++) { const a = Math.abs(x[i]); if (a > p) p = a; } return p; }

// ── FFT (نصف قطر 2، في المكان) ─────────────────────────────────────────────────────────
export function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k], ui = im[i + k];
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci, vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr; im[i + k] = ui + vi; re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}
const windows = new Map();
export function hann(n) { if (!windows.has(n)) { const w = new Float64Array(n); for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1)); windows.set(n, w); } return windows.get(n); }
// طيف مقدار لإطار واحد (يُصفَّر ما بعد نهاية الإشارة).
export function spectrum(x, start, size) {
  const re = new Float64Array(size), im = new Float64Array(size), w = hann(size);
  for (let i = 0; i < size; i++) { const j = start + i; re[i] = j < x.length ? x[j] * w[i] : 0; }
  fft(re, im);
  const mags = new Float64Array(size / 2);
  for (let k = 0; k < size / 2; k++) mags[k] = Math.hypot(re[k], im[k]) / size;
  return mags;
}
export const binHz = (size) => SR / size;
// أطياف الإطارات (بحدّ أعلى للعدد: الملفات الطويلة تُعاين بخطوة أكبر).
export function frameSpectra(x, { size = 4096, hop = 2048, maxFrames = 1200 } = {}) {
  const total = Math.max(1, Math.ceil((x.length - size) / hop) + 1);
  const step = Math.max(hop, Math.ceil(total / maxFrames) * hop);
  const frames = [];
  for (let start = 0; start < Math.max(1, x.length - size / 2); start += step) frames.push({ start, mags: spectrum(x, start, size), energy: rms(x, start, Math.min(x.length, start + size)) });
  return { frames, size };
}
export function spectralCentroid(mags, size) { let num = 0, den = 0; for (let k = 1; k < mags.length; k++) { num += k * binHz(size) * mags[k]; den += mags[k]; } return den ? num / den : 0; }
export function spectralFlatness(mags) { let logSum = 0, sum = 0, n = 0; for (let k = 1; k < mags.length; k++) { const p = mags[k] * mags[k] + 1e-18; logSum += Math.log(p); sum += p; n++; } return n ? Math.exp(logSum / n) / (sum / n) : 0; }
export function bandFraction(mags, size, loHz, hiHz) { let band = 0, total = 0; for (let k = 1; k < mags.length; k++) { const f = k * binHz(size), p = mags[k] * mags[k]; total += p; if (f >= loHz && f < hiHz) band += p; } return total ? band / total : 0; }
// متوسط الطيف (قدرة) مرجَّح بطاقة الإطار، ليصف الملف كله.
export function averageSpectrum(x, opts) {
  const { frames, size } = frameSpectra(x, opts);
  const acc = new Float64Array(size / 2); let wsum = 0;
  for (const f of frames) { const w = f.energy + 1e-9; wsum += w; for (let k = 0; k < acc.length; k++) acc[k] += f.mags[k] * f.mags[k] * w; }
  for (let k = 0; k < acc.length; k++) acc[k] = Math.sqrt(acc[k] / (wsum || 1));
  return { mags: acc, size, frames: frames.length };
}

// ── الزمن: مغلّف، صمت، هجوم، أرضية ضوضاء، ذروة/قمة، انزياح، قصّ ─────────────────────────
export function rmsFrames(x, win = secs(0.01)) { const out = new Float64Array(Math.max(1, Math.ceil(x.length / win))); for (let i = 0; i < out.length; i++) out[i] = dbOf(rms(x, i * win, Math.min(x.length, (i + 1) * win))); return out; }
export function leadingSilence(x, thresholdDb = -45) { const t = Math.pow(10, thresholdDb / 20); for (let i = 0; i < x.length; i++) if (Math.abs(x[i]) > t) return i / SR; return x.length / SR; }
export function trailingTail(x, thresholdDb = -60) { const t = Math.pow(10, thresholdDb / 20); for (let i = x.length - 1; i >= 0; i--) if (Math.abs(x[i]) > t) return (x.length - 1 - i) / SR; return x.length / SR; }
// حدّة البداية: من أول عبور للعتبة حتى أول قمة في المغلّف (1 ms) تبلغ نصف الذروة الكلية؛ عبارة
// من عدة نغمات تُقاس بنغمتها الأولى لا بأعلاها.
export function attackTime(x, thresholdDb = -45) {
  const onset = secs(leadingSilence(x, thresholdDb)), w = secs(0.001);
  let peak = 0; const env = [];
  for (let i = onset; i < x.length; i += w) { const v = peakAbs(x.subarray(i, Math.min(x.length, i + w))); env.push(v); if (v > peak) peak = v; }
  for (let i = 0; i < env.length; i++) {
    if (env[i] >= 0.5 * peak && (i + 1 >= env.length || env[i + 1] <= env[i])) return i;
  }
  return env.length;
}
// أرضية الضوضاء: مستوى ما قبل البداية إن وُجد صمت كافٍ (≥ 5 ms)، وإلا null (لا يُحكم عليها).
export function noiseFloor(x, thresholdDb = -45) {
  const onset = secs(leadingSilence(x, thresholdDb));
  if (onset < secs(0.005)) return null;
  return Number(dbOf(rms(x, 0, onset)).toFixed(1));
}
// مستوى آخر 10 ms: قطع فجّ إن كان مرتفعًا.
export function endLevel(x) { return Number(dbOf(rms(x, Math.max(0, x.length - secs(0.01)), x.length)).toFixed(1)); }
export function crestFactor(x) { return dbOf(peakAbs(x)) - dbOf(rms(x)); }
export function dcOffset(x) { let s = 0; for (let i = 0; i < x.length; i++) s += x[i]; return (s / x.length) / (peakAbs(x) || 1); }
export function clippingRuns(x, threshold = 0.999) { let runs = 0, run = 0; for (let i = 0; i < x.length; i++) { if (Math.abs(x[i]) >= threshold) { run++; if (run === 3) runs++; } else run = 0; } return runs; }
export function monoCompat(st) {
  const n = st.length; let sl = 0, sr = 0, slr = 0, sll = 0, srr = 0;
  for (let i = 0; i < n; i++) { sl += st.L[i]; sr += st.R[i]; }
  const ml = sl / n, mr = sr / n;
  for (let i = 0; i < n; i++) { const a = st.L[i] - ml, b = st.R[i] - mr; slr += a * b; sll += a * a; srr += b * b; }
  const correlation = sll && srr ? slr / Math.sqrt(sll * srr) : 1;
  const sumLossDb = dbOf(rms(mono(st))) - Math.max(dbOf(rms(st.L)), dbOf(rms(st.R)));
  return { correlation: Number(correlation.toFixed(3)), sumLossDb: Number(sumLossDb.toFixed(2)) };
}

// ── الطبقة: طيف ضرب التوافقيات على الجزء الأعلى صوتًا ──────────────────────────────────
export function estimatePitch(x, { minHz = 55, maxHz = 4200, size = 4096 } = {}) {
  const { frames } = frameSpectra(x, { size, hop: size / 4, maxFrames: 400 });
  const loud = Math.max(...frames.map((f) => f.energy));
  const picks = [];
  for (const f of frames) {
    if (f.energy < loud * 0.25) continue;
    const lo = Math.max(1, Math.floor(minHz / binHz(size))), hi = Math.min(f.mags.length / 4 - 1, Math.ceil(maxHz / binHz(size)));
    let best = -1, bestV = 0, sum = 0, count = 0;
    for (let k = lo; k <= hi; k++) {
      const v = f.mags[k] * f.mags[2 * k] * f.mags[3 * k] * (f.mags[4 * k] || f.mags[3 * k]);
      sum += v; count++;
      if (v > bestV) { bestV = v; best = k; }
    }
    if (best < 0 || !bestV) continue;
    // تحسين تربيعي حول القمة على الطيف الأصلي.
    const m0 = f.mags[best - 1] || 0, m1 = f.mags[best], m2 = f.mags[best + 1] || 0;
    const raw = (m0 + m2 - 2 * m1) ? 0.5 * (m0 - m2) / (m0 + m2 - 2 * m1) : 0;
    const delta = Math.max(-0.5, Math.min(0.5, Number.isFinite(raw) ? raw : 0));
    const hz = (best + delta) * binHz(size);
    if (!(hz > 0)) continue;
    const prominence = 10 * Math.log10(bestV / (sum / count + 1e-30));
    picks.push({ hz, prominence, flat: spectralFlatness(f.mags), weight: f.energy });
  }
  if (!picks.length) return { hz: null, midi: null, cents: null, confidence: 0, stability: null };
  const midis = picks.map((p) => 69 + 12 * Math.log2(p.hz / 440));
  const sorted = [...midis].sort((a, b) => a - b), median = sorted[Math.floor(sorted.length / 2)];
  const spread = Math.sqrt(midis.reduce((s, m) => s + (m - median) ** 2, 0) / midis.length);
  const prom = picks.reduce((s, p) => s + p.prominence * p.weight, 0) / picks.reduce((s, p) => s + p.weight, 0);
  const flat = picks.reduce((s, p) => s + p.flat, 0) / picks.length;
  // الثقة من بروز القمة ونقاء الطيف؛ الثبات (انتشار الطبقة بين الإطارات) يُعاد منفصلًا لأن
  // المؤثرات اللحنية تتحرّك بين نغمات عن قصد.
  const confidence = Math.max(0, Math.min(1, (prom - 10) / 25)) * Math.max(0, 1 - flat * 4);
  const rounded = Math.round(median);
  return { hz: Number((440 * Math.pow(2, (median - 69) / 12)).toFixed(2)), midi: rounded, note: `${NOTE_NAMES[rounded % 12]}${Math.floor(rounded / 12) - 1}`, cents: Math.round((median - rounded) * 100), confidence: Number(confidence.toFixed(3)), stability: Number(spread.toFixed(2)) };
}

// ── المفتاح: كروما من متوسط الطيف وملامح Krumhansl–Schmuckler ────────────────────────────
const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
export function chroma(mags, size, { loHz = 60, hiHz = 4000 } = {}) {
  const c = new Float64Array(12);
  for (let k = 1; k < mags.length; k++) { const f = k * binHz(size); if (f < loHz || f > hiHz) continue; const pc = ((Math.round(69 + 12 * Math.log2(f / 440)) % 12) + 12) % 12; c[pc] += mags[k] * mags[k]; }
  const total = c.reduce((s, v) => s + v, 0) || 1;
  for (let i = 0; i < 12; i++) c[i] /= total;
  return c;
}
const corr = (a, b) => { const ma = a.reduce((s, v) => s + v, 0) / 12, mb = b.reduce((s, v) => s + v, 0) / 12; let n = 0, da = 0, dbb = 0; for (let i = 0; i < 12; i++) { n += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; dbb += (b[i] - mb) ** 2; } return da && dbb ? n / Math.sqrt(da * dbb) : 0; };
export function keyEstimate(x) {
  const { mags, size } = averageSpectrum(x, { size: 8192, hop: 4096, maxFrames: 600 });
  const c = chroma(mags, size);
  const scores = [];
  for (let k = 0; k < 12; k++) {
    const rot = (profile) => corr(c, Array.from({ length: 12 }, (_, i) => profile[((i - k) % 12 + 12) % 12]));
    scores.push({ key: k, name: NOTE_NAMES[k], mode: 'major', score: rot(MAJOR) }, { key: k, name: NOTE_NAMES[k], mode: 'minor', score: rot(MINOR) });
  }
  scores.sort((a, b) => b.score - a.score);
  const [best, second] = scores;
  return { key: best.key, name: best.name, mode: best.mode, score: Number(best.score.toFixed(3)), second: { name: second.name, mode: second.mode, score: Number(second.score.toFixed(3)) }, chroma: Array.from(c, (v) => Number(v.toFixed(3))) };
}
// أقرب مسافة (بأنصاف النغمات، موقَّعة) من مركز المفتاح إلى ري؛ المفتاح الكبير يُعامل بنسبيّه الصغير (فا الكبير ≈ ري الصغير).
export function semitonesToD(key, mode) { const tonic = mode === 'major' ? (key + 9) % 12 : key; let d = (2 - tonic + 12) % 12; if (d > 6) d -= 12; return d; }
// للمؤثرات القصيرة: أقرب إزاحة تضع الجذر نفسه أو جذر النسبيّ على ري (تآلف ري الكبير والصغير كلاهما يجلس على موسيقى ري).
export function semitonesToDCue(key, mode) {
  const direct = (() => { let d = (2 - key + 12) % 12; if (d > 6) d -= 12; return d; })();
  const relative = semitonesToD(key, mode);
  return Math.abs(direct) <= Math.abs(relative) ? direct : relative;
}

// ── الحلقات: وصلة النهاية→البداية، وقياسها ─────────────────────────────────────────────
// hfClickDb: طاقة الترددات العالية في نافذة 21 ms على الوصلة نسبةً إلى مرجع. مع bpm يكون المرجع
// وسيط النوافذ على بدايات النبضات الأخرى في الحلقة (ضربة أول البار عند الوصلة طبيعية، لا نقرة)؛
// بدونه المرجع النوافذ المجاورة داخل ±windowMs.
export function seamMetrics(st, { windowMs = 200, hfHz = 4000, bpm = null } = {}) {
  const x = mono(st), n = x.length, w = Math.min(secs(windowMs / 1000), Math.floor(n / 2));
  const tail = x.subarray(n - w), head = x.subarray(0, w);
  const joined = new Float64Array(2 * w); joined.set(tail); joined.set(head, w);
  const size = 1024, sizeHf = (seg) => bandFraction(spectrum(seg, 0, size), size, hfHz, SR / 2) * rms(seg, 0, size) ** 2;
  const centre = sizeHf(joined.subarray(w - size / 2));
  let reference;
  if (bpm) {
    const beat = secs(60 / bpm), values = [];
    for (let at = beat; at + size / 2 < n; at += beat) values.push(sizeHf(x.subarray(Math.max(0, at - size / 2))));
    values.sort((a, b) => a - b);
    // موسيقى متفرّقة (نبضات كثيرة صامتة) لا تُعطي مرجعًا صفريًا: أرضية ربع أعلى نبضة.
    reference = values.length ? Math.max(values[Math.floor(values.length / 2)], 0.25 * values[values.length - 1]) : 0;
  } else {
    let others = 0, count = 0;
    for (let s = 0; s + size <= 2 * w; s += size) { if (Math.abs(s + size / 2 - w) < size) continue; others += sizeHf(joined.subarray(s)); count++; }
    reference = count ? others / count : 0;
  }
  const hfClickDb = 10 * Math.log10((centre + 1e-18) / (reference + 1e-18));
  // القفزة عند الوصلة نسبةً إلى أكبر القفزات الطبيعية في الإشارة (المئين 99.9 لـ |Δx|): حلقة سليمة
  // تبدأ بضربة طبل تُعطي ≈ 1، وقطع فجّ في نغمة ممتدة يُعطي أضعافًا.
  const steps = new Float64Array(Math.min(n - 1, 480000));
  const stride = Math.max(1, Math.floor((n - 1) / steps.length));
  for (let i = 0; i < steps.length; i++) steps[i] = Math.abs(x[i * stride + 1] - x[i * stride]);
  steps.sort();
  const ref = steps[Math.floor(steps.length * 0.999)] || 1e-9;
  const cTail = spectralCentroid(spectrum(tail, 0, 4096), 4096), cHead = spectralCentroid(spectrum(head, 0, 4096), 4096);
  return {
    levelDiffDb: Number((dbOf(rms(tail)) - dbOf(rms(head))).toFixed(2)),
    discontinuity: Number((Math.abs(x[n - 1] - x[0]) / ref).toFixed(3)),
    hfClickDb: Number(hfClickDb.toFixed(2)),
    centroidDiff: Number((Math.abs(cTail - cHead) / (cHead || 1)).toFixed(3)),
  };
}
// حلقة من مقطع: [offset, offset+length) مع تلاشٍ متبادل ثابت الطاقة لذيل ما بعد النهاية داخل البداية.
export function seamlessLoop(st, offsetSec, lengthSec, crossfadeSec = 0) {
  const a = secs(offsetSec), L = secs(lengthSec), xf = secs(crossfadeSec);
  if (a + L + xf > st.length) throw new Error(`loop region exceeds the file (${((a + L + xf) / SR).toFixed(2)} s > ${st.seconds.toFixed(2)} s)`);
  const out = Stereo.ofSamples(L);
  out.L.set(st.L.subarray(a, a + L)); out.R.set(st.R.subarray(a, a + L));
  for (let i = 0; i < xf; i++) {
    const th = (i / xf) * Math.PI / 2, gIn = Math.sin(th), gTail = Math.cos(th);
    out.L[i] = out.L[i] * gIn + st.L[a + L + i] * gTail;
    out.R[i] = out.R[i] * gIn + st.R[a + L + i] * gTail;
  }
  return out;
}
export function trimLeading(st, { dB = -45, preRollMs = 2 } = {}) {
  const x = mono(st), onset = Math.max(0, secs(leadingSilence(x, dB)) - secs(preRollMs / 1000));
  return onset ? st.slice(onset / SR, st.seconds) : st;
}

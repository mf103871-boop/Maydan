// موسيقى ميدان الخلفية: ثلاث حلقات هادئة ونهاية قصيرة، مؤلَّفة على ري (نهاوند للقوائم واللعب
// الهادئ، حجاز للمؤقتات) بآلات voices.mjs، وتُصنع «بلا وصلة»: تُعزف الدورة مرتين، يُطبَّق الصدى
// على الكل، ثم تُقتطع الدورة الثانية فتحمل بدايتها ذيول نهاية الدورة الأولى.
//
//   node scripts/audio/music.mjs            يبني الحلقات كلها
//   node scripts/audio/music.mjs --only home
//   node scripts/audio/music.mjs --check
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Stereo, midi, writeWav, decodeWav24, impulseResponse, reverbFile, master, encodeAac, measure } from './engine.mjs';
import { kalimba, marimba, bell, glass, oud, pad, ney, dum, tak, shaker, padStereo, m } from './voices.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const mastersDir = path.join(root, 'assets/audio/maydan-v2/music');
const workDir = path.join(root, '.cache/audio-work-music');
const outDir = path.join(root, 'public/audio/music');
const manifestFile = path.join(root, 'src/shared/fx/music-bank.js');
const args = process.argv.slice(2);
const check = args.includes('--check');
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;

// سلالم على ري: درجات نصف-نغمية من الجذر.
const SCALES = { nahawand: [0, 2, 3, 5, 7, 8, 10], kurd: [0, 1, 3, 5, 7, 8, 10], hijaz: [0, 1, 4, 5, 7, 8, 10] };
const ROOT = m('D', 3); // 50
// درجة السلّم (0 = الجذر، تقبل السالب والأوكتافات) → رقم MIDI.
const deg = (scale, d, octave = 0) => { const s = SCALES[scale]; const o = Math.floor(d / s.length); return ROOT + 12 * (octave + o) + s[((d % s.length) + s.length) % s.length]; };
const hz = (n) => midi(n);

// مُسلسِل بسيط: أحداث {t, fn} حيث fn تُرجع مصدرًا (Float64Array أو Stereo) ونمزجه عند t.
class Seq {
  constructor(bpm, bars, beats = 4) { this.bpm = bpm; this.bars = bars; this.beats = beats; this.events = []; }
  get beat() { return 60 / this.bpm; }
  get length() { return this.bars * this.beats * this.beat; }
  at(bar, beat, fn, opts = {}) { this.events.push({ t: (bar * this.beats + beat) * this.beat, fn, opts }); return this; }
  // يُصيّر دورتين متتاليتين ويعيد Stereo بطول 2L + ذيل.
  render(tail = 3) {
    const L = this.length, st = new Stereo(2 * L + tail);
    for (const cycle of [0, 1]) for (const { t, fn, opts } of this.events) {
      const start = cycle * L + t;
      if (start >= st.seconds - 0.05) continue;
      st.mix(fn(), start, opts);
    }
    return st;
  }
}

// ── القوائم: نهاوند، 72 نبضة، 16 بارًا (~53 ث) ────────────────────────────────
function home() {
  const s = new Seq(72, 16), sc = 'nahawand';
  // تتابع: i – VI – iv – i | i – VI – VII – i (كل تآلف باران)
  const chords = [0, 5, 3, 0, 0, 5, 6, 0];
  chords.forEach((c, i) => {
    const bar = i * 2;
    const rootN = deg(sc, c, -1), third = deg(sc, c + 2, -1), fifth = deg(sc, c + 4, -1);
    s.at(bar, 0, () => padStereo(pad(hz(rootN), s.beat * 8 - 0.3, { a: 1.4, r: 1.6, cutoff: 700, sweepAmt: 300 })), { gain: 0.55 });
    s.at(bar, 0, () => padStereo(pad(hz(fifth), s.beat * 8 - 0.3, { a: 1.8, r: 1.6, cutoff: 650, sweepAmt: 250 })), { gain: 0.32 });
    s.at(bar, 0.02, () => padStereo(pad(hz(third + 12), s.beat * 8 - 0.3, { a: 2.2, r: 1.6, cutoff: 900, sweepAmt: 200 })), { gain: 0.16 });
    // عود: الجذر على 1، الخامسة على 3
    s.at(bar, 0, () => oud(hz(rootN - 12), 1.6, { seed: 4 + i }), { gain: 0.5, pan: -0.15 });
    s.at(bar, 2, () => oud(hz(fifth - 12), 1.4, { seed: 14 + i }), { gain: 0.36, pan: -0.15 });
    s.at(bar + 1, 0, () => oud(hz(rootN - 12), 1.6, { seed: 24 + i }), { gain: 0.42, pan: -0.15 });
    s.at(bar + 1, 2.5, () => oud(hz(third - 12), 1.2, { seed: 34 + i }), { gain: 0.3, pan: -0.15 });
    // كالمبا: أربيج ثُمنيات ناعم يتنقل بين درجات التآلف
    const arp = [c, c + 4, c + 7, c + 4, c + 2, c + 4, c + 7, c + 9];
    for (let b = 0; b < 2; b++) arp.forEach((d, k) => { if ((b * 8 + k) % 16 === 15) return; s.at(bar + b, k * 0.5, () => kalimba(hz(deg(sc, d, 1)), 0.9, { bright: 0.8, seed: 3 + k }), { gain: 0.26 + 0.06 * (k % 2 === 0), pan: -0.3 + 0.6 * (k / 7) }); });
    // دفّ خفيف: دُم على 1، تَك على 2.5 و4
    s.at(bar, 0, () => dum(0.5), { gain: 0.42 }); s.at(bar, 2.5, () => tak(0.14, { seed: 37 + i }), { gain: 0.2, pan: 0.3 }); s.at(bar, 3, () => tak(0.14, { seed: 47 + i }), { gain: 0.16, pan: 0.3 });
    s.at(bar + 1, 0, () => dum(0.5, { f0: 100, f1: 55 }), { gain: 0.36 }); s.at(bar + 1, 2, () => tak(0.14, { seed: 57 + i }), { gain: 0.18, pan: 0.3 }); s.at(bar + 1, 3.5, () => dum(0.4, { f0: 90, f1: 52 }), { gain: 0.25 });
    for (let k = 0; k < 8; k++) { s.at(bar, k * 0.5, () => shaker(0.1, { seed: 60 + k, open: k % 2 ? 0.5 : 0.15 }), { gain: 0.09 + 0.05 * (k % 2), pan: 0.45 }); s.at(bar + 1, k * 0.5, () => shaker(0.1, { seed: 70 + k, open: k % 2 ? 0.5 : 0.15 }), { gain: 0.09 + 0.05 * (k % 2), pan: 0.45 }); }
  });
  // ناي: جملتان متأملتان (البارات 4–7 و12–15)
  const phrase = (bar, notes) => notes.forEach(([beat, d, len]) => s.at(bar + Math.floor(beat / 4), beat % 4, () => ney(hz(deg(sc, d, 1)), len * s.beat, { vibDepth: 6 }), { gain: 0.34, pan: 0.12 }));
  phrase(4, [[0, 4, 1.5], [1.5, 3, 0.5], [2, 2, 2], [4.5, 1, 1], [5.5, 2, 0.5], [6, 0, 2.5], [9, 2, 1], [10, 3, 1], [11, 4, 3]]);
  phrase(12, [[0, 7, 1.5], [1.5, 6, 0.5], [2, 5, 1], [3, 4, 1], [4, 3, 2], [6, 4, 1], [7, 2, 1], [8, 0, 3.5], [12, 1, 1], [13, 0, 3]]);
  // أجراس بعيدة على بداية كل أربعة بارات
  [0, 4, 8, 12].forEach((bar, i) => s.at(bar, 0, () => bell(hz(deg(sc, [7, 9, 11, 7][i], 1)), 3, { tau: 1.4 }), { gain: 0.16, pan: i % 2 ? 0.35 : -0.35 }));
  return s;
}

// ── اللعب الهادئ: نهاوند، 66 نبضة، 16 بارًا (~58 ث) — بلا إيقاع ─────────────────
function calm() {
  const s = new Seq(66, 16), sc = 'nahawand';
  const chords = [0, 3, 5, 4, 0, 3, 6, 0];
  chords.forEach((c, i) => {
    const bar = i * 2, rootN = deg(sc, c, -1), fifth = deg(sc, c + 4, -1), third = deg(sc, c + 2, 0);
    s.at(bar, 0, () => padStereo(pad(hz(rootN), s.beat * 8 - 0.4, { a: 1.8, r: 2.0, cutoff: 600, sweepAmt: 220, lfo: 0.09 })), { gain: 0.5 });
    s.at(bar, 0.03, () => padStereo(pad(hz(fifth), s.beat * 8 - 0.4, { a: 2.4, r: 2.0, cutoff: 560, sweepAmt: 180, lfo: 0.07 })), { gain: 0.28 });
    s.at(bar, 0.06, () => padStereo(pad(hz(third), s.beat * 8 - 0.4, { a: 3, r: 2.2, cutoff: 800, sweepAmt: 150 })), { gain: 0.14 });
    // كالمبا: نمط بطيء على أرباع منقوطة
    const motif = [c + 7, c + 4, c + 9, c + 7, c + 11, c + 9, c + 7, c + 4];
    motif.forEach((d, k) => s.at(bar + Math.floor((k * 1.5) / 4), (k * 1.5) % 4, () => kalimba(hz(deg(sc, d, 1)), 1.4, { bright: 0.6, seed: 5 + k }), { gain: 0.22, pan: -0.35 + 0.7 * ((k % 4) / 3) }));
    s.at(bar, 0, () => oud(hz(rootN - 12), 2.2, { seed: 8 + i, bright: 0.3 }), { gain: 0.34, pan: -0.1 });
    s.at(bar + 1, 1, () => oud(hz(fifth - 12), 1.8, { seed: 18 + i, bright: 0.3 }), { gain: 0.24, pan: -0.1 });
  });
  [0, 6, 10, 14].forEach((bar, i) => s.at(bar, 1.5, () => bell(hz(deg(sc, [7, 9, 4, 11][i], 1)), 3.5, { tau: 1.6, index: 1.6 }), { gain: 0.14, pan: i % 2 ? 0.4 : -0.4 }));
  [2, 8, 12].forEach((bar, i) => s.at(bar, 3, () => glass(hz(deg(sc, [11, 14, 9][i], 1)), 1.2), { gain: 0.1, pan: 0.2 - 0.2 * i }));
  return s;
}

// ── المؤقتات: حجاز، 96 نبضة، 16 بارًا (~40 ث) — نبض دفّ وعود، بلا حدّة ─────────
function tense() {
  const s = new Seq(96, 16), sc = 'hijaz';
  const bass = [0, 0, 5, 5, 3, 3, 4, 4, 0, 0, 5, 5, 6, 6, 4, 4];
  bass.forEach((c, bar) => {
    const rootN = deg(sc, c, -1);
    // إيقاع مقسوم: دُم . تَك . دُم دُم . تَك
    s.at(bar, 0, () => dum(0.45, { f0: 105, f1: 58 }), { gain: 0.6 }); s.at(bar, 1, () => tak(0.13, { seed: 31 + bar }), { gain: 0.3, pan: 0.3 });
    s.at(bar, 2, () => dum(0.4, { f0: 95, f1: 55 }), { gain: 0.45 }); s.at(bar, 2.5, () => dum(0.35, { f0: 90, f1: 55 }), { gain: 0.3 }); s.at(bar, 3.5, () => tak(0.13, { seed: 41 + bar }), { gain: 0.26, pan: -0.3 });
    for (let k = 0; k < 8; k++) s.at(bar, k * 0.5, () => shaker(0.09, { seed: 80 + k + bar, open: k % 2 ? 0.55 : 0.1 }), { gain: 0.1 + 0.06 * (k % 2), pan: 0.45 });
    // عود: جذر، ثم قفزة إلى الخامسة والسابعة الحجازية
    [[0, 0], [1.5, 0], [2, 4], [3, 6], [3.5, 4]].forEach(([beat, d], k) => s.at(bar, beat, () => oud(hz(deg(sc, c + d, -1) - 12), 0.9, { seed: 9 + bar * 5 + k, bright: 0.5 }), { gain: k === 0 ? 0.5 : 0.36, pan: -0.15 }));
    // ماريمبا: زخرفة حجازية متقطعة في البارات الزوجية
    if (bar % 2 === 1) [[0.5, 1], [1, 2], [1.5, 1], [2.5, 0], [3, 2], [3.5, 4]].forEach(([beat, d], k) => s.at(bar, beat, () => marimba(hz(deg(sc, c + d, 1)), 0.5, { soft: 0.4, seed: 21 + k }), { gain: 0.3, pan: -0.25 + 0.5 * (k / 5) }));
    // بطانة رقيقة تحت كل تآلف (جذر + خامسة)
    if (bar % 2 === 0) { s.at(bar, 0, () => padStereo(pad(hz(rootN), s.beat * 8 - 0.3, { a: 0.9, r: 1.0, cutoff: 750, sweepAmt: 350, lfo: 0.18 })), { gain: 0.36 }); s.at(bar, 0, () => padStereo(pad(hz(deg(sc, c + 4, -1)), s.beat * 8 - 0.3, { a: 1.2, r: 1.0, cutoff: 700, sweepAmt: 250 })), { gain: 0.2 }); }
  });
  [3, 7, 11, 15].forEach((bar, i) => s.at(bar, 3.5, () => glass(hz(deg(sc, [7, 11, 9, 14][i], 1)), 0.9), { gain: 0.16, pan: i % 2 ? 0.3 : -0.3 }));
  return s;
}

// ── نهاية النتائج: 6 ثوانٍ، تُعزف مرة واحدة ─────────────────────────────────────
function finale() {
  const st = new Stereo(6.5), sc = 'nahawand', b = 60 / 84;
  let t = 0; for (let i = 0; t < 1.3; i++) { st.mix(tak(0.12, { seed: 90 + i, tone: 1900 + 900 * (t / 1.3) }), t, { gain: 0.25 + 0.3 * (t / 1.3), pan: i % 2 ? 0.25 : -0.25 }); t += 0.1 - 0.06 * (t / 1.3); }
  st.mix(dum(0.6), 1.3, { gain: 0.9 });
  [[0, 1.3, -0.3], [2, 1.3, 0], [4, 1.3, 0.3], [7, 1.3, 0.1]].forEach(([d, at, pan]) => st.mix(marimba(hz(deg(sc, d, 0)), 1.8, { soft: 0.45 }), at, { gain: 0.5, pan }));
  [[7, 1.3], [9, 1.3 + b * 0.5], [11, 1.3 + b], [14, 1.3 + b * 1.5]].forEach(([d, at], k) => st.mix(kalimba(hz(deg(sc, d, 0)), 1.6), at, { gain: 0.6, pan: -0.3 + 0.2 * k }));
  st.mix(bell(hz(deg(sc, 14, 0)), 3.2), 1.3 + b * 1.5, { gain: 0.45, pan: 0.2 }).mix(bell(hz(deg(sc, 11, 0)), 3.0), 1.3 + b * 2, { gain: 0.3, pan: -0.2 });
  st.mix(padStereo(pad(hz(deg(sc, 0, -1)), 2.4, { a: 0.4, r: 1.6, cutoff: 800 })), 1.2, { gain: 0.7 });
  st.mix(padStereo(pad(hz(deg(sc, 4, -1)), 2.2, { a: 0.6, r: 1.6, cutoff: 700 })), 1.3, { gain: 0.4 });
  st.mix(glass(hz(deg(sc, 14, 1)), 1), 1.3 + b * 1.5, { gain: 0.2 });
  return st;
}

export const TRACKS = {
  home: { bpm: 72, loop: true, lufs: -19, build: home },
  calm: { bpm: 66, loop: true, lufs: -21, build: calm },
  tense: { bpm: 96, loop: true, lufs: -18, build: tense },
  finale: { bpm: 84, loop: false, lufs: -16, build: finale },
};
const sha = (buf) => createHash('sha256').update(buf).digest('hex');

async function renderTrack(id, track, ir) {
  // الحلقة تُعزف دورتين، ويُطبَّق الصدى على الدورتين معًا، ثم تُقتطع الدورة الثانية: بدايتها
  // تحمل ذيول نهاية الأولى (نغمات وصدى) تمامًا كما ستسمعها الأذن عند العودة من نهاية الحلقة.
  let dry, seconds, from = 0;
  if (track.loop) { const seq = track.build(); dry = seq.render(3); seconds = seq.length; from = seconds; }
  else { dry = track.build().fade(0.002, 0.4); seconds = dry.seconds; }
  dry.normalize(-6);
  const dryWav = path.join(workDir, `${id}.dry.wav`), revWav = path.join(workDir, `${id}.rev.wav`), masterWav = path.join(mastersDir, `${id}.wav`);
  await writeWav(dryWav, dry);
  await reverbFile(dryWav, ir, revWav, { wetDb: -13, wetHighpass: 160 });
  // الإتقان (مرشّح عالٍ ورفّ وحدّ) يجري على الدورتين معًا كي لا تبدأ مرشّحاته من الصفر عند
  // بداية الحلقة؛ ثم تُقتطع الدورة الثانية من الملف المُتقَن ويُقاس الملف النهائي.
  const fullWav = path.join(workDir, `${id}.mastered.wav`);
  await master(revWav, fullWav, { truePeakDb: -1.5, lufs: track.lufs, highpass: 32, extra: 'highshelf=f=9000:g=-1.5' });
  await writeWav(masterWav, decodeWav24(await readFile(fullWav)).slice(from, from + seconds));
  const measured = await measure(masterWav);
  return { masterWav, measured, seconds };
}

async function main() {
  await mkdir(workDir, { recursive: true }); await mkdir(mastersDir, { recursive: true }); await mkdir(outDir, { recursive: true });
  const provenanceFile = path.join(mastersDir, 'provenance.json');
  const existing = check ? JSON.parse(await readFile(provenanceFile, 'utf8')) : null;
  const ir = path.join(workDir, 'ir-hall.wav');
  if (!check) await writeWav(ir, impulseResponse({ seconds: 2.6, damp: 3200, predelay: 0.024, seed: 17 }));
  const bank = {}, provenance = { generator: 'scripts/audio/music.mjs (deterministic composition and synthesis, ffmpeg-static mastering)', key: 'D', tracks: {} };
  for (const [id, track] of Object.entries(TRACKS)) {
    if (only && id !== only) continue;
    const m4a = path.join(outDir, `${id}.m4a`);
    let info;
    if (check) { info = existing?.tracks?.[id]; if (!info) throw new Error(`provenance lacks ${id}`); }
    else {
      const started = Date.now();
      const { masterWav, measured, seconds } = await renderTrack(id, track, ir);
      const encoded = await encodeAac(masterWav, m4a, { bitrate: '192k' });
      const pcm = (await readFile(masterWav)).subarray(44);
      info = { file: `audio/music/${id}.m4a`, seconds: Number(seconds.toFixed(4)), frames: pcm.length / 6, bpm: track.bpm, loop: track.loop, targetLufs: track.lufs, measured,
        masterSha256: sha(pcm), encodedSha256: sha(encoded), encodedBytes: encoded.length };
      console.log(`${id.padEnd(7)} ${seconds.toFixed(1).padStart(6)}s  I ${String(measured.lufs).padStart(6)} LUFS  LRA ${String(measured.lra).padStart(5)}  TP ${String(measured.truePeak).padStart(5)}  ${(encoded.length / 1024).toFixed(0)} KB  (${((Date.now() - started) / 1000).toFixed(1)} s)`);
    }
    const encoded = await readFile(m4a);
    bank[id] = { url: info.file, seconds: info.seconds, frames: info.frames, bytes: encoded.length, sha256: sha(encoded), masterSha256: info.masterSha256, loop: info.loop, bpm: info.bpm };
    provenance.tracks[id] = info;
  }
  if (only) { console.log('single track rebuilt; manifest not rewritten'); return; }
  const text = '// Generated by scripts/audio/music.mjs — Maydan\'s own background music (composed and synthesized in-repo).\n'
    + '// Masters: assets/audio/maydan-v2/music/*.wav; files: public/audio/music (AAC 192 kb/s), fetched on first play, never precached.\n'
    + `export const MUSIC_BANK = ${JSON.stringify(bank, null, 2)};\n`;
  if (check) {
    if (await readFile(manifestFile, 'utf8') !== text) throw new Error('music-bank.js differs from public/audio/music; run node scripts/audio/music.mjs');
    console.log(`Music bank verified: ${Object.keys(bank).length} tracks`); return;
  }
  await writeFile(manifestFile, text, 'utf8');
  await writeFile(provenanceFile, `${JSON.stringify(provenance, null, 2)}\n`, 'utf8');
  await rm(workDir, { recursive: true, force: true });
  const total = Object.values(bank).reduce((s, e) => s + e.bytes, 0);
  console.log(`Music bank: ${Object.keys(bank).length} tracks, ${(total / 1024 / 1024).toFixed(2)} MB of AAC in public/audio/music`);
}
main().catch((error) => { console.error(error.stack || error.message); process.exit(1); });

// موسيقى ميدان الخلفية (3.1، كرتونية هادئة): ثلاث حلقات ونهاية قصيرة على ري بسلّم خماسي
// معلَّق (ري مي صول لا سي) يجلس مع مؤثرات ري الكبيرة والصغيرة معًا، بآلات لعبة ناعمة
// (بيتزيكاتو، ماريمبا، إكسيليفون، غلوكنشبيل، باص لطيف، فقاعات) بلا طبول ولا ناي. تُصنع
// «بلا وصلة»: تُعزف الدورة مرتين، يُطبَّق الصدى على الكل، ثم تُقتطع الدورة الثانية.
//
//   node scripts/audio/music.mjs            يبني الحلقات كلها
//   node scripts/audio/music.mjs --only home
//   node scripts/audio/music.mjs --check
import { readFile, writeFile, mkdir, rm, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Stereo, midi, writeWav, decodeWav24, impulseResponse, reverbFile, master, encodeAac, measure } from './engine.mjs';
import { marimba, glass, shaker, padStereo, m, pizz, xylo, glock, softBass, bubble, softPad } from './voices.mjs';
import { prepareSource, sourceProvenance, resolveSource } from './prepare.mjs';
import { convertFile, pitchShiftFile, filter } from './engine.mjs';
import { seamlessLoop, seamMetrics } from './analysis.mjs';
import { checkSources } from './build.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const mastersDir = path.join(root, 'assets/audio/maydan-v3/music');
const workDir = path.join(root, '.cache/audio-work-music');
const outDir = path.join(root, 'public/audio/music');
const manifestFile = path.join(root, 'src/shared/fx/music-bank.js');
const args = process.argv.slice(2);
const check = args.includes('--check');
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;

// سلالم على ري: درجات نصف-نغمية من الجذر.
const SCALES = { nahawand: [0, 2, 3, 5, 7, 8, 10], kurd: [0, 1, 3, 5, 7, 8, 10], hijaz: [0, 1, 4, 5, 7, 8, 10], toy: [0, 2, 5, 7, 9] };
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

// تآلفات اللوحة الكرتونية على الخماسي المعلَّق: كل تآلف = درجات السلّم [جذر، خامسة، أوكتاف، لون].
// D(0): ري لا ري مي · G(2): صول ري صول لا · Em(1): مي سي مي صول · Asus(3): لا مي لا ري
const CHORD = { D: [0, 3, 5, 6], G: [2, 5, 7, 8], Em: [1, 4, 6, 7], A: [3, 6, 8, 10] };
const sc = 'toy';

// ── القوائم: 84 نبضة، 16 بارًا (~46 ث) — باص لطيف، بيتزيكاتو خفيف، لحن ماريمبا، غلوكنشبيل نادر ──
function home() {
  const s = new Seq(84, 16);
  const prog = ['D', 'G', 'Em', 'A', 'D', 'G', 'A', 'D'];
  prog.forEach((name, i) => {
    const bar = i * 2, ch = CHORD[name];
    const root = deg(sc, ch[0], -1), fifth = deg(sc, ch[1], -1);
    // بطانة رقيقة جدًا تحت التآلف
    s.at(bar, 0, () => padStereo(softPad(hz(root), s.beat * 8 - 0.3)), { gain: 0.42 });
    s.at(bar, 0.02, () => padStereo(softPad(hz(fifth), s.beat * 8 - 0.3, { a: 1.6 })), { gain: 0.22 });
    // باص: جذر على 1، خامسة على 3 (باران)
    for (let b = 0; b < 2; b++) { s.at(bar + b, 0, () => softBass(hz(root - 12), 0.7), { gain: 0.5 }); s.at(bar + b, 2, () => softBass(hz(fifth - 12), 0.6), { gain: 0.36 }); }
    // بيتزيكاتو على الضعيف: 1.5، 2.5، 3.5 (ألوان التآلف)
    for (let b = 0; b < 2; b++) [[1.5, ch[1]], [2.5, ch[2]], [3.5, ch[3]]].forEach(([beat, d], k) => s.at(bar + b, beat, () => pizz(hz(deg(sc, d, 0)), 0.55, { seed: 7 + i * 3 + k }), { gain: 0.26, pan: -0.25 + 0.25 * k }));
    // شخشيخة خفيفة جدًا على 2 و4
    for (let b = 0; b < 2; b++) [1, 3].forEach((beat, k) => s.at(bar + b, beat, () => shaker(0.08, { seed: 60 + i * 2 + k, open: 0.3 }), { gain: 0.045, pan: 0.4 }));
  });
  // لحن ماريمبا لطيف (جملتان من ثمانية بارات، الثانية تجيب الأولى)
  const melody = (bar, notes) => notes.forEach(([beat, d, len]) => s.at(bar + Math.floor(beat / 4), beat % 4, () => marimba(hz(deg(sc, d, 1)), Math.max(0.5, len * s.beat + 0.3), { soft: 0.75, seed: 5 + d }), { gain: 0.36, pan: 0.1 - 0.05 * (d % 3) }));
  melody(0, [[0, 3, 1], [1, 4, 0.5], [1.5, 3, 0.5], [2, 2, 1], [4, 0, 1.5], [6, 1, 1], [7, 2, 1], [8, 3, 1], [9, 5, 0.5], [9.5, 4, 0.5], [10, 3, 2], [12, 2, 1], [13, 1, 1], [14, 0, 2], [20, 3, 1], [21, 2, 1], [22, 4, 2], [24, 5, 1], [25, 4, 1], [26, 3, 1], [27, 2, 1], [28, 0, 3]]);
  melody(8, [[0, 5, 1], [1, 4, 0.5], [1.5, 3, 0.5], [2, 4, 1], [4, 2, 1.5], [6, 3, 1], [7, 4, 1], [8, 5, 1], [9, 7, 0.5], [9.5, 5, 0.5], [10, 4, 2], [12, 3, 1], [13, 2, 1], [14, 1, 2], [20, 2, 1], [21, 3, 1], [22, 4, 1], [23, 3, 1], [24, 2, 1.5], [26, 1, 1], [27, 0, 1], [28, 0, 3]]);
  // غلوكنشبيل: نغمة واحدة ناعمة على بداية كل أربعة بارات، وفقاعة كرتونية قبل نهايتها
  [0, 4, 8, 12].forEach((bar, i) => { s.at(bar, 0, () => glock(hz(deg(sc, [5, 7, 6, 8][i], 1)), 1.8), { gain: 0.11, pan: i % 2 ? 0.35 : -0.35 }); s.at(bar + 3, 3.5, () => bubble(420 + 60 * i, 0.14), { gain: 0.1, pan: 0.2 * (i % 2 ? 1 : -1) }); });
  return s;
}

// ── اللعب الهادئ: 66 نبضة، 16 بارًا (~58 ث) — بلا إيقاع: بطانة، باص على 1، ماريمبا بطيئة ──
function calm() {
  const s = new Seq(66, 16);
  const prog = ['D', 'Em', 'G', 'A', 'D', 'G', 'Em', 'D'];
  prog.forEach((name, i) => {
    const bar = i * 2, ch = CHORD[name], root = deg(sc, ch[0], -1), fifth = deg(sc, ch[1], -1);
    s.at(bar, 0, () => padStereo(softPad(hz(root), s.beat * 8 - 0.4, { a: 1.8, r: 2 })), { gain: 0.46 });
    s.at(bar, 0.03, () => padStereo(softPad(hz(fifth), s.beat * 8 - 0.4, { a: 2.4, r: 2 })), { gain: 0.24 });
    s.at(bar, 0, () => softBass(hz(root - 12), 1.4), { gain: 0.4 });
    s.at(bar + 1, 0, () => softBass(hz(fifth - 12), 1.2), { gain: 0.26 });
    // بيتزيكاتو: نغمة لون واحدة كل بار على 2.5
    s.at(bar, 2.5, () => pizz(hz(deg(sc, ch[3], 0)), 0.8, { seed: 17 + i }), { gain: 0.2, pan: 0.25 });
    s.at(bar + 1, 2.5, () => pizz(hz(deg(sc, ch[2], 0)), 0.8, { seed: 27 + i }), { gain: 0.16, pan: -0.25 });
  });
  const melody = (bar, notes) => notes.forEach(([beat, d, len]) => s.at(bar + Math.floor(beat / 4), beat % 4, () => marimba(hz(deg(sc, d, 1)), Math.max(0.8, len * s.beat + 0.4), { soft: 0.85, seed: 3 + d }), { gain: 0.3, pan: -0.1 + 0.06 * (d % 4) }));
  melody(0, [[0, 3, 2], [2, 4, 1], [3, 3, 1], [4, 2, 3], [8, 1, 2], [10, 2, 1], [11, 3, 1], [12, 5, 4], [18, 4, 1], [19, 3, 1], [20, 2, 2], [22, 1, 2], [24, 0, 4]]);
  melody(8, [[0, 5, 2], [2, 4, 1], [3, 5, 1], [4, 6, 3], [8, 4, 2], [10, 3, 1], [11, 2, 1], [12, 3, 4], [18, 2, 1], [19, 1, 1], [20, 2, 2], [22, 1, 2], [24, 0, 4]]);
  [2, 7, 10, 15].forEach((bar, i) => s.at(bar, 1.5, () => glock(hz(deg(sc, [7, 8, 6, 5][i], 1)), 2.2), { gain: 0.09, pan: i % 2 ? 0.4 : -0.4 }));
  [5, 13].forEach((bar, i) => s.at(bar, 3.5, () => bubble(380 + 80 * i, 0.16), { gain: 0.08, pan: 0.15 }));
  return s;
}

// ── المؤقتات: 100 نبضة، 16 بارًا (~38 ث) — أوستيناتو بيتزيكاتو وتكّة ساعة خفيفة، بلا طبول ─────
function tense() {
  const s = new Seq(100, 16);
  const prog = ['D', 'D', 'G', 'G', 'Em', 'Em', 'A', 'A', 'D', 'D', 'G', 'G', 'A', 'A', 'D', 'D'];
  prog.forEach((name, bar) => {
    const ch = CHORD[name], root = deg(sc, ch[0], -1);
    // أوستيناتو ثُمنيات: جذر خامسة أوكتاف خامسة (باص وبيتزيكاتو يتبادلان)
    [ch[0], ch[1], ch[2], ch[1], ch[0], ch[1], ch[3], ch[1]].forEach((d, k) => s.at(bar, k * 0.5, () => pizz(hz(deg(sc, d, 0)), 0.42, { seed: 9 + bar * 8 + k }), { gain: k % 2 ? 0.2 : 0.28, pan: -0.2 + 0.4 * (k % 2) }));
    s.at(bar, 0, () => softBass(hz(root - 12), 0.45), { gain: 0.46 }); s.at(bar, 2, () => softBass(hz(root - 12), 0.45), { gain: 0.34 });
    // تكّة ساعة خفيفة على 2 و4، وشخشيخة على «و»
    [1, 3].forEach((beat, k) => s.at(bar, beat, () => xylo(hz(deg(sc, k ? 3 : 5, 2)), 0.12, { seed: 31 + bar + k }), { gain: 0.1, pan: k ? 0.3 : -0.3 }));
    for (let k = 0; k < 4; k++) s.at(bar, k + 0.5, () => shaker(0.07, { seed: 80 + bar * 4 + k, open: 0.25 }), { gain: 0.05, pan: 0.45 });
    // لازمة إكسيليفون قصيرة في البارات الفردية
    if (bar % 2 === 1) [[0.5, ch[2]], [1, ch[3]], [1.5, ch[2]], [2.5, ch[1]], [3, ch[2]]].forEach(([beat, d], k) => s.at(bar, beat, () => xylo(hz(deg(sc, d, 1)), 0.35, { seed: 21 + bar + k }), { gain: 0.24, pan: -0.25 + 0.5 * (k / 4) }));
    if (bar % 2 === 0) s.at(bar, 0, () => padStereo(softPad(hz(root), s.beat * 8 - 0.3, { a: 0.8, r: 1 })), { gain: 0.3 });
  });
  [3, 7, 11, 15].forEach((bar, i) => s.at(bar, 3.5, () => glass(hz(deg(sc, [7, 8, 6, 9][i], 1)), 0.8), { gain: 0.12, pan: i % 2 ? 0.3 : -0.3 }));
  return s;
}

// ── نهاية النتائج: ~5.5 ثوانٍ، تُعزف مرة واحدة — ركضة إكسيليفون صاعدة وتآلف غلوكنشبيل ─────
function finale() {
  const st = new Stereo(6.5), b = 60 / 96;
  [0, 1, 2, 3, 4, 5, 6, 7].forEach((d, k) => st.mix(xylo(hz(deg(sc, d, 1)), 0.4, { seed: 40 + k }), k * b * 0.25, { gain: 0.42, pan: -0.35 + 0.1 * k }));
  st.mix(bubble(520, 0.18), b * 2, { gain: 0.16, pan: 0.2 });
  st.mix(softBass(hz(deg(sc, 0, -2)), 1.6), b * 2.25, { gain: 0.6 });
  [[5, 0.5, -0.3], [8, 0.5, 0], [10, 0.5, 0.3]].forEach(([d, g, pan], k) => st.mix(marimba(hz(deg(sc, d, 0)), 2.2, { soft: 0.6 }), b * 2.25 + 0.02 * k, { gain: g, pan }));
  st.mix(glock(hz(deg(sc, 10, 0)), 3), b * 2.25, { gain: 0.3, pan: 0.2 }).mix(glock(hz(deg(sc, 5, 1)), 2.6), b * 2.75, { gain: 0.22, pan: -0.2 });
  st.mix(padStereo(softPad(hz(deg(sc, 0, -1)), 2.2, { a: 0.3, r: 1.6 })), b * 2.2, { gain: 0.6 });
  return st;
}

// أهداف أهدأ من 3.0: الموسيقى خلفية حقًا تحت المؤثرات.
export const TRACKS = {
  home: { bpm: 84, loop: true, lufs: -22, build: home },
  calm: { bpm: 66, loop: true, lufs: -24, build: calm },
  tense: { bpm: 100, loop: true, lufs: -21, build: tense },
  finale: { bpm: 96, loop: false, lufs: -18, build: finale },
};
const sha = (buf) => createHash('sha256').update(buf).digest('hex');

// عتبات الوصلة لحلقة من مصدر خارجي: قفزة مستوى، انقطاع عيّنة، نقرة ترددات عالية.
const SEAM_LIMITS = { discontinuity: 0.02, hfClickDb: 3 };
// مقطع من مصدر مرخَّص: حلقة بطول بارات محدَّد مع تلاشٍ متبادل عند الوصلة (analysis.seamlessLoop)،
// تُتقَن مضاعفةً (الحلقة مرتين) ثم تُقتطع الثانية كما تُصنع الحلقات الداخلية؛ أو نهاية قصيرة.
async function renderSourcedTrack(id, track, { masterWav }) {
  const spec = track.source;
  let prepared, seconds, from = 0, loop = null;
  const fullWav = path.join(workDir, `${id}.mastered.wav`), dryWav = path.join(workDir, `${id}.dry.wav`);
  if (track.loop) {
    const resolved = await resolveSource(spec.id);
    const src = path.join(workDir, `${id}.src.wav`);
    await convertFile(resolved.file, src);
    let wav = src;
    const modifications = [`converted from ${resolved.entry.probe.codec} ${resolved.entry.probe.sampleRate} Hz${resolved.entry.probe.kbps ? ` ${resolved.entry.probe.kbps} kb/s` : ''} to 48 kHz stereo PCM24 (soxr)`];
    if (spec.pitchSemitones) { const shifted = path.join(workDir, `${id}.pitch.wav`); await pitchShiftFile(src, shifted, spec.pitchSemitones, { transients: 'mixed' }); wav = shifted; modifications.push(`pitch shifted ${spec.pitchSemitones} semitones (rubberband) toward D`); }
    const st = decodeWav24(await readFile(wav));
    const beats = spec.beats || 4, beat = 60 / track.bpm, L = spec.bars * beats * beat, xf = (spec.crossfadeBeats || 0) * beat;
    const looped = seamlessLoop(st, spec.offset || 0, L, xf);
    if (spec.highpass) { filter(looped.L, 'highpass', spec.highpass, 0.707); filter(looped.R, 'highpass', spec.highpass, 0.707); modifications.push(`high-pass ${spec.highpass} Hz`); }
    modifications.push(`loop of ${spec.bars} bars (${L.toFixed(3)} s) from ${(spec.offset || 0).toFixed(3)} s${xf ? `, ${spec.crossfadeBeats} beat equal-power crossfade of the following tail into the head` : ', authored loop point'}`);
    const dbl = new Stereo(2 * L); dbl.mix(looped, 0).mix(looped, L);
    dbl.normalize(-6);
    await writeWav(dryWav, dbl);
    await master(dryWav, fullWav, { truePeakDb: -1.5, lufs: track.lufs, highpass: 32 });
    seconds = L; from = L;
    prepared = { ...resolved, modifications };
    loop = { offset: spec.offset || 0, bars: spec.bars, beats, crossfadeBeats: spec.crossfadeBeats || 0 };
  } else {
    prepared = await prepareSource(spec, { role: 'win', workDir, name: id });
    const st = prepared.st.normalize(-6);
    seconds = st.seconds;
    await writeWav(dryWav, st);
    await master(dryWav, fullWav, { truePeakDb: -1.5, lufs: track.lufs, highpass: 32 });
  }
  await writeWav(masterWav, decodeWav24(await readFile(fullWav)).slice(from, from + seconds));
  const measured = await measure(masterWav);
  if (loop) {
    loop.seam = seamMetrics(decodeWav24(await readFile(masterWav)), { bpm: track.bpm });
    if (loop.seam.discontinuity > SEAM_LIMITS.discontinuity || loop.seam.hfClickDb > SEAM_LIMITS.hfClickDb) throw new Error(`${id}: loop seam is audible (${JSON.stringify(loop.seam)}); adjust offset/bars/crossfadeBeats`);
    prepared.modifications.push(`mastered as a double loop to ${track.lufs} LUFS / −1.5 dBTP, second cycle kept (seam: step ${loop.seam.discontinuity}, HF ${loop.seam.hfClickDb} dB)`);
  } else prepared.modifications.push(`mastered to ${track.lufs} LUFS / −1.5 dBTP`);
  return { masterWav, measured, seconds, prepared, loop };
}

async function renderTrack(id, track, ir) {
  if (track.source) return renderSourcedTrack(id, track, { masterWav: path.join(mastersDir, `${id}.wav`) });
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
  // رفّ عالٍ أنعم من 3.0 (−3 dB فوق 6 kHz): الأجراس والإكسيليفون لا تلسع على سماعات الهاتف.
  await master(revWav, fullWav, { truePeakDb: -1.5, lufs: track.lufs, highpass: 32, extra: 'highshelf=f=6000:g=-3' });
  await writeWav(masterWav, decodeWav24(await readFile(fullWav)).slice(from, from + seconds));
  const measured = await measure(masterWav);
  return { masterWav, measured, seconds };
}

const provenanceFile = path.join(mastersDir, 'provenance.json');
const hashedName = (base, encoded) => `${base}-${sha(encoded).slice(0, 6)}.m4a`;
const rel = (file) => path.relative(root, file).split(path.sep).join('/');
async function screeningFor(id) {
  try { const s = JSON.parse(await readFile(path.join(mastersDir, '../screening.json'), 'utf8')); return s.selection?.[id] || null; } catch { return null; }
}

async function main() {
  await mkdir(workDir, { recursive: true }); await mkdir(mastersDir, { recursive: true }); await mkdir(outDir, { recursive: true });
  const existing = (check || only) ? JSON.parse(await readFile(provenanceFile, 'utf8')) : null;
  const ir = path.join(workDir, 'ir-hall.wav');
  if (!check) await writeWav(ir, impulseResponse({ seconds: 2.6, damp: 3200, predelay: 0.024, seed: 17 }));
  const bank = {}, provenance = { generator: 'scripts/audio/music.mjs (deterministic composition and synthesis, ffmpeg-static mastering)', key: 'D', tracks: {} };
  const referenced = new Set();
  for (const [id, track] of Object.entries(TRACKS)) {
    let info;
    if (check || (only && id !== only)) { info = existing?.tracks?.[id]; if (!info) throw new Error(`provenance lacks ${id}`); }
    else {
      const started = Date.now();
      const { masterWav, measured, seconds, prepared, loop } = await renderTrack(id, track, ir);
      const encoded = await encodeAac(masterWav, path.join(workDir, `${id}.m4a`), { bitrate: '192k' });
      const file = `audio/music/${hashedName(id, encoded)}`;
      await writeFile(path.join(root, 'public', file), encoded);
      const pcm = (await readFile(masterWav)).subarray(44);
      const screening = await screeningFor(id);
      info = { file, master: rel(masterWav), seconds: Number(seconds.toFixed(4)), frames: pcm.length / 6, bpm: track.bpm, loop: track.loop, targetLufs: track.lufs, measured,
        masterSha256: sha(pcm), encodedSha256: sha(encoded), encodedBytes: encoded.length, origin: prepared ? 'sourced' : 'in-house',
        ...(prepared ? { source: sourceProvenance(prepared, { screening: screening ? { total: screening.bestScore, baseline: screening.baseline, decision: screening.decision } : null }), ...(loop ? { loopRegion: loop } : {}) }
          : { decision: { kept: 'in-house', reason: screening ? `best challenger ${screening.best || 'none'} scored ${screening.bestScore ?? '-'} vs ${screening.baseline} (needs ≥ 70 and ≥ baseline + 5)` : 'no screening on record' } }) };
      console.log(`${id.padEnd(7)} ${seconds.toFixed(1).padStart(6)}s  I ${String(measured.lufs).padStart(6)} LUFS  LRA ${String(measured.lra).padStart(5)}  TP ${String(measured.truePeak).padStart(5)}  ${(encoded.length / 1024).toFixed(0)} KB  (${((Date.now() - started) / 1000).toFixed(1)} s)`);
    }
    const encoded = await readFile(path.join(root, 'public', info.file));
    if (path.basename(info.file) !== hashedName(id, encoded)) throw new Error(`${info.file} is not named after its content hash; run node scripts/audio/music.mjs`);
    referenced.add(path.basename(info.file));
    bank[id] = { url: info.file, seconds: info.seconds, frames: info.frames, bytes: encoded.length, sha256: sha(encoded), masterSha256: info.masterSha256, loop: info.loop, bpm: info.bpm };
    provenance.tracks[id] = info;
  }
  const orphans = (await readdir(outDir)).filter((name) => name.endsWith('.m4a') && !referenced.has(name));
  const text = '// Generated by scripts/audio/music.mjs — Maydan\'s background music (in-house compositions and licensed tracks; see assets/audio/maydan-v3/music/provenance.json).\n'
    + '// Masters: assets/audio/maydan-v3/music/*.wav; files: public/audio/music (AAC 192 kb/s, content-hashed names), fetched on first play, never precached.\n'
    + `export const MUSIC_BANK = ${JSON.stringify(bank, null, 2)};\n`;
  if (check) {
    if (orphans.length) throw new Error(`public/audio/music holds files no track references: ${orphans.join(', ')}`);
    if (await readFile(manifestFile, 'utf8') !== text) throw new Error('music-bank.js differs from public/audio/music; run node scripts/audio/music.mjs');
    await checkSources(provenance.tracks);
    console.log(`Music bank verified: ${Object.keys(bank).length} tracks (${Object.values(provenance.tracks).filter((t) => t.source).length} from licensed sources)`); return;
  }
  for (const name of orphans) await rm(path.join(outDir, name));
  await writeFile(manifestFile, text, 'utf8');
  await writeFile(provenanceFile, `${JSON.stringify(provenance, null, 2)}\n`, 'utf8');
  await rm(workDir, { recursive: true, force: true });
  const total = Object.values(bank).reduce((s, e) => s + e.bytes, 0);
  console.log(`Music bank: ${Object.keys(bank).length} tracks, ${(total / 1024 / 1024).toFixed(2)} MB of AAC in public/audio/music${orphans.length ? `; removed ${orphans.length} stale file(s)` : ''}`);
}
main().catch((error) => { console.error(error.stack || error.message); process.exit(1); });

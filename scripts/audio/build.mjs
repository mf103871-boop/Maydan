// يبني بنك مؤثرات ميدان من الصفر: تصميم كل مؤثر (أدناه) → مزج جاف 48 kHz → صدى التفافي
// → إتقان بذروة حقيقية مستهدفة → AAC في public/audio → manifest في src/shared/fx/sample-bank.js
// وسجل قياسات في assets/audio/maydan-v2/provenance.json. حتمي: البذور ثابتة، وffmpeg بلا وسوم.
//
//   node scripts/audio/build.mjs            يبني كل شيء
//   node scripts/audio/build.mjs --only win يبني مؤثرًا واحدًا
//   node scripts/audio/build.mjs --check    يتحقق أن manifest يطابق الملفات (CI)
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Stereo, midi, secs, writeWav, decodeWav24, impulseResponse, reverbFile, master, encodeAac, applyEnv, filter, noise, sweep, perc } from './engine.mjs';
import { kalimba, marimba, bell, glass, oud, pad, dum, tak, shaker, whoosh, thump, woodTick, buzz, place, padStereo, m } from './voices.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const mastersDir = path.join(root, 'assets/audio/maydan-v2');
const workDir = path.join(root, '.cache/audio-work');
const outDir = path.join(root, 'public/audio');
const manifestFile = path.join(root, 'src/shared/fx/sample-bank.js');
const args = process.argv.slice(2);
const check = args.includes('--check');
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
const f = (name, oct) => midi(m(name, oct));

// المفتاح المشترك للمنصة: ري (D). الموسيقى في مقام كرد/نهاوند على ري، فتنسجم المؤثرات معها.
// كل تصميم يعيد Stereo جافًا؛ room = غرفة خشبية قصيرة، hall = قاعة ناعمة للنهايات.
export const CUES = {
  click: { file: 'click', room: 'room', wetDb: -20, peak: -10, design: () => new Stereo(0.25)
    .mix(marimba(f('D', 6), 0.14, { soft: 0.7 }), 0, { gain: 0.8 })
    .mix(woodTick(3300, 0.02, { seed: 63 }), 0, { gain: 0.25 }) },
  pop: { file: 'pop', room: 'room', wetDb: -15, peak: -8, design: () => new Stereo(0.5)
    .mix(kalimba(f('A', 5), 0.42), 0, { gain: 0.9, pan: 0.08 }) },
  tick: { file: 'tick', room: null, peak: -15, design: () => new Stereo(0.09)
    .mix(woodTick(1900, 0.05), 0, { gain: 1 }) },
  tickFast: { file: 'tick-fast', room: null, peak: -12, design: () => new Stereo(0.09)
    .mix(woodTick(2500, 0.045, { seed: 65 }), 0, { gain: 1 })
    .mix(glass(f('D', 7), 0.07), 0, { gain: 0.2 }) },
  countdown: { file: 'countdown', room: 'room', wetDb: -13, peak: -7, design: () => new Stereo(0.6)
    .mix(marimba(f('D', 5), 0.45, { soft: 0.4 }), 0, { gain: 0.9 })
    .mix(dum(0.3, { f0: 110, f1: 70 }), 0, { gain: 0.35 }) },
  start: { file: 'start', room: 'hall', wetDb: -11, peak: -5, design: () => {
    const st = new Stereo(1.5);
    st.mix(dum(0.45), 0, { gain: 0.7 }).mix(shaker(0.1), 0.02, { gain: 0.35, pan: 0.5 });
    [[f('D', 5), 0, -0.3], [f('A', 5), 0.11, 0.1], [f('D', 6), 0.22, 0.35]].forEach(([fr, at, pan]) => st.mix(kalimba(fr, 0.9), at, { gain: 0.75, pan }));
    st.mix(glass(f('D', 6), 0.5), 0.22, { gain: 0.35, pan: -0.2 }).mix(bell(f('A', 5), 1.2, { tau: 0.6 }), 0.33, { gain: 0.3 });
    return st;
  } },
  correct: { file: 'correct', room: 'room', wetDb: -13, peak: -6, design: () => new Stereo(0.9)
    .mix(kalimba(f('A', 4), 0.7), 0, { gain: 0.8, pan: -0.15 })
    .mix(kalimba(f('D', 5), 0.75), 0.09, { gain: 0.9, pan: 0.15 })
    .mix(glass(f('D', 6), 0.45), 0.1, { gain: 0.3, pan: 0.05 }) },
  wrong: { file: 'wrong', room: 'room', wetDb: -15, peak: -7, design: () => new Stereo(0.75)
    .mix(marimba(f('F', 3), 0.55, { soft: 0.75 }), 0, { gain: 0.9 })
    .mix(marimba(f('E', 3), 0.6, { soft: 0.8 }), 0.12, { gain: 0.85 })
    .mix(thump(0.3, { f0: 90, f1: 45 }), 0.12, { gain: 0.25 }) },
  buzzer: { file: 'buzzer', room: 'room', wetDb: -17, peak: -6, design: () => new Stereo(0.8)
    .mix(buzz(112, 0.52), 0, { gain: 0.55 })
    .mix(thump(0.35, { f0: 120, f1: 40 }), 0, { gain: 0.4 })
    .mix(marimba(f('D', 3), 0.5, { soft: 0.6 }), 0, { gain: 0.35 }) },
  timeout: { file: 'timeout', room: 'hall', wetDb: -13, peak: -6, design: () => {
    const st = new Stereo(1.3);
    [[f('G', 4), 0], [f('F', 4), 0.15], [f('D', 4), 0.3]].forEach(([fr, at], i) => st.mix(marimba(fr, 0.7, { soft: 0.5 }), at, { gain: 0.85, pan: -0.2 + 0.2 * i }));
    return st.mix(dum(0.5), 0.3, { gain: 0.55 });
  } },
  whoosh: { file: 'whoosh', room: 'room', wetDb: -16, peak: -12, design: () => new Stereo(0.55)
    .mix(whoosh(0.42, { from: 300, to: 2800, shape: 0.6 }), 0, { gain: 1, pan: -0.25 })
    .mix(whoosh(0.4, { from: 420, to: 3600, seed: 53, shape: 0.5 }), 0.03, { gain: 0.6, pan: 0.3 }) },
  reveal: { file: 'reveal', room: 'hall', wetDb: -10, peak: -6, design: () => {
    const st = new Stereo(1.9);
    [[f('D', 5), 0, -0.4], [f('F', 5), 0.06, -0.2], [f('A', 5), 0.12, 0], [f('D', 6), 0.18, 0.2], [f('F', 6), 0.24, 0.4]]
      .forEach(([fr, at, pan]) => st.mix(glass(fr, 0.7), at, { gain: 0.55, pan }));
    st.mix(bell(f('A', 5), 1.5, { tau: 0.7 }), 0.24, { gain: 0.35 });
    st.mix(padStereo(pad(f('D', 3), 0.5, { a: 0.25, r: 0.9, cutoff: 700 })), 0, { gain: 0.55 });
    return st;
  } },
  win: { file: 'win', room: 'hall', wetDb: -9, peak: -3, design: () => {
    const st = new Stereo(3.2);
    // إيقاع دفّ خفيف: دُم تَك دُم تَك-تَك
    [[dum(0.5), 0, 0.8], [tak(0.16), 0.25, 0.45], [dum(0.5), 0.5, 0.7], [tak(0.16, { seed: 39 }), 0.62, 0.35], [tak(0.16), 0.75, 0.45]]
      .forEach(([v, at, g]) => st.mix(v, at, { gain: g }));
    for (let i = 0; i < 6; i++) st.mix(shaker(0.1, { seed: 41 + i, open: i % 2 ? 0.6 : 0.2 }), i * 0.125, { gain: 0.22, pan: 0.45 });
    // لحن كالمبا صاعد ينتهي على ري
    [[f('D', 5), 0, -0.3], [f('F', 5), 0.15, -0.1], [f('G', 5), 0.3, 0.1], [f('A', 5), 0.45, 0.25], [f('D', 6), 0.72, 0.1]]
      .forEach(([fr, at, pan]) => st.mix(kalimba(fr, 1.2), at, { gain: 0.8, pan }));
    // تآلف ختامي: ماريمبا + أجراس + بطانة
    [[f('D', 4), -0.3], [f('F', 4), 0], [f('A', 4), 0.3]].forEach(([fr, pan]) => st.mix(marimba(fr, 1.4, { soft: 0.5 }), 0.72, { gain: 0.55, pan }));
    st.mix(bell(f('D', 6), 2.2), 0.72, { gain: 0.45, pan: 0.15 }).mix(bell(f('A', 5), 2.0), 1.0, { gain: 0.3, pan: -0.2 });
    st.mix(glass(f('D', 7), 0.6), 0.72, { gain: 0.2 });
    st.mix(padStereo(pad(f('D', 3), 1.3, { a: 0.5, r: 1.2, cutoff: 800 })), 0.55, { gain: 0.7 });
    return st;
  } },
  explosion: { file: 'explosion', room: 'hall', wetDb: -12, peak: -2.5, design: () => {
    const st = new Stereo(1.6);
    st.mix(thump(0.9, { f0: 170, f1: 30 }), 0, { gain: 1 });
    const burst = noise(secs(0.9), { seed: 71, color: 'pink' });
    sweep(burst, 'lowpass', (t) => 200 + 6500 * Math.exp(-t / 0.12), 0.8);
    applyEnv(burst, perc(0.002, 0.16));
    st.mix(burst, 0, { gain: 0.9 });
    const crack = applyEnv(filter(noise(secs(0.012), { seed: 73 }), 'highpass', 2500, 0.8), perc(0.0003, 0.003));
    st.mix(crack, 0, { gain: 0.5, pan: -0.1 }).mix(crack, 0.004, { gain: 0.4, pan: 0.2 });
    st.mix(marimba(f('D', 2), 0.9, { soft: 0.9 }), 0.01, { gain: 0.5 });
    // ذيل غبار: ضوضاء منخفضة تتلاشى ببطء
    const dust = applyEnv(filter(noise(secs(1.4), { seed: 77, color: 'pink' }), 'lowpass', 900, 0.7), perc(0.05, 0.35));
    st.mix(dust, 0.05, { gain: 0.35 });
    return st.softClip(1.5);
  } },
  drumroll: { file: 'drumroll', room: 'room', wetDb: -14, peak: -6, design: () => {
    const st = new Stereo(1.7);
    let t = 0, i = 0;
    while (t < 1.2) { const gap = 0.095 - 0.06 * (t / 1.2); st.mix(tak(0.12, { seed: 80 + i, tone: 2000 + 900 * (t / 1.2) }), t, { gain: 0.35 + 0.35 * (t / 1.2), pan: (i % 2 ? 0.25 : -0.25) }); t += gap; i++; }
    for (let k = 0; k < 10; k++) st.mix(shaker(0.1, { seed: 90 + k, open: 0.3 }), k * 0.12, { gain: 0.12 + 0.03 * k, pan: 0.4 });
    return st.mix(dum(0.55), 1.25, { gain: 0.9 }).mix(tak(0.18, { seed: 99 }), 1.25, { gain: 0.5 });
  } },
  pass: { file: 'pass', room: 'room', wetDb: -15, peak: -8, design: () => new Stereo(0.45)
    .mix(kalimba(f('C', 5), 0.32), 0, { gain: 0.75, pan: -0.2 })
    .mix(kalimba(f('E', 5), 0.34), 0.06, { gain: 0.8, pan: 0.2 }) },
};

const ROOMS = { room: { seconds: 0.9, damp: 4200, predelay: 0.008, seed: 11 }, hall: { seconds: 2.1, damp: 3400, predelay: 0.02, seed: 13 } };
const sha = (buf) => createHash('sha256').update(buf).digest('hex');

async function renderCue(id, cue, irs) {
  const dry = cue.design().fade(0.001, 0.015);
  const dryWav = path.join(workDir, `${cue.file}.dry.wav`);
  await writeWav(dryWav, dry.normalize(-6));
  let stage = dryWav;
  if (cue.room) { stage = path.join(workDir, `${cue.file}.rev.wav`); await reverbFile(dryWav, irs[cue.room], stage, { wetDb: cue.wetDb }); }
  const masterWav = path.join(mastersDir, `${cue.file}.wav`);
  const measured = await master(stage, masterWav, { truePeakDb: cue.peak, highpass: 28 });
  // ffmpeg يكتب ترويسات WAV موسّعة؛ يُعاد الماستر بترويسة المحرّك القياسية (44 بايت) كي
  // تكون بيانات PCM هي كل ما بعدها وتتطابق البصمة مع فحص الاختبارات.
  await writeWav(masterWav, decodeWav24(await readFile(masterWav)));
  return { masterWav, measured, seconds: dry.seconds };
}

async function main() {
  const existing = check ? JSON.parse(await readFile(path.join(mastersDir, 'provenance.json'), 'utf8')) : null;
  await mkdir(workDir, { recursive: true }); await mkdir(mastersDir, { recursive: true }); await mkdir(outDir, { recursive: true });
  const irs = {};
  for (const [name, spec] of Object.entries(ROOMS)) { irs[name] = path.join(workDir, `ir-${name}.wav`); if (!check) await writeWav(irs[name], impulseResponse(spec)); }
  const bank = {}, provenance = { generator: 'scripts/audio/build.mjs (deterministic synthesis, ffmpeg-static mastering)', key: 'D', cues: {} };
  for (const [id, cue] of Object.entries(CUES)) {
    if (only && id !== only) continue;
    const m4a = path.join(outDir, `${cue.file}.m4a`);
    let info;
    if (check) {
      info = existing?.cues?.[id];
      if (!info) throw new Error(`provenance lacks ${id}`);
    } else {
      const { masterWav, measured, seconds } = await renderCue(id, cue, irs);
      const encoded = await encodeAac(masterWav, m4a, { bitrate: '160k' });
      // بصمة الماستر على بيانات PCM وحدها (ترويسة WAV التي يكتبها المحرّك 44 بايت دائمًا).
      const pcm = (await readFile(masterWav)).subarray(44);
      info = { file: `audio/${cue.file}.m4a`, seconds: Number(seconds.toFixed(4)), frames: pcm.length / 6, room: cue.room, targetTruePeakDb: cue.peak,
        measured, masterSha256: sha(pcm), encodedSha256: sha(encoded), encodedBytes: encoded.length };
      console.log(`${id.padEnd(10)} ${String(info.seconds).padStart(6)}s  TP ${String(measured.truePeak).padStart(6)} dBTP  RMSpk ${String(measured.rmsPeak?.toFixed(1)).padStart(6)}  ${(encoded.length / 1024).toFixed(1)} KB`);
    }
    const encoded = await readFile(m4a);
    bank[id] = { url: info.file, frames: info.frames, bytes: encoded.length, sha256: sha(encoded), masterSha256: info.masterSha256 };
    provenance.cues[id] = info;
  }
  if (only) { console.log('single cue rebuilt; manifest not rewritten'); return; }
  const text = '// Generated by scripts/audio/build.mjs — Maydan\'s own synthesized cue bank (no third-party samples).\n'
    + '// Masters: assets/audio/maydan-v2/*.wav (48 kHz stereo PCM24); files: public/audio (AAC 160 kb/s).\n'
    + '// sha256 covers the encoded file and masterSha256 the PCM master it was encoded from.\n'
    + `export const SAMPLE_RATE = 48000;\nexport const SAMPLE_BANK = ${JSON.stringify(bank, null, 2)};\n`;
  if (check) {
    if (await readFile(manifestFile, 'utf8') !== text) throw new Error('sample-bank.js differs from public/audio; run node scripts/audio/build.mjs');
    console.log(`Audio bank verified: ${Object.keys(bank).length} cues`);
    return;
  }
  await writeFile(manifestFile, text, 'utf8');
  await writeFile(path.join(mastersDir, 'provenance.json'), `${JSON.stringify(provenance, null, 2)}\n`, 'utf8');
  await rm(workDir, { recursive: true, force: true });
  const total = Object.values(bank).reduce((s, e) => s + e.bytes, 0);
  console.log(`Audio bank: ${Object.keys(bank).length} cues, ${(total / 1024).toFixed(0)} KB of AAC in public/audio`);
}
main().catch((error) => { console.error(error.stack || error.message); process.exit(1); });

// Reproducible listening/measurement export of the runtime playback recipes.
// Does not replace approved masters, change the public sample bank or synthesize
// speech/music. Browser resampling may differ slightly from ffmpeg's resampler.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ffmpeg, measure, encodeAac, decodeWav24 } from './engine.mjs';
import { MAFIA_CUES } from '../../src/games/mafia/audio.js';
import { SAMPLE_BANK } from '../../src/shared/fx/sample-bank.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const output = path.join(root, '.cache/mafia-noir-audio');
const run = promisify(execFile);
const provenance = JSON.parse(await readFile(path.join(root, 'assets/audio/maydan-v3/provenance.json'), 'utf8'));
await mkdir(output, { recursive: true });
const report = { generator: 'scripts/audio/mafia-noir-audition.mjs', note: 'Offline resampling approximation of shared Web Audio gain/rate recipes; no normalization, artificial speech, extra music or copied game sound.', sampleRate: 48000, channels: 2, cues: {} };
for (const [name, cue] of Object.entries(MAFIA_CUES)) {
  const input = path.join(root, 'public', SAMPLE_BANK[cue.sample].url);
  const wav = path.join(output, `${name}.wav`);
  const labels = cue.offsets.map((_, i) => `s${i}`);
  const filters = [`[0:a]asetrate=${48000 * cue.rate},aresample=48000,volume=${cue.gain},asplit=${labels.length}${labels.map(label => `[${label}]`).join('')}`];
  cue.offsets.forEach((offset, i) => filters.push(`[s${i}]adelay=${Math.round(offset * 1000)}:all=1[d${i}]`));
  filters.push(`${labels.map((_, i) => `[d${i}]`).join('')}amix=inputs=${labels.length}:normalize=0:duration=longest[out]`);
  await run(ffmpeg, ['-hide_banner', '-nostdin', '-y', '-loglevel', 'error', '-i', input, '-filter_complex', filters.join(';'), '-map', '[out]', '-c:a', 'pcm_s24le', '-ar', '48000', '-ac', '2', '-map_metadata', '-1', wav]);
  const data = await readFile(wav);
  const m = await measure(wav);
  if (!(m.truePeak < -9 && Number.isFinite(m.samplePeak))) throw new Error(`Unexpected audition level: ${name}`);
  report.cues[name] = { ...cue, sourceFile: SAMPLE_BANK[cue.sample].url, sourceSha256: SAMPLE_BANK[cue.sample].sha256, source: provenance.cues[cue.sample].source, seconds: decodeWav24(data).seconds, measured: m, wavSHA256: createHash('sha256').update(data).digest('hex') };
}
const names = Object.keys(MAFIA_CUES);
const inputs = names.flatMap(name => ['-i', path.join(output, `${name}.wav`)]);
const blocks = names.map((_, i) => `[${i}:a]apad=pad_dur=1.1[a${i}]`);
blocks.push(`${names.map((_, i) => `[a${i}]`).join('')}concat=n=${names.length}:v=0:a=1[out]`);
const wav = path.join(output, 'mafia-noir-audition.wav');
await run(ffmpeg, ['-hide_banner', '-nostdin', '-y', '-loglevel', 'error', ...inputs, '-filter_complex', blocks.join(';'), '-map', '[out]', '-c:a', 'pcm_s24le', '-ar', '48000', '-map_metadata', '-1', wav]);
await encodeAac(wav, path.join(output, 'mafia-noir-audition.m4a'), { bitrate: '192k' });
await writeFile(path.join(output, 'measurements.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ output, cues: Object.fromEntries(Object.entries(report.cues).map(([name, cue]) => [name, { seconds: cue.seconds, truePeakDb: cue.measured.truePeak, rmsDb: cue.measured.rms }])) }, null, 2));

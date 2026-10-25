// Verify the exact selected audition artifacts; no audio generation or network.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const input = JSON.parse(await readFile(path.join(root, 'assets/audio/maydan-v3/selected-audio.json'), 'utf8'));
const text = '// Selected owner audition. Recorded instruments; synthetic spoken responses are private-preview only.\n'
  + `export const SELECTED_AUDIO = ${JSON.stringify(input, null, 2)};\n`;
const output = path.join(root, 'src/shared/fx/selected-audio.js');
if (process.argv.includes('--check')) {
  if ((await readFile(output, 'utf8')).replaceAll('\r\n', '\n') !== text) throw new Error('selected-audio.js differs from reviewed manifest');
} else await writeFile(output, text);
if (input.releaseStatus !== 'private-testflight-audition' || input.voicesProductionApproved !== false) throw new Error('Synthetic voices need separate listening approval before public release');
if (input.music.seconds !== 480 || input.music.chapters.length !== 14 || input.music.streaming !== true) throw new Error('Selected long recording metadata changed');
if (input.voices.length !== 12 || ['correct', 'wrong'].some((event) => input.voices.filter((voice) => voice.event === event).length !== 6)) throw new Error('Expected six responses per event');
for (const entry of [input.music, ...input.voices]) {
  if (!/^audio\/selected\/[a-z0-9-]+\.(m4a|wav)$/.test(entry.url)) throw new Error('Untrusted selected audio path');
  const data = await readFile(path.join(root, 'public', entry.url));
  if (data.length !== entry.bytes || createHash('sha256').update(data).digest('hex') !== entry.sha256) throw new Error(`Selected artifact changed: ${entry.url}`);
  if (!entry.url.includes(entry.sha256.slice(0, 8))) throw new Error('Selected audio name must carry its content hash');
}
for (const library of input.sources.instrument_libraries) await readFile(path.join(root, 'assets/audio/maydan-v3', library.local_license));
console.log('Selected audio verified: one streamed 480s recording, 14 sections, 12 private synthetic responses');

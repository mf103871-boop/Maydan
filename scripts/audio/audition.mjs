// ملف استماع للمالك من الماسترات المعتمدة: كل مؤثر مسبوقًا بعدد نبضات علامة يساوي ترتيبه
// (مع النسخة السابقة قبله عند --ab <git-ref> للمؤثرات المستبدلة)، ثم وصلة كل حلقة موسيقية
// (آخر 8 ثوانٍ فأول 12) والخاتمة. يكتب m4a وفهرسًا نصيًا بالتوقيتات.
//
//   node scripts/audio/audition.mjs --out <file.m4a> [--ab <git-ref>]
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Stereo, decodeWav24, writeWav, encodeAac, tone, applyEnv, perc, secs } from './engine.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const value = (name, fallback = null) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const out = value('--out', path.join(root, '.cache/audio-audition', `maydan-audition-${new Date().toISOString().slice(0, 10)}.m4a`));
const abRef = value('--ab');
const cueProv = JSON.parse(await readFile(path.join(root, 'assets/audio/maydan-v3/provenance.json'), 'utf8'));
const musicProv = JSON.parse(await readFile(path.join(root, 'assets/audio/maydan-v3/music/provenance.json'), 'utf8'));
const ORDER = ['click', 'pop', 'tick', 'tickFast', 'countdown', 'start', 'correct', 'wrong', 'buzzer', 'timeout', 'whoosh', 'reveal', 'win', 'explosion', 'drumroll', 'pass'];

const blip = (hz = 1000, seconds = 0.03, gain = 0.12) => { const n = secs(seconds); const x = tone(n, hz, { type: 'sine' }); applyEnv(x, perc(0.002, seconds / 3)); const st = new Stereo(seconds); st.mix(x, 0, { gain }); return st; };
const segments = [], index = [];
let t = 0;
const push = (st, gapAfter, label = null) => { if (label) index.push({ t: Number(t.toFixed(2)), label }); segments.push({ at: t, st }); t += st.seconds + gapAfter; };
const markers = (k, hz = 1000) => { for (let i = 0; i < k; i++) push(blip(hz), 0.12); t += 0.35; };
async function previous(file) {
  if (!abRef) return null;
  try { return decodeWav24(execFileSync('git', ['show', `${abRef}:${file}`], { cwd: root, maxBuffer: 256 * 1024 * 1024 })); } catch { return null; }
}
t += 0.5;
for (const [i, id] of ORDER.entries()) {
  const info = cueProv.cues[id];
  const current = decodeWav24(await readFile(path.join(root, info.master)));
  markers(i + 1);
  if (info.origin === 'sourced') {
    const old = await previous(info.master);
    if (old) { push(old, 0.7, `${i + 1}. ${id} — previous (in-house)`); push(blip(1800, 0.05), 0.25); push(blip(1800, 0.05), 0.45); }
    push(current, 1.3, `${i + 1}. ${id} — new (${info.source.providerName}: ${info.source.title})`);
  } else push(current, 1.3, `${i + 1}. ${id} — in-house`);
}
t += 0.8;
for (const id of ['home', 'calm', 'tense']) {
  const info = musicProv.tracks[id];
  const st = decodeWav24(await readFile(path.join(root, info.master)));
  markers(3, 600);
  const wrap = new Stereo(20); wrap.mix(st.slice(Math.max(0, st.seconds - 8), st.seconds), 0).mix(st.slice(0, 12), 8);
  wrap.fade(0.3, 0.6);
  push(wrap, 1.6, `music ${id} — last 8 s then first 12 s (the loop point at 8 s)`);
}
markers(4, 600);
push(decodeWav24(await readFile(path.join(root, musicProv.tracks.finale.master))), 1, 'music finale — the match sting');
const total = new Stereo(t + 0.5);
for (const { at, st } of segments) total.mix(st, at);
await mkdir(path.dirname(out), { recursive: true });
const wav = out.replace(/\.m4a$/, '.wav');
await writeWav(wav, total);
const bytes = await encodeAac(wav, out, { bitrate: '192k' });
const txt = index.map((e) => `${String(Math.floor(e.t / 60)).padStart(2, '0')}:${String(Math.floor(e.t % 60)).padStart(2, '0')}  ${e.label}`).join('\n');
await writeFile(out.replace(/\.m4a$/, '.txt'), `${txt}\n`, 'utf8');
console.log(`${path.relative(root, out) || out}: ${(total.seconds).toFixed(1)} s, ${(bytes.length / 1024).toFixed(0)} KB\n${txt}`);

// تحضير ملف مصدر مرخَّص ليدخل سلسلة التصنيع نفسها التي تدخلها التصاميم الداخلية: تحويل إلى
// 48 kHz ستيريو PCM24 (soxr)، إزاحة طبقة اختيارية إلى «ري» (rubberband)، قصّ الصمت الأول، قصّ
// إلى مدة الدور، تلاشي نهاية، مرشّح عالٍ، ثم Stereo يمرّ بـ renderCue (تطبيع، إتقان، AAC).
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { decodeWav24, convertFile, pitchShiftFile, filter, db } from './engine.mjs';
import { trimLeading } from './analysis.mjs';
import { loadRegistry, loadIndex, root } from './sources.mjs';
import { CUE_SPEC, KIND_DEFAULTS } from './roles.mjs';

let registryCache = null, indexCache = null;
export async function resolveSource(id) {
  registryCache = registryCache || await loadRegistry();
  indexCache = indexCache || await loadIndex();
  const candidate = registryCache.candidates.find((c) => c.id === id);
  if (!candidate) throw new Error(`source ${id} is not in sources.json`);
  const provider = registryCache.providers[candidate.provider];
  if (!provider) throw new Error(`source ${id}: unknown provider ${candidate.provider}`);
  if (provider.verified === false) throw new Error(`source ${id}: provider ${candidate.provider} is not verified`);
  const entry = indexCache.files[id];
  if (!entry) throw new Error(`source ${id} is not in the cache; run node scripts/audio/sources.mjs --fetch --only ${id}`);
  return { candidate, provider, entry, file: path.join(root, entry.path), providerKey: candidate.provider };
}

// spec: { id, trim: [from, to], pitchSemitones, highpass, fadeOut, gainDb, trimDb, transients }
export async function prepareSource(spec, { role, workDir, name }) {
  const resolved = await resolveSource(spec.id);
  const kind = CUE_SPEC[role]?.kind || 'feedback';
  const defaults = KIND_DEFAULTS[kind];
  const modifications = [];
  const src = path.join(workDir, `${name}.src.wav`);
  await convertFile(resolved.file, src);
  const p = resolved.entry.probe;
  modifications.push(`converted from ${p.codec || 'unknown'} ${p.sampleRate || '?'} Hz ${p.channels === 1 ? 'mono' : 'stereo'}${p.bitDepth ? ` ${p.bitDepth}-bit` : p.kbps ? ` ${p.kbps} kb/s` : ''} to 48 kHz stereo PCM24 (soxr)`);
  let wav = src;
  if (spec.pitchSemitones) {
    const shifted = path.join(workDir, `${name}.pitch.wav`);
    await pitchShiftFile(src, shifted, spec.pitchSemitones, { transients: spec.transients || 'crisp' });
    wav = shifted;
    modifications.push(`pitch shifted ${spec.pitchSemitones > 0 ? '+' : ''}${spec.pitchSemitones} semitones (rubberband) to sit on D`);
  }
  let st = decodeWav24(await readFile(wav));
  const before = st.seconds;
  st = trimLeading(st, { dB: spec.trimDb ?? -45, preRollMs: 2 });
  if (st.seconds < before - 0.001) modifications.push(`leading silence trimmed (${(before - st.seconds).toFixed(3)} s below ${spec.trimDb ?? -45} dBFS)`);
  const from = spec.trim?.[0] ?? 0;
  const to = Math.min(st.seconds, spec.trim?.[1] ?? from + defaults.max);
  if (from > 0 || to < st.seconds - 0.001) { st = st.slice(from, to); modifications.push(`cut to ${from.toFixed(3)}–${to.toFixed(3)} s`); }
  const fadeOut = Math.min(spec.fadeOut ?? defaults.fadeOut, st.seconds / 2);
  st.fade(0.001, fadeOut);
  modifications.push(`1 ms entry fade, ${Math.round(fadeOut * 1000)} ms release fade`);
  const hp = spec.highpass ?? defaults.highpass;
  if (hp) { filter(st.L, 'highpass', hp, 0.707); filter(st.R, 'highpass', hp, 0.707); modifications.push(`high-pass ${hp} Hz`); }
  if (spec.gainDb) { st.scale(db(spec.gainDb)); modifications.push(`gain ${spec.gainDb} dB`); }
  return { st, ...resolved, modifications };
}

// كتلة المصدر في provenance: كل ما يلزم لإعادة الجلب والتحقق والاعتماد (credits).
export function sourceProvenance({ candidate, provider, providerKey, entry, modifications }, extra = {}) {
  const origin = candidate.path
    ? { archiveUrl: provider.archive.url, archiveSha256: provider.archive.sha256, path: candidate.path }
    : { url: candidate.url };
  return {
    id: candidate.id, provider: providerKey, providerName: provider.name, title: candidate.title, author: candidate.author,
    sourcePage: candidate.sourcePage || provider.sourcePage || provider.url, ...origin,
    originalSha256: entry.sha256, originalBytes: entry.bytes, originalFormat: entry.probe, retrieved: candidate.retrieved,
    license: provider.license, licenseUrl: provider.licenseUrl, licenseFile: provider.licenseFile, attribution: !!provider.attribution,
    ...(provider.attribution ? { creditLine: (provider.creditLine || '{title} — {author}').replace('{title}', candidate.title).replace('{author}', candidate.author) } : {}),
    modifications, ...extra,
  };
}

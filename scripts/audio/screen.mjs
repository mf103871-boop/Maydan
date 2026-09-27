// فرز موضوعي للمرشّحين (بلا استماع): يحوّل كل ملف إلى 48 kHz ستيريو، يقيسه (analysis.mjs +
// ebur128 للموسيقى)، يمنحه درجة من 100 لكل دور مرشَّح له، ويقارن أفضل مرشّح بالماستر الداخلي
// الحالي (الأساس). القرار: مصدر خارجي إذا كانت درجته ≥ 70 وتفوق الأساس بخمس نقاط على الأقل.
//
//   node scripts/audio/screen.mjs            يكتب assets/audio/maydan-v3/screening.json
//   node scripts/audio/screen.mjs --only <candidate id|provider|role>
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeWav24, convertFile, measure } from './engine.mjs';
import { mono, averageSpectrum, spectralCentroid, spectralFlatness, bandFraction, leadingSilence, trailingTail, attackTime, noiseFloor, endLevel, crestFactor, dcOffset, clippingRuns, monoCompat, estimatePitch, keyEstimate, semitonesToD, semitonesToDCue, seamMetrics, seamlessLoop, trimLeading } from './analysis.mjs';
import { loadRegistry, loadIndex, root, assetsDir } from './sources.mjs';
import { CUE_SPEC, PROVIDER_FIT, SLOT, PALETTE, KIND_DEFAULTS } from './roles.mjs';

const workDir = path.join(root, '.cache/audio-screen');
const args = process.argv.slice(2);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
const CUE_ROLES = ['click', 'pop', 'tick', 'tickFast', 'countdown', 'start', 'correct', 'wrong', 'buzzer', 'timeout', 'whoosh', 'reveal', 'win', 'explosion', 'drumroll', 'pass'];
const MUSIC_ROLES = ['home', 'calm', 'tense', 'finale'];
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const between = (v, lo, hi, soft = 0.5) => (v >= lo && v <= hi ? 1 : v < lo ? clamp01(1 - (lo - v) / (lo * soft || 1)) : clamp01(1 - (v - hi) / (hi * soft || 1)));

export function cueMetrics(st) {
  const trimmed = trimLeading(st);
  const x = mono(trimmed), raw = mono(st);
  const tail = trailingTail(x, -60);
  const effective = Math.max(0, trimmed.seconds - tail);
  const spec = averageSpectrum(x.subarray(0, Math.min(x.length, Math.round(effective * 48000) || x.length)));
  const pitch = estimatePitch(x);
  const half = Math.floor(x.length / 2);
  const a = estimatePitch(x.subarray(0, half)), b = estimatePitch(x.subarray(half));
  const contour = a.midi !== null && b.midi !== null && a.confidence >= 0.25 && b.confidence >= 0.25 ? b.midi - a.midi : null;
  const key = effective >= 0.12 ? keyEstimate(x) : null;
  let peakAt = 0, peakV = 0;
  for (let i = 0; i < x.length; i++) { const v = Math.abs(x[i]); if (v > peakV) { peakV = v; peakAt = i; } }
  return {
    seconds: Number(st.seconds.toFixed(3)), leadingSilence: Number(leadingSilence(raw).toFixed(4)), effective: Number(effective.toFixed(3)), tail: Number(tail.toFixed(3)), peakAt: Number((peakAt / 48000).toFixed(3)),
    attackMs: attackTime(x), endLevelDb: endLevel(x), noiseFloorDb: noiseFloor(raw), crestDb: Number(crestFactor(x).toFixed(1)), dc: Number(dcOffset(x).toFixed(4)), clipping: clippingRuns(x),
    centroidHz: Math.round(spectralCentroid(spec.mags, spec.size)), flatness: Number(spectralFlatness(spec.mags).toFixed(4)),
    lfShare: Number(bandFraction(spec.mags, spec.size, 0, 120).toFixed(3)), presenceShare: Number(bandFraction(spec.mags, spec.size, 300, 6000).toFixed(3)), airShare: Number(bandFraction(spec.mags, spec.size, 6000, 24000).toFixed(3)),
    mono: monoCompat(trimmed), pitch, contour, key: key ? { name: key.name, mode: key.mode, score: key.score, toD: semitonesToDCue(key.key, key.mode) } : null,
  };
}

export function scoreCue(m, role, source) {
  const spec = CUE_SPEC[role];
  const fails = [], parts = {};
  const lossy = source.lossy, kbps = source.kbps || 0;
  if (m.clipping > 0) fails.push('clipping');
  if (Math.abs(m.dc) > 0.01) fails.push('dc offset');
  if (m.effective < spec.dur[0] * 0.8) fails.push(`too short (${m.effective}s)`);
  if (m.effective > spec.dur[1] * 3) fails.push(`far too long (${m.effective}s)`);
  if (m.noiseFloorDb !== null && m.noiseFloorDb > -45) fails.push(`noisy (${m.noiseFloorDb} dBFS before onset)`);
  if (m.mono.sumLossDb < -3) fails.push('poor mono compatibility');
  if (lossy && (spec.kind === 'hero' || spec.kind === 'noise')) fails.push('lossy source for a hero cue');
  if (lossy && kbps && kbps < 128) fails.push('lossy < 128 kb/s');
  // fidelity 20
  parts.fidelity = !lossy ? (source.bitDepth >= 24 ? 1 : 0.8) : kbps >= 256 ? 0.5 : 0.3;
  // envelope 20: attack, duration, abrupt end, lead silence in the original
  const attack = spec.attack >= 250 ? 1 : clamp01(1 - Math.max(0, m.attackMs - spec.attack) / (spec.attack * 2 || 1));
  const dur = m.effective <= spec.dur[1] ? (m.effective >= spec.dur[0] ? 1 : 0.6) : clamp01(1 - (m.effective - spec.dur[1]) / spec.dur[1]);
  const ending = m.endLevelDb > -30 && m.effective <= spec.dur[1] ? 0.4 : 1;
  const lead = m.leadingSilence > 0.5 ? 0.7 : 1;
  parts.envelope = 0.4 * attack + 0.4 * dur + 0.1 * ending + 0.1 * lead;
  // phone spectrum 15
  const centroid = between(m.centroidHz, spec.centroid[0], spec.centroid[1], 0.6);
  const lf = m.lfShare <= spec.lf ? 1 : clamp01(1 - (m.lfShare - spec.lf) / spec.lf);
  const presence = clamp01(m.presenceShare / 0.6);
  parts.spectrum = 0.4 * centroid + 0.3 * lf + 0.3 * presence;
  // tonal fit 20
  let tonal;
  if (spec.pitched === 'no') tonal = spec.kind === 'tick' ? clamp01((m.crestDb - 6) / 8) : clamp01(m.flatness / 0.02);
  else {
    const pitched = m.pitch.confidence >= 0.3 || (m.key && m.key.score >= 0.6);
    const toD = m.key ? Math.abs(m.key.toD) : 6;
    const keyFit = m.key ? (toD === 0 ? 1 : toD <= 1 ? 0.85 : toD <= 2 ? 0.7 : toD <= 3 ? 0.55 : 0.3) : 0.4;
    let contour = 0.7;
    if (spec.contour === 'rising') contour = m.contour === null ? 0.6 : m.contour >= 1 ? 1 : m.contour <= -1 ? 0.2 : 0.6;
    if (spec.contour === 'falling') contour = m.contour === null ? (m.pitch.hz && m.pitch.hz <= 400 ? 0.9 : 0.6) : m.contour <= -1 ? 1 : m.contour >= 1 ? 0.2 : 0.6;
    tonal = spec.pitched === 'yes' ? (pitched ? 0.6 * keyFit + 0.4 * contour : 0.35) : (pitched ? 0.6 * keyFit + 0.4 * contour : 0.7);
  }
  // طابع خاص: الصافرة صوت ممتدّ (قمة/متوسط منخفض) لا نقرة؛ الخطأ قصير.
  if (role === 'buzzer') tonal *= (m.crestDb <= 13 && m.effective >= 0.3) ? 1 : 0.5;
  if (role === 'wrong' && m.effective > 0.9) tonal *= 0.8;
  parts.tonal = tonal;
  // cleanliness 15
  const floor = m.noiseFloorDb === null ? 0.8 : clamp01((-45 - m.noiseFloorDb) / 15);
  const crest = clamp01((m.crestDb - 4) / 6);
  const monoOk = clamp01((m.mono.sumLossDb + 3) / 2);
  parts.clean = 0.4 * floor + 0.3 * crest + 0.3 * monoOk;
  // descriptive fit 10
  const provider = PROVIDER_FIT[source.provider] ?? 0.6;
  const title = source.title ? (spec.title.test(source.title) ? 1 : /^DM-CGS/.test(source.title) ? 0.75 : 0.5) : 0.75;
  parts.fit = 0.5 * provider + 0.5 * title;
  const total = fails.length ? 0 : Math.round(20 * parts.fidelity + 20 * parts.envelope + 15 * parts.spectrum + 20 * parts.tonal + 15 * parts.clean + 10 * parts.fit);
  return { total, parts: Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, Number(v.toFixed(2))])), fails };
}

// ── الموسيقى ──────────────────────────────────────────────────────────────────────────
export async function musicMetrics(wav, st, candidate, role, { authored = false } = {}) {
  const x = mono(st);
  const measured = await measure(wav);
  const spec = averageSpectrum(x, { size: 8192, hop: 8192, maxFrames: 400 });
  const key = keyEstimate(x);
  let seam = null, loop = null;
  if (role !== 'finale') {
    const bpm = candidate.bpm || null;
    if (authored) { seam = seamMetrics(st); loop = { authored: true, seconds: Number(st.seconds.toFixed(3)) }; }
    else if (bpm) {
      // حلقة تجريبية بطول بارات كاملة (≤ 64 ث) مع تلاشٍ متبادل نبضة واحدة، كما سيُصنَع المقطع فعلًا.
      const bar = 4 * 60 / bpm;
      const bars = Math.max(4, Math.min(32, Math.floor((Math.min(st.seconds - 1, 64)) / bar / 4) * 4));
      const L = bars * bar, xf = 60 / bpm;
      if (L + xf < st.seconds) { loop = { offset: 0, bars, seconds: Number(L.toFixed(3)), crossfadeBeats: 1 }; seam = seamMetrics(seamlessLoop(st, 0, L, xf)); }
    }
    if (!seam) seam = seamMetrics(st);
  }
  // المقاطع الداخلية مؤلَّفة على ري بالبناء؛ مقدّر المفتاح لا يعرف مقام الحجاز.
  const toD = authored ? 0 : semitonesToD(key.key, key.mode);
  return { seconds: Number(st.seconds.toFixed(2)), lufs: measured.lufs, lra: measured.lra, truePeak: measured.truePeak, centroidHz: Math.round(spectralCentroid(spec.mags, spec.size)), lfShare: Number(bandFraction(spec.mags, spec.size, 0, 120).toFixed(3)), mono: monoCompat(st), key: { name: key.name, mode: key.mode, score: authored ? 1 : key.score, toD }, endLevelDb: endLevel(x), seam, loop };
}
export function scoreMusic(m, role, candidate, source) {
  const slot = SLOT[role], fails = [], parts = {};
  const lossy = source.lossy, kbps = source.kbps || 0;
  if (lossy && kbps && kbps < 192) fails.push('lossy < 192 kb/s');
  if (Math.abs(m.key.toD) > 2 && m.key.score >= 0.5) fails.push(`key too far from D (${m.key.name} ${m.key.mode})`);
  if (role !== 'finale' && m.seam && (m.seam.discontinuity > 3 || m.seam.hfClickDb > 6)) fails.push('seam would click');
  if (role === 'finale' && (m.seconds < 2.5 || m.seconds > 12)) fails.push(`sting length ${m.seconds}s`);
  if (role !== 'finale' && m.seconds < 20) fails.push('too short to loop');
  parts.fidelity = !lossy ? 1 : kbps >= 320 ? 0.5 : 0.35;
  parts.seam = role === 'finale' ? (m.endLevelDb < -40 ? 1 : 0.5) : m.seam ? clamp01(1 - Math.max(0, m.seam.discontinuity - 1) / 2) * 0.6 + clamp01(1 - Math.max(0, m.seam.hfClickDb) / 6) * 0.4 : 0.5;
  parts.dynamics = role === 'finale' ? 1 : 0.6 * between(m.lra, 3, 9, 0.8) + 0.4 * (m.lufs !== null && Number.isFinite(m.lufs) ? 1 : 0);
  parts.spectrum = 0.4 * between(m.centroidHz, 700, 2600, 0.7) + 0.3 * (m.lfShare <= 0.35 ? 1 : clamp01(1 - (m.lfShare - 0.35) / 0.35)) + 0.3 * between(m.mono.correlation, 0.25, 0.95, 1);
  const toD = Math.abs(m.key.toD);
  parts.key = m.key.score < 0.45 ? 0.5 : toD === 0 ? 1 : toD === 1 ? 0.8 : toD === 2 ? 0.6 : 0.2;
  const bpm = candidate.bpm || null;
  const tempo = bpm ? between(bpm, slot.bpm[0], slot.bpm[1], 0.3) : 0.5;
  const text = `${candidate.feel || ''} ${candidate.instruments || ''} ${candidate.title || ''}`;
  const feel = slot.avoid.test(text) ? 0.2 : slot.feel.test(text) ? 1 : 0.6;
  const palette = PALETTE.test(candidate.instruments || '') ? 1 : 0.6;
  parts.palette = 0.4 * tempo + 0.35 * feel + 0.25 * palette;
  const total = fails.length ? 0 : Math.round(10 * parts.fidelity + 20 * parts.seam + 15 * parts.dynamics + 15 * parts.spectrum + 20 * parts.key + 20 * parts.palette);
  return { total, parts: Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, Number(v.toFixed(2))])), fails };
}

async function exists(file) { try { await stat(file); return true; } catch { return false; } }
async function converted(id, input) {
  const out = path.join(workDir, `${id.replace(/[^a-z0-9]+/gi, '_')}.wav`);
  if (!(await exists(out))) await convertFile(input, out);
  return out;
}

async function main() {
  await mkdir(workDir, { recursive: true });
  const reg = await loadRegistry(), index = await loadIndex();
  const out = { generated: new Date().toISOString().slice(0, 10), rubric: 'scripts/audio/screen.mjs: sourced when best ≥ 70 and ≥ baseline + 5', candidates: {}, baseline: {}, selection: {} };
  // الأساس: الماسترات الداخلية الحالية.
  const cueProv = JSON.parse(await readFile(path.join(assetsDir, 'provenance.json'), 'utf8'));
  for (const role of CUE_ROLES) {
    if (only && !only.includes(role) && !CUE_ROLES.includes(only) ? false : (only && CUE_ROLES.includes(only) && only !== role)) continue;
    const info = cueProv.cues[role];
    const st = decodeWav24(await readFile(path.join(root, info.master)));
    const m = cueMetrics(st);
    out.baseline[role] = { metrics: m, score: scoreCue(m, role, { lossy: false, bitDepth: 24, provider: 'in-house', title: null }) };
  }
  const musicProv = JSON.parse(await readFile(path.join(assetsDir, 'music/provenance.json'), 'utf8'));
  for (const role of MUSIC_ROLES) {
    if (only && MUSIC_ROLES.includes(only) && only !== role) continue;
    const info = musicProv.tracks[role];
    const wav = path.join(root, info.master);
    const st = decodeWav24(await readFile(wav));
    const described = { bpm: info.bpm, title: `${role} (in-house)`, feel: role === 'tense' ? 'driving mysterious' : role === 'finale' ? 'bright uplifting' : 'calm relaxed', instruments: 'oud kalimba percussion pad ney bells' };
    const m = await musicMetrics(wav, st, described, role, { authored: true });
    out.baseline[role] = { metrics: m, score: scoreMusic(m, role, described, { lossy: false }) };
  }
  let done = 0;
  for (const c of reg.candidates) {
    if (c.unavailable || !index.files[c.id]) continue;
    if (only && c.id !== only && c.provider !== only && !c.roles.includes(only)) continue;
    const provider = reg.providers[c.provider];
    if (provider.verified === false) continue;
    const entry = index.files[c.id];
    const source = { ...entry.probe, provider: c.provider, title: c.title };
    const wav = await converted(c.id, path.join(root, entry.path));
    let st;
    try { st = decodeWav24(await readFile(wav)); } catch (error) { out.candidates[c.id] = { error: error.message }; continue; }
    const result = { provider: c.provider, title: c.title, format: entry.probe, scores: {} };
    const cueRoles = c.roles.filter((r) => CUE_ROLES.includes(r)), musicRoles = c.roles.filter((r) => MUSIC_ROLES.includes(r));
    if (cueRoles.length && st.seconds <= 12) { result.metrics = cueMetrics(st); for (const role of cueRoles) result.scores[role] = scoreCue(result.metrics, role, source); }
    for (const role of musicRoles) { const m = await musicMetrics(wav, st, c, role); result.musicMetrics = result.musicMetrics || {}; result.musicMetrics[role] = m; result.scores[role] = scoreMusic(m, role, c, source); }
    out.candidates[c.id] = result;
    if (++done % 50 === 0) console.log(`… ${done} candidates screened`);
  }
  // إسناد حصري: ملف واحد لدور واحد؛ الأدوار ذات الفارق الأكبر عن الأساس تختار أولًا، ومكافأة
  // تماسك (+3) لمرشّحي المزوّد الأكثر اختيارًا كي تبقى اللوحة من عائلة واحدة قدر الإمكان.
  const ranking = {};
  for (const role of [...CUE_ROLES, ...MUSIC_ROLES]) {
    if (!out.baseline[role]) continue;
    ranking[role] = Object.entries(out.candidates).filter(([, r]) => r.scores?.[role]).map(([id, r]) => ({ id, total: r.scores[role].total, fails: r.scores[role].fails, provider: r.provider })).sort((a, b) => b.total - a.total);
  }
  const used = new Set(), providerCount = {};
  const order = Object.keys(ranking).sort((a, b) => ((ranking[b][0]?.total || 0) - out.baseline[b].score.total) - ((ranking[a][0]?.total || 0) - out.baseline[a].score.total));
  for (const role of order) {
    const baseline = out.baseline[role].score.total;
    const dominant = Object.entries(providerCount).sort((a, b) => b[1] - a[1])[0]?.[0];
    // عنوان يصف الدور يقين لا تعطيه القياسات (+3)، وتماسك المزوّد الغالب (+3).
    const titled = (r) => CUE_ROLES.includes(role) && out.candidates[r.id]?.title && CUE_SPEC[role].title.test(out.candidates[r.id].title) && !/^DM-CGS/.test(out.candidates[r.id].title);
    const pick = ranking[role].map((r) => ({ ...r, adjusted: r.total + (dominant && r.provider === dominant ? 3 : 0) + (titled(r) ? 3 : 0) })).sort((a, b) => b.adjusted - a.adjusted).find((r) => r.total > 0 && !used.has(r.id)) || null;
    const decision = pick && pick.total >= 70 && pick.total >= baseline + 5 ? 'sourced' : 'kept-in-house';
    let spec = null;
    if (decision === 'sourced') {
      used.add(pick.id); providerCount[pick.provider] = (providerCount[pick.provider] || 0) + 1;
      const c = out.candidates[pick.id];
      if (CUE_ROLES.includes(role)) {
        // إزاحة الطبقة إلى ري فقط لمؤثر نغمي واضح المفتاح؛ لا إزاحة للضوضاء والتكّات والهبّات.
        const m = c.metrics, kind = CUE_SPEC[role].kind;
        const tonalKind = !['noise', 'whoosh', 'tick'].includes(kind);
        const pitched = tonalKind && m.pitch.confidence >= 0.3 && m.key && m.key.score >= 0.5;
        const toD = m.key ? m.key.toD : 0;
        spec = { id: pick.id, pitchSemitones: pitched && Math.abs(toD) <= 3 && toD !== 0 ? toD : 0 };
        // انفجار أو ضربة تبدأ بهبّة قبل الطرقة: يبدأ المقطع 15 ms قبل الذروة كي يقع الصوت على الحدث.
        if ((kind === 'noise') && m.attackMs > 60 && m.peakAt > 0.06) spec.trim = [Number(Math.max(0, m.peakAt - 0.015).toFixed(3)), Number(Math.min(m.effective + m.tail, m.peakAt + CUE_SPEC[role].dur[1]).toFixed(3))];
      } else {
        const m = c.musicMetrics[role];
        spec = role === 'finale' ? { id: pick.id } : { id: pick.id, offset: 0, bars: m.loop?.bars || 16, crossfadeBeats: m.loop?.crossfadeBeats ?? 1, pitchSemitones: Math.abs(m.key.toD) <= 2 ? m.key.toD : 0 };
      }
    }
    out.selection[role] = { baseline, best: pick?.id || null, bestScore: pick?.total ?? null, top: ranking[role].slice(0, 5).map(({ id, total, fails }) => ({ id, total, fails })), decision, spec };
  }
  await writeFile(path.join(assetsDir, 'screening.json'), `${JSON.stringify(out, null, 1)}\n`, 'utf8');
  console.log('role        baseline  best  decision   candidate');
  for (const [role, s] of Object.entries(out.selection)) console.log(`${role.padEnd(11)} ${String(s.baseline).padStart(8)} ${String(s.bestScore ?? '-').padStart(5)}  ${s.decision.padEnd(14)} ${s.best || ''}  ${s.top.slice(1, 3).map((t) => `${t.id}:${t.total}`).join(' ')}`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error) => { console.error(error.stack || error.message); process.exit(1); });

// يبني حزمة وسائط كاملة من ملف مواصفات: يحلّ كل موضوع إلى ملف كومنز، ينزّله ويعالجه،
// يحسب معاملات المؤثّر من الصورة نفسها، ثم يكتب ملف الفئة وسجل المصادر.
//
//   node scripts/media/build-pack.mjs scripts/media/specs/zoom.json [--limit 20] [--only 200] [--dry]
//
// كل خطوة تُفحص: موضوع بلا صورة، أو صورة لا تحتمل المؤثّر (ظلّ بلا شفافية، قصّة بلا
// تفاصيل) تُرفض ويُسجَّل سببها في تقرير الحزمة بدل أن تدخل البنك سؤالًا بلا حل.
import { access, readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { acquire, fetchCommonsFile, loadSharp, readSourceIndex, resolveFfmpeg, saveSourceRecord } from '../media-fetch.mjs';
import { resolveSubjects } from './resolve.mjs';
import { bestZoomOrigin, silhouetteCheck, blurCheck } from './analyze.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const TIERS = [200, 400, 600, 800, 1000];
const BUDGET = { image: 30 * 1024, audio: 50 * 1024 };
const CONCURRENCY = 4;

const pad = (n) => String(n).padStart(3, '0');
const readable = (file) => access(file).then(() => true, () => false);

async function pool(items, size, worker) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      try { results[index] = { ok: true, value: await worker(items[index], index) }; }
      catch (error) { results[index] = { ok: false, error }; }
    }
  }));
  return results;
}

// معاملات المؤثّر تُحسب من الصورة بعد تنزيلها، لا تُخمَّن.
async function effectParams(spec, subject, file) {
  const effect = subject.effect || spec.effect || 'none';
  if (effect === 'zoom') {
    const { origin, detail, ratio } = await bestZoomOrigin(file);
    if (detail < 12) throw new Error(`القصّة بلا تفاصيل (${detail}) — الصورة رتيبة`);
    return { fields: { effect, origin }, note: `تفصيل ${detail} · ضعف المتوسط ${ratio}` };
  }
  if (effect === 'silhouette') {
    const check = await silhouetteCheck(file);
    if (!check.ok) throw new Error(check.reason);
    return { fields: { effect }, note: `تغطية ${(check.coverage * 100).toFixed(0)}%` };
  }
  if (effect === 'blur') {
    const check = await blurCheck(file);
    if (!check.ok) throw new Error(check.reason);
    return { fields: { effect }, note: `تباين ${check.spread}` };
  }
  return { fields: effect === 'none' ? {} : { effect }, note: '' };
}

export async function buildPack(specPath, { limit = Infinity, only = null, dry = false } = {}) {
  const spec = JSON.parse(await readFile(specPath, 'utf8'));
  const kind = spec.kind || 'image';
  const dir = path.join(ROOT, 'media', spec.id);
  const sharp = kind === 'image' ? await loadSharp() : null;
  const ffmpeg = kind === 'audio' ? await resolveFfmpeg() : null;

  const existing = new Map();
  try {
    for (const record of await readSourceIndex(dir).then((r) => r.list)) existing.set(record.file, record);
  } catch { /* لا سجل بعد */ }

  let subjects = spec.subjects.filter((s) => (only ? s.tier === Number(only) : true)).slice(0, limit);
  process.stderr.write(`▶ ${spec.id}: ${subjects.length} موضوعًا\n`);

  // ترتيب السؤال داخل خانته يُشتق من موضعه في المواصفات، لا من عدّاد يتقدّم مع النجاح،
  // كي يعطي البناءُ المعرّفَ نفسه لكل موضوع في كل مرة فيصير الاستئناف ممكنًا.
  const seats = {};
  const seated = subjects.map((s) => {
    const tier = s.tier;
    seats[tier] = (seats[tier] || 0) + 1;
    return { ...s, ar: s.ar || s.a, seat: seats[tier] };
  });
  const resolved = await resolveSubjects(seated);
  const questions = [];
  const failures = [];

  const results = await pool(resolved, CONCURRENCY, async (subject) => {
    if (!subject.file) throw new Error('لم يُعثر على صورة لهذا الموضوع');
    const candidate = await fetchCommonsFile(subject.file, kind);
    if (candidate.reject) throw new Error(candidate.reject);
    const qid = `${spec.id}-${subject.tier}-${pad(subject.seat)}`;
    const src = `${qid}.${kind === 'audio' ? 'mp3' : 'webp'}`;
    const outPath = path.join(dir, src);
    if (dry) return { subject, qid, src, candidate, result: null, params: { fields: {}, note: 'تجريبي' } };
    await mkdir(dir, { recursive: true });
    // استئناف: ملف نُزّل في محاولة سابقة لهذا الموضوع نفسه يُعاد استعماله. الشبكة هنا
    // مقيّدة المعدل بشدة، فإعادة تنزيل ما نجح تضيّع ساعات بلا فائدة.
    const done = existing.get(src);
    let result;
    if (done && done.sourceUrl === candidate.sourceUrl && await readable(outPath)) {
      result = { bytes: done.bytes, width: done.width, height: done.height, durationSec: done.durationSec };
    } else {
      result = await acquire(candidate, { kind, ffmpeg, sharp, maxBytes: BUDGET[kind], outPath });
    }
    const params = await effectParams(spec, subject, outPath);
    return { subject, qid, src, candidate, result, params };
  });

  for (const [i, entry] of results.entries()) {
    const subject = resolved[i];
    if (!entry?.ok) { failures.push({ a: subject.a, tier: subject.tier, reason: entry?.error?.message || 'خطأ مجهول' }); continue; }
    const { qid, src, candidate, result, params } = entry.value;
    questions.push({
      p: subject.tier, q: subject.q, a: subject.a, qid, type: kind,
      ...params.fields,
      ...(subject.alt?.length ? { alt: subject.alt } : {}),
      topic: subject.topic, verified: true,
      media: {
        src, type: kind, title: candidate.title, sourceUrl: candidate.sourceUrl,
        author: candidate.author, license: candidate.license, licenseUrl: candidate.licenseUrl,
      },
    });
    if (!dry) {
      await saveSourceRecord(dir, {
        file: src, kind, provider: candidate.provider, query: subject.ar || subject.a, title: candidate.title,
        sourceUrl: candidate.sourceUrl, originalUrl: candidate.originalUrl, author: candidate.author,
        license: candidate.license, licenseUrl: candidate.licenseUrl, bytes: result.bytes,
        width: result.width, height: result.height, durationSec: result.durationSec,
        via: subject.via, note: params.note, fetchedAt: new Date().toISOString(),
      });
    }
  }

  questions.sort((a, b) => a.p - b.p || a.qid.localeCompare(b.qid));
  const out = { id: spec.id, name: spec.name, icon: spec.icon, ...(spec.defaultType ? { defaultType: spec.defaultType } : {}), qs: questions };
  const built = Object.fromEntries(TIERS.map((t) => [t, questions.filter((q) => q.p === t).length]));
  return { spec, out, failures, built };
}

if (process.argv[1]?.endsWith('build-pack.mjs')) {
  const [specPath, ...rest] = process.argv.slice(2);
  const flag = (name) => { const i = rest.indexOf(`--${name}`); return i === -1 ? null : rest[i + 1]; };
  const dry = rest.includes('--dry');
  const { spec, out, failures, built } = await buildPack(specPath, {
    limit: Number(flag('limit')) || Infinity, only: flag('only'), dry,
  });
  if (!dry) {
    const target = path.join(ROOT, 'src/data/categories', `${spec.id}.json`);
    await writeFile(target, `${JSON.stringify(out, null, 2)}\n`, 'utf8');
  }
  process.stderr.write(`✓ ${spec.id}: ${out.qs.length} سؤالًا ${JSON.stringify(built)}\n`);
  if (failures.length) {
    process.stderr.write(`✗ ${failures.length} تعذّرت:\n`);
    for (const f of failures) process.stderr.write(`   ${f.tier} · ${f.a} — ${f.reason}\n`);
  }
}

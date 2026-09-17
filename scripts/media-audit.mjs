// Read-only quality audit. Passing schema checks does not establish visual accuracy.
// node scripts/media-audit.mjs > media-audit.json
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import sharp from 'sharp';

export async function auditMedia(root) {
  const report = { packs: [], issues: [], sharedAssets: [], notes: [
    'Subject/answer matching requires human review. Dimensions and license labels alone cannot prove it.',
    'License metadata must be checked against the original file page before publication.',
  ] };
  const hashes = new Map();
  for (const filename of (await readdir(path.join(root, 'src/data/categories'))).filter(f => f.endsWith('.json')).sort()) {
    const cat = JSON.parse(await readFile(path.join(root, 'src/data/categories', filename), 'utf8'));
    const pack = { id: cat.id, questions: cat.qs.length, files: 0, bytes: 0, lowResolution: 0, missingAuthor: 0, smallestLongSide: null };
    for (const q of cat.qs) for (const media of [q.media || []].flat()) {
      if (!media.src || /^(https?:|data:|\/\/)/.test(media.src)) continue;
      const file = path.join(root, 'media', media.src.startsWith('media/') ? media.src.slice(6) : `${cat.id}/${media.src}`);
      let buffer;
      try { buffer = await readFile(file); } catch { report.issues.push({ qid: q.qid, issue: 'missing-file', src: media.src }); continue; }
      pack.files++; pack.bytes += buffer.length;
      const hash = createHash('sha256').update(buffer).digest('hex');
      if (!hashes.has(hash)) hashes.set(hash, []);
      hashes.get(hash).push({ qid: q.qid, answer: q.a, src: media.src });
      if (!media.author || /غير معروف|unknown|^anonymous$/i.test(media.author)) {
        pack.missingAuthor++;
        report.issues.push({ qid: q.qid, issue: 'attribution-needs-review', severity: /^CC BY/i.test(media.license || '') ? 'warning' : 'info', sourceUrl: media.sourceUrl, license: media.license });
      }
      if (!/\.(webp|png|jpe?g|avif)$/i.test(file)) continue;
      let info;
      try { info = await sharp(buffer).metadata(); } catch { report.issues.push({ qid: q.qid, issue: 'invalid-image' }); continue; }
      const longSide = Math.max(info.width, info.height);
      pack.smallestLongSide = pack.smallestLongSide === null ? longSide : Math.min(pack.smallestLongSide, longSide);
      if (longSide < 480) {
        pack.lowResolution++;
        report.issues.push({ qid: q.qid, issue: 'low-resolution', width: info.width, height: info.height, sourceUrl: media.sourceUrl });
      }
      if (q.effect === 'silhouette') {
        const transparent = info.hasAlpha && (await sharp(buffer).stats()).channels[3]?.min < 128;
        if (!transparent) report.issues.push({ qid: q.qid, issue: 'opaque-silhouette-black-rectangle' });
      }
    }
    if (pack.files) report.packs.push(pack);
  }
  report.sharedAssets = [...hashes.values()].filter(group => group.length > 1);
  report.totalBytes = report.packs.reduce((sum, pack) => sum + pack.bytes, 0);
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await auditMedia(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')), null, 2));
}

// Install a reviewed generation output without relying on a previous machine's paths.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [jobPath, sourcePath, option] = process.argv.slice(2);
if (!jobPath || !sourcePath || (option && option !== '--replace')) {
  throw new Error('Usage: node scripts/bank-install-generated.mjs JOB.json OUTPUT.png [--replace]');
}
const job = JSON.parse(await fs.readFile(jobPath, 'utf8'));
if (!/^[a-z][a-z0-9-]*$/.test(job.id) || !['cover', 'question'].includes(job.kind)
    || !/^[a-z][a-z0-9]*$/.test(job.pack || job.id) || !job.prompt?.trim()) throw new Error('Invalid generation job');
const folder = job.kind === 'cover' ? 'public/media/badeeha-covers' : `media/${job.pack}`;
const relative = `${folder}/${job.id}.webp`;
const output = path.join(root, relative);
try {
  await fs.access(output);
  if (option !== '--replace') throw new Error(`Asset already exists: ${relative}`);
} catch (error) { if (error.code !== 'ENOENT') throw error; }
await fs.mkdir(path.dirname(output), { recursive: true });
const maxWidth = job.kind === 'cover' ? 640 : 1280;
const maxHeight = job.kind === 'cover' ? 480 : 1280;
let bytes;
for (const quality of [90, 84, 78, 70]) {
  bytes = await sharp(sourcePath).rotate().resize(maxWidth, maxHeight, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality, effort: 6 }).toBuffer();
  if (bytes.length <= 256 * 1024) break;
}
if (bytes.length > 256 * 1024) throw new Error('Generated asset exceeds image budget');
const meta = await sharp(bytes).metadata();
if (job.requireAlpha && !meta.hasAlpha) throw new Error('Silhouette image needs a genuine alpha channel');
await fs.writeFile(output, bytes);
const record = {
  id: job.id, kind: job.kind, pack: job.pack || job.id, file: relative, asset: relative,
  prompt: job.prompt, tool: 'OpenAI image generation (built-in)', createdAt: new Date().toISOString().slice(0, 10),
  width: meta.width, height: meta.height, bytes: bytes.length,
  sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  disclosure: 'صورة توضيحية مولّدة بالذكاء الاصطناعي',
  review: { status: 'pending', note: 'Generation and file checks do not imply subject or gameplay verification.' },
};
// One record per asset avoids concurrent writers overwriting a shared manifest.
const recordDir = path.join(root, 'docs/bank/rebuild-2026-09-18/generated-records');
await fs.mkdir(recordDir, { recursive: true });
await fs.writeFile(path.join(recordDir, `${job.id}.json`), `${JSON.stringify(record, null, 2)}\n`);
console.log(JSON.stringify({ file: relative, bytes: bytes.length, width: meta.width, height: meta.height }));

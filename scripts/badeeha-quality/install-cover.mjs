import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import sharp from 'sharp';

const [id, source] = process.argv.slice(2);
const directory = 'docs/bank/quality-2026-10-08';
const planFile = `${directory}/cover-plan.json`;
const plan = JSON.parse(await readFile(planFile, 'utf8'));
const job = plan.covers.find((cover) => cover.id === id);
if (!job || !source) throw new Error('Usage: install-cover.mjs <known-pack-id> <generated-image-path>');
const original = await readFile(source);
const input = await sharp(original).metadata();
let quality = 86;
let bytes;
do {
  bytes = await sharp(original).resize(640, 480, { fit: 'cover', position: 'centre', withoutEnlargement: true }).webp({ quality }).toBuffer();
  quality -= 4;
} while (bytes.length > 262144 && quality >= 58);
if (bytes.length > 262144) throw new Error('Cover exceeds image budget');
await writeFile(job.file, bytes);
const hash = (value) => createHash('sha256').update(value).digest('hex');
await mkdir(`${directory}/art-records`, { recursive: true });
const record = {
  id, kind: 'cover', file: job.file, style: job.style, palette: job.palette,
  prompt: job.prompt, tool: 'OpenAI image generation (built-in)', createdAt: '2026-10-08',
  sourceImage: { name: path.basename(source), sha256: hash(original), width: input.width, height: input.height },
  width: 640, height: 480, bytes: bytes.length, sha256: hash(bytes),
  disclosure: 'صورة توضيحية مولّدة بالذكاء الاصطناعي',
  review: { status: 'pending-phone-size-review' },
};
await writeFile(`${directory}/art-records/cover-${id}.json`, `${JSON.stringify(record, null, 2)}\n`);
job.status = 'generated-installed';
job.record = `${directory}/art-records/cover-${id}.json`;
await writeFile(planFile, `${JSON.stringify(plan, null, 2)}\n`);
console.log(JSON.stringify({ id, file: job.file, bytes: bytes.length, sha256: record.sha256 }));

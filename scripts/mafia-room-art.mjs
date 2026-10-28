// Deterministic format optimization only. Keep original generated masters intact.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'assets/mafia/rooms-v2');
const output = path.join(root, 'src/games/mafia/assets');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const names = ['scenes-wide', 'card-back'];
const manifestPath = path.join(source, 'manifest.json');
if (process.argv.includes('--check')) {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  for (const name of names) {
    const master = await readFile(path.join(source, `${name}.png`));
    const encoded = await readFile(path.join(output, `noir-${name}.webp`));
    const meta = await sharp(encoded).metadata();
    const item = manifest.assets[name];
    if (digest(master) !== item.sourceSHA256 || digest(encoded) !== item.outputSHA256 || meta.width !== item.width || meta.height !== item.height) throw new Error(`Room artwork drift: ${name}`);
  }
  console.log('Mafia room art: reviewed source hashes and mobile encodings verified.');
} else {
  await mkdir(output, { recursive: true });
  const manifest = { schema: 1, generator: 'built-in image_gen', generatedDate: '2026-10-28', prompts: 'docs/mafia/ROOM-ART-PROMPTS.json', derivative: 'Resize/format optimization only; no painted content changed', assets: {} };
  for (const name of names) {
    const master = await readFile(path.join(source, `${name}.png`));
    let pipeline = sharp(master);
    if (name === 'card-back') pipeline = pipeline.resize({ width: 384 });
    const encoded = await pipeline.webp({ quality: 85, effort: 6 }).toBuffer();
    await writeFile(path.join(output, `noir-${name}.webp`), encoded);
    const meta = await sharp(encoded).metadata();
    manifest.assets[name] = { sourceSHA256: digest(master), outputSHA256: digest(encoded), bytes: encoded.length, width: meta.width, height: meta.height, alpha: meta.hasAlpha };
  }
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  console.log(JSON.stringify(manifest.assets));
}

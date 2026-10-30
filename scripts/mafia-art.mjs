// Format/size optimization only: original generated artwork is kept unchanged.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import sharp from 'sharp';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'assets/mafia/noir-v1');
const output = path.join(root, 'src/games/mafia/assets');
const manifestPath = path.join(source, 'manifest.json');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const names = ['spy', 'roles', 'scenes', 'environment'];
if (process.argv.includes('--check')) {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  for (const name of names) {
    const item = manifest.assets[name];
    const [original, encoded] = await Promise.all([readFile(path.join(source, `${name}.png`)), readFile(path.join(output, `noir-${name}.webp`))]);
    if (digest(original) !== item.sourceSHA256 || digest(encoded) !== item.outputSHA256) throw new Error(`Mafia art drift: ${name}`);
    const meta = await sharp(encoded).metadata();
    if (meta.width !== item.width || meta.height !== item.height || (name === 'spy' && !meta.hasAlpha)) throw new Error(`Mafia art geometry/alpha drift: ${name}`);
  }
  console.log('Mafia noir: four original assets, exact geometry and transparent spy verified.');
} else {
  await mkdir(output, { recursive: true });
  const manifest = { schema: 1, generator: 'built-in image_gen', generatedDate: '2026-10-27', prompts: 'docs/mafia/NOIR-ART-PROMPTS.json', derivative: 'WebP format optimization only; no painted content changed', assets: {} };
  for (const name of names) {
    const original = await readFile(path.join(source, `${name}.png`));
    let pipeline = sharp(original);
    if (name === 'spy') pipeline = pipeline.resize({ width: 768 });
    if (name === 'environment') pipeline = pipeline.resize({ width: 1200 });
    const encoded = await pipeline.webp({ quality: name === 'roles' ? 90 : 86, alphaQuality: 100, effort: 6 }).toBuffer();
    await writeFile(path.join(output, `noir-${name}.webp`), encoded);
    const meta = await sharp(encoded).metadata();
    manifest.assets[name] = { sourceSHA256: digest(original), outputSHA256: digest(encoded), bytes: encoded.length, width: meta.width, height: meta.height, alpha: meta.hasAlpha };
  }
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  console.log(JSON.stringify(manifest.assets));
}

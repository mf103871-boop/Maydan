import { copyFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { ROOT } from './lib.mjs';

// One opaque master supplies web, installable PWA and native iOS artwork.
const directory = path.join(ROOT, 'public/icons');
const master = path.join(directory, 'icon-1024.png');
const source = await readFile(master);
const metadata = await sharp(source).metadata();
if (metadata.width !== 1024 || metadata.height !== 1024 || metadata.hasAlpha) {
  throw new Error('The brand master must be an opaque 1024×1024 PNG.');
}
for (const [filename, side] of Object.entries({
  'icon-192.png': 192,
  'icon-512.png': 512,
  'apple-touch-icon.png': 180,
  'favicon-32.png': 32,
})) {
  await sharp(source).resize(side, side).removeAlpha().png({ compressionLevel: 9 }).toFile(path.join(directory, filename));
}
// Extra inset keeps the emblem intact under circular and other PWA masks.
for (const side of [192, 512]) {
  const inset = Math.round(side * 0.06);
  await sharp(source).resize(side - 2 * inset, side - 2 * inset)
    .extend({ top: inset, bottom: inset, left: inset, right: inset, background: '#0B0E1A' })
    .removeAlpha().png({ compressionLevel: 9 }).toFile(path.join(directory, `maskable-${side}.png`));
}
await copyFile(master, path.join(ROOT, 'ios/Maydan/Assets.xcassets/AppIcon.appiconset/icon-1024.png'));
console.log('Brand icons ready: web, PWA, and the iOS 1024px master.');

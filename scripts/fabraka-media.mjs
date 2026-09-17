import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { pictureAsset } from '../src/games/fabraka/pictureAssets.js';

// Public images are copied to both the website and the native www directory.
// Validate before a build can replace dist, rather than publishing broken rounds.
export async function fabrakaMediaManifest(root, versions = {}) {
  const pictures = JSON.parse(await readFile(path.join(root, 'src/data/games/fabraka/pictures.json'), 'utf8'));
  if (!Array.isArray(pictures) || !pictures.length) throw new Error('فبركة: بنك الصور فارغ');
  const paths = new Set();
  for (const picture of pictures) {
    const asset = pictureAsset(picture);
    if (!asset) throw new Error(`فبركة: مسار صورة غير صالح — ${picture.id}`);
    if (paths.has(asset)) throw new Error(`فبركة: صورة مكررة — ${asset}`);
    paths.add(asset);
    const file = await stat(path.join(root, 'public', asset)).catch(() => null);
    if (!file?.isFile() || !file.size) throw new Error(`فبركة: ملف صورة مفقود — ${asset}`);
  }
  const version = versions['fabraka-v3'];
  return [...paths].sort().map((asset) => `./${asset}${version ? `?v=${version}` : ''}`);
}

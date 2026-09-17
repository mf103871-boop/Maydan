import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import { fabrakaMediaManifest } from '../scripts/fabraka-media.mjs';
import { mediaVersions } from '../scripts/lib.mjs';
import { pictureAsset } from '../src/games/fabraka/pictureAssets.js';
import { resolveMedia } from '../src/shared/media/resolve.js';

test('the complete picture bank resolves to local high-resolution WebP assets with neutral paths', async () => {
  const root = process.cwd();
  const pictures = JSON.parse(await readFile(path.join(root, 'src/data/games/fabraka/pictures.json'), 'utf8'));
  const manifest = await fabrakaMediaManifest(root, { 'fabraka-v3': 'unit' });
  assert.equal(manifest.length, pictures.length);
  for (const picture of pictures) {
    const asset = pictureAsset(picture);
    const metadata = await sharp(path.join(root, 'public', asset)).metadata();
    assert.equal(metadata.format, 'webp');
    assert.ok(metadata.width >= 768 && metadata.height >= 768, `${picture.id}: ${metadata.width}x${metadata.height}`);
    assert.equal(new URL(resolveMedia(asset), 'https://example.test/Maydan/index.html').pathname, `/Maydan/${asset}`);
    assert.equal(new URL(resolveMedia(asset), 'maydan-app://bundle/index.html').pathname, `/${asset}`);
    assert.ok(manifest.includes(`./${asset}?v=unit`));
    assert.equal(asset.includes(picture.answer), false);
  }
});

test('missing files block a release and replaced public images change the cache version', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'maydan-fabraka-media-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'src/data/games/fabraka'), { recursive: true });
  await mkdir(path.join(root, 'public/media/fabraka-v3'), { recursive: true });
  const picture = { id: 'fab3-picture-001', image: 'media/fabraka-v3/fab3-001.webp' };
  const bank = path.join(root, 'src/data/games/fabraka/pictures.json');
  await writeFile(bank, JSON.stringify([picture]));
  await assert.rejects(fabrakaMediaManifest(root), /ملف صورة مفقود/);
  const asset = path.join(root, 'public', picture.image);
  await writeFile(asset, 'test-content-one');
  const before = await mediaVersions(root);
  await writeFile(asset, 'test-content-two');
  const after = await mediaVersions(root);
  assert.notEqual(before['fabraka-v3'], after['fabraka-v3']);
  assert.equal((await fabrakaMediaManifest(root, after))[0], `./${picture.image}?v=${after['fabraka-v3']}`);
  await writeFile(bank, JSON.stringify([{ ...picture, image: '../outside.webp' }]));
  await assert.rejects(fabrakaMediaManifest(root), /مسار صورة غير صالح/);
});

test('native resource preparation includes public media and the iOS scheme serves WebP paths', async () => {
  const prepare = await readFile(new URL('../scripts/ios/prepare.mjs', import.meta.url), 'utf8');
  const scheme = await readFile(new URL('../ios/Maydan/AppSchemeHandler.swift', import.meta.url), 'utf8');
  assert.match(prepare, /await buildOnce\(/);
  assert.match(prepare, /await cp\(DIST, destination, \{ recursive: true \}\)/);
  assert.match(prepare, /await verifyDirectory\(DIST, destination\)/);
  assert.match(scheme, /"webp": "image\/webp"/);
  assert.match(scheme, /resolve\(path: url\.path\)/);
});

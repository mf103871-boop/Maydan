import test from 'node:test';
import assert from 'node:assert/strict';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { build } from 'esbuild';
import { CATS } from '../src/data/categories/index.js';
import pictures from '../src/data/games/fabraka/pictures.json' with { type: 'json' };
import { categoryCoverSource } from '../src/games/badeeha/covers.js';
import { collectStartupImages, startupImageUrls } from '../src/shared/media/startup-images.js';

const root = fileURLToPath(new URL('..', import.meta.url));

test('startup images cover paired puzzles and legacy images without downloading sound or credit links', () => {
  const categories = [{
    id: 'sample', defaultType: 'image', qs: [
      { media: ['left.webp', { src: 'right.webp', sourceUrl: 'https://credits.test/photo.jpg' }] },
      { type: 'diff', media: ['left.webp', 'other.webp'] },
      { type: 'image', media: 'https://cdn.test/question.jpg?v=2' },
      { type: 'audio', media: { src: 'clip.mp3', sourceUrl: 'https://credits.test/sound.jpg' } },
      { type: 'video', media: 'clip.mp4' },
      { type: 'zoom', image: 'legacy/zoom.png?revision=3' },
      { type: 'pic', image: 'legacy/pic.svg' },
      { type: 'image', media: 'data:image/png;base64,embedded' },
      { type: 'text', sourceUrl: 'https://credits.test/unused.png' },
    ],
  }];
  const found = collectStartupImages(categories, [
    { image: 'media/fabraka-v3/fab3-001.webp' },
    { image: 'media/fabraka-v3/fab3-001.webp' },
    { image: 'https://credits.test/retired-fabraka.jpg' },
  ], { coverSource: (id) => categoryCoverSource(id, '1234abcd') });
  assert.deepEqual(found, [
    'media/badeeha-covers/sample.webp?v=1234abcd',
    'media/sample/left.webp', 'media/sample/right.webp', 'media/sample/other.webp',
    'https://cdn.test/question.jpg?v=2', 'legacy/zoom.png?revision=3', 'legacy/pic.svg',
    'media/fabraka-v3/fab3-001.webp',
  ]);
});

test('the complete active image bank includes all 78 covers, 400 puzzle images and 32 Fabraka pictures', async () => {
  const urls = collectStartupImages(CATS, pictures, { coverSource: (id) => categoryCoverSource(id, '1234abcd') });
  const covers = urls.filter((url) => url.startsWith('media/badeeha-covers/'));
  const fabraka = urls.filter((url) => url.startsWith('media/fabraka-v3/'));
  const puzzles = urls.filter((url) => !covers.includes(url) && !fabraka.includes(url));
  assert.equal(urls.length, 510);
  assert.equal(covers.length, 78);
  assert.equal(fabraka.length, 32);
  assert.equal(puzzles.length, 400);
  for (const category of CATS) assert.ok(covers.includes(`media/badeeha-covers/${category.id}.webp?v=1234abcd`));
  for (const category of ['flags', 'zoom', 'blur', 'reveal', 'silhouette', 'guesscar', 'placefinder', 'tilepuzzle']) {
    assert.equal(puzzles.filter((url) => url.startsWith(`media/${category}/`)).length, 40, category);
  }
  const differences = puzzles.filter((url) => url.startsWith('media/spotdiff/'));
  assert.equal(differences.length, 80, 'both images of all 40 spot-the-difference questions must be warm');
  assert.equal(differences.filter((url) => /-a\.webp$/.test(url)).length, 40);
  assert.equal(differences.filter((url) => /-b\.webp$/.test(url)).length, 40);
  assert.ok(fabraka.includes('media/fabraka-v3/fab3-001.webp'));
  assert.ok(fabraka.includes('media/fabraka-v3/fab3-032.webp'));
  assert.ok(urls.every((url) => !/\.(mp3|mp4|wav|ogg)(?:\?|$)/i.test(url)));
  for (const url of urls) {
    const relative = url.split('?')[0];
    const asset = await stat(path.join(root, relative)).catch(() => stat(path.join(root, 'public', relative)));
    assert.ok(asset.isFile() && asset.size > 0, `${url} must ship with the application`);
  }
  assert.ok(startupImageUrls.every((url) => urls.includes(url)), 'unbundled development uses the same active files');
});

test('bundled startup URLs use the same versioned paths as the game renderers under a nested site path', async () => {
  const versions = Object.fromEntries([
    'badeeha-covers', 'fabraka-v3', 'flags', 'zoom', 'blur', 'reveal', 'silhouette',
    'guesscar', 'placefinder', 'tilepuzzle', 'spotdiff',
  ].map((name, index) => [name, (0x10000000 + index).toString(16)]));
  const result = await build({
    stdin: { contents: `export { startupImageUrls } from './src/shared/media/startup-images.js';
      export { categoryCoverSource } from './src/games/badeeha/covers.js';
      export { questionMedia, resolveMedia } from './src/shared/media/resolve.js';`, resolveDir: root },
    bundle: true, write: false, format: 'iife', globalName: 'Images', platform: 'browser',
    define: { __MAYDAN_MEDIA_VERSIONS__: JSON.stringify(versions) },
  });
  const context = {};
  vm.runInNewContext(result.outputFiles[0].text, context);
  const { startupImageUrls: urls, categoryCoverSource: cover, questionMedia, resolveMedia } = context.Images;
  assert.equal(urls.length, 510);
  for (const category of CATS) {
    assert.ok(urls.includes(cover(category.id)), `${category.id} cover`);
    for (const question of category.qs) {
      if (!['image', 'diff'].includes(question.type || category.defaultType)) continue;
      for (const url of questionMedia(question, category.id)) assert.ok(urls.includes(url), question.qid);
    }
  }
  for (const picture of pictures) assert.ok(urls.includes(resolveMedia(picture.image)), picture.id);
  for (const url of urls) {
    const folder = url.split('/')[1];
    assert.ok(url.endsWith(`?v=${versions[folder]}`), url);
    assert.equal(new URL(url, 'https://example.test/Maydan/index.html').pathname, `/Maydan/${url.split('?')[0]}`);
  }
});

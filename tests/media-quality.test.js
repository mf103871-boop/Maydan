import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeLicense } from '../scripts/media-fetch.mjs';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';

test('photograph attribution is preserved when the depicted object is public domain', () => {
  assert.deepEqual(normalizeLicense('Public domain', 'CC BY-SA 3.0', 'https://creativecommons.org/publicdomain/mark/1.0/'), {
    license: 'CC BY-SA 3.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0/',
  });
  assert.deepEqual(normalizeLicense('CC0 1.0', 'CC BY 4.0'), {
    license: 'CC BY 4.0', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
  });
});

test('standalone public-domain and restrictive licenses retain their treatment', () => {
  assert.equal(normalizeLicense('Public Domain').license, 'Public Domain');
  assert.equal(normalizeLicense('CC0 1.0').license, 'CC0 1.0');
  assert.equal(normalizeLicense('CC BY-NC 4.0', 'Public Domain'), null);
  assert.equal(normalizeLicense('CC BY-ND 4.0'), null);
});

test('solid-black silhouette treatment is limited to genuinely transparent cutouts', async () => {
  const pack = JSON.parse(await readFile(new URL('../src/data/categories/silhouette.json', import.meta.url), 'utf8'));
  for (const q of pack.qs.filter(q => q.effect === 'silhouette')) {
    const file = new URL(`../media/silhouette/${q.media.src}`, import.meta.url);
    const input = await readFile(file);
    const metadata = await sharp(input).metadata();
    assert.ok(metadata.hasAlpha, `${q.qid}: opaque photo must use shadow, or it becomes a black rectangle`);
    const stats = await sharp(input).stats();
    assert.ok(stats.channels[3]?.min < 128, `${q.qid}: alpha channel must contain real transparency`);
  }
});

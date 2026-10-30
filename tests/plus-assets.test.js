import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { PLUS_COLLECTIONS, PLUS_ITEMS, availableCollections } from '../src/plus/catalog.js';

test('all cosmetic assets are bundled, fingerprinted and contain no external sticker content', () => {
  for (const item of PLUS_ITEMS) {
    assert.match(item.assetUrl, /^\/assets\/plus\/v1\/[a-z0-9-]+\.(webp|svg)$/);
    const bytes = readFileSync(new URL('../public' + item.assetUrl, import.meta.url));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), item.assetHash, item.id);
    if (item.kind === 'sticker') {
      const svg = bytes.toString('utf8');
      assert.match(svg, /viewBox=/);
      assert.doesNotMatch(svg.replace('xmlns="http://www.w3.org/2000/svg"', ''), /<script|<foreignObject|\bon[a-z]+=|https?:\/\//i);
      assert.ok(svg.includes(item.label), item.id);
    }
  }
});

test('three complete launch collections and two future monthly collections have six original stickers each', () => {
  assert.equal(PLUS_COLLECTIONS.length, 5);
  assert.equal(availableCollections(Date.UTC(2026, 9, 28)).length, 3);
  for (const collection of PLUS_COLLECTIONS) {
    const items = PLUS_ITEMS.filter(item => item.collectionId === collection.id);
    assert.equal(items.filter(item => item.kind === 'sticker').length, 6);
    for (const kind of collection.availableFrom === 0 ? ['frame', 'avatar', 'cover', 'roomTheme'] : ['frame', 'cover']) {
      assert.equal(items.filter(item => item.kind === kind).length, 1, `${collection.id}:${kind}`);
    }
  }
});

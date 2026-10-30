import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { encodeMediaVersions, mediaVersions, ROOT } from '../scripts/lib.mjs';
import { decodeMediaVersions } from '../src/shared/media/versions.js';

test('every actual media path keeps its exact hash after packaging, including leading zeroes', async () => {
  const media = { ...await mediaVersions(ROOT), 'صور/🍋.png':'000000', 'صور/🍊.png':'ffffff', 'spaces/a b.png':'00ab09' };
  const encoded = encodeMediaVersions(media);
  assert.ok(encoded.startsWith('p3|'));
  assert.deepEqual({ ...decodeMediaVersions(encoded) }, media);
  assert.ok(Buffer.byteLength(encoded) < Buffer.byteLength(JSON.stringify(media)) * 0.7);
  const reversed = Object.fromEntries(Object.entries(media).reverse());
  assert.equal(encodeMediaVersions(reversed), encoded, 'object insertion order cannot change the packed build');
  assert.equal(createHash('sha256').update(JSON.stringify(Object.entries(decodeMediaVersions(encoded)).sort())).digest('hex'), createHash('sha256').update(JSON.stringify(Object.entries(media).sort())).digest('hex'));
});

test('legacy p1/p2 strings and object fixtures remain compatible; malformed and future formats do not invent hashes', () => {
  const legacy = 'p1|0:pack/a.png:000001|5:b.png:ffffff';
  assert.deepEqual({ ...decodeMediaVersions(legacy) }, {'pack/a.png':'000001','pack/b.png':'ffffff'});
  assert.deepEqual({ ...decodeMediaVersions('p2|0:pack/a.webp:0001|5:b.webp:----') }, {'pack/a.webp':'000001','pack/b.webp':'ffffff'});
  const object = {'pack/a.png':'aabbcc'};
  assert.equal(decodeMediaVersions(object), object);
  assert.equal(encodeMediaVersions({'unsafe|path':'aabbcc'})['unsafe|path'], 'aabbcc');
  for (const bad of ['p4|0:a.png:0000','p3|0:a~b:0000','p3|0:a~~:0000','p2|0:a.png:!!!!','p2|z:a.png:0000',null,42]) assert.deepEqual({...decodeMediaVersions(bad)},{});
});

test('p3 expands original prefix coordinates even when a shared prefix ends inside an extension or surrogate pair', () => {
  const media = { 'pack/a.weba': '000000', 'pack/a.webp': '000001', 'pack/a.webp2': '000002', 'pack/a.webp2.webp': '000003', 'صور/🍊.webp': 'ffffff', 'صور/🍋.webp': '00ab09', 'pack/UPPER.WEBP': '112233', 'pack/no-extension': 'ddeeff' };
  const encoded = encodeMediaVersions(media);
  assert.ok(encoded.startsWith('p3|'));
  assert.deepEqual({ ...decodeMediaVersions(encoded) }, media);
});

test('a literal reserved token chooses deterministic p2 without changing any filename or hash', () => {
  const media = { 'pack/a~.webp': '000001', 'pack/a.webp': 'ffffff', 'pack/~/a.png': 'aabbcc' };
  const encoded = encodeMediaVersions(media);
  assert.ok(encoded.startsWith('p2|'));
  assert.equal(encodeMediaVersions(Object.fromEntries(Object.entries(media).reverse())), encoded);
  assert.deepEqual({ ...decodeMediaVersions(encoded) }, media);
});

test('fixed-width hash encoding round-trips the entire six-hex-digit boundary space sample', () => {
  const media = Object.fromEntries(Array.from({length:4096},(_,i)=>[`pack/image-${i}`,((i*4099)&0xffffff).toString(16).padStart(6,'0')]));
  assert.deepEqual({...decodeMediaVersions(encodeMediaVersions(media))},media);
});

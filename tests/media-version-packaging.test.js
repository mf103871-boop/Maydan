import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeMediaVersions, mediaVersions, ROOT } from '../scripts/lib.mjs';
import { decodeMediaVersions } from '../src/shared/media/versions.js';

test('every actual media path keeps its exact hash after packaging, including leading zeroes', async () => {
  const media = { ...await mediaVersions(ROOT), 'صور/🍋.png':'000000', 'صور/🍊.png':'ffffff', 'spaces/a b.png':'00ab09' };
  const encoded = encodeMediaVersions(media);
  assert.ok(encoded.startsWith('p2|'));
  assert.deepEqual({ ...decodeMediaVersions(encoded) }, media);
  assert.ok(Buffer.byteLength(encoded) < Buffer.byteLength(JSON.stringify(media)) * 0.7);
  const reversed = Object.fromEntries(Object.entries(media).reverse());
  assert.deepEqual({ ...decodeMediaVersions(encodeMediaVersions(reversed)) }, media);
});

test('legacy p1 strings and object fixtures remain compatible; malformed and future formats do not invent hashes', () => {
  const legacy = 'p1|0:pack/a.png:000001|5:b.png:ffffff';
  assert.deepEqual({ ...decodeMediaVersions(legacy) }, {'pack/a.png':'000001','pack/b.png':'ffffff'});
  const object = {'pack/a.png':'aabbcc'};
  assert.equal(decodeMediaVersions(object), object);
  assert.equal(encodeMediaVersions({'unsafe|path':'aabbcc'})['unsafe|path'], 'aabbcc');
  for (const bad of ['p3|0:a.png:0000','p2|0:a.png:!!!!','p2|z:a.png:0000',null,42]) assert.deepEqual({...decodeMediaVersions(bad)},{});
});

test('fixed-width hash encoding round-trips the entire six-hex-digit boundary space sample', () => {
  const media = Object.fromEntries(Array.from({length:4096},(_,i)=>[`pack/image-${i}`,((i*4099)&0xffffff).toString(16).padStart(6,'0')]));
  assert.deepEqual({...decodeMediaVersions(encodeMediaVersions(media))},media);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import artwork from '../assets/game-entry/manifest.json' with { type: 'json' };
import { renderHtml } from '../scripts/lib.mjs';

test('ticket artwork has the exact public bytes, native-friendly dimensions and genuine alpha', async () => {
  const bytes = await readFile('public/' + artwork.url), metadata = await sharp(bytes).metadata();
  assert.equal(bytes.length, artwork.bytes);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), artwork.sha256);
  assert.deepEqual([metadata.width, metadata.height], [artwork.width, artwork.height]);
  assert.equal(metadata.hasAlpha, true);
  assert.ok(bytes.length < 100 * 1024, 'The small entry illustration must not become a large background download.');
  const alpha = (await sharp(bytes).stats()).channels.at(-1);
  assert.equal(alpha.min, 0, 'The background must be actually transparent.');
  assert.ok(alpha.max > 240, 'The illustration itself remains visible.');
  const sw = await readFile('public/sw.js', 'utf8');
  assert.ok(sw.includes(`'./${artwork.url}'`), 'The ticket illustration is installed with the offline shell.');
});

test('public/native HTML can identify its frozen source without accepting arbitrary injected metadata', async () => {
  const sourceCommit = 'a'.repeat(40);
  const html = await renderHtml('void 0', { version: '1.9', sourceCommit });
  assert.ok(html.includes(`<meta name="maydan-source" content="${sourceCommit}">`));
  assert.equal((html.match(/name="maydan-source"/g) || []).length, 1);
  await assert.rejects(renderHtml('void 0', { version: '1.9', sourceCommit: '"><script>bad</script>' }), /complete Git commit/);
});

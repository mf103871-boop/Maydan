// اعتماد الصوت: الملف المولَّد مطابق لـ provenance، كل مصدر يوجب الإسناد يظهر، والمكوّن يعرض
// أسماء المصادر وروابط الرخص. يُبنى المكوّن بـ esbuild ويُصيَّر بـ react-dom/server كبقية اختبارات الواجهة.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { buildCredits, renderCredits } from '../scripts/audio/credits.mjs';
import { AUDIO_CREDITS } from '../src/shared/fx/audio-credits.js';

const root = process.cwd();
const read = (f) => JSON.parse(readFileSync(path.join(root, 'assets/audio/maydan-v3', f), 'utf8'));
const cues = read('provenance.json'), music = read('music/provenance.json'), registry = read('sources.json');

test('audio-credits.js is generated from provenance and every attribution license is listed', () => {
  const credits = buildCredits(cues, music, registry);
  assert.equal(readFileSync(path.join(root, 'src/shared/fx/audio-credits.js'), 'utf8'), renderCredits(credits), 'run node scripts/audio/credits.mjs');
  assert.deepEqual(AUDIO_CREDITS, credits);
  const sourced = [...Object.entries(cues.cues), ...Object.entries(music.tracks)].filter(([, info]) => info.source);
  assert.equal(credits.sources.reduce((n, s) => n + s.items, 0), sourced.length);
  for (const [id, info] of sourced) {
    const provider = registry.providers[info.source.provider];
    assert.ok(provider && provider.verified !== false, `${id}: verified provider`);
    assert.ok(credits.sources.some((s) => s.provider === info.source.provider && (s.cues.includes(id) || s.tracks.includes(id))), `${id} credited under its source`);
    if (provider.attribution) {
      const entry = credits.attribution.find((a) => a.id.endsWith(`:${id}`));
      assert.ok(entry && entry.title && entry.author && entry.sourceUrl && entry.licenseUrl && entry.creditLine, `${id}: attribution entry complete`);
    }
  }
  assert.equal(credits.inHouse.cues.length + credits.inHouse.tracks.length + sourced.length, Object.keys(cues.cues).length + Object.keys(music.tracks).length);
});

test('the About screen credit lists every source with its license link', async () => {
  const temp = mkdtempSync(path.join(root, '.cache', 'credits-test-'));
  process.once('exit', () => rmSync(temp, { recursive: true, force: true }));
  mkdirSync(temp, { recursive: true });
  writeFileSync(path.join(temp, 'entry.jsx'), `
    import React from 'react';
    import { renderToStaticMarkup } from 'react-dom/server';
    import { AudioCredits } from '${path.relative(temp, path.join(root, 'src/platform/screens/AudioCredits.jsx')).split(path.sep).join('/')}';
    export const render = (credits) => renderToStaticMarkup(React.createElement(AudioCredits, credits ? { credits } : {}));
  `);
  await build({ entryPoints: [path.join(temp, 'entry.jsx')], outfile: path.join(temp, 'render.mjs'), bundle: true, platform: 'node', format: 'esm', packages: 'external', jsx: 'automatic', logLevel: 'silent' });
  const { render } = await import(pathToFileURL(path.join(temp, 'render.mjs')).href);
  const html = render();
  for (const s of AUDIO_CREDITS.sources) { assert.ok(html.includes(s.name), `${s.name} shown`); assert.ok(html.includes(`href="${s.licenseUrl}"`), `${s.provider} license link`); }
  for (const a of AUDIO_CREDITS.attribution) { assert.ok(html.includes(a.title) && html.includes(a.author), `${a.id} credited`); }
  assert.ok(html.includes('من تأليف ميدان'), 'in-house share stated');
  const withAttribution = render({ attribution: [{ id: 'music:x', title: 'Piece', author: 'Composer', sourceUrl: 'https://example.com/p', license: 'CC BY 4.0', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/', creditLine: 'Piece — Composer' }], sources: [{ provider: 'p', name: 'Lib', url: 'https://example.com', license: 'CC BY 4.0', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/', attribution: true, items: 1, cues: [], tracks: ['x'] }], inHouse: { cues: ['click'], tracks: [] } });
  assert.ok(withAttribution.includes('Piece') && withAttribution.includes('Composer') && withAttribution.includes('https://example.com/p'), 'attribution entries render with title, author and source');
});

import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { build } from 'esbuild';
import sharp from 'sharp';
import { ROOT, esbuildOptions, renderServiceWorker } from '../scripts/lib.mjs';
import { MAFIA_ROLES } from '../src/online/mafia-shared.js';

const names = ['environment', 'roles', 'scenes', 'spy'];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
let manifest, bundle, art, helpers;
before(async () => {
  manifest = JSON.parse(await readFile(path.join(ROOT, 'assets/mafia/noir-v1/manifest.json'), 'utf8'));
  // Exercise the production file-loader options without touching dist or native
  // resources. The narrow entrypoint exports the same helpers the game imports.
  bundle = await build({ ...esbuildOptions({ assets: 'files' }), entryPoints: [path.join(ROOT, 'src/games/mafia/noir-assets.js')], format: 'esm' });
  art = bundle.outputFiles.filter(file => file.path.endsWith('.webp'));
  const source = bundle.outputFiles.find(file => file.path.endsWith('.js')).text;
  helpers = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
});

test('original noir sources and optimized files match their reviewed manifest and remain within the mobile budget', async () => {
  assert.deepEqual(Object.keys(manifest.assets).sort(), names);
  let bytes = 0;
  for (const name of names) {
    const item = manifest.assets[name];
    const original = await readFile(path.join(ROOT, `assets/mafia/noir-v1/${name}.png`));
    const encoded = await readFile(path.join(ROOT, `src/games/mafia/assets/noir-${name}.webp`));
    assert.equal(hash(original), item.sourceSHA256, `${name}: original drift`);
    assert.equal(hash(encoded), item.outputSHA256, `${name}: optimized drift`);
    assert.equal(encoded.length, item.bytes);
    const info = await sharp(encoded).metadata();
    assert.equal(info.width, item.width); assert.equal(info.height, item.height);
    assert.equal(info.hasAlpha, item.alpha);
    if (name === 'spy') assert.equal(info.hasAlpha, true, 'the spy icon preserves transparency');
    bytes += encoded.length;
  }
  assert.ok(bytes < 1024 * 1024, `Mafia runtime artwork uses ${bytes} bytes; budget is 1 MiB`);
});

test('all four noir illustrations enter the hashed asset and offline manifest pipeline, never the JS image payload', async () => {
  assert.equal(art.length, 4);
  const source = bundle.outputFiles.find(file => file.path.endsWith('.js')).text;
  assert.doesNotMatch(source, /data:image|https?:\/\//);
  const paths = art.map(file => './' + path.relative(path.join(ROOT, 'dist'), file.path).replaceAll('\\', '/')).sort();
  for (const name of names) {
    const file = art.find(item => new RegExp(`/noir-${name}-[A-Z0-9]+\\.webp$`).test(item.path.replaceAll('\\', '/')));
    assert.ok(file, `${name}: missing hashed output`);
    assert.equal(hash(file.contents), manifest.assets[name].outputSHA256);
  }
  const worker = renderServiceWorker(await readFile(path.join(ROOT, 'public/sw.js'), 'utf8'), { brandAssets: paths });
  const installed = JSON.parse(worker.match(/const BRAND_ASSETS = (\[[^;]*\]);/)[1]);
  assert.deepEqual(installed, paths);
  for (const value of Object.values(helpers.MAFIA_NOIR_ASSETS)) assert.ok(paths.includes('./' + value.replace(/^\.\//, '')));
});

function rect(style, width, height) {
  const [sx, sy] = style.backgroundSize.split(' ').map(parseFloat);
  const [px, py] = style.backgroundPosition.split(' ').map(parseFloat);
  const w = width * 100 / sx, h = height * 100 / sy;
  return { x: px * (width - w) / 100, y: py * (height - h) / 100, w, h };
}
function partition(styles, width, height) {
  const frames = styles.map(style => rect(style, width, height));
  assert.equal(new Set(styles.map(style => style.backgroundPosition)).size, styles.length);
  for (const frame of frames) {
    for (const value of Object.values(frame)) assert.ok(Number.isFinite(value));
    assert.ok(frame.x >= 0 && frame.y >= 0 && frame.w > 0 && frame.h > 0);
    assert.ok(frame.x + frame.w <= width + .001 && frame.y + frame.h <= height + .001);
  }
  for (let i = 0; i < frames.length; i++) for (let j = i + 1; j < frames.length; j++) {
    const a = frames[i], b = frames[j];
    const overlap = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
    assert.ok(overlap < .001, `atlas frames ${i} and ${j} overlap`);
  }
  assert.ok(Math.abs(frames.reduce((sum, f) => sum + f.w * f.h, 0) - width * height) < .001);
}

test('all twelve public roles receive unique in-bounds portraits and unknown roles reveal no assigned role', () => {
  assert.deepEqual(Object.keys(helpers.MAFIA_NOIR_ROLE_INDEX).sort(), Object.keys(MAFIA_ROLES).sort());
  const roles = Object.keys(MAFIA_ROLES).map(helpers.mafiaRoleArtStyle);
  partition(roles, manifest.assets.roles.width, manifest.assets.roles.height);
  for (const unknown of [undefined, '', 'new-unreviewed-role', '__proto__']) {
    const style = helpers.mafiaRoleArtStyle(unknown);
    assert.equal(style.backgroundImage, `url(${helpers.MAFIA_NOIR_ASSETS.icon})`);
  }
});

test('six public event illustrations tile their atlas without crossing into another event', () => {
  const scenes = Object.keys(helpers.MAFIA_NOIR_SCENE_INDEX).map(helpers.mafiaSceneArtStyle);
  assert.equal(scenes.length, 6);
  partition(scenes, manifest.assets.scenes.width, manifest.assets.scenes.height);
  assert.deepEqual(helpers.mafiaSceneArtStyle('unknown'), helpers.mafiaSceneArtStyle('night'));
});

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { DESIGN_SCREENS, DESIGN_REGISTRY_VERSION, getScreenDefinition, getNodeDefinition } from '../src/design/registry.js';
import { DESIGN_SCENES, createDesignFixture } from '../src/design/screen-catalog.js';
import { DESIGN_RENDERED_NODE_IDS, DESIGN_CONDITIONAL_NODE_REASONS } from '../src/design/coverage-map.js';

test('coverage inventory preserves every node and exact conditional explanation after deduplication', () => {
  // Captured from the reviewed Phase2 inventory before sharing repeated copy.
  // A deliberate coverage/content change must update this semantic baseline;
  // whitespace, constant names and sharing structure do not affect it.
  const semantics = JSON.stringify({ DESIGN_CONDITIONAL_NODE_REASONS, DESIGN_RENDERED_NODE_IDS });
  assert.equal(createHash('sha256').update(semantics).digest('hex'), '809c8697930b72d647918038dffdaf5167f96746126c79b6959314b06d52aff8');
});

test('semantic scene registry has stable unique identities and the eight actual games', () => {
  assert.equal(DESIGN_REGISTRY_VERSION, 1);
  assert.equal(new Set(DESIGN_SCREENS.map(screen => screen.id)).size, DESIGN_SCREENS.length);
  assert.ok(DESIGN_SCREENS.length >= 80);
  for (const screen of DESIGN_SCREENS) {
    assert.match(screen.id, /^[a-z][a-zA-Z0-9.-]+$/);
    assert.equal(getScreenDefinition(screen.id), screen);
    assert.equal(new Set(screen.nodes.map(node => node.id)).size, screen.nodes.length);
    for (const node of screen.nodes) assert.equal(getNodeDefinition(screen.id, node.id), node);
  }
  assert.deepEqual([...new Set(DESIGN_SCENES.map(scene => scene.game).filter(Boolean))].sort(), ['badeeha','beep','ersomha','fabraka','jabeen','mafia','mamnoo','meenfina']);
});

test('content and action containers cannot hide mandatory descendant controls', () => {
  for (const screen of DESIGN_SCREENS) for (const node of screen.nodes) {
    if (['content','actions','header','topbar','controls','canvas-panel','guess-form','composer','navigation','room-actions','settings-account','settings-privacy','legal'].includes(node.id)) assert.equal(node.required, true, `${screen.id}:${node.id}`);
    if (node.kind === 'canvas') { assert.equal(node.canvasViewport ? node.worldAspectRatio : node.aspectRatio, 1); assert.equal(node.required, true); }
    if (['players','member','message','friend-row','option','color','width'].includes(node.id)) assert.equal(node.repeat, true, `${screen.id}:${node.id}`);
  }
});

test('drawing focus keeps its room return and compact tool access in the Studio contract', () => {
  for (const id of ['canvas-panel', 'canvas', 'drawing-tools', 'focus-toggle', 'tools-more', 'camera-controls', 'camera-view', 'camera-hand']) {
    assert.equal(getNodeDefinition('ersomha.draw.drawer', id)?.required, true, id);
  }
  for (const id of ['focus-toggle', 'orientation', 'camera-view', 'camera-hand']) {
    assert.equal(getNodeDefinition('ersomha.draw.drawer', id)?.editableText, false, id);
    assert.equal(getNodeDefinition('ersomha.draw.drawer', id)?.editableIcon, false, id);
  }
  const canvas=getNodeDefinition('ersomha.draw.drawer','canvas');
  assert.equal(canvas.canvasViewport,true);
  assert.equal(canvas.aspectRatio,undefined,'The visible viewport may be wide while canonical ink stays square.');
});

test('dynamic answers, account identity and tool meaning cannot be rewritten as decorative labels', () => {
  for (const screen of DESIGN_SCREENS) for (const node of screen.nodes) {
    if (node.repeat || ['question','prompt','word','answer','timer','players','name','bio','code','room-code','word-banner','mic-note','privacy','connection'].includes(node.id)) assert.equal(node.editableText, false, `${screen.id}:${node.id}`);
    if (['color','avatar','cover','speaker','mute','sound'].includes(node.id)) assert.equal(node.editableIcon, false, `${screen.id}:${node.id}`);
    if (node.id === 'color') { assert.ok(!node.editableStyle.includes('color')); assert.ok(!node.editableStyle.includes('backgroundColor')); }
  }
  const source = readFileSync('src/platform/registry.js','utf8');
  const games = source.match(/export const GAMES = \[([^\]]+)\]/)[1].split(',').map(value => value.trim()).filter(Boolean);
  for (const id of games) {
    const node = getNodeDefinition('home', `game-card.${id}`);
    assert.ok(node, id); assert.notEqual(node.required, true); assert.notEqual(node.repeat, true);
  }
});

test('every scene has isolated deterministic synthetic fixture data, including final results', () => {
  for (const scene of DESIGN_SCENES) {
    const first = createDesignFixture(scene.id), next = createDesignFixture(scene.id);
    assert.deepEqual(first, next, scene.id);
    first.players[0].name = 'changed'; assert.notEqual(next.players[0].name, 'changed');
    if (next.state) { assert.equal(next.state._designPreview, true); assert.equal(next.state.phase, scene.id === 'ersomha.private-wait' ? 'select' : scene.phase || 'lobby'); }
  }
  assert.throws(() => createDesignFixture('unknown-screen'), /Unknown design scene/);
  for (const id of ['beep.three.over','beep.bomb.over','mamnoo.over','jabeen.over','meenfina.local.over','fabraka.local.over','online.fabraka.over','ersomha.over']) assert.equal(createDesignFixture(id).state.phase, 'over');
});

test('production game entrypoints explicitly declare semantic screen identities', () => {
  for (const game of ['badeeha','beep','mamnoo','jabeen','fabraka','meenfina']) {
    const file = `src/games/${game}/${game === 'badeeha' ? 'App.js' : 'Game.jsx'}`;
    const source = readFileSync(file, 'utf8');
    assert.match(source, /data-design-screen/, file);
    assert.match(source, /data-design-id/, file);
    if (game !== 'badeeha') { assert.match(source, /designPreviewState = null/); assert.match(source, /designPreviewState \|\||if \(designPreviewState\)/); }
  }
  assert.match(readFileSync('src/online/Ersomha.jsx','utf8'), /data-design-screen=\{`ersomha\.\$\{state\.phase\}/);
  assert.match(readFileSync('src/online/Fabraka.jsx','utf8'), /data-design-screen=\{`online\.fabraka\.\$\{state\.phase\}/);
  assert.match(readFileSync('src/online/Online.jsx','utf8'), /data-design-screen="online\.lobby"/);
});

test('preview import graph never imports the server answer bank or creates live room/media clients', () => {
  for (const file of ['src/design/registry.js','src/design/screen-catalog.js','src/design/preview-scenes.jsx']) {
    const source = readFileSync(file,'utf8');
    assert.doesNotMatch(source, /from\s+['"][^'"]*server\//);
    assert.doesNotMatch(source, /new (?:RoomClient|LammaClient|SocialClient|WebSocket)|getUserMedia\(/);
  }
});

test('every explicit semantic attribute in game, room, social and profile sources has a registered meaning', () => {
  const known = new Set(DESIGN_SCREENS.flatMap(screen => screen.nodes.map(node => node.id)));
  const walk = directory => readdirSync(directory, { withFileTypes:true }).flatMap(entry => entry.isDirectory() ? walk(path.join(directory,entry.name)) : [path.join(directory,entry.name)]);
  let checked = 0;
  for (const file of ['src/games','src/online','src/social','src/profiles','src/platform/screens'].flatMap(walk).filter(file => /\.(?:js|jsx)$/.test(file))) {
    const source = readFileSync(file,'utf8');
    const matches = [...source.matchAll(/data-design-id=["']([^"']+)["']/g), ...source.matchAll(/["']data-design-id["']:\s*["']([^"']+)["']/g)];
    for (const [,id] of matches) { checked++; assert.ok(known.has(id), `${file}: ${id}`); }
  }
  assert.ok(checked >= 330, `Only ${checked} explicit semantic annotations`);
});

let directory;
let renderer;
// Keep asynchronous fixture creation in the runner lifecycle. Top-level await
// after registering tests allowed the file's after hook to delete this module
// before its dynamic import completed under concurrent test execution.
before(async () => {
mkdirSync(path.resolve('.cache'), { recursive: true });
directory = mkdtempSync(path.resolve('.cache/design-coverage-'));
await build({ stdin: { contents: `
import React from 'react';import{renderToStaticMarkup}from'react-dom/server';
import{DesignScene,createDesignGameApi}from'./src/design/preview-scenes.jsx';
import{PlatformContext}from'./src/platform/context.js';
export function renderScene(id){const api=createDesignGameApi(),previous=globalThis.location;globalThis.location={href:'https://preview.invalid/studio-preview.html',hash:''};try{return renderToStaticMarkup(<PlatformContext.Provider value={api}><DesignScene sceneId={id} platform={api}/></PlatformContext.Provider>);}finally{globalThis.location=previous;}}
`, resolveDir: process.cwd(), loader: 'jsx' }, outfile: path.join(directory, 'render.mjs'), bundle: true, platform: 'node', format: 'esm', packages: 'external', jsx: 'automatic', loader: { '.js':'jsx','.css':'text','.webp':'dataurl','.woff2':'dataurl' }, logLevel: 'silent' });
renderer = await import(pathToFileURL(path.join(directory, 'render.mjs')));
});
after(() => { if (directory) { assert.ok(directory.startsWith(path.resolve('.cache') + path.sep)); rmSync(directory, { recursive: true, force: true }); } });

test('actual local game components render every catalogued phase without bypassing production restore validation', () => {
  const scenes = DESIGN_SCENES.filter(scene => scene.renderer === 'local-game');
  assert.ok(scenes.length >= 35);
  for (const scene of scenes) {
    const html = renderer.renderScene(scene.id);
    assert.ok(html.length > 100, scene.id);
    assert.ok(html.includes(`data-design-screen="${scene.id}"`), scene.id);
    assert.doesNotMatch(html, /data-design-screen="unknown|generic-preview/);
  }
});

test('actual online match components render host/guesser/result phases with correct secret visibility', () => {
  const scenes = DESIGN_SCENES.filter(scene => scene.id.startsWith('online.meenfina.') || scene.id.startsWith('online.fabraka.') || scene.id.startsWith('online.badeeha.') || scene.game === 'ersomha');
  for (const scene of scenes) {
    const html = renderer.renderScene(scene.id);
    assert.ok(html.includes(`data-design-screen="${scene.id}"`), scene.id);
    if (scene.id === 'ersomha.draw.guesser') { assert.doesNotMatch(html, /قطار/); assert.match(html, /لوحة مباشرة/); }
    if (scene.id === 'ersomha.select.drawer') assert.match(html, /قطار/);
    if (scene.id === 'ersomha.private-wait') assert.match(html, /نكتم الميكروفون أولًا/);
    if (scene.id === 'online.badeeha.question') assert.doesNotMatch(html, /data-design-id="answer"|data-design-id="judge"/);
    if (scene.id === 'online.badeeha.reveal') assert.match(html, /data-design-id="answer"/);
  }
});

test('room chrome and team/player setup previews reuse production components with a semantic root', () => {
  for (const id of ['online.chrome','online.lobby','play-setup','play-setup.teams','setup.pass-phone']) {
    const html = renderer.renderScene(id);
    assert.match(html, new RegExp(`data-design-screen="${id.replaceAll('.', '\\.')}"`));
    assert.ok(html.includes('data-design-id='), id);
  }
});

test('registry exposes rendered semantic nodes or explicitly documented conditional controls', () => {
  for (const screen of DESIGN_SCREENS) {
    const observed = new Set(DESIGN_RENDERED_NODE_IDS[screen.id] || []);
    assert.ok(observed.size > 0, `${screen.id} needs an actual component fixture`);
    for (const node of screen.nodes) assert.ok(observed.has(node.id) || typeof node.coverageReason === 'string' && node.coverageReason.length > 35, `${screen.id}:${node.id} is an unused metadata stub`);
  }
  for (const game of ['beep','mamnoo','jabeen','meenfina','fabraka']) {
    const html = renderer.renderScene(`setup.${game}`);
    assert.ok(html.includes(`data-design-screen="setup.${game}"`), game);
    assert.ok(html.includes('data-design-id="segment-option"') || html.includes('data-design-id="setting-'), game);
  }
});


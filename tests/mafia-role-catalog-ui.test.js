import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { MAFIA_ROLES } from '../src/online/mafia-shared.js';
import { createDesignFixture } from '../src/design/screen-catalog.js';

let directory, render;
before(async () => {
  mkdirSync('.cache', { recursive: true }); directory = mkdtempSync(path.resolve('.cache/mafia-role-catalog-'));
  await build({ stdin: { contents: `import React from 'react';import{renderToStaticMarkup}from'react-dom/server';import{MafiaRules,MafiaMatch}from'./src/online/Mafia.jsx';const c={guide:MafiaRules,match:MafiaMatch};export const render=(name,p)=>renderToStaticMarkup(React.createElement(c[name],p)).replace(/<style>[\\s\\S]*?<\\/style>/g,'');`, resolveDir: process.cwd(), loader: 'jsx' }, outfile: path.join(directory, 'renderer.mjs'), bundle: true, platform: 'node', format: 'esm', packages: 'external', jsx: 'automatic', loader: { '.js': 'jsx', '.css': 'text', '.webp': 'dataurl', '.woff2': 'dataurl' }, logLevel: 'silent' });
  ({ render } = await import(pathToFileURL(path.join(directory, 'renderer.mjs'))));
});
after(() => { if (directory) { assert.ok(directory.startsWith(path.resolve('.cache') + path.sep)); rmSync(directory, { recursive: true, force: true }); } });
const props = () => { const { state, me } = createDesignFixture('online.mafia.night', { now: Date.now() }); return { state, me, isHost: true, act: () => true, accountId: 'owner' }; };

test('encyclopedia renders all twelve shared explanations without current resources or role assignments', () => {
  const html = render('guide', { defaultOpen: true, onTutorial: () => {} });
  assert.equal((html.match(/class="mafia-role-disclosure"/g) || []).length, 12);
  for (const role of Object.values(MAFIA_ROLES)) {
    assert.ok(html.includes(role.guide.timing), role.id);
    assert.ok(html.includes(role.guide.example), role.id);
  }
  assert.match(html, /وجود دور هنا لا يعني أنه موزّع/);
  assert.match(html, /انتماء البداية/);
  assert.match(html, /data-design-id="tutorial-start"/);
  assert.doesNotMatch(html, /المتبقي لك الآن|role-content|tokenHash|targetId/);
});

test('possible-role filtering displays possibilities rather than claiming an actual draw', () => {
  const html = render('guide', { defaultOpen: true, possibleRoles: ['investigator', 'doctor'] });
  assert.equal((html.match(/data-role-id=/g) || []).length, 2);
  assert.match(html, /data-role-id="investigator"/);
  assert.doesNotMatch(html, /data-role-id="leader"|data-role-id="masker"/);
  assert.match(render('guide', { possibleRoles: ['investigator'] }), /الأدوار الممكنة ودليل اللعب/);
});

test('private details and remaining uses mount only with the revealed owner card; current faction stays independent', () => {
  const value = props();
  value.state.you.faction = 'shadow'; value.state.you.resources.charges = 1;
  value.state.previewReveal = false;
  assert.doesNotMatch(render('match', value), /mafia-role-details|المتبقي لك الآن/);
  value.state.previewReveal = true;
  const html = render('match', value);
  assert.match(html, /انتماؤك الآن: رابطة الظل/);
  assert.match(html, /المتبقي لك الآن<\/dt><dd>١ استعمال/);
  assert.ok(html.includes(MAFIA_ROLES.investigator.guide.example));
  assert.match(html, /data-design-id="role-hide"/);
  assert.match(html, /class="mafia-role-details" dir="rtl"/);
});

test('guard uses its real shield resource and doctor shows remaining self protection', () => {
  const value = props(); value.state.previewReveal = true;
  Object.assign(value.state.you, { roleId: 'guard', resources: { charges: 1, shield: 0 } });
  assert.match(render('match', value), /المتبقي لك الآن<\/dt><dd>٠ درع/);
  Object.assign(value.state.you, { roleId: 'doctor', resources: { charges: null, selfProtection: 0 } });
  assert.match(render('match', value), /حماية نفسك المتبقية<\/dt><dd>٠/);
});

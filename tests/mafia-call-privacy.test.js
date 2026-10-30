import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const browserRequested = process.env.MAFIA_DOCK_BROWSER_TEST === '1';
let directory, render;
const component = "import React from 'react';import{CallControls}from'./src/social/CallDock.jsx';";
const fixture = {
  call: { id: 'fixture-call', scope: 'mafia', name: 'PRIVATE_COUNCIL_NAME', status: 'active' },
  currentUserId: 'fixture-owner',
  media: { userId: 'fixture-owner', connected: true, muted: true, participants: [
    { id: 'fixture-owner', name: 'ME', muted: true },
    { id: 'private-peer', name: 'PRIVATE_FACTION_MEMBER', muted: false, speaking: true },
  ] },
};
before(async () => {
  await mkdir('.cache', { recursive: true }); directory = await mkdtemp(path.resolve('.cache/mafia-call-privacy-'));
  await build({ stdin: { contents: component + "import{renderToStaticMarkup}from'react-dom/server';export const render=props=>renderToStaticMarkup(React.createElement(CallControls,props)).replace(/<style>[\\s\\S]*?<\\/style>/g,'');", resolveDir: process.cwd() },
    outfile: path.join(directory, 'render.mjs'), bundle: true, platform: 'node', format: 'esm', packages: 'external', jsx: 'automatic',
    loader: { '.js': 'jsx', '.css': 'text', '.webp': 'dataurl', '.woff2': 'dataurl' }, logLevel: 'silent' });
  ({ render } = await import(pathToFileURL(path.join(directory, 'render.mjs'))));
});
after(async () => {
  if (directory) { assert.ok(path.resolve(directory).startsWith(path.resolve('.cache') + path.sep)); await rm(directory, { recursive: true, force: true }); }
});
function withHidden(hidden, run) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { hidden } });
  try { return run(); } finally { if (descriptor) Object.defineProperty(globalThis, 'document', descriptor); else delete globalThis.document; }
}

test('hidden Mafia calls render no faction identity, count or interactive control outside the game cover', () => {
  const visible = withHidden(false, () => render(fixture));
  assert.match(visible, /PRIVATE_FACTION_MEMBER|private-peer/); assert.match(visible, /data-testid="call-dock-mute"/);
  const hidden = withHidden(true, () => render(fixture));
  assert.doesNotMatch(hidden, /PRIVATE_|private-peer|data-user-id|data-testid|<button|مشارك/);
  assert.match(hidden, /hidden=""/);
});
test('hidden Mafia inline portals stay unmounted and ordinary calls keep their existing behavior', () => {
  // This deliberately cannot be a portal container: the privacy guard must
  // prevent even creating the inline portal while the page is hidden.
  const hidden = withHidden(true, () => render({ ...fixture, panelOpen: true, inlineHost: {} }));
  assert.doesNotMatch(hidden, /PRIVATE_|private-peer|<button|data-user-id/);
  for (const scope of ['direct', 'group']) {
    const html = withHidden(true, () => render({ ...fixture, call: { ...fixture.call, scope } }));
    assert.match(html, /private-peer/); assert.match(html, /data-testid="call-dock-mute"/);
  }
});

// Explicit browser lane: runs the actual component/portals and lifecycle on a
// locally installed Playwright browser. The normal Node suite keeps the two
// rendered checks above and does not require downloading a browser on CI.
if (browserRequested) test('browser lifecycle hides every Mafia portal synchronously and restores dock/dialog state without audio actions', async () => {
  const { chromium } = await import('playwright');
  const browserFile = path.join(directory, 'browser.js');
  await build({ stdin: { contents: component + `import{createRoot}from'react-dom/client';import{flushSync}from'react-dom';
    const root=createRoot(document.getElementById('root'));const base=${JSON.stringify(fixture)};
    window.actions=[];window.__privacyHidden=false;Object.defineProperty(document,'hidden',{configurable:true,get:()=>window.__privacyHidden});
    window.draw=(scope='mafia',panelOpen=false)=>flushSync(()=>root.render(React.createElement(CallControls,{...base,call:{...base.call,scope},panelOpen,inlineHost:document.getElementById('inline'),onMute:()=>window.actions.push('mute'),onEnd:()=>window.actions.push('end'),onOutput:()=>window.actions.push('output'),onResume:()=>window.actions.push('resume'),onOpen:()=>window.actions.push('open')})));
    window.lifecycle=(hidden,event='visibilitychange')=>{window.__privacyHidden=hidden;(event==='visibilitychange'?document:window).dispatchEvent(new Event(event));return{identities:document.querySelectorAll('[data-user-id]').length,dialogs:document.querySelectorAll('[data-testid="call-controls-dialog"]').length,inline:document.querySelectorAll('[data-testid="call-inline-controls"]').length,controls:document.querySelectorAll('[data-testid="call-dock"]').length,privateText:document.body.innerText.includes('PRIVATE_')};};window.draw();`, resolveDir: process.cwd() },
    outfile: browserFile, bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic',
    loader: { '.js': 'jsx', '.css': 'text', '.webp': 'dataurl', '.woff2': 'dataurl' }, logLevel: 'silent' });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => route.abort());
    await page.setContent('<!doctype html><html><body><div id="root"></div><div id="inline"></div></body></html>');
    await page.addScriptTag({ content: await readFile(browserFile, 'utf8') });
    await page.getByTestId('call-dock-drag').press('ArrowDown');
    const position = await page.getByTestId('call-dock').evaluate(node => [node.dataset.positionX, node.dataset.positionY]);
    await page.getByTestId('call-dock-participant').first().click();
    await page.getByTestId('call-controls-dialog').waitFor();
    const covered = { identities: 0, dialogs: 0, inline: 0, controls: 0, privateText: false };
    assert.deepEqual(await page.evaluate(() => window.lifecycle(true)), covered);
    const restored = await page.evaluate(() => window.lifecycle(false));
    assert.equal(restored.dialogs, 1); assert.ok(restored.identities >= 2);
    assert.deepEqual(await page.getByTestId('call-dock').evaluate(node => [node.dataset.positionX, node.dataset.positionY]), position);
    // pagehide can arrive while document.hidden is still false.
    assert.deepEqual(await page.evaluate(() => window.lifecycle(false, 'pagehide')), covered);
    assert.equal((await page.evaluate(() => window.lifecycle(false, 'pageshow'))).dialogs, 1);
    await page.getByRole('button', { name: 'إغلاق', exact: true }).click();
    await page.getByTestId('call-controls-dialog').waitFor({ state: 'detached' });
    await page.evaluate(() => window.draw('mafia', true));
    assert.equal(await page.getByTestId('call-inline-controls').count(), 1);
    assert.deepEqual(await page.evaluate(() => window.lifecycle(true)), covered);
    assert.equal((await page.evaluate(() => window.lifecycle(false))).inline, 1);
    await page.evaluate(() => window.draw('group', false));
    assert.ok((await page.evaluate(() => window.lifecycle(true))).identities >= 2);
    assert.deepEqual(await page.evaluate(() => window.actions), []);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

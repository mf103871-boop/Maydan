// Real conversation and score components. Local peers supply incoming fixture messages.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';
import { chromium, webkit } from 'playwright';

const entry = `
  import React, { useState } from 'react';
  import { createRoot } from 'react-dom/client';
  import { Conversation } from './src/social/SocialScreen.jsx';
  import { CountUp } from './src/shared/ui/components.jsx';
  import { PlatformContext } from './src/platform/context.js';
  import { setUiLocale } from './src/shared/i18n/core.js';
  import tokens from './src/shared/theme/tokens.css';
  import ui from './src/shared/ui/ui.css';
  import socialStyles from './src/social/social.css';
  const params = new URLSearchParams(location.search);
  document.documentElement.dataset.reducedMotion = String(params.get('app') === 'true');
  await setUiLocale(params.get('locale'));
  const friend = { id: 'friend', conversationId: 'direct-chat', name: 'Sam' };
  const group = params.get('locale') === 'ar';
  const fades = [];
  document.addEventListener('animationstart', event => {
    if (event.animationName === 'social-message-arrival') fades.push({ key: event.target.closest('[data-message-key]').dataset.messageKey, duration: getComputedStyle(event.target).animationDuration });
  });
  const sent = [];
  const social = {
    openConversation() {}, markRead() {}, setTyping() {},
    sendMessage(id, value) { sent.push(value); }, offline: false,
  };
  const message = seq => ({ seq, clientId: 'm' + seq, senderId: friend.id, text: 'Sam ' + seq, createdAt: 1760000000000 + seq });
  function Fixture() {
    const [messages, setMessages] = useState(() => Array.from({ length: 70 }, (_, i) => message(i + 1)));
    const [score, setScore] = useState(false);
    window.testPeer = { sent, fades, arrive: () => {
      const seq = messages.length + 1;
      // Fixture starts at the client event boundary. History updates below
      // contain the same message again and deliberately have no new receipt.
      const detail = group ? { type: 'group', groupId: friend.id } : { type: 'message', conversationId: friend.conversationId };
      window.dispatchEvent(new CustomEvent('maydan-social-event', { detail: { ...detail, reason: 'message', messageSeq: seq, liveArrival: true } }));
      setMessages(old => [...old, message(seq)]);
    }, history: () => setMessages(old => [message(0), ...old.map(m => ({ ...m }))]), result: () => setScore(true) };
    return <PlatformContext.Provider value={{ settings: {}, sound: {}, haptics: {} }}>
      <style>{tokens + ui + socialStyles}</style>
      <style>{'html,body,#root{margin:0;height:100%;overflow:hidden}.social-chat{height:100dvh;max-height:100dvh}.social-message-scroll{overflow-anchor:none}'}</style>
      {score ? <CountUp value={900} duration={4500} /> : <Conversation friend={friend} conversation={{ messages, group }} social={social} account={{ user: { id: 'me', name: 'Me' } }} notify={() => {}} />}
    </PlatformContext.Provider>;
  }
  createRoot(document.querySelector('#root')).render(<Fixture/>);
`;
const result = await build({ stdin: { contents: entry, resolveDir: process.cwd(), loader: 'jsx' }, bundle: true, write: false, format: 'esm', jsx: 'automatic', loader: { '.css': 'text', '.webp': 'dataurl', '.woff2': 'dataurl' }, logLevel: 'silent' });
const code = result.outputFiles[0].text;
const html = '<!doctype html><html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/fixture.js"></script></html>';
const server = createServer((req, res) => {
  const script = req.url === '/fixture.js';
  res.setHeader('Content-Type', script ? 'text/javascript' : 'text/html;charset=utf-8');
  res.end(script ? code : html);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + server.address().port;
const out = process.env.E2E_OUTPUT_DIR || '.cache/reduced-interactions';
await mkdir(out, { recursive: true });
const rows = [];
const fullMatrix = process.env.E2E_ALL_VIEWPORTS === '1';
const configurations = [];
for (const mode of ['app', 'os', 'normal']) {
  for (const locale of fullMatrix ? ['ar', 'en'] : [mode === 'app' ? 'ar' : 'en']) {
    for (const width of fullMatrix ? [360, 390, 430] : [390]) configurations.push({ mode, locale, width });
  }
}
// Read every original computed size before writing any of the enlarged sizes,
// so a parent and child that both contain text are not enlarged fourfold.
function enableLargeText() {
  const saved = new Map();
  function measure() {
    for (const [el, style] of saved) {
      if (style === null) el.removeAttribute('style');
      else el.setAttribute('style', style);
    }
    saved.clear();
    const nodes = [...document.querySelectorAll('#root *')].filter(el => el instanceof HTMLElement &&
      (el.matches('textarea,input,select') || [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())));
    const sizes = nodes.map(el => [el, parseFloat(getComputedStyle(el).fontSize), parseFloat(getComputedStyle(el).lineHeight)]);
    for (const [el, font, line] of sizes) {
      saved.set(el, el.getAttribute('style'));
      el.style.setProperty('font-size', font * 2 + 'px', 'important');
      if (Number.isFinite(line)) el.style.setProperty('line-height', line * 2 + 'px', 'important');
      el.dataset.testBaseFont = String(font);
    }
  }
  measure();
  window.refreshAuditText = measure;
}
try {
  for (const [engine, type] of Object.entries({ webkit, chromium })) {
    const browser = await type.launch();
    try {
      for (const { mode, locale, width } of configurations) {
        const capture = process.env.E2E_RECORD === '1' && width === 390 && engine === 'webkit';
        const page = await browser.newPage({ viewport: { width, height: 844 }, reducedMotion: mode === 'os' ? 'reduce' : 'no-preference',
          ...(capture ? { recordVideo: { dir: out, size: { width, height: 844 } } } : {}) });
        const errors = [];
        page.on('pageerror', e => errors.push(e.message));
        await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
        try {
          await page.goto(origin + '/?app=' + (mode === 'app') + '&locale=' + locale);
          const scroller = page.locator('.social-message-scroll');
          await page.locator('[data-message-key]').first().waitFor();
          if (fullMatrix) await page.evaluate(enableLargeText);
          if (fullMatrix) await page.waitForFunction(() => {
            const el = document.querySelector('textarea');
            return el && parseFloat(getComputedStyle(el).fontSize) === Number(el.dataset.testBaseFont) * 2;
          }, null, { timeout: 2500 }).catch(async () => {
            throw new Error('Actual text enlargement failed ' + JSON.stringify(await page.locator('textarea').evaluate(el => ({ inline: el.style.cssText, base: el.dataset.testBaseFont, actual: getComputedStyle(el).fontSize }))));
          });
          const textRatio = await page.locator('textarea').evaluate(el => parseFloat(getComputedStyle(el).fontSize) / Number(el.dataset.testBaseFont || getComputedStyle(el).fontSize.replace('px', '')));
          await scroller.evaluate(el => {
            el.scrollTop = 100;
            el.dispatchEvent(new Event('scroll'));
            const nativeScrollTo = el.scrollTo.bind(el);
            el.scrollTo = options => { window.requestedScroll = options.behavior; nativeScrollTo(options); };
          });
          await page.evaluate(() => window.testPeer.arrive());
          if (fullMatrix) {
            await page.locator('[data-design-id="new-messages"]').waitFor();
            await page.evaluate(() => window.refreshAuditText());
          }
          await page.locator('[data-design-id="new-messages"]').click();
          const requestedScroll = await page.evaluate(() => window.requestedScroll);
          await page.waitForFunction(() => {
            const el = document.querySelector('.social-message-scroll');
            return el.scrollHeight - el.scrollTop - el.clientHeight < 2;
          });
          await page.evaluate(() => window.testPeer.history());
          await page.locator('textarea').fill('Sam');
          const send = page.locator('.social-send');
          const rect = await send.boundingBox();
          await page.mouse.move(rect.x + 7, rect.y + rect.height / 2);
          await page.mouse.down();
          await page.waitForTimeout(200);
          const held = await send.evaluate(el => ({ transform: getComputedStyle(el).transform, active: el.matches(':active') }));
          await page.mouse.up();
          await page.waitForFunction(() => window.testPeer.sent.length === 1);
          await page.evaluate(() => window.testPeer.result());
          const count = page.locator('.count-up');
          await count.waitFor();
          if (fullMatrix) await page.evaluate(() => window.refreshAuditText());
          let middle;
          if (mode === 'normal') {
            await page.waitForFunction(() => Number(document.querySelector('.count-up').textContent) > 0);
            middle = Number(await count.textContent());
            await page.emulateMedia({ reducedMotion: 'reduce' });
            await page.waitForTimeout(120);
          }
          const score = Number(await count.textContent());
          const fades = await page.evaluate(() => window.testPeer.fades);
          rows.push({ engine, width, locale, mode, textRatio, requestedScroll, held, middle, score, fades, errors });
        } finally {
          const video = page.video();
          await page.close();
          if (video) { await video.saveAs(path.join(out, engine + '-' + locale + '-' + width + '-' + mode + '.webm')); await video.delete(); }
        }
      }
    } finally { await browser.close(); }
  }
} finally {
  await writeFile(path.join(out, 'interaction-results.json'), JSON.stringify(rows, null, 2));
  await new Promise(resolve => server.close(resolve));
}
for (const row of rows) {
  assert.deepEqual(row.errors, []);
  assert.equal(row.textRatio, fullMatrix ? 2 : 1);
  assert.equal(row.held.active, true);
  assert.equal(row.requestedScroll === 'smooth', row.mode === 'normal', JSON.stringify(row));
  assert.equal(row.held.transform === 'none', row.mode !== 'normal', JSON.stringify(row));
  if (row.mode === 'normal') assert.ok(row.middle > 0 && row.middle < 900);
  assert.equal(row.score, 900, JSON.stringify(row));
  assert.deepEqual(row.fades, row.mode === 'normal' ? [{ key: 'message-71', duration: '0.14s' }] : []);
}
console.log('Passed all', rows.length, 'conversation, press and live score motion cases.');

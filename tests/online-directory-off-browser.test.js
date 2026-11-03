import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { build } from 'esbuild';
import { chromium, webkit } from 'playwright';
import { startLocalServer } from '../server/local.mjs';
import { createUser } from '../server/accounts/db.mjs';
import { issueSession } from '../server/accounts/session.mjs';
import { ONLINE_GAMES } from '../src/online/shared.js';

// The public list is switched off on servers without ONLINE_PUBLIC_DIRECTORY_ENABLED
// (the preview and production today). A member's list read says so, and Online
// then opens on the room form instead of a list that says it is unavailable.
// Guests never read the list; they keep the sign-in notice beside create/code.
for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]]) test(`${name}: a switched-off public list opens Online on the room form for members`, { timeout: 60_000 }, async t => {
  let bytes;
  const html = '<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body><div id="root"></div><script src="/bundle.js"></script></body></html>';
  const front = http.createServer((req, res) => { res.setHeader('content-type', req.url === '/bundle.js' ? 'text/javascript' : 'text/html;charset=utf-8'); res.end(req.url === '/bundle.js' ? bytes : html); });
  await new Promise(resolve => front.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${front.address().port}`;
  t.after(() => new Promise(resolve => { front.closeAllConnections(); front.close(resolve); }));
  const app = await startLocalServer({ port: 0, origins: origin, vars: {} });
  t.after(() => app.close());
  const user = await createUser(app.env, { name: 'عضو محلي', email: `${crypto.randomUUID()}@example.test` });
  const actor = { user, token: (await issueSession(app.env, user.id)).token };
  const source = `import React,{useState}from'react';import{createRoot}from'react-dom/client';import{Entry}from'./src/online/Online.jsx';import{AccountContext,NULL_ACCOUNT}from'./src/shared/account/context.js';import{PlatformContext}from'./src/platform/context.js';import tokens from'./src/shared/theme/tokens.css';import ui from'./src/shared/ui/ui.css';import onlineCSS from'./src/online/online.css';
    const actor=${JSON.stringify(actor)},noop=()=>{};
    function App(){const[game,setGame]=useState('badeeha'),[member,setMember]=useState(true);window.show=(next,signedIn)=>{setGame(next);setMember(signedIn);};
      const account=member?{...NULL_ACCOUNT,ready:true,signedIn:true,user:actor.user,authHeaders:()=>({Authorization:'Bearer '+actor.token})}:{...NULL_ACCOUNT,ready:true};
      return <AccountContext.Provider value={account}><PlatformContext.Provider value={{sound:{play:noop,music:{scene:noop,releaseScene:noop}},toast:noop,haptics:{vibrate:noop}}}><style>{tokens+ui+onlineCSS}</style><main><Entry key={game+':'+member} initialGame={game} onJoined={noop}/></main></PlatformContext.Provider></AccountContext.Provider>;}
    createRoot(document.getElementById('root')).render(<App/>);`;
  const built = await build({ stdin: { contents: source, resolveDir: process.cwd(), loader: 'jsx' }, bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.css': 'text', '.webp': 'dataurl', '.woff2': 'dataurl' }, define: { __MAYDAN_ROOMS_URL__: JSON.stringify(app.url), __MAYDAN_AUDIO_PREVIEW__: 'false' }, logLevel: 'silent' });
  bytes = built.outputFiles[0].contents;
  const browser = await engine.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } }), errors = [], external = [], listReads = [], listAnswers = {};
  page.on('pageerror', error => errors.push(error.message));
  page.on('requestfinished', request => {
    const url = new URL(request.url());
    if (url.pathname === '/api/online/rooms/public') listAnswers[url.searchParams.get('game')] = (listAnswers[url.searchParams.get('game')] || 0) + 1;
  });
  // Records whether the list tab is ever in the document, not only at assertion time.
  await page.addInitScript(() => {
    window.tabSeen = false;
    new MutationObserver(() => { if (document.querySelector('[data-design-id="entry-public"]')) window.tabSeen = true; })
      .observe(document, { childList: true, subtree: true });
  });
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/online/rooms/public') listReads.push({ game: url.searchParams.get('game'), signedIn: Boolean(route.request().headers().authorization) });
    if ([origin, app.url].includes(url.origin)) return route.continue();
    external.push(url.href); return route.abort();
  });
  await page.goto(origin);
  // Loading the bundle can finish before React first renders App and exposes this fixture API.
  await page.waitForFunction(() => typeof window.show === 'function');
  for (const game of ['badeeha', 'fabraka', 'meenfina', 'ersomha']) {
    await page.evaluate(() => { window.tabSeen = false; });
    await page.evaluate(next => window.show(next, true), game);
    // Wait for this game's own room form, not the previous game's still-mounted one.
    await page.locator('.online-public-create h2', { hasText: ONLINE_GAMES[game].name }).waitFor();
    await page.locator('[data-design-id="entry-create"][aria-pressed="true"]').waitFor();
    // The member's list is read again after the switch to the form. The tab
    // must stay hidden throughout that read, not just once it settles.
    for (let n = 0; n < 300 && (listAnswers[game] || 0) < 2; n++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.ok((listAnswers[game] || 0) >= 2, `${game}: the list was read again after the switch`);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await page.evaluate(() => window.tabSeen), false, `${game}: the list tab never flashed back`);
    assert.equal(await page.locator('form[data-design-id="entry"]').count(), 1, `${game}: the room form opens`);
    assert.equal(await page.getByText('دليل الغرف غير متاح حاليًا').count(), 0, `${game}: no unavailable list is the first view`);
    assert.equal(await page.locator('[data-design-id="entry-public"]').count(), 0, `${game}: no tab leads to the switched-off list`);
    assert.equal(await page.locator('[data-design-id="room-visibility"] option[value="public"]').evaluate(option => option.disabled), true, `${game}: a public room cannot be chosen`);
    assert.ok(listReads.some(read => read.game === game && read.signedIn), `${game}: the member's list read reported the list off`);
  }
  // A guest is not switched: no list read happens, and the notice still offers create and code.
  const before = listReads.length;
  await page.evaluate(() => window.show('fabraka', false));
  await page.getByText('سجّل الدخول لرؤية الغرف العامة').waitFor();
  assert.equal(await page.locator('[data-design-id="create-public-room"]').count(), 1);
  assert.equal(listReads.length, before, 'guests never read the list');
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
});

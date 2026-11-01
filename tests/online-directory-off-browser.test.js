import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { build } from 'esbuild';
import { chromium, webkit } from 'playwright';
import { startLocalServer } from '../server/local.mjs';
import { createUser } from '../server/accounts/db.mjs';
import { issueSession } from '../server/accounts/session.mjs';

// The public list is switched off on servers without ONLINE_PUBLIC_DIRECTORY_ENABLED
// (the preview and production today). Online must then open on the room form,
// signed in or not, instead of a list that says it is unavailable.
for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]]) test(`${name}: a switched-off public list opens Online on the room form for members and guests`, { timeout: 60_000 }, async t => {
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
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } }), errors = [], external = [], listReads = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/online/rooms/public') listReads.push({ game: url.searchParams.get('game'), signedIn: Boolean(route.request().headers().authorization) });
    if ([origin, app.url].includes(url.origin)) return route.continue();
    external.push(url.href); return route.abort();
  });
  await page.goto(origin);
  for (const [game, signedIn] of [['badeeha', true], ['fabraka', false], ['meenfina', true], ['ersomha', false]]) {
    await page.evaluate(([next, member]) => window.show(next, member), [game, signedIn]);
    await page.locator('[data-design-id="entry-create"][aria-pressed="true"]').waitFor();
    assert.equal(await page.locator('form[data-design-id="entry"]').count(), 1, `${game}: the room form opens`);
    assert.equal(await page.getByText('دليل الغرف غير متاح حاليًا').count(), 0, `${game}: no unavailable list is the first view`);
    assert.equal(await page.getByText('سجّل الدخول لرؤية الغرف العامة').count(), 0, `${game}: guests are not asked to sign in for a switched-off list`);
    assert.equal(await page.locator('[data-design-id="entry-public"]').count(), 0, `${game}: no tab leads to the switched-off list`);
    assert.equal(await page.locator('[data-design-id="room-visibility"] option[value="public"]').evaluate(option => option.disabled), true, `${game}: a public room cannot be chosen`);
    assert.ok(listReads.some(read => read.game === game && read.signedIn === signedIn), `${game}: the server was asked, ${signedIn ? 'signed in' : 'signed out'}`);
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
});

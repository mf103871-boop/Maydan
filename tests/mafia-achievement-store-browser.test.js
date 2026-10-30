// Actual Store + usePlusResource + authenticated local API. Synthetic account,
// no subscription, no mocked license endpoint and no live billing/provider calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';
import { chromium, webkit } from 'playwright';
import { startLocalServer } from '../server/local.mjs';
import { createUser } from '../server/accounts/db.mjs';
import { issueSession } from '../server/accounts/session.mjs';
import { persistMafiaProgress } from '../server/mafia-progression.mjs';
import { cosmeticsFor } from '../server/plus/access.mjs';

test('Chromium and WebKit: real authenticated Store equips an earned item without Plus or a billing call', { timeout: 60_000 }, async () => {
  const app = await startLocalServer({ port: 0, vars: { MAFIA_ENABLED: '1', MAFIA_PROGRESS_ENABLED: '1' } });
  let server;
  try {
    const user = await createUser(app.env, { name: 'اختبار متجر المكتسبات' }), session = await issueSession(app.env, user.id), finishedAt = Date.now() - 31_000;
    await persistMafiaProgress(app.env, { eventSchemaVersion: 1, eventKind: 'match_completed', source: 'live', rewardPolicyVersion: 1,
      key: `store:${crypto.randomUUID()}`, eventId: `online:${crypto.randomUUID()}`, rulesetVersion: 1,
      startedAt: finishedAt - 200_000, finishedAt, notBefore: finishedAt + 30_000, mode: 'classic', capacity: 6, participantCount: 6, visibility: 'public', draw: false,
      results: [{ userId: user.id, roleId: 'citizen', initialFaction: 'town', faction: 'town', won: false, forfeited: false, eliminatedAt: null }] });
    const entry = `import React from'react';import{createRoot}from'react-dom/client';
      import{Store}from'./src/platform/screens/Store.jsx';import{AccountContext,NULL_ACCOUNT}from'./src/shared/account/context.js';
      import{ProfileContext}from'./src/profiles/ProfileProvider.jsx';import{request}from'./src/shared/account/api.js';
      import tokens from'./src/shared/theme/tokens.css';import ui from'./src/shared/ui/ui.css';import platform from'./src/platform/platform.css';
      window.paywalls=[];const account={...NULL_ACCOUNT,ready:true,signedIn:true,premium:false,user:${JSON.stringify({ id: user.id, name: user.name })},
        requestAuthenticated:(url,options={})=>request(url,{...options,server:${JSON.stringify(app.url)},token:${JSON.stringify(session.token)}}),
        openPaywall:options=>window.paywalls.push(options),refresh:async()=>null};
      const profiles={mine:{...account.user,avatarPreset:'spark'},loadProfile:async()=>null};
      createRoot(document.getElementById('root')).render(<AccountContext.Provider value={account}><ProfileContext.Provider value={profiles}><style>{tokens+ui+platform}</style><Store/></ProfileContext.Provider></AccountContext.Provider>);`;
    const built = await build({ stdin: { contents: entry, resolveDir: process.cwd(), loader: 'jsx' }, bundle: true, write: false, format: 'iife', jsx: 'automatic',
      loader: { '.js': 'jsx', '.css': 'text', '.webp': 'dataurl', '.png': 'dataurl', '.woff2': 'dataurl' },
      define: { __MAYDAN_ROOMS_URL__: JSON.stringify(app.url), 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent' });
    const html = '<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body><div id="root"></div><script src="/bundle.js"></script></body></html>';
    const publicRoot = path.resolve('public');
    server = createServer(async (req, res) => {
      if (req.url === '/bundle.js') { res.setHeader('content-type', 'text/javascript'); res.end(built.outputFiles[0].contents); return; }
      if (req.url?.startsWith('/assets/plus/v1/')) {
        const filename = path.resolve(publicRoot, '.' + req.url);
        if (filename.startsWith(publicRoot + path.sep)) { try { res.setHeader('content-type', req.url.endsWith('.svg') ? 'image/svg+xml' : 'image/webp'); res.end(await readFile(filename)); return; } catch { res.writeHead(404); res.end(); return; } }
      }
      res.setHeader('content-type', 'text/html'); res.end(html);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`; app.env.ALLOWED_ORIGINS = origin;
    const proof = path.resolve('.cache/mafia-achievement-store-proof'); await mkdir(proof, { recursive: true });
    for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]]) {
      await app.env.DB.prepare('DELETE FROM plus_cosmetics WHERE user_id=?').bind(user.id).run();
      const browser = await engine.launch({ headless: true });
      try {
        const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
        const errors = [], writes = [], external = [];
        page.on('pageerror', error => errors.push(error.message));
        page.on('request', req => { if (req.url() === app.url + '/api/me/cosmetics' && req.method() === 'PATCH') writes.push(req.postDataJSON()); });
        await page.route('**/*', async route => {
          const url = new URL(route.request().url());
          if (![origin, app.url].includes(url.origin)) { external.push(url.origin + url.pathname); await route.abort(); return; }
          await route.continue();
        });
        await page.goto(origin);
        const inventory = page.locator('[data-design-id="earned-cosmetics"]'); await inventory.waitFor();
        assert.match(await inventory.innerText(), /إنجاز مافيا: أول مباراة/);
        assert.doesNotMatch(await inventory.innerText(), /noir\.frame|mafia_first_qualified/);
        for (const [width, height] of [[320, 568], [390, 844], [844, 390]]) {
          await page.setViewportSize({ width, height });
          assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${name} ${width}: overflow`);
          await inventory.screenshot({ path: path.join(proof, `${name}-${width}.png`) });
        }
        await inventory.getByRole('button', { name: 'استخدام المكتسب', exact: true }).click();
        await inventory.getByRole('button', { name: 'مستخدم الآن', exact: true }).waitFor();
        assert.deepEqual(writes, [{ selection: { frameId: 'noir.frame' }, revision: 0 }]);
        assert.equal((await cosmeticsFor(app.env, user.id)).effective.frameId, 'noir.frame');
        assert.equal((await app.env.DB.prepare('SELECT COUNT(*) n FROM subscriptions').first()).n, 0);
        assert.deepEqual(await page.evaluate(() => window.paywalls), []);
        assert.deepEqual(external, []); assert.deepEqual(errors, []); await page.close();
      } finally { await browser.close(); }
    }
  } finally {
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    await app.close();
  }
});

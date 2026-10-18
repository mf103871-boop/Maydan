// Current social/game UI against real local workerd + D1 + room WebSockets.
// Only LiveKit's external media transport is a fixture; it sends no real audio.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium, webkit } from 'playwright';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { migrationSql } from '../../server/local-d1.mjs';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import questions from '../../src/data/games/fabraka/questions.json' with { type: 'json' };

const dir = await mkdtemp(path.join(os.tmpdir(), 'maydan-social-launch-'));
const out = process.env.E2E_OUTPUT_DIR || '.cache/social-online-launch'; await mkdir(out, { recursive: true });
let bundle = '', mf; const inputs = new Map(); const requests = [];
const front = http.createServer((req, res) => {
  const input = inputs.get(new URL(req.url, 'http://fixture').searchParams.get('user'));
  res.writeHead(200, { 'content-type': 'text/html;charset=utf-8' });
  res.end(`<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script>window.fixtureInput=${JSON.stringify(input)};</script><script>${bundle}</script></html>`);
});
await new Promise(resolve => front.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${front.address().port}`;
const result = { scope: 'Real SocialHost/LammaProvider/Online UI, workerd/D1/social APIs/room WebSockets; external LiveKit media transport only is simulated, no production writes', engines: [] };
try {
  const scriptPath = path.join(dir, 'worker.mjs');
  await build({ entryPoints: ['server/worker.mjs'], outfile: scriptPath, bundle: true, format: 'esm', platform: 'browser', logLevel: 'silent' });
  mf = new Miniflare(convertV4MiniflareOptions({ rootPath: dir, name: 'social-launch', modules: true, scriptPath,
    compatibilityDate: '2026-09-01', durableObjects: { ROOMS: { className: 'Room', useSQLite: true }, LIMITERS: { className: 'RequestLimiter', useSQLite: true }, SOCIAL_HUB: { className: 'SocialHub', useSQLite: true } },
    d1Databases: { DB: 'social-launch-db' }, bindings: { ALLOWED_ORIGINS: origin, APP_ORIGIN: origin, AUTH_DEV_FAKE: '1', SESSION_SECRET: 'local-launch-test-secret', LIVEKIT_URL: 'wss://fixture.livekit.cloud', LIVEKIT_API_KEY: 'fixture-key', LIVEKIT_API_SECRET: 'fixture-secret' },
    outboundService: async request => { requests.push({ provider: new URL(request.url).hostname, path: new URL(request.url).pathname }); assert.equal(new URL(request.url).hostname, 'fixture.livekit.cloud'); return Response.json({}); },
    host: '127.0.0.1', port: 0, cf: false }));
  const apiOrigin = (await mf.ready).origin, DB = await mf.getD1Database('DB'); await DB.exec(migrationSql());
  const api = async (user, endpoint, method = 'GET', body) => {
    const response = await fetch(apiOrigin + endpoint, { method, headers: { origin, ...(user ? { authorization: `Bearer ${user.token}` } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const data = await response.json(); assert.ok(response.ok, `${endpoint}: ${response.status} ${JSON.stringify(data)}`); return data;
  };
  const fixtureSource = `
import React from 'react';import{createRoot}from'react-dom/client';
import{AccountContext,NULL_ACCOUNT}from'./src/shared/account/context.js';import{PlatformContext}from'./src/platform/context.js';
import{SocialProvider,useSocial}from'./src/social/SocialProvider.jsx';import{LammaProvider,useLamma}from'./src/social/LammaProvider.jsx';import{SocialUIProvider,useSocialUI}from'./src/social/SocialUIProvider.jsx';import{ProfileProvider}from'./src/profiles/ProfileProvider.jsx';import{SocialHost}from'./src/social/SocialHost.jsx';import{useRoute,navigate}from'./src/platform/router.js';import{Online}from'./src/online/Online.jsx';
import{BrandFonts}from'./src/shared/brand/art.jsx';import tokens from'./src/shared/theme/tokens.css';import uiCss from'./src/shared/ui/ui.css';import brand from'./src/shared/brand/brand.css';import platformCss from'./src/platform/platform.css';import onlineCss from'./src/online/online.css';
const input=window.fixtureInput;const request=async(p,o={})=>{const r=await fetch(input.api+p,{method:o.method||'GET',headers:{authorization:'Bearer '+input.token,'content-type':'application/json'},body:o.body===undefined?undefined:JSON.stringify(o.body)});if(o.raw)return r;const d=await r.json();if(!r.ok)throw Object.assign(new Error(d.error),{code:d.error});return d;};
class Room{constructor(){this.remoteParticipants=new Map([[input.other.id,{identity:input.other.id,name:input.other.name,isSpeaking:false,isMicrophoneEnabled:true}]]);this.localParticipant={identity:input.user.id,name:input.user.name,isSpeaking:false,isMicrophoneEnabled:false,setMicrophoneEnabled:async enabled=>{this.localParticipant.isMicrophoneEnabled=enabled;}};}on(){return this;}async connect(){window.mediaConnections=(window.mediaConnections||0)+1;}async disconnect(){window.mediaDisconnects=(window.mediaDisconnects||0)+1;}async startAudio(){}}
window.fixtureSDK={Room,RoomEvent:Object.fromEntries(['ParticipantConnected','ParticipantDisconnected','ActiveSpeakersChanged','TrackMuted','TrackUnmuted','LocalTrackPublished','LocalTrackUnpublished','TrackSubscribed','TrackUnsubscribed','Reconnecting','Reconnected','Disconnected'].map(x=>[x,x])),Track:{Kind:{Audio:'audio'}}};
const account={...NULL_ACCOUNT,ready:true,signedIn:true,user:input.user,requestAuthenticated:request,authHeaders:()=>({Authorization:'Bearer '+input.token}),gameAccess:()=> 'trial',markTrial:()=>{window.markedTrials=(window.markedTrials||0)+1;},refresh:async()=>{},openPaywall:()=>{throw new Error('unexpected paywall')}};
const platform={sound:{play(){},setDucking(){}},toast(){},haptics:{vibrate(){}},confetti:{fire(){}},settings:{reducedMotion:true},roster:[],storage:{get(){},set(){}}};
function Screen(){const route=useRoute(),lamma=useLamma(),social=useSocial(),ui=useSocialUI();window.fixture={refresh:async()=>{await social.refresh({quiet:true});await lamma.refreshGroups({quiet:true});await lamma.loadGroup(input.group);},call:()=>({id:lamma.activeCall?.id,connected:lamma.media.connected,connections:window.mediaConnections||0,disconnects:window.mediaDisconnects||0}),navigate,group:()=>ui.openGroup(input.group)};return route.name==='room'?<Online key={route.params.id} code={route.params.id}/>:<main><div data-social-page-slot/></main>}
createRoot(document.getElementById('root')).render(<AccountContext.Provider value={account}><PlatformContext.Provider value={platform}><BrandFonts/><style>{tokens}</style><style>{uiCss}</style><style>{brand}</style><style>{platformCss}</style><style>{onlineCss}</style><SocialProvider><LammaProvider><SocialUIProvider><ProfileProvider><Screen/><SocialHost/></ProfileProvider></SocialUIProvider></LammaProvider></SocialProvider></PlatformContext.Provider></AccountContext.Provider>);`;
  const built = await build({ stdin: { contents: fixtureSource, resolveDir: process.cwd(), loader: 'jsx' }, bundle: true, write: false, format: 'iife', jsx: 'automatic', define: { __MAYDAN_ROOMS_URL__: JSON.stringify(apiOrigin) }, loader: { '.css': 'text', '.webp': 'dataurl', '.woff2': 'dataurl' }, logLevel: 'silent', plugins: [{ name: 'local-media-transport-only', setup(build) { build.onLoad({ filter: /[\\/]src[\\/]social[\\/]media\.js$/ }, async args => ({ contents: (await readFile(args.path, 'utf8')).replace('this.loadSDK = loadSDK;', 'this.loadSDK = () => Promise.resolve(window.fixtureSDK);'), loader: 'js' })); } }] });
  bundle = built.outputFiles[0].text;
  for (const [engineName, engine] of [['chromium', chromium], ['webkit', webkit]]) {
    const users = [];
    for (const [index, name] of ['عمر', 'ليان'].entries()) { const signed = await api(null, '/api/auth/dev', 'POST', { subject: `launch-${engineName}-${index}`, name }); users.push({ ...signed.me.user, token: signed.session.token }); }
    const friend = await api(users[0], '/api/social/requests', 'POST', { userId: users[1].id });
    await api(users[1], `/api/social/requests/${friend.request.id}/accept`, 'POST', {});
    const group = (await api(users[0], '/api/social/groups', 'POST', { name: 'شلّة التجربة' })).group.id;
    const invite = await api(users[0], `/api/social/groups/${group}/invites`, 'POST', { userId: users[1].id });
    await api(users[1], `/api/social/groups/${group}/invites/${invite.invitation.id}/accept`, 'POST', {});
    users.forEach((user, index) => inputs.set(`${engineName}-${index}`, { user: { id: user.id, name: user.name }, other: { id: users[1-index].id, name: users[1-index].name }, token: user.token, api: apiOrigin, group }));
    const browser = await engine.launch();
    try {
      const pages = [], errors = [];
      for (const index of [0, 1]) { const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' }); const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message)); await page.route('**/*', route => [origin, apiOrigin].includes(new URL(route.request().url()).origin) ? route.continue() : route.abort()); await page.goto(`${origin}/?user=${engineName}-${index}#/friends/group/${group}`); await page.getByRole('button', { name: 'يلا نلعب', exact: true }).waitFor(); pages.push(page); }
      const [host, guest] = pages;
      await host.getByRole('button', { name: 'مكالمة صوتية', exact: true }).click();
      await host.waitForFunction(() => window.fixture.call().connected);
      await guest.evaluate(() => window.fixture.refresh());
      await guest.getByRole('button', { name: 'انضم للمكالمة الجارية', exact: true }).click();
      await guest.waitForFunction(() => window.fixture.call().connected);
      const callsBefore = await Promise.all(pages.map(page => page.evaluate(() => window.fixture.call())));
      assert.equal(callsBefore[0].id, callsBefore[1].id);
      await host.getByRole('button', { name: 'يلا نلعب', exact: true }).click();
      await host.getByRole('dialog', { name: 'يلا نلعب', exact: true }).waitFor();
      await host.screenshot({ path: path.join(out, `${engineName}-choose-game.png`) });
      await host.getByRole('button', { name: 'ابدأ وادعُ أصحابك', exact: true }).click();
      await host.waitForURL(/#\/room\/\d{6}$/);
      const code = host.url().match(/room\/(\d{6})$/)[1];
      assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM trials WHERE user_id=?').bind(users[0].id).first()).n, 0);
      await guest.evaluate(() => window.fixture.refresh());
      await guest.getByRole('button', { name: 'انضم للّمة', exact: false }).click();
      await guest.waitForURL(new RegExp(`#/room/${code}$`));
      assert.equal(await guest.getByRole('textbox', { name: 'اسمك في الغرفة', exact: true }).count(), 0, 'accepted invitation joins directly with the signed-in profile');
      await guest.getByRole('button', { name: 'أنا جاهز', exact: true }).click();
      await host.getByRole('button', { name: 'ابدأ اللعب', exact: true }).click();
      for (let round = 1; round <= 3; round++) {
        for (const [index, page] of pages.entries()) { await page.getByRole('textbox', { name: 'فبركتك السرية', exact: true }).fill(`فبركة الهاتف ${index}`); await page.getByRole('button', { name: 'ثبّت إجابتي', exact: true }).click(); }
        await host.getByRole('button', { name: 'ابدأ التصويت', exact: true }).click();
        await host.getByRole('heading', { name: 'أين الحقيقة؟', exact: true }).waitFor();
        const question = await host.locator('.online-fab-question h1').innerText();
        const truth = questions.find(q => q.text.replace('___', '؟؟؟').replace(/\s/g, '') === question.replace(/\s/g, ''));
        assert.ok(truth, question);
        for (const page of pages) { await page.getByRole('group', { name: 'اختيار الحقيقة', exact: true }).getByRole('button', { name: truth.answer, exact: true }).click(); await page.getByRole('button', { name: 'ثبّت تصويتي', exact: true }).click(); }
        while (!(await host.getByRole('heading', { name: 'حصيلة الجولة', exact: true }).count())) {
          const reveal = host.getByRole('button', { name: /^(اكشف هذه الإجابات|اكشف الحقيقة!|المجموعة التالية)$/ });
          await reveal.waitFor(); const label = await reveal.innerText(); await reveal.click();
          if (label === 'اكشف الحقيقة!') await host.getByRole('heading', { name: 'حصيلة الجولة', exact: true }).waitFor();
          else if (label === 'المجموعة التالية') await host.getByRole('button', { name: /^(اكشف هذه الإجابات|اكشف الحقيقة!)$/ }).waitFor();
          else await host.getByRole('button', { name: 'المجموعة التالية', exact: true }).waitFor();
        }
        await host.getByRole('button', { name: round === 3 ? 'عرض النتيجة النهائية' : 'الجولة التالية', exact: true }).click();
      }
      for (const page of pages) { await page.getByRole('heading', { name: 'حصيلة الجلسة', exact: true }).waitFor(); await page.getByTestId('call-dock').waitFor(); }
      const callsAfter = await Promise.all(pages.map(page => page.evaluate(() => window.fixture.call())));
      assert.deepEqual(callsAfter, callsBefore, 'call providers/media connections persist across social→room→full match');
      assert.equal((await DB.prepare("SELECT COUNT(*) AS n FROM social_call_participants WHERE call_id=? AND state='active'").bind(callsBefore[0].id).first()).n, 2);
      assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM trials WHERE user_id=?').bind(users[0].id).first()).n, 1);
      assert.deepEqual(errors, []);
      await host.screenshot({ path: path.join(out, `${engineName}-two-player-result-with-call.png`) });
      result.engines.push({ engine: engineName, groupLaunch: true, automaticGuestJoin: true, roomCode: code, completedRounds: 3, bothCallStatesPreserved: true, mediaConnectCount: callsAfter.map(call => call.connections), mediaDisconnectCount: callsAfter.map(call => call.disconnects), browserErrors: errors });
    } finally { await browser.close(); }
  }
  result.providerRequests = requests;
  await writeFile(path.join(out, 'summary.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally { if (mf) await mf.dispose(); await new Promise(resolve => front.close(resolve)); await rm(dir, { recursive: true, force: true }); }

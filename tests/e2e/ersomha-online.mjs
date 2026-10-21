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


const dir = await mkdtemp(path.join(os.tmpdir(), 'maydan-ersomha-launch-'));
const out = process.env.E2E_OUTPUT_DIR || '.cache/ersomha-online'; await mkdir(out, { recursive: true });
let bundle = '', mf; const inputs = new Map(); const requests = [];
const front = http.createServer((req, res) => {
  const input = inputs.get(new URL(req.url, 'http://fixture').searchParams.get('user'));
  res.writeHead(200, { 'content-type': 'text/html;charset=utf-8' });
  res.end(`<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script>window.fixtureInput=${JSON.stringify(input)};</script><script>${bundle}</script></html>`);
});
await new Promise(resolve => front.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${front.address().port}`;
const result = { scope: 'Real group launch, Ersomha canvas/guesses, Lamma privacy and room WebSockets against local workerd/D1; external media transport is simulated, no production writes', engines: [] };
const drawerToolsVisible = () => {
  const board = document.querySelector('canvas.ers-board')?.getBoundingClientRect();
  const visible = button => button.getClientRects().length && getComputedStyle(button).display !== 'none';
  const buttons = [...document.querySelectorAll('.ers-tools button')].filter(visible);
  const colours = [...document.querySelectorAll('.ers-tools .ers-colour')].filter(visible);
  const more = document.querySelector('.ers-tools-more');
  return board && document.querySelector('[data-ersomha-drawing-focus="true"]') && !document.querySelector('.ers-board-status') && board.top >= 0 && board.bottom <= innerHeight + 1 && colours.length === (innerWidth > innerHeight ? 4 : 12) && (innerWidth <= innerHeight || more && visible(more)) && buttons.every(button => { const r = button.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight + 1 && r.left >= 0 && r.right <= innerWidth + 1 && r.width >= 44 && r.height >= 44; });
};
// Observe the receiving device's actual raster, not only normalized message
// coordinates. Its square/portrait projection must keep a wide drawer's circle
// round. The paper is a separate DOM layer, so alpha measures ink alone.
const receivedInk = () => {
  const canvas = document.querySelector('canvas.ers-board'); if (!canvas) return null;
  const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
  let left = canvas.width, top = canvas.height, right = -1, bottom = -1, count = 0, fingerprint = 2166136261;
  for (let index = 3; index < pixels.length; index += 4) {
    const alpha = pixels[index]; if (!alpha) continue;
    const point = (index - 3) / 4, x = point % canvas.width, y = Math.floor(point / canvas.width);
    left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y); count++;
    fingerprint = Math.imul(fingerprint ^ point, 16777619); fingerprint = Math.imul(fingerprint ^ alpha, 16777619);
  }
  return { width: right - left + 1, height: bottom - top + 1, count, fingerprint: fingerprint >>> 0, rasterWidth: canvas.width, rasterHeight: canvas.height };
};
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
import{socialInterruption}from'./src/social/interruption.js';import{BrandFonts}from'./src/shared/brand/art.jsx';import tokens from'./src/shared/theme/tokens.css';import uiCss from'./src/shared/ui/ui.css';import brand from'./src/shared/brand/brand.css';import platformCss from'./src/platform/platform.css';import onlineCss from'./src/online/online.css';
const input=window.fixtureInput;const request=async(p,o={})=>{const r=await fetch(input.api+p,{method:o.method||'GET',headers:{authorization:'Bearer '+input.token,'content-type':'application/json'},body:o.body===undefined?undefined:JSON.stringify(o.body)});if(o.raw)return r;const d=await r.json();if(!r.ok)throw Object.assign(new Error(d.error),{code:d.error});return d;};
class Room{constructor(){this.remoteParticipants=new Map([[input.other.id,{identity:input.other.id,name:input.other.name,isSpeaking:false,isMicrophoneEnabled:true}]]);this.localParticipant={identity:input.user.id,name:input.user.name,isSpeaking:false,isMicrophoneEnabled:false,setMicrophoneEnabled:async enabled=>{this.localParticipant.isMicrophoneEnabled=enabled;}};}on(){return this;}async connect(){window.mediaConnections=(window.mediaConnections||0)+1;}async disconnect(){window.mediaDisconnects=(window.mediaDisconnects||0)+1;}async startAudio(){}}
window.fixtureSDK={Room,RoomEvent:Object.fromEntries(['ParticipantConnected','ParticipantDisconnected','ActiveSpeakersChanged','TrackMuted','TrackUnmuted','LocalTrackPublished','LocalTrackUnpublished','TrackSubscribed','TrackUnsubscribed','Reconnecting','Reconnected','Disconnected'].map(x=>[x,x])),Track:{Kind:{Audio:'audio'}}};
const account={...NULL_ACCOUNT,ready:true,signedIn:true,user:input.user,requestAuthenticated:request,authHeaders:()=>({Authorization:'Bearer '+input.token}),gameAccess:()=> 'trial',markTrial:()=>{window.markedTrials=(window.markedTrials||0)+1;},refresh:async()=>{},openPaywall:()=>{throw new Error('unexpected paywall')}};
const platform={sound:{play(){},setDucking(){}},toast(){},haptics:{vibrate(){}},confetti:{fire(){}},settings:{reducedMotion:true},roster:[],storage:{get(){},set(){}}};
function Screen(){const route=useRoute(),lamma=useLamma(),social=useSocial(),ui=useSocialUI();window.fixture={refresh:async()=>{await social.refresh({quiet:true});await lamma.refreshGroups({quiet:true});await lamma.loadGroup(input.group);},call:()=>({id:lamma.activeCall?.id,connected:lamma.media.connected,connections:window.mediaConnections||0,disconnects:window.mediaDisconnects||0,muted:lamma.media.muted}),privateTurn:()=>socialInterruption.getSnapshot().privateTurn,unmute:()=>lamma.setCallMuted(false),navigate,group:()=>ui.openGroup(input.group)};return route.name==='room'?<Online key={route.params.id} code={route.params.id}/>:<main><div data-social-page-slot/></main>}
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
      await host.locator('.lamma-game-options button').filter({ hasText: 'ارسمها' }).click();
      const [createdRoomRequest] = await Promise.all([
        host.waitForRequest(request => request.url() === `${apiOrigin}/api/rooms` && request.method() === 'POST'),
        host.getByRole('button', { name: 'ابدأ وادعُ أصحابك', exact: true }).click(),
      ]);
      assert.equal(createdRoomRequest.postDataJSON().settings?.difficulty, 'easy', 'group launch sends the shared easy default to the real room service');
      await host.waitForURL(/#\/room\/\d{6}$/);
      const code = host.url().match(/room\/(\d{6})$/)[1];
      await host.getByRole('button', { name: 'تعديل الصعوبة والفئات', exact: true }).click();
      assert.equal(await host.getByRole('combobox', { name: 'مستوى الأفكار', exact: true }).inputValue(), 'easy', 'the actual server room keeps easy difficulty before either player starts');
      await host.getByRole('button', { name: 'إغلاق إعدادات الغرفة', exact: true }).click();
      assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM trials WHERE user_id=?').bind(users[0].id).first()).n, 0);
      await guest.evaluate(() => window.fixture.refresh());
      // Accepting an invitation during another real room must preserve that
      // room's exit guard. Cancelling may not leave a ghost seat in the invite.
      const before = await host.locator('.online-players > li').count();
      const otherSession = { id: crypto.randomUUID().replaceAll('-', ''), token: crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '') };
      const otherRoom = await api(users[1], '/api/rooms', 'POST', { ...otherSession, name: users[1].name, avatar: 1, game: 'fabraka', settings: { mode: 'classic', rounds: 3 } });
      await guest.evaluate(({ server, code, session }) => {
        localStorage.setItem(`maydan:online:${server}:${code}`, JSON.stringify(session));
        window.fixture.navigate(`/room/${code}`);
      }, { server: apiOrigin, code: otherRoom.code, session: otherSession });
      await guest.waitForURL(new RegExp(`#/room/${otherRoom.code}$`));
      await guest.getByText('متصل · كل واحد بجواله', { exact: true }).waitFor();
      await guest.evaluate(() => window.fixture.group());
      await guest.getByRole('button', { name: 'انضم للّمة', exact: false }).click();
      await guest.getByRole('heading', { name: 'تطلع من الغرفة؟', exact: true }).waitFor();
      await guest.getByRole('button', { name: 'خلّيني ألعب', exact: true }).click();
      await guest.waitForURL(new RegExp(`#/room/${otherRoom.code}$`));
      assert.equal(await host.locator('.online-players > li').count(), before);
      assert.equal(before, 1, 'a cancelled invitation cannot allocate a guest seat');
      assert.deepEqual(await guest.evaluate(() => window.fixture.call()), callsBefore[1]);
      await guest.screenshot({ path: path.join(out, `${engineName}-cancelled-invite-no-ghost.png`) });
      // Leave through that same guard, then verify the ordinary outside-game
      // path still enters the invitation automatically without a name form.
      await guest.evaluate(group => window.fixture.navigate(`/friends/group/${group}`), group);
      await guest.getByRole('heading', { name: 'تطلع من الغرفة؟', exact: true }).waitFor();
      await guest.getByRole('button', { name: 'الخروج', exact: true }).click();
      await guest.waitForURL(new RegExp(`#/friends/group/${group}$`));
      await guest.getByRole('button', { name: 'انضم للّمة', exact: false }).click();
      await guest.waitForURL(new RegExp(`#/room/${code}$`));
      assert.equal(await guest.getByRole('textbox', { name: 'اسمك في الغرفة', exact: true }).count(), 0, 'accepted invitation joins directly with the signed-in profile');
      await guest.getByRole('button', { name: 'أنا جاهز', exact: true }).click();
      await host.getByRole('button', { name: 'ابدأ اللعب', exact: true }).click();
      const chosen = [], circleEvidence = [];
      for (let turn = 1; turn <= 2; turn++) {
        const drawer = pages[turn - 1], guesser = pages[2 - turn];
        await drawer.locator('.ers-word-choices button').first().waitFor();
        assert.equal(await drawer.evaluate(() => window.fixture.privateTurn()), true);
        assert.equal((await drawer.evaluate(() => window.fixture.call())).muted, true, 'microphone is muted before choices appear');
        const denied = await drawer.evaluate(async () => { try { await window.fixture.unmute(); return null; } catch (error) { return error.code; } });
        assert.equal(denied, 'AUDIO_PRIVATE');
        const answer = await drawer.locator('.ers-word-choices button strong').first().innerText(); chosen.push(answer);
        assert.equal(await guesser.getByText(answer, { exact: true }).count(), 0);
        await drawer.locator('.ers-word-choices button').first().click();
        const canvas = drawer.locator('canvas.ers-board'); await canvas.waitFor();
        await drawer.waitForFunction(drawerToolsVisible);
        assert.equal(await drawer.locator('.online-social-slot .lamma-launcher').isVisible(), false, 'the room launcher is hidden behind focused drawing, so it cannot cover rotation controls');
        assert.equal(await drawer.getByText('انتهت هذه الجولة. انتظر تحديث الشاشة.', { exact: true }).count(), 0, 'initial drawing synchronization retains the numeric round identity required by the real server');
        await drawer.setViewportSize({ width: 844, height: 390 });
        await drawer.waitForFunction(drawerToolsVisible);
        await drawer.waitForFunction(() => document.querySelector('[data-testid="call-dock"]')?.getBoundingClientRect().right >= innerWidth - 20);
        const clearDrawing = await drawer.evaluate(() => {
          const call = document.querySelector('[data-testid="call-dock"]').getBoundingClientRect();
          return [...document.querySelectorAll('canvas.ers-board,.ers-tools button')].filter(node=>node.getClientRects().length&&getComputedStyle(node).display!=='none').every(node=>{const r=node.getBoundingClientRect();return r.right<=call.left||r.left>=call.right||r.bottom<=call.top||r.top>=call.bottom;});
        });
        assert.equal(clearDrawing, true, 'after orientation settles, the existing call stays beside the board and all drawing tools');
        await drawer.screenshot({ path: path.join(out, `${engineName}-turn-${turn}-landscape-tools.png`), fullPage: true });
        const landscapeBoard = await canvas.boundingBox();
        assert.ok(landscapeBoard.width >= 600 && landscapeBoard.height >= 240 && landscapeBoard.width > landscapeBoard.height * 1.8, `the landscape camera makes the phone's empty width drawable: ${JSON.stringify(landscapeBoard)}`);
        assert.equal(await canvas.getAttribute('data-camera-mode'), 'wide');
        // This circle is drawn in physical landscape pixels and travels through
        // the real room WebSocket and canonical square drawing reducer.
        const center = { x: landscapeBoard.x + landscapeBoard.width / 2, y: landscapeBoard.y + landscapeBoard.height / 2 }, radius = 70;
        await drawer.mouse.move(center.x + radius, center.y); await drawer.mouse.down();
        for (let step = 1; step <= 64; step++) { const angle = 2 * Math.PI * step / 64; await drawer.mouse.move(center.x + radius * Math.cos(angle), center.y + radius * Math.sin(angle)); }
        await drawer.mouse.up();
        await drawer.waitForFunction(() => !document.querySelector('[aria-label="تراجع عن آخر خط"]').disabled);
        await guesser.waitForFunction(() => { const canvas = document.querySelector('canvas.ers-board'); if (!canvas) return false; const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data; let count = 0; for (let i = 3; i < data.length; i += 4) if (data[i]) count++; return count > 150; });
        // The final end batch is broadcast before the drawer's undo becomes
        // available; allow the receiving browser's paint callback to settle.
        await guesser.waitForFunction(() => {
          const canvas = document.querySelector('canvas.ers-board'); if (!canvas) return false;
          const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data; let l=canvas.width,r=-1,t=canvas.height,b=-1;
          for(let i=3;i<data.length;i+=4)if(data[i]){const p=(i-3)/4,x=p%canvas.width,y=Math.floor(p/canvas.width);l=Math.min(l,x);r=Math.max(r,x);t=Math.min(t,y);b=Math.max(b,y);}
          const w=r-l+1,h=b-t+1;return w>45&&h>45&&Math.abs(w-h)<=2;
        });
        const circle = await guesser.evaluate(receivedInk);
        assert.ok(circle.width > 45 && circle.height > 45 && Math.abs(circle.width - circle.height) <= 2, `portrait guesser receives an undistorted circle: ${JSON.stringify(circle)}`);
        circleEvidence.push({ turn, physicalDiameter: 140, drawerViewportWidth: landscapeBoard.width, drawerViewportHeight: landscapeBoard.height, portraitReceiver: circle });
        await drawer.getByRole('button', { name: 'ألوان وأدوات إضافية', exact: true }).click();
        const toolsDialog = drawer.getByRole('dialog', { name: 'ألوان وأدوات الرسم', exact: true });
        await toolsDialog.waitFor();
        assert.equal(await toolsDialog.locator('.ers-colour').count(), 12, 'compact tools retain the complete palette behind More');
        await toolsDialog.getByRole('button', { name: 'إكمال الرسم', exact: true }).click();
        await toolsDialog.waitFor({ state: 'hidden' });
        await drawer.setViewportSize({ width: 390, height: 844 });
        await drawer.waitForFunction(drawerToolsVisible);
        await drawer.getByRole('button', { name: 'العودة للغرفة', exact: true }).click();
        await drawer.locator('[data-ersomha-drawing-focus="true"]').waitFor({ state: 'hidden' });
        const launcher = await drawer.locator('.online-social-slot .lamma-launcher').boundingBox();
        assert.ok(launcher && launcher.width >= 44 && launcher.height >= 44, 'returning from the focused canvas restores the room friends launcher');
        assert.equal(await drawer.locator('.online-social-slot .lamma-launcher').isVisible(), true);
        await drawer.locator('.online-social-slot .lamma-launcher').click();
        await drawer.getByRole('dialog', { name: 'الأصدقاء واللّمة', exact: true }).waitFor();
        await drawer.getByRole('button', { name: 'إغلاق اللّمة والعودة للعبة', exact: true }).click();
        await drawer.getByRole('dialog', { name: 'الأصدقاء واللّمة', exact: true }).waitFor({ state: 'hidden' });
        await drawer.getByRole('button', { name: 'تكبير لوحة الرسم', exact: true }).click();
        await drawer.waitForFunction(drawerToolsVisible);
        const currentCall = await drawer.evaluate(() => window.fixture.call()), initialCall = callsBefore[turn - 1];
        for (const key of ['id', 'connected', 'connections', 'disconnects']) assert.equal(currentCall[key], initialCall[key], `focus changes and friends navigation preserve the existing call's ${key}`);
        assert.equal(currentCall.muted, true, 'opening friends and restoring drawing never reopens the private microphone');
        const intersects = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
        const floatingCall = await drawer.getByTestId('call-dock').boundingBox();
        assert.ok(floatingCall && !intersects(floatingCall, await drawer.locator('.ers-match-header h1').boundingBox()), 'call circles leave the drawer word readable');
        assert.deepEqual(await guesser.evaluate(receivedInk), circle, 'drawer rotation, fit changes and friends navigation do not mutate the remote canonical ink');
        assert.equal((await guesser.evaluate(() => window.fixture.call())).connected, true);
        await drawer.screenshot({ path: path.join(out, `${engineName}-turn-${turn}-live-drawing.png`), fullPage: true });
        const input = guesser.locator('.ers-guess input');
        await input.fill(answer); await input.press('Enter');
        await drawer.getByText('كانت الرسمة…', { exact: true }).waitFor();
        await drawer.waitForFunction(() => !window.fixture.privateTurn());
        assert.equal((await drawer.evaluate(() => window.fixture.call())).muted, true, 'revealing the answer never reopens the microphone');
      }
      assert.notEqual(chosen[0], chosen[1], 'a remapped turn never repeats the previous concept');
      for (const page of pages) { await page.getByRole('heading', { name: 'معًا رسمتوها!', exact: true }).waitFor(); await page.getByTestId('call-dock').waitFor(); }
      const callsAfter = await Promise.all(pages.map(page => page.evaluate(() => window.fixture.call())));
      assert.deepEqual(callsAfter.map(({ muted, ...call }) => call), callsBefore.map(({ muted, ...call }) => call), 'the same call survives both drawings and the full match');
      assert.equal((await DB.prepare("SELECT COUNT(*) AS n FROM social_call_participants WHERE call_id=? AND state='active'").bind(callsBefore[0].id).first()).n, 2);
      assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM trials WHERE user_id=?').bind(users[0].id).first()).n, 1);
      assert.deepEqual(errors, []);
      await host.screenshot({ path: path.join(out, `${engineName}-cooperative-result-with-call.png`) });
      result.engines.push({ engine: engineName, groupLaunch: true, groupRoomDifficulty: 'easy', cancelledActiveRoomInvitationAllocatesNoSeat: true, automaticGuestJoin: true, roomCode: code, completedDrawingTurns: 2, bothDrawingsDelivered: true, wideCanvasCircleCompatibility: circleEvidence, rotationAndFocusPreserveRemoteInk: true, drawerMutedBeforeWord: true, microphoneUnmuteBlockedDuringDrawing: true, microphoneNeverAutoReopened: true, bothCallStatesPreserved: true, mediaConnectCount: callsAfter.map(call => call.connections), mediaDisconnectCount: callsAfter.map(call => call.disconnects), browserErrors: errors });
    } finally { await browser.close(); }
  }
  result.providerRequests = requests;
  await writeFile(path.join(out, 'summary.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally { if (mf) await mf.dispose(); await new Promise(resolve => front.close(resolve)); await rm(dir, { recursive: true, force: true }); }

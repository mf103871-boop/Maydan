// Real SocialHost, LammaProvider, CallDock and Play components. Remote/native media
// events are deterministic fixtures: this verifies layout and UI, not a live SFU
// or the physical iPhone keyboard. Run: node tests/e2e/call-dock.mjs.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium, webkit } from 'playwright';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';

const me = { id: 'me', userId: 'me', name: 'عمر', code: 'MDN-OMAR', avatarPreset: 'falcon' };
const peers = Array.from({ length: 11 }, (_, i) => ({ id: `person-${i + 1}`, userId: `person-${i + 1}`, name: ['أحمد', 'ليان', 'سارة', 'خالد', 'نور', 'لينا', 'كريم', 'ريم', 'سامي', 'جود', 'رنا'][i], avatarPreset: ['lion', 'cat', 'falcon'][i % 3], online: true, ...(i === 1 ? { avatarUrl: '/api/profiles/person-2/images/avatar/' + 'a'.repeat(64) } : {}) }));
const members = [me, ...peers];
const group = { id: 'group-1', name: 'شلّة الخميس', ownerId: me.id, role: 'owner', memberCount: 12, avatarPreset: 'falcon' };
const call = { id: 'voice-1', scope: 'group', name: 'مكالمة الشلّة', conversationId: group.id, status: 'active', acceptedAt: Date.now() - 20000, participants: members.map(user => ({ userId: user.id, state: 'active', ...(user.id === me.id ? { deviceId: 'fixture-device' } : {}) })) };
const reads = [];
const messages = [{ seq: 1, senderId: peers[0].id, clientId: 'initial', kind: 'text', text: 'جاهزين نلعب مع بعض؟', createdAt: Date.now() - 10000 }];
async function api(url, method, body) {
  reads.push({ url, method });
  if (url === '/api/social/state') return { user: me, friends: peers.map((user, i) => ({ ...user, conversationId: `direct-${i + 1}`, unreadCount: 0 })), incoming: [], outgoing: [], blocked: [], conversations: [{ id: 'direct-1', user: peers[0], unreadCount: 0 }] };
  if (url === '/api/social/groups') return { groups: [group], incoming: [] };
  if (url === '/api/social/groups/group-1') return { group, members: members.map(user => ({ ...user, role: user.id === me.id ? 'owner' : 'member' })), invitations: [] };
  if (url.startsWith('/api/social/groups/group-1/messages') || url.startsWith('/api/social/conversations/direct-1/messages')) {
    if (method === 'POST') messages.push({ ...body, seq: messages.length + 1, senderId: me.id, createdAt: Date.now() });
    return { messages, readSeq: 0, peerReadSeq: 0, hasMore: false };
  }
  if (url.endsWith('/read')) return { readSeq: body?.seq || 0 };
  if (url === '/api/social/calls') return { calls: [call] };
  if (url === '/api/social/calls/voice-1') return { call };
  if (url === '/api/social/preferences') return { preferences: { messages: true, calls: true, previews: false, sound: false, mutedConversations: [] } };
  if (url === '/api/social/capabilities') return { capabilities: { voiceMessages: true, liveCalls: true, pushNotifications: true } };
  if (url === '/api/social/live-ticket') return { error: 'SOCIAL_UNAVAILABLE' };
  if (url.includes('/images/avatar/')) return null;
  if (url.startsWith('/api/profiles/')) return { profile: { ...(members.find(user => url.includes('/' + user.id)) || me), relationship: 'friend', stats: {}, achievements: [], featuredBadges: [], earnedBadges: [], earnedTitles: [] } };
  return {};
}

const bundle = await build({ stdin: { contents: `
import React,{useState,useEffect}from'react';import{createRoot}from'react-dom/client';
import{AccountContext,NULL_ACCOUNT}from'./src/shared/account/context.js';import{PlatformContext}from'./src/platform/context.js';
import{SocialProvider}from'./src/social/SocialProvider.jsx';import{LammaProvider,useLamma}from'./src/social/LammaProvider.jsx';
import{SocialUIProvider,useSocialUI}from'./src/social/SocialUIProvider.jsx';import{ProfileProvider}from'./src/profiles/ProfileProvider.jsx';
import{SocialHost}from'./src/social/SocialHost.jsx';import{CallViewport}from'./src/social/CallViewport.jsx';
import{Play}from'./src/platform/screens/Play.jsx';import{socialInterruption}from'./src/social/interruption.js';
import{BrandFonts}from'./src/shared/brand/art.jsx';import{Modal,Button}from'./src/shared/ui/components.jsx';
import css from'./src/shared/ui/ui.css';import tokens from'./src/shared/theme/tokens.css';import brand from'./src/shared/brand/brand.css';
import platformCss from'./src/platform/platform.css';import setupCss from'./src/shared/setup/setup.css';import onlineCss from'./src/online/online.css';
const members=${JSON.stringify(members)};
const nativeLog=[];window.nativeLog=nativeLog;
let snapshot={userId:'me',callId:'voice-1',scope:'group',conversationId:'group-1',state:'connected',muted:false,participants:members.map(user=>({id:user.id,userId:user.id,name:user.name,local:user.id==='me',muted:false,speaking:false}))};
const sendSnapshot=patch=>{snapshot={...snapshot,...patch};window.maydanNative.event('socialCall',snapshot)};
window.MaydanNative={postMessage(raw){const message=JSON.parse(raw);nativeLog.push({type:message.type,muted:message.muted,speaker:message.speaker});queueMicrotask(()=>{if(message.type==='socialCallMute')sendSnapshot({muted:message.muted});if(message.type==='socialCallSpeaker')sendSnapshot({speaker:message.speaker});window.maydanNative.resolve(message.id,{ok:true,result:{authorized:true,status:'granted'}})})}};
const request=async(url,options={})=>{const response=await fetch(url,{method:options.method||'GET',headers:{'content-type':'application/json'},body:options.body===undefined?undefined:JSON.stringify(options.body)});const data=await response.json();if(data.error)throw Object.assign(new Error(data.error),{code:data.error});return data};
const sound={play(){},setDucking(){},music:{play(){},sting(){}}};
const roster=[{id:'a',name:'أحمد',color:'#178879',emoji:'🦊'},{id:'b',name:'عمر',color:'#dc7849',emoji:'🐻'},{id:'c',name:'ليان',color:'#7768b6',emoji:'🐱'}];
const platform={sound,toast(){},settings:{soundOn:false,reducedMotion:true},setSettings(){},haptics:{vibrate(){}},confetti:{fire(){}},roster,setRoster(){},storage:{get(){},set(){}}};
function Observer(){const lamma=useLamma(),ui=useSocialUI();window.fixture={...window.fixture,patchMedia:sendSnapshot,getMedia:()=>lamma.media,getCall:()=>lamma.activeCall,openFriends:ui.show,closeFriends:ui.close,openChat:()=>ui.openChat('person-1'),openGroup:()=>ui.openGroup('group-1'),private:()=>{window.releasePrivate?.();window.releasePrivate=socialInterruption.private('fixture-private')},releasePrivate:()=>{window.releasePrivate?.();window.releasePrivate=null}};return null}
function App(){const[owner,setOwner]=useState('me'),[game,setGame]=useState('fabraka'),[modal,setModal]=useState(false);window.fixture={...window.fixture,setOwner,setGame:id=>{location.hash='#/play/'+id;socialInterruption.setContext({local:false});socialInterruption.resume();setGame(id)},openModal:()=>setModal(true)};window.interruption=socialInterruption;const account={...NULL_ACCOUNT,ready:true,signedIn:!!owner,user:owner?{id:owner,name:'عمر'}:null,requestAuthenticated:request,ensureNativeSocialSession:async()=>({userId:owner,deviceId:'fixture-device',call:snapshot})};return <AccountContext.Provider value={account}><PlatformContext.Provider value={platform}><BrandFonts/><style>{tokens}</style><style>{css}</style><style>{brand}</style><style>{platformCss}</style><style>{setupCss}</style><style>{onlineCss}</style><SocialProvider><LammaProvider><SocialUIProvider><ProfileProvider><Observer/><CallViewport><Play key={game} id={game}/></CallViewport><SocialHost/>{modal&&<Modal title="فوق أدوات المكالمة" onClose={()=>setModal(false)} footer={<Button onClick={()=>setModal(false)}>إغلاق الاختبار</Button>}><p>الحوار العام يبقى أعلى شريط الصوت.</p></Modal>}</ProfileProvider></SocialUIProvider></LammaProvider></SocialProvider></PlatformContext.Provider></AccountContext.Provider>};createRoot(document.getElementById('root')).render(<App/>);`, loader: 'jsx', resolveDir: process.cwd() }, bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.css': 'text', '.webp': 'dataurl', '.woff2': 'dataurl', '.svg': 'dataurl' }, logLevel: 'silent' });
const html = `<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script>${bundle.outputFiles[0].text}</script></html>`;
const publicRoot = path.resolve('public');
const server = http.createServer(async (req, res) => {
  try {
    if (req.url.startsWith('/api/')) {
      let raw = ''; for await (const chunk of req) raw += chunk;
      const data = await api(req.url, req.method, raw ? JSON.parse(raw) : undefined);
      res.writeHead(data === null ? 404 : data.error ? 503 : 200, { 'content-type': 'application/json' }); res.end(JSON.stringify(data || {})); return;
    }
    const pathname = decodeURIComponent(new URL(req.url, 'http://fixture').pathname);
    if (pathname !== '/') {
      const candidate = path.resolve(publicRoot, '.' + pathname);
      if (candidate.startsWith(publicRoot + path.sep)) {
        const data = await fs.readFile(candidate).catch(() => null);
        if (data) { res.writeHead(200, { 'content-type': /\.json$/.test(candidate) ? 'application/json' : /\.webp$/.test(candidate) ? 'image/webp' : /\.png$/.test(candidate) ? 'image/png' : 'application/octet-stream' }); res.end(data); return; }
      }
      res.writeHead(404); res.end(); return;
    }
    res.writeHead(200, { 'content-type': 'text/html;charset=utf-8' }); res.end(html);
  } catch (error) { res.writeHead(500); res.end(error.message); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const out = path.resolve(process.env.CALL_DOCK_SCREENSHOT_DIR || '.cache/floating-call-bubbles-e2e'); await fs.mkdir(out, { recursive: true });
const settle = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve)))));
const visibleIds = page => page.getByTestId('call-dock-participant').evaluateAll(elements => elements.map(el => el.dataset.userId));
async function noOverflow(page, label) { assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${label}: no horizontal overflow`); }
async function patch(page, value) { await page.evaluate(value => window.fixture.patchMedia(value), value); await settle(page); }
async function geometry(page, label) {
  await noOverflow(page, label);
  const dock = await page.getByTestId('call-dock').boundingBox(); assert.ok(dock, `${label}: dock visible`);
  const viewport = await page.evaluate(() => ({ width: visualViewport.width, height: visualViewport.height, left: visualViewport.offsetLeft, top: visualViewport.offsetTop }));
  assert.ok(dock.x >= viewport.left - 1 && dock.x + dock.width <= viewport.left + viewport.width + 1 && dock.y >= viewport.top - 1 && dock.y + dock.height <= viewport.top + viewport.height + 1, `${label}: floating bubbles stay in visual viewport ${JSON.stringify({ dock, viewport })}`);
  const layout = await page.getByTestId('call-game-viewport').evaluate(el => { const active = el.getBoundingClientRect().width, attr = document.documentElement.getAttribute('data-call-dock-active'); document.documentElement.removeAttribute('data-call-dock-active'); const inactive = el.getBoundingClientRect().width; if (attr !== null) document.documentElement.setAttribute('data-call-dock-active', attr); return { active, inactive, viewport: innerWidth }; });
  assert.ok(Math.abs(layout.active - layout.inactive) < 1 && Math.abs(layout.active - layout.viewport) < 1, `${label}: call overlay reserves no game width ${JSON.stringify(layout)}`);
  assert.equal(await page.getByTestId('call-dock').evaluate(el => getComputedStyle(el).pointerEvents), 'none', `${label}: transparent parent does not intercept the game`);
  const launcher = await page.locator('.lamma-launcher').boundingBox(); assert.ok(launcher, `${label}: friends remain reachable`);
  assert.ok(launcher.x >= -1 && launcher.x + launcher.width <= (await page.evaluate(() => innerWidth)) + 1, `${label}: friends launcher stays inside the screen`);
  assert.ok(launcher.width >= 44 && launcher.height >= 44, `${label}: friends launcher has a 44px target`);
  const launcherAvatars = await page.locator('.lamma-launcher-faces > .player-avatar').evaluateAll(elements => elements.filter(el => getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden' && el.getBoundingClientRect().width > 0).map(el => el.getBoundingClientRect().toJSON()));
  assert.equal(launcherAvatars.length, 1, `${label}: compact launcher paints exactly one avatar despite inline avatar styles`);
  const launcherChildOverflow = await page.locator('.lamma-launcher *').evaluateAll(elements => elements.filter(el => { const style = getComputedStyle(el), rect = el.getBoundingClientRect(); return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0 && (rect.left < innerWidth - 56 - 1 || rect.right > innerWidth + 1 || rect.top < -1 || rect.bottom > innerHeight + 1); }).map(el => ({ className: el.getAttribute('class'), rect: el.getBoundingClientRect().toJSON() })));
  assert.deepEqual(launcherChildOverflow, [], `${label}: painted launcher children stay inside the viewport`);
}
async function clickThroughGap(page) {
  const point = await page.getByTestId('call-dock').evaluate(el => { const buttons = [...el.querySelectorAll('button')].map(button => button.getBoundingClientRect()).sort((a,b) => a.top - b.top); const first = buttons[0], next = buttons.find(button => button.top > first.bottom + 1); return next ? { x: first.x + first.width / 2, y: (first.bottom + next.top) / 2 } : { x: el.getBoundingClientRect().left + 1, y: el.getBoundingClientRect().top + 1 }; });
  await page.evaluate(({x,y}) => { const button = document.createElement('button'); button.id='behind-call-gap';button.style.cssText=`position:fixed;left:${x-1}px;top:${y-1}px;width:2px;height:2px;padding:0;border:0;z-index:350`;button.addEventListener('click',()=>window.gapClicked=true);document.body.append(button); }, point);
  await page.mouse.click(point.x, point.y);
  assert.equal(await page.evaluate(() => window.gapClicked), true, 'the transparent gap passes pointer input to the game underneath');
  await page.evaluate(() => document.getElementById('behind-call-gap').remove());
}
async function dragDock(page, locator, dx, dy) {
  const box = await locator.boundingBox(), before = await page.getByTestId('call-dock').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, { steps: 10 }); await page.mouse.up(); await settle(page);
  return { before, after: await page.getByTestId('call-dock').boundingBox() };
}
async function screenshot(page, name) { await page.evaluate(() => document.fonts.ready); await page.screenshot({ path: path.join(out, name + '.png') }); }
async function startFabraka(page) {
  const quick = page.getByRole('button', { name: 'سريع · 30', exact: true }); if (await quick.count()) await quick.click();
  await page.getByRole('button', { name: /ابدأ اللعب · 3 لاعبين/ }).click();
  await page.getByRole('button', { name: 'ابدأ الجولة', exact: true }).click();
  await page.getByRole('button', { name: 'فهمنا السؤال، نبدأ الكتابة', exact: true }).click();
}
async function inputKeyboardCollapse(page) {
  // A focused ordinary input exercises the shared dock viewport listener. The
  // real social composer is separately checked below with the drawer mounted.
  await page.getByTestId('call-dock-drag').press('End'); await page.getByTestId('call-dock-drag').press('ArrowLeft'); await settle(page);
  const before = await page.getByTestId('call-dock').boundingBox();
  await page.evaluate(() => { const input = document.createElement('input'); input.id = 'keyboard-fixture'; input.setAttribute('aria-label', 'حقل اختبار الكيبورد'); input.style.cssText = 'position:fixed;left:8px;bottom:8px;width:180px;font-size:16px'; document.body.append(input); input.focus(); window.setFixtureViewport({ height: 420, offsetTop: 24 }); });
  await page.waitForFunction(() => document.querySelector('[data-testid="call-dock"]')?.dataset.keyboard === 'true');
  await settle(page);
  assert.equal(await page.getByTestId('call-dock').getAttribute('data-collapsed'), 'true', 'keyboard automatically compacts the rail');
  await noOverflow(page, 'keyboard compact');
  const compact = await page.getByTestId('call-dock').boundingBox();
  assert.ok(compact.y + compact.height <= 444 + 1, `keyboard clamps the displayed bubbles to the visible viewport ${JSON.stringify(compact)}`);
  await page.evaluate(() => { document.getElementById('keyboard-fixture').remove(); window.setFixtureViewport({ height: 844, offsetTop: 0 }); });
  await page.waitForFunction(() => document.querySelector('[data-testid="call-dock"]')?.dataset.keyboard === 'false');
  assert.equal(await page.getByTestId('call-dock').getAttribute('data-collapsed'), 'false', 'keyboard dismissal restores the previous expanded state');
  await settle(page); const after = await page.getByTestId('call-dock').boundingBox();
  assert.ok(Math.abs(before.x-after.x)<1 && Math.abs(before.y-after.y)<1, 'keyboard dismissal restores the preferred two-dimensional position');
}
async function exerciseGame(page, id, label) {
  if (id === 'badeeha') {
    await page.getByRole('button', { name: /ابدأ لعبة جديدة/ }).click();
    await page.getByRole('group', { name: 'تصفية الفئات', exact: true }).getByRole('button', { name: 'معلومات', exact: true }).click();
    for (let i = 0; i < 6; i++) await page.locator('.m-category-main').nth(i).click();
    await page.getByRole('button', { name: /^ابدأ \d+ سؤالًا/ }).click(); await page.locator('.m-board-grid').waitFor();
  } else if (id === 'fabraka') {
    await startFabraka(page); await page.getByTestId('privacy-gate').waitFor(); await geometry(page, `${label}-privacy-gate`);
    await page.getByRole('button', { name: /أنا .+، جاهز/ }).click(); await page.locator('.fab-input').waitFor();
  } else {
    await page.getByRole('button', { name: /^ابدأ اللعب/ }).click();
    if (id === 'beep') await page.getByRole('button', { name: /^جاهز —/ }).click();
    if (id === 'mamnoo') await page.getByRole('button', { name: /^ابدأ \d+ ثانية$/ }).click();
    if (id === 'jabeen') {
      await page.getByRole('button', { name: 'ابدأ الجولة', exact: true }).click(); await page.locator('.jabeen-stage').waitFor();
      if (await page.getByRole('button', { name: 'تخطي هذا التنبيه', exact: true }).count()) {
        await geometry(page, `${label}-rotate`); await page.getByRole('button', { name: 'تخطي هذا التنبيه', exact: true }).click();
      }
    }
    if (id === 'meenfina') { await page.getByRole('button', { name: 'اعرض العبارة', exact: true }).click(); await page.locator('.meen-count').waitFor(); }
  }
  await settle(page); await geometry(page, `${label}-active`);
}
async function run(browser, name) {
  reads.length = 0;
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ar', isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
  const page = await context.newPage(), errors = []; page.on('pageerror', error => errors.push(error.message));
  page.setDefaultTimeout(8000);
  await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await page.addInitScript(() => {
    // Before the viewport meta is parsed, mobile Chromium temporarily reports
    // the 980px layout viewport. Use the explicitly configured phone geometry.
    const viewport = Object.assign(new EventTarget(), { width: 390, height: 844, offsetTop: 0, offsetLeft: 0, scale: 1 });
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport });
    window.setFixtureViewport = patch => { Object.assign(viewport, patch); viewport.dispatchEvent(new Event('resize')); viewport.dispatchEvent(new Event('scroll')); };
  });
  try {
    await page.goto(origin + '/#/play/fabraka'); await page.getByTestId('call-dock').waitFor(); await settle(page);
    assert.ok(reads.some(item => item.url === '/api/social/groups/group-1'), 'restored group call loads member detail');
    assert.ok(!reads.some(item => item.url.startsWith('/api/social/groups/group-1/messages')), 'restoring call photos never loads group history');
    assert.equal(await page.evaluate(() => window.interruption.getSnapshot().open), false, 'passive rail does not interrupt');
    assert.equal(await page.getByTestId('call-dock-participant').count(), 4);
    const initialIds = await visibleIds(page); assert.equal(initialIds[0], 'me');
    await page.waitForFunction(() => !document.querySelector('[data-testid="call-dock-participant"][data-user-id="person-2"] img'));
    assert.ok(await page.locator('[data-testid="call-dock-participant"][data-user-id="person-2"] .player-avatar').textContent(), 'failed photo falls back to a preset');
    const avatars = page.getByTestId('call-dock-participant').locator('.player-avatar');
    assert.ok((await avatars.first().boundingBox()).width >= 36, 'participant photo is at least36px');
    const buttonBoxes = await page.getByTestId('call-dock').locator('button').evaluateAll(elements => elements.map(el => ({ text: el.getAttribute('aria-label'), width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height })));
    assert.ok(buttonBoxes.every(box => box.width >= 44 && box.height >= 44), `rail targets at least44px ${JSON.stringify(buttonBoxes)}`);
    await geometry(page, 'initial390'); await screenshot(page, `${name}-12-participants`);
    const style = await page.getByTestId('call-dock-participant').first().evaluate(el => { const button=getComputedStyle(el), parent=getComputedStyle(el.closest('.call-dock')), avatar=getComputedStyle(el.querySelector('.player-avatar')); return { radius: button.borderRadius, background: button.backgroundColor, parentBackground: parent.backgroundColor, parentShadow: parent.boxShadow, avatarRadius: avatar.borderRadius, pointer: button.pointerEvents }; });
    assert.equal(style.radius, '50%', 'participant controls are true circles'); assert.equal(style.avatarRadius, '50%', 'profile photos are circular');
    assert.match(style.background, /rgba\(.+,\s*0\.\d+\)/, 'bubbles have a semi-transparent background');
    assert.match(style.parentBackground, /rgba\(.+,\s*0\)/, 'no opaque strip joins the bubbles'); assert.equal(style.parentShadow, 'none'); assert.equal(style.pointer, 'auto');
    await clickThroughGap(page);
    const media = await page.evaluate(() => window.fixture.getMedia());
    await patch(page, { participants: [...media.participants].reverse() });
    assert.deepEqual(await visibleIds(page), initialIds, 'transport reorder does not move participant slots');
    await page.getByTestId('call-dock-participant').nth(3).focus();
    await page.getByTestId('call-dock-participant').nth(3).evaluate(el => { window.focusedCallSeat = el; });
    await patch(page, { participants: media.participants.map(person => ({ ...person, speaking: person.userId === 'person-10' || person.userId === 'person-11' || person.userId === 'person-1' })) });
    assert.equal((await visibleIds(page)).at(-1), 'person-10', 'hidden speaker occupies the final slot');
    assert.ok(await page.evaluate(() => document.activeElement === window.focusedCallSeat), 'speaker promotion keeps the focused seat mounted');
    assert.match(await page.getByTestId('call-dock-more').getAttribute('aria-label'), /8 آخرون.*1 يتحدثون الآن/, 'additional speakers/count is accessible');
    assert.ok(await page.locator('[data-testid="call-dock-participant"][data-user-id="person-1"][data-speaking="true"]').count());
    assert.equal(await page.locator('[data-testid="call-dock-participant"][data-speaking="true"]').count(), 2, 'simultaneous visible speakers are highlighted together');
    const speakingColor = await page.locator('[data-testid="call-dock-participant"][data-speaking="true"] .player-avatar').first().evaluate(el => getComputedStyle(el).outlineColor);
    const rgb = speakingColor.match(/[\d.]+/g).map(Number); assert.ok(rgb[1] > rgb[0] && rgb[1] > rgb[2], 'active speaker ring is green');
    await screenshot(page, `${name}-speaking`);
    await patch(page, { participants: media.participants.map(person => ({ ...person, speaking: person.userId === 'person-1', muted: person.userId === 'person-1' })) });
    assert.equal(await page.locator('[data-testid="call-dock-participant"][data-user-id="person-1"][data-speaking="true"]').count(), 0, 'muted never speaks');
    assert.deepEqual(await visibleIds(page), initialIds, 'speaking ending restores stable participant positions');
    await patch(page, { state: 'reconnecting', participants: media.participants.map(person => ({ ...person, speaking: true })) });
    assert.equal(await page.locator('[data-testid="call-dock-participant"][data-speaking="true"]').count(), 0, 'reconnect suppresses stale speaking');
    assert.match(await page.getByTestId('call-dock').innerText(), /نعيد الاتصال بالمكالمة/, 'native reconnect is distinguished from initial connection');
    await patch(page, { state: 'connected', participants: media.participants.slice(0, 2) }); assert.equal(await page.getByTestId('call-dock-participant').count(), 2);
    await patch(page, { participants: media.participants }); assert.equal(await page.getByTestId('call-dock-participant').count(), 4);
    await page.getByTestId('call-dock-participant').first().click();
    const dialog = page.locator('.call-controls-dialog'); await dialog.waitFor();
    assert.equal(await dialog.locator('.call-controls-member').count(), 12); assert.equal(await dialog.getByText('أنت', { exact: true }).count(), 1);
    assert.equal(await page.evaluate(() => window.interruption.getSnapshot().open), true, 'controls use social interruption');
    assert.ok(await page.locator('#root').evaluate(el => el.inert), 'modal makes game inert');
    await screenshot(page, `${name}-all-participants`);
    await page.keyboard.press('Tab'); assert.ok(await dialog.evaluate(el => el.contains(document.activeElement)), 'keyboard focus stays inside controls');
    await page.getByTestId('call-dock-output').selectOption('speaker'); await page.waitForFunction(() => window.fixture.getMedia().outputId === 'speaker');
    assert.ok(await page.evaluate(() => nativeLog.some(event => event.type === 'socialCallSpeaker' && event.speaker)), 'output selector reaches existing media action');
    await screenshot(page, `${name}-expanded-controls`);
    await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'detached' }); assert.equal(await page.evaluate(() => window.interruption.getSnapshot().open), false);
    const audioBefore = await page.evaluate(() => nativeLog.filter(event => /socialCall(Mute|End|Speaker|Connect)/.test(event.type)).length);
    await page.getByTestId('call-dock-collapse').click(); await settle(page); assert.equal(await page.getByTestId('call-dock-participant').count(), 0);
    await geometry(page, 'collapsed390');
    const moved = await dragDock(page, page.getByTestId('call-dock-drag'), -130, 130);
    assert.ok(Math.abs(moved.after.y - moved.before.y) > 30 && Math.abs(moved.after.x - moved.before.x) > 30, 'grip drags bubbles freely on both axes');
    assert.equal(await page.locator('.call-controls-dialog').count(), 0, 'dragging does not open call controls');
    const keyboardBefore = await page.getByTestId('call-dock').boundingBox(); await page.getByTestId('call-dock-drag').press('ArrowLeft'); await page.getByTestId('call-dock-drag').press('ArrowDown'); await settle(page); const keyboardAfter=await page.getByTestId('call-dock').boundingBox();
    assert.ok(keyboardAfter.x < keyboardBefore.x && keyboardAfter.y > keyboardBefore.y, 'keyboard arrows move both axes');
    await page.getByTestId('call-dock-drag').press('End'); await settle(page); await geometry(page, 'dragged to bottom');
    assert.equal(await page.evaluate(() => nativeLog.filter(event => /socialCall(Mute|End|Speaker|Connect)/.test(event.type)).length), audioBefore, 'collapse/drag never changes audio');
    await page.getByTestId('call-dock-collapse').click(); await settle(page);
    const avatarMoved = await dragDock(page, page.getByTestId('call-dock-participant').first(), 60, -100);
    assert.ok(Math.abs(avatarMoved.after.x - avatarMoved.before.x)>30 && Math.abs(avatarMoved.after.y-avatarMoved.before.y)>30, 'a participant circle can directly drag the floating group');
    assert.equal(await page.locator('.call-controls-dialog').count(), 0, 'dragging an avatar suppresses its click action');
    await geometry(page, 'avatar-dragged'); await screenshot(page, `${name}-moved-bubbles`);
    await patch(page, { error: 'اضغط تشغيل الصوت لسماع المكالمة.' });
    await page.getByTestId('call-dock-participant').first().click(); await page.getByTestId('call-dock-resume').click(); await page.waitForFunction(() => !window.fixture.getMedia().error);
    assert.equal(await page.locator('.call-controls-dialog').getByRole('button', { name: 'إنهاء المكالمة', exact: true }).count(), 1, 'end remains accessible in expanded controls');
    await page.locator('.call-controls-dialog').getByTestId('call-dock-end').click(); await page.getByTestId('call-dock').waitFor({ state: 'detached' });
    await patch(page, { state: 'connected', error: '', muted: false }); await page.getByTestId('call-dock').waitFor();
    const reset = await page.getByTestId('call-dock').boundingBox(); assert.ok(reset.x >= 330 && reset.y < 20, 'new call resets to the default physical right/top position');
    assert.equal(await page.getByTestId('call-dock').getAttribute('data-collapsed'), 'false', 'new call resets collapse');
    assert.ok(await page.evaluate(() => nativeLog.some(event => event.type === 'socialCallEnd')), 'end control reaches existing media action');
    await page.evaluate(() => window.fixture.private()); await settle(page);
    const mute = page.getByTestId('call-dock-mute'); assert.equal(await mute.isDisabled(), true, 'secret turn cannot unmute');
    assert.equal(await mute.getAttribute('aria-pressed'), 'true');
    await page.evaluate(() => window.fixture.releasePrivate()); await settle(page); assert.equal(await mute.isDisabled(), false);
    await mute.click(); await page.waitForFunction(() => window.fixture.getMedia().muted === false);
    await inputKeyboardCollapse(page);
    await page.getByTestId('call-dock-participant').first().click(); await page.locator('.call-controls-dialog').getByTestId('call-dock-return').click();
    await page.getByRole('dialog', { name: 'الأصدقاء واللّمة', exact: true }).waitFor(); await page.getByText('جاهزين نلعب مع بعض؟', { exact: true }).waitFor();
    assert.ok(reads.some(item => item.url.startsWith('/api/social/groups/group-1/messages')), 'return action opens the actual call conversation');
    await page.getByRole('button', { name: 'إغلاق اللّمة والعودة للعبة' }).click();
    await page.evaluate(() => window.fixture.openChat()); await page.getByTestId('call-inline-controls').waitFor();
    assert.equal(await page.getByTestId('call-dock').isVisible(), false, 'drawer owns controls without a second rail');
    const input = page.getByRole('textbox', { name: 'اكتب رسالة', exact: true }); await input.fill('مسودة عربية 🎮'); await input.focus();
    await page.evaluate(() => window.setFixtureViewport({ height: 420, offsetTop: 24 })); await settle(page);
    assert.equal(await input.inputValue(), 'مسودة عربية 🎮'); assert.ok(await input.evaluate(el => parseFloat(getComputedStyle(el).fontSize) >= 16));
    await screenshot(page, `${name}-keyboard-inline`);
    await page.evaluate(() => window.setFixtureViewport({ height: 844, offsetTop: 0 })); await page.getByRole('button', { name: 'إغلاق اللّمة والعودة للعبة' }).click();
    await page.evaluate(() => window.interruption.resume()); await page.getByTestId('call-dock').waitFor();
    await page.evaluate(() => window.fixture.openModal()); await page.getByRole('dialog', { name: 'فوق أدوات المكالمة' }).waitFor();
    assert.ok(await page.getByTestId('call-dock').evaluate(el => el.inert || el.closest('[inert]') || getComputedStyle(el).pointerEvents === 'none' || document.elementFromPoint(el.getBoundingClientRect().x + 25, el.getBoundingClientRect().y + 25)?.closest('.modal-layer')), 'general dialog owns interaction above dock');
    await page.getByRole('button', { name: 'إغلاق الاختبار', exact: true }).click();
    for (const [width, height] of [[375, 667], [390, 844], [844, 390]]) {
      await page.setViewportSize({ width, height }); await page.evaluate(({ width, height }) => window.setFixtureViewport({ width, height, offsetTop: 0 }), { width, height });
      for (const id of ['badeeha', 'beep', 'mamnoo', 'jabeen', 'fabraka', 'meenfina']) {
        await page.evaluate(id => window.fixture.setGame(id), id); await page.locator('.game-frame').waitFor(); await settle(page); await page.waitForFunction(() => !document.querySelector('.game-loading'));
        await geometry(page, `${id}${width}x${height}`); await screenshot(page, `${name}-${id}-${width}x${height}`);
        await exerciseGame(page, id, `${id}${width}x${height}`); await screenshot(page, `${name}-${id}-active-${width}x${height}`);
      }
    }
    await page.setViewportSize({ width: 390, height: 844 }); await page.evaluate(() => { window.setFixtureViewport({ width: 390, height: 844 }); window.fixture.setGame('fabraka'); });
    await startFabraka(page); await page.getByTestId('privacy-gate').waitFor(); await page.getByRole('button', { name: /أنا .+، جاهز/ }).click();
    await page.locator('.fab-input').fill('إجابة محفوظة'); await page.waitForFunction(() => JSON.parse(localStorage.getItem('maydan:fabraka:session-v2'))?.remaining < 30);
    const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('maydan:fabraka:session-v2')));
    const before = await saved(); await page.waitForTimeout(1200); assert.ok((await saved()).remaining < before.remaining, 'passive rail keeps actual game timer running');
    await page.getByTestId('call-dock-participant').first().click(); await page.locator('.call-controls-dialog').waitFor(); const paused = await saved(); assert.equal(paused.paused, true); await page.waitForTimeout(1200); assert.equal((await saved()).remaining, paused.remaining, 'control panel freezes local timer');
    await page.keyboard.press('Escape'); await page.getByRole('heading', { name: 'اللعبة بانتظاركم' }).waitFor(); await page.getByRole('button', { name: 'متابعة اللعب', exact: true }).click();
    await page.getByTestId('privacy-gate').waitFor(); await page.getByRole('button', { name: /أنا .+، جاهز/ }).click(); assert.equal(await page.locator('.fab-input').inputValue(), 'إجابة محفوظة');
    const resumed = await saved(); assert.equal(resumed.seed, before.seed); assert.equal(resumed.writer, before.writer); assert.equal(resumed.round, before.round);
    await page.evaluate(() => { window.interruption.setContext({ local: false, online: true, turnDeadline: Date.now() + 20000 }); window.interruption.resume(); });
    const onlineDeadline = await page.evaluate(() => window.interruption.getSnapshot().turnDeadline);
    await page.getByTestId('call-dock-participant').first().click(); await page.locator('.call-controls-dialog').waitFor();
    assert.equal(await page.evaluate(() => window.interruption.getSnapshot().paused), false, 'opening controls never pauses an online match');
    await page.waitForTimeout(300); assert.equal(await page.evaluate(() => window.interruption.getSnapshot().turnDeadline), onlineDeadline, 'online deadline stays authoritative');
    await page.keyboard.press('Escape'); await page.locator('.call-controls-dialog').waitFor({ state: 'detached' });
    await page.evaluate(() => window.fixture.setOwner(null)); await page.getByTestId('call-dock').waitFor({ state: 'detached' });
    assert.equal(await page.getByTestId('call-inline-controls').count(), 0); assert.equal(await page.locator('html').getAttribute('data-call-dock-active'), null, 'logout clears active-call layout state');
    assert.equal(await page.locator('[data-user-id="person-10"]').count(), 0, 'logout removes participant details');
    await page.evaluate(() => window.fixture.setOwner('other-account')); await settle(page);
    assert.equal(await page.getByTestId('call-dock').count(), 0, 'a different account cannot inherit the previous native call');
    await page.evaluate(() => window.fixture.setOwner('me')); await page.getByTestId('call-dock').waitFor(); await settle(page);
    const relogin = await page.getByTestId('call-dock').boundingBox();
    assert.ok(relogin.x >= 330 && relogin.y < 20, 'switching accounts resets the floating position');
    assert.equal(await page.getByTestId('call-dock').getAttribute('data-collapsed'), 'false', 'switching accounts resets collapse');
    assert.deepEqual(errors, []); console.log(`PASS ${name}:2/12participants,circular/translucent/click-through,speaking/muted/reconnecting,2Dgrip+avatar+keyboarddrag,keyboardpositionrestore,6game setup+active fullwidth,real timer andlogout`);
    await fs.writeFile(path.join(out, `${name}-summary.json`), JSON.stringify({ browser: name, passed: true, completedAt: new Date().toISOString(), viewportSizes: [[375,667],[390,844],[844,390]], actualGames: ['badeeha','beep','mamnoo','jabeen','fabraka','meenfina'], gameScreens: ['setup','active'], participantCounts: [2,12], freeTwoAxisMovement: true, circleButtons: true, translucentBubbles: true, pointerGapPassthrough: true, gameWidthUnchanged: true, keyboardRestoresPreferredPosition: true, physicalKeyboard: false, liveSFU: false, accountCleanup: true }, null, 2));
  } catch (error) { await screenshot(page, `${name}-failure`); await fs.writeFile(path.join(out, `${name}-failure.txt`), await page.locator('body').innerText()); await fs.writeFile(path.join(out, `${name}-failure.json`), JSON.stringify(await page.evaluate(() => ({ scrollY, viewport: { height: visualViewport.height, top: visualViewport.offsetTop }, nodes: [...document.querySelectorAll('.dialog-host,.modal-layer,.modal,.modal-body,[data-testid="call-dock-resume"]')].map(el => ({ tag: el.className, inline: el.style.cssText, rect: el.getBoundingClientRect().toJSON(), scrollTop: el.scrollTop, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight, height: getComputedStyle(el).height, maxHeight: getComputedStyle(el).maxHeight, overflow: getComputedStyle(el).overflow, transform: getComputedStyle(el).transform })) })), null, 2)); throw error; }
  finally { await context.close(); }
}
let browser;
try {
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}); await run(browser, 'chromium'); await browser.close(); browser = null;
  try { await fs.access(webkit.executablePath()); } catch { console.log('SKIP WebKit: browser binary unavailable.'); }
  if (await fs.access(webkit.executablePath()).then(() => true, () => false)) { browser = await webkit.launch(); await run(browser, 'webkit'); }
  console.log(out);
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }

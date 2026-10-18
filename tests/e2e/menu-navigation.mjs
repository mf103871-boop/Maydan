// Full platform shell; only account/server/native-media responses are fixtures.
// Verifies browser layout and state integration, not live calls or a real keyboard.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium, webkit } from 'playwright';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';

const me = { id: 'me', userId: 'me', name: 'عمر', code: 'MDN-OMAR', avatarPreset: 'falcon' };
const peers = Array.from({ length: 28 }, (_, index) => ({ id: `person-${index + 1}`, userId: `person-${index + 1}`, name: ['أحمد', 'ليان', 'سارة', 'خالد', 'نور', 'لينا', 'كريم', 'ريم', 'سامي', 'جود', 'رنا'][index] || `صديق ${index + 1}`, avatarPreset: ['lion', 'cat', 'falcon'][index % 3], online: index % 2 === 0, conversationId: `direct-${index + 1}` }));
const members = [me, ...peers.slice(0, 11)];
const group = { id: 'group-1', name: 'شلّة الخميس', ownerId: me.id, role: 'owner', memberCount: 12, avatarPreset: 'falcon' };
const call = { id: 'voice-1', scope: 'group', name: 'مكالمة الشلّة', conversationId: group.id, status: 'active', acceptedAt: Date.now() - 20000, participants: members.map(user => ({ userId: user.id, state: 'active', ...(user.id === me.id ? { deviceId: 'fixture-device' } : {}) })) };
const messages = [{ seq: 1, senderId: peers[0].id, clientId: 'initial', kind: 'text', text: 'جاهزين نلعب مع بعض؟', createdAt: Date.now() - 10000 }];
let unread = true;
async function api(url, method, body, owner) {
  if (url === '/api/fixture/unread') { unread = body.enabled; return {}; }
  const owned = owner === 'me';
  if (url === '/api/social/state') return { user: owned ? me : { id: owner, name: 'حساب آخر' }, friends: owned ? peers : [], incoming: owned ? [{ id: 'request-1', user: { id: 'new-friend', name: 'هدى', avatarPreset: 'cat' } }] : [], outgoing: [], blocked: [], conversations: owned ? peers.map((user, index) => ({ id: user.conversationId, user, unreadCount: unread && index === 0 ? 2 : 0, lastMessage: { text: 'جاهزين نلعب؟', createdAt: Date.now() - index * 1000 } })) : [] };
  if (url === '/api/social/groups') return { groups: owned ? [{ ...group, unreadCount: unread ? 3 : 0 }] : [], incoming: [] };
  if (url === '/api/social/groups/group-1') return { group, members: members.map(user => ({ ...user, role: user.id === me.id ? 'owner' : 'member' })), invitations: [] };
  if (/\/messages(?:\?|$)/.test(url)) {
    if (method === 'POST') messages.push({ ...body, seq: messages.length + 1, senderId: me.id, createdAt: Date.now() });
    return { messages, readSeq: 0, peerReadSeq: 0, hasMore: false };
  }
  if (url.endsWith('/read')) return { readSeq: body?.seq || 0 };
  if (url === '/api/social/calls') return { calls: owned ? [call] : [] };
  if (url === '/api/social/calls/voice-1') return { call };
  if (url === '/api/social/preferences') return { preferences: { messages: true, calls: true, previews: false, sound: false, mutedConversations: [] } };
  if (url === '/api/social/capabilities') return { capabilities: { voiceMessages: true, liveCalls: true, pushNotifications: true } };
  if (url === '/api/social/live-ticket') return { error: 'SOCIAL_UNAVAILABLE' };
  if (url.startsWith('/api/profiles/')) return { profile: { ...(members.find(user => url.includes('/' + user.id)) || (owned ? me : { id: owner, name: 'حساب آخر' })), relationship: url.endsWith('/me') ? 'self' : 'friend', stats: {}, achievements: [], featuredBadges: [], earnedBadges: [], earnedTitles: [] } };
  return {};
}

const bundle = await build({ stdin: { contents: `
import React,{useState}from'react';import{createRoot}from'react-dom/client';
import{AccountContext,NULL_ACCOUNT}from'./src/shared/account/context.js';import{PlatformContext}from'./src/platform/context.js';
import{SocialProvider,useSocial}from'./src/social/SocialProvider.jsx';import{LammaProvider,useLamma}from'./src/social/LammaProvider.jsx';
import{SocialUIProvider,useSocialUI}from'./src/social/SocialUIProvider.jsx';import{ProfileProvider}from'./src/profiles/ProfileProvider.jsx';
import{PlatformShell}from'./src/platform/PlatformApp.jsx';import{navigate}from'./src/platform/router.js';
import{ToastProvider}from'./src/shared/ui/components.jsx';import{socialInterruption}from'./src/social/interruption.js';
import tokens from'./src/shared/theme/tokens.css';
const members=${JSON.stringify(members)};window.nativeLog=[];
let snapshot={userId:'me',callId:'voice-1',scope:'group',conversationId:'group-1',state:'connected',muted:false,participants:members.map(user=>({id:user.id,userId:user.id,name:user.name,local:user.id==='me',muted:false,speaking:user.id==='person-1'}))};
const sendSnapshot=patch=>{snapshot={...snapshot,...patch};window.maydanNative.event('socialCall',snapshot)};
window.MaydanNative={postMessage(raw){const message=JSON.parse(raw);window.nativeLog.push({type:message.type,muted:message.muted});queueMicrotask(()=>{if(message.type==='socialCallMute')sendSnapshot({muted:message.muted});window.maydanNative.resolve(message.id,{ok:true,result:{authorized:true,status:'granted'}})})}};
const sound={volume:.75,play(){},stop(){},setDucking(){},music:{volume:.35,play(){},sting(){}}};
const roster=[{id:'a',name:'أحمد',color:'#178879',emoji:'🦊'},{id:'b',name:'عمر',color:'#dc7849',emoji:'🐻'},{id:'c',name:'ليان',color:'#7768b6',emoji:'🐱'}];
const platform={sound,toast(){},settings:{soundOn:false,musicOn:false,hapticsOn:false,splashSeen:true,reducedMotion:true},setSettings(){},haptics:{vibrate(){}},confetti:{fire(){},clear(){}},roster,setRoster(){},storage:{get(){},set(){}},version:'1.8-fixture'};
function Observer(){const lamma=useLamma(),ui=useSocialUI(),social=useSocial();window.fixture={...window.fixture,navigate,getMedia:()=>lamma.media,getCall:()=>lamma.activeCall,getUI:()=>({view:ui.view,drafts:ui.drafts,listState:ui.listState}),openChat:()=>ui.openChat('person-1'),openGroup:()=>ui.openGroup('group-1'),refresh:()=>Promise.all([social.refresh(),lamma.refreshGroups()]),resume:()=>socialInterruption.resume()};return null}
function App(){const[owner,setOwner]=useState('me'),[ready,setReady]=useState(!new URLSearchParams(location.search).has('deferAuth'));window.fixture={...window.fixture,setOwner,finishAuth:()=>setReady(true)};const request=async(url,options={})=>{const response=await fetch(url,{method:options.method||'GET',headers:{'content-type':'application/json','x-fixture-owner':owner||'guest'},body:options.body===undefined?undefined:JSON.stringify(options.body)});const data=await response.json();if(data.error)throw Object.assign(new Error(data.error),{code:data.error});return data};const account={...NULL_ACCOUNT,ready,signedIn:!!owner,user:owner?{id:owner,name:owner==='me'?'عمر':'حساب آخر'}:null,platform:'ios',requestAuthenticated:request,refresh:async()=>{},signOut:async()=>setOwner(null),ensureNativeSocialSession:async()=>({userId:owner,deviceId:'fixture-device',call:owner==='me'?snapshot:null})};return <ToastProvider><AccountContext.Provider value={account}><PlatformContext.Provider value={platform}><style>{tokens}</style><SocialProvider><LammaProvider><SocialUIProvider><ProfileProvider><Observer/><PlatformShell/></ProfileProvider></SocialUIProvider></LammaProvider></SocialProvider></PlatformContext.Provider></AccountContext.Provider></ToastProvider>};createRoot(document.getElementById('root')).render(<App/>);`, loader: 'jsx', resolveDir: process.cwd() }, bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.css': 'text', '.webp': 'dataurl', '.woff2': 'dataurl', '.svg': 'dataurl' }, logLevel: 'silent' });
const html = `<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><div id="root"></div><script>${bundle.outputFiles[0].text}</script></html>`;
const publicRoot = path.resolve('public');
const server = http.createServer(async (req, res) => {
  try {
    if (req.url.startsWith('/api/')) {
      let raw = ''; for await (const chunk of req) raw += chunk;
      const data = await api(req.url, req.method, raw ? JSON.parse(raw) : undefined, req.headers['x-fixture-owner']);
      res.writeHead(data.error ? 503 : 200, { 'content-type': 'application/json' }); res.end(JSON.stringify(data)); return;
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
const out = path.resolve(process.env.MENU_NAV_SCREENSHOT_DIR || '.cache/menu-nav-e2e'); await fs.mkdir(out, { recursive: true });
const nav = page => page.getByTestId('menu-navigation');
const settle = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve)))));
const tab = (page, name) => nav(page).getByRole('link').filter({ hasText: name });
async function route(page, pathname) { await page.evaluate(pathname => window.fixture.navigate(pathname), pathname); await page.waitForFunction(pathname => location.hash === '#' + pathname, pathname); await settle(page); }
async function select(page, name, pathname) { await tab(page, name).click(); await page.waitForFunction(pathname => location.hash === '#' + pathname, pathname); await settle(page); }
async function shot(page, browser, name) {
  if (name !== 'failure') {
    const dismiss = page.getByRole('button', { name: 'إخفاء التنبيه', exact: true });
    for (let index = 0; index < 2 && await dismiss.isVisible(); index++) await dismiss.click();
  }
  await page.evaluate(() => document.fonts.ready); await page.screenshot({ path: path.join(out, `${browser}-${name}.png`) });
}
async function noOverflow(page, label) { assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${label}: no horizontal overflow`); }
async function callAboveMenu(page, label) {
  await page.waitForFunction(() => { const bubble = document.querySelector('[data-testid="call-dock"]')?.getBoundingClientRect(), menu = document.querySelector('[data-testid="menu-navigation"]')?.getBoundingClientRect(); return bubble && menu && bubble.bottom <= menu.top - 7; });
  const state = await page.evaluate(() => ({ call: window.fixture.getCall()?.id, measured: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--menu-nav-space')), height: document.querySelector('[data-testid="menu-navigation"]').getBoundingClientRect().height }));
  assert.equal(state.call, 'voice-1', `${label}: same call survives`); assert.ok(Math.abs(state.measured - state.height) < 1, `${label}: shell publishes actual menu height`);
}
async function run(browser, name) {
  unread = true;
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ar', isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
  const page = await context.newPage(), errors = []; page.on('pageerror', error => errors.push(error.message)); page.setDefaultTimeout(9000);
  await page.route('**/*', request => new URL(request.request().url()).origin === origin ? request.continue() : request.abort());
  await page.addInitScript(() => {
    const viewport = Object.assign(new EventTarget(), { width: 390, height: 844, offsetTop: 0, offsetLeft: 0, scale: 1 });
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport });
    window.setFixtureViewport = patch => { Object.assign(viewport, patch); viewport.dispatchEvent(new Event('resize')); viewport.dispatchEvent(new Event('scroll')); };
  });
  try {
    await page.goto(origin + '/#/'); await nav(page).waitFor(); await page.getByTestId('call-dock').waitFor(); await settle(page);
    assert.equal(await nav(page).getByRole('link').count(), 4);
    const initialBoxes = await nav(page).getByRole('link').evaluateAll(elements => elements.map(el => ({ name: el.innerText, x: el.getBoundingClientRect().x, width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height })));
    assert.ok(initialBoxes.every((box, index) => box.width >= 44 && box.height >= 44 && (!index || box.x < initialBoxes[index - 1].x)), 'four labelled44px tabs follow physical right-to-left order');
    assert.equal(await tab(page, 'الألعاب').getAttribute('aria-current'), 'page');
    assert.equal(await nav(page).boundingBox().then(box => box.height), 76);
    await page.waitForFunction(() => document.querySelector('.menu-navigation-badge')?.textContent === '5');
    assert.equal(await page.locator('.lamma-launcher').isVisible(), false, 'no duplicate launcher on menu pages');
    await page.getByTestId('call-dock-collapse').click(); await page.getByTestId('call-dock-drag').press('End'); await settle(page); await callAboveMenu(page, 'games');
    const nativeBefore = await page.evaluate(() => nativeLog.filter(event => /socialCall(Connect|End)/.test(event.type)).length);
    await shot(page, name, 'games'); await noOverflow(page, 'games');
    await page.evaluate(() => window.scrollTo(0, 420)); await page.waitForFunction(() => scrollY > 200); const homeScroll = await page.evaluate(() => scrollY);
    await select(page, 'المتجر', '/store'); await page.getByRole('heading', { name: 'قريبًا في متجر ميدان', exact: true }).waitFor();
    assert.equal(await page.locator('.store-screen button').count(), 0, 'coming-soon store has no fictitious purchase buttons');
    await callAboveMenu(page, 'store'); await shot(page, name, 'store');
    await select(page, 'الألعاب', '/'); await page.waitForFunction(value => Math.abs(scrollY - value) < 2, homeScroll);
    await tab(page, 'الألعاب').click(); await page.waitForFunction(() => scrollY === 0);
    await select(page, 'الإعدادات', '/settings'); await page.getByRole('heading', { name: 'الصوت والموسيقى', exact: true }).waitFor(); await shot(page, name, 'settings');
    await page.getByRole('button', { name: 'مسح كل البيانات', exact: true }).click(); await page.getByRole('dialog', { name: 'مسح كل البيانات؟', exact: true }).waitFor();
    await page.waitForFunction(() => document.querySelector('[data-testid="menu-navigation"]').hidden);
    assert.ok(await page.locator('#root').evaluate(el => el.inert), 'general dialogs own interaction above the menu');
    await page.getByRole('button', { name: 'إلغاء', exact: true }).click(); await nav(page).waitFor();
    await select(page, 'الأصدقاء', '/friends'); await page.getByRole('region', { name: 'الأصدقاء واللّمة', exact: true }).waitFor();
    assert.equal(await page.locator('.lamma-layer').count(), 0, 'friends tab uses a page rather than a modal drawer');
    assert.equal(await page.getByTestId('call-inline-controls').isVisible(), true, 'friends page owns inline call controls');
    assert.equal(await page.getByTestId('call-dock').isVisible(), false);
    await shot(page, name, 'friends'); await noOverflow(page, 'friends');
    const friendList = page.locator('.lamma-list-scroll');
    await friendList.evaluate(el => { el.scrollTop = 400; el.dispatchEvent(new Event('scroll', { bubbles: true })); }); const listScroll = await friendList.evaluate(el => el.scrollTop); assert.ok(listScroll > 100);
    await select(page, 'المتجر', '/store'); await select(page, 'الأصدقاء', '/friends'); assert.ok(Math.abs(await friendList.evaluate(el => el.scrollTop) - listScroll) < 2, 'friends list scroll survives switching tabs');
    const filters = page.getByRole('group', { name: 'تصفية الأصدقاء', exact: true }); await filters.getByRole('button', { name: 'المتصلون', exact: true }).click();
    const search = page.getByRole('textbox', { name: 'البحث في اللّمة', exact: true }); await search.fill('أحمد');
    await select(page, 'الإعدادات', '/settings'); await select(page, 'الأصدقاء', '/friends'); assert.equal(await search.inputValue(), 'أحمد'); assert.equal(await filters.getByRole('button', { name: 'المتصلون', exact: true }).getAttribute('aria-pressed'), 'true');
    await page.getByRole('button', { name: 'محادثة مع أحمد', exact: true }).click(); await page.waitForFunction(() => location.hash === '#/friends/person-1');
    await page.getByRole('textbox', { name: 'اكتب رسالة', exact: true }).fill('مسودة لا تضيع 🎮'); await page.waitForFunction(() => document.querySelector('[data-testid="menu-navigation"]').hidden);
    await page.getByRole('button', { name: 'العودة للّمة', exact: true }).first().click(); await nav(page).waitFor(); await select(page, 'المتجر', '/store'); await select(page, 'الأصدقاء', '/friends');
    await page.getByRole('button', { name: 'محادثة مع أحمد', exact: true }).click(); assert.equal(await page.getByRole('textbox', { name: 'اكتب رسالة', exact: true }).inputValue(), 'مسودة لا تضيع 🎮');
    await page.goBack(); await page.waitForFunction(() => location.hash === '#/friends'); await nav(page).waitFor();
    await search.fill(''); await filters.getByRole('button', { name: 'الكل', exact: true }).click();
    await page.getByRole('navigation', { name: 'أقسام اللّمة', exact: true }).getByRole('button', { name: /اللّمات/ }).click(); await page.getByRole('button', { name: /شلّة الخميس/ }).click();
    await page.waitForFunction(() => location.hash === '#/friends/group/group-1'); await page.getByText('جاهزين نلعب مع بعض؟', { exact: true }).waitFor(); assert.equal(await nav(page).isVisible(), false);
    await page.getByRole('textbox', { name: 'اكتب رسالة', exact: true }).fill('مسودة للشلّة'); await page.getByRole('button', { name: 'العودة للّمة', exact: true }).first().click(); await nav(page).waitFor();
    await select(page, 'المتجر', '/store'); await route(page, '/friends/group/group-1'); assert.equal(await page.getByRole('textbox', { name: 'اكتب رسالة', exact: true }).inputValue(), 'مسودة للشلّة', 'group deep link shares the same draft store');
    await route(page, '/friends'); await nav(page).waitFor(); await page.getByRole('navigation', { name: 'أقسام اللّمة', exact: true }).getByRole('button', { name: 'الأصدقاء', exact: true }).click();
    await search.focus(); await page.evaluate(() => window.setFixtureViewport({ height: 420, offsetTop: 24 })); await page.waitForFunction(() => document.querySelector('[data-testid="menu-navigation"]').hidden);
    assert.ok(await search.evaluate(el => parseFloat(getComputedStyle(el).fontSize) >= 16), 'typing remains zoom safe');
    await page.evaluate(() => { document.activeElement.blur(); window.setFixtureViewport({ height: 844, offsetTop: 0 }); }); await nav(page).waitFor();
    await select(page, 'المتجر', '/store'); await page.evaluate(async () => { await fetch('/api/fixture/unread', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled: false }) }); await window.fixture.refresh(); });
    await page.locator('.menu-navigation-dot').waitFor(); assert.equal(await page.locator('.menu-navigation-badge').count(), 0, 'request dot appears when no unread messages remain');
    await select(page, 'الألعاب', '/'); await route(page, '/game/fabraka'); await page.locator('.details-hero').waitFor(); await nav(page).waitFor();
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight)); await settle(page);
    const sticky = await page.locator('.setup-sticky').boundingBox(), menu = await nav(page).boundingBox(); assert.ok(sticky.y + sticky.height <= menu.y + 1, 'game-detail actions remain above the menu');
    assert.ok(await page.locator('.call-game-viewport > .screen').evaluate(el => parseFloat(getComputedStyle(el).paddingBottom) >= parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--menu-nav-space'))));
    await noOverflow(page, 'game details');
    for (const id of ['badeeha', 'beep', 'mamnoo', 'jabeen', 'fabraka', 'meenfina']) {
      await route(page, '/play/' + id); await page.locator('.game-frame').waitFor(); await page.waitForFunction(() => !document.querySelector('.game-loading'));
      assert.equal(await nav(page).isVisible(), false, `${id}: menu hidden throughout setup/play route`); assert.equal(await page.locator('.lamma-launcher').isVisible(), true, `${id}: social entry remains available`); await noOverflow(page, id);
      if (id === 'fabraka') {
        await page.locator('.lamma-launcher').click(); await page.getByRole('dialog', { name: 'الأصدقاء واللّمة', exact: true }).waitFor();
        assert.equal(await nav(page).isVisible(), false, 'in-game social drawer cannot reveal the menu');
        await page.getByRole('button', { name: 'إغلاق اللّمة والعودة للعبة', exact: true }).click();
        assert.equal(await page.evaluate(() => location.hash), '#/play/fabraka', 'closing in-game friends preserves the setup route');
        await page.evaluate(() => window.fixture.resume());
      }
    }
    await route(page, '/room/123456'); await page.locator('.online-screen').waitFor(); assert.equal(await nav(page).isVisible(), false, 'room route hides bottom menu');
    await route(page, '/'); await nav(page).waitFor();
    await page.setViewportSize({ width: 844, height: 390 }); await page.evaluate(() => window.setFixtureViewport({ width: 844, height: 390 })); await settle(page);
    await page.waitForFunction(() => document.querySelector('[data-testid="menu-navigation"]').getBoundingClientRect().height === 64);
    await callAboveMenu(page, 'landscape games'); await noOverflow(page, 'landscape games'); await shot(page, name, 'games-landscape');
    await select(page, 'الأصدقاء', '/friends'); await page.getByRole('region', { name: 'الأصدقاء واللّمة', exact: true }).waitFor(); await noOverflow(page, 'landscape friends');
    const friendsRect = await page.locator('.lamma-page-panel').boundingBox(), landscapeMenu = await nav(page).boundingBox(); assert.ok(friendsRect.y + friendsRect.height <= landscapeMenu.y + 1, 'landscape friends panel fits above menu'); await shot(page, name, 'friends-landscape');
    await page.evaluate(() => window.fixture.openChat()); await page.getByRole('textbox', { name: 'اكتب رسالة', exact: true }).waitFor(); await noOverflow(page, 'landscape chat'); assert.equal(await nav(page).isVisible(), false); await shot(page, name, 'chat-landscape');
    await page.getByRole('button', { name: 'العودة للّمة', exact: true }).first().click(); await select(page, 'المتجر', '/store');
    assert.equal(await page.evaluate(() => nativeLog.filter(event => /socialCall(Connect|End)/.test(event.type)).length), nativeBefore, 'all menu and conversation navigation keeps media connection intact');
    await page.evaluate(() => window.fixture.setOwner(null)); await page.waitForFunction(() => !window.fixture.getCall()); assert.equal(await page.getByTestId('call-dock').count(), 0);
    await select(page, 'الأصدقاء', '/friends'); await page.getByRole('heading', { name: 'الجمعة تبدأ بأصحابك', exact: true }).waitFor(); assert.equal(await page.locator('.menu-navigation-badge,.menu-navigation-dot').count(), 0); assert.equal(await page.getByRole('button', { name: 'محادثة مع أحمد', exact: true }).count(), 0);
    await page.evaluate(() => window.fixture.setOwner('other-account')); await page.getByRole('button', { name: 'أضف صديقًا', exact: true }).first().waitFor();
    assert.deepEqual(await page.evaluate(() => window.fixture.getUI().drafts), {}); assert.deepEqual(await page.evaluate(() => window.fixture.getUI().listState), {}); assert.equal(await page.getByTestId('call-dock').count(), 0, 'account switch cannot inherit the previous call');
    await page.setViewportSize({ width: 390, height: 844 }); await page.evaluate(() => window.setFixtureViewport({ width: 390, height: 844 })); await settle(page); await shot(page, name, 'new-account');
    assert.deepEqual(errors, []);
    const result = { browser: name, passed: true, completedAt: new Date().toISOString(), actualShell: true, viewports: [[390, 844], [844, 390]], fourMenuSections: true, actualGames: ['badeeha', 'beep', 'mamnoo', 'jabeen', 'fabraka', 'meenfina'], nativeCallFixture: true, liveSFU: false, physicalKeyboard: false, keyboardViewportFixture: true, callSurvivesNavigation: true, callBoundsAvoidActualMenu: true, directAndGroupDeepLinks: true, browserAndUIBack: true, conversationDrafts: true, searchAndFilters: true, windowAndFriendsScrollRestore: true, modalAndKeyboardHideMenu: true, guestAndAccountPrivacy: true };
    await fs.writeFile(path.join(out, `${name}-summary.json`), JSON.stringify(result, null, 2)); console.log(`PASS ${name}: actual platform shell, four menus, page/direct/group/drawer routes, drafts/scroll/filters, call/menu bounds, six game setup routes, keyboard/modal, guest/account reset`);
  } catch (error) {
    await shot(page, name, 'failure'); await fs.writeFile(path.join(out, `${name}-failure.txt`), await page.locator('body').innerText());
    await fs.writeFile(path.join(out, `${name}-failure.json`), JSON.stringify(await page.evaluate(() => ({ hash: location.hash, scrollY, ui: window.fixture?.getUI(), media: window.fixture?.getMedia(), viewport: { width: visualViewport.width, height: visualViewport.height }, nodes: [...document.querySelectorAll('[data-testid="menu-navigation"],.lamma-page-panel,.lamma-list-scroll,.call-dock-viewport,.call-dock')].map(el => ({ tag: el.className, hidden: el.hidden, rect: el.getBoundingClientRect().toJSON(), display: getComputedStyle(el).display, height: getComputedStyle(el).height, paddingBottom: getComputedStyle(el).paddingBottom, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight })) })), null, 2)); throw error;
  } finally { await context.close(); }
}
async function runColdHydration(browser, name) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ar', isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
  const tested = [];
  try {
    for (const pathname of ['/friends/person-1', '/friends/group/group-1']) {
      const page = await context.newPage();
      await page.route('**/*', request => new URL(request.request().url()).origin === origin ? request.continue() : request.abort());
      await page.goto(origin + '/?deferAuth=1#' + pathname);
      await page.getByRole('region', { name: 'الأصدقاء واللّمة', exact: true }).waitFor();
      assert.equal(await page.evaluate(() => location.hash), '#' + pathname, 'loading account preserves its initial deep link');
      await page.evaluate(() => window.fixture.finishAuth());
      await page.getByRole('textbox', { name: 'اكتب رسالة', exact: true }).waitFor();
      assert.equal(await page.evaluate(() => location.hash), '#' + pathname, 'first account hydration opens its original conversation');
      assert.equal(await nav(page).isVisible(), false, 'hydrated conversation hides the menu');
      tested.push(pathname); await page.close();
    }
    await fs.writeFile(path.join(out, `${name}-cold-hydration.json`), JSON.stringify({ browser: name, passed: true, paths: tested, firstRealAccountPreservesDeepLink: true, completedAt: new Date().toISOString() }, null, 2));
    console.log(`PASS ${name}: cold account hydration preserves direct and group deep links in the actual shell`);
  } finally { await context.close(); }
}
let browser;
try {
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}); if (!process.env.MENU_NAV_COLD_ONLY) await run(browser, 'chromium'); await runColdHydration(browser, 'chromium'); await browser.close(); browser = null;
  if (await fs.access(webkit.executablePath()).then(() => true, () => false)) { browser = await webkit.launch(); if (!process.env.MENU_NAV_COLD_ONLY) await run(browser, 'webkit'); await runColdHydration(browser, 'webkit'); }
  else console.log('SKIP WebKit: browser binary unavailable.');
  console.log(out);
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }

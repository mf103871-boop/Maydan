// Real SocialHost, LammaProvider, CallDock and Play components. Remote/native media
// events are deterministic fixtures: this verifies layout and UI, not a live SFU
// or the physical iPhone keyboard. Run: node tests/e2e/call-dock.mjs.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium, webkit } from 'playwright';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';

const me = { id: 'me', userId: 'me', name: 'عمر', code: 'MDN-OMAR', avatarPreset: 'human-02' };
const peers = Array.from({ length: 11 }, (_, i) => ({ id: `person-${i + 1}`, userId: `person-${i + 1}`, name: ['أحمد', 'ليان', 'سارة', 'خالد', 'نور', 'لينا', 'كريم', 'ريم', 'سامي', 'جود', 'رنا'][i], avatarPreset: ['human-03', 'human-04', 'falcon'][i % 3], online: true, ...(i === 1 ? { avatarUrl: '/api/profiles/person-2/images/avatar/' + 'a'.repeat(64) } : {}) }));
const members = [me, ...peers];
const group = { id: 'group-1', name: 'شلّة الخميس', ownerId: me.id, role: 'owner', memberCount: 12, avatarPreset: 'falcon' };
const call = { id: 'voice-1', scope: 'group', name: 'مكالمة الشلّة', conversationId: group.id, status: 'active', acceptedAt: Date.now() - 20000, participants: members.map(user => ({ userId: user.id, state: 'active', ...(user.id === me.id ? { deviceId: 'fixture-device' } : {}) })) };
const reads = [];
let offeredCall = null;
const messages = [
  { seq: 1, senderId: peers[0].id, clientId: 'initial', kind: 'text', text: 'جاهزين نلعب مع بعض؟', createdAt: Date.now() - 10000 },
  { seq: 2, senderId: me.id, clientId: 'response', kind: 'text', text: 'تمام، بعد دقيقة.', createdAt: Date.now() - 7000 },
];
async function api(url, method, body) {
  reads.push({ url, method });
  if (url === '/api/social/state') return {
    user: me,
    friends: peers.map((user, i) => ({ ...user, conversationId: `direct-${i + 1}` })),
    incoming: [], outgoing: [], blocked: [],
    conversations: peers.slice(0, 3).map((user, i) => ({
      id: `direct-${i + 1}`, user, unreadCount: i < 2 ? 3 - i : 0,
      lastMessage: { ...messages[0], senderId: user.id, text: ['جاهزين نلعب؟', 'بنلتقي الساعة 9', 'أنا جاهزة'][i], createdAt: messages[0].createdAt - i * 1000 },
    })),
  };
  if (url === '/api/social/groups') return { groups: [group], incoming: [] };
  if (url === '/api/social/groups/group-1') return { group, members: members.map(user => ({ ...user, role: user.id === me.id ? 'owner' : 'member' })), invitations: [] };
  if (url.startsWith('/api/social/groups/group-1/messages') || url.startsWith('/api/social/conversations/direct-1/messages')) {
    if (method === 'POST') messages.push({ ...body, seq: messages.length + 1, senderId: me.id, createdAt: Date.now() });
    return { messages, readSeq: 0, peerReadSeq: 0, hasMore: false };
  }
  if (url.endsWith('/read')) return { readSeq: body?.seq || 0 };
  if (url === '/api/social/calls') return { calls: [offeredCall || call] };
  if (url === '/api/social/calls/' + call.id) return { call };
  if (offeredCall && url === '/api/social/calls/' + offeredCall.id) return { call: offeredCall };
  if (offeredCall && method === 'POST') {
    if (url === `/api/social/calls/${offeredCall.id}/reject`) {
      offeredCall.status = 'rejected';
      return { call: offeredCall };
    }
    if (url === `/api/social/calls/${offeredCall.id}/accept`) {
      offeredCall.status = 'active';
      offeredCall.acceptedAt = Date.now();
      offeredCall.participants[0] = { userId: me.id, state: 'active', deviceId: body.deviceId };
      return { call: offeredCall, connection: { url: 'wss://fake.invalid', token: 'fixture-token' } };
    }
  }
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
import{Home}from'./src/platform/screens/Home.jsx';import{ErsomhaMatch}from'./src/online/Ersomha.jsx';
import{navigate,useRoute}from'./src/platform/router.js';import{BottomNavigation}from'./src/platform/BottomNavigation.jsx';
import{setUiLocale}from'./src/shared/i18n/core.js';
import{BrandFonts}from'./src/shared/brand/art.jsx';import{Modal,Button}from'./src/shared/ui/components.jsx';
import css from'./src/shared/ui/ui.css';import tokens from'./src/shared/theme/tokens.css';import brand from'./src/shared/brand/brand.css';
import platformCss from'./src/platform/platform.css';import setupCss from'./src/shared/setup/setup.css';import onlineCss from'./src/online/online.css';import playfulCss from'./src/platform/playful-studio.css';
import identityCss from'./src/profiles/identity.css';
const members=${JSON.stringify(members)};
const nativeLog=[];window.nativeLog=nativeLog;window.nativeSessionOwners=[];
let snapshot={userId:'me',callId:'voice-1',scope:'group',conversationId:'group-1',state:'connected',muted:false,participants:members.map(user=>({id:user.id,userId:user.id,name:user.name,local:user.id==='me',muted:false,speaking:false}))};
const sendSnapshot=patch=>{snapshot={...snapshot,...patch};window.maydanNative.event('socialCall',snapshot)};
window.MaydanNative={postMessage(raw){
  const message=JSON.parse(raw);
  nativeLog.push({type:message.type,muted:message.muted,speaker:message.speaker});
  queueMicrotask(()=>{
    let result={authorized:true,status:'granted'};
    if(message.type==='socialCallEnd'&&message.callId===snapshot.callId)sendSnapshot({state:'ended'});
    if(message.type==='socialCallMute')sendSnapshot({muted:message.muted});
    if(message.type==='socialCallSpeaker')sendSnapshot({speaker:message.speaker});
    if(message.type==='socialCallConnect'){
      sendSnapshot({callId:message.callId,scope:message.scope,conversationId:message.conversationId,state:'connected',muted:message.muted,participants:snapshot.participants.slice(0,2)});
      result=snapshot;
    }
    window.maydanNative.resolve(message.id,{ok:true,result});
  });
}};
const request=async(url,options={})=>{const response=await fetch(url,{method:options.method||'GET',cache:'no-store',headers:{'content-type':'application/json'},body:options.body===undefined?undefined:JSON.stringify(options.body)});const data=await response.json();if(data.error)throw Object.assign(new Error(data.error),{code:data.error});return data};
const sound={play(){},setDucking(){},music:{play(){},sting(){},scene(){},releaseScene(){}}};
const roster=[{id:'a',name:'أحمد',color:'#178879',emoji:'🦊'},{id:'b',name:'عمر',color:'#dc7849',emoji:'🐻'},{id:'c',name:'ليان',color:'#7768b6',emoji:'🐱'}];
const platform={sound,toast(){},settings:{soundOn:false,reducedMotion:true},setSettings(){},haptics:{vibrate(){}},confetti:{fire(){}},roster,setRoster(){},storage:{get(){},set(){}}};
const drawingCommands=[];
const drawingListeners=new Set();
const drawingClient={ws:{bufferedAmount:0},subscribeDrawing(listener){drawingListeners.add(listener);return()=>drawingListeners.delete(listener);},async command(type,fields){
  drawingCommands.push({type,fields});
  if(type==='drawing_sync')setTimeout(()=>drawingListeners.forEach(listener=>listener({type:'drawing',kind:'sync',matchId:1,round:1,epoch:1,seq:0,ops:[],undoneIds:[],chunk:0,chunks:1})),0);
  return{ok:true};
}};
function Drawing(){
  const [state]=useState(()=>({game:'ersomha',phase:'draw',code:'123456',matchId:1,round:1,rounds:2,drawerId:'me',mode:'cooperative',settings:{cycles:1,difficulty:'easy',categories:[]},deadlineAt:Date.now()+60000,participants:['me','person-1'],members:members.slice(0,2).map(member=>({...member,avatar:0,score:0,connected:true})),drawing:{epoch:1,seq:0},myWord:document.documentElement.lang==='en'?'Train':'قطار',category:'transport',publicWord:{wordLengths:[],letters:[]},guessedIds:[],recentGuesses:[]}));
  return <main className="screen online-screen stack"><ErsomhaMatch state={state} me={state.members[0]} disabled={false} isHost act={async()=>true} client={drawingClient} status="connected" drawerReady/></main>;
}
function Observer(){const lamma=useLamma(),ui=useSocialUI(),account=React.useContext(AccountContext);window.fixture={...window.fixture,patchMedia:sendSnapshot,getMedia:()=>lamma.media,getCall:()=>lamma.activeCall,getCallList:()=>lamma.calls,getOwner:()=>account.user?.id||null,refreshCalls:()=>lamma.refreshGroups({quiet:true}),openFriends:ui.show,closeFriends:ui.close,openChat:()=>ui.openChat('person-1'),openGroup:()=>ui.openGroup('group-1'),private:()=>{window.releasePrivate?.();window.releasePrivate=socialInterruption.private('fixture-private')},releasePrivate:()=>{window.releasePrivate?.();window.releasePrivate=null}};return null}
function App(){
  const [owner,setOwner]=useState('me'),[game,setGame]=useState(location.hash==='#/'?'home':'fabraka'),[modal,setModal]=useState(false);
  const route=useRoute(),studio=new URLSearchParams(location.search).has('locale');
  window.fixture={...window.fixture,setOwner,drawingCommands,setGame:id=>{
    const path=id==='home'?'/':id==='ersomha'?'/room/123456':'/play/'+id;
    if(studio)navigate(path,{replace:true});else location.hash='#'+path;
    socialInterruption.setContext({local:false});socialInterruption.resume();setGame(id);
  },openModal:()=>setModal(true)};
  window.interruption=socialInterruption;
  const account={...NULL_ACCOUNT,ready:true,signedIn:!!owner,user:owner?{id:owner,name:'عمر'}:null,requestAuthenticated:request,ensureNativeSocialSession:async()=>{
    window.nativeSessionOwners.push(owner);
    return{userId:owner,deviceId:'fixture-device',call:snapshot};
  }};
  return <AccountContext.Provider value={account}><PlatformContext.Provider value={platform}><BrandFonts/><style>{tokens}</style><style>{css}</style><style>{brand}</style><style>{platformCss}</style><style>{setupCss}</style><style>{onlineCss}</style><style>{playfulCss}</style><style>{identityCss}</style><SocialProvider><LammaProvider><SocialUIProvider><ProfileProvider><Observer/><CallViewport>{route.name==='friends'||route.name==='friend-group'?<div data-social-page-slot/>:game==='home'?<Home/>:game==='ersomha'?<Drawing/>:<Play key={game} id={game}/>}</CallViewport>{studio&&<BottomNavigation route={route}/>}<SocialHost/>{modal&&<Modal title="فوق أدوات المكالمة" onClose={()=>setModal(false)} footer={<Button onClick={()=>setModal(false)}>إغلاق الاختبار</Button>}><p>الحوار العام يبقى أعلى شريط الصوت.</p></Modal>}</ProfileProvider></SocialUIProvider></LammaProvider></SocialProvider></PlatformContext.Provider></AccountContext.Provider>;
}
setUiLocale(new URLSearchParams(location.search).get('locale')).then(()=>createRoot(document.getElementById('root')).render(<App/>));`, loader: 'jsx', resolveDir: process.cwd() }, bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.css': 'text', '.webp': 'dataurl', '.woff2': 'dataurl', '.svg': 'dataurl' }, logLevel: 'silent' });
const html = `<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script>${bundle.outputFiles[0].text}</script></html>`;
const publicRoot = path.resolve('public');
const server = http.createServer(async (req, res) => {
  try {
    if (req.url.startsWith('/api/')) {
      let raw = ''; for await (const chunk of req) raw += chunk;
      const data = await api(req.url, req.method, raw ? JSON.parse(raw) : undefined);
      res.writeHead(data === null ? 404 : data.error ? 503 : 200, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(data || {})); return;
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
  // ResizeObserver and React both update after a viewport change. Read the
  // settled dock and visual viewport atomically, rather than on separate frames.
  await page.waitForFunction(() => {
    const dock = document.querySelector('[data-testid="call-dock"]')?.getBoundingClientRect();
    return dock && dock.x >= visualViewport.offsetLeft - 1 && dock.right <= visualViewport.offsetLeft + visualViewport.width + 1 && dock.y >= visualViewport.offsetTop - 1 && dock.bottom <= visualViewport.offsetTop + visualViewport.height + 1;
  });
  const { dock, viewport } = await page.evaluate(() => ({ dock: document.querySelector('[data-testid="call-dock"]').getBoundingClientRect().toJSON(), viewport: { width: visualViewport.width, height: visualViewport.height, left: visualViewport.offsetLeft, top: visualViewport.offsetTop } }));
  assert.ok(dock.x >= viewport.left - 1 && dock.x + dock.width <= viewport.left + viewport.width + 1 && dock.y >= viewport.top - 1 && dock.y + dock.height <= viewport.top + viewport.height + 1, `${label}: floating bubbles stay in visual viewport ${JSON.stringify({ dock, viewport })}`);
  const layout = await page.getByTestId('call-game-viewport').evaluate(el => { const active = el.getBoundingClientRect().width, attr = document.documentElement.getAttribute('data-call-dock-active'); document.documentElement.removeAttribute('data-call-dock-active'); const inactive = el.getBoundingClientRect().width; if (attr !== null) document.documentElement.setAttribute('data-call-dock-active', attr); return { active, inactive, viewport: innerWidth }; });
  assert.ok(Math.abs(layout.active - layout.inactive) < 1 && Math.abs(layout.active - layout.viewport) < 1, `${label}: call overlay reserves no game width ${JSON.stringify(layout)}`);
  assert.equal(await page.getByTestId('call-dock').evaluate(el => getComputedStyle(el).pointerEvents), 'none', `${label}: transparent parent does not intercept the game`);
  const launcher = await page.locator('.lamma-launcher').boundingBox(); assert.ok(launcher, `${label}: friends remain reachable`);
  assert.ok(launcher.x >= -1 && launcher.x + launcher.width <= (await page.evaluate(() => innerWidth)) + 1, `${label}: friends launcher stays inside the screen`);
  assert.ok(launcher.width >= 48 && launcher.height >= 48, `${label}: friends launcher has a 48px target`);
  const launcherAvatars = await page.locator('.lamma-launcher-faces > .player-avatar').evaluateAll(elements => elements.filter(el => getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden' && el.getBoundingClientRect().width > 0).map(el => el.getBoundingClientRect().toJSON()));
  assert.equal(launcherAvatars.length, 1, `${label}: compact launcher paints exactly one avatar despite inline avatar styles`);
  const launcherChildOverflow = await page.locator('.lamma-launcher *').evaluateAll(elements => elements.filter(el => { const style = getComputedStyle(el), rect = el.getBoundingClientRect(), owner = el.closest('.lamma-launcher').getBoundingClientRect(); return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0 && (rect.left < Math.max(0,owner.left) - 1 || rect.right > Math.min(innerWidth,owner.right) + 1 || rect.top < -1 || rect.bottom > innerHeight + 1); }).map(el => ({ className: el.getAttribute('class'), rect: el.getBoundingClientRect().toJSON() })));
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
  await page.locator('[data-design-screen="setup.fabraka"]').waitFor();
  const pacing=page.locator('.fab-pacing');
  if(await pacing.count() && !await pacing.evaluate(el=>el.open))await pacing.locator('summary').click();
  await page.locator('[data-design-id="setting-write-time"]').getByRole('button',{name:/30/}).click();
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
async function menuBarBounds(page) {
  // The shell publishes a measured bar size including the device safe area.
  // Change it without resizing the window to exercise the real dock observers.
  await page.getByTestId('call-dock-collapse').click();
  await page.getByTestId('call-dock-drag').press('End'); await settle(page);
  const before = await page.getByTestId('call-dock').boundingBox();
  const nativeActionsBefore = await page.evaluate(() => nativeLog.length);
  await page.evaluate(() => {
    document.documentElement.style.setProperty('--menu-nav-space', '110px');
    document.documentElement.setAttribute('data-menu-nav-visible', '');
    const bar = document.createElement('div'); bar.id = 'menu-nav-fixture';
    bar.style.cssText = 'position:fixed;left:0;right:0;bottom:0;height:110px;pointer-events:none;z-index:300;background:#168d8955';
    document.body.append(bar);
  });
  await page.waitForFunction(() => document.querySelector('.call-dock-viewport').clientHeight === 844 - 16 - 110);
  await settle(page);
  const menu = await page.getByTestId('call-dock').boundingBox();
  const bar = await page.locator('#menu-nav-fixture').boundingBox();
  assert.ok(menu.y + menu.height <= bar.y - 8 + 1, 'floating call stays above the measured menu including its safe area');
  assert.ok(Math.abs(before.x - menu.x) < 1 && menu.y < before.y, 'menu insertion only clamps the displayed vertical position');
  await page.evaluate(() => {
    document.documentElement.style.setProperty('--menu-nav-space', '130px');
    document.getElementById('menu-nav-fixture').style.height = '130px';
  });
  await page.waitForFunction(() => document.querySelector('.call-dock-viewport').clientHeight === 844 - 16 - 130);
  await settle(page);
  const tallerMenu = await page.getByTestId('call-dock').boundingBox();
  assert.ok(Math.abs(menu.y - tallerMenu.y - 20) < 1, 'updated bar measurement reclamps without a route or viewport resize');
  await page.evaluate(() => {
    document.documentElement.style.setProperty('--menu-nav-space', '0px');
    document.documentElement.removeAttribute('data-menu-nav-visible');
    document.getElementById('menu-nav-fixture').remove();
  });
  await page.waitForFunction(() => document.querySelector('.call-dock-viewport').clientHeight === 844 - 16 - 56);
  await settle(page);
  const restored = await page.getByTestId('call-dock').boundingBox();
  assert.ok(Math.abs(before.x - restored.x) < 1 && Math.abs(before.y - restored.y) < 1, 'hiding the menu restores the preferred position above the in-game friends launcher');
  assert.equal(await page.evaluate(() => nativeLog.length), nativeActionsBefore, 'menu changes never reinitialize or change call media');
  await page.getByTestId('call-dock-collapse').click(); await settle(page);
}
async function exerciseGame(page, id, label) {
  if (id === 'badeeha') {
    await page.locator('[data-design-screen="badeeha.setup"]').waitFor();
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
      const portraitChoice=page.getByRole('button', { name:'متابعة بهذا الاتجاه', exact:true });
      if(await portraitChoice.count())await portraitChoice.click();
      await page.getByRole('button', { name: 'ابدأ الجولة', exact: true }).click(); await page.locator('.jabeen-stage').waitFor();
      if (await page.locator('[data-design-id="rotate"]').count()) {
        await geometry(page, `${label}-rotate`); await page.locator('[data-design-id="rotate"] [data-design-id="continue"]').click();
      }
    }
    if (id === 'meenfina') { await page.getByRole('button', { name: 'اعرض العبارة', exact: true }).click(); await page.locator('.meen-count').waitFor(); }
  }
  await settle(page); await geometry(page, `${label}-active`);
}
async function run(browser, name) {
  reads.length = 0;
  call.id = 'voice-1';
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
    await page.waitForFunction(() => {
      const avatar = document.querySelector('[data-testid="call-dock-participant"][data-user-id="person-2"] .player-avatar');
      const photo = avatar?.querySelector('img');
      return avatar && (!photo ? avatar.textContent.trim() : !photo.src.includes('/api/profiles/') && photo.complete && photo.naturalWidth > 0);
    });
    const avatars = page.getByTestId('call-dock-participant').locator('.player-avatar');
    assert.ok((await avatars.first().boundingBox()).width >= 36, 'participant photo is at least36px');
    const buttonBoxes = await page.getByTestId('call-dock').locator('button').evaluateAll(elements => elements.map(el => ({ text: el.getAttribute('aria-label'), width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height })));
    assert.ok(buttonBoxes.every(box => box.width >= 48 && box.height >= 48), `rail targets at least48px ${JSON.stringify(buttonBoxes)}`);
    await geometry(page, 'initial390'); await screenshot(page, `${name}-12-participants`);
    const style = await page.getByTestId('call-dock-participant').first().evaluate(el => { const button=getComputedStyle(el), parent=getComputedStyle(el.closest('.call-dock')), avatar=getComputedStyle(el.querySelector('.player-avatar')); return { radius: button.borderRadius, background: button.backgroundColor, parentBackground: parent.backgroundColor, parentShadow: parent.boxShadow, avatarRadius: avatar.borderRadius, pointer: button.pointerEvents }; });
    assert.equal(style.radius, '50%', 'participant controls are true circles'); assert.equal(style.avatarRadius, '50%', 'profile photos are circular');
    assert.match(style.background, /rgba\(.+,\s*0\.\d+\)/, 'bubbles have a semi-transparent background');
    assert.notEqual(style.parentShadow, 'none', 'the cream rail has a shadow'); assert.equal(style.pointer, 'auto');
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
    assert.ok(Math.abs(avatarMoved.after.x - avatarMoved.before.x)>30 && Math.abs(avatarMoved.after.y-avatarMoved.before.y)>30, `a participant circle can directly drag the floating group: ${JSON.stringify(avatarMoved)}`);
    assert.equal(await page.locator('.call-controls-dialog').count(), 0, 'dragging an avatar suppresses its click action');
    await geometry(page, 'avatar-dragged'); await screenshot(page, `${name}-moved-bubbles`);
    await patch(page, { error: 'اضغط تشغيل الصوت لسماع المكالمة.' });
    await page.getByTestId('call-dock-participant').first().click(); await page.getByTestId('call-dock-resume').click(); await page.waitForFunction(() => !window.fixture.getMedia().error);
    assert.equal(await page.locator('.call-controls-dialog').getByRole('button', { name: 'إنهاء المكالمة', exact: true }).count(), 1, 'end remains accessible in expanded controls');
    await page.locator('.call-controls-dialog').getByTestId('call-dock-end').click(); await page.getByTestId('call-dock').waitFor({ state: 'detached' });
    call.id = 'voice-2';
    await page.evaluate(()=>window.fixture.refreshCalls());
    await patch(page, { callId:call.id, state: 'connected', error: '', muted: false }); await page.getByTestId('call-dock').waitFor();
    const reset = await page.getByTestId('call-dock').boundingBox(); assert.ok(reset.x + reset.width >= 380 && reset.x + reset.width <= 382 && reset.y >= 80 && reset.y < 100, `new call resets below the header on the physical right: ${JSON.stringify(reset)}`);
    assert.equal(await page.getByTestId('call-dock').getAttribute('data-collapsed'), 'false', 'new call resets collapse');
    assert.ok(await page.evaluate(() => nativeLog.some(event => event.type === 'socialCallEnd')), 'end control reaches existing media action');
    await page.evaluate(() => window.fixture.private()); await settle(page);
    const mute = page.getByTestId('call-dock-mute'); assert.equal(await mute.isDisabled(), true, 'secret turn cannot unmute');
    assert.equal(await mute.getAttribute('aria-pressed'), 'true');
    await page.evaluate(() => window.fixture.releasePrivate()); await settle(page); assert.equal(await mute.isDisabled(), false);
    await mute.click(); await page.waitForFunction(() => window.fixture.getMedia().muted === false);
    await menuBarBounds(page);
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
    await page.evaluate(() => window.fixture.setOwner('me')); await settle(page);
    await page.waitForFunction(() => window.nativeSessionOwners.filter(owner => owner === 'me').length >= 2);
    assert.equal(await page.getByTestId('call-dock').count(),0,'returning to an account must not revive the call ended by logout');
    call.id='voice-3';
    // Await the refresh explicitly. A Promise predicate can satisfy the test
    // runner before the asynchronous result has reached the rendered list.
    let listed = false;
    for (let attempt = 0; attempt < 5 && !listed; attempt++) {
      await page.evaluate(async () => {
        try { await window.fixture.refreshCalls(); }
        catch (error) { if (error?.code !== 'STALE') throw error; }
      });
      await settle(page);
      listed = await page.evaluate(id => window.fixture.getOwner() === 'me' && window.fixture.getCallList().some(item => item.id === id), call.id);
    }
    assert.ok(listed, 'the committed account sees the new call from the server');
    assert.equal(await page.getByTestId('call-dock').count(),0,'a new list entry alone cannot revive the ended native call');
    await patch(page,{userId:'me',callId:call.id,state:'connected',error:'',muted:false});
    try { await page.getByTestId('call-dock').waitFor(); }
    catch (error) { throw new Error(await page.evaluate(() => JSON.stringify({ call: window.fixture.getCall()?.id, list: window.fixture.getCallList().map(call => call.id), owner: window.fixture.getOwner(), media: { id: window.fixture.getMedia().callId, ended: window.fixture.getMedia().ended, connected: window.fixture.getMedia().connected }, native: window.nativeSessionOwners })), { cause: error }); }
    await settle(page);
    const relogin = await page.getByTestId('call-dock').boundingBox();
    assert.ok(relogin.x + relogin.width >= 380 && relogin.x + relogin.width <= 382 && relogin.y >= 80 && relogin.y < 100, 'a new call after switching accounts resets below the header');
    assert.equal(await page.getByTestId('call-dock').getAttribute('data-collapsed'), 'false', 'switching accounts resets collapse');
    assert.deepEqual(errors, []); console.log(`PASS ${name}:2/12participants,circular/translucent/click-through,speaking/muted/reconnecting,2Dgrip+avatar+keyboarddrag,keyboardpositionrestore,6game setup+active fullwidth,real timer andlogout`);
    await fs.writeFile(path.join(out, `${name}-summary.json`), JSON.stringify({ browser: name, passed: true, completedAt: new Date().toISOString(), viewportSizes: [[375,667],[390,844],[844,390]], actualGames: ['badeeha','beep','mamnoo','jabeen','fabraka','meenfina'], gameScreens: ['setup','active'], participantCounts: [2,12], freeTwoAxisMovement: true, circleButtons: true, translucentBubbles: true, pointerGapPassthrough: true, gameWidthUnchanged: true, keyboardRestoresPreferredPosition: true, physicalKeyboard: false, liveSFU: false, accountCleanup: true }, null, 2));
  } catch (error) { await screenshot(page, `${name}-failure`); await fs.writeFile(path.join(out, `${name}-failure.txt`), await page.locator('body').innerText()); await fs.writeFile(path.join(out, `${name}-failure.json`), JSON.stringify(await page.evaluate(() => ({ scrollY, viewport: { height: visualViewport.height, top: visualViewport.offsetTop }, nodes: [...document.querySelectorAll('.dialog-host,.modal-layer,.modal,.modal-body,[data-testid="call-dock-resume"]')].map(el => ({ tag: el.className, inline: el.style.cssText, rect: el.getBoundingClientRect().toJSON(), scrollTop: el.scrollTop, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight, height: getComputedStyle(el).height, maxHeight: getComputedStyle(el).maxHeight, overflow: getComputedStyle(el).overflow, transform: getComputedStyle(el).transform })) })), null, 2)); throw error; }
  finally { await context.close(); }
}
async function setViewport(page, width, height, top = 0) {
  await page.setViewportSize({ width, height });
  await page.evaluate(({ width, height, top }) => window.setFixtureViewport({ width, height, offsetTop: top }), { width, height, top });
  await settle(page);
}

async function measureTarget(page, locator) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  assert.ok(box?.width >= 48 && box?.height >= 48, `48px target: ${JSON.stringify(box)}`);
  assert.ok(await locator.evaluate(el => {
    const box = el.getBoundingClientRect();
    const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return !!hit && el.contains(hit);
  }), 'target center receives a pointer');
  return box;
}

async function runStudio(browser, engine, locale) {
  const name = `${engine}-${locale}-studio`;
  call.id = 'voice-1';
  offeredCall = null;
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.setDefaultTimeout(8000);
  await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await page.addInitScript(() => {
    const viewport = Object.assign(new EventTarget(), { width: 390, height: 844, offsetTop: 0, offsetLeft: 0, scale: 1 });
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport });
    window.setFixtureViewport = patch => { Object.assign(viewport, patch); viewport.dispatchEvent(new Event('resize')); viewport.dispatchEvent(new Event('scroll')); };
  });
  const rail = page.getByTestId('call-dock');
  const dialog = page.locator('.call-controls-dialog');
  const inline = page.getByTestId('call-inline-controls');
  const incoming = page.getByTestId('incoming-call');
  try {
    await page.goto(origin + '/?locale=' + locale + '#/');
    await rail.waitFor();
    assert.equal(await page.locator('html').getAttribute('dir'), locale === 'ar' ? 'rtl' : 'ltr');
    const media = await page.evaluate(() => window.fixture.getMedia());
    await patch(page, { participants: media.participants.slice(0, 3).map(person => ({ ...person, speaking: person.userId === 'person-1', muted: person.userId === 'person-2' })) });
    assert.equal(await rail.locator('.call-dock-promoted-name').innerText(), peers[0].name);
    const placement = async () => rail.evaluate(el => {
      const rail = el.getBoundingClientRect();
      const intro = document.querySelector('.studio-home-intro').getBoundingClientRect();
      const friends = document.querySelector('.studio-home-friends').getBoundingClientRect();
      const games = document.querySelector('.home-game-list').getBoundingClientRect();
      return rail.top >= Math.max(intro.bottom, friends.bottom) && rail.left >= games.right + 4;
    });
    assert.ok(await placement(), 'unfolded rail sits beside Home game cards without covering the title or online friends');
    for (const width of [360, 430]) {
      await setViewport(page, width, 844);
      await page.waitForFunction(() => {
        const rail = document.querySelector('[data-testid="call-dock"]').getBoundingClientRect();
        const cards = document.querySelector('.home-game-list').getBoundingClientRect();
        const badeeha = document.querySelector('.home-game-row[data-game="badeeha"]').getBoundingClientRect();
        const mafia = document.querySelector('.home-game-row[data-game="mafia"]').getBoundingClientRect();
        return rail.left >= cards.right + 3 && Math.abs(badeeha.top - mafia.top) < 2;
      });
      await measureTarget(page, page.locator('.studio-home-friends button').first());
      await screenshot(page, `${name}-rail-speaker-${width}`);
    }
    await setViewport(page, 390, 844);
    await screenshot(page, `${name}-rail-speaker-390`);
    const collapse = rail.getByTestId('call-dock-collapse');
    await measureTarget(page, collapse);
    await collapse.click();
    assert.equal(await rail.getAttribute('data-collapsed'), 'true');
    assert.equal(await rail.getByTestId('call-dock-participant').count(), 0);
    assert.equal(await rail.locator('.call-dock-small-count').innerText(), '3');
    assert.ok(await placement(), 'folded rail also starts under the Home title and online friends');
    await screenshot(page, `${name}-rail-folded-390`);
    await rail.getByTestId('call-dock-open').press('Enter');
    await dialog.waitFor();
    assert.equal(await dialog.locator('.call-controls-member').count(), 3);
    assert.equal(await dialog.locator('.call-controls-member[data-speaking="true"] small').innerText(), locale === 'ar' ? 'يتحدث الآن' : 'Speaking now');
    assert.equal(await dialog.locator('.call-controls-member[data-user-id="person-2"] small').innerText(), locale === 'ar' ? 'الميكروفون مكتوم' : 'Microphone muted');
    assert.ok(await dialog.getByText(locale === 'ar' ? 'أنت' : 'You', { exact: true }).isVisible());
    await measureTarget(page, dialog.locator('.modal-head button'));
    await screenshot(page, `${name}-participants-390`);
    const mute = dialog.locator('[data-design-id="mute"]');
    await measureTarget(page, mute);
    await mute.click();
    await page.waitForFunction(() => window.fixture.getMedia().muted);
    await mute.press('Enter');
    await page.waitForFunction(() => !window.fixture.getMedia().muted);
    const output = dialog.getByTestId('call-dock-output');
    await measureTarget(page, output);
    assert.deepEqual(await output.locator('option').allTextContents(), locale === 'ar' ? ['سماعة الهاتف','مكبر الصوت'] : ['Earpiece','Speaker']);
    await output.selectOption('speaker');
    await page.waitForFunction(() => window.fixture.getMedia().outputId === 'speaker');
    for (const width of [360, 390, 430]) {
      await setViewport(page, width, 844);
      const caption = dialog.locator('.call-controls-member[data-user-id="person-1"] small');
      const fontSize = () => caption.evaluate(el => parseFloat(getComputedStyle(el).fontSize));
      const baseSize = await fontSize();
      const textNodes = dialog.locator('h2, .call-meta, .call-controls-heading > strong, .call-controls-member strong, .call-controls-member small, .call-controls-actions button, .call-controls-output > span, select');
      await textNodes.evaluateAll(nodes => {
        const sizes = nodes.map(node => parseFloat(getComputedStyle(node).fontSize));
        nodes.forEach((node, index) => { node.style.fontSize = sizes[index] * 2 + 'px'; });
      });
      await settle(page);
      assert.equal(await fontSize(), baseSize * 2, 'text genuinely doubles');
      await noOverflow(page, `${name}-text200-${width}`);
      await measureTarget(page, mute);
      await measureTarget(page, output);
      await measureTarget(page, dialog.getByTestId('call-dock-end'));
      await dialog.evaluate(el => { el.scrollTop = 0; });
      await screenshot(page, `${name}-participants-text200-${width}`);
      await textNodes.evaluateAll(nodes => nodes.forEach(node => node.style.removeProperty('font-size')));
    }
    await setViewport(page, 390, 844);
    await dialog.getByTestId('call-dock-return').click();
    await inline.waitFor();
    assert.equal(await rail.isVisible(), false);
    await screenshot(page, `${name}-chat-inline-390`);
    await inline.getByTestId('call-dock-open').click();
    await dialog.waitFor();
    assert.ok(await inline.isVisible(), 'call sheet opens above the actual conversation');
    await screenshot(page, `${name}-participants-over-chat-390`);
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'detached' });
    assert.ok(await inline.isVisible(), 'closing tools returns to the same group conversation');
    const composer = page.locator('.social-composer textarea');
    const recorder = page.locator('.social-composer .lamma-recorder.is-unavailable .lamma-voice-start');
    assert.ok(await recorder.isDisabled(), 'an active call disables starting a voice recording');
    const reason = recorder.locator('small');
    assert.equal(await reason.getAttribute('id'), await recorder.getAttribute('aria-describedby'));
    assert.match(await reason.innerText(), locale === 'ar' ? /المكالمة قبل تسجيل/ : /End the call before recording/);
    await composer.fill(locale === 'ar' ? 'مسودة عربية' : 'An English draft');
    await composer.focus();
    await page.evaluate(() => window.setFixtureViewport({ height: 410, offsetTop: 19 }));
    await settle(page);
    await measureTarget(page, page.locator('.social-composer button[type="submit"]'));
    await measureTarget(page, inline.getByTestId('call-dock-mute'));
    await screenshot(page, `${name}-chat-keyboard-390`);
    await setViewport(page, 390, 844);
    await page.evaluate(() => window.fixture.setGame('home'));
    await rail.waitFor();
    assert.equal(await rail.getAttribute('data-collapsed'), 'true', 'fold state survives leaving the conversation');
    await rail.getByTestId('call-dock-collapse').click();

    await setViewport(page, 844, 390);
    await page.evaluate(() => { window.fixture.setGame('ersomha'); window.fixture.private(); });
    const canvas = page.locator('canvas.ers-board');
    await canvas.waitFor();
    const focus = page.locator('[data-ersomha-drawing-focus="true"]');
    if (!await focus.count()) await page.locator('[data-design-id="orientation"]').click();
    await focus.waitFor();
    await page.getByTestId('menu-navigation').waitFor({ state: 'hidden' });
    await settle(page);
    await focus.locator('.ers-colours .ers-colour:visible').nth(1).click();
    const canvasBox = await canvas.boundingBox();
    await page.mouse.move(canvasBox.x + canvasBox.width * .25, canvasBox.y + canvasBox.height * .52);
    await page.mouse.down();
    for (const [x, y] of [[.35,.42],[.45,.44],[.55,.53],[.65,.55],[.75,.43]]) {
      await page.mouse.move(canvasBox.x + canvasBox.width * x, canvasBox.y + canvasBox.height * y, { steps: 5 });
    }
    await page.mouse.up();
    await page.waitForFunction(() => window.fixture.drawingCommands.some(command => command.type === 'drawing_batch'));
    assert.equal(await rail.getByTestId('call-dock-mute').isDisabled(), true, 'private drawing turn cannot unmute');
    const tools = focus.locator('.ers-tools');
    const toolsBox = await tools.boundingBox(), railBox = await rail.boundingBox();
    assert.ok(toolsBox.x + toolsBox.width <= railBox.x + 1, 'drawing toolbar ends before the call rail');
    await measureTarget(page, tools.locator('.ers-tool-row button').first());
    await screenshot(page, `${name}-drawing-landscape-844`);
    await page.evaluate(() => { window.fixture.releasePrivate(); window.fixture.setGame('home'); });
    await setViewport(page, 390, 270);
    await page.locator('[data-testid="call-dock"][data-collapsed="true"]').waitFor();
    assert.equal(await rail.getAttribute('data-collapsed'), 'true', 'short viewport automatically folds');
    await measureTarget(page, rail.getByTestId('call-dock-open'));
    await measureTarget(page, rail.getByTestId('call-dock-mute'));
    await rail.getByTestId('call-dock-open').click();
    await screenshot(page, `${name}-participants-short-390x270`);
    await measureTarget(page, dialog.getByTestId('call-dock-end'));
    await dialog.getByTestId('call-dock-end').click();
    await rail.waitFor({ state: 'detached' });

    const offer = async id => {
      offeredCall = { id, scope: 'direct', conversationId: 'direct-1', initiatorId: peers[0].id, name: peers[0].name, status: 'ringing', expiresAt: Date.now() + 60000, participants: [{ userId: me.id, state: 'invited' }, { userId: peers[0].id, state: 'active' }] };
      await page.evaluate(() => window.fixture.refreshCalls());
      await incoming.waitFor();
    };
    await setViewport(page, 390, 844);
    await offer('incoming-decline');
    assert.equal(await incoming.locator('.lamma-incoming-caller').getByText(peers[0].name).count(), 1);
    await page.evaluate(() => window.fixture.setGame('fabraka'));
    await page.waitForFunction(() => !document.querySelector('.lamma-incoming-caller .player-avatar'));
    assert.equal(await incoming.getByText(peers[0].name, { exact: true }).count(), 0, 'private game shows no caller name or photo');
    await page.evaluate(() => window.fixture.setGame('home'));
    await incoming.locator('.lamma-incoming-caller').getByText(peers[0].name, { exact: true }).waitFor();
    await page.evaluate(() => window.fixture.openFriends({ type: 'list', tab: 'chats' }));
    await page.waitForFunction(() => document.querySelector('.lamma-panel > .lamma-incoming-call.is-inline'));
    const acceptBox = await measureTarget(page, incoming.getByTestId('incoming-call-accept'));
    const declineBox = await measureTarget(page, incoming.getByTestId('incoming-call-decline'));
    assert.equal(await incoming.getByTestId('incoming-call-decline').innerText(), locale === 'ar' ? 'رفض' : 'Decline');
    assert.ok(Math.min(acceptBox.width, declineBox.width) >= 130, 'incoming actions fill the two-column card');
    await screenshot(page, `${name}-incoming-friends-390`);
    await incoming.getByTestId('incoming-call-decline').press('Enter');
    await incoming.waitFor({ state: 'detached' });
    assert.ok(reads.some(item => item.method === 'POST' && item.url === '/api/social/calls/incoming-decline/reject'));
    await offer('incoming-accept');
    const accept = incoming.getByTestId('incoming-call-accept');
    assert.equal(await accept.innerText(), locale === 'ar' ? 'قبول' : 'Accept');
    await accept.click();
    await incoming.waitFor({ state: 'detached' });
    await page.waitForFunction(() => window.fixture.getCall()?.id === 'incoming-accept' && window.fixture.getMedia().connected);
    assert.ok(reads.some(item => item.method === 'POST' && item.url === '/api/social/calls/incoming-accept/accept'));
    assert.deepEqual(errors, []);
    console.log(`PASS ${name}: incoming accept/decline, participant sheet, pointer and keyboard, text200 at three widths, keyboard viewport and landscape drawing`);
    await fs.writeFile(path.join(out, `${name}-summary.json`), JSON.stringify({ engine, locale, passed: true, widths: [360, 390, 430], textScale: 2, touchMinimum: 48, drawing: [844, 390], shortViewport: [390, 270], callActions: ['accept', 'decline', 'mute', 'unmute', 'output', 'end', 'fold', 'expand'], media: 'simulated native bridge', keyboard: 'simulated visual viewport', captureDate: new Date().toISOString() }, null, 2));
  } catch (error) {
    await screenshot(page, `${name}-failure`);
    await fs.writeFile(path.join(out, `${name}-failure.txt`), (await page.locator('body').innerText()) + '\n' + errors.join('\n'));
    throw error;
  } finally {
    offeredCall = null;
    await context.close();
  }
}

let browser;
const failures = [];
async function verifyBrowser(browser, name) {
  for (const locale of ['ar', 'en']) {
    try { await runStudio(browser, name, locale); }
    catch (error) { failures.push(error); console.error(`${name}/${locale}: ${error.stack}`); }
  }
  if (process.env.CALL_DOCK_STUDIO_ONLY !== '1') {
    try { await run(browser, name); }
    catch (error) { failures.push(error); console.error(`${name}: ${error.stack}`); }
  }
}
try {
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  await verifyBrowser(browser, 'chromium');
  await browser.close(); browser = null;
  try { await fs.access(webkit.executablePath()); } catch { console.log('SKIP WebKit: browser binary unavailable.'); }
  if (await fs.access(webkit.executablePath()).then(() => true, () => false)) {
    browser = await webkit.launch();
    await verifyBrowser(browser, 'webkit');
  }
  console.log(out);
  if (failures.length) throw new AggregateError(failures, 'Call dock verification failed');
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }

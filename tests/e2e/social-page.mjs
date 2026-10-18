// Modern page and in-game drawer share the same real social controller.
// Run: node tests/e2e/social-page.mjs
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';

const me = { id: 'me', name: 'عمر', code: 'MDN-OMAR', avatarPreset: 'falcon', theme: 'teal' };
const peer = { id: 'friend', name: 'أحمد', code: 'MDN-AHMAD', avatarPreset: 'lion', theme: 'teal', online: true, conversationId: 'direct-1', unreadCount: 1 };
const offlinePeer = { id: 'offline-friend', name: 'ليان', code: 'MDN-LAYAN', avatarPreset: 'cat', online: false, conversationId: 'direct-2', unreadCount: 0 };
let messages = [{ seq: 1, clientId: 'first', senderId: 'friend', conversationId: 'direct-1', kind: 'text', text: 'شو رأيك نلعب فبركة الليلة؟', createdAt: Date.now() - 20000 }];
let groupMessages = [{ seq: 20, clientId: 'group-first', senderId: 'friend', kind: 'text', text: 'أهلًا بالشلّة!', createdAt: Date.now() - 4000 }];
let group = { id: 'group-1', name: 'شلّة الخميس', ownerId: 'me', role: 'owner', memberCount: 2, unreadCount: 1, avatarPreset: 'falcon', lastMessage: groupMessages[0] };
const prefs = { messages: true, friendRequests: true, groupInvites: true, calls: true, previews: false, sound: true, mutedConversations: [] };
const writes = [];
let recording;
const profile = user => ({ ...user, friendCount: 3, bio: 'الجمعة مع الأصحاب أحلى', relationship: user.id === 'me' ? 'self' : 'friend', earnedBadges: [], featuredBadges: [], earnedTitles: [], achievements: [], stats: { localSessions: 12, onlineMatches: 8, onlineWins: 3, distinctGames: 4 } });
const fixture = async (url, method, body) => {
  if (method !== 'GET') writes.push({ url, method, body });
  if (url === '/api/social/state') return { user: me, friends: [{ ...peer, lastMessage: messages.at(-1) }, offlinePeer], incoming: [], outgoing: [], blocked: [], conversations: [{ id: 'direct-1', user: peer, unreadCount: peer.unreadCount, lastMessage: messages.at(-1) }] };
  if (url.startsWith('/api/social/conversations/direct-1/messages')) {
    if (method === 'POST') { const message = { ...body, seq: messages.length + 1, senderId: 'me', conversationId: 'direct-1', createdAt: Date.now(), ...(body.kind === 'voice' ? { attachment: { id: 'voice-1', durationMs: recording.durationMs, mimeType: recording.mimeType } } : {}) }; messages.push(message); return { message }; }
    return { messages, peerReadSeq: 0, readSeq: 0, hasMore: false };
  }
  if (url === '/api/social/conversations/direct-1/read') { peer.unreadCount = 0; return { readSeq: body.seq }; }
  if (url === '/api/social/preferences') { if (method === 'PUT') Object.assign(prefs, body); return { preferences: prefs }; }
  if (url === '/api/social/capabilities') return { capabilities: { voiceMessages: true, liveCalls: false, pushNotifications: false } };
  if (url === '/api/social/attachments' && method === 'POST') { recording = body; return { attachment: { id: 'voice-1', durationMs: body.durationMs, mimeType: body.mimeType } }; }
  if (url === '/api/social/calls') return { calls: [{ id: 'active-group-call', scope: 'group', conversationId: 'group-1', status: 'active', participants: [{ userId: 'friend', state: 'joined' }] }] };
  if (url === '/api/social/groups') return { groups: [group], incoming: [] };
  if (url === '/api/social/groups/group-1') {
    if (method === 'PATCH') group = { ...group, ...body };
    return { group, members: [{ ...me, userId: 'me', role: 'owner' }, { ...peer, userId: 'friend', role: 'member' }], invitations: [] };
  }
  if (url.startsWith('/api/social/groups/group-1/messages')) {
    if (method === 'POST') { const message = { ...body, seq: 21 + groupMessages.length, senderId: 'me', createdAt: Date.now() }; groupMessages.push(message); return { message }; }
    return { messages: groupMessages, readSeq: 0, hasMore: false };
  }
  if (url === '/api/social/groups/group-1/read') { group.unreadCount = 0; return { readSeq: body.seq }; }
  if (url.startsWith('/api/profiles/')) return { profile: profile(url.includes('friend') ? peer : me) };
  if (url.startsWith('/api/social/search')) return { users: [peer] };
  if (url === '/api/social/live-ticket') return { error: 'SOCIAL_UNAVAILABLE' };
  return {};
};
const bundle = await build({ stdin: { contents: `
import React,{useState,useEffect,useSyncExternalStore} from 'react';import{createRoot}from'react-dom/client';
import{AccountContext,NULL_ACCOUNT}from'./src/shared/account/context.js';import{PlatformContext}from'./src/platform/context.js';
import{SocialProvider}from'./src/social/SocialProvider.jsx';import{LammaProvider}from'./src/social/LammaProvider.jsx';import{SocialUIProvider,useSocialUI}from'./src/social/SocialUIProvider.jsx';import{ProfileProvider}from'./src/profiles/ProfileProvider.jsx';import{SocialHost}from'./src/social/SocialHost.jsx';import{socialInterruption}from'./src/social/interruption.js';import{navigate,useRoute}from'./src/platform/router.js';
import{BrandFonts}from'./src/shared/brand/art.jsx';import css from'./src/shared/ui/ui.css';import tokens from'./src/shared/theme/tokens.css';import brand from'./src/shared/brand/brand.css';
const platform={sound:{play(){},setDucking(){}},toast(){},settings:{},roster:[],haptics:{vibrate(){}},storage:{get(){},set(){}}};
const request=async(path,options={})=>{const r=await fetch(path,{method:options.method||'GET',headers:{'content-type':'application/json'},body:options.body===undefined?undefined:JSON.stringify(options.body)});if(options.raw)return r;const data=await r.json();if(data.error)throw Object.assign(new Error(data.error),{code:data.error});return data};
function Screen(){const route=useRoute(),ui=useSocialUI();window.fixture={...window.fixture,navigate,show:ui.show,chat:ui.openChat,group:ui.openGroup,close:ui.close,reset:ui.resetSection,state:()=>({open:ui.open,presentation:ui.presentation,view:ui.view,drafts:ui.drafts,listState:ui.listState})};useEffect(()=>{socialInterruption.setContext({local:route.name==='play'});return()=>socialInterruption.setContext({local:false})},[route.name]);return <>{['friends','friend-group'].includes(route.name)?<div data-social-page-slot/>:<main><h1>{route.name}</h1><button onClick={()=>ui.show()}>افتح الأصدقاء</button></main>}<nav aria-label="التنقل التجريبي"><button onClick={()=>navigate('/')}>الألعاب</button><button onClick={()=>navigate('/friends')}>الأصدقاء</button><button onClick={()=>navigate('/store')}>المتجر</button><button onClick={()=>navigate('/settings')}>الإعدادات</button></nav></>}
function App(){const[owner,setOwner]=useState('me'),[ready,setReady]=useState(!new URLSearchParams(location.search).has('hydrate'));useEffect(()=>{if(!ready){const timer=setTimeout(()=>setReady(true),60);return()=>clearTimeout(timer)}},[ready]);window.fixture={...window.fixture,setOwner};const account={...NULL_ACCOUNT,ready,signedIn:!!owner,user:owner?{id:owner,name:'عمر'}:null,requestAuthenticated:request,refresh:async()=>{},markTrial(){}};return <AccountContext.Provider value={account}><PlatformContext.Provider value={platform}><BrandFonts/><style>{tokens}</style><style>{css}</style><style>{brand}</style><SocialProvider><LammaProvider><SocialUIProvider><ProfileProvider><Screen/><SocialHost/></ProfileProvider></SocialUIProvider></LammaProvider></SocialProvider></PlatformContext.Provider></AccountContext.Provider>};createRoot(document.getElementById('root')).render(<App/>);`, loader: 'jsx', resolveDir: process.cwd() }, bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.css': 'text', '.webp': 'dataurl', '.woff2': 'dataurl' }, logLevel: 'silent' });
const html = `<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script>${bundle.outputFiles[0].text}</script></html>`;
const server = http.createServer(async (req, res) => {
  if (!req.url.startsWith('/api/')) { res.writeHead(200, { 'content-type': 'text/html;charset=utf-8' }); res.end(html); return; }
  if (req.url === '/api/social/attachments/voice-1/content' && recording) { res.writeHead(200, { 'content-type': recording.mimeType }); res.end(Buffer.from(recording.dataBase64, 'base64')); return; }
  let raw = ''; for await (const chunk of req) raw += chunk;
  const data = await fixture(req.url, req.method, raw ? JSON.parse(raw) : undefined);
  res.writeHead(data.error ? 503 : 200, { 'content-type': 'application/json' }); res.end(JSON.stringify(data));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const out = path.join(process.cwd(), '.cache', 'social-page-e2e'); await fs.mkdir(out, { recursive: true });
let browser;
try {
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
  await page.goto(origin+'/#/friends');
  const panel=page.getByRole('region',{name:'الأصدقاء واللّمة'});
  await panel.getByRole('button',{name:'محادثة مع أحمد',exact:true}).waitFor();
  assert.equal(await page.locator('#root').evaluate(el=>el.inert),false);
  assert.notEqual(await page.locator('body').evaluate(el=>el.style.overflow),'hidden');
  assert.equal(await page.evaluate(()=>window.interruption?.getSnapshot().open||false),false);
  await page.getByRole('textbox',{name:'البحث في اللّمة'}).fill('ليان');
  await page.getByRole('navigation',{name:'التنقل التجريبي'}).getByRole('button',{name:'المتجر',exact:true}).click();
  await panel.waitFor({state:'detached'});
  await page.getByRole('navigation',{name:'التنقل التجريبي'}).getByRole('button',{name:'الأصدقاء',exact:true}).click();
  assert.equal(await page.getByRole('textbox',{name:'البحث في اللّمة'}).inputValue(),'ليان');
  await page.evaluate(()=>window.fixture.reset());
  await page.setViewportSize({width:844,height:390});
  await panel.locator('.lamma-list-scroll').evaluate(el=>el.scrollTop=el.scrollHeight);
  await page.waitForFunction(()=>window.fixture.state().listState.friends?.scrollTop>10);
  const scrollTop=await panel.locator('.lamma-list-scroll').evaluate(el=>el.scrollTop);
  await page.evaluate(()=>window.fixture.navigate('/store'));
  await panel.waitFor({state:'detached'});
  await page.evaluate(()=>window.fixture.navigate('/friends'));
  await panel.waitFor();
  assert.equal(await panel.locator('.lamma-list-scroll').evaluate(el=>el.scrollTop),scrollTop);
  await page.evaluate(()=>window.fixture.reset());
  await page.waitForFunction(()=>document.querySelector('.lamma-list-scroll').scrollTop===0);
  await page.screenshot({path:path.join(out,'friends-page-landscape.png')});
  await page.setViewportSize({width:390,height:844});
  await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:path.join(out,'friends-page.png')});
  await page.getByRole('button',{name:'محادثة مع أحمد',exact:true}).click();
  await page.getByRole('textbox',{name:'اكتب رسالة'}).fill('مسودة الصفحة تبقى معي');
  assert.equal(await page.evaluate(()=>location.hash),'#/friends/friend');
  await page.getByRole('button',{name:'عرض بروفايل أحمد',exact:true}).click();
  await page.getByRole('button',{name:'دعوة للعبة',exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>location.hash),'#/friends/friend');
  await page.getByRole('button',{name:'العودة للّمة',exact:true}).click();
  assert.equal(await page.getByRole('textbox',{name:'اكتب رسالة'}).inputValue(),'مسودة الصفحة تبقى معي');
  await page.evaluate(()=>window.fixture.navigate('/settings'));
  await page.evaluate(()=>window.fixture.chat('friend'));
  assert.equal(await page.getByRole('textbox',{name:'اكتب رسالة'}).inputValue(),'مسودة الصفحة تبقى معي');
  await page.getByRole('button',{name:'العودة للّمة',exact:true}).click();
  await page.getByRole('navigation',{name:'أقسام اللّمة'}).getByRole('button',{name:'اللّمات',exact:false}).click();
  await page.getByRole('button',{name:/شلّة الخميس/}).first().click();
  await page.getByText('أهلًا بالشلّة!',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>location.hash),'#/friends/group/group-1');
  await page.reload();await page.getByText('أهلًا بالشلّة!',{exact:true}).waitFor();
  await page.getByRole('button',{name:'العودة للّمة',exact:true}).click();
  await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:path.join(out,'friends-groups-page.png')});
  await page.evaluate(()=>window.fixture.navigate('/play/fabraka'));
  await page.getByRole('heading',{name:'play',exact:true}).waitFor();
  await page.evaluate(()=>window.fixture.chat('friend'));
  const drawer=page.getByRole('dialog',{name:'الأصدقاء واللّمة',exact:true});await drawer.waitFor();
  assert.equal(await page.evaluate(()=>location.hash),'#/play/fabraka');
  assert.equal(await page.locator('#root').evaluate(el=>el.inert),true);
  assert.equal(await page.getByRole('textbox',{name:'اكتب رسالة'}).inputValue(),''); // reload intentionally clears session-only drafts
  await page.getByRole('textbox',{name:'اكتب رسالة'}).fill('مسودة اللعب');
  await page.evaluate(()=>window.fixture.close());await drawer.waitFor({state:'detached'});
  await page.evaluate(()=>window.fixture.navigate('/friends/friend'));
  assert.equal(await page.getByRole('textbox',{name:'اكتب رسالة'}).inputValue(),'مسودة اللعب');
  await page.evaluate(()=>window.fixture.setOwner(null));
  await page.getByRole('button',{name:'سجّل الدخول وخلّك قريب'}).waitFor();
  assert.equal(await page.locator('.social-message').count(),0);
  assert.deepEqual(await page.evaluate(()=>window.fixture.state().drafts),{});
  assert.deepEqual(await page.evaluate(()=>window.fixture.state().listState),{});
  assert.equal(await page.evaluate(()=>location.hash),'#/friends');
  await page.evaluate(()=>window.fixture.setOwner('me'));
  await page.getByRole('button',{name:'محادثة مع أحمد',exact:true}).waitFor();
  await page.evaluate(()=>window.fixture.chat('friend'));
  assert.equal(await page.getByRole('textbox',{name:'اكتب رسالة'}).inputValue(),'');
  await page.goBack();await page.getByRole('textbox',{name:'البحث في اللّمة'}).waitFor();
  assert.equal(await page.locator('#root').evaluate(el=>el.inert),false);
  await page.goto(origin+'/?hydrate=1#/friends/group/group-1');
  await page.getByText('أهلًا بالشلّة!',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>location.hash),'#/friends/group/group-1','cold account hydration preserves requested group link');
  await page.goto(origin+'/#/settings');
  await page.evaluate(()=>window.fixture.chat('friend'));
  await page.getByRole('textbox',{name:'اكتب رسالة'}).waitFor();
  await page.getByRole('button',{name:'العودة للّمة',exact:true}).click();
  await page.getByRole('textbox',{name:'البحث في اللّمة'}).waitFor();
  await page.goBack();await page.getByRole('heading',{name:'settings',exact:true}).waitFor();
  assert.deepEqual(errors,[]);
  console.log('PASS: modern social page, legacy direct and new group deep links, page/drawer ownership, browser back, drafts, filters, account and guest isolation');
} finally {await browser?.close();await new Promise(resolve=>server.close(resolve));}

// Authenticated browser fixture: real providers, real UI, deterministic local API.
// Run: node tests/e2e/lamma-drawer.mjs
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
import React,{useState,useEffect,useSyncExternalStore} from 'react'; import{createRoot}from'react-dom/client';
import{AccountContext,NULL_ACCOUNT}from'./src/shared/account/context.js';import{PlatformContext}from'./src/platform/context.js';
import{SocialProvider}from'./src/social/SocialProvider.jsx';import{LammaProvider}from'./src/social/LammaProvider.jsx';
import{SocialUIProvider,useSocialUI}from'./src/social/SocialUIProvider.jsx';import{ProfileProvider}from'./src/profiles/ProfileProvider.jsx';
import{useRoute}from'./src/platform/router.js';
import{SocialHost,CallControls}from'./src/social/SocialHost.jsx';import{socialInterruption}from'./src/social/interruption.js';import{Home}from'./src/platform/screens/Home.jsx';
import{BrandFonts}from'./src/shared/brand/art.jsx';import css from'./src/shared/ui/ui.css';import tokens from'./src/shared/theme/tokens.css';import brand from'./src/shared/brand/brand.css';import platformCss from'./src/platform/platform.css';import onlineCss from'./src/online/online.css';
const sound={play(){},setDucking(){}};const platform={sound,toast(){},settings:{},roster:[],haptics:{vibrate(){}},storage:{get(){},set(){}}};
const request=async(path,options={})=>{const r=await fetch(path,{method:options.method||'GET',headers:{'content-type':'application/json'},body:options.body===undefined?undefined:JSON.stringify(options.body)});if(options.raw)return r;const data=await r.json();if(data.error)throw Object.assign(new Error(data.error),{code:data.error});return data;};
function Game(){const ui=useSocialUI();const state=useSyncExternalStore(socialInterruption.subscribe,socialInterruption.getSnapshot);const[n,setN]=useState(7);useEffect(()=>{window.gameMounts=(window.gameMounts||0)+1;socialInterruption.setContext({local:true});return()=>socialInterruption.setContext({local:false});},[]);return <main id="game" style={{padding:24,minHeight:'100vh',background:'#ece8dc'}}><h1>فبركة</h1><p>الجولة الثانية · أحمد</p><strong id="score">{n}</strong><button onClick={()=>setN(n+1)}>نقطة</button><button onClick={()=>ui.openChat('friend')}>افتح محادثة الاختبار</button><div id="game-secret">{state.paused?'الوقت متوقف والإجابات مخفية':'إجابة سرية'}</div></main>}
function MenuRoute(){const route=useRoute(),ui=useSocialUI();window.openHomeGroup=()=>ui.openGroup('group-1');return ['friends','friend-group'].includes(route.name)?<div data-social-page-slot/>:<Home/>}
function App(){const[id,setId]=useState('me'),[home,setHome]=useState(false),[call,setCall]=useState(false);window.changeAccount=setId;window.showHome=()=>{location.hash='#/';setHome(true)};window.showCall=setCall;window.interruption=socialInterruption;const account={...NULL_ACCOUNT,ready:true,signedIn:true,user:{id,name:'عمر'},requestAuthenticated:request,refresh:async()=>{},markTrial(){}};return <AccountContext.Provider value={account}><PlatformContext.Provider value={platform}><BrandFonts/><style>{tokens}</style><style>{css}</style><style>{brand}</style><style>{platformCss}</style><style>{onlineCss}</style><SocialProvider><LammaProvider><SocialUIProvider><ProfileProvider>{home?<MenuRoute/>:<Game/>}<SocialHost/>{call&&<CallControls call={{id:'fixture-call',scope:'group',status:'active'}} media={{connected:true,participants:Array.from({length:12},(_,i)=>({id:'member-'+i,name:'مشارك '+(i+1),muted:i%2===0,speaking:i===3}))}} onMute={()=>{}} onEnd={()=>setCall(false)}/>}</ProfileProvider></SocialUIProvider></LammaProvider></SocialProvider></PlatformContext.Provider></AccountContext.Provider>};createRoot(document.getElementById('root')).render(<App/>);`, loader: 'jsx', resolveDir: process.cwd() }, bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.css': 'text', '.webp': 'dataurl', '.woff2': 'dataurl' }, logLevel: 'silent' });
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
const out = path.join(process.cwd(), '.cache', 'lamma-e2e'); await fs.mkdir(out, { recursive: true });
let browser;
try {
  browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ar', isMobile: true, hasTouch: true, permissions: ['microphone'] });
  const page = await context.newPage(); const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await page.goto(origin + '/#/play/fabraka');
  await page.getByRole('button', { name: /الأصدقاء،/ }).click();
  await page.getByRole('button', { name: 'محادثة مع أحمد', exact: true }).waitFor();
  const friendsFilter = label => page.getByRole('group', { name: 'تصفية الأصدقاء' }).getByRole('button', { name: label, exact: true }).click();
  await friendsFilter('المتصلون'); assert.equal(await page.getByRole('button', { name: 'محادثة مع ليان', exact: true }).count(), 0);
  await page.getByRole('textbox', { name: 'البحث في اللّمة' }).fill('ليان'); await page.getByRole('heading', { name: 'ما لقينا هذا الاسم' }).waitFor();
  await friendsFilter('الكل'); await page.getByRole('button', { name: 'محادثة مع ليان', exact: true }).waitFor();
  await page.getByRole('textbox', { name: 'البحث في اللّمة' }).fill('');
  await page.getByRole('button', { name: 'إضافة ليان إلى المفضّلين', exact: true }).click();
  await friendsFilter('المفضّلون'); assert.equal(await page.getByRole('button', { name: 'محادثة مع أحمد', exact: true }).count(), 0); await page.getByRole('button', { name: 'محادثة مع ليان', exact: true }).waitFor();
  await page.reload(); await page.getByRole('button', { name: /الأصدقاء،/ }).click(); await friendsFilter('المفضّلون');
  await page.getByRole('button', { name: 'إزالة ليان من المفضّلين', exact: true }).waitFor(); assert.equal(await page.getByRole('button', { name: 'محادثة مع أحمد', exact: true }).count(), 0);
  await friendsFilter('الكل');
  await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(300); await page.screenshot({ path: path.join(out, 'mobile-friends.png') });
  await page.getByRole('button', { name: 'محادثة مع أحمد', exact: true }).click();
  await page.getByRole('textbox', { name: 'اكتب رسالة' }).fill('مسودة تبقى معي');
  await page.getByRole('button', { name: 'إغلاق اللّمة والعودة للعبة' }).click();
  assert.equal(await page.locator('#score').textContent(), '7');
  assert.equal(await page.evaluate(() => location.hash), '#/play/fabraka');
  assert.equal(await page.evaluate(() => window.gameMounts), 1);
  assert.equal(await page.locator('#game-secret').textContent(), 'الوقت متوقف والإجابات مخفية');
  await page.getByRole('button', { name: /افتح الأصدقاء واللّمة|الأصدقاء،/ }).click();
  await page.getByRole('button', { name: 'محادثة مع أحمد', exact: true }).click();
  assert.equal(await page.getByRole('textbox', { name: 'اكتب رسالة' }).inputValue(), 'مسودة تبقى معي');
  await page.getByRole('button', { name: 'إرسال الرسالة', exact: true }).click();
  await page.getByText('مسودة تبقى معي', { exact: true }).waitFor();
  assert.ok(writes.some(write => write.url.includes('/messages') && write.body.text === 'مسودة تبقى معي'));
  await page.getByRole('button', { name: /رسالة صوتية حتى دقيقتين/ }).click();
  await page.getByRole('button', { name: 'إنهاء التسجيل ومراجعته' }).waitFor();
  await page.waitForTimeout(350);
  await page.getByRole('button', { name: 'إنهاء التسجيل ومراجعته' }).click();
  await page.locator('.lamma-recorded-preview audio').evaluate(async element => { await element.play(); window.dispatchEvent(new CustomEvent('maydan-social-audio', { detail: { owner: 'live-call-fixture', active: true } })); });
  assert.equal(await page.locator('.lamma-recorded-preview audio').evaluate(element => element.paused), true, 'live calls stop local voice previews');
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('maydan-social-audio', { detail: { owner: 'live-call-fixture', active: false } })));
  await page.getByRole('button', { name: 'إرسال الرسالة الصوتية' }).click();
  await page.getByRole('button', { name: 'تشغيل الرسالة الصوتية', exact: true }).waitFor();
  assert.ok(recording.durationMs > 0 && recording.durationMs <= 120000);
  assert.ok(writes.some(write => write.url.includes('/messages') && write.body.kind === 'voice'));
  await page.getByRole('button', { name: 'تشغيل الرسالة الصوتية', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.lamma-voice-message audio')?.src.startsWith('blob:'));
  await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(300); await page.screenshot({ path: path.join(out, 'mobile-chat.png') });
  await page.getByRole('button', { name: 'العودة للّمة', exact: true }).click();
  await page.getByRole('button', { name: 'اللّمات', exact: false }).click();
  await page.getByRole('button', { name: /شلّة الخميس/ }).click();
  await page.getByText('أهلًا بالشلّة!', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'خيارات المحادثة' }).click();
  await page.getByRole('button', { name: 'الأعضاء وإدارة اللّمة' }).click();
  await page.getByRole('heading', { name: 'أصحاب اللّمة' }).waitFor();
  assert.equal(await page.getByRole('group', { name: 'صورة اللّمة' }).count(), 1);
  assert.equal(await page.getByText('أحمد', { exact: true }).last().isVisible(), true);
  await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(300); await page.screenshot({ path: path.join(out, 'mobile-group.png') });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'العودة للّمة', exact: true }).click();
  await page.getByRole('button', { name: 'الأصدقاء', exact: true }).click();
  await page.getByRole('button', { name: 'عرض بروفايل أحمد' }).click();
  await page.getByRole('button', { name: 'دعوة للعبة', exact: true }).waitFor();
  assert.equal(await page.evaluate(() => location.hash), '#/play/fabraka');
  await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(300); await page.screenshot({ path: path.join(out, 'mobile-profile.png') });
  await page.getByRole('button', { name: 'إغلاق اللّمة والعودة للعبة' }).click();
  await page.getByRole('button', { name: /افتح الأصدقاء واللّمة|الأصدقاء،/ }).click();
  await page.getByRole('button', { name: 'محادثة مع أحمد', exact: true }).click();
  await page.getByRole('textbox', { name: 'اكتب رسالة' }).fill('سر الحساب الأول');
  await page.evaluate(() => window.changeAccount('other'));
  await page.waitForFunction(() => !document.querySelector('.lamma-panel'));
  assert.equal(await page.evaluate(() => window.gameMounts), 1, 'identity changes must not remount the game');
  assert.ok(!await page.evaluate(() => Object.values(localStorage).some(value => value.includes('سر الحساب الأول'))));
  await page.getByRole('button', { name: /افتح الأصدقاء واللّمة|الأصدقاء،/ }).click(); await friendsFilter('المفضّلون');
  await page.getByRole('heading', { name: 'أصحابك الأقرب، بنجمة' }).waitFor();
  await friendsFilter('الكل'); await page.getByRole('button', { name: 'إضافة أحمد إلى المفضّلين', exact: true }).click();
  await page.evaluate(() => window.changeAccount('me')); await page.waitForFunction(() => !document.querySelector('.lamma-panel'));
  await page.getByRole('button', { name: /افتح الأصدقاء واللّمة|الأصدقاء،/ }).click(); await friendsFilter('المفضّلون');
  await page.getByRole('button', { name: 'إزالة ليان من المفضّلين', exact: true }).waitFor(); assert.equal(await page.getByRole('button', { name: 'محادثة مع أحمد', exact: true }).count(), 0);
  await page.getByRole('button', { name: 'إغلاق اللّمة والعودة للعبة' }).click();
  assert.deepEqual(errors, []);
  await page.setViewportSize({ width: 1365, height: 900 });
  await page.getByRole('button', { name: /افتح الأصدقاء واللّمة|الأصدقاء،/ }).click();
  await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(300); await page.screenshot({ path: path.join(out, 'desktop-drawer.png') });
  await page.getByRole('button', { name: 'إغلاق اللّمة والعودة للعبة' }).click(); await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.showCall(true)); await page.getByTestId('call-dock-participant').first().click();
  const callSheet = page.getByRole('dialog', { name: 'المشاركون في المكالمة', exact: true }); await callSheet.waitFor();
  assert.equal(await callSheet.locator('.call-controls-member').count(), 12); assert.equal(await callSheet.getByText('مشارك 12', { exact: true }).count(), 1);
  assert.equal(await callSheet.getByRole('button', { name: 'إنهاء المكالمة', exact: true }).count(), 1);
  assert.equal(await callSheet.getByText('يتحدث الآن', { exact: true }).count(), 1); assert.equal(await callSheet.getByText('الميكروفون مكتوم', { exact: true }).count(), 6);
  assert.equal(await page.evaluate(() => window.interruption.getSnapshot().open), true); assert.equal(await page.locator('#root').evaluate(element => element.inert), true);
  await page.waitForTimeout(400); await page.screenshot({ path: path.join(out, 'mobile-call-participants.png') }); await callSheet.getByRole('button', { name: 'إغلاق', exact: true }).click(); await callSheet.waitFor({ state: 'detached' });
  assert.equal(await page.evaluate(() => window.interruption.getSnapshot().open), false); assert.equal(await page.evaluate(() => window.interruption.getSnapshot().paused), true);
  await page.evaluate(() => { window.showCall(false); window.showHome(); });
  await page.getByRole('heading', { name: 'اختار لعبتك', exact: true }).waitFor();
  await page.evaluate(() => window.openHomeGroup());
  await page.getByText('أهلًا بالشلّة!', { exact: true }).waitFor(); assert.equal(await page.evaluate(() => location.hash), '#/friends/group/group-1'); assert.equal(await page.locator('#root').evaluate(element => element.inert), false);
  assert.deepEqual(errors, []);
  console.log('PASS: mobile friends filters/favorites/account isolation, chats/voice, persistent drafts, unchanged game, group management, 12-person call sheet, home group shortcut and desktop layout');
  console.log(out);
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }

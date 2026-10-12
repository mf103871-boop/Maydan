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
let messages = [{ seq: 1, clientId: 'first', senderId: 'friend', conversationId: 'direct-1', kind: 'text', text: 'شو رأيك نلعب فبركة الليلة؟', createdAt: Date.now() - 20000 }];
let groupMessages = [{ seq: 20, clientId: 'group-first', senderId: 'friend', kind: 'text', text: 'أهلًا بالشلّة!', createdAt: Date.now() - 4000 }];
let group = { id: 'group-1', name: 'شلّة الخميس', ownerId: 'me', role: 'owner', memberCount: 2, unreadCount: 1, avatarPreset: 'falcon', lastMessage: groupMessages[0] };
const prefs = { messages: true, friendRequests: true, groupInvites: true, calls: true, previews: false, sound: true, mutedConversations: [] };
const writes = [];
let recording;
const profile = user => ({ ...user, friendCount: 3, bio: 'الجمعة مع الأصحاب أحلى', relationship: user.id === 'me' ? 'self' : 'friend', earnedBadges: [], featuredBadges: [], earnedTitles: [], achievements: [], stats: { localSessions: 12, onlineMatches: 8, onlineWins: 3, distinctGames: 4 } });
const fixture = async (url, method, body) => {
  if (method !== 'GET') writes.push({ url, method, body });
  if (url === '/api/social/state') return { user: me, friends: [{ ...peer, lastMessage: messages.at(-1) }], incoming: [], outgoing: [], blocked: [], conversations: [{ id: 'direct-1', user: peer, unreadCount: peer.unreadCount, lastMessage: messages.at(-1) }] };
  if (url.startsWith('/api/social/conversations/direct-1/messages')) {
    if (method === 'POST') { const message = { ...body, seq: messages.length + 1, senderId: 'me', conversationId: 'direct-1', createdAt: Date.now(), ...(body.kind === 'voice' ? { attachment: { id: 'voice-1', durationMs: recording.durationMs, mimeType: recording.mimeType } } : {}) }; messages.push(message); return { message }; }
    return { messages, peerReadSeq: 0, readSeq: 0, hasMore: false };
  }
  if (url === '/api/social/conversations/direct-1/read') { peer.unreadCount = 0; return { readSeq: body.seq }; }
  if (url === '/api/social/preferences') { if (method === 'PUT') Object.assign(prefs, body); return { preferences: prefs }; }
  if (url === '/api/social/capabilities') return { capabilities: { voiceMessages: true, liveCalls: false, pushNotifications: false } };
  if (url === '/api/social/attachments' && method === 'POST') { recording = body; return { attachment: { id: 'voice-1', durationMs: body.durationMs, mimeType: body.mimeType } }; }
  if (url === '/api/social/calls') return { calls: [] };
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
import{AccountContext}from'./src/shared/account/context.js';import{PlatformContext}from'./src/platform/context.js';
import{SocialProvider}from'./src/social/SocialProvider.jsx';import{LammaProvider}from'./src/social/LammaProvider.jsx';
import{SocialUIProvider,useSocialUI}from'./src/social/SocialUIProvider.jsx';import{ProfileProvider}from'./src/profiles/ProfileProvider.jsx';
import{SocialHost}from'./src/social/SocialHost.jsx';import{socialInterruption}from'./src/social/interruption.js';
import{BrandFonts}from'./src/shared/brand/art.jsx';import css from'./src/shared/ui/ui.css';import tokens from'./src/shared/theme/tokens.css';import brand from'./src/shared/brand/brand.css';
const sound={play(){},setDucking(){}};const platform={sound,toast(){},settings:{},haptics:{vibrate(){}},storage:{get(){},set(){}}};
const request=async(path,options={})=>{const r=await fetch(path,{method:options.method||'GET',headers:{'content-type':'application/json'},body:options.body===undefined?undefined:JSON.stringify(options.body)});if(options.raw)return r;const data=await r.json();if(data.error)throw Object.assign(new Error(data.error),{code:data.error});return data;};
function Game(){const ui=useSocialUI();const state=useSyncExternalStore(socialInterruption.subscribe,socialInterruption.getSnapshot);const[n,setN]=useState(7);useEffect(()=>{window.gameMounts=(window.gameMounts||0)+1;socialInterruption.setContext({local:true});return()=>socialInterruption.setContext({local:false});},[]);return <main id="game" style={{padding:24,minHeight:'100vh',background:'#ece8dc'}}><h1>فبركة</h1><p>الجولة الثانية · أحمد</p><strong id="score">{n}</strong><button onClick={()=>setN(n+1)}>نقطة</button><button onClick={()=>ui.openChat('friend')}>افتح محادثة الاختبار</button><div id="game-secret">{state.paused?'الوقت متوقف والإجابات مخفية':'إجابة سرية'}</div></main>}
function App(){const[id,setId]=useState('me');window.changeAccount=setId;const account={ready:true,signedIn:true,user:{id,name:'عمر'},requestAuthenticated:request,refresh:async()=>{},markTrial(){}};return <AccountContext.Provider value={account}><PlatformContext.Provider value={platform}><BrandFonts/><style>{tokens}</style><style>{css}</style><style>{brand}</style><SocialProvider><LammaProvider><SocialUIProvider><ProfileProvider><Game/><SocialHost/></ProfileProvider></SocialUIProvider></LammaProvider></SocialProvider></PlatformContext.Provider></AccountContext.Provider>};createRoot(document.getElementById('root')).render(<App/>);`, loader: 'jsx', resolveDir: process.cwd() }, bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.css': 'text', '.webp': 'dataurl', '.woff2': 'dataurl' }, logLevel: 'silent' });
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
  assert.deepEqual(errors, []);
  await page.setViewportSize({ width: 1365, height: 900 });
  await page.getByRole('button', { name: /افتح الأصدقاء واللّمة|الأصدقاء،/ }).click();
  await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(300); await page.screenshot({ path: path.join(out, 'desktop-drawer.png') });
  console.log('PASS: mobile chats, persistent drafts, unchanged route/game, group management, profile actions, account privacy, desktop layout');
  console.log(out);
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }

// Real group sender identities and retryable text delivery in Chromium and WebKit.
// Run: node tests/e2e/social-message-reliability.mjs
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium, webkit } from 'playwright';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';

const me = { id: 'me', name: 'عمر', code: 'MDN-OMAR', avatarPreset: 'falcon', theme: 'teal' };
const peer = { id: 'friend', name: 'أحمد', code: 'MDN-AHMAD', avatarPreset: 'lion', theme: 'teal', online: true, conversationId: 'direct-1', unreadCount: 1 };
const offlinePeer = { id: 'offline-friend', name: 'ليان', code: 'MDN-LAYAN', avatarPreset: 'cat', online: false, conversationId: 'direct-2', unreadCount: 0 };
let messages = [{ seq: 1, clientId: 'first', senderId: 'friend', conversationId: 'direct-1', kind: 'text', text: 'شو رأيك نلعب فبركة الليلة؟', createdAt: Date.now() - 20000 }];
let groupMessages = [{ seq: 20, clientId: 'group-first', senderId: 'friend', kind: 'text', text: 'أنا جاهز للّعب الآن', createdAt: Date.now() - 4000 },{seq:21,clientId:'group-second',senderId:'offline-friend',kind:'text',text:'نبدأ بعد خمس دقائق',createdAt:Date.now()-2000}];
let group = { id: 'group-1', name: 'شلّة الخميس', ownerId: 'me', role: 'owner', memberCount: 3, unreadCount: 1, avatarPreset: 'falcon', lastMessage: groupMessages[0] };
const prefs = { messages: true, friendRequests: true, groupInvites: true, calls: true, previews: false, sound: true, mutedConversations: [] };
const writes = [];
let groupSendFailures = 1;
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
    return { group, members: [{ ...me, userId: 'me', role: 'owner' }, { ...peer, userId: 'friend', role: 'member' },{...offlinePeer,userId:'offline-friend',role:'member'}], invitations: [] };
  }
  if (url.startsWith('/api/social/groups/group-1/messages')) {
    if (method === 'POST') { if (groupSendFailures-- > 0) return { error: 'SERVICE_UNAVAILABLE' }; const existing = groupMessages.find(message => message.clientId === body.clientId); if (existing) return { message: existing }; const message = { ...body, seq: 21 + groupMessages.length, senderId: 'me', createdAt: Date.now() }; groupMessages.push(message); return { message }; }
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
window.interruption=socialInterruption;
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
const out = process.env.E2E_OUTPUT_DIR || '.cache/social-message-reliability'; await fs.mkdir(out,{recursive:true});
const result={scope:'Real current SocialHost, shared Conversation, SocialUIProvider, SocialProvider, LammaProvider, ProfileProvider; local synthetic API only, no production calls',engines:[]};
try {
 for (const [name, type] of [['chromium', chromium], ['webkit', webkit]]) {
  groupSendFailures = 1;
  groupMessages = groupMessages.filter(message => message.senderId !== 'me');
  writes.length = 0;
  const browser = await type.launch();
  try {
   const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
   const errors = []; page.on('pageerror', error => errors.push(error.message));
   await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
   await page.goto(origin + '/#/friends/group/group-1');
   await page.getByText('أنا جاهز للّعب الآن', { exact: true }).waitFor();
   const senders = await page.locator('.social-message').evaluateAll(nodes => nodes.map(node => ({ name: node.querySelector('.social-message-sender strong')?.textContent, aria: node.getAttribute('aria-label'), avatars: node.querySelectorAll('.social-message-sender .player-avatar').length })));
   assert.deepEqual(senders.map(sender => sender.name), ['أحمد', 'ليان']);
   assert.ok(senders.every(sender => sender.avatars === 1 && sender.aria.includes(sender.name)));
   await page.screenshot({ path: path.join(out, name + '-group-senders.png') });
   const draft = 'هذه رسالة تبقى حتى عند تعذر الإرسال';
   await page.getByRole('textbox', { name: 'اكتب رسالة' }).fill(draft);
   await page.getByRole('button', { name: 'إرسال الرسالة', exact: true }).click();
   await page.locator('.social-message.is-failed').filter({ hasText: draft }).waitFor();
   assert.equal(await page.getByRole('button', { name: 'إعادة الإرسال', exact: true }).count(), 1);
   await page.screenshot({ path: path.join(out, name + '-group-failed-outbox.png') });
   await page.evaluate(() => window.fixture.navigate('/settings'));
   await page.getByRole('heading', { name: 'settings', exact: true }).waitFor();
   await page.evaluate(() => window.fixture.group('group-1'));
   await page.locator('.social-message.is-failed').filter({ hasText: draft }).waitFor();
   await page.getByRole('button', { name: 'إعادة الإرسال', exact: true }).click();
   await page.locator('.social-message:not(.is-failed)').filter({ hasText: draft }).waitFor();
   assert.equal(await page.locator('.social-message').filter({ hasText: draft }).count(), 1);
   assert.equal(await page.locator('.social-message.is-failed').count(), 0);
   const sent = writes.filter(write => write.url === '/api/social/groups/group-1/messages' && write.method === 'POST');
   assert.equal(sent.length, 2); assert.equal(sent[0].body.clientId, sent[1].body.clientId);
   await page.screenshot({ path: path.join(out, name + '-group-retried.png') });
   await page.evaluate(() => window.fixture.setOwner(null));
   await page.getByRole('button', { name: 'سجّل الدخول وخلّك قريب' }).waitFor();
   assert.equal(await page.locator('.social-message').count(), 0);
   assert.deepEqual(await page.evaluate(() => window.fixture.state().drafts), {});
   assert.deepEqual(errors, []);
   result.engines.push({ engine: name, senders, failedTextRetainedAfterNavigation: true, sameRetryIdentity: true, sentMessageCount: 1, signedOutMessages: 0, pageErrors: errors });
  } finally { await browser.close(); }
 }
 await fs.writeFile(path.join(out, 'results.json'), JSON.stringify(result, null, 2));
 console.log(JSON.stringify(result, null, 2));
} finally { await new Promise(resolve => server.close(resolve)); }

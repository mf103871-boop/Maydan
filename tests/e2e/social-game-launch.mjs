// Direct group-to-game launch with real providers and native-media bridge fixtures.
// This tests UI and local HTTP failures; it does not prove physical iPhone calls.
// Run: node tests/e2e/social-game-launch.mjs
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
let groupSendFailures = 0;
let inviteFailures = 1;
let holdCreate = false, releaseCreate = null, releaseCall = null;
const createdRooms = [], invitations = [];
const call = { id: 'active-group-call', scope: 'group', conversationId: 'group-1', status: 'active', acceptedAt: Date.now(), participants: [{ userId: 'me', deviceId: 'fixture-device', state: 'joined' }, { userId: 'friend', state: 'joined' }] };
let recording;
const profile = user => ({ ...user, friendCount: 3, bio: 'الجمعة مع الأصحاب أحلى', relationship: user.id === 'me' ? 'self' : 'friend', earnedBadges: [], featuredBadges: [], earnedTitles: [], achievements: [], stats: { localSessions: 12, onlineMatches: 8, onlineWins: 3, distinctGames: 4 } });
const fixture = async (url, method, body) => {
  if (method !== 'GET') writes.push({ url, method, body });
  if (url === '/api/rooms' && method === 'POST') { createdRooms.push(body); if (holdCreate) await new Promise(resolve => { releaseCreate = resolve; }); return { code: '234567' }; }
  if (url === '/api/social/room-invitations' && method === 'POST') {
    invitations.push(body); if (inviteFailures-- > 0) return { error: 'SERVICE_UNAVAILABLE' };
    const roomInvitation = { id: 'invite-' + body.clientId, roomCode: body.roomCode, game: 'fabraka', expiresAt: Date.now() + 900000 };
    const message = { seq: 100 + invitations.length, senderId: 'me', clientId: body.clientId, kind: 'room_invite', roomInvitation, createdAt: Date.now(), conversationId: body.conversationId };
    if (body.scope === 'group') groupMessages.push(message); else messages.push(message);
    return { invitation: roomInvitation, message };
  }
  if ((url === '/api/social/calls' || url === '/api/social/calls/active-group-call/accept') && method === 'POST') { await new Promise(resolve => { releaseCall = resolve; }); return { call, connection: { url: 'wss://fixture.invalid', token: 'fixture' } }; }
  if (url === '/api/social/calls/active-group-call') return { call };
  if (url === '/api/social/state') return { user: me, friends: [{ ...peer, lastMessage: messages.at(-1) }, offlinePeer], incoming: [], outgoing: [], blocked: [], conversations: [{ id: 'direct-1', user: peer, unreadCount: peer.unreadCount, lastMessage: messages.at(-1) }] };
  if (url.startsWith('/api/social/conversations/direct-1/messages')) {
    if (method === 'POST') { const message = { ...body, seq: messages.length + 1, senderId: 'me', conversationId: 'direct-1', createdAt: Date.now(), ...(body.kind === 'voice' ? { attachment: { id: 'voice-1', durationMs: recording.durationMs, mimeType: recording.mimeType } } : {}) }; messages.push(message); return { message }; }
    return { messages, peerReadSeq: 0, readSeq: 0, hasMore: false };
  }
  if (url === '/api/social/conversations/direct-1/read') { peer.unreadCount = 0; return { readSeq: body.seq }; }
  if (url === '/api/social/preferences') { if (method === 'PUT') Object.assign(prefs, body); return { preferences: prefs }; }
  if (url === '/api/social/capabilities') return { capabilities: { voiceMessages: true, liveCalls: true, pushNotifications: true } };
  if (url === '/api/social/attachments' && method === 'POST') { recording = body; return { attachment: { id: 'voice-1', durationMs: body.durationMs, mimeType: body.mimeType } }; }
  if (url === '/api/social/calls') return { calls: [call] };
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
import{SocialProvider}from'./src/social/SocialProvider.jsx';import{LammaProvider,useLamma}from'./src/social/LammaProvider.jsx';import{SocialUIProvider,useSocialUI}from'./src/social/SocialUIProvider.jsx';import{ProfileProvider}from'./src/profiles/ProfileProvider.jsx';import{SocialHost}from'./src/social/SocialHost.jsx';import{socialInterruption}from'./src/social/interruption.js';import{navigate,useRoute}from'./src/platform/router.js';
import{BrandFonts}from'./src/shared/brand/art.jsx';import css from'./src/shared/ui/ui.css';import tokens from'./src/shared/theme/tokens.css';import brand from'./src/shared/brand/brand.css';
window.interruption=socialInterruption;
const nativeLog=[];window.nativeLog=nativeLog;
let snapshot={userId:'me',callId:'active-group-call',scope:'group',conversationId:'group-1',state:'connected',muted:false,participants:[{id:'me',userId:'me',name:'عمر',local:true,muted:false,speaking:false},{id:'friend',userId:'friend',name:'أحمد',muted:false,speaking:false}]};
window.MaydanNative={postMessage(raw){const message=JSON.parse(raw);nativeLog.push(message.type);queueMicrotask(()=>{if(message.type==='socialCallConnect')window.maydanNative.event('socialCall',snapshot);window.maydanNative.resolve(message.id,{ok:true,result:{authorized:true,status:'granted'}})})}};
const platform={sound:{play(){},setDucking(){}},toast(){},settings:{},roster:[],haptics:{vibrate(){}},storage:{get(){},set(){}}};
const request=async(path,options={})=>{const r=await fetch(path,{method:options.method||'GET',headers:{'content-type':'application/json'},body:options.body===undefined?undefined:JSON.stringify(options.body)});if(options.raw)return r;const data=await r.json();if(data.error)throw Object.assign(new Error(data.error),{code:data.error});return data};
function Screen(){const route=useRoute(),ui=useSocialUI(),lamma=useLamma();window.fixture={...window.fixture,navigate,getCall:()=>lamma.activeCall,getMedia:()=>lamma.media,show:ui.show,chat:ui.openChat,group:ui.openGroup,close:ui.close,reset:ui.resetSection,state:()=>({open:ui.open,presentation:ui.presentation,view:ui.view,drafts:ui.drafts,listState:ui.listState})};useEffect(()=>{socialInterruption.setContext({local:route.name==='play'});return()=>socialInterruption.setContext({local:false})},[route.name]);return <>{['friends','friend-group'].includes(route.name)?<div data-social-page-slot/>:<main><h1>{route.name}</h1><button onClick={()=>ui.show()}>افتح الأصدقاء</button></main>}<nav aria-label="التنقل التجريبي"><button onClick={()=>navigate('/')}>الألعاب</button><button onClick={()=>navigate('/friends')}>الأصدقاء</button><button onClick={()=>navigate('/store')}>المتجر</button><button onClick={()=>navigate('/settings')}>الإعدادات</button></nav></>}
function App(){const[owner,setOwner]=useState('me'),[ready,setReady]=useState(!new URLSearchParams(location.search).has('hydrate'));useEffect(()=>{if(!ready){const timer=setTimeout(()=>setReady(true),60);return()=>clearTimeout(timer)}},[ready]);window.fixture={...window.fixture,setOwner};const account={...NULL_ACCOUNT,ready,signedIn:!!owner,user:owner?{id:owner,name:'عمر'}:null,requestAuthenticated:request,refresh:async()=>{},markTrial(){},gameAccess:()=> 'trial',authHeaders:()=>({Authorization:'Bearer fixture'}),ensureNativeSocialSession:async()=>({userId:owner,deviceId:'fixture-device',call:owner&&!new URLSearchParams(location.search).has('no-call')?snapshot:null})};return <AccountContext.Provider value={account}><PlatformContext.Provider value={platform}><BrandFonts/><style>{tokens}</style><style>{css}</style><style>{brand}</style><SocialProvider><LammaProvider><SocialUIProvider><ProfileProvider><Screen/><SocialHost/></ProfileProvider></SocialUIProvider></LammaProvider></SocialProvider></PlatformContext.Provider></AccountContext.Provider>};createRoot(document.getElementById('root')).render(<App/>);`, loader: 'jsx', resolveDir: process.cwd() }, bundle: true, write: false, format: 'iife', define: { __MAYDAN_ROOMS_URL__: JSON.stringify('same-origin') }, jsx: 'automatic', loader: { '.css': 'text', '.webp': 'dataurl', '.woff2': 'dataurl' }, logLevel: 'silent' });
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
const out = process.env.E2E_OUTPUT_DIR || '.cache/social-game-launch'; await fs.mkdir(out,{recursive:true});
const result={scope:'Real current SocialHost, shared Conversation, SocialUIProvider, SocialProvider, LammaProvider, ProfileProvider; local synthetic API only, no production calls',engines:[]};
const reset = () => { inviteFailures = 1; holdCreate = false; releaseCreate = null; createdRooms.length = 0; invitations.length = 0; };
const bounds = async (page, dialog) => {
  const value = await dialog.evaluate(node => { const box=node.getBoundingClientRect();const controls=[...node.querySelectorAll('button,input')].filter(element=>!element.disabled&&element.offsetParent!==null).map(element=>{const rect=element.getBoundingClientRect();return {label:element.textContent||element.getAttribute('aria-label'),left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom}});return {width:innerWidth,height:innerHeight,left:box.left,right:box.right,top:box.top,bottom:box.bottom,overflow:document.documentElement.scrollWidth>innerWidth,controls}; });
  assert.equal(value.overflow,false);
  assert.ok(value.left>=-1&&value.right<=value.width+1&&value.top>=-1&&value.bottom<=value.height+1,JSON.stringify(value));
  const footer=await dialog.locator('.modal-foot').boundingBox();assert.ok(footer.x>=0&&footer.x+footer.width<=value.width+1&&footer.y+footer.height<=value.height+1,JSON.stringify({footer,value}));
  return value;
};
try {
 for (const [name,type] of [['chromium',chromium],['webkit',webkit]]) {
  const browser=await type.launch();
  try {
   const scenarios=[];
   for(const [label,viewport] of [['phone',{width:390,height:844}],['small-phone',{width:320,height:568}],['landscape',{width:844,height:390}]]) {
    reset();const page=await browser.newPage({viewport,reducedMotion:'reduce'});const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
    await page.goto(origin+'/#/friends/group/group-1');
    await page.waitForFunction(()=>window.fixture?.getCall()?.id==='active-group-call');
    await page.getByRole('button',{name:'يلا نلعب',exact:true}).click();
    const dialog=page.getByRole('dialog',{name:'يلا نلعب',exact:true});await dialog.waitFor();
    const initialBounds=await bounds(page,dialog);
    await page.screenshot({path:path.join(out,name+'-'+label+'-launch.png')});
    await dialog.getByRole('button',{name:'ابدأ وادعُ أصحابك',exact:true}).click();
    await dialog.getByRole('alert').waitFor();
    assert.equal(createdRooms.length,1);assert.equal(invitations.length,1);assert.equal(createdRooms[0].game,'fabraka');
    await dialog.getByText(/الغرفة.*جاهزة/).waitFor();
    await bounds(page,dialog);
    await dialog.getByRole('button',{name:'إرسال الدعوة',exact:true}).click();
    await page.getByRole('heading',{name:'room',exact:true}).waitFor();
    assert.equal(createdRooms.length,1);assert.equal(invitations.length,2);assert.equal(invitations[0].clientId,invitations[1].clientId);
    assert.equal(await page.evaluate(()=>window.fixture.getCall()?.id),'active-group-call');
    assert.equal(await page.evaluate(()=>window.fixture.getMedia().connected),true);
    assert.equal(await page.evaluate(()=>window.nativeLog.includes('socialCallEnd')),false);
    assert.equal(await page.locator('[role="dialog"][aria-label="يلا نلعب"]').count(),0);
    assert.equal(await page.evaluate(()=>document.getElementById('root').inert),false);
    assert.deepEqual(errors,[]);
    scenarios.push({label,initialBounds,roomCreates:createdRooms.length,inviteRequests:invitations.length,callSurvives:true,pageErrors:errors});
    await page.close();
   }
   reset();inviteFailures=0;const page=await browser.newPage({viewport:{width:390,height:844},reducedMotion:'reduce'});
   await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
   await page.goto(origin+'/#/friends/friend');await page.getByRole('button',{name:'يلا نلعب',exact:true}).click();
   let dialog=page.getByRole('dialog',{name:'يلا نلعب',exact:true});await dialog.getByRole('button',{name:'عندي رمز غرفة',exact:true}).click();
   await dialog.getByRole('textbox',{name:'رمز الغرفة',exact:true}).fill('٢٣٤٥٦٧');
   await dialog.getByRole('button',{name:'إرسال الدعوة',exact:true}).click();await dialog.waitFor({state:'detached'});
   assert.equal(createdRooms.length,0);assert.equal(invitations[0].roomCode,'234567');assert.equal(invitations[0].scope,'direct');
   await page.getByText('مكانك معنا في الميدان',{exact:true}).waitFor();
   // A slow room create must not navigate or invite after changing the account.
   await page.getByRole('button',{name:'يلا نلعب',exact:true}).click();holdCreate=true;
   dialog=page.getByRole('dialog',{name:'يلا نلعب',exact:true});await dialog.getByRole('button',{name:'ابدأ وادعُ أصحابك',exact:true}).click();
   await page.waitForFunction(()=>document.querySelector('[role="dialog"][aria-label="يلا نلعب"] button[disabled]'));
   while(!releaseCreate) await new Promise(resolve=>setTimeout(resolve,5));
   await page.evaluate(()=>window.fixture.setOwner(null));await page.getByRole('button',{name:'سجّل الدخول وخلّك قريب'}).waitFor();releaseCreate();
   await page.waitForFunction(()=>!document.querySelector('[role="dialog"][aria-label="يلا نلعب"]'));
   await page.waitForFunction(()=>location.hash==='#/friends');assert.equal(invitations.length,1,JSON.stringify({invitations,createdRooms,writes}));assert.equal(await page.evaluate(()=>location.hash),'#/friends');assert.equal(await page.locator('.social-message').count(),0);
   await page.close();
   // The header acknowledges the tap while the call-start request is pending.
   reset();const connecting=await browser.newPage({viewport:{width:320,height:568},reducedMotion:'reduce'});
   await connecting.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
   await connecting.goto(origin+'/?no-call=1#/friends/friend');
   await connecting.getByRole('button',{name:'مكالمة صوتية',exact:true}).click();
   await connecting.getByRole('status').filter({hasText:'جارٍ الاتصال…'}).waitFor();
   assert.equal(await connecting.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   await connecting.screenshot({path:path.join(out,name+'-connecting-feedback.png')});
   releaseCall();await connecting.waitForFunction(()=>window.fixture.getMedia().connected);await connecting.close();
   result.engines.push({engine:name,scenarios,directExistingInvite:true,staleAccountSuppressed:true,connectingFeedback:true});
  }finally{await browser.close();}
 }
 await fs.writeFile(path.join(out,'results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}finally{await new Promise(resolve=>server.close(resolve));}

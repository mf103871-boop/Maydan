// Real social/profile providers, router, navigation and drawer; synthetic HTTP
// accounts and a local RTC SDK seam. No real room, credentials or voice service.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';
import { chromium, webkit } from 'playwright';

const root = process.cwd();
const output = process.env.SOCIAL_PROFILE_V3_EVIDENCE_DIR || path.join(root, '.cache/social-profile-v3');
await mkdir(output, { recursive: true });
const me = { id: 'me', name: 'Omar', avatarPreset: 'controller', theme: 'teal' };
const peer = { id: 'friend', name: 'Lina', code: 'DEMO-1234', avatarPreset: 'fox', theme: 'teal', online: true, conversationId: 'direct-1', unreadCount: 0 };
const message = { seq: 1, clientId: 'first', senderId: 'friend', conversationId: 'direct-1', kind: 'text', text: 'A game with friends tonight?', createdAt: Date.now() - 20000 };
const preferences = { messages: true, calls: true, friendRequests: true, groupInvites: true, previews: false, sound: false, mutedConversations: [] };
const profile = user => ({ ...user, friendCount: 3, bio: 'Good games. Good company.', relationship: user.id === 'me' ? 'self' : 'friend', earnedBadges: ['welcome', 'first-win'], featuredBadges: ['welcome', 'first-win'], earnedTitles: [], achievements: [], cosmetics: {}, stats: { localSessions: 12, onlineMatches: 8, onlineWins: 3, distinctGames: 4 } });
let writes = [], call = null;
function api(url, method, body) {
  if (method !== 'GET') writes.push({ url, method, body });
  if (url === '/api/social/state') return { user: me, friends: [peer], incoming: [], outgoing: [], blocked: [], conversations: [{ id: 'direct-1', user: peer, unreadCount: 0, lastMessage: message }] };
  if (url.startsWith('/api/social/conversations/direct-1/messages')) return { messages: [message], readSeq: 1, peerReadSeq: 1, hasMore: false };
  if (url === '/api/social/conversations/direct-1/read') return { readSeq: body.seq };
  if (url === '/api/social/preferences') return { preferences };
  if (url === '/api/social/capabilities') return { capabilities: { voiceMessages: false, liveCalls: true, pushNotifications: false } };
  if (url === '/api/social/calls') {
    if (method === 'POST') {
      call = { id: 'fixture-call', scope: body.scope, conversationId: body.conversationId, status: 'active', expiresAt: Date.now() + 600000, participants: [{ userId: 'me', state: 'active', deviceId: body.deviceId }, { userId: 'friend', state: 'active' }] };
      return { call, connection: { url: 'wss://fixture.invalid', token: 'synthetic-not-a-credential' } };
    }
    return { calls: call ? [call] : [] };
  }
  if (url === '/api/social/calls/fixture-call/leave') { call = null; return { ok: true }; }
  if (url === '/api/social/calls/fixture-call') return { call };
  if (url === '/api/social/groups') return { groups: [], incoming: [] };
  if (url === '/api/social/room-invitations') return { invitation: { id: 'fixture-invite', roomCode: body.roomCode } };
  if (url.startsWith('/api/profiles/')) return { profile: profile(url.includes('friend') ? peer : me) };
  if (url === '/api/social/live-ticket') return { error: 'SOCIAL_UNAVAILABLE' };
  return {};
}
const source = `import React,{useState,useEffect}from'react';import{createRoot}from'react-dom/client';
import{AccountContext,NULL_ACCOUNT}from'./src/shared/account/context.js';import{PlatformContext}from'./src/platform/context.js';
import{SocialProvider}from'./src/social/SocialProvider.jsx';import{LammaProvider,useLamma}from'./src/social/LammaProvider.jsx';import{SocialUIProvider,useSocialUI}from'./src/social/SocialUIProvider.jsx';import{ProfileProvider}from'./src/profiles/ProfileProvider.jsx';import{SocialHost}from'./src/social/SocialHost.jsx';import{socialInterruption}from'./src/social/interruption.js';import{navigate,useRoute}from'./src/platform/router.js';
import{ProfileScreen}from'./src/profiles/ProfileScreen.jsx';import{BottomNavigation}from'./src/platform/BottomNavigation.jsx';import{CallViewport}from'./src/social/CallViewport.jsx';import{BrandFonts}from'./src/shared/brand/art.jsx';import{setUiLocale}from'./src/shared/i18n/core.js';
import tokens from'./src/shared/theme/tokens.css';import uiCss from'./src/shared/ui/ui.css';import platformCss from'./src/platform/platform.css';import brand from'./src/shared/brand/brand.css';import studio from'./src/platform/playful-studio.css';
const locale=new URLSearchParams(location.search).get('locale');await setUiLocale(locale);document.documentElement.lang=locale;document.documentElement.dir=locale==='ar'?'rtl':'ltr';
window.rtc={connects:0,disconnects:0};class Room{constructor(){this.remoteParticipants=new Map([['friend',{identity:'friend',name:'Lina',isMicrophoneEnabled:true}]]);this.localParticipant={identity:'me',name:'Omar',isMicrophoneEnabled:false,setMicrophoneEnabled:async enabled=>{this.localParticipant.isMicrophoneEnabled=enabled;}};}on(){return this;}async connect(){window.rtc.connects++;}async disconnect(){window.rtc.disconnects++;}async startAudio(){}}
window.fixtureSDK={Room,RoomEvent:Object.fromEntries(['ParticipantConnected','ParticipantDisconnected','ActiveSpeakersChanged','TrackMuted','TrackUnmuted','LocalTrackPublished','LocalTrackUnpublished','TrackSubscribed','TrackUnsubscribed','Reconnecting','Reconnected','Disconnected'].map(x=>[x,x])),Track:{Kind:{Audio:'audio'}}};
const request=async(url,options={})=>{const response=await fetch(url,{method:options.method||'GET',headers:{'content-type':'application/json'},body:options.body===undefined?undefined:JSON.stringify(options.body)});if(options.raw)return response;const data=await response.json();if(data.error)throw Object.assign(new Error(data.error),{code:data.error});return data;};
const platform={sound:{play(){},setDucking(){}},haptics:{vibrate(){}},toast(){},settings:{},roster:[],storage:{get(){},set(){}}};const account={...NULL_ACCOUNT,ready:true,signedIn:true,user:${JSON.stringify(me)},requestAuthenticated:request,refresh:async()=>{}};
window.gameMounts=0;function Game(){const[n,setN]=useState(7);useEffect(()=>{window.gameMounts++;socialInterruption.setContext({local:true});return()=>socialInterruption.setContext({local:false});},[]);return <main><h1>Local game shell fixture</h1><output data-testid="game-value">{n}</output><button data-testid="game-point" onClick={()=>setN(n+1)}>Fixture: one point</button></main>;}
function Screen(){const route=useRoute(),ui=useSocialUI(),lamma=useLamma();window.inspect=()=>({route:route.path,view:ui.view,presentation:ui.presentation,drafts:ui.drafts,call:lamma.activeCall?.id,connected:lamma.media?.connected,interruption:socialInterruption.getSnapshot()});return <><CallViewport>{route.name==='friends'?<div data-social-page-slot/>:route.name==='play'?<Game/>:route.name==='profile'?<ProfileScreen profileId={route.params.id}/>:<main><h1>Fixture menu</h1><button data-testid="enter-game" onClick={()=>navigate('/play/fabraka')}>Fixture: enter local game</button></main>}</CallViewport><BottomNavigation route={route}/></>;}
createRoot(document.getElementById('root')).render(<AccountContext.Provider value={account}><PlatformContext.Provider value={platform}><BrandFonts/><style>{tokens}</style><style>{uiCss}</style><style>{platformCss}</style><SocialProvider><LammaProvider><SocialUIProvider><ProfileProvider><Screen/><SocialHost/></ProfileProvider></SocialUIProvider></LammaProvider></SocialProvider><style>{brand}</style><style>{studio}</style></PlatformContext.Provider></AccountContext.Provider>);`;
const bundle = await build({ stdin: { contents: source, resolveDir: root, loader: 'jsx' }, bundle: true, write: false, format: 'esm', jsx: 'automatic', loader: { '.css': 'text', '.webp': 'dataurl', '.woff2': 'dataurl' }, define: { __MAYDAN_ROOMS_URL__: JSON.stringify('same-origin') }, logLevel: 'silent', plugins: [{ name: 'local-rtc-sdk-only', setup(builder) { builder.onLoad({ filter: /src[\\/]social[\\/]media\.js$/ }, async ({ path: file }) => { const original = await readFile(file, 'utf8'); assert.ok(original.includes('this.loadSDK = loadSDK;')); return { contents: original.replace('this.loadSDK = loadSDK;', 'this.loadSDK = () => Promise.resolve(window.fixtureSDK);'), loader: 'js' }; }); } }] });
const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://local');
  if (url.pathname === '/bundle.js') { response.writeHead(200, { 'content-type': 'text/javascript' }); response.end(bundle.outputFiles[0].text); return; }
  if (url.pathname.startsWith('/api/')) { let raw = ''; for await (const chunk of request) raw += chunk; const data = api(url.pathname + url.search, request.method, raw ? JSON.parse(raw) : undefined); response.writeHead(data.error ? 503 : 200, { 'content-type': 'application/json' }); response.end(JSON.stringify(data)); return; }
  if (url.pathname.startsWith('/assets/')) { const file = path.resolve(root, 'public', '.' + url.pathname); assert.ok(file.startsWith(path.resolve(root, 'public/assets') + path.sep)); try { const bytes = await readFile(file); response.writeHead(200, { 'content-type': 'image/webp' }); response.end(bytes); } catch { response.writeHead(404); response.end(); } return; }
  response.writeHead(200, { 'content-type': 'text/html;charset=utf-8' }); response.end('<!doctype html><html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/bundle.js"></script></html>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
test.after(() => new Promise(resolve => server.close(resolve)));
const settle = page => page.evaluate(async () => { await document.fonts.ready; await Promise.allSettled(document.getAnimations().filter(animation => Number.isFinite(animation.effect?.getComputedTiming().endTime)).map(animation => animation.finished)); await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });

for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]]) for (const locale of ['ar', 'en']) test(`${name}/${locale}: social full profile, back/draft, invitation/call and unchanged game drawer`, { timeout: 90000 }, async () => {
  writes = []; call = null;
  const browser = await engine.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  const errors = [], external = [], passed = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => { if (new URL(route.request().url()).origin !== origin) { external.push(route.request().url()); return route.abort(); } return route.continue(); });
  const nav = page.locator('.menu-navigation');
  const profileRoot = page.locator('.profile-screen');
  const profileBack = profileRoot.locator('.profile-page-head [data-design-id="back"]');
  const friendRow = page.locator('[data-design-id="friend-row"]').first();
  const save = async label => { await settle(page); await page.screenshot({ path: path.join(output, `${name}-${locale}-${label}.png`) }); };
  try {
    await page.goto(origin + '/?locale=' + locale + '#/friends');
    await friendRow.locator('[data-design-id="friend-avatar"]').click();
    await profileRoot.locator('h1').waitFor(); await settle(page);
    assert.equal(await page.locator('.lamma-page-panel>.lamma-panel-head').count(), 0);
    assert.equal(await page.locator('.lamma-profile-preview.is-full-profile').count(), 1);
    assert.equal(await nav.isVisible(), true);
    assert.equal(await nav.locator('[aria-current="page"]').getAttribute('data-design-id'), 'friends');
    assert.equal(await page.locator('#root').evaluate(el => el.inert), false);
    assert.equal(await page.evaluate(() => location.hash), '#/friends');
    const primaryGeometry = await profileRoot.locator('.profile-contact-actions .btn-primary').evaluate(el => { const style = getComputedStyle(el); return { height: el.getBoundingClientRect().height, minHeight: style.minHeight, transform: style.transform, fontSize: style.fontSize, ancestors: [el.parentElement, el.parentElement.parentElement, el.closest('.profile-screen')].map(node => ({ className: node.className, transform: getComputedStyle(node).transform, zoom: getComputedStyle(node).zoom })) }; });
    await writeFile(path.join(output, `${name}-${locale}-primary.json`), JSON.stringify(primaryGeometry, null, 2));
    const order = await page.locator('.lamma-profile-preview').evaluate(el => ({ profile: [...el.children].indexOf(el.querySelector('.profile-screen')), actions: [...el.children].indexOf(el.querySelector('.lamma-profile-actions')) }));
    assert.ok(order.profile >= 0 && order.actions > order.profile, 'page actions follow the complete profile');
    await save('friends-profile');
    const controlAppearance = root => Object.fromEntries(['profile-tab-stats','profile-tab-achievements','share','code','friend-chat'].map(id => {
      const node = root.querySelector('[data-design-id="'+id+'"]'), style = getComputedStyle(node);
      return [id,{fontFamily:style.fontFamily,fontSize:style.fontSize,fontWeight:style.fontWeight,lineHeight:style.lineHeight,color:style.color,borderRadius:style.borderRadius,minHeight:style.minHeight}];
    }));
    const embeddedAppearance = await profileRoot.evaluate(controlAppearance);
    const directPage = await browser.newPage({viewport:{width:390,height:844},reducedMotion:'reduce'});
    try {
      await directPage.route('**/*', route => { if(new URL(route.request().url()).origin!==origin){external.push(route.request().url());return route.abort();}return route.continue(); });
      await directPage.goto(origin+'/?locale='+locale+'#/profile/friend');
      await directPage.locator('.profile-screen .profile-contact-actions').waitFor(); await settle(directPage);
      const directAppearance = await directPage.locator('.profile-screen').evaluate(controlAppearance);
      assert.deepEqual(embeddedAppearance,directAppearance,'opening the same profile from Friends preserves the direct page typography and controls');
      await writeFile(path.join(output,`${name}-${locale}-direct-embedded-appearance.json`),JSON.stringify({embeddedAppearance,directAppearance},null,2));
    } finally { await directPage.close(); }
    passed.push('direct-and-social-profile-control-appearance-match');
    await profileBack.click(); await friendRow.waitFor(); passed.push('friends-profile-back');

    await friendRow.locator('.lamma-person-copy').click();
    const draft = locale === 'ar' ? 'مسودة محفوظة بعد زيارة الملف' : 'Draft kept after visiting the profile';
    await page.locator('.social-composer textarea').fill(draft);
    await page.locator('.social-chat-head > [data-design-id="profile"]').click();
    await profileRoot.locator('h1').waitFor(); await settle(page);
    assert.equal(await nav.isVisible(), true);
    assert.equal(await page.evaluate(() => location.hash), '#/friends/friend');
    await profileBack.click();
    assert.equal(await page.locator('.social-composer textarea').inputValue(), draft);
    assert.equal(await nav.isVisible(), false);
    assert.equal(await page.getByText(message.text, { exact: true }).isVisible(), true);
    await save('conversation-return'); passed.push('conversation-profile-back-preserves-draft-history');

    await page.locator('.social-chat-head > [data-design-id="profile"]').click();
    const actions = page.locator('.lamma-profile-actions');
    await actions.locator('[data-design-id="game-invite"]').click();
    const invite = page.locator('[data-design-screen="social.invite"]');
    await invite.locator('[data-design-id="entry-join"]').click();
    await invite.locator('[data-design-id="room-code"]').fill('123456');
    await invite.locator('[data-design-id="submit"]').click();
    await invite.waitFor({ state: 'detached' });
    const sent = writes.filter(item => item.url === '/api/social/room-invitations');
    assert.equal(sent.length, 1); assert.equal(sent[0].body.scope, 'direct'); assert.equal(sent[0].body.conversationId, 'direct-1'); assert.equal(sent[0].body.roomCode, '123456'); passed.push('ordinary-click-invitation-correct-target');
    await actions.locator('[data-design-id="call"]').click();
    await page.waitForFunction(() => window.inspect().connected && window.inspect().call === 'fixture-call');
    assert.equal(writes.filter(item => item.url === '/api/social/calls' && item.method === 'POST').length, 1);
    const started = writes.find(item => item.url === '/api/social/calls' && item.method === 'POST');
    assert.equal(started.body.scope, 'direct'); assert.equal(started.body.conversationId, 'direct-1');
    assert.equal(await page.evaluate(() => window.rtc.connects), 1);
    await page.locator('[data-testid="call-inline-controls"] [data-design-id="end-call"]').click();
    await page.waitForFunction(() => !window.inspect().call);
    assert.equal(writes.filter(item => item.url === '/api/social/calls/fixture-call/leave').length, 1);
    passed.push('ordinary-click-call-connect-and-end-with-local-sdk');
    await profileBack.click(); assert.equal(await page.locator('.social-composer textarea').inputValue(), draft);
    await page.locator('.social-chat-head [data-design-id="back"]').click();
    await nav.locator('[data-design-id="games"]').click();
    await page.getByTestId('enter-game').click(); await page.getByTestId('game-point').click();
    assert.equal(await page.getByTestId('game-value').textContent(), '8');
    await page.emulateMedia({reducedMotion:'no-preference'});
    await page.locator('.lamma-launcher').click();
    const drawer = page.locator('.lamma-panel[role="dialog"]'); await drawer.waitFor();
    await friendRow.locator('[data-design-id="friend-avatar"]').click();
    await profileRoot.waitFor(); await settle(page);
    assert.equal(await page.locator('.lamma-profile-preview.is-full-profile').count(), 0);
    assert.equal(await profileRoot.evaluate(element=>getComputedStyle(element).animationName),'none','the game drawer owns its entrance; the embedded profile must not animate twice');
    assert.equal(await page.locator('.profile-page-head').isVisible(), false);
    assert.equal(await drawer.locator('>.lamma-panel-head').isVisible(), true);
    assert.equal(await nav.isVisible(), false);
    assert.equal(await page.locator('#root').evaluate(el => el.inert), true);
    assert.equal(await page.evaluate(() => location.hash), '#/play/fabraka');
    assert.equal(await actions.locator('[data-design-id="game-invite"]').isEnabled(), true);
    assert.equal(await actions.locator('[data-design-id="call"]').isEnabled(), true);
    await save('game-profile-drawer');
    await drawer.locator('>.lamma-panel-head [data-design-id="back"]').click();
    await friendRow.locator('.lamma-person-copy').click();
    assert.equal(await page.locator('.social-composer textarea').inputValue(), draft);
    await drawer.locator('.social-chat-head [data-design-id="close"]').click();
    await drawer.waitFor({ state: 'detached' });
    assert.equal(await page.locator('#root').evaluate(el => el.inert), false);
    assert.equal(await page.getByTestId('game-value').textContent(), '8');
    assert.equal(await page.evaluate(() => window.gameMounts), 1);
    assert.equal(await page.evaluate(() => location.hash), '#/play/fabraka');
    assert.equal(await nav.isVisible(), false);
    assert.equal(writes.some(item => item.method === 'POST' && item.url.includes('/messages')), false, 'visiting a profile never sends the draft');
    await save('game-restored'); passed.push('drawer-profile-back-draft-and-game-state-retained');
    assert.ok(primaryGeometry.height >= 52, `the primary profile contact target is at least 52px, got ${JSON.stringify(primaryGeometry)}`);
    assert.deepEqual(errors, []); assert.deepEqual(external, []);
    await writeFile(path.join(output, `${name}-${locale}.json`), JSON.stringify({ passed: true, engine: name, locale, viewport: { width: 390, height: 844 }, checks: passed, errors, externalRequests: external.length, fixture: 'Synthetic authenticated account + HTTP transport + RTC SDK; real providers/router/navigation/profile/drawer. Game is a mounted state probe, not a gameplay acceptance test. No live audio.', writes }, null, 2));
  } catch (error) { await save('failure').catch(() => {}); await writeFile(path.join(output, `${name}-${locale}-failure.json`), JSON.stringify({ error: String(error), passed, errors, writes, state: await page.evaluate(() => window.inspect?.()).catch(() => null) }, null, 2)); throw error; }
  finally { await browser.close(); }
});

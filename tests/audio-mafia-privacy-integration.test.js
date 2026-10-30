import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { createMafiaPhaseAudio, createMafiaPublicAudio } from '../src/games/mafia/audio.js';
import { hasVisibleMafiaCallControls } from '../src/social/mafia-call-controls.js';

// Only provider/transport and unrelated screen dependencies are fixtures.
// SocialHost, its notification-audio controller and the global interruption
// store are the real merged product modules. A remote lease is deliberately
// visible before SocialProvider's later effect updates the global store.
const modules = {
  '../online/Mafia.jsx': 'export const MafiaSettings=()=>null;',
  '../online/Badeeha.jsx': 'export const BadeehaSettings=()=>null,normalizeBadeehaOptions=x=>x||{},buildBadeehaRoom=()=>({}),badeehaReady=()=>({ok:true});',
  '../data/categories/index.js': 'export const CATS=[];',
  '../games/badeeha/persistence.js': 'export const readBadeehaState=()=>({history:[]});',
  '../online/client.js': 'export const readSaved=()=>null,save=()=>{};',
  '../shared/account/context.js': 'export const useAccount=()=>globalThis.__mafiaAudioFixture.account;',
  '../shared/account/api.js': 'export const resolveAccountServer=()=>"https://isolated.invalid";',
  '../shared/account/SignInSheet.jsx': 'export const SignInSheet=()=>null;',
  '../shared/ui/components.jsx': "import React from 'react';export const Button=({children,...p})=>React.createElement('button',p,children);export const Modal=({children,title,onClose})=>React.createElement('section',{'data-testid':'social-modal'},title,children,React.createElement('button',{onClick:onClose},'إغلاق'));",
  '../shared/ui/useVisualViewport.js': 'export const useVisualViewport=()=>{};',
  '../shared/ui/dialog-interaction.js': 'export const activateDialog=()=>()=>{};',
  '../platform/context.js': 'export const usePlatform=()=>({sound:globalThis.__mafiaAudioFixture.sound});',
  '../platform/router.js': 'export const useRoute=()=>({name:"home",path:"/",params:{}}),navigate=()=>{};',
  '../profiles/ProfileProvider.jsx': 'export const useProfiles=()=>({mine:null});',
  '../profiles/ProfileScreen.jsx': 'export const ProfileView=()=>null;',
  '../profiles/ProfileAvatar.jsx': "import React from 'react';export const ProfileAvatar=()=>React.createElement('span',{'data-avatar':'fixture'});",
  '../profiles/catalog.js': 'export const AVATAR_PRESETS=[{id:"fixture"}];',
  './SocialProvider.jsx': 'export const useSocial=()=>globalThis.__mafiaAudioFixture.social;',
  './SocialUIProvider.jsx': 'export const useSocialUI=()=>globalThis.__mafiaAudioFixture.ui,conversationDraftKey=(a,b)=>a+":"+b;',
  './LammaProvider.jsx': 'export const useLamma=()=>globalThis.__mafiaAudioFixture.lamma;',
  './CallDock.jsx': "import React from 'react';export const CallControls=p=>React.createElement('section',{'data-testid':'delegated-call-controls'},React.createElement('button',{'data-testid':'delegated-call-end',onClick:p.onEnd},'إنهاء المكالمة'),React.createElement('button',{'data-testid':'delegated-call-mute',onClick:()=>p.onMute(true)},'كتم'));",
  './CallViewport.jsx': 'export const useCallDockLayout=()=>{};',
  './SocialScreen.jsx': "import React from 'react';export const ActionDialog=()=>null,Conversation=()=>null,PersonAvatar=()=>React.createElement('span'),SearchDialog=()=>null,presenceLabel=()=>'';",
  './LammaMedia.jsx': "import React from 'react';export const LammaButton=({label,icon:_icon,...p})=>React.createElement('button',p,label),LammaIcon=()=>null,VoiceRecorder=()=>null,VoiceMessage=()=>null,GameInviteCard=()=>null,mediaError=x=>String(x);",
  './game-launch.js': 'export const createSocialGameLauncher=()=>({});',
};
const plugin = { name: 'owned-social-provider-fixtures', setup(builder) {
  builder.onResolve({ filter: /.*/ }, args => args.importer.endsWith('SocialHost.jsx') && modules[args.path] ? { path: args.path, namespace: 'social-provider-fixture' } : undefined);
  builder.onLoad({ filter: /.*/, namespace: 'social-provider-fixture' }, args => ({ contents: modules[args.path], loader: 'js', resolveDir: process.cwd() }));
} };
const fixtureSource = `
export function makeFixture(locked=false,call=null) {
 const noop=()=>{},friend={id:'friend',name:'PRIVATE_FRIEND_NAME',conversationId:'direct',lastMessage:{id:'message',text:'PRIVATE_MESSAGE_TEXT'}};
 const fixture={account:{ready:true,signedIn:true,user:{id:'owner'}},sound:{emit:(type,options)=>{fixture.emitted.push({type,...options});return true;}},emitted:[],actions:[],
 social:{mafiaCommunicationLocked:locked,friends:[friend],conversationList:[],incoming:[],outgoing:[],conversations:{},notification:{id:1,userId:'owner',type:'message',friend},clearNotification:noop},
 ui:{open:false,drawerOpen:false,presentation:'drawer',view:{type:'list',tab:'friends'},listState:{friends:{}},favorites:[],drafts:{},close:noop,show:noop,openChat:noop,openGroup:noop,updateListState:noop},
 lamma:{groups:[],groupInvites:[],groupConversations:{},activeCall:call,media:{participants:[]},notifications:{enabled:true,sound:true,previews:true,mutedConversations:[]},callMembers:{},clearNotification:noop,endCall:()=>fixture.actions.push('end'),setCallMuted:()=>fixture.actions.push('mute')}};
 return fixture;
}`;
let directory, render;
const entry = "import React from 'react';import {SocialHost} from './src/social/SocialHost.jsx';";
before(async () => {
  const cache = path.resolve('.cache'); await mkdir(cache, { recursive: true }); directory = await mkdtemp(path.join(cache, 'audio-mafia-integration-'));
  await build({ stdin: { contents: entry + fixtureSource + "import {renderToStaticMarkup}from'react-dom/server';export const render=(locked,call)=>{globalThis.__mafiaAudioFixture=makeFixture(locked,call);return renderToStaticMarkup(React.createElement(SocialHost)).replace(/<style>[\\s\\S]*?<\\/style>/g,'');};", resolveDir: process.cwd() },
    outfile: path.join(directory, 'server.mjs'), bundle: true, platform: 'node', format: 'esm', packages: 'external', jsx: 'automatic', loader: { '.js': 'jsx', '.css': 'text', '.webp': 'dataurl', '.woff2': 'dataurl' }, plugins: [plugin], logLevel: 'silent' });
  ({ render } = await import(pathToFileURL(path.join(directory, 'server.mjs'))));
});
after(async () => {
  delete globalThis.__mafiaAudioFixture;
  if (directory) { assert.equal(path.dirname(directory), path.resolve('.cache')); await rm(directory, { recursive: true, force: true }); }
});

test('audio/Mafia privacy integration: remote reservation masks actual SocialHost notification on the very first render', () => {
  const normal = render(false); assert.match(normal, /PRIVATE_FRIEND_NAME|PRIVATE_MESSAGE_TEXT/);
  const reserved = render(true); assert.doesNotMatch(reserved, /PRIVATE_FRIEND_NAME|PRIVATE_MESSAGE_TEXT|class="lamma-notification"/);
});

test('audio/Mafia privacy integration: account-wide lock preserves escape control delegation for the currently owned Mafia call', () => {
  const own = { id: 'owned-call', scope: 'mafia', _ownerId: 'owner' };
  assert.match(render(true, own), /delegated-call-end/);
  assert.doesNotMatch(render(true, { ...own, _ownerId: 'other-account' }), /delegated-call-end/);
});

test('audio/Mafia privacy integration: v2 private tracking and conversion produce the same neutral audible transcript', () => {
  const transcript = secret => {
    const cues = [], bus = { play: (type, options) => cues.push({ type, guard: options.guard }), stopCues() {}, emit: (type, options) => cues.push({ type, guard: options.guard }) };
    const phase = createMafiaPhaseAudio(bus), publicAudio = createMafiaPublicAudio(bus);
    for (const [phaseId, phaseName] of [[1, 'night'], [2, 'dawn'], [3, 'discussion']]) {
      const state = { code: '123456', matchId: 1, phaseId, phase: phaseName, rulesetVersion: 2, serverNow: 100, log: [] };
      for (const name of ['you', 'roleStates', 'privateEvents', 'replay']) Object.defineProperty(state, name, { get() { throw Error('No private audio reads: ' + secret + name); } });
      phase.update(state); publicAudio.update(state);
    }
    return cues.map(cue => cue.type);
  };
  assert.deepEqual(transcript('tracked-doctor-converted'), transcript('tracker-blocked'));
});

test('audio/Mafia privacy integration: stale or hidden in-game controls never take away the real floating disconnect path', () => {
  const node = { isConnected: true, getAttribute: name => name === 'data-mafia-call-controls' ? 'new-call' : 'true', closest: () => null, getClientRects: () => [{}], parentElement: null };
  const document = { querySelectorAll: () => [node], defaultView: { getComputedStyle: () => ({ visibility: 'visible', opacity: '1' }) } };
  assert.equal(hasVisibleMafiaCallControls(document, { id: 'old-call', scope: 'mafia' }), false);
  assert.equal(hasVisibleMafiaCallControls(document, { id: 'new-call', scope: 'mafia' }), true);
  node.closest = () => ({});
  assert.equal(hasVisibleMafiaCallControls(document, { id: 'new-call', scope: 'mafia' }), false);
});

if (process.env.MAFIA_AUDIO_PRIVACY_BROWSER === '1') for (const engine of ['chromium', 'webkit']) test(`audio/Mafia privacy integration: ${engine} immediate remote-lock render and queued sound fence preserve owned call exit`, async () => {
  const browsers = await import('playwright');
  const filename = path.join(directory, `browser-${engine}.js`);
  await build({ stdin: { contents: entry + fixtureSource + `import{createRoot}from'react-dom/client';import{flushSync}from'react-dom';
    const root=createRoot(document.getElementById('root'));window.__mafiaAudioFixture=makeFixture();
    window.draw=()=>flushSync(()=>root.render(React.createElement(SocialHost)));window.reserve=locked=>{window.__mafiaAudioFixture.social.mafiaCommunicationLocked=locked;window.draw();};window.draw();`, resolveDir: process.cwd() },
    outfile: filename, bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', loader: { '.js': 'jsx', '.css': 'text', '.webp': 'dataurl', '.woff2': 'dataurl' }, plugins: [plugin], logLevel: 'silent' });
  const browser = await browsers[engine].launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } }), errors = [];
    page.on('pageerror', error => errors.push(error.message)); await page.route('**/*', route => route.abort());
    await page.setContent('<!doctype html><html><body><div id="root"></div></body></html>'); await page.addScriptTag({ content: await readFile(filename, 'utf8') });
    await page.getByText('رسالة من PRIVATE_FRIEND_NAME', { exact: true }).waitFor();
    await page.waitForFunction(() => window.__mafiaAudioFixture.emitted.length === 1);
    assert.equal(await page.evaluate(() => window.__mafiaAudioFixture.emitted[0].guard()), true);
    await page.evaluate(() => window.reserve(true));
    assert.equal(await page.locator('.lamma-notification').count(), 0);
    assert.equal(await page.evaluate(() => window.__mafiaAudioFixture.emitted[0].guard()), false);
    await page.evaluate(() => { window.__mafiaAudioFixture.lamma.activeCall = { id: 'owned-call', scope: 'mafia', _ownerId: 'owner' }; window.draw(); });
    await page.getByTestId('delegated-call-end').click(); assert.deepEqual(await page.evaluate(() => window.__mafiaAudioFixture.actions), ['end']);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

if (process.env.MAFIA_AUDIO_PRIVACY_BROWSER === '1') for (const engine of ['chromium', 'webkit']) test(`audio/Mafia privacy integration: ${engine} pagehide before hidden covers real role/report DOM without changing the match`, async () => {
  const browsers = await import('playwright'), filename = path.join(directory, `mafia-view-${engine}.js`);
  await build({ stdin: { resolveDir: process.cwd(), loader: 'jsx', contents: `
    import React from 'react';import{createRoot}from'react-dom/client';import{flushSync}from'react-dom';
    import{MafiaMatchView}from'./src/online/Mafia.jsx';import{createDesignFixture}from'./src/design/screen-catalog.js';import{hasVisibleMafiaCallControls}from'./src/social/mafia-call-controls.js';
    const value=createDesignFixture('online.mafia.night',{now:Date.now()});delete value.state._designPreview;delete value.state.previewReveal;
    value.state.rulesetVersion=2;value.state.settings={...value.state.settings,visibility:'private',voiceMode:'optional',experimentalRole:'tracker'};
    value.state.mafiaVoice={callId:'privacy-test-call',mediaEpoch:7};value.state.you.voice={canListen:false,canSpeak:false};
    value.state.you.roleId='tracker';value.state.you.resources={charges:2};value.state.you.reports=[{id:1,type:'tracking',text:'PRIVATE_TRACKING_REPORT_SENTINEL'}];
    value.state.you.actions=[{type:'night_action',ability:'track',remaining:2,count:1,targets:value.state.members.filter(m=>m.id!==value.me.id).map(m=>m.id)}];
    window.originalState=value.state;window.actions=[];window.voiceActions=[];window.__privacyHidden=false;Object.defineProperty(document,'hidden',{configurable:true,get:()=>window.__privacyHidden});
    const voice={status:'connected',muted:true,requested:true,mediaEpoch:7,canPublish:false,onLeave:()=>window.voiceActions.push('leave'),onMute:()=>window.voiceActions.push('mute')};
    window.hasOwnedCallControls=()=>hasVisibleMafiaCallControls(document,{id:'privacy-test-call',scope:'mafia'});
    const root=createRoot(document.getElementById('root'));flushSync(()=>root.render(<MafiaMatchView {...value} accountId="owner" voice={voice} act={(...args)=>window.actions.push(args)} clock={{remainingMs:35000,nowMs:Date.now(),paused:true}}/>));
    window.lifecycle=event=>{window.dispatchEvent(new Event(event));return{roles:document.querySelectorAll('[data-design-id="role-content"]').length,reports:document.querySelectorAll('[data-design-id="reports"]').length,cover:document.querySelectorAll('[data-design-id="privacy"]').length,controls:window.hasOwnedCallControls()};};
  ` }, outfile: filename, bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', loader: { '.js': 'jsx', '.css': 'text', '.webp': 'dataurl', '.woff2': 'dataurl' }, logLevel: 'silent' });
  const browser = await browsers[engine].launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } }), errors = [];
    page.on('pageerror', error => errors.push(error.message)); await page.route('**/*', route => route.abort());
    await page.setContent('<!doctype html><html dir="rtl"><body><div id="root"></div></body></html>'); await page.addScriptTag({ content: await readFile(filename, 'utf8') });
    const button = id => page.locator(`[data-design-id="${id}"]`).filter({ visible: true }).first();
    assert.equal(await page.evaluate(() => window.hasOwnedCallControls()), true); assert.equal(await button('voice-leave').isEnabled(), true);
    assert.equal(await button('mute').isDisabled(), true, 'a hidden night microphone never becomes eligible through design restoration');
    await button('role-toggle').click(); await button('role-content').waitFor();
    assert.deepEqual(await page.evaluate(() => window.lifecycle('pagehide')), { roles: 0, reports: 0, cover: 1, controls: false });
    await page.evaluate(() => window.lifecycle('pageshow')); await button('role-toggle').waitFor();
    assert.equal(await page.locator('[data-design-id="role-content"]').count(), 0, 'role must require a fresh explicit reveal');
    await button('tab.clues').click(); await page.getByText('PRIVATE_TRACKING_REPORT_SENTINEL', { exact: true }).waitFor();
    assert.deepEqual(await page.evaluate(() => window.lifecycle('pagehide')), { roles: 0, reports: 0, cover: 1, controls: false });
    await page.evaluate(() => window.lifecycle('pageshow')); await button('role-toggle').waitFor();
    assert.equal(await page.locator('[data-design-id="reports"]').count(), 0, 'private reports must require reopening the clues tab');
    assert.deepEqual(await page.evaluate(() => ({ role: window.originalState.you.roleId, reports: window.originalState.you.reports.length, charges: window.originalState.you.resources.charges, actions: window.actions, voiceActions: window.voiceActions })), { role: 'tracker', reports: 1, charges: 2, actions: [], voiceActions: [] });
    assert.equal(await page.evaluate(() => window.hasOwnedCallControls()), true); assert.equal(await button('voice-leave').isEnabled(), true);
    await button('phase-title').waitFor(); assert.equal(await button('mute').isDisabled(), true);
    await button('tab.clues').click(); await page.getByText('PRIVATE_TRACKING_REPORT_SENTINEL', { exact: true }).waitFor();
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

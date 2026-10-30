import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium, webkit } from 'playwright';

// Actual LammaProvider, LammaClient and MafiaVoiceSession. Only the unrelated
// social source and media transport are fixtures; every authenticated request
// still passes through the actual provider/client/session ownership chain.
const mediaFixture = `
export const emptyMedia=()=>({userId:null,connected:false,connecting:false,muted:true,participants:[]});
export const bindSocialAudio=()=>()=>{};
export class CallMedia {
 constructor(change){this.change=change;this.state=emptyMedia();window.mediaStub=this;}
 update(patch){this.state={...this.state,...patch,userId:this.accountId};this.change(this.state);}
 setAccount(owner){this.accountId=owner;this.update(emptyMedia());}
 prepare(){return Promise.resolve();}
 async connect(result,options){window.mediaEvents.push({type:'connect',owner:this.accountId,callId:result.call.id,muted:options.muted});this.update({connected:true,callId:result.call.id,muted:options.muted});if(window.deferConnect){window.deferConnect=false;window.connectPending=true;await new Promise(resolve=>{window.resolveConnect=()=>{window.connectPending=false;resolve();};});}}
 async transitionGame(result,options){window.mediaEvents.push({type:'game',owner:this.accountId,callId:result.call.id,muted:options.muted});this.update({connected:true,callId:result.call.id,voiceSessionId:result.voiceSessionId,mediaEpoch:result.mediaEpoch,muted:options.muted});}
 async disconnect(options={}){window.mediaEvents.push({type:'disconnect',owner:this.accountId,callId:options.callId||this.state.callId});this.update(emptyMedia());if(window.deferStop&&options.callId){window.deferStop=false;window.stopPending=true;await new Promise(resolve=>{window.resolveStop=()=>{window.stopPending=false;resolve();};});}}
 async mute(muted){this.update({muted});}output(){return Promise.resolve();}resumeAudio(){return Promise.resolve();}pauseGame(){return Promise.resolve();}dispose(){return Promise.resolve();}
}`;
let bundle;
before(async () => {
  const result = await build({ stdin: { resolveDir: process.cwd(), loader: 'jsx', contents: `
    import React from'react';import{createRoot}from'react-dom/client';import{flushSync}from'react-dom';
    import{AccountContext,NULL_ACCOUNT}from'./src/shared/account/context.js';import{PlatformContext}from'./src/platform/context.js';import{LammaProvider,useLamma}from'./src/social/LammaProvider.jsx';
    window.requests=[];window.mediaEvents=[];window.errors=[];window.currentOwner='A';window.currentToken='token-A';window.savedCalls={};
    const sound={resetIdentity(){}};
    const requestAuthenticated=async(path,options={})=>{
      const row={owner:window.currentOwner,auth:window.currentToken,path,method:options.method||'GET',body:options.body};window.requests.push(row);
      if(path==='/api/social/groups')return{groups:[],incoming:[]};if(path==='/api/social/preferences')return{preferences:{messages:true,calls:true,previews:false,mutedConversations:[]}};if(path==='/api/social/capabilities')return{capabilities:{}};
      if(path==='/api/social/calls'&&row.method==='GET')return{calls:[]};
      if(path==='/api/social/calls'&&row.method==='POST'){
        const call={id:'call-'+options.body.conversationId,scope:options.body.scope,conversationId:options.body.conversationId,status:'active',participants:[{userId:row.owner,deviceId:options.body.deviceId,state:'active'}]};window.savedCalls[call.id]=call;
        if(window.deferRequest){window.deferRequest=false;window.requestPending=true;await new Promise(resolve=>{window.resolveRequest=()=>{window.requestPending=false;resolve();};});}return{call};}
      if(path.startsWith('/api/rooms/'))return options.body?.operation==='leave'?{}:{call:{id:'game-'+path.split('/')[3],scope:'mafia'},voiceSessionId:options.body.voiceSessionId,mediaEpoch:1,canPublish:true,quiet:false};
      if(path.startsWith('/api/social/calls/'))return{call:window.savedCalls[path.split('/')[4]]};
      throw Error('Unexpected fixture request '+path);
    };
    function Probe(){window.ctx=useLamma();return<p id="owner">{window.currentOwner}</p>;}
    const root=createRoot(document.getElementById('root'));
    window.show=(owner='A',token='token-'+owner)=>{window.currentOwner=owner;window.currentToken=token;const account={...NULL_ACCOUNT,ready:true,signedIn:!!owner,user:owner?{id:owner}:null,requestAuthenticated,authHeaders:()=>window.currentToken?{Authorization:'Bearer '+window.currentToken}:{}};flushSync(()=>root.render(<AccountContext.Provider value={account}><PlatformContext.Provider value={{sound}}><LammaProvider><Probe/></LammaProvider></PlatformContext.Provider></AccountContext.Provider>));};
    window.seedGame=()=>{const s=window.mafiaStub;s.room={game:'mafia',code:'111111',phase:'night',settings:{voiceMode:'optional'},you:{id:'seat',roleId:'citizen'},members:[{id:'seat',alive:true}],mafiaVoice:{callId:'game-old',mediaEpoch:1,canPublish:false}};s.call={id:'game-old',scope:'mafia',conversationId:'111111'};s.epoch=1;s.voiceSessionId='voice-old';s.joined=true;s.update({requested:true,status:'connected',previousCall:{scope:'group',conversationId:'old-a-group'}});s.setCall(s.call);window.mediaStub.update({connected:true,callId:'game-old',voiceSessionId:'voice-old',mediaEpoch:1,muted:true});};
    window.run=method=>{window.pendingStatus='pending';window.pending=Promise.resolve().then(()=>window.ctx[method]()).then(()=>{window.pendingStatus='resolved';},error=>{window.errors.push(error.code||error.message);window.pendingStatus='rejected';});};
    window.show();
  ` }, bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic', loader: { '.css': 'text', '.webp': 'dataurl', '.woff2': 'dataurl' }, plugins: [{ name: 'controlled-transport-only', setup(builder) {
    builder.onResolve({ filter: /^\.\/SocialProvider\.jsx$/ }, args => args.importer.endsWith('LammaProvider.jsx') ? { path: 'social', namespace: 'transport-fixture' } : undefined);
    builder.onResolve({ filter: /^\.\/media\.js$/ }, args => args.importer.endsWith('LammaProvider.jsx') ? { path: 'media', namespace: 'transport-fixture' } : undefined);
    builder.onResolve({ filter: /^\.\/mafia-voice-session\.js$/ }, args => args.importer.endsWith('LammaProvider.jsx') ? { path: 'session-observer', namespace: 'transport-fixture' } : undefined);
    builder.onLoad({ filter: /.*/, namespace: 'transport-fixture' }, args => ({ resolveDir: process.cwd(), loader: 'js', contents: args.path === 'social' ? 'export const useSocial=()=>({connected:false});' : args.path === 'media' ? mediaFixture : "import{MafiaVoiceSession as Actual,emptyMafiaVoice}from'./src/social/mafia-voice-session.js';export{emptyMafiaVoice};export class MafiaVoiceSession extends Actual{constructor(options){super(options);window.mafiaStub=this;}}" }));
  } }], logLevel: 'silent' });
  bundle = result.outputFiles[0].text;
});

for (const [name, engine] of Object.entries({ chromium, webkit })) test(`${name}: actual provider/session fence stale return and delayed social teardown`, { timeout: 60000 }, async t => {
  const browser = await engine.launch({ headless: true }); t.after(() => browser.close());
  async function pageFor() {
    const page = await browser.newPage(), errors = []; page.setDefaultTimeout(5000);
    page.on('pageerror', error => errors.push(error.message)); await page.route('**/*', route => route.request().url() === 'https://lamma-fixture.invalid/' ? route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><div id="root"></div>' }) : route.abort());
    await page.goto('https://lamma-fixture.invalid/'); await page.addScriptTag({ content: bundle });
    await page.waitForFunction(() => window.ctx && window.requests.filter(r => r.method === 'GET').length >= 4);
    return { page, errors };
  }
  await t.test('account switch while stopping cannot restore A group or send old voice leave as B', async () => {
    const { page, errors } = await pageFor();
    try {
      await page.evaluate(() => { window.seedGame(); window.deferStop = true; window.run('returnFromMafiaVoice'); }); await page.waitForFunction(() => window.stopPending);
      await page.evaluate(() => window.show('B')); await page.locator('#owner').filter({ hasText: 'B' }).waitFor();
      await page.evaluate(() => window.resolveStop()); await page.waitForFunction(() => window.pendingStatus !== 'pending');
      assert.equal(await page.evaluate(() => window.requests.filter(r => r.owner === 'B' && r.method === 'POST').length), 0);
      assert.equal(await page.evaluate(() => window.ctx.activeCall), null); assert.deepEqual(errors, []);
    } finally { await page.close(); }
  });
  await t.test('delayed old social disconnect cannot send leave under B or tear down B new call', async () => {
    const { page, errors } = await pageFor();
    try {
      await page.evaluate(() => window.ctx.startCall({ targetType: 'group', targetId: 'old-a-group' }));
      await page.evaluate(() => { window.deferStop = true; window.run('endCall'); }); await page.waitForFunction(() => window.stopPending);
      await page.evaluate(() => window.show('B')); await page.locator('#owner').filter({ hasText: 'B' }).waitFor();
      await page.evaluate(() => window.ctx.startCall({ targetType: 'group', targetId: 'new-b-group' }));
      await page.evaluate(() => window.resolveStop()); await page.waitForFunction(() => window.pendingStatus !== 'pending');
      assert.equal(await page.evaluate(() => window.requests.filter(r => r.owner === 'B' && r.path.endsWith('/call-old-a-group/leave')).length), 0);
      assert.equal(await page.evaluate(() => window.ctx.activeCall?.id), 'call-new-b-group');
      assert.equal(await page.evaluate(() => window.mediaStub.state.callId), 'call-new-b-group'); assert.deepEqual(errors, []);
    } finally { await page.close(); }
  });
  await t.test('same-account token rotation while stopping requires a fresh return intent', async () => {
    const { page, errors } = await pageFor();
    try {
      await page.evaluate(() => { window.seedGame(); window.deferStop = true; window.run('returnFromMafiaVoice'); }); await page.waitForFunction(() => window.stopPending);
      // authHeaders reads the current token even before another provider render.
      await page.evaluate(() => { window.currentToken = 'rotated-A'; window.resolveStop(); }); await page.waitForFunction(() => window.pendingStatus !== 'pending');
      assert.equal(await page.evaluate(() => window.requests.filter(r => r.method === 'POST').length), 0);
      assert.equal(await page.evaluate(() => window.mediaEvents.filter(e => e.type === 'connect').length), 0); assert.deepEqual(errors, []);
    } finally { await page.close(); }
  });
  await t.test('entering game voice cannot release A social call under B after transport stops', async () => {
    const { page, errors } = await pageFor();
    try {
      await page.evaluate(() => window.ctx.startCall({ targetType: 'group', targetId: 'old-a-group' }));
      await page.evaluate(() => {
        window.ctx.configureMafiaRoom({ game: 'mafia', code: '222222', phase: 'night', settings: { voiceMode: 'optional' }, you: { id: 'seat', roleId: 'citizen' }, members: [{ id: 'seat', alive: true }], mafiaVoice: { callId: 'game-222222', mediaEpoch: 1, canPublish: false } });
        window.deferStop = true; window.run('joinMafiaVoice');
      }); await page.waitForFunction(() => window.stopPending);
      await page.evaluate(() => window.show('B')); await page.evaluate(() => window.resolveStop()); await page.waitForFunction(() => window.pendingStatus !== 'pending');
      assert.equal(await page.evaluate(() => window.requests.filter(r => r.owner === 'B' && r.method === 'POST').length), 0);
      assert.equal(await page.evaluate(() => window.mafiaStub.state.previousCall), null); assert.deepEqual(errors, []);
    } finally { await page.close(); }
  });
  await t.test('a saved A callback cannot stop or restore anything after B renders', async () => {
    const { page, errors } = await pageFor();
    try {
      await page.evaluate(() => { window.savedReturn = window.ctx.returnFromMafiaVoice; window.show('B'); });
      const generation = await page.evaluate(() => window.mafiaStub.generation);
      await page.evaluate(() => window.savedReturn().catch(error => window.errors.push(error.code)));
      assert.equal(await page.evaluate(() => window.mafiaStub.generation), generation);
      assert.equal(await page.evaluate(() => window.requests.filter(r => r.method === 'POST').length), 0); assert.deepEqual(errors, []);
    } finally { await page.close(); }
  });
  for (const cancel of ['endCall', 'leaveMafiaVoice']) await t.test(`${cancel} cancels an unfinished return instead of restoring its old group`, async () => {
    const { page, errors } = await pageFor();
    try {
      await page.evaluate(() => { window.seedGame(); window.deferStop = true; window.run('returnFromMafiaVoice'); }); await page.waitForFunction(() => window.stopPending);
      await page.evaluate(method => { window.cancelled = window.ctx[method](); }, cancel);
      await page.evaluate(() => window.resolveStop()); await page.waitForFunction(() => window.pendingStatus !== 'pending'); await page.evaluate(() => window.cancelled);
      assert.equal(await page.evaluate(() => window.requests.filter(r => r.path === '/api/social/calls' && r.method === 'POST').length), 0);
      assert.equal(await page.evaluate(() => window.ctx.activeCall), null); assert.deepEqual(errors, []);
    } finally { await page.close(); }
  });
  await t.test('a newer same-owner group call is preserved when the old game stop finishes', async () => {
    const { page, errors } = await pageFor();
    try {
      await page.evaluate(() => { window.seedGame(); window.deferStop = true; window.run('returnFromMafiaVoice'); }); await page.waitForFunction(() => window.stopPending);
      await page.evaluate(() => window.ctx.startCall({ targetType: 'group', targetId: 'new-a-group' }));
      await page.evaluate(() => window.resolveStop()); await page.waitForFunction(() => window.pendingStatus !== 'pending');
      assert.equal(await page.evaluate(() => window.ctx.activeCall?.id), 'call-new-a-group');
      assert.equal(await page.evaluate(() => window.mediaStub.state.callId), 'call-new-a-group');
      assert.equal(await page.evaluate(() => window.requests.filter(r => r.path.endsWith('/call-new-a-group/leave')).length), 0); assert.deepEqual(errors, []);
    } finally { await page.close(); }
  });
  await t.test('a newer explicit game join supersedes return and starts muted after old stop', async () => {
    const { page, errors } = await pageFor();
    try {
      await page.evaluate(() => { window.seedGame(); window.deferStop = true; window.run('returnFromMafiaVoice'); }); await page.waitForFunction(() => window.stopPending);
      await page.evaluate(() => {
        const next = { ...window.mafiaStub.room, code: '222222', mafiaVoice: { callId: 'game-222222', mediaEpoch: 1, canPublish: true } };
        window.ctx.configureMafiaRoom(next); window.joined = false; window.ctx.joinMafiaVoice().then(() => { window.joined = true; });
      });
      await page.evaluate(() => window.resolveStop()); await page.waitForFunction(() => window.pendingStatus !== 'pending' && window.joined);
      assert.equal(await page.evaluate(() => window.ctx.activeCall?.id), 'game-222222');
      assert.equal(await page.evaluate(() => window.mediaEvents.find(e => e.type === 'game')?.muted), true);
      assert.equal(await page.evaluate(() => window.requests.filter(r => r.path === '/api/social/calls' && r.method === 'POST').length), 0); assert.deepEqual(errors, []);
    } finally { await page.close(); }
  });
  await t.test('same-account token rotation during old social disconnect does not send a new-auth leave', async () => {
    const { page, errors } = await pageFor();
    try {
      await page.evaluate(() => window.ctx.startCall({ targetType: 'group', targetId: 'old-a-group' }));
      await page.evaluate(() => { window.deferStop = true; window.run('endCall'); }); await page.waitForFunction(() => window.stopPending);
      await page.evaluate(() => { window.currentToken = 'rotated-A'; window.resolveStop(); }); await page.waitForFunction(() => window.pendingStatus !== 'pending');
      assert.equal(await page.evaluate(() => window.requests.filter(r => r.path.endsWith('/call-old-a-group/leave')).length), 0); assert.deepEqual(errors, []);
    } finally { await page.close(); }
  });
  await t.test('a return response after token rotation cannot connect media or release a newer authorization', async () => {
    const { page, errors } = await pageFor();
    try {
      await page.evaluate(() => { window.seedGame(); window.deferRequest = true; window.run('returnFromMafiaVoice'); }); await page.waitForFunction(() => window.requestPending);
      await page.evaluate(() => { window.currentToken = 'rotated-A'; window.resolveRequest(); }); await page.waitForFunction(() => window.pendingStatus !== 'pending');
      assert.equal(await page.evaluate(() => window.mediaEvents.filter(e => e.type === 'connect').length), 0);
      assert.equal(await page.evaluate(() => window.requests.filter(r => r.path.endsWith('/call-old-a-group/leave')).length), 0); assert.deepEqual(errors, []);
    } finally { await page.close(); }
  });
  await t.test('token rotation during transport connection stops only that stale owned attempt', async () => {
    const { page, errors } = await pageFor();
    try {
      await page.evaluate(() => { window.seedGame(); window.deferConnect = true; window.run('returnFromMafiaVoice'); }); await page.waitForFunction(() => window.connectPending);
      await page.evaluate(() => { window.currentToken = 'rotated-A'; window.resolveConnect(); }); await page.waitForFunction(() => window.pendingStatus !== 'pending');
      assert.equal(await page.evaluate(() => window.ctx.activeCall), null);
      assert.equal(await page.evaluate(() => window.mediaStub.state.connected), false);
      assert.equal(await page.evaluate(() => window.requests.filter(r => r.path.endsWith('/call-old-a-group/leave')).length), 0); assert.deepEqual(errors, []);
    } finally { await page.close(); }
  });
  await t.test('superseded idempotent response cannot release the replacement call with the same id', async () => {
    const { page, errors } = await pageFor();
    try {
      await page.evaluate(() => { window.seedGame(); window.deferRequest = true; window.run('returnFromMafiaVoice'); }); await page.waitForFunction(() => window.requestPending);
      await page.evaluate(() => window.ctx.endCall());
      await page.evaluate(() => { window.replacementDone = false; window.ctx.startCall({ targetType: 'group', targetId: 'old-a-group' }).then(() => { window.replacementDone = true; }); });
      await page.evaluate(() => window.resolveRequest()); await page.waitForFunction(() => window.pendingStatus !== 'pending' && window.replacementDone);
      assert.equal(await page.evaluate(() => window.ctx.activeCall?.id), 'call-old-a-group');
      assert.equal(await page.evaluate(() => window.mediaEvents.filter(e => e.type === 'connect').length), 1);
      assert.equal(await page.evaluate(() => window.requests.filter(r => r.path.endsWith('/call-old-a-group/leave')).length), 0); assert.deepEqual(errors, []);
    } finally { await page.close(); }
  });
  await t.test('the unchanged owner can return once, explicitly muted, to the original group', async () => {
    const { page, errors } = await pageFor();
    try {
      await page.evaluate(() => { window.seedGame(); window.run('returnFromMafiaVoice'); }); await page.waitForFunction(() => window.pendingStatus !== 'pending');
      assert.equal(await page.evaluate(() => window.pendingStatus), 'resolved');
      assert.equal(await page.evaluate(() => window.requests.filter(r => r.path === '/api/social/calls' && r.method === 'POST').length), 1);
      assert.equal(await page.evaluate(() => window.ctx.activeCall?.id), 'call-old-a-group');
      assert.equal(await page.evaluate(() => window.mediaEvents.find(e => e.type === 'connect')?.muted), true);
      assert.equal(await page.evaluate(() => window.mafiaStub.state.previousCall?.conversationId), 'old-a-group'); assert.deepEqual(errors, []);
    } finally { await page.close(); }
  });
});

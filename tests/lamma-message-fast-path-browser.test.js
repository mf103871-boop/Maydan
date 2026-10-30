import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { chromium, webkit } from 'playwright';

// Actual React provider/client/event handler. Only unrelated call transport,
// account HTTP responses and the SocialProvider source are controlled fixtures.
// The before variant removes only the new event branch, in memory, not on disk.
const branch = "      if (type === 'group' && ['message', 'read'].includes(reason)) { client.refreshGroupMessage(e.detail.groupId).catch(() => {}); return; }";
const media = `export const emptyMedia=()=>({userId:null,connected:false,connecting:false,muted:true,participants:[]});export const bindSocialAudio=()=>()=>{};export class CallMedia{constructor(change){this.change=change;this.state=emptyMedia();}setAccount(userId){this.state={...emptyMedia(),userId};this.change(this.state);}dispose(){return Promise.resolve();}disconnect(){return Promise.resolve();}mute(){return Promise.resolve();}pauseGame(){return Promise.resolve();}}`;
let bundles;
before(async () => {
  bundles = {};
  for (const variant of ['before', 'after']) {
    const result = await build({ stdin: { resolveDir: process.cwd(), loader: 'jsx', contents: `
      import React from'react';import{createRoot}from'react-dom/client';import{flushSync}from'react-dom';
      import{AccountContext,NULL_ACCOUNT}from'./src/shared/account/context.js';import{PlatformContext}from'./src/platform/context.js';import{LammaProvider,useLamma}from'./src/social/LammaProvider.jsx';
      window.requests=[];window.currentOwner='alice';window.nextText='original';window.blockCalls=false;window.holdHistory=false;window.sound={resetIdentity(){}};
      const requestAuthenticated=async(path,options={})=>{
        const owner=window.currentOwner;window.requests.push({owner,path,method:options.method||'GET'});
        if(path==='/api/social/groups')return{groups:owner==='alice'?[{id:'g',role:'member',joinedAt:1,memberCount:2}]:[],incoming:[]};
        if(path==='/api/social/preferences')return{sound:false};if(path==='/api/social/capabilities')return{groupMessageSummary:true};
        if(path==='/api/social/calls'){if(window.blockCalls)await new Promise(resolve=>{window.releaseCalls=resolve;});return{calls:[]};}
        if(path==='/api/social/groups/g')return{group:{id:'g',role:'member',joinedAt:1,memberCount:2,unreadCount:1},members:[{id:'alice'},{id:'bob'}]};
        if(path==='/api/social/groups/g/messages'){const text=window.nextText;if(window.holdHistory)await new Promise(resolve=>{window.releaseHistory=resolve;});return{messages:[{seq:2,senderId:'bob',text}],hasMore:false};}
        throw Error('Unexpected path '+path);
      };
      function Probe(){window.ctx=useLamma();return<><p id="owner">{window.currentOwner}</p><p id="messages">{(window.ctx.groupConversations.g?.messages||[]).map(m=>m.text).join('|')}</p></>;}
      const root=createRoot(document.getElementById('root'));
      window.show=(owner='alice')=>{window.currentOwner=owner;const account={...NULL_ACCOUNT,ready:true,signedIn:true,user:{id:owner},requestAuthenticated,authHeaders:()=>({Authorization:'Bearer synthetic-'+owner})};flushSync(()=>root.render(<AccountContext.Provider value={account}><PlatformContext.Provider value={{sound:window.sound}}><LammaProvider><Probe/></LammaProvider></PlatformContext.Provider></AccountContext.Provider>));};
      window.notice=(type='group',reason='message')=>window.dispatchEvent(new CustomEvent('maydan-social-event',{detail:{type,reason,groupId:'g',messageSeq:2}}));window.show();
    ` }, bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic', loader: { '.css': 'text', '.webp': 'dataurl', '.woff2': 'dataurl' }, plugins: [{ name: 'transport-only-fixture', setup(builder) {
      if (variant === 'before') builder.onLoad({ filter: /[/\\]LammaProvider\.jsx$/ }, async args => {
        const contents = await readFile(args.path, 'utf8'); assert.equal(contents.includes(branch), true);
        return { contents: contents.replace(branch, ''), loader: 'jsx' };
      });
      builder.onResolve({ filter: /^\.\/SocialProvider\.jsx$/ }, args => args.importer.endsWith('LammaProvider.jsx') ? { path: 'social', namespace: 'fixture' } : undefined);
      builder.onResolve({ filter: /^\.\/media\.js$/ }, args => args.importer.endsWith('LammaProvider.jsx') ? { path: 'media', namespace: 'fixture' } : undefined);
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: args.path === 'social' ? 'export const useSocial=()=>({connected:true});' : media, loader: 'js' }));
    } }], logLevel: 'silent' });
    bundles[variant] = result.outputFiles[0].text;
  }
});

for (const [name, engine] of Object.entries({ chromium, webkit })) test(`${name}: actual provider group notices avoid the unrelated six-GET waterfall`, { timeout: 60000 }, async t => {
  const browser = await engine.launch({ headless: true }); t.after(() => browser.close());
  async function pageFor(variant) {
    const page = await browser.newPage(), errors = []; page.setDefaultTimeout(5000);
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => route.request().url() === 'https://group-fixture.invalid/' ? route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><div id="root"></div>' }) : route.abort());
    await page.goto('https://group-fixture.invalid/'); await page.addScriptTag({ content: bundles[variant] });
    await page.waitForFunction(() => window.ctx?.groups.length === 1);
    await page.evaluate(async () => { window.ctx.selectGroup('g'); await window.ctx.loadGroup('g'); window.requests=[]; window.nextText='new authorized message'; });
    return { page, errors };
  }
  await t.test('before event wiring waits for calls and makes six GETs; after makes only two', async () => {
    const old = await pageFor('before');
    try {
      await old.page.evaluate(() => { window.blockCalls=true;window.notice(); });
      await old.page.waitForFunction(() => typeof window.releaseCalls === 'function');
      assert.equal(await old.page.locator('#messages').textContent(), 'original');
      assert.equal(await old.page.evaluate(() => window.requests.length), 4);
      await old.page.evaluate(() => window.releaseCalls());
      await old.page.waitForFunction(() => document.getElementById('messages').textContent === 'new authorized message');
      assert.equal(await old.page.evaluate(() => window.requests.length), 6); assert.deepEqual(old.errors, []);
    } finally { await old.page.close(); }
    const current = await pageFor('after');
    try {
      await current.page.evaluate(() => { window.blockCalls=true;window.notice(); });
      await current.page.waitForFunction(() => document.getElementById('messages').textContent === 'new authorized message');
      assert.deepEqual(await current.page.evaluate(() => window.requests.map(r=>r.path)), ['/api/social/groups/g', '/api/social/groups/g/messages']);
      assert.deepEqual(current.errors, []);
    } finally { await current.page.close(); }
  });
  await t.test('read acknowledgement notice also avoids a secondary full waterfall', async () => {
    const { page, errors } = await pageFor('after');
    try {
      await page.evaluate(() => window.notice('group','read'));
      await page.waitForFunction(() => document.getElementById('messages').textContent === 'new authorized message');
      assert.equal(await page.evaluate(() => window.requests.length), 2); assert.deepEqual(errors, []);
    } finally { await page.close(); }
  });
  await t.test('privacy refresh fences the pending fast response and still reauthorizes the full window', async () => {
    const { page, errors } = await pageFor('after');
    try {
      await page.evaluate(() => { window.holdHistory=true;window.notice(); });
      await page.waitForFunction(() => typeof window.releaseHistory === 'function');
      await page.evaluate(() => { window.holdHistory=false;window.nextText='after privacy refresh';window.notice('refresh','blocked'); });
      await page.waitForFunction(() => document.getElementById('messages').textContent === 'after privacy refresh');
      await page.evaluate(() => window.releaseHistory());
      assert.equal(await page.locator('#messages').textContent(), 'after privacy refresh');
      assert.equal(await page.evaluate(() => window.requests.some(r=>r.path==='/api/social/calls')), true); assert.deepEqual(errors, []);
    } finally { await page.close(); }
  });
  await t.test('switching accounts discards the old pending fast snapshot', async () => {
    const { page, errors } = await pageFor('after');
    try {
      await page.evaluate(() => { window.holdHistory=true;window.notice(); });
      await page.waitForFunction(() => typeof window.releaseHistory === 'function');
      await page.evaluate(() => window.show('another-account'));
      await page.waitForFunction(() => window.ctx.groups.length===0);
      await page.evaluate(() => window.releaseHistory());
      assert.equal(await page.locator('#messages').textContent(), ''); assert.deepEqual(errors, []);
    } finally { await page.close(); }
  });
});

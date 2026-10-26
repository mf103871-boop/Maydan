import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { fakeStorage } from './helpers.js';
import { createAccountStore } from '../src/shared/account/store.js';
import { clearAllPlatformData } from '../src/shared/lib/storage.js';
import { environmentStorageKey, isMafiaPreview, PRODUCTION_API_ORIGIN as PROD, MAFIA_PREVIEW_API_ORIGIN as PREVIEW } from '../src/shared/lib/environment.js';

test('production identity names remain unchanged and preview login/logout cannot read or replace them', () => {
  const storage = fakeStorage();
  const prod = createAccountStore(storage, { apiOrigin: PROD }), preview = createAccountStore(storage, { apiOrigin: PREVIEW });
  prod.writeSession('production-session-fixture'); prod.writeMe({ user: { id: 'production-owner' } }, 123); prod.addMark('mafia');
  assert.equal(prod.prefix, 'maydan:account:');
  assert.equal(preview.readSession(), null); assert.equal(preview.readMe().data, null); assert.deepEqual(preview.readTrials().marks, {});
  preview.writeSession('preview-session-fixture'); preview.writeMe({ user: { id: 'preview-owner' } }, 456); preview.addMark('ersomha');
  preview.clearAuth();
  assert.equal(prod.readSession(), 'production-session-fixture'); assert.equal(prod.readMe().data.user.id, 'production-owner'); assert.deepEqual(prod.readTrials().marks, { mafia: true });
  assert.equal(storage.getItem('maydan:account:session'), JSON.stringify('production-session-fixture'));
});

test('preview reset deletes only its own identity/cache/room keys and preserves existing game progress', () => {
  const storage = fakeStorage();
  const old = { 'maydan:account:session': 'production', 'maydan:badeeha:session': 'game-progress', 'maydan:platform:settings': 'preferences', [`maydan:online:${PROD}:room`]: 'production-seat' };
  for (const [key,value] of Object.entries(old)) storage.setItem(key,value);
  const previewKeys = ['maydan:account:session','maydan:auth:attempt','maydan:design:published:v1','maydan:profile-sessions:pending','maydan:social-ui:favorites:id'].map(key=>environmentStorageKey(key,PREVIEW));
  previewKeys.push(`maydan:online:${PREVIEW}:room`); previewKeys.forEach(key=>storage.setItem(key,'preview'));
  assert.equal(clearAllPlatformData(storage,{apiOrigin:PREVIEW}),previewKeys.length);
  for(const [key,value] of Object.entries(old)) assert.equal(storage.getItem(key),value);
  storage.setItem(environmentStorageKey('maydan:account:session',PREVIEW),'preview');
  clearAllPlatformData(storage,{apiOrigin:PROD});
  assert.equal(storage.getItem(environmentStorageKey('maydan:account:session',PREVIEW)),'preview');
});

test('preview badge is tied to the exact approved build origin, not the browser URL or a similar hostname',()=>{
  assert.equal(isMafiaPreview(PREVIEW),true);
  for(const origin of [PROD,'',`${PREVIEW}.example.test`,`${PREVIEW}/anything`,'https://example.test']) assert.equal(isMafiaPreview(origin),false);
});

test('compiled same-origin web preserves production login and separates preview banner/account/room cleanup',async()=>{
  mkdirSync('.cache',{recursive:true});const folder=mkdtempSync(path.resolve('.cache/environment-web-'));
  const previous=globalThis.location;
  try{
    const file=path.join(folder,'same-origin.mjs');
    await build({stdin:{contents:"export{configuredBuildOrigin,isMafiaPreview,environmentStorageKey}from'./src/shared/lib/environment.js';export{createAccountStore}from'./src/shared/account/store.js';export{clearAllPlatformData}from'./src/shared/lib/storage.js';",resolveDir:process.cwd()},outfile:file,bundle:true,platform:'node',format:'esm',define:{__MAYDAN_ROOMS_URL__:JSON.stringify('same-origin')},logLevel:'silent'});
    const web=await import(pathToFileURL(file)),storage=fakeStorage();storage.setItem('maydan:account:session',JSON.stringify('production-session-fixture'));storage.setItem(`maydan:online:${PROD}:123456`,'prod-seat');storage.setItem(`maydan:online:${PREVIEW}:123456`,'preview-seat');
    globalThis.location={origin:PROD};assert.equal(web.configuredBuildOrigin(),PROD);assert.equal(web.isMafiaPreview(),false);assert.equal(web.createAccountStore(storage).readSession(),'production-session-fixture');assert.equal(web.createAccountStore(storage).prefix,'maydan:account:');
    globalThis.location={origin:PREVIEW};assert.equal(web.configuredBuildOrigin(),PREVIEW);assert.equal(web.isMafiaPreview(),true);const preview=web.createAccountStore(storage);assert.equal(preview.readSession(),null);preview.writeSession('preview-session-fixture');
    web.clearAllPlatformData(storage);assert.equal(storage.getItem(`maydan:online:${PREVIEW}:123456`),null);assert.equal(storage.getItem(`maydan:online:${PROD}:123456`),'prod-seat');assert.equal(storage.getItem('maydan:account:session'),JSON.stringify('production-session-fixture'));
    globalThis.location={origin:'null'};assert.equal(web.configuredBuildOrigin(),'');assert.equal(web.isMafiaPreview(),false);
    delete globalThis.location;assert.equal(web.configuredBuildOrigin(),'');
  }finally{if(previous===undefined)delete globalThis.location;else globalThis.location=previous;assert.ok(folder.startsWith(path.resolve('.cache')+path.sep));rmSync(folder,{recursive:true,force:true});}
});

test('actual preview account HTTP does not send a stored production bearer and temporary auth/design keys stay separate', async()=>{
  mkdirSync('.cache',{recursive:true});const folder=mkdtempSync(path.resolve('.cache/environment-storage-'));
  const backend=fakeStorage();const oldLocal=globalThis.localStorage,oldSession=globalThis.sessionStorage;
  globalThis.localStorage=backend;globalThis.sessionStorage=backend;
  backend.setItem('maydan:account:session',JSON.stringify('production-session-fixture'));
  backend.setItem('maydan:auth:attempt',JSON.stringify({value:'a'.repeat(32),at:Date.now()}));
  backend.setItem('maydan:auth:profile-return',JSON.stringify({path:'/profile/production-owner',at:Date.now()}));
  try {
    const file=path.join(folder,'preview.mjs');
    await build({stdin:{contents:"export{accountStore,ACCOUNT_PREFIX}from'./src/shared/account/store.js';export{getMe}from'./src/shared/account/api.js';export{currentAuthAttempt,clearAuthAttempt}from'./src/shared/account/attempt.js';export{consumeProfileReturn}from'./src/shared/account/return-path.js';export{clearPublishedDesign}from'./src/design/client.js';import React from'react';import{renderToStaticMarkup}from'react-dom/server';import{AccountProvider}from'./src/shared/account/AccountProvider.jsx';export const renderAccount=()=>renderToStaticMarkup(React.createElement(AccountProvider,null,React.createElement('main',null,'game')));",resolveDir:process.cwd()},outfile:file,bundle:true,platform:'node',format:'esm',packages:'external',loader:{'.js':'jsx','.css':'text','.webp':'dataurl','.woff2':'dataurl'},define:{__MAYDAN_ROOMS_URL__:JSON.stringify(PREVIEW)},logLevel:'silent'});
    const preview=await import(pathToFileURL(file));
    assert.match(preview.renderAccount(),/بيئة اختبار مافيا/);assert.match(preview.renderAccount(),/حسابات وتجارب منفصلة/);
    assert.equal(preview.accountStore.readSession(),null);assert.equal(preview.currentAuthAttempt(),'');assert.equal(preview.consumeProfileReturn(backend),'/');
    let requested;
    await preview.getMe({token:preview.accountStore.readSession(),fetchImpl:async(url,options)=>{requested={url,headers:options.headers};return new Response(JSON.stringify({user:null}),{status:200,headers:{'content-type':'application/json'}});}});
    assert.equal(requested.url,`${PREVIEW}/api/me`);assert.equal(requested.headers.authorization,undefined);
    preview.accountStore.writeSession('preview-session-fixture');preview.clearAuthAttempt();preview.clearPublishedDesign(backend);
    assert.equal(backend.getItem('maydan:account:session'),JSON.stringify('production-session-fixture'));
    assert.ok(backend.getItem('maydan:auth:attempt'));assert.ok(backend.getItem('maydan:auth:profile-return'));
  } finally {
    if(oldLocal===undefined)delete globalThis.localStorage;else globalThis.localStorage=oldLocal;
    if(oldSession===undefined)delete globalThis.sessionStorage;else globalThis.sessionStorage=oldSession;
    assert.ok(folder.startsWith(path.resolve('.cache')+path.sep));rmSync(folder,{recursive:true,force:true});
  }
});

test('native Keychain, device identity and trial mirror use the bundled-origin scope without broad deletion',()=>{
  const read=file=>readFileSync(file,'utf8');
  const native=read('ios/Maydan/NativeConfig.swift'),session=read('ios/Maydan/SocialSession.swift');
  assert.match(native,/if apiOrigin == "https:\/\/maydan-game\.mf103871\.workers\.dev" \{ return key \}/);
  assert.match(native,/key \+ "\.environment\."/);
  assert.match(session,/scopedStorageKey\("Maydan.social.session"\)/);assert.match(session,/scopedStorageKey\("maydan.social.deviceId"\)/);
  assert.match(session,/SecItemDelete\(Self.query as CFDictionary\)/);
  assert.match(read('ios/Maydan/GameViewController.swift'),/scopedStorageKey\("maydan.trials.marks"\)/);
  assert.match(read('.github/workflows/ios-testflight.yml'),/python3 scripts\/ios\/verify_environment_storage.py/);
});

test('local-game writer and background uploader share the same environment-scoped account session queue',()=>{
  for(const file of ['src/platform/screens/Play.jsx','src/profiles/ProfileProvider.jsx']){
    const source=readFileSync(file,'utf8');
    assert.match(source,/storage:\s*createStorage\(environmentStorageKey\('maydan:profile-sessions:'\)\)/,file);
    assert.doesNotMatch(source,/createStorage\('profile-sessions'\)/,file);
  }
});

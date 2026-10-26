import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

let directory,render;
before(async()=>{
  mkdirSync('.cache',{recursive:true});directory=mkdtempSync(path.resolve('.cache/provider-platform-ui-'));
  const file=path.join(directory,'render.mjs');
  await build({stdin:{contents:"import React from'react';import{renderToStaticMarkup}from'react-dom/server';import{AccountContext,NULL_ACCOUNT}from'./src/shared/account/context.js';import{SignInButtons}from'./src/shared/account/SignInSheet.jsx';export const render=(platform,billing)=>renderToStaticMarkup(React.createElement(AccountContext.Provider,{value:{...NULL_ACCOUNT,platform,billing}},React.createElement(SignInButtons)));",resolveDir:process.cwd()},outfile:file,bundle:true,platform:'node',format:'esm',packages:'external',jsx:'automatic',loader:{'.js':'jsx','.css':'text','.webp':'dataurl','.woff2':'dataurl'},logLevel:'silent'});
  ({render}=await import(pathToFileURL(file)));
});
after(()=>{assert.ok(directory.startsWith(path.resolve('.cache')+path.sep));rmSync(directory,{recursive:true,force:true});});
const split={providers:{apple:true,google:true},providerPlatforms:{web:{apple:false,google:true},ios:{apple:true,google:false}}};
test('actual web sign-in buttons hide native-only Apple while preserving configured Google',()=>{
  const html=render('web',split);assert.doesNotMatch(html,/data-provider="apple"/);assert.match(html,/data-provider="google"/);
});
test('actual iOS context exposes native Apple and hides its unavailable Google path',()=>{
  const html=render('ios',split);assert.match(html,/data-provider="apple"/);assert.doesNotMatch(html,/data-provider="google"/);
});
test('legacy provider maps retain their rendering on both platforms',()=>{
  for(const platform of ['ios','web']){const html=render(platform,{providers:{apple:true,google:false}});assert.match(html,/data-provider="apple"/);assert.doesNotMatch(html,/data-provider="google"/);}
  for(const platform of ['ios','web']){const html=render(platform,null);assert.match(html,/data-provider="apple"/);assert.match(html,/data-provider="google"/);}
});
test('a platform with neither provider shows a clear status and no dead sign-in action',()=>{
  const html=render('web',{providers:{apple:true,google:true},providerPlatforms:{web:{apple:false,google:false}}});assert.match(html,/role="status"/);assert.match(html,/تسجيل الدخول غير متاح حاليًا/);assert.doesNotMatch(html,/data-provider=/);
});

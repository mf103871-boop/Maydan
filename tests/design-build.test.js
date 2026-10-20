import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {buildStudio} from '../scripts/studio-build.mjs';
import {escapeInlineScript} from '../scripts/lib.mjs';

test('deployed Studio HTML contains its exact tested script and needs no additional script route',async()=>{
  const folder=await mkdtemp(path.join(tmpdir(),'maydan-studio-build-'));
  try{
    await buildStudio({outdir:folder});const html=await readFile(path.join(folder,'index.html'),'utf8'),js=await readFile(path.join(folder,'studio.js'),'utf8');
    assert.ok(html.startsWith('<!doctype html>'));assert.ok(js.length>100_000);assert.ok(html.includes(`<script>${escapeInlineScript(js)}</script>`));assert.doesNotMatch(html,/<script\s+src=/i);assert.match(html,/id="studio-root"/);
  }finally{
    const root=await realpath(tmpdir()),target=await realpath(folder);assert.equal(path.dirname(target),root);assert.ok(path.basename(target).startsWith('maydan-studio-build-'));await rm(target,{recursive:true,force:true});
  }
});

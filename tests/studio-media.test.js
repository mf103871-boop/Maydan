import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {runInNewContext} from 'node:vm';
import {build} from 'esbuild';
import {CATS} from '../src/data/categories/index.js';
import {resolveMedia,questionMedia} from '../src/shared/media/resolve.js';
import {studioMediaEntries,verifyStudioMedia,transformStudioCategory,studioMediaPlugin} from '../scripts/studio-media.mjs';
import {assertFrozenStudioInputs} from '../scripts/studio-release.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');

test('the fixed 69 public images retain exact original WEBP bytes and cover only active category media',async()=>{
  const files=await verifyStudioMedia();assert.equal(files.length,69);assert.equal(files.reduce((n,e)=>n+e.bytes,0),12206350);
  const found=new Set();for(const category of CATS){const transformed=transformStudioCategory(category,{onReplace:entry=>found.add(entry.sha256)});
    assert.equal(category.id,transformed.id);assert.equal(category.qs.length,transformed.qs.length);
    for(let i=0;i<category.qs.length;i++){
      const{media:oldMedia,image:oldImage,...original}=category.qs[i],{media:newMedia,image:newImage,...changed}=transformed.qs[i];
      assert.deepEqual(changed,original,'IDs, questions, answers, points and metadata stay unchanged');
      for(const url of questionMedia(transformed.qs[i],category.id))if(url.startsWith('/api/studio/media/'))assert.ok(files.some(entry=>entry.pathname===url));
      if(oldMedia===undefined)assert.equal(newMedia,undefined);if(oldImage===undefined)assert.equal(newImage,undefined);
    }
  }assert.equal(found.size,69);
  const input={id:'zoom',qs:[{qid:'test',image:'https://example.test/media/zoom/x.webp',media:{src:'unlisted.webp',license:'kept'},answer:'إجابة'}]};
  assert.deepEqual(transformStudioCategory(input),input);assert.notEqual(transformStudioCategory(input),input);
});
test('only private preview JSON bundles rewrite media; normal/native bank and root-relative URLs retain their contract',async()=>{
  const options={stdin:{contents:"export {startupImageUrls} from './src/shared/media/startup-images.js'",resolveDir:process.cwd()},bundle:true,write:false,format:'iife',globalName:'Images',logLevel:'silent'};
  const ordinary=await build(options),trial=await build({...options,plugins:[studioMediaPlugin()]});
  const first={},second={};runInNewContext(ordinary.outputFiles[0].text,first);runInNewContext(trial.outputFiles[0].text,second);
  assert.equal(first.Images.startupImageUrls.some(url=>url.startsWith('/api/studio/media/')),false);
  assert.equal(second.Images.startupImageUrls.filter(url=>url.startsWith('/api/studio/media/')).length,69);
  const uri=studioMediaEntries[0].pathname;assert.equal(resolveMedia(uri,'wrong-pack'),uri);assert.equal(resolveMedia(uri+'?v=fixed','wrong-pack'),uri+'?v=fixed');
  assert.equal(resolveMedia('//cdn.example/a.webp','pack'),'//cdn.example/a.webp');assert.equal(resolveMedia('x.webp','zoom'),'media/zoom/x.webp');
});
test('frozen source checks reject a changed image, manifest or transformer before any apply action',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'studio-source-'));
  try{const names=[studioMediaEntries[0].source,'server/design/media-manifest.json','scripts/studio-media.mjs'],inputs={};
    for(const name of names){const bytes=await readFile(name);await mkdir(path.dirname(path.join(root,name)),{recursive:true});await writeFile(path.join(root,name),bytes);inputs[name]=hash(bytes);}
    await assertFrozenStudioInputs(inputs,{root});
    for(const name of names){const original=await readFile(path.join(root,name));await writeFile(path.join(root,name),Buffer.concat([original,Buffer.from('changed')]));await assert.rejects(assertFrozenStudioInputs(inputs,{root}),/Source changed/);await writeFile(path.join(root,name),original);}
    await assert.rejects(assertFrozenStudioInputs({'../outside':'0'.repeat(64)},{root}),/Invalid frozen source path/);
  }finally{await rm(root,{recursive:true,force:true});}
});
test('preview sandbox permits only static hash image GET/HEAD under the API namespace and strips credentials',async()=>{
  const calls=[],window={fetch:async(input,options)=>{calls.push({input,options});return new Response('image');}},document={addEventListener(){},getElementById(){return{};}},navigator={mediaDevices:{}};
  const source=(await readFile('src/design/preview-bootstrap.js','utf8')).replace(/import\('\.\/preview-main\.jsx'\)\.catch\([^\n]+\);/,'');
  runInNewContext(source,{window,document,navigator,location:{href:'https://maydan.test/api/studio/preview/',origin:'https://maydan.test'},URL,Promise,Error,Map});
  const image='https://maydan.test'+studioMediaEntries[0].pathname;await window.fetch(image,{credentials:'include',headers:{authorization:'private'}});assert.equal(calls.length,1);assert.equal(calls[0].options.credentials,'omit');assert.equal(Object.keys(calls[0].options.headers).length,0);
  await window.fetch(image,{method:'HEAD'});
  for(const url of ['/api/me','/api/design/draft','/api/design/assets/private','/api/studio/media/not-a-digest.webp','https://other.test'+studioMediaEntries[0].pathname])await assert.rejects(window.fetch(new URL(url,'https://maydan.test').href),/PREVIEW_NETWORK_DISABLED/);
  await assert.rejects(window.fetch(image,{method:'POST'}),/PREVIEW_NETWORK_DISABLED/);assert.equal(calls.length,2);
  assert.throws(()=>new window.WebSocket('wss://maydan.test'),/PREVIEW_SOCKET_DISABLED/);await assert.rejects(navigator.mediaDevices.getUserMedia(),/PREVIEW_RECORDING_DISABLED/);
});

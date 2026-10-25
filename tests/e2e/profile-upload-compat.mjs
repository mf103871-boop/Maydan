// Actual crop dialog + real browser canvas + the unchanged server JPEG validator.
// The rejected progressive canvas output is injected; no physical iPhone claim.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import sharp from 'sharp';
import {build} from 'esbuild';
import {chromium, webkit} from 'playwright';
import {imageFromDataUrl, IMAGE_LIMITS} from '../../server/profiles/images.mjs';

const fixture = await sharp({create:{width:900,height:600,channels:3,background:'#1492a0'}})
  .composite([{input:Buffer.from('<svg width="900" height="600"><circle cx="450" cy="300" r="220" fill="#7944aa"/><path d="M0 500 L900 100" stroke="#ffcc44" stroke-width="60"/></svg>')}]).png().toBuffer();
const noisePixels=Buffer.alloc(900*600*3);let seed=1234;
for(let i=0;i<noisePixels.length;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;noisePixels[i]=seed>>>24;}
const noisyFixture=await sharp(noisePixels,{raw:{width:900,height:600,channels:3}}).png().toBuffer();
const progressive = {};
for (const kind of ['avatar','cover']) {
  const size = kind === 'avatar' ? {width:512,height:512} : {width:1200,height:400};
  progressive[kind] = (await sharp(fixture).resize(size).jpeg({progressive:true}).toBuffer()).toString('base64');
}
const source = `
import React from 'react';import{createRoot}from'react-dom/client';
import{flushSync}from'react-dom';
import{CropDialog}from'./src/profiles/ProfileScreen.jsx';
import{decodeProfileImage}from'./src/profiles/client-images.js';
const root=createRoot(document.getElementById('root'));
window.launch=async({kind,fixture,progressive,mode})=>{
  window.finished=null;window.sent=0;window.cancelled=false;
  const decode=value=>Uint8Array.from(atob(value),c=>c.charCodeAt(0));
  const image=await decodeProfileImage(new File([decode(fixture)],'selected.png',{type:'image/png'}));
  const original=HTMLCanvasElement.prototype.toBlob;
  if(progressive||mode==='unmount-before-upload')HTMLCanvasElement.prototype.toBlob=function(callback,type,quality){
    if(mode==='unmount-before-upload'){flushSync(()=>root.render(null));window.cancelled=true;}
    if(type==='image/jpeg'&&progressive)callback(new Blob([decode(progressive)],{type}));else original.call(this,callback,type,quality);
  };
  const profiles={uploadImage:async(kind,dataUrl,revision)=>{
    window.sent++;const response=await fetch('/upload',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({kind,dataUrl,revision,mode})});
    const data=await response.json();
    if(mode==='unmount-before-retry'){flushSync(()=>root.render(null));window.cancelled=true;}
    if(!response.ok)throw Object.assign(new Error(data.error==='IMAGE_INVALID'?'الصورة غير صالحة':data.error),{code:data.error});return data.profile;
  }};
  root.render(<CropDialog crop={{kind,image}} revision={11} profiles={profiles} onClose={()=>{image.dispose();root.render(null);}} onDone={profile=>{window.finished=profile;image.dispose();root.render(null);}}/>);
};`;
const bundle=await build({stdin:{contents:source,resolveDir:process.cwd(),loader:'jsx'},bundle:true,write:false,format:'iife',jsx:'automatic',loader:{'.css':'text','.webp':'dataurl','.woff2':'dataurl'},logLevel:'silent'});
const html='<!doctype html><html lang="ar" dir="rtl"><meta name="viewport" content="width=device-width,initial-scale=1"><body><div id="root"></div><script>'+bundle.outputFiles[0].text+'</script></body></html>';
const attempts=[];
const server=http.createServer(async(req,res)=>{
  if(req.url!=='/upload'){res.writeHead(200,{'content-type':'text/html;charset=utf-8'});res.end(html);return;}
  let payload='';for await(const chunk of req)payload+=chunk;
  const {kind,dataUrl,revision,mode}=JSON.parse(payload);
  let status=200,body;
  try{
    if(mode==='conflict')throw Object.assign(new Error('CONFLICT'),{code:'CONFLICT',status:409});
    if(['AUTH_EXPIRED','CONTENT_REJECTED','NETWORK'].includes(mode))throw Object.assign(new Error(mode),{code:mode,status:mode==='AUTH_EXPIRED'?401:mode==='CONTENT_REJECTED'?422:503});
    if(mode==='unmount-before-retry')throw Object.assign(new Error('IMAGE_INVALID'),{code:'IMAGE_INVALID',status:400});
    if(mode==='always-invalid')throw Object.assign(new Error('IMAGE_INVALID'),{code:'IMAGE_INVALID',status:400});
    const image=await imageFromDataUrl(dataUrl,kind);
    assert.equal(revision,11);assert.ok(image.bytes.length<=IMAGE_LIMITS[kind]);
    const metadata=await sharp(image.bytes).metadata();
    assert.equal(metadata.exif,undefined);assert.equal(metadata.icc,undefined);assert.equal(metadata.xmp,undefined);
    assert.equal(metadata.width/metadata.height,kind==='avatar'?1:3);
    body={profile:{revision:12,imageReviews:{[kind]:{status:'pending'}}}};
  }catch(error){status=error.status||500;body={error:error.code||'INTERNAL'};
    if(error.code==='IMAGE_INVALID'&&mode!=='always-invalid'){
      const bytes=Buffer.from(dataUrl.split(',')[1],'base64');
      try{const decoded=await sharp(bytes).raw().toBuffer({resolveWithObject:true});body.testDiagnostics={decoded:true,width:decoded.info.width,height:decoded.info.height,stack:error.stack?.split('\n').slice(1,6)};}
      catch{body.testDiagnostics={decoded:false};}
    }
  }
  attempts.push({kind,status,error:body.error,revision,diagnostics:body.testDiagnostics});
  res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(body));
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+server.address().port;

try{
  for(const[name,engine]of[['chromium',chromium],['webkit',webkit]])await test(name+': image-format recovery preserves crop, revision and one pending review',{timeout:45000},async()=>{
    const browser=await engine.launch({headless:true,...(name==='chromium'&&process.platform==='win32'?{executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'}:{})});
    try{
      for(const kind of ['avatar','cover'])for(const sample of ['native','incompatible','detailed-incompatible']){
        const incompatible=sample!=='native';
        const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];
        page.on('pageerror',error=>errors.push(error.message));await page.goto(origin);
        const before=attempts.length;
        await page.evaluate(options=>launch(options),{kind,fixture:(sample==='detailed-incompatible'?noisyFixture:fixture).toString('base64'),progressive:incompatible?progressive[kind]:null});
        await page.getByRole('button',{name:'إرسال للمراجعة',exact:true}).click();
        await page.waitForFunction(()=>window.finished?.revision===12||document.querySelector('[role="alert"]'));
        assert.equal(await page.evaluate(()=>finished?.revision),12,JSON.stringify({engine:name,kind,sample,alert:await page.getByRole('alert').allTextContents(),requests:attempts.slice(before),errors}));
        await page.getByRole('dialog').waitFor({state:'detached'});
        assert.equal(await page.evaluate(()=>sent),incompatible?2:1);
        const requests=attempts.slice(before);assert.deepEqual(requests.map(item=>item.status),incompatible?[400,200]:[200]);
        if(incompatible)assert.equal(requests[0].diagnostics.decoded,true,'the rejected browser-format image is actually decodable');
        assert.ok(requests.every(item=>item.revision===11));
        assert.equal(await page.evaluate(kind=>finished.imageReviews[kind].status,kind),'pending');
        assert.equal(await page.getByRole('dialog').count(),0);assert.deepEqual(errors,[]);
        await page.close();
      }
      for(const[mode,count]of[['conflict',1],['always-invalid',2],['AUTH_EXPIRED',1],['CONTENT_REJECTED',1],['NETWORK',1]]){
        const page=await browser.newPage();await page.goto(origin);
        await page.evaluate(options=>launch(options),{kind:'avatar',fixture:fixture.toString('base64'),mode});
        await page.getByRole('button',{name:'إرسال للمراجعة',exact:true}).click();
        await page.getByRole('alert').waitFor();
        assert.equal(await page.evaluate(()=>sent),count,'no retries for conflicts or an unbounded format loop');
        assert.equal(await page.evaluate(()=>finished),null);
        assert.equal(await page.getByRole('button',{name:'إرسال للمراجعة',exact:true}).isEnabled(),true);
        await page.getByRole('button',{name:'إلغاء',exact:true}).click();await page.close();
      }
      for(const[mode,count]of[['unmount-before-upload',0],['unmount-before-retry',1]]){
        const page=await browser.newPage();await page.goto(origin);
        await page.evaluate(options=>launch(options),{kind:'avatar',fixture:fixture.toString('base64'),mode});
        await page.getByRole('button',{name:'إرسال للمراجعة',exact:true}).click();
        await page.waitForFunction(()=>window.cancelled);
        await page.getByRole('dialog').waitFor({state:'detached'});
        await page.waitForTimeout(100);
        assert.equal(await page.evaluate(()=>sent),count,'unmounting or switching accounts never sends a pending crop/retry');
        assert.equal(await page.evaluate(()=>finished),null);
        await page.close();
      }
    }finally{await browser.close();}
  });
}finally{server.close();}

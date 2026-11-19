// FontFace readiness and computed weight do not prove that bold outlines render.
// Exercise actual shipped BrandFonts with synthesis disabled and compare raster
// ink for the same text at every supported weight in both browser engines.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
import {chromium,webkit} from 'playwright';

const output=process.env.FONT_WEIGHT_EVIDENCE_DIR||path.resolve('.cache/font-weight');
await mkdir(output,{recursive:true});
const source=`import React from'react';import{createRoot}from'react-dom/client';import{BrandFonts}from'./src/shared/brand/art.jsx';
const samples={ar:'ميدان بديهة النتيجة النهائية',en:'Maydan Badeeha Final Score'};
createRoot(document.getElementById('root')).render(<><BrandFonts/><style>{'body{margin:20px;background:#fff8f0;color:#352139}section{margin:20px 0;padding:16px;border:1px solid #ddd;background:white}h1,h2,b{font:18px Arial,sans-serif}article{display:grid;grid-template-columns:70px 1fr;align-items:center;gap:12px}span{display:inline-block;width:max-content;font-family:"Maydan Round";font-size:40px;line-height:1.8;font-synthesis:none}'}</style><h1>Actual shipped font: 400 → 800</h1>{Object.entries(samples).map(([locale,text])=><section key={locale}><h2>{locale}</h2>{[400,500,600,700,800].map(weight=><article key={weight}><b>{weight}</b><span id={locale+'-'+weight} dir={locale==='ar'?'rtl':'ltr'} style={{fontWeight:weight}}>{text}</span></article>)}</section>)}</>);`;
const built=await build({stdin:{contents:source,resolveDir:process.cwd(),loader:'jsx'},bundle:true,write:false,format:'iife',jsx:'automatic',logLevel:'silent',outdir:'.cache/font-weight/build',assetNames:'assets/[name]-[hash]',loader:{'.woff2':'file','.webp':'file'},define:{__MAYDAN_ROOMS_URL__:'"same-origin"'}});
const files=new Map(built.outputFiles.map(file=>['/'+path.relative(path.resolve('.cache/font-weight/build'),file.path).replaceAll('\\','/'),file.contents]));
const js=[...files.keys()].find(file=>file.endsWith('.js'));
const server=createServer((req,res)=>{const pathname=new URL(req.url,'http://localhost').pathname;if(files.has(pathname)){res.writeHead(200,{'content-type':pathname.endsWith('.woff2')?'font/woff2':pathname.endsWith('.webp')?'image/webp':'text/javascript'});res.end(files.get(pathname));return;}res.writeHead(200,{'content-type':'text/html;charset=utf-8'});res.end('<!doctype html><html><meta charset="utf-8"><div id="root"></div><script src="'+js+'"></script></html>');});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
test.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));

for(const[name,engine]of[['chromium',chromium],['webkit',webkit]])test(name+': shipped AR/EN weights render distinct actual outlines after font readiness',{timeout:30000},async()=>{
 const browser=await engine.launch({headless:true}),page=await browser.newPage({viewport:{width:1000,height:900},deviceScaleFactor:1}),errors=[],fontResponses=[],external=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.url().endsWith('.woff2'))fontResponses.push({path:new URL(r.url()).pathname,status:r.status(),type:r.headers()['content-type']});});
 await page.route('**/*',route=>{if(new URL(route.request().url()).origin===origin)return route.continue();external.push(route.request().url());return route.abort();});
 let data;
 try{
  await page.goto(origin);await page.locator('#en-800').waitFor();
  await page.evaluate(async()=>{await Promise.all([...document.querySelectorAll('article span')].map(el=>document.fonts.load(getComputedStyle(el).fontWeight+' 40px "Maydan Round"',el.textContent)));await document.fonts.ready;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});
  data=await page.evaluate(async()=>{
   const digest=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');
   const samples=[];
   for(const el of document.querySelectorAll('article span')){const s=getComputedStyle(el),canvas=document.createElement('canvas');canvas.width=1100;canvas.height=120;const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.font=s.fontWeight+' 40px "Maydan Round"';ctx.direction=el.dir;ctx.fillStyle='#000';ctx.fillText(el.textContent,el.dir==='rtl'?1080:20,70);const pixels=ctx.getImageData(0,0,1100,120).data;let ink=0;for(let i=3;i<pixels.length;i+=4)ink+=pixels[i];samples.push({id:el.id,locale:el.id.split('-')[0],weight:Number(s.fontWeight),fontFamily:s.fontFamily,fontSynthesis:s.fontSynthesis,fontFaceReady:document.fonts.check(s.fontWeight+' 40px "Maydan Round"',el.textContent),domWidth:el.getBoundingClientRect().width,inkAlphaSum:ink,rasterSHA256:await digest(pixels)});}
   return{status:document.fonts.status,faces:[...document.fonts].map(f=>({family:f.family,weight:f.weight,status:f.status})),samples};
  });
  assert.equal(data.status,'loaded');assert.ok(data.faces.every(f=>f.status==='loaded'));
  for(const locale of['ar','en']){
   const samples=data.samples.filter(s=>s.locale===locale);assert.ok(samples.every(s=>s.fontFaceReady&&s.fontFamily.includes('Maydan Round')&&s.fontSynthesis==='none'));
   assert.equal(new Set(samples.map(s=>s.rasterSHA256)).size,5,'each supported weight has distinct rendered outlines');
   for(let i=1;i<samples.length;i++)assert.ok(samples[i].inkAlphaSum>samples[i-1].inkAlphaSum*1.06,`${locale} weight${samples[i].weight} must visibly thicken actual outlines`);
   const ratio=samples.at(-1).inkAlphaSum/samples[0].inkAlphaSum;assert.ok(ratio>1.6&&ratio<2.6,`${locale} real bold/regular ink ratio ${ratio}`);
  }
  assert.equal(fontResponses.length,10);assert.ok(fontResponses.every(r=>r.status===200&&r.type==='font/woff2'));assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  await page.screenshot({path:path.join(output,name+'-weights.png'),fullPage:true});
 }finally{await writeFile(path.join(output,name+'.json'),JSON.stringify({engine:name,data,fontResponses,errors,external,bundleSHA256:createHash('sha256').update(files.get(js)).digest('hex'),shippedFontBytes:[...files].filter(([name])=>name.endsWith('.woff2')).reduce((sum,[,bytes])=>sum+bytes.byteLength,0),localOnly:true},null,2));await browser.close();}
});

// Actual DesignRuntime + saved layout + actual Ersomha canvas in two browsers.
// Services/transport are isolated; this test never reads or writes live Studio.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs/promises';
import { build } from 'esbuild';
import { chromium, webkit } from 'playwright';

const services = `
import{createContext,useContext}from'react';
export const AccountContext=createContext(null),LammaContext=createContext(null),RouteContext=createContext(null);
export const useAccount=()=>useContext(AccountContext),useLamma=()=>useContext(LammaContext),useRoute=()=>useContext(RouteContext);
export const resolveAccountServer=()=>location.origin;
export const request=(resource,options)=>window.viewportFixture.read(resource,options);
export const registerBackLayer=()=>()=>{};
`;
const harness = `
import React,{useContext}from'react';import{createRoot}from'react-dom/client';
import{DesignRuntime}from'./src/design/DesignRuntime.jsx';import{DesignContext}from'./src/design/context.js';
import{createDefaultDesign}from'./src/design/schema.js';import{savePublishedDesign,readPublishedDesign}from'./src/design/client.js';
import{AccountContext,LammaContext,RouteContext}from'fixture-services';
import{ErsomhaMatch}from'./src/online/Ersomha.jsx';import{BrandFonts}from'./src/shared/brand/art.jsx';
import ui from'./src/shared/ui/ui.css';import tokens from'./src/shared/theme/tokens.css';import brand from'./src/shared/brand/brand.css';import online from'./src/online/online.css';
const requests=[],commands=[],listeners=new Set();let operations=[],seq=0;
const members=[{id:'drawer',name:'الرسّام',avatar:0,score:0,connected:true},{id:'guesser',name:'صديق',avatar:1,score:0,connected:true}];
const state={game:'ersomha',phase:'draw',code:'123456',matchId:1,round:1,rounds:2,drawerId:'drawer',mode:'cooperative',settings:{cycles:1,difficulty:'easy',categories:[]},deadlineAt:Date.now()+60000,participants:members.map(p=>p.id),members,drawing:{epoch:1,seq:0},myWord:'قطار',category:'transport',publicWord:{wordLengths:[],letters:[]},guessedIds:[],recentGuesses:[]};
const emit=(kind,fields={})=>listeners.forEach(listener=>listener({type:'drawing',kind,matchId:1,round:1,epoch:1,seq,...fields}));
const client={ws:{bufferedAmount:0},subscribeDrawing(listener){listeners.add(listener);return()=>listeners.delete(listener);},async command(type,fields={}){
 commands.push({type,fields:structuredClone(fields)});
 if(type==='drawing_sync'){setTimeout(()=>emit('sync',{ops:structuredClone(operations),undoneIds:[],chunk:0,chunks:1}),0);return{ok:true};}
 if(type==='drawing_batch'){const old=operations.find(op=>op.strokeId===fields.strokeId);if(old){old.points.push(...structuredClone(fields.points));old.end=fields.end;}else operations.push(structuredClone(fields));seq++;emit('append',{op:fields});return{ok:true,seq};}
 throw new Error('Unexpected fixture command '+type);
}};
window.viewportFixture={commands,requests,operations:()=>structuredClone(operations),
 read:async(resource,options={})=>{requests.push({resource,method:options.method||'GET'});if(!resource.startsWith('/api/ui-config')||options.method&&options.method!=='GET')throw new Error('Unexpected fixture resource');return readPublishedDesign()||{channel:'default',document:createDefaultDesign()};},
 saveLayout(layout){const document=createDefaultDesign();document.screens['ersomha.draw.drawer']={nodes:{canvas:{layouts:{landscape:layout}}},decorations:[]};const config={channel:'published',versionId:'synthetic-canvas-layout',document};if(!savePublishedDesign(config))throw new Error('Fixture layout failed real design validation');return readPublishedDesign();}
};
document.addEventListener('pointerdown',event=>{if(!event.target.classList?.contains('ers-board'))return;const rect=event.target.getBoundingClientRect();window.viewportFixture.pointerStart={x:event.clientX,y:event.clientY,left:rect.left,top:rect.top,width:rect.width,height:rect.height};},true);
function Probe(){const design=useContext(DesignContext);return <output id="design-probe" hidden data-profile={design.profile} data-saved={!!design.document.screens['ersomha.draw.drawer']?.nodes?.canvas?.layouts?.landscape}/>;}
const account={ready:true,signedIn:false,user:null},lamma={activeCall:null},route={name:'online'};
function App(){return <AccountContext.Provider value={account}><LammaContext.Provider value={lamma}><RouteContext.Provider value={route}><BrandFonts/><style>{tokens}{ui}{brand}{online}</style><DesignRuntime><Probe/><main className="screen online-screen stack"><ErsomhaMatch state={state} me={members[0]} disabled={false} isHost act={async()=>true} client={client} status="connected" drawerReady/></main></DesignRuntime></RouteContext.Provider></LammaContext.Provider></AccountContext.Provider>;}
createRoot(document.getElementById('root')).render(<App/>);
`;
const intercepted = new Set(['src/shared/account/context.js','src/shared/account/api.js','src/social/LammaProvider.jsx','src/platform/router.js'].map(file=>path.resolve(file)));
const built = await build({ stdin:{contents:harness,resolveDir:process.cwd(),loader:'jsx'},bundle:true,write:false,format:'iife',jsx:'automatic',
  alias:{'react/jsx-runtime':path.resolve('src/design/jsx-runtime.js')},loader:{'.js':'jsx','.css':'text','.webp':'dataurl','.woff2':'dataurl'},
  define:{'process.env.NODE_ENV':JSON.stringify('production')},
  plugins:[{name:'isolated-viewport-services',setup(build){
    build.onResolve({filter:/.*/},args=>{if(args.path==='fixture-services'||args.importer&&intercepted.has(path.resolve(path.dirname(args.importer),args.path)))return{path:'fixture-services',namespace:'viewport-fixture'};});
    build.onLoad({filter:/.*/,namespace:'viewport-fixture'},()=>({contents:services,loader:'jsx',resolveDir:process.cwd()}));
  }}],logLevel:'silent' });
const bundle=built.outputFiles[0].text;
const server=http.createServer((request,response)=>{
  response.writeHead(200,{'content-type':request.url==='/bundle.js'?'application/javascript':'text/html;charset=utf-8'});
  response.end(request.url==='/bundle.js'?bundle:'<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>');
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
const output=process.env.E2E_OUTPUT_DIR||'.cache/ersomha-design-viewport';await fs.mkdir(output,{recursive:true});
const evidence={scope:'Real DesignRuntime, validated locally saved synthetic design, actual ErsomhaMatch/canvas, synthetic drawing transport; no live account/Studio/API writes or physical iPhone claim',browsers:[]};

async function geometry(page){return page.locator('canvas.ers-board').evaluate(canvas=>{const r=canvas.getBoundingClientRect(),root=canvas.closest('[data-design-screen]');return{rect:{x:r.x,y:r.y,width:r.width,height:r.height},width:canvas.clientWidth,height:canvas.clientHeight,backingWidth:canvas.width,backingHeight:canvas.height,mode:canvas.dataset.cameraMode,center:Number(canvas.dataset.cameraCenter),position:canvas.style.position,rootWidth:root.clientWidth,rootHeight:root.clientHeight};});}
async function ready(page){await page.locator('canvas.ers-board').waitFor();await page.locator('.ers-board-status').waitFor({state:'hidden'});await page.evaluate(async()=>{await document.fonts.ready;await Promise.all(document.getAnimations().filter(animation=>animation.effect.getTiming().iterations!==Infinity).map(animation=>animation.finished.catch(()=>{})));await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));});await page.waitForFunction(()=>{const canvas=document.querySelector('canvas.ers-board');return canvas?.dataset.cameraMode&&canvas.width===Math.round(canvas.clientWidth*devicePixelRatio)&&canvas.height===Math.round(canvas.clientHeight*devicePixelRatio);});}
async function sampleInk(page,point){return page.locator('canvas.ers-board').evaluate((canvas,point)=>{
  const width=canvas.clientWidth,height=canvas.clientHeight,wide=canvas.dataset.cameraMode==='wide',scale=wide?width:Math.min(width,height),center=Number(canvas.dataset.cameraCenter),x=(width-scale)/2+point[0]*scale,y=height/2+(point[1]-center)*scale;
  const px=Math.round(x*canvas.width/width),py=Math.round(y*canvas.height/height),context=canvas.getContext('2d');let alpha=0;
  for(let dx=-3;dx<=3;dx++)for(let dy=-3;dy<=3;dy++)if(px+dx>=0&&py+dy>=0&&px+dx<canvas.width&&py+dy<canvas.height)alpha=Math.max(alpha,context.getImageData(px+dx,py+dy,1,1).data[3]);
  return{alpha,px,py};
},point);}
async function drawStrokeAt(page,start,end){
  const canvas=page.locator('canvas.ers-board'),r=await canvas.boundingBox(),before=await page.evaluate(()=>viewportFixture.operations().length);
  const hit=await page.evaluate(({x,y})=>document.elementFromPoint(x,y)?.classList.contains('ers-board'),{x:r.x+r.width*start[0],y:r.y+r.height*start[1]});assert.equal(hit,true,'designed canvas must receive the pointer at the tested visible location');
  await page.mouse.move(r.x+r.width*start[0],r.y+r.height*start[1]);await page.mouse.down();await page.mouse.move(r.x+r.width*end[0],r.y+r.height*end[1],{steps:4});await page.mouse.up();
  await page.waitForFunction(before=>viewportFixture.operations().length===before+1&&viewportFixture.operations().at(-1).end,before);
  return {...(await page.evaluate(()=>viewportFixture.operations())).at(-1),pointerStart:await page.evaluate(()=>viewportFixture.pointerStart)};
}
const near=(actual,expected,message,tolerance=.0015)=>assert.ok(Math.abs(actual-expected)<=tolerance,`${message}: ${actual} vs ${expected}`);
async function assertPaperProjection(page,label){
  const paper=await page.locator('canvas.ers-board').evaluate(canvas=>{const rect=canvas.getBoundingClientRect(),r=canvas.previousElementSibling.getBoundingClientRect(),scale=canvas.dataset.cameraMode==='wide'?canvas.clientWidth:Math.min(canvas.clientWidth,canvas.clientHeight),center=Number(canvas.dataset.cameraCenter);return{actual:{x:r.x,y:r.y,width:r.width,height:r.height},expected:{x:rect.x+(canvas.clientWidth-scale)/2,y:rect.y+canvas.clientHeight/2-center*scale,width:scale,height:scale}};});
  for(const property of ['x','y','width','height'])near(paper.actual[property],paper.expected[property],`${label} paper ${property}`,1);
  return paper.actual;
}
function assertProjection(stroke,view,label){
  // Browser input may round clientX/clientY to whole CSS pixels. Use the real
  // delivered event, not the automation request, to assess projection accuracy.
  const pointer=stroke.pointerStart,x=(pointer.x-pointer.left)/pointer.width,y=(pointer.y-pointer.top)/pointer.height;
  const expected=view.mode==='wide'?[x,view.center+(y-.5)*view.height/view.width]:[.5+(x-.5)*view.width/view.height,y];
  near(stroke.points[0][0],expected[0],`${label} x`,.00015);near(stroke.points[0][1],expected[1],`${label} y`,.00015);
}

for(const[name,engine]of[['chromium',chromium],['webkit',webkit]])test(`${name}: saved rectangular Studio canvas preserves its square world and live camera after resizing`,{timeout:60000},async()=>{
  const browser=await engine.launch({headless:true});
  try{
    const context=await browser.newContext({viewport:{width:844,height:390},deviceScaleFactor:2,isMobile:true,hasTouch:true});
    const page=await context.newPage(),errors=[],external=[];page.on('pageerror',error=>errors.push(error.message));
    await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():(external.push(route.request().url()),route.abort()));
    await page.goto(origin);await ready(page);
    // Build a custom saved rectangle inside the real visible board, exactly as
    // an editor's drag/resize does; the production validator writes only local cache.
    const layout=await page.locator('canvas.ers-board').evaluate(canvas=>{
      const r=canvas.getBoundingClientRect(),root=canvas.closest('[data-design-screen]'),p=root.getBoundingClientRect();
      const layout={x:(r.left-p.left+r.width*.04)/root.clientWidth,y:(r.top-p.top+r.height*.08)/root.clientHeight,width:r.width*.88/root.clientWidth,height:r.height*.72/root.clientHeight};
      if(!window.viewportFixture.saveLayout(layout))throw new Error('No saved design');return layout;
    });
    await page.reload();await ready(page);await page.waitForFunction(()=>document.querySelector('#design-probe')?.dataset.saved==='true');
    await page.waitForFunction(()=>document.querySelector('canvas.ers-board')?.style.position==='absolute',null,{timeout:3000}).catch(async error=>{throw new Error(`Saved canvas layout was not applied: ${JSON.stringify(await page.evaluate(()=>({probe:document.querySelector('#design-probe')?.outerHTML,canvas:document.querySelector('canvas.ers-board')?.outerHTML,root:document.querySelector('[data-design-screen]')?.getAttribute('style'),cached:JSON.parse(localStorage.getItem('maydan:design:published:v1'))})))}`,{cause:error});});
    await ready(page);
    assert.equal(await page.locator('[data-design-screen="ersomha.draw.drawer"]').evaluate(root=>getComputedStyle(root).position),'fixed','saved designs cannot remove the drawing focus viewport');
    const custom=await geometry(page);assert.equal(custom.position,'absolute','real DesignElement must apply the cached Studio layout');assert.equal(custom.mode,'wide');assert.ok(custom.width/custom.height>1.5,'the saved viewport must not be forced back to 1:1');
    near(custom.rect.width,custom.rootWidth*layout.width,'saved rectangle width',1);near(custom.rect.height,custom.rootHeight*layout.height,'saved rectangle height',1);
    await assertPaperProjection(page,'custom wide viewport');
    await page.locator('canvas.ers-board').evaluate(canvas=>{window.retainedCanvas=canvas;});
    const first=await drawStrokeAt(page,[.3,.4],[.6,.55]);
    assertProjection(first,custom,'wide custom viewport');
    assert.ok((await sampleInk(page,first.points[0])).alpha>0,'actual painted ink must land under the first pointer');
    const beforeResize=await page.evaluate(()=>viewportFixture.operations());
    await page.setViewportSize({width:740,height:320});await ready(page);await page.waitForFunction(previous=>document.querySelector('canvas.ers-board').clientWidth!==previous,custom.width);
    const resized=await geometry(page);assert.equal(resized.mode,'wide');assert.equal(await page.locator('canvas.ers-board').evaluate(canvas=>canvas===window.retainedCanvas),true,'responsive custom design preserves canvas identity');
    near(resized.rect.width,resized.rootWidth*layout.width,'responsive custom width',1);near(resized.rect.height,resized.rootHeight*layout.height,'responsive custom height',1);
    await assertPaperProjection(page,'resized custom viewport');
    assert.deepEqual(await page.evaluate(()=>viewportFixture.operations()),beforeResize,'resizing must not rewrite canonical ink or emit drawing commands');assert.ok((await sampleInk(page,first.points[0])).alpha>0,'existing ink repaints at its new camera position');
    // DesignElement writes left/top without a resize when a saved position moves.
    // Reproduce that DOM write only: do not bypass runtime's active-game guard
    // or send a design update to a real/private Studio account.
    await page.locator('canvas.ers-board').evaluate(canvas=>{canvas.style.left=`${parseFloat(canvas.style.left)+12}px`;canvas.style.top=`${parseFloat(canvas.style.top)+4}px`;});await ready(page);
    const moved=await geometry(page);near(moved.rect.x,resized.rect.x+12,'position-only horizontal move',1);near(moved.rect.y,resized.rect.y+4,'position-only vertical move',1);assert.equal(moved.width,resized.width);assert.equal(moved.height,resized.height);assert.equal(moved.mode,resized.mode);
    await assertPaperProjection(page,'position-only custom move');assert.ok((await sampleInk(page,first.points[0])).alpha>0,'position-only updates preserve existing ink');
    const second=await drawStrokeAt(page,[.68,.4],[.77,.55]);assertProjection(second,moved,'moved custom viewport');assert.ok((await sampleInk(page,second.points[0])).alpha>0);
    await page.getByRole('button',{name:'عرض اللوحة كاملة',exact:true}).click();await page.waitForFunction(()=>document.querySelector('canvas.ers-board')?.dataset.cameraMode==='fit');
    const fit=await geometry(page);near(fit.rect.width,moved.rect.width,'fit leaves the designed viewport width',1);near(fit.rect.height,moved.rect.height,'fit leaves the designed viewport height',1);
    await assertPaperProjection(page,'custom fit viewport');
    const fitRect=await page.locator('canvas.ers-board').boundingBox(),count=await page.evaluate(()=>viewportFixture.operations().length);
    await page.mouse.click(fitRect.x+fitRect.width*.04,fitRect.y+fitRect.height*.5);await page.waitForTimeout(120);assert.equal(await page.evaluate(()=>viewportFixture.operations().length),count,'letterbox space in a custom rectangle cannot create ink at a wrong world position');
    const worldPoint=[.35,.4],screenPoint=[.5+(worldPoint[0]-.5)*fit.height/fit.width,worldPoint[1]];
    const third=await drawStrokeAt(page,screenPoint,[screenPoint[0]+.02,screenPoint[1]+.03]);assertProjection(third,fit,'fit projection');assert.ok((await sampleInk(page,third.points[0])).alpha>0);
    await page.screenshot({path:path.join(output,`${name}-saved-canvas-fit.png`),fullPage:true});
    assert.equal(await page.evaluate(()=>viewportFixture.requests.every(request=>request.method==='GET'&&request.resource.startsWith('/api/ui-config'))),true);assert.deepEqual(external,[]);assert.deepEqual(errors,[]);
    evidence.browsers.push({name,layout,custom,resized,moved,fit,normalizedPoints:[first.points[0],second.points[0],third.points[0]],externalRequests:external.length,pageErrors:errors.length});
    await context.close();
  }finally{await browser.close();}
});
test.after(async()=>{await fs.writeFile(path.join(output,'result.json'),JSON.stringify(evidence,null,2)+'\n');await new Promise(resolve=>server.close(resolve));});

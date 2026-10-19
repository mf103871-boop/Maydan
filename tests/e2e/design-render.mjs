import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { chromium, webkit } from 'playwright';

const fixture = `
import React,{useCallback,useEffect,useRef,useState} from 'react';
import{createRoot}from'react-dom/client';
import Legacy from'./src/design/react.js';
import{DesignContext}from'./src/design/context.js';
import{createDefaultDesign,designProfile}from'./src/design/schema.js';
import{CallControls}from'./src/social/CallDock.jsx';
window.refAttached=0;window.refCleaned=0;
const call={id:'render-call',scope:'group',status:'active',startedAt:Date.now(),name:'مكالمة التجربة'};
const media={connected:true,userId:'local',muted:false,participants:[{identity:'local',id:'local',name:'أنت',local:true},{identity:'other',id:'other',name:'صديق',local:false,speaking:true}]};
function Harness(){
const[document,setDocument]=useState(createDefaultDesign),[profile,setProfile]=useState(()=>designProfile(innerWidth,innerHeight)),[scene,setScene]=useState('home'),[text,setText]=useState(''),[legacyText,setLegacyText]=useState('');
const inputRef=useRef(null);const callback=useCallback(element=>{if(element){window.refAttached++;return()=>{window.refCleaned++;};}},[]);
useEffect(()=>{window.harness={document:setDocument,profile:setProfile,scene:setScene,input:()=>inputRef.current};},[]);
const runtime={document,profile,editing:true,assetUrls:{},onSelect:detail=>{window.selected={screenId:detail.screenId,nodeId:detail.nodeId,repeat:detail.repeat,layoutMode:detail.layoutMode,screenRect:detail.screenRect,elementRect:detail.elementRect};}};
const tree=<DesignContext.Provider value={runtime}>{scene==='home'?<section data-design-screen="players" id="screen" style={{position:'relative',boxSizing:'border-box',margin:'30px',padding:14,border:'3px solid #333',width:'calc(100vw - 60px)',height:'calc(100dvh - 60px)'}}>
  <div id="offset-parent" style={{position:'relative',margin:'20px 5px',padding:7,border:'2px solid #999'}}>
    <input id="controlled" data-design-id="name-input" ref={inputRef} value={text} onChange={event=>setText(event.target.value)} style={{fontSize:16}}/>
    <button id="back" data-design-id="back" ref={callback}><svg data-testid="original-icon" width="20" height="20"><path d="M1 1L10 10"/></svg><span>ارجع</span></button>
    <button id="sound" data-design-id="add-player"><span className="button-icon"><svg width="20" height="20"/></span><strong>إضافة</strong></button>
    <a id="home-link" data-design-id="title" data-design-required="true" href="#">دفتر اللاعبين</a>
    {Legacy.createElement('input',{id:'legacy-input','data-design-id':'name-input',value:legacyText,onChange:event=>setLegacyText(event.target.value)})}
    {Legacy.createElement('button',{id:'legacy-children','data-design-id':'add-player',children:'نص من الخاصية'})}
  </div>
</section>:scene==='call'?<CallControls call={call} media={media} currentUserId="local" onMute={()=>{window.muteCalls=(window.muteCalls||0)+1;}}/>:<section data-design-screen="social.list" id="repeat-screen" style={{boxSizing:'border-box',position:'relative',width:'100vw',height:'100dvh',padding:20}}>{['a','b','c','d'].map(id=><div key={id} data-design-id="friend-row" data-row={id} style={{boxSizing:'border-box',height:52,marginBottom:8,border:'1px solid #333'}}><span>{id}</span></div>)}</section>}</DesignContext.Provider>;window.fixtureTree=tree;return tree;}
createRoot(window.document.getElementById('root')).render(<Harness/>);`;

test('real React DOM keeps refs, typing, keys, icons, orientation bounds and repeated rows intact', { timeout: 90000 }, async () => {
  const built = await build({ stdin: { contents: fixture, resolveDir: process.cwd(), loader: 'jsx' }, bundle: true, write: false, format:'iife', jsx:'automatic', alias:{'react/jsx-runtime':path.resolve('src/design/jsx-runtime.js')}, loader:{'.css':'text','.webp':'dataurl','.png':'dataurl','.woff2':'dataurl'}, logLevel:'silent' });
  const bundle=built.outputFiles[0].text;
  const server=http.createServer((request,response)=>{response.writeHead(200,{'content-type':'text/html;charset=utf-8'});response.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}html,body{margin:0}button,input{font-size:16px;min-height:44px}</style></head><body><div id="root"></div><script>${bundle.replace(/<\/script/gi,'<\\/script')}</script></body></html>`);});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${server.address().port}`;
  try {
    for(const [name,engine]of [['chromium',chromium],['webkit',webkit]]) {
      const browser=await engine.launch({headless:true});
      try {
        const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[],warnings=[];
        await page.addInitScript(()=>{window.keyStacks=[];const original=console.error;console.error=(...args)=>{if(String(args[0]).includes('unique "key"'))window.keyStacks.push(new Error().stack);original.apply(console,args);};});
        page.on('pageerror',error=>errors.push(error.message));page.on('console',event=>{if(event.type()==='error' && /key|warning|Error/.test(event.text()))warnings.push(event.text());});
        await page.goto(origin);await page.waitForFunction(()=>!!window.harness);
        assert.deepEqual(warnings,[],`${name}: initial React warnings ${JSON.stringify(await page.evaluate(()=>{const rows=[];function walk(el){if(!el||typeof el!=='object')return;if(Array.isArray(el)){rows.push(el.map(item=>({type:typeof item?.type==='string'?item.type:item?.type?.name,key:item?.key,id:item?.props?.id||item?.props?.elementProps?.id})));el.forEach(walk);}else{walk(el.props?.children);walk(el.props?.elementProps?.children);}}walk(window.fixtureTree);return rows;}))}`);
        assert.equal(await page.locator('#legacy-children').textContent(),'نص من الخاصية',name);
        await page.locator('#legacy-input').fill('نسخة قديمة');assert.equal(await page.locator('#legacy-input').inputValue(),'نسخة قديمة');
        await page.locator('#controlled').fill('كتابة مستمرة');
        await page.evaluate(nodes=>{window.originalInput=window.harness.input();document.querySelector('#controlled').setSelectionRange(4,4);window.harness.document({schemaVersion:1,registryVersion:1,tokens:{},assets:[],screens:{players:{nodes,decorations:[]}}});},{'name-input':{style:{fontSize:20}},title:{style:{fontSize:12}},back:{icon:'star',layouts:{portrait:{x:1,y:1,width:.4,height:.15}}}});
        await page.waitForFunction(()=>document.querySelector('#back [data-design-icon]'));
        assert.equal(await page.locator('#back svg').count(),0,`${name}: original icon replaced`);
        assert.equal(await page.locator('#back [data-design-icon]').textContent(),'★');assert.match(await page.locator('#back').textContent(),/ارجع/);
        assert.equal(await page.evaluate(()=>document.activeElement===window.originalInput && window.harness.input()===window.originalInput && window.originalInput.selectionStart===4),true,`${name}: no input remount or lost cursor`);
        assert.equal(await page.evaluate(()=>window.refAttached),1);assert.equal(await page.evaluate(()=>window.refCleaned),0);
        const link=await page.locator('#home-link').boundingBox();assert.ok(link.width>=44 && link.height>=44,`${name}: style-only required link keeps touch size ${JSON.stringify({link,style:await page.locator('#home-link').getAttribute('style')})}`);assert.equal(await page.locator('#home-link').evaluate(element=>getComputedStyle(element).display),'inline-flex');
        const bounds=await page.locator('#back').boundingBox();assert.ok(bounds.x>=0 && bounds.y>=0 && bounds.x+bounds.width<=390.5 && bounds.y+bounds.height<=844.5,`${name}: portrait bounds ${JSON.stringify(bounds)}`);
        await page.evaluate(nodes=>window.harness.document({schemaVersion:1,registryVersion:1,tokens:{},assets:[],screens:{players:{nodes,decorations:[]}}}),{back:{icon:'none',layouts:{portrait:{x:.25,y:.2,width:.4,height:.12},landscape:{x:1,y:1,width:.4,height:.3}}}});
        await page.waitForFunction(()=>!document.querySelector('#back [data-design-icon]'));
        assert.equal(await page.locator('#back svg').count(),0);assert.match(await page.locator('#back').textContent(),/ارجع/);
        await page.setViewportSize({width:844,height:390});await page.evaluate(()=>window.harness.profile('landscape'));
        await page.waitForFunction(()=>{const r=document.querySelector('#back').getBoundingClientRect();return r.y+r.height<=390.5;},{},{timeout:3000}).catch(async error=>{throw new Error(`${name}: ${error.message} ${JSON.stringify(await page.evaluate(()=>({rect:document.querySelector('#back').getBoundingClientRect().toJSON(),style:document.querySelector('#back').getAttribute('style'),root:document.querySelector('#screen').getBoundingClientRect().toJSON(),rootStyle:document.querySelector('#screen').getAttribute('style'),viewport:[innerWidth,innerHeight]})))}`);});
        const landscape=await page.locator('#back').boundingBox();assert.ok(landscape.x+landscape.width<=844.5 && landscape.y+landscape.height<=390.5,`${name}: rotation shrinks baseline`);
        await page.setViewportSize({width:390,height:844});await page.evaluate(nodes=>{window.harness.profile('portrait');window.harness.scene('repeat');window.harness.document({schemaVersion:1,registryVersion:1,tokens:{},assets:[],screens:{'social.list':{nodes,decorations:[]}}});},{'friend-row':{layouts:{portrait:{x:0,y:.1,width:.7,height:'auto'}}}});
        await page.waitForFunction(()=>document.querySelectorAll('[data-row]').length===4 && document.querySelector('[data-row]').style.position==='relative');
        assert.equal(await page.evaluate(()=>window.refCleaned),1,`${name}: React19 ref cleanup on unmount`);
        const rows=await page.locator('[data-row]').evaluateAll(elements=>elements.map(element=>{const r=element.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};}));
        assert.equal(new Set(rows.map(row=>row.y)).size,4,`${name}: templates do not stack`);
        assert.equal(rows.every(row=>Math.abs(row.height-52)<.1),true,`${name}: auto height retains the original row flow size`);
        for(let i=1;i<rows.length;i++)assert.ok(rows[i].y>=rows[i-1].y+rows[i-1].height,`${name}: repeated rows preserve flow`);
        await page.locator('[data-row="b"]').dispatchEvent('pointerdown');assert.deepEqual(await page.evaluate(()=>({repeat:window.selected.repeat,mode:window.selected.layoutMode})),{repeat:true,mode:'offset'});
        await page.evaluate(nodes=>window.harness.document({schemaVersion:1,registryVersion:1,tokens:{},assets:[],screens:{'social.list':{nodes,decorations:[]}}}),{'friend-row':{layouts:{portrait:{x:-.1,y:-.1,width:.7,height:'auto'}}}});
        await page.waitForFunction(()=>parseFloat(document.querySelector('[data-row]').style.left)<0);
        const moved=await page.locator('[data-row]').evaluateAll(elements=>elements.map(element=>{const r=element.getBoundingClientRect();return {x:r.x,y:r.y,height:r.height};}));
        assert.ok(moved[0].x>=-.5 && moved[0].y>=-.5,`${name}: group clamped together`);for(let i=1;i<moved.length;i++)assert.ok(moved[i].y>=moved[i-1].y+moved[i-1].height);
        await page.evaluate(()=>{window.harness.document({schemaVersion:1,registryVersion:1,tokens:{},screens:{},assets:[]});window.harness.scene('call');});
        const rail=page.getByTestId('call-dock'),grip=page.getByTestId('call-dock-drag');await grip.waitFor();
        const readPosition=()=>rail.evaluate(element=>({x:Number(element.dataset.positionX),y:Number(element.dataset.positionY),position:getComputedStyle(element).position,transform:element.style.transform}));
        await grip.hover();
        const start=await readPosition(),handle=await grip.boundingBox();
        await page.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2);await page.mouse.down();await page.mouse.move(handle.x+handle.width/2-80,handle.y+handle.height/2+100,{steps:6});await page.mouse.up();
        await page.waitForFunction(previous=>{const el=document.querySelector('[data-testid="call-dock"]');return Number(el.dataset.positionX)<previous.x-40 && Number(el.dataset.positionY)>previous.y+40;},start);
        const dragged=await readPosition();assert.ok(dragged.x<start.x-40 && dragged.y>start.y+40,`${name}: native call drag before customization ${JSON.stringify({start,dragged,handle})}`);
        await page.evaluate(()=>window.harness.document({schemaVersion:1,registryVersion:1,tokens:{},assets:[],screens:{'social.call':{nodes:{mute:{icon:'none',style:{fontSize:12},layouts:{portrait:{x:.1,y:0,width:.8,height:'auto'}}}},decorations:[]}}}));
        await page.waitForFunction(()=>document.querySelector('[data-testid="call-dock-mute"]').style.position==='relative');
        const customized=await readPosition();assert.equal(customized.position,'absolute');assert.equal(customized.x,dragged.x);assert.equal(customized.y,dragged.y);assert.equal(customized.transform,dragged.transform);
        assert.equal(await page.getByTestId('call-dock-mute').locator('svg').count(),1,`${name}: protected mute status icon remains real`);
        await grip.hover();const nextHandle=await grip.boundingBox();await page.mouse.move(nextHandle.x+22,nextHandle.y+22);await page.mouse.down();await page.mouse.move(nextHandle.x+22-60,nextHandle.y+22+40,{steps:5});await page.mouse.up();
        await page.waitForFunction(previous=>{const el=document.querySelector('[data-testid="call-dock"]');return Number(el.dataset.positionX)<previous.x-20 && Number(el.dataset.positionY)>previous.y+20;},customized);
        const secondDrag=await readPosition();assert.ok(secondDrag.x<customized.x-20 && secondDrag.y>customized.y+20,`${name}: design does not freeze personal call position`);
        await grip.focus();await page.keyboard.press('ArrowRight');const keyboard=await readPosition();assert.ok(keyboard.x>secondDrag.x,`${name}: keyboard movement still works`);
        assert.deepEqual(errors,[],`${name}: browser errors`);assert.deepEqual(warnings,[],`${name}: React key/ref warnings ${JSON.stringify(await page.evaluate(()=>window.keyStacks))}`);
      } finally {await browser.close();}
    }
  } finally {await new Promise(resolve=>server.close(resolve));}
});

test('canonical Studio API navigation bypasses the unchanged installed public service worker', {timeout:60000},async()=>{
  const serviceWorker=await readFile(new URL('../../public/sw.js',import.meta.url),'utf8');
  const server=http.createServer((request,response)=>{
    const pathname=new URL(request.url,'http://fixture').pathname;
    if(pathname==='/sw.js'){response.writeHead(200,{'content-type':'application/javascript','service-worker-allowed':'/'});response.end(serviceWorker);return;}
    if(pathname==='/studio/'){response.writeHead(307,{location:'/api/studio/'});response.end();return;}
    response.writeHead(200,{'content-type':'text/html; charset=utf-8'});response.end(pathname==='/api/studio/'?'<!doctype html><html><body>canonical-studio</body></html>':'<!doctype html><html><body>unchanged-public-game</body></html>');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
  try{for(const[name,engine]of[['chromium',chromium],['webkit',webkit]]){
    const browser=await engine.launch({headless:true});try{const page=await browser.newPage();await page.goto(origin);
      const supported=await page.evaluate(()=>!!navigator.serviceWorker);assert.equal(supported,true,`${name}: service worker fixture support`);
      await page.evaluate(async()=>{await navigator.serviceWorker.register('/sw.js');await navigator.serviceWorker.ready;if(!navigator.serviceWorker.controller)await new Promise(resolve=>navigator.serviceWorker.addEventListener('controllerchange',resolve,{once:true}));});
      await page.goto(origin+'/studio/');assert.match(await page.locator('body').textContent(),/unchanged-public-game/,`${name}: the legacy worker still owns non-API navigation`);
      await page.goto(origin+'/api/studio/');assert.match(await page.locator('body').textContent(),/canonical-studio/,`${name}: canonical Studio bypasses the existing worker without unregistering it`);
      assert.equal(await page.evaluate(async()=>!!(await navigator.serviceWorker.getRegistration('/'))),true);
    }finally{await browser.close();}
  }}finally{await new Promise(resolve=>server.close(resolve));}
});

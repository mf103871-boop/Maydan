// Approved room presentation using actual RoomChrome/Lobby/Invite components.
// Synthetic room props isolate role/layout checks; local-online-directory-browser
// separately exercises real local room creation, admission and commands.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { chromium, webkit } from 'playwright';

const output=process.env.ROOM_STUDIO_EVIDENCE_DIR||path.resolve('.cache/room-studio');
await mkdir(output,{recursive:true});
const source=`import React,{useState}from'react';import{createRoot}from'react-dom/client';
import{Lobby,RoomChrome}from'./src/online/Online.jsx';import{Screen}from'./src/shared/ui/components.jsx';
import{BrandFonts}from'./src/shared/brand/art.jsx';import{PlusStyles}from'./src/plus/PlusStyles.jsx';import{setUiLocale}from'./src/shared/i18n/core.js';
import{AccountContext,NULL_ACCOUNT}from'./src/shared/account/context.js';import{PlatformContext}from'./src/platform/context.js';
import tokens from'./src/shared/theme/tokens.css';import ui from'./src/shared/ui/ui.css';import online from'./src/online/online.css';import brand from'./src/shared/brand/brand.css';
const locale=new URLSearchParams(location.search).get('locale')||'ar';await setUiLocale(locale);
const names=['ليان','Omar عمر','سارة','نور'];
const initial=()=>({game:'ersomha',phase:'lobby',code:'482761',hostId:'p0',contentLocale:'ar',contentVersion:'legacy-ar',capabilities:{localizedContent:1,newEnglishContent:false},directory:{name:'رسمة ولمّة'},settings:{difficulty:'easy',cycles:1,categories:[]},members:names.map((name,i)=>({id:'p'+i,name,avatar:i,color:'#08796d',connected:true,ready:true,profile:{id:'u'+i,name,theme:'teal',avatarPreset:'human-0'+(i+1)}}))});
window.commands=[];window.invites=[];window.copied=[];window.toasts=[];
window.addEventListener('maydan-invite-friends',event=>window.invites.push(event.detail));
Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>window.copied.push(text)},configurable:true});
function App(){const[state,setState]=useState(initial),[role,setRole]=useState('host'),[busy,setBusy]=useState(false),[version,setVersion]=useState(0);
const me=state.members.find(member=>member.id===(role==='host'?'p0':'p3'));
window.fixture={reset:next=>{window.requestedVersion=(window.requestedVersion||0)+1;setVersion(window.requestedVersion);setRole(next);setBusy(false);setState(()=>{const state=initial();if(next==='guest')state.members[3].ready=false;return state;});window.commands=[];return window.requestedVersion;},busy:setBusy,patch:patch=>setState(state=>({...state,...patch})),long:()=>setState(state=>({...state,directory:{name:'رسمة ولمّة — اسم غرفة طويل للاختبار Mixed room'},members:state.members.map(member=>({...member,name:member.name+' Abdullah محمد العمري الاسم الطويل'}))})),fallback:()=>setState(state=>({...state,members:state.members.map(member=>({...member,profile:null}))})),snapshot:()=>state};
const act=async(type,fields)=>{window.commands.push({type,fields});if(type==='ready')setState(state=>({...state,members:state.members.map(member=>member.id===me.id?{...member,ready:fields.ready}:member)}));if(type==='kick')setState(state=>({...state,members:state.members.map(member=>member.id===fields.targetId?{...member,left:true}:member)}));};
return <AccountContext.Provider value={{...NULL_ACCOUNT,ready:true,signedIn:true,user:{id:'u0'}}}><PlatformContext.Provider value={{sound:{play:()=>{}},haptics:{vibrate:()=>{}},toast:text=>window.toasts.push(text)}}><BrandFonts/><PlusStyles/><style>{tokens+ui+brand+online}</style><Screen className="stack online-screen" data-fixture-version={version}><RoomChrome state={state} code={state.code} status="connected" onExit={()=>window.commands.push({type:'exit'})}><Lobby state={state} me={me} isHost={role==='host'} disabled={busy} act={act}/></RoomChrome></Screen></PlatformContext.Provider></AccountContext.Provider>;
}createRoot(document.getElementById('root')).render(<App/>);`;
const built=await build({stdin:{contents:source,resolveDir:process.cwd(),loader:'jsx'},bundle:true,write:false,format:'esm',jsx:'automatic',loader:{'.css':'text','.webp':'dataurl','.woff2':'dataurl'},define:{__MAYDAN_ROOMS_URL__:JSON.stringify('same-origin')},logLevel:'silent'});
const server=http.createServer((req,res)=>{if(req.url.startsWith('/bundle.js')){res.setHeader('content-type','text/javascript;charset=utf-8');res.end(built.outputFiles[0].text);return;}res.setHeader('content-type','text/html;charset=utf-8');res.end('<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/bundle.js"></script></html>');});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
test.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
const settle=page=>page.evaluate(()=>document.fonts.ready.then(()=>Promise.all([...document.images].map(image=>image.decode().catch(()=>{})))).then(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))));

for(const[name,engine]of[['chromium',chromium],['webkit',webkit]])for(const locale of ['ar','en'])test(`${name}/${locale}: Studio lobby roles, identities, actions, invite and responsive layout`,{timeout:90000},async()=>{
  const browser=await engine.launch({headless:true});
  const page=await browser.newPage({viewport:{width:390,height:844},reducedMotion:'reduce'});
  const errors=[],external=[],evidence=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>{if(new URL(route.request().url()).origin!==origin){external.push(route.request().url());return route.abort();}return route.continue();});
  const root=page.locator('[data-design-screen="online.lobby"]');
  const ready=root.locator('[data-design-id="ready"]'),start=root.locator('[data-design-id="start"]');
  const reset=async role=>{const version=await page.evaluate(role=>window.fixture.reset(role),role);await page.waitForFunction(version=>document.querySelector('[data-fixture-version]')?.dataset.fixtureVersion===String(version),version);await settle(page);await page.evaluate(()=>scrollTo(0,0));};
  const geometry=async()=>page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth||document.body.scrollWidth>innerWidth,targets:[...document.querySelectorAll('.online-screen button,.online-screen summary,.online-screen select')].filter(node=>node.getClientRects().length).map(node=>{const r=node.getBoundingClientRect();return{id:node.dataset.designId||node.textContent.trim(),width:r.width,height:r.height};}),columns:getComputedStyle(document.querySelector('.online-lobby-players')).gridTemplateColumns,sections:[...document.querySelectorAll('.studio-room-header,.online-lobby-heading,.is-compact,.online-lobby-heading-code,.online-lobby-players,.online-lobby-ready-note,.studio-lobby .online-footnote,.studio-lobby summary,.online-lobby-controls')].filter(node=>node.getClientRects().length).map(node=>({className:node.className,y:node.getBoundingClientRect().y,height:node.getBoundingClientRect().height}))}));
  try{
    await page.goto(origin+'/?locale='+locale);await root.waitFor();await settle(page);
    assert.equal(await root.locator('[data-design-id="member"]').count(),4);
    assert.equal(await root.locator('.online-member-host:not(.is-placeholder)').innerText(),locale==='en'?'Host':'المضيف');
    assert.equal(await root.locator('[data-design-id="member-remove"]').count(),3);
    assert.equal(await root.locator('.is-self [data-design-id="member-remove"]').count(),0,'host has no self-removal control');
    assert.equal(await root.locator('.online-lobby-heading h2').innerText(),'رسمة ولمّة','room names are not translated by UI locale');
    assert.equal(await root.locator('[data-design-id="content-language"] option[value="en"]').evaluate(option=>option.disabled),true);
    assert.equal(await start.isEnabled(),true);
    for(const[width,height]of[[390,844],[360,800],[430,932],[844,390]]){
      await page.setViewportSize({width,height});await settle(page);
      const g=await geometry();assert.equal(g.overflow,false,`${width}: no horizontal overflow`);
      for(const hit of g.targets)assert.ok(hit.width>=47.5&&hit.height>=47.5,`${width}: ${hit.id} has48px target (${hit.width}x${hit.height})`);
      assert.ok((await ready.boundingBox()).height>=51.5,'readiness primary52');
      assert.ok((await start.boundingBox()).height>=51.5,'start primary52');
      if(width===390){const box=await start.boundingBox();assert.ok(box.y>=0&&box.y+box.height<=height,'ready host sees the complete start action in the first390x844viewport');}
      await page.screenshot({path:path.join(output,`${name}-${locale}-${width}-host.png`),fullPage:true});if(width===390)await page.screenshot({path:path.join(output,`${name}-${locale}-390-host-viewport.png`)});evidence.push({role:'host',width,height,...g});
    }
    await page.setViewportSize({width:390,height:844});await settle(page);
    await ready.click();assert.equal(await start.isDisabled(),true);assert.deepEqual(await page.evaluate(()=>window.commands.at(-1)),{type:'ready',fields:{ready:false}});
    await ready.click();await start.click();assert.deepEqual(await page.evaluate(()=>window.commands.at(-1)),{type:'start',fields:undefined});
    const beforeRemove=await page.evaluate(()=>window.commands.length);
    await root.locator('[data-design-id="member-remove"]').first().click();
    const dialog=page.getByRole('dialog');await dialog.waitFor();assert.equal(await page.evaluate(()=>window.commands.length),beforeRemove,'connected-seat removal is only proposed before confirmation');
    await dialog.locator('.btn-primary,.btn-danger').last().click();await dialog.waitFor({state:'hidden'});
    assert.equal(await root.locator('[data-design-id="member"]').count(),3);assert.equal(await page.evaluate(()=>window.commands.at(-1).type),'kick');
    await reset('host');await root.locator('[data-design-id="invite-toggle"]').click();
    const invite=page.locator('.studio-invite');await invite.waitFor();await invite.locator('[data-design-id="invite-qr"]').waitFor();await settle(page);
    assert.equal(await invite.locator('[data-design-id="invite-qr"]').evaluate(image=>image.naturalWidth>0),true);
    const inviteBounds=await invite.evaluate(node=>{
      const heading=node.querySelector('.studio-invite-heading').getBoundingClientRect(),img=node.querySelector('.studio-invite-art>img'),art=img.getBoundingClientRect(),qr=node.querySelector('[data-design-id=invite-qr]').getBoundingClientRect();
      const canvas=document.createElement('canvas');canvas.width=img.naturalWidth;canvas.height=img.naturalHeight;const ctx=canvas.getContext('2d');ctx.drawImage(img,0,0);const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;
      let x0=canvas.width,x1=0,y0=canvas.height,y1=0;for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++)if(pixels[(y*canvas.width+x)*4+3]>8){x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);}
      return{headingTop:heading.top,headingBottom:heading.bottom,artBottom:art.y+(y1+1)/canvas.height*art.height,artTop:art.y+y0/canvas.height*art.height,qrTop:qr.top,artWidth:art.width,opticalWidth:(x1-x0+1)/canvas.width*art.width,opticalHeight:(y1-y0+1)/canvas.height*art.height,contentWidth:node.getBoundingClientRect().width,buttonWidths:[...node.querySelectorAll(':scope>.btn')].map(button=>button.getBoundingClientRect().width),targets:[...node.closest('[role=dialog]').querySelectorAll('button,input')].map(button=>{const r=button.getBoundingClientRect();return{width:r.width,height:r.height};})};});
    assert.ok(inviteBounds.opticalWidth>=115&&inviteBounds.opticalWidth<=130&&inviteBounds.opticalHeight>=95&&inviteBounds.opticalHeight<=110&&inviteBounds.artTop>=inviteBounds.headingTop-1&&inviteBounds.artBottom<=inviteBounds.headingBottom+1&&inviteBounds.qrTop>=inviteBounds.headingBottom,'game art stays within heading and never overlaps QR');
    evidence.push({role:'invite',...inviteBounds});
    assert.ok(inviteBounds.contentWidth>=340&&inviteBounds.buttonWidths.every(width=>Math.abs(width-inviteBounds.contentWidth)<1),'invite actions fill the390px sheet content');
    assert.ok(inviteBounds.targets.every(target=>target.width>=47.5&&target.height>=47.5),'invitation controls have48px targets');

    const expected=await invite.locator('[data-design-id="share-link"]').inputValue();assert.ok(expected.includes('482761'));
    for (const width of [360, 390]) {
      await page.setViewportSize({ width, height:844 });
      await settle(page);
      const tail = await invite.locator('[data-design-id="invite-link-preview"]').evaluate(node => {
        const bounds = node.getBoundingClientRect(), code = node.querySelector('bdi');
        const digits = code.getBoundingClientRect();
        return { text:code.textContent, fits:digits.width>0 && digits.left>=bounds.left && digits.right<=bounds.right+1 };
      });
      assert.deepEqual(tail,{text:'482761',fits:true},`${width}: all six invitation digits are visible`);
      assert.equal(await invite.locator('[data-design-id="share-link"]').inputValue(),expected);
      const main = await invite.locator('[data-design-id="invite-code"]').evaluate(node => {
        const range = document.createRange();
        range.selectNodeContents(node);
        const bounds = node.getBoundingClientRect(), digits = range.getBoundingClientRect();
        return range.getClientRects().length===1 && digits.left>=bounds.left && digits.right<=bounds.right+1;
      });
      assert.ok(main,`${width}: the primary code stays together in one line`);
    }
    await page.setViewportSize({ width:360, height:844 });
    await invite.evaluate(node => {
      const original = [node,...node.querySelectorAll('*')].map(el=>[el,el.style.fontSize,parseFloat(getComputedStyle(el).fontSize)]);
      window.restoreInviteText = () => original.forEach(([el,style])=>{el.style.fontSize=style;});
      for (const [el,,size] of original) el.style.fontSize=(size*2)+'px';
    });
    await settle(page);
    const zoomed = await invite.locator('[data-design-id="invite-code"]').evaluate(node => {
      const range = document.createRange();
      range.selectNodeContents(node);
      const bounds = node.getBoundingClientRect(), digits = range.getBoundingClientRect();
      return range.getClientRects().length===1 && digits.left>=bounds.left && digits.right<=bounds.right+1;
    });
    assert.ok(zoomed,'360: 200% type reflows and the complete main invitation code remains readable');
    await invite.locator('[data-design-id="invite-copy"]').click({ trial:true });
    await page.evaluate(()=>window.restoreInviteText());
    await page.setViewportSize({ width:390, height:844 });
    await settle(page);
    await invite.locator('[data-design-id="invite-copy"]').click();assert.equal(await page.evaluate(()=>window.copied.at(-1)),expected);
    await invite.locator('[data-design-id="invite-share"]').click();assert.deepEqual(await page.evaluate(()=>window.invites.at(-1)),{roomCode:'482761'});
    await page.screenshot({path:path.join(output,`${name}-${locale}-invite.png`),fullPage:true});
    await page.getByRole('dialog').locator('.modal-head button').click();await invite.waitFor({state:'hidden'});
    await reset('guest');assert.equal(await start.count(),0);assert.equal(await root.locator('[data-design-id="member-remove"]').count(),0);assert.equal(await root.locator('select[data-design-id="content-language"]').count(),0);assert.equal(await root.locator('strong[data-design-id="content-language"]').getAttribute('lang'),'ar');
    assert.ok((await root.locator('[data-design-id="players"]').innerText()).includes('Omar عمر'),'player names remain exact across locales');
    await page.screenshot({path:path.join(output,`${name}-${locale}-guest.png`),fullPage:true});
    await ready.click();assert.deepEqual(await page.evaluate(()=>window.commands.at(-1)),{type:'ready',fields:{ready:true}});
    await page.evaluate(()=>window.fixture.busy(true));await page.waitForFunction(()=>document.querySelector('[data-design-id=ready]')?.disabled);assert.equal(await ready.isDisabled(),true);
    await reset('host');await page.evaluate(()=>window.fixture.fallback());await settle(page);assert.deepEqual(await root.locator('.clay-avatar').evaluateAll(nodes=>nodes.map(node=>Number(node.dataset.index))),[0,1,2,3],'four fallback identities are retained');
    await reset('host');await page.evaluate(()=>window.fixture.long());await page.waitForFunction(()=>document.body.innerText.includes('Abdullah'));
    await page.evaluate(()=>{const sizes=[...document.querySelectorAll('body *')].map(node=>{const style=getComputedStyle(node);return{node,font:parseFloat(style.fontSize),line:parseFloat(style.lineHeight)};});document.documentElement.style.fontSize='200%';for(const{node,font,line}of sizes){if(Number.isFinite(font))node.style.fontSize=(font*2)+'px';if(Number.isFinite(line))node.style.lineHeight=(line*2)+'px';}});await settle(page);
    assert.equal((await geometry()).overflow,false,'long names and all text enlarged200% do not overflow');
    await ready.click();assert.equal(await start.isDisabled(),true);await ready.click();assert.equal(await start.isEnabled(),true);
    await page.screenshot({path:path.join(output,`${name}-${locale}-long-text.png`),fullPage:true});
    assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
    await writeFile(path.join(output,`${name}-${locale}.json`),JSON.stringify({engine:name,locale,passed:true,syntheticRoomProps:true,actualReactComponents:true,bundleSHA256:createHash('sha256').update(built.outputFiles[0].contents).digest('hex'),evidence},null,2));
  }catch(error){await page.screenshot({path:path.join(output,`${name}-${locale}-failure.png`),fullPage:true}).catch(()=>{});throw error;}
  finally{await browser.close();}
});

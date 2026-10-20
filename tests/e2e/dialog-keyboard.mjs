// Real shared overlays: deterministic visual viewport, no physical-keyboard claim.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {build} from 'esbuild';
import {chromium,webkit} from 'playwright';

const source=`
import React,{useEffect,useState}from'react';import{createRoot}from'react-dom/client';
import{Modal,Sheet,Button}from'./src/shared/ui/components.jsx';import{back,setExitGuard}from'./src/platform/router.js';
import{GroupEditor}from'./src/social/SocialHost.jsx';
import css from'./src/shared/ui/ui.css';import tokens from'./src/shared/theme/tokens.css';
function App(){const[parent,setParent]=useState(false),[child,setChild]=useState(false),[busy,setBusy]=useState(false),[sheet,setSheet]=useState(false),[text,setText]=useState(''),[group,setGroup]=useState(false);
useEffect(()=>{window.controls={setParent,setChild,setBusy,setSheet,back,openGroup:()=>setGroup(true),releaseGroup:()=>window.resolveGroup?.()};window.fixtureClosed={parent:0,child:0,sheet:0};setExitGuard(()=>{window.exits=(window.exits||0)+1;return true;});},[]);
return <><style>{tokens}</style><style>{css}</style><main style={{minHeight:1800,padding:20}}><Button id="opener" style={{position:'fixed',top:10,left:10}} onClick={()=>setParent(true)}>افتح الأب</Button><Button id="sheet-opener" style={{position:'fixed',top:70,left:10}} onClick={()=>setSheet(true)}>افتح الورقة</Button></main>
{parent&&<Modal title="الأب" onClose={()=>{window.fixtureClosed.parent++;setParent(false);}}><Button id="child-opener" onClick={()=>setChild(true)}>افتح التأكيد</Button><input aria-label="نص الأب" value={text} onChange={e=>setText(e.target.value)}/></Modal>}
{child&&<Modal title="التأكيد" onClose={busy?null:()=>{window.fixtureClosed.child++;setChild(false);}} footer={<Button id="last">آخر إجراء</Button>}>{Array.from({length:22},(_,i)=><p key={i}>تفاصيل التأكيد {i}</p>)}<input aria-label="نص التأكيد" value={text} onChange={e=>setText(e.target.value)}/></Modal>}
<Sheet open={sheet} title={null} onClose={()=>{window.fixtureClosed.sheet++;setSheet(false);}}><textarea aria-label="نص الورقة" value={text} onChange={e=>setText(e.target.value)}/>{Array.from({length:22},(_,i)=><p key={i}>تفاصيل الورقة {i}</p>)}</Sheet>
{group&&<GroupEditor group={{id:'test-group',name:'لمّة الاختبار',ownerId:'me',memberCount:2}} detail={{members:[{userId:'me',role:'owner',name:'عمر'},{userId:'friend',role:'member',name:'أحمد'}]}} friends={[]} accountId="me" onClose={()=>setGroup(false)} onCreated={()=>{}} notify={()=>{}} lamma={{removeGroupMember:async()=>{window.groupPending=true;await new Promise(resolve=>{window.resolveGroup=resolve;});window.groupPending=false;},loadGroup:async()=>{}}}/>}</>};createRoot(document.getElementById('root')).render(<App/>);`;
const built=await build({stdin:{contents:source,resolveDir:process.cwd(),loader:'jsx'},bundle:true,write:false,format:'iife',jsx:'automatic',loader:{'.css':'text','.webp':'dataurl','.woff2':'dataurl'},logLevel:'silent'});
const html=`<!doctype html><html lang="ar" dir="rtl"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="overflow:auto;margin:0"><div id="root"></div><script>${built.outputFiles[0].text}</script></body></html>`;
const server=http.createServer((_,res)=>{res.writeHead(200,{'content-type':'text/html;charset=utf-8'});res.end(html);});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
const idle=page=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
for(const[name,engine]of[['chromium',chromium],['webkit',webkit]])test(`${name}: nested overlays, busy Back, IME Escape, focus and sheet gestures`,{timeout:60000},async()=>{
  const browser=await engine.launch({headless:true});
  try{for(const size of [{width:320,height:568},{width:844,height:390}]){
    const page=await browser.newPage({viewport:size,reducedMotion:'reduce'}),errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.addInitScript(()=>{const viewport=Object.assign(new EventTarget(),{height:innerHeight,width:innerWidth,offsetTop:0,scale:1});Object.defineProperty(window,'visualViewport',{configurable:true,value:viewport});window.keyboardViewport=patch=>{Object.assign(viewport,patch);viewport.dispatchEvent(new Event('resize'));viewport.dispatchEvent(new Event('scroll'));};});
    try{
      await page.goto(origin+'/#/play/fabraka');await page.waitForFunction(()=>window.controls);await page.evaluate(()=>scrollTo(0,220));
      await page.locator('#opener').click();const parent=page.getByRole('dialog',{name:'الأب',exact:true});await parent.waitFor();
      const initialScroll=await page.evaluate(()=>scrollY);await page.locator('#child-opener').focus();await page.locator('#child-opener').click();const child=page.getByRole('dialog',{name:'التأكيد',exact:true});await child.waitFor();
      const field=child.getByRole('textbox',{name:'نص التأكيد'});await field.fill('تجربة عربية 🎮');
      await page.evaluate(()=>keyboardViewport({height:220,offsetTop:24}));
      await page.waitForFunction(()=>{const input=document.querySelector('[aria-label="نص التأكيد"]'),r=input.getBoundingClientRect();return r.top>=24&&r.bottom<=244;},undefined,{timeout:3000}).catch(async error=>{throw new Error(JSON.stringify(await field.evaluate(el=>{const modal=el.closest('[role=dialog]');return {field:el.getBoundingClientRect().toJSON(),modal:modal.getBoundingClientRect().toJSON(),scroll:modal.scrollTop,scrollHeight:modal.scrollHeight,clientHeight:modal.clientHeight,overflow:getComputedStyle(modal).overflowY,styles:el.closest('.dialog-host').style.cssText,active:document.activeElement?.outerHTML.slice(0,80),scrollY};})),{cause:error});});
      assert.equal(await field.evaluate(el=>el===document.activeElement),true,'resize retains text focus');
      assert.equal(await page.evaluate(()=>scrollY),initialScroll,'keyboard scroll stays inside the dialog');
      await field.dispatchEvent('keydown',{key:'Escape',isComposing:true,bubbles:true});await idle(page);assert.equal(await child.count(),1,'IME Escape keeps confirmation open');
      await page.keyboard.press('Tab');assert.equal(await page.locator('#last').evaluate(el=>el===document.activeElement),true);
      await page.keyboard.press('Tab');assert.equal(await child.getByRole('button',{name:'إغلاق',exact:true}).evaluate(el=>el===document.activeElement),true,'Tab loops only in top dialog');
      await page.keyboard.press('Escape');await child.waitFor({state:'detached'});assert.equal(await parent.count(),1,'one Escape dismisses only the top confirmation');assert.equal(await page.evaluate(()=>fixtureClosed.parent),0);
      await page.waitForFunction(()=>document.querySelector('#child-opener')===document.activeElement,undefined,{timeout:3000});
      assert.equal(await page.locator('#child-opener').evaluate(el=>el===document.activeElement),true,'focus returns to the invoking parent control');
      await page.locator('#child-opener').click();await child.waitFor();await page.evaluate(()=>controls.setBusy(true));await idle(page);await page.evaluate(()=>controls.back());await idle(page);
      assert.equal(await child.count(),1,'busy modal consumes Back without closing or leaving the match');assert.match(page.url(),/#\/play\/fabraka$/);assert.equal(await page.evaluate(()=>window.exits||0),0);
      await page.evaluate(()=>{controls.setBusy(false);controls.setParent(false);});await idle(page);
      assert.equal(await page.locator('#root').evaluate(el=>el.inert),true,'removing a lower dialog does not re-enable the game');assert.equal(await page.evaluate(()=>document.body.style.overflow),'hidden');
      await page.evaluate(()=>controls.back());await child.waitFor({state:'detached'});await page.waitForFunction(()=>!document.querySelector('#root').inert);assert.equal(await page.locator('#root').evaluate(el=>el.inert),false);assert.equal(await page.evaluate(()=>document.body.style.overflow),'auto');
      await page.evaluate(size=>keyboardViewport({height:size.height,offsetTop:0}),size);await page.locator('#sheet-opener').click();const sheet=page.getByRole('dialog');await sheet.waitFor();
      const text=sheet.getByRole('textbox',{name:'نص الورقة'});await text.fill('تحديد النص لا يغلق الورقة');await sheet.evaluate(el=>el.scrollTop=0);
      await text.dispatchEvent('touchstart',{touches:[{identifier:1,clientY:100}],bubbles:true});await text.dispatchEvent('touchmove',{touches:[{identifier:1,clientY:230}],bubbles:true});await text.dispatchEvent('touchend',{touches:[],bubbles:true});await idle(page);
      assert.equal(await sheet.count(),1,'touch selection/body scrolling does not dismiss the sheet');assert.equal(await text.inputValue(),'تحديد النص لا يغلق الورقة');
      const handle=sheet.getByRole('button',{name:'إغلاق اللوحة'});await handle.scrollIntoViewIfNeeded();const box=await handle.boundingBox();assert.ok(box.width>=44&&box.height>=44,'titleless sheet has a reachable close/drag control');
      await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2,box.y+box.height/2+100,{steps:5});await page.mouse.up();await sheet.waitFor({state:'detached'});
      assert.equal(await page.evaluate(()=>fixtureClosed.sheet),1,'drag and its generated click close exactly once');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);assert.deepEqual(errors,[]);
      await page.evaluate(()=>controls.openGroup());const editor=page.getByRole('dialog',{name:'أصحاب اللّمة',exact:true});await editor.waitFor();await editor.getByRole('button',{name:'إزالة أحمد',exact:true}).click();
      const remove=page.getByRole('dialog',{name:'تزيل العضو؟',exact:true});await remove.getByRole('button',{name:'تأكيد',exact:true}).click();await page.waitForFunction(()=>window.groupPending===true);
      await page.keyboard.press('Escape');await page.evaluate(()=>controls.back());await idle(page);assert.equal(await remove.count(),1,'actual member removal confirmation cannot dismiss while its operation is pending');assert.match(page.url(),/#\/play\/fabraka$/);
      await page.evaluate(()=>controls.releaseGroup());await remove.waitFor({state:'detached'});await editor.waitFor();await editor.getByRole('button',{name:'إغلاق',exact:true}).first().click();await editor.waitFor({state:'detached'});assert.deepEqual(errors,[]);
    }finally{await page.close();}
  }}finally{await browser.close();}
});
test.after(()=>new Promise(resolve=>server.close(resolve)));

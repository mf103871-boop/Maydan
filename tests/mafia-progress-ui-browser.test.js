import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdir} from 'node:fs/promises';
import path from 'node:path';
import {build} from 'esbuild';
import {chromium,webkit} from 'playwright';

const data=(revision=0)=>({available:true,revision,preferencesLocked:false,preferences:{visibility:'private',representativeRoleId:null},
  progress:{totalXp:300,level:2,xpInLevel:50,xpPerLevel:250,rewardedMatches:6,legacyMatches:9},
  roles:[{roleId:'investigator',qualifiedMatches:3,wins:2,draws:1,legacyMatches:4,mastery:1,representativeUnlocked:true},
    {roleId:'doctor',qualifiedMatches:0,wins:0,draws:0,legacyMatches:0,mastery:0,representativeUnlocked:false},
    {roleId:'leader',qualifiedMatches:15,wins:7,draws:0,legacyMatches:2,mastery:3,representativeUnlocked:true}],
  achievements:[{id:'mafia_first_qualified',earnedAt:1}],grants:[{itemId:'noir.frame',source:'mafia_achievement'}]});

test('Chromium and WebKit: RTL phone/landscape panel, revision conflicts, privacy and account fences', {timeout:60000},async()=>{
  const built=await build({stdin:{resolveDir:process.cwd(),loader:'jsx',contents:`
    import React from 'react';import{createRoot}from'react-dom/client';
    import{MafiaProgressPanel}from'./src/profiles/mafia-panel.jsx';
    import css from './src/profiles/profile.css';
    const root=createRoot(document.getElementById('root'));
    window.showAccount=(id='a',owner=true,target='friend',state={})=>root.render(<main className="profile-screen" dir="rtl"><style>{css}</style><MafiaProgressPanel account={{ready:true,signedIn:true,...state,user:{id},authHeaders:()=>({Authorization:state.token||'Bearer fixture-'+id})}} profileId={owner?id:target} owner={owner} server={location.origin}/></main>);
    window.showAccount();
  `},write:false,bundle:true,format:'iife',loader:{'.css':'text'},logLevel:'silent'});
  const html='<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:0;background:#faf7f0;color:#352d39;font-family:Tahoma,sans-serif}button,select{font:inherit}h3{font-size:16px}p{margin:0}</style><div id="root"></div><script src="/bundle.js"></script></html>';
  const server=createServer((request,response)=>{response.setHeader('content-type',request.url==='/bundle.js'?'text/javascript':'text/html');response.end(request.url==='/bundle.js'?built.outputFiles[0].contents:html);});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
  const proof=path.resolve('.cache/mafia-progress-ui-proof');await mkdir(proof,{recursive:true});
  try {
    for(const [name,engine] of [['chromium',chromium],['webkit',webkit]]) {
      const browser=await engine.launch({headless:true});
      try {
        const page=await browser.newPage({viewport:{width:390,height:844}});const errors=[];page.on('pageerror',error=>errors.push(error.message));
        let current=data(),conflict=false,hidden=false,locked=false;const writes=[],reads=[];
        await page.route('**/api/**',async route=>{
          if(route.request().method()==='GET')reads.push(route.request().headers().authorization);
          if(route.request().method()==='PATCH'){
            const body=route.request().postDataJSON();writes.push(body);
            if(conflict)return route.fulfill({status:409,json:{error:'CONFLICT'}});
            current={...current,revision:current.revision+1,preferences:{visibility:body.visibility,representativeRoleId:body.representativeRoleId}};
          }
          return route.fulfill({json:hidden?{available:false}:locked?{available:false,preferencesLocked:true}:current});
        });
        await page.goto(origin);await page.getByRole('progressbar').waitFor();
        for(const [width,height] of [[320,568],[390,844],[844,390]]){
          await page.setViewportSize({width,height});
          assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${name} ${width}: horizontal overflow`);
          const controls=await page.locator('button,select').evaluateAll(elements=>elements.map(element=>{const r=element.getBoundingClientRect();return {width:r.width,height:r.height,left:r.left,right:r.right};}));
          assert.ok(controls.every(control=>control.height>=43&&control.left>=0&&control.right<=width+1),JSON.stringify({name,width,controls}));
          await page.screenshot({path:path.join(proof,`${name}-${width}.png`),fullPage:true});
        }
        await page.getByLabel('ظهور لوحة مافيا').selectOption('public');await page.getByLabel('الدور الممثل').selectOption('investigator');
        assert.equal(await page.locator('option[value="doctor"]').evaluate(option=>option.disabled),true);
        await page.getByRole('button',{name:'حفظ إعدادات مافيا'}).click();
        await page.waitForFunction(()=>document.querySelector('select[aria-label="ظهور لوحة مافيا"]')?.value==='public'&&!document.querySelector('button[type="submit"]')?.disabled);
        assert.deepEqual(writes[0],{revision:0,visibility:'public',representativeRoleId:'investigator'});
        conflict=true;await page.getByLabel('ظهور لوحة مافيا').selectOption('friends');await page.getByRole('button',{name:'حفظ إعدادات مافيا'}).click();
        await page.getByRole('alert').waitFor();assert.match(await page.getByRole('alert').innerText(),/أعد التحميل وراجع/);
        assert.equal(await page.getByLabel('ظهور لوحة مافيا').inputValue(),'friends');assert.equal(writes.length,2,'no automatic retry of a conflicting write');
        hidden=true;await page.evaluate(()=>window.showAccount('a',false));
        await page.getByText('تقدم مافيا غير متاح للعرض حاليًا.').waitFor();assert.equal(await page.getByRole('progressbar').count(),0);
        assert.equal(await page.getByLabel('الدور الممثل').count(),0);
        hidden=false;locked=true;await page.evaluate(()=>window.showAccount('b'));
        await page.getByText('يمكنك تعديل الظهور والدور الممثل بعد انتهاء مباراة مافيا أو المشاهدة.').waitFor();
        assert.equal(await page.getByRole('progressbar').count(),0);
        locked=false;await page.evaluate(()=>window.showAccount('a'));await page.getByRole('progressbar').waitFor();
        for(const state of [{signedIn:false},{ready:false}]){
          const before=reads.length;await page.evaluate(value=>window.showAccount('a',true,'friend',value),state);
          await page.waitForFunction(()=>!document.querySelector('.mafia-profile'));
          assert.equal(reads.length,before,'cached identity must not trigger a read while signed out or not ready');
          await page.evaluate(()=>window.showAccount('a'));await page.getByRole('progressbar').waitFor();
        }
        const rotated=page.waitForRequest(request=>request.headers().authorization==='Bearer rotated-a');
        await page.evaluate(()=>window.showAccount('a',true,'friend',{token:'Bearer rotated-a'}));await rotated;
        await page.waitForFunction(()=>!!document.querySelector('[role="progressbar"]'));
        assert.equal(reads.at(-1),'Bearer rotated-a');assert.doesNotMatch(await page.content(),/Bearer rotated-a|Bearer fixture-a/);
        assert.deepEqual(errors,[]);await page.close();
      } finally {await browser.close();}
    }
  } finally {await new Promise(resolve=>server.close(resolve));}
});

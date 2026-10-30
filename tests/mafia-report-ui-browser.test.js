// Real inbox/moderation components and authenticated local APIs; synthetic cases,
// no live accounts, moderation provider, audio or automatic sanction fixtures.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdir} from 'node:fs/promises';
import path from 'node:path';
import {build} from 'esbuild';
import {chromium,webkit} from 'playwright';
import {startLocalServer} from '../server/local.mjs';
import {createUser,deleteUser} from '../server/accounts/db.mjs';
import {issueSession} from '../server/accounts/session.mjs';
import {saveMafiaReportCase} from '../server/mafia-report-cases.mjs';

test('Chromium/WebKit: actual own inbox and privileged review use status-only owner data and discard A→B→A replies',{timeout:60000},async()=>{
  const app=await startLocalServer({port:0,vars:{MAFIA_ENABLED:'1'}});let server;
  try{
    const users={};for(const key of ['reporter','target','other','target2','moderator']){
      const user=await createUser(app.env,{name:key,email:`${crypto.randomUUID()}@example.test`});const session=await issueSession(app.env,user.id);
      users[key]={userId:user.id,sessionId:session.id,token:session.token};
    }
    app.env.MODERATOR_USER_IDS=users.moderator.userId;
    const entry=`import React from'react';import{createRoot}from'react-dom/client';
      import{AccountContext,NULL_ACCOUNT}from'./src/shared/account/context.js';import{request}from'./src/shared/account/api.js';
      import{MafiaReportInbox}from'./src/online/MafiaReportInbox.jsx';import{ModerationScreen}from'./src/moderation/ModerationScreen.jsx';
      import tokens from'./src/shared/theme/tokens.css';import ui from'./src/shared/ui/ui.css';
      const root=createRoot(document.getElementById('root')),users=${JSON.stringify(users)};
      window.show=(mode='inbox',key='reporter',settings={})=>{const user=users[key];const account={...NULL_ACCOUNT,ready:true,signedIn:true,...settings,user:{id:user.userId,name:key},
        requestAuthenticated:(url,options={})=>request(url,{...options,server:${JSON.stringify(app.url)},token:user.token})};
        root.render(<AccountContext.Provider value={account}><style>{tokens+ui}</style>{mode==='moderation'?<ModerationScreen/>:<MafiaReportInbox onClose={()=>{}}/>}</AccountContext.Provider>);};window.show();`;
    const built=await build({stdin:{contents:entry,resolveDir:process.cwd(),loader:'jsx'},bundle:true,write:false,format:'iife',jsx:'automatic',loader:{'.css':'text','.webp':'dataurl','.woff2':'dataurl'},logLevel:'silent'});
    const html='<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body><div id="root"></div><script src="/bundle.js"></script></body></html>';
    server=createServer((req,res)=>{res.setHeader('content-type',req.url==='/bundle.js'?'text/javascript':'text/html');res.end(req.url==='/bundle.js'?built.outputFiles[0].contents:html);});
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;app.env.ALLOWED_ORIGINS=origin;
    const proof=path.resolve('.cache/mafia-report-ui-proof');await mkdir(proof,{recursive:true});
    for(const [name,engine] of [['chromium',chromium],['webkit',webkit]]){
      // Reset only synthetic cases between engines, retaining accounts/sessions.
      await app.env.DB.batch(['moderation_report_decisions','moderation_actions','mafia_reports','social_reports'].map(table=>app.env.DB.prepare(`DELETE FROM ${table}`)));
      const fixtureEnv={...app.env,ROOMS:{idFromName:id=>id,get:()=>({fetch:async req=>{
        const body=await req.json();return Response.json({reportedUserId:body.targetId==='target-two'?users.target2.userId:users.target.userId,matchKey:'123456:browser:7',phase:'night',capturedAt:Date.now(),perspective:{scope:'player',delayMs:0,channels:['public']},
          messages:[{id:'visible-1',playerId:body.targetId,text:'AUTHORIZED_MESSAGE_ONLY',at:Date.now(),channel:'public'}],audio:'NO_AUDIO',roleStates:{hidden:'SECRET_ROLE_MAP'},publicHistory:['UNAUTHORIZED_HISTORY']});
      }})}};
      const body={clientId:`${name}-case`,targetId:'target-one',matchId:7,category:'harassment',reason:'بلاغ اصطناعي لاختبار الواجهة'};
      const saved=await saveMafiaReportCase(fixtureEnv,users.reporter,'123456',body);
      const browser=await engine.launch({headless:true});
      try{
        const page=await browser.newPage({viewport:{width:390,height:844},reducedMotion:'reduce'});const errors=[],reads=[];
        page.on('pageerror',error=>errors.push(error.message));page.on('request',req=>{if(req.url().includes('/api/me/mafia/reports'))reads.push(req.headers().authorization);});
        await page.goto(origin);await page.getByText('بانتظار المراجعة',{exact:true}).waitFor();
        assert.equal(await page.getByText('AUTHORIZED_MESSAGE_ONLY').count(),0);assert.equal(await page.locator('audio').count(),0);
        await page.getByText('مرجع البلاغ',{exact:true}).click();
        for(const [width,height] of [[320,568],[390,844],[844,390]]){
          await page.setViewportSize({width,height});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${name} ${width} overflow`);
          await page.screenshot({path:path.join(proof,`${name}-inbox-${width}.png`),fullPage:true});
          const link=page.getByRole('link',{name:'تواصل مع دعم ميدان'});await link.scrollIntoViewIfNeeded();const box=await link.boundingBox();assert.ok(box.y>=0&&box.y+box.height<=height,`${name} ${width} support must remain scroll-accessible`);
          await page.screenshot({path:path.join(proof,`${name}-support-${width}.png`),fullPage:true});
          await page.locator('.mafia-history-dialog .modal-body').evaluate(node=>{node.scrollTop=0;});
        }
        const colors=await page.locator('.mafia-history-dialog article').evaluate(node=>({ink:getComputedStyle(node).color,panel:getComputedStyle(node).backgroundColor}));
        const luminance=color=>color.match(/\d+/g).slice(0,3).map(value=>{const c=Number(value)/255;return c<=0.04045?c/12.92:((c+0.055)/1.055)**2.4;}).reduce((sum,value,index)=>sum+value*[0.2126,0.7152,0.0722][index],0);
        const [a,b]=[luminance(colors.ink),luminance(colors.panel)].sort((a,b)=>b-a);assert.ok((a+0.05)/(b+0.05)>=4.5,'inbox text must meet normal-text contrast');
        for(const settings of [{signedIn:false},{ready:false}]){
          const count=reads.length;await page.evaluate(settings=>window.show('inbox','reporter',settings),settings);await page.waitForFunction(()=>!document.querySelector('[aria-label="بلاغاتي في مافيا"]'));
          assert.equal(reads.length,count,'cached user must not trigger owner API while signed out/not ready');
          await page.evaluate(()=>window.show());await page.getByText('بانتظار المراجعة',{exact:true}).waitFor();
        }
        await page.evaluate(()=>window.show('moderation','moderator'));await page.getByRole('button',{name:'عرض دليل مافيا المخوّل'}).waitFor();
        await page.getByRole('button',{name:'عرض دليل مافيا المخوّل'}).click();await page.getByText('AUTHORIZED_MESSAGE_ONLY',{exact:true}).waitFor();
        for(const secret of ['SECRET_ROLE_MAP','UNAUTHORIZED_HISTORY','NO_AUDIO'])assert.equal((await page.locator('body').innerText()).includes(secret),false);
        assert.equal(await page.locator('audio').count(),0);
        await page.evaluate(()=>window.show('moderation','reporter'));await page.getByRole('heading',{name:'هذه الصفحة غير متاحة لحسابك'}).waitFor();
        assert.equal(await page.getByText('AUTHORIZED_MESSAGE_ONLY',{exact:true}).count(),0);
        await page.evaluate(()=>window.show('moderation','moderator'));await page.getByRole('button',{name:'عرض دليل مافيا المخوّل'}).waitFor();
        await page.getByRole('button',{name:'بدء مراجعة بلاغ مافيا',exact:true}).click();
        let dialog=page.getByRole('dialog');await dialog.locator('textarea').fill('نراجع سياق البلاغ الاصطناعي');await dialog.getByRole('button',{name:'بدء مراجعة بلاغ مافيا',exact:true}).click();
        await page.getByText(/قيد المراجعة/).waitFor();assert.equal((await app.env.DB.prepare('SELECT COUNT(*) n FROM moderation_suspensions').first()).n,0);
        await page.getByRole('button',{name:'إغلاق البلاغ',exact:true}).click();dialog=page.getByRole('dialog');await dialog.locator('textarea').fill('اكتملت مراجعة البلاغ الاصطناعي');await dialog.getByRole('button',{name:'إغلاق البلاغ',exact:true}).click();
        await page.getByText('لا بلاغات في هذه القائمة',{exact:true}).waitFor();await page.evaluate(()=>window.show());await page.getByText('تمت المراجعة',{exact:true}).waitFor();
        // Capture an actual A response, remove its case, switch A→B→A and then
        // deliver the stale A payload. It must not resurrect the deleted case.
        let release,seen;const captured=new Promise(resolve=>{seen=resolve;});let hold=true;
        await page.route('**/api/me/mafia/reports',async route=>{
          if(hold&&route.request().headers().authorization===`Bearer ${users.reporter.token}`){hold=false;const response=await route.fetch();seen();await new Promise(resolve=>{release=resolve;});await route.fulfill({response});}
          else await route.continue();
        });
        await page.getByRole('button',{name:'تحديث البلاغات'}).click();await captured;
        await app.env.DB.batch([app.env.DB.prepare('DELETE FROM mafia_reports WHERE id=?').bind(saved.reportId),app.env.DB.prepare('DELETE FROM social_reports WHERE id=?').bind(saved.reportId)]);
        await saveMafiaReportCase(fixtureEnv,users.other,'123456',{...body,clientId:`${name}-other-case`,targetId:'target-two',category:'cheating'});
        await page.evaluate(()=>window.show('inbox','other'));await page.getByRole('heading',{name:'غش أو تواطؤ'}).waitFor();
        await page.evaluate(()=>window.show());await page.getByText('لم ترسل بلاغات مافيا بعد.',{exact:true}).waitFor();
        const delivered=page.waitForResponse(response=>response.url()===app.url+'/api/me/mafia/reports');release();await delivered;
        assert.equal(await page.getByText('تمت المراجعة',{exact:true}).count(),0);assert.equal((await page.locator('body').innerText()).includes(saved.reportId),false);
        assert.deepEqual(errors,[]);
      }finally{await browser.close();}
    }
    for(const user of Object.values(users))await deleteUser(app.env,user.userId);
  }finally{if(server)await new Promise(resolve=>server.close(resolve));await app.close();}
});

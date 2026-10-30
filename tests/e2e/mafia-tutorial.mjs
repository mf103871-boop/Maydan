// Full local lesson through the shipped app and actual controls. No room,
// provider or native microphone is used. Screenshots are local browser proof.
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {build} from 'esbuild';
import {chromium,webkit} from 'playwright';
import {startLocalServer} from '../../server/local.mjs';
import {createUser} from '../../server/accounts/db.mjs';
import {issueSession} from '../../server/accounts/session.mjs';
import {environmentStorageKey} from '../../src/shared/lib/environment.js';
import {newCredentials} from '../../src/online/client.js';
import {MAFIA_TUTORIAL_SCENARIO_VERSION,MAFIA_TUTORIAL_RULESET_VERSION} from '../../src/games/mafia/tutorial/version.mjs';
import {esbuildOptions,renderHtml,readPkg,mediaVersions} from '../../scripts/lib.mjs';

let web,app,browser,origin,html;
const output=path.resolve(process.env.MAFIA_TUTORIAL_OUTPUT || '.cache/mafia-tutorial-browser');
before(async()=>{
  await mkdir(output,{recursive:true});
  web=http.createServer(async(req,res)=>{
    const pathname=new URL(req.url,'http://local').pathname;
    if(pathname==='/'){res.writeHead(200,{'content-type':'text/html'});res.end(html);return;}
    const file=path.resolve('public','.'+decodeURIComponent(pathname));
    if(file.startsWith(path.resolve('public')+path.sep))try{const data=await readFile(file);const ext=path.extname(file);res.writeHead(200,{'content-type':({'.webp':'image/webp','.png':'image/png','.svg':'image/svg+xml','.mp3':'audio/mpeg','.woff2':'font/woff2','.js':'text/javascript'})[ext]||'application/octet-stream'});res.end(data);return;}catch{}
    res.writeHead(404);res.end();
  });
  await new Promise(resolve=>web.listen(0,'127.0.0.1',resolve));origin=`http://127.0.0.1:${web.address().port}`;
  app=await startLocalServer({port:0,origins:origin,vars:{MAFIA_ENABLED:'1'}});
  process.env.MAYDAN_ROOMS_URL=app.url;
  const pkg=await readPkg();
  const result=await build(esbuildOptions({minify:false,version:pkg.version,media:await mediaVersions()}));
  html=await renderHtml(result.outputFiles.find(file=>file.path.endsWith('.js')).text,{version:pkg.version});
  const engine=process.env.MAFIA_E2E_ENGINE==='webkit'?webkit:chromium;
  browser=await engine.launch(engine===chromium&&process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{});
});
after(async()=>{await browser?.close();await app?.close();if(web?.listening)await new Promise(resolve=>web.close(resolve));});

test('full guest tutorial: real actions, wrong consequence/retry, private resume, responsive controls, zero media/room writes',{timeout:180000},async()=>{
  const context=await browser.newContext({viewport:{width:390,height:844}});
  const page=await context.newPage(),errors=[],writes=[],sockets=[];
  page.on('pageerror',error=>errors.push(error.message));page.on('websocket',socket=>sockets.push(socket.url()));
  page.on('request',request=>{if(!['GET','HEAD','OPTIONS'].includes(request.method()))writes.push({method:request.method(),path:new URL(request.url()).pathname});});
  await context.addInitScript(()=>{window.__tutorialMediaRequests=0;Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:()=>{window.__tutorialMediaRequests++;return Promise.reject(new Error('No real microphone in tutorial'));},enumerateDevices:async()=>[]}});});
  const step=()=>page.locator('[data-lesson-step]').getAttribute('data-lesson-step');
  const expectStep=async value=>page.waitForFunction(want=>document.querySelector('[data-lesson-step]')?.getAttribute('data-lesson-step')===want,value);
  const button=id=>page.locator(`[data-design-id="${id}"]`).filter({visible:true}).first();
  const continueLesson=async expected=>{await button('tutorial-continue').click();await expectStep(expected);};
  const shot=async name=>page.screenshot({path:path.join(output,name+'.png'),fullPage:false});
  const hit=async ids=>page.evaluate(ids=>ids.map(id=>{const elements=[...document.querySelectorAll(`[data-design-id="${id}"]`)];const el=elements.find(e=>e.getBoundingClientRect().width&&e.getBoundingClientRect().height);if(!el)return{id,missing:true};el.scrollIntoView({block:'nearest',inline:'nearest'});const r=el.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2,top=document.elementFromPoint(x,y);return{id,width:r.width,height:r.height,x,y,reachable:x>=0&&x<innerWidth&&y>=0&&y<innerHeight&&Boolean(top&&(el===top||el.contains(top)))};}),ids);
  try{
    await page.goto(origin+'/#/online/mafia');await expectStep('welcome');
    assert.equal(new URL(page.url()).hash,'#/tutorial/mafia');
    await continueLesson('lobby-chat');
    for(const [width,height] of [[390,844],[320,568],[430,932],[844,390]]){
      await page.setViewportSize({width,height});await page.waitForTimeout(120);
      const result=await hit(['message-input','send','ready','start','tutorial-exit','tutorial-help-toggle']);
      assert.ok(result.every(item=>item.reachable),JSON.stringify({width,height,result}));
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'No horizontal overflow');
      await shot(`lobby-${width}x${height}`);
    }
    await page.setViewportSize({width:390,height:490});await button('message-input').focus();
    assert.ok((await hit(['message-input','send','tutorial-exit'])).every(item=>item.reachable),'Synthetic keyboard leaves composer and exit reachable');await shot('keyboard-390x490');await button('message-input').blur();
    await page.setViewportSize({width:390,height:844});
    await button('message-input').fill('مرحبا يا شخصيات التدريب');await button('send').click();await expectStep('lobby-voice');
    await button('voice-join').click();await button('mute').click();await expectStep('lobby-ready');
    assert.equal(await page.locator('[data-mafia-call-controls]').count(),0,'Simulated voice never takes over real call controls');
    await button('ready').click();await expectStep('lobby-start');await button('start').click();await expectStep('role-open');
    await button('role-toggle').click();await expectStep('role-close');await button('role-hide').click();await expectStep('opening');
    await continueLesson('night-1-intro');await continueLesson('night-1-pick');
    // Wrong choice must resolve a real report, then rewind the complete checkpoint.
    await page.locator('[data-design-id="player-seat"]').filter({hasText:'ليان'}).click();await button('ability-submit').click();
    await button('tutorial-retry').waitFor();await shot('wrong-investigation');await button('tutorial-retry').click();await expectStep('night-1-pick');
    await page.locator('[data-design-id="player-seat"]').filter({hasText:'سليم'}).click();await button('ability-submit').click();await expectStep('night-1-result');
    await button('tab.clues').click();await continueLesson('discussion-1');await continueLesson('nomination-1');
    await page.locator('[data-design-id="player-seat"]').filter({hasText:'سليم'}).click();await button('ability-submit').click();await page.getByRole('button',{name:'اعتمد اختياري',exact:true}).click();await expectStep('defense-1');
    await continueLesson('verdict-1');await button('verdict-no').click();await page.getByRole('button',{name:'اعتمد اختياري',exact:true}).click();await button('tutorial-retry').waitFor();await shot('wrong-majority');await button('tutorial-retry').click();await expectStep('verdict-1');
    await button('verdict-yes').click();await page.getByRole('button',{name:'اعتمد اختياري',exact:true}).click();await expectStep('verdict-1-result');
    await button('tutorial-exit').click();await button('tutorial-save-exit').click();await page.waitForURL('**/#/online/mafia');
    await page.goto(origin+'/#/tutorial/mafia');await button('tutorial-resume').click();await expectStep('verdict-1-result');
    await continueLesson('night-2-intro');await continueLesson('night-2-pick');await shot('independent-investigation');
    await page.locator('[data-design-id="player-seat"]').filter({hasText:'مازن'}).click();await button('ability-submit').click();await expectStep('night-2-result');
    await button('tab.clues').click();await continueLesson('discussion-2');await continueLesson('nomination-2');
    await page.locator('[data-design-id="player-seat"]').filter({hasText:'مازن'}).click();await button('ability-submit').click();await page.getByRole('button',{name:'اعتمد اختياري',exact:true}).click();await expectStep('defense-2');await continueLesson('verdict-2');
    await button('verdict-yes').click();await page.getByRole('button',{name:'اعتمد اختياري',exact:true}).click();await expectStep('ending');await shot('ending');
    await continueLesson('quiz-majority');await page.getByRole('button',{name:'أربعة',exact:true}).click();await expectStep('quiz-information');await page.getByRole('button',{name:'لا؛ التمويه قد يضلله والانتماء قد يتغير',exact:true}).click();await expectStep('shadow');
    await continueLesson('encyclopedia');await page.locator('.mafia-tutorial-coach [data-design-id="rules"]').click();await page.getByRole('dialog').getByRole('button',{name:'إغلاق',exact:true}).click();await expectStep('complete');await shot('completed');
    assert.equal(await page.evaluate(()=>window.__tutorialMediaRequests),0);assert.deepEqual(sockets,[]);assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);
    await button('tutorial-finish').click();await page.waitForURL('**/#/online/mafia');await page.reload();await page.waitForTimeout(1800);assert.equal(new URL(page.url()).hash,'#/online/mafia');
    await writeFile(path.join(output,'result.json'),JSON.stringify({passed:true,engine:process.env.MAFIA_E2E_ENGINE||'chromium',errors,writes,sockets,mediaRequests:0,scope:'local whole app guest; no physical iPhone'},null,2));
  }catch(error){await shot('failure');await writeFile(path.join(output,'failure.json'),JSON.stringify({error:error.message,step:await step().catch(()=>null),errors,writes,sockets,text:await page.locator('body').innerText()},null,2));throw error;}finally{await context.close();}
});

test('late signed-in completed status unblocks directory without interrupting it with a repeated tutorial',{timeout:45000},async()=>{
  const user=await createUser(app.env,{name:'متدرّب',email:`${crypto.randomUUID()}@example.test`});const session=await issueSession(app.env,user.id);
  const context=await browser.newContext({viewport:{width:390,height:844}});
  await context.addInitScript(([key,token])=>localStorage.setItem(key,JSON.stringify(token)),[environmentStorageKey('maydan:account:',app.url)+'session',session.token]);
  let read=false;
  await context.route(app.url+'/api/me/tutorials/mafia',async route=>{assert.equal(route.request().method(),'GET');read=true;await new Promise(resolve=>setTimeout(resolve,2300));await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({tutorialId:'mafia',scenarioVersion:MAFIA_TUTORIAL_SCENARIO_VERSION,rulesetVersion:MAFIA_TUTORIAL_RULESET_VERSION,status:'completed',updatedAt:Date.now(),outdated:false})});});
  const page=await context.newPage(),diagnostics={requests:[],errors:[]};page.on('request',request=>{if(request.url().startsWith(app.url))diagnostics.requests.push({path:new URL(request.url()).pathname,method:request.method()});});page.on('pageerror',error=>diagnostics.errors.push(error.message));await page.goto(origin+'/#/online/mafia');
  const started=Date.now();while(!read&&Date.now()-started<15000)await page.waitForTimeout(100);
  if(!read){await page.screenshot({path:path.join(output,'late-status-failure.png')});await writeFile(path.join(output,'late-status-failure.json'),JSON.stringify({...diagnostics,text:await page.locator('body').innerText()},null,2));}
  assert.equal(read,true);await page.waitForTimeout(3200);assert.equal(new URL(page.url()).hash,'#/online/mafia');assert.equal(await page.locator('[data-lesson-step]').count(),0);
  await page.waitForTimeout(1000);assert.equal(new URL(page.url()).hash,'#/online/mafia');await context.close();
});

test('guest lesson continues offline and browser back asks to save instead of discarding decisions',{timeout:45000},async()=>{
  const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage();
  await page.goto(origin+'/#/online/mafia');await page.locator('[data-lesson-step="welcome"]').waitFor();await context.setOffline(true);
  await page.locator('[data-design-id="tutorial-continue"]').click();await page.locator('[data-design-id="message-input"]').fill('تدريب دون إنترنت');await page.locator('[data-design-id="send"]').click();await page.locator('[data-lesson-step="lobby-voice"]').waitFor();
  await page.evaluate(()=>{location.hash='/';});await page.locator('[data-design-id="tutorial-save-exit"]').waitFor();await page.locator('[data-design-id="tutorial-stay"]').click();assert.equal(new URL(page.url()).hash,'#/tutorial/mafia');
  await page.locator('[data-design-id="tutorial-exit"]').click();await page.locator('[data-design-id="tutorial-save-exit"]').click();await page.waitForURL('**/#/online/mafia');
  await page.evaluate(()=>{location.hash='/tutorial/mafia';});await page.locator('[data-design-id="tutorial-resume"]').click();await page.locator('[data-lesson-step="lobby-voice"]').waitFor();
  await context.close();
});

test('a cached signed-in owner resumes locally after API failure without creating guest progress',{timeout:45000},async()=>{
  const user=await createUser(app.env,{name:'صاحب التدريب',email:`${crypto.randomUUID()}@example.test`}),session=await issueSession(app.env,user.id);
  const context=await browser.newContext({viewport:{width:390,height:844}});
  await context.addInitScript(([key,token])=>localStorage.setItem(key,JSON.stringify(token)),[environmentStorageKey('maydan:account:',app.url)+'session',session.token]);
  const page=await context.newPage();await page.goto(origin+'/#/tutorial/mafia');await page.locator('[data-lesson-step="welcome"]').waitFor();
  await page.locator('[data-design-id="tutorial-continue"]').click();await page.locator('[data-design-id="message-input"]').fill('نحفظ القرار لهذا الحساب');await page.locator('[data-design-id="send"]').click();await page.locator('[data-lesson-step="lobby-voice"]').waitFor();
  await page.locator('[data-design-id="tutorial-exit"]').click();await page.locator('[data-design-id="tutorial-save-exit"]').click();await page.waitForURL('**/#/online/mafia');
  await context.route(app.url+'/**',route=>route.abort('internetdisconnected'));
  await page.goto(origin+'/#/tutorial/mafia');await page.reload();await page.locator('[data-design-id="tutorial-resume"]').click();await page.locator('[data-lesson-step="lobby-voice"]').waitFor();
  const records=await page.evaluate(()=>Object.keys(localStorage).filter(key=>key.startsWith('maydan:mafia-tutorial:')).map(key=>JSON.parse(localStorage.getItem(key))));
  assert.equal(records.length,1);assert.equal(records[0].owner,`${app.url}|${user.id}`);assert.ok(records[0].progress.decisions.length>0);
  await page.screenshot({path:path.join(output,'signed-in-api-unavailable-resume.png')});await context.close();
});

test('owned waiting-room restoration and direct invitations bypass first-entry training',{timeout:45000},async()=>{
  const user=await createUser(app.env,{name:'صاحب المجلس',email:`${crypto.randomUUID()}@example.test`}),session=await issueSession(app.env,user.id),seat=newCredentials();
  const response=await fetch(app.url+'/api/rooms',{method:'POST',headers:{origin,authorization:`Bearer ${session.token}`,'content-type':'application/json'},body:JSON.stringify({...seat,name:'صاحب المجلس',avatar:0,game:'mafia',capabilities:{mafia:2},settings:{mode:'classic',capacity:6,visibility:'private',voiceMode:'off'}})});
  assert.equal(response.status,201);const {code}=await response.json();
  const context=await browser.newContext({viewport:{width:390,height:844}});
  await context.addInitScript(({key,token,server,code,seat,owner})=>{localStorage.setItem(key,JSON.stringify(token));for(const [name,value]of [['lastRoom',code],[code,seat],[`roomOwner:${code}`,owner]])localStorage.setItem(`maydan:online:${server}:${name}`,JSON.stringify(value));},{key:environmentStorageKey('maydan:account:',app.url)+'session',token:session.token,server:app.url,code,seat,owner:user.id});
  const page=await context.newPage();await page.goto(origin+'/#/online/mafia');const restore=page.getByRole('button',{name:new RegExp('العودة إلى غرفتي')});await restore.waitFor();assert.equal(await page.locator('[data-lesson-step]').count(),0);await restore.click();await page.locator('[data-design-screen="online.mafia.lobby"]').waitFor();assert.equal(await page.locator('[data-lesson-step]').count(),0);await context.close();
  const invited=await browser.newContext({viewport:{width:390,height:844}}),invitePage=await invited.newPage();await invitePage.goto(origin+'/#/room/'+code);await invitePage.waitForTimeout(1800);assert.equal(new URL(invitePage.url()).hash,'#/room/'+code);assert.equal(await invitePage.locator('[data-lesson-step]').count(),0);await invited.close();
});

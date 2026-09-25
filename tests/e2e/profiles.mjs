// Run after node scripts/build-cloudflare.mjs. Isolated local accounts/database only.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { chromium } from 'playwright';
import { migrationSql } from '../../server/local-d1.mjs';

const temporary=await mkdtemp(path.join(os.tmpdir(),'maydan-profile-e2e-'));
const evidence=path.resolve('.wrangler/profile-e2e');await mkdir(evidence,{recursive:true});
let mf,browser;const pages=[],errors=[],trace=[];
try {
  const scriptPath=path.join(temporary,'worker.mjs');
  await build({entryPoints:['server/full-worker.mjs'],bundle:true,format:'esm',platform:'browser',outfile:scriptPath,logLevel:'silent'});
  mf=new Miniflare(convertV4MiniflareOptions({rootPath:temporary,name:'profile-e2e',modules:true,scriptPath,
    compatibilityDate:'2026-09-01',port:0,host:'127.0.0.1',cf:false,
    durableObjects:{ROOMS:{className:'Room',useSQLite:true},LIMITERS:{className:'RequestLimiter',useSQLite:true},SOCIAL_HUB:{className:'SocialHub',useSQLite:true}},
    d1Databases:{DB:'profile-e2e'},bindings:{AUTH_DEV_FAKE:'1',SESSION_SECRET:'local-profile-e2e-only'},
    assets:{directory:path.resolve('dist'),binding:'ASSETS',assetConfig:{not_found_handling:'single-page-application'},routerConfig:{has_user_worker:true},run_worker_first:['/api','/api/*','/health']},
  }));
  const origin=(await mf.ready).origin;const db=await mf.getD1Database('DB');await db.exec(migrationSql());
  async function api(user,endpoint,method='GET',body,expected=200){
    const response=await fetch(origin+endpoint,{method,headers:{origin,...(user?{authorization:`Bearer ${user.session.token}`} :{}),...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
    const data=await response.json();assert.equal(response.status,expected,JSON.stringify({endpoint,data}));return data;
  }
  const alice=await api(null,'/api/auth/dev','POST',{subject:'profile-alice',name:'ليان'});
  const bob=await api(null,'/api/auth/dev','POST',{subject:'profile-bob',name:'عمر'});
  const initial=(await api(alice,'/api/profiles/me')).profile;const bobInitial=(await api(bob,'/api/profiles/me')).profile;
  assert.match(initial.code,/^MDN-/);assert.deepEqual(initial.earnedBadges,['welcome']);
  await api(null,'/api/profiles/'+initial.id,'GET',undefined,401);
  await api(alice,'/api/profiles/me','PATCH',{stats:{onlineWins:999}},400);
  await api(alice,'/api/profiles/me','PATCH',{selectedTitle:'legend'},403);
  browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:process.platform==='win32'?{executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'}:{})});
  async function pageFor(user,viewport,route='/profile'){
    const context=await browser.newContext({viewport,deviceScaleFactor:1,serviceWorkers:'block'});
    await context.addInitScript(user=>{
      localStorage.setItem('maydan:account:session',JSON.stringify(user.session.token));
      localStorage.setItem('maydan:account:me',JSON.stringify({data:user.me,fetchedAt:Date.now()}));
    },user);
    const page=await context.newPage();pages.push(page);page.on('pageerror',error=>errors.push(error.message));
    page.on('response',response=>{const endpoint=new URL(response.url()).pathname;if(endpoint.startsWith('/api/')){trace.push({endpoint,status:response.status(),method:response.request().method()});if(trace.length>80)trace.shift();}});
    await page.goto(origin+'/#'+route,{waitUntil:'domcontentloaded'});
    await page.locator('.profile-code').waitFor({timeout:30000});return page;
  }
  const a=await pageFor(alice,{width:390,height:844});
  const b=await pageFor(bob,{width:1280,height:900},'/profile/'+initial.id);
  await a.getByRole('button',{name:'تعديل الملف',exact:true}).click();
  await a.getByLabel('الاسم',{exact:true}).fill('ليان الميدان');await a.getByLabel('نبذة عنك',{exact:true}).fill('أحب الأسئلة التي تحتاج إلى تفكير، وجمعة الأصدقاء.');
  await a.getByRole('button',{name:'ليالي البنفسج',exact:true}).click();
  assert.equal(await a.getByLabel('لقبك').locator('option[value="legend"]').evaluate(option=>option.disabled),true);
  const fixture=await sharp({create:{width:1440,height:960,channels:4,background:'#309da4'}}).composite([{input:Buffer.from('<svg width="1440" height="960"><circle cx="720" cy="480" r="330" fill="#f5be67"/><rect x="670" y="130" width="100" height="700" rx="50" fill="#fff9ee"/></svg>')}]).png().toBuffer();
  async function upload(kind, expected=200){
    const chooser=a.waitForEvent('filechooser');await a.getByRole('button',{name:kind==='avatar'?'رفع صورة':'رفع غلاف',exact:true}).click();
    await (await chooser).setFiles({name:'selected-photo.png',mimeType:'image/png',buffer:fixture});
    const crop=a.getByRole('dialog',{name:kind==='avatar'?'ضبط الصورة الشخصية':'ضبط صورة الغلاف',exact:true});await crop.waitFor();
    await crop.getByLabel('تكبير الصورة').fill('1.4');await crop.getByRole('group',{name:/إطار قص/}).press('ArrowLeft');
    const response=a.waitForResponse(r=>new URL(r.url()).pathname==='/api/profiles/me/images/'+kind&&r.request().method()==='PUT');
    await crop.getByRole('button',{name:'حفظ الصورة',exact:true}).click();const saved=await response;assert.equal(saved.status(),expected,await saved.text());
    if(expected!==200){await crop.getByRole('alert').filter({hasText:'تغيّر البروفايل'}).waitFor();await crop.getByRole('button',{name:'إلغاء',exact:true}).click();return null;}
    await crop.waitFor({state:'hidden'});return (await saved.json()).profile;
  }
  const avatar=await upload('avatar');assert.ok(avatar.avatarUrl);
  const cover=await upload('cover');assert.ok(cover.coverUrl);
  const saved=a.waitForResponse(r=>new URL(r.url()).pathname==='/api/profiles/me'&&r.request().method()==='PATCH');
  await a.getByRole('button',{name:'حفظ التغييرات',exact:true}).click();assert.equal((await saved).status(),200);
  await a.getByRole('heading',{name:'ليان الميدان',exact:true}).waitFor();
  const updated=(await api(alice,'/api/profiles/me')).profile;
  assert.equal(updated.code,initial.code);assert.equal(updated.theme,'violet');assert.equal(updated.avatarUrl,avatar.avatarUrl);assert.ok(updated.earnedBadges.includes('identity'));
  for(const [kind,url] of [['avatar',updated.avatarUrl],['cover',updated.coverUrl]]){
    const response=await fetch(origin+url);assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'image/jpeg');assert.equal(response.headers.get('cache-control'),'no-store');
    const bytes=Buffer.from(await response.arrayBuffer());const metadata=await sharp(bytes).metadata();assert.equal(metadata.width/metadata.height,kind==='avatar'?1:3);assert.equal(metadata.exif,undefined);assert.equal(metadata.icc,undefined);assert.equal(metadata.xmp,undefined);
    assert.ok(bytes.length<(kind==='avatar'?96:220)*1024);
  }
  await a.getByRole('button',{name:'تعديل الملف',exact:true}).click();await a.getByLabel('لقبك').selectOption('distinctive');
  await a.locator('.profile-badge-choice').filter({hasText:'هذه شخصيتي'}).click();
  await a.getByRole('button',{name:'حفظ التغييرات',exact:true}).click();await a.getByText('حُفظ ملفك الشخصي.',{exact:true}).waitFor();
  await b.reload({waitUntil:'domcontentloaded'});await b.getByRole('heading',{name:'ليان الميدان',exact:true}).waitFor({timeout:30000});
  await b.getByRole('button',{name:'إضافة صديق',exact:true}).click();await b.getByText('بانتظار قبول الصداقة',{exact:true}).waitFor();
  await a.goto(origin+'/#/profile/'+bobInitial.id);await a.getByRole('button',{name:'قبول الصداقة',exact:true}).click({timeout:15000});
  await a.getByRole('button',{name:'محادثة',exact:true}).waitFor();
  const friends=(await api(alice,'/api/profiles/me')).profile;assert.ok(friends.earnedBadges.includes('first-friend'));assert.equal(friends.friendCount,1);
  await b.reload({waitUntil:'domcontentloaded'});await b.getByRole('button',{name:'محادثة',exact:true}).waitFor({timeout:30000});
  await b.screenshot({path:path.join(evidence,'profile-desktop.png'),fullPage:true});
  await b.getByRole('button',{name:'محادثة',exact:true}).click();await b.locator('.social-chat-head').getByRole('button',{name:'عرض بروفايل ليان الميدان',exact:true}).waitFor();
  assert.ok(await b.locator('.social-chat-head img').count()>0);await b.locator('.social-chat-head').getByRole('button',{name:'عرض بروفايل ليان الميدان',exact:true}).click();
  await b.getByRole('heading',{name:'ليان الميدان',exact:true}).waitFor();
  // The real D1 completion endpoint is idempotent. Only the temporary fixture clock is adjusted.
  const session=await api(alice,'/api/profiles/me/sessions','POST',{game:'beep'});
  await db.prepare('UPDATE player_sessions SET started_at=? WHERE id=?').bind(Date.now()-31000,session.sessionId).run();
  const endpoint='/api/profiles/me/sessions/'+session.sessionId+'/complete';
  assert.equal((await api(alice,endpoint,'POST',{})).counted,true);assert.equal((await api(alice,endpoint,'POST',{})).counted,false);
  const stats=(await api(alice,'/api/profiles/me')).profile;assert.equal(stats.stats.localSessions,1);assert.equal(stats.stats.onlineWins,0);assert.ok(stats.earnedBadges.includes('host'));
  await a.goto(origin+'/#/profile');await a.getByRole('heading',{name:'ليان الميدان',exact:true}).waitFor();
  await a.screenshot({path:path.join(evidence,'profile-mobile.png'),fullPage:true});
  for(const page of [a,b])assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'profile overflow');
  await a.getByRole('button',{name:'تعديل الملف',exact:true}).click();await a.getByRole('button',{name:'إزالة الصورة',exact:true}).click();
  await a.getByText('أُزيلت الصورة الشخصية.',{exact:true}).waitFor();assert.equal((await fetch(origin+updated.avatarUrl)).status,404);
  assert.ok((await api(alice,'/api/profiles/me')).profile.earnedBadges.includes('identity'),'earned badges are permanent');
  await api(alice,'/api/profiles/me','PATCH',{name:'ليان الجديدة'});
  await upload('avatar',409);
  const conflict=a.waitForResponse(r=>new URL(r.url()).pathname==='/api/profiles/me'&&r.request().method()==='PATCH');
  await a.getByRole('button',{name:'حفظ التغييرات',exact:true}).click();assert.equal((await conflict).status(),409);
  assert.equal((await api(alice,'/api/profiles/me')).profile.name,'ليان الجديدة');
  await a.setViewportSize({width:320,height:740});await a.goto(origin+'/#/');
  await a.getByRole('button',{name:'بروفايلي',exact:true}).waitFor();
  assert.equal(await a.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'small phone home overflow');
  await a.getByRole('button',{name:'بروفايلي',exact:true}).click();await a.getByRole('heading',{name:'ليان الجديدة',exact:true}).waitFor();
  await b.goto(origin+'/#/friends');await b.getByRole('button',{name:'إضافة صديق',exact:true}).click();
  await b.getByLabel('ابحث بالاسم أو رمز الصديق').fill(initial.code);
  await b.getByRole('dialog').getByRole('button',{name:'عرض بروفايل ليان الجديدة',exact:true}).click();
  await b.getByRole('heading',{name:'ليان الجديدة',exact:true}).waitFor();
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({ok:true,checks:['account-profile','fixed-code','edit-name-bio-theme','avatar-crop','cover-crop','compressed-jpeg','image-privacy','earned-title','locked-title','profile-friend-request','profile-friend-accept','chat-profile-navigation','idempotent-statistics','delete-image','image-edit-conflict','text-edit-conflict','mobile-layout','desktop-layout'],evidence}));
}catch(error){
  for(const [i,page] of pages.entries()){await page.screenshot({path:path.join(evidence,`failure-${i}.png`),fullPage:true}).catch(()=>{});console.error(JSON.stringify({page:i,text:await page.locator('body').innerText().catch(()=>''),trace,errors}));}throw error;
}finally{await writeFile(path.join(evidence,'requests.json'),JSON.stringify({trace,errors},null,2)+'\n');await browser?.close();await mf?.dispose();await rm(temporary,{recursive:true,force:true});}

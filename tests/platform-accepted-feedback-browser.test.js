// Actual UI handlers and lifecycle; synthetic accounts/server/payment responses and
// an event sink, not StoreKit, human hearing, a real microphone or paid checkout.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { build } from 'esbuild';
import { chromium, webkit } from 'playwright';
import { presentationCssPlugin } from '../scripts/presentation-css.mjs';

for (const [name,engine] of [['chromium',chromium],['webkit',webkit]]) test(`${name}: platform confirmations follow accepted owned UI work; cancel/preview/stale work stay quiet`, { timeout:90_000 }, async t => {
  let bundle;
  const server = http.createServer((req,res) => {
    if (req.url === '/bundle.js') { res.setHeader('content-type','text/javascript');res.end(bundle);return; }
    if (req.url.startsWith('/assets/') || req.url === '/pixel.svg') { res.setHeader('content-type','image/svg+xml');res.end('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#29716c"/></svg>');return; }
    res.setHeader('content-type','text/html;charset=utf-8');res.end('<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script src="/bundle.js"></script></html>');
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections();server.close(resolve); }));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const source = `import React,{useState}from'react';import{createRoot}from'react-dom/client';
  import{ProfileView,ProfileEditor,CropDialog}from'./src/profiles/ProfileScreen.jsx';
  import{Store}from'./src/platform/screens/Store.jsx';import{Paywall}from'./src/shared/account/Paywall.jsx';import{AccountCard}from'./src/shared/account/AccountCard.jsx';
  import{PlatformContext}from'./src/platform/context.js';import{AccountContext,NULL_ACCOUNT}from'./src/shared/account/context.js';import{EMPTY_COSMETICS,PLUS_CATALOG_VERSION}from'./src/plus/catalog.js';
  import tokens from'./src/shared/theme/tokens.css';import ui from'./src/shared/ui/ui.css';
  window.events=[];window.guards=[];window.tasks={};window.requests=[];window.saved=0;window.open=true;window.failReads=false;
  const sound={emit(type,options){window.events.push({type,id:options.id,keys:Object.keys(options).sort()});window.guards.push(options.guard);return true;}};
  const deferred=kind=>new Promise((resolve,reject)=>{window.requests.push(kind);window.tasks[kind]={resolve,reject};});
  window.finish=(kind,value,error)=>{const task=window.tasks[kind];delete window.tasks[kind];error?task.reject(Object.assign(new Error('synthetic rejection'),error)):task.resolve(value);};
  const verified=id=>({user:{id},premium:{until:Date.now()+86400000,source:'apple'}});window.verified=verified;
  const profile=id=>({id,name:'لاعب تجريبي',code:'SYNTHETIC-CODE',bio:'',theme:'turquoise',avatarPreset:'spark',relationship:'self',revision:1,earnedBadges:[],earnedTitles:[],featuredBadges:[],stats:{},cosmetics:{}});
  let row={revision:0,preferred:{...EMPTY_COSMETICS},effective:{...EMPTY_COSMETICS}};
  window.fetch=async url=>{if(String(url).endsWith('/api/cosmetics/catalog'))return new Response(JSON.stringify({version:PLUS_CATALOG_VERSION,serverTime:Date.now()}));throw Error('UNEXPECTED_NETWORK');};
  Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:()=>deferred('clipboard')}});
  Object.defineProperty(navigator,'share',{configurable:true,value:undefined});
  const nativeBlob=HTMLCanvasElement.prototype.toBlob;window.readEnds=0;const nativeRead=FileReader.prototype.readAsDataURL;
  HTMLCanvasElement.prototype.toBlob=function(callback,...args){return nativeBlob.call(this,blob=>{if(window.holdEncode){window.holdEncode=false;window.heldEncode=()=>callback(blob);}else callback(blob);},...args);};
  FileReader.prototype.readAsDataURL=function(...args){this.addEventListener('loadend',()=>window.readEnds++,{once:true});return nativeRead.apply(this,args);};
  document.addEventListener('click',e=>{const b=e.target.closest('button');if(b?.dataset.sound!=='none')window.lastGeneric=b?.dataset.designId||null;else window.lastGeneric=null;});
  function Harness(){const[owner,setOwner]=useState('actor-a'),[screen,setScreen]=useState('profile'),[open,setOpen]=useState(true),[crop,setCrop]=useState(null);window.owner=setOwner;window.display=s=>{setScreen(s);setOpen(true);};window.closePaywall=()=>setOpen(false);
    const p=profile(owner), state=()=>({...row,plusActive:true,ownedItemIds:[],grants:[],serverTime:Date.now()});
    window.prepareCrop=async()=>{const img=new Image();img.src='/pixel.svg';await img.decode();setCrop({kind:'avatar',image:{url:img.src,element:img,width:100,height:100,dispose(){}}});setScreen('crop');};
    const account={...NULL_ACCOUNT,ready:true,signedIn:true,user:{id:owner},premium:true,platform:'ios',productsStatus:'ready',products:{monthly:{id:'plus.monthly',price:'TEST',period:'شهري'}},me:verified(owner),
      refresh:async()=>null,loadProducts:async()=>null,purchase:()=>deferred('purchase'),restore:()=>deferred('restore'),
      requestAuthenticated:async(path,options={})=>{if(path.startsWith('/api/mafia/'))throw Object.assign(Error('disabled'),{code:'NOT_FOUND'});if(options.method==='PATCH'){window.patch=options.body;const ack=await deferred('equip');return ack;}if(window.failReads)throw Object.assign(Error('NETWORK'),{code:'NETWORK'});return state();}};
    window.equipAck=()=>{Object.assign(row.preferred,window.patch.selection);Object.assign(row.effective,window.patch.selection);row.revision++;window.finish('equip',state());};
    const profiles={mine:p,profiles:{[owner]:p},ready:true,loading:{},errors:{},loadProfile:async()=>p,saveProfile:()=>deferred('saveProfile'),removeImage:()=>deferred('removeImage'),uploadImage:(kind,data)=>{window.uploadIsJpeg=data.startsWith('data:image/jpeg;base64,');return deferred('uploadImage');}};
    return <PlatformContext.Provider value={{sound}}><AccountContext.Provider value={account}><div data-test-owner={owner} data-test-screen={screen}><style>{tokens+ui}</style>{screen==='profile'?<ProfileView account={account} profiles={profiles} social={{offline:false}}/>:screen==='editor'?<ProfileEditor profile={p} profiles={profiles} onClose={()=>setScreen('profile')} onSaved={()=>window.saved++}/>:screen==='crop'&&crop?<CropDialog crop={crop} profiles={profiles} ownerId={owner} revision={1} onClose={()=>setScreen('profile')} onDone={()=>window.saved++}/>:screen==='store'?<Store/>:screen==='paywall'?<Paywall open={open} onClose={()=>setOpen(false)}/>:screen==='account'?<AccountCard/>:null}</div></AccountContext.Provider></PlatformContext.Provider>;
  }createRoot(document.getElementById('root')).render(<Harness/>);`;
  const built=await build({stdin:{contents:source,resolveDir:process.cwd(),loader:'jsx'},bundle:true,write:false,format:'iife',jsx:'automatic',plugins:[presentationCssPlugin()],loader:{'.js':'jsx','.css':'text','.webp':'dataurl','.woff2':'dataurl'},define:{__MAYDAN_ROOMS_URL__:JSON.stringify(origin),'process.env.NODE_ENV':'"production"'},logLevel:'silent'});
  bundle=built.outputFiles[0].contents;
  const browser=await engine.launch({headless:true});t.after(()=>browser.close());const page=await browser.newPage({viewport:{width:390,height:844},reducedMotion:'reduce'}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin);await page.locator('[data-design-id=code]').waitFor();
  const events=()=>page.evaluate(()=>window.events.map(x=>x.type));
  const waitTask=key=>page.waitForFunction(k=>!!window.tasks[k],key);
  const settle=async(key,result,error)=>{await page.evaluate(({key,result,error})=>window.finish(key,result,error),{key,result,error});};
  const tick=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));

  // Clipboard completion rather than the press itself, and genuine rejection.
  await page.locator('[data-design-id=code]').click();await waitTask('clipboard');assert.deepEqual(await events(),[]);assert.equal(await page.evaluate(()=>window.lastGeneric),null);
  await settle('clipboard',undefined);await page.waitForFunction(()=>window.events.length===1);assert.deepEqual(await events(),['ui.confirm']);
  await page.locator('[data-design-id=code]').click();await waitTask('clipboard');await settle('clipboard',null,{code:'NETWORK'});await page.waitForFunction(()=>window.events.length===2);assert.deepEqual(await events(),['ui.confirm','ui.error']);
  await page.locator('[data-design-id=code]').click();await waitTask('clipboard');await page.evaluate(()=>window.owner('actor-b'));await tick();await settle('clipboard',undefined);await tick();assert.equal((await events()).length,2);
  await page.evaluate(()=>{Object.defineProperty(navigator,'clipboard',{configurable:true,value:undefined});});await page.locator('[data-design-id=share]').click();await page.locator('[data-design-id=share-link]').waitFor();assert.equal((await events()).length,2,'manual link fallback is not a successful copy');await page.getByRole('dialog').getByRole('button',{name:'إغلاق',exact:true}).click();

  // Save ACK, rejected save, and a response arriving after unmount.
  await page.evaluate(()=>window.display('editor'));await page.getByRole('button',{name:'حفظ التغييرات',exact:true}).click();await waitTask('saveProfile');assert.equal((await events()).length,2);
  await settle('saveProfile',{id:'actor-b',revision:2});await page.waitForFunction(()=>window.saved===1);assert.equal((await events()).at(-1),'ui.confirm');
  await page.evaluate(()=>window.display('profile'));await page.locator('[data-design-id=code]').waitFor();await page.evaluate(()=>window.display('editor'));await page.getByRole('button',{name:'حفظ التغييرات',exact:true}).click();await waitTask('saveProfile');await settle('saveProfile',null,{code:'NETWORK'});await page.getByRole('alert').waitFor();assert.equal((await events()).at(-1),'ui.error');
  await page.getByRole('button',{name:'حفظ التغييرات',exact:true}).click();await waitTask('saveProfile');const beforeUnmount=(await events()).length;await page.evaluate(()=>window.display('profile'));await page.locator('[data-design-id=code]').waitFor();await settle('saveProfile',{id:'actor-b',revision:3});await tick();assert.equal((await events()).length,beforeUnmount);assert.equal(await page.evaluate(()=>window.guards.every(guard=>!guard())),true);

  // Real browser image/canvas/JPEG processing, synthetic upload acceptance.
  await page.evaluate(()=>window.prepareCrop());await page.getByRole('button',{name:'إرسال للمراجعة',exact:true}).click();await waitTask('uploadImage');assert.equal(await page.evaluate(()=>window.uploadIsJpeg),true);assert.equal((await events()).length,beforeUnmount);
  await settle('uploadImage',{id:'actor-b',revision:4,imageReviews:{avatar:{status:'pending'}}});await page.waitForFunction(()=>window.saved===2);assert.equal((await events()).at(-1),'ui.confirm');
  await page.evaluate(()=>window.display('profile'));await page.locator('[data-design-id=code]').waitFor();await page.evaluate(()=>window.prepareCrop());await page.getByRole('button',{name:'إرسال للمراجعة',exact:true}).waitFor();
  const beforeEncodeSwap=(await events()).length,readsBefore=await page.evaluate(()=>window.readEnds);await page.evaluate(()=>{window.holdEncode=true;window.heldEncode=null;});await page.getByRole('button',{name:'إرسال للمراجعة',exact:true}).click();await page.waitForFunction(()=>!!window.heldEncode);await page.evaluate(()=>window.owner('actor-a'));await page.locator('[data-test-owner="actor-a"]').waitFor({state:'attached'});await page.evaluate(()=>window.heldEncode());await page.waitForFunction(n=>window.readEnds>n,readsBefore);await tick();assert.equal(await page.evaluate(()=>!!window.tasks.uploadImage),false,'stale image cannot start an upload under the replacement account');assert.equal((await events()).length,beforeEncodeSwap);
  await page.evaluate(()=>window.owner('actor-b'));await page.locator('[data-test-owner="actor-b"]').waitFor({state:'attached'});

  // Preview stays uncommitted; equip is confirmed even if its later readback fails.
  await page.evaluate(()=>window.display('store'));await page.locator('[data-item-id="artist.frame"] [data-design-id=item-preview]').click();await page.getByRole('dialog').waitFor();const beforePreview=(await events()).length;assert.equal(await page.evaluate(()=>!!window.tasks.equip),false);assert.equal((await events()).length,beforePreview);
  await page.getByRole('dialog').locator('[data-design-id=item-use]').click();await waitTask('equip');assert.equal((await events()).length,beforePreview);await page.evaluate(()=>{window.failReads=true;window.equipAck();});await page.waitForFunction(n=>window.events.length===n+1,beforePreview);await tick();assert.equal((await events()).at(-1),'ui.confirm');assert.equal((await events()).length,beforePreview+1);await page.evaluate(()=>window.failReads=false);

  // A null/pending/cancel result never confirms payment. Only fresh verified owner.
  await page.evaluate(()=>window.display('paywall'));await page.locator('[data-design-id=purchase]').click();await waitTask('purchase');const beforePay=(await events()).length;await settle('purchase',null);await tick();assert.equal((await events()).length,beforePay);
  for(const code of ['PURCHASE_CANCELLED','PURCHASE_PENDING','ACTIVATION_PENDING']){await page.locator('[data-design-id=purchase]').click();await waitTask('purchase');await settle('purchase',null,{code});await tick();assert.equal((await events()).length,beforePay);}
  await page.locator('[data-design-id=purchase]').click();await waitTask('purchase');await settle('purchase',{user:{id:'actor-b'},premium:{active:true,until:0}});await tick();assert.equal((await events()).length,beforePay,'active flag alone is not verified entitlement');
  await page.locator('[data-design-id=purchase]').click();await waitTask('purchase');await page.evaluate(()=>window.finish('purchase',window.verified('actor-a')));await tick();assert.equal((await events()).length,beforePay,'another account entitlement cannot confirm this purchase');
  await page.locator('[data-design-id=purchase]').click();await waitTask('purchase');await page.evaluate(()=>window.finish('purchase',window.verified('actor-b')));await page.waitForFunction(n=>window.events.length===n+1,beforePay);assert.equal((await events()).at(-1),'ui.confirm');
  await page.locator('[data-design-id=restore]').click();await waitTask('restore');const beforeClosed=(await events()).length;await page.evaluate(()=>window.closePaywall());await page.getByRole('dialog').waitFor({state:'hidden'});await page.evaluate(()=>window.finish('restore',window.verified('actor-b')));await tick();assert.equal((await events()).length,beforeClosed);
  await page.evaluate(()=>window.display('account'));await page.locator('[data-design-id=restore]').click();await waitTask('restore');await page.evaluate(()=>window.finish('restore',window.verified('actor-b')));await page.waitForFunction(n=>window.events.length===n+1,beforeClosed);assert.equal((await events()).at(-1),'ui.confirm');
  await page.locator('[data-design-id=restore]').click();await waitTask('restore');const beforeSwap=(await events()).length;await page.evaluate(()=>window.owner('actor-a'));await tick();await page.evaluate(()=>window.finish('restore',window.verified('actor-b')));await tick();assert.equal((await events()).length,beforeSwap);
  const records=await page.evaluate(()=>window.events);assert.equal(new Set(records.map(x=>x.id)).size,records.length);assert.ok(records.every(x=>/^accepted:\d+$/.test(x.id)));assert.ok(records.every(x=>JSON.stringify(x).includes('actor-')===false));assert.deepEqual(errors,[]);
});

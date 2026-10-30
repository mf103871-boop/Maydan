import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { chromium, webkit } from 'playwright';
import { GAME_PROTOCOLS } from '../src/online/shared.js';

let server, origin, bytes;
before(async () => {
  server = createServer((req, res) => {
    if (req.url === '/bundle.js') { res.setHeader('content-type', 'text/javascript'); res.end(bytes); return; }
    if (new URL(req.url, 'http://local').pathname !== '/') { res.writeHead(204); res.end(); return; }
    res.setHeader('content-type', 'text/html;charset=utf-8');
    res.end('<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><div id="root"></div><script src="/bundle.js"></script></html>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  const source = `import React,{useState}from'react';import{createRoot}from'react-dom/client';import{flushSync}from'react-dom';import{Online}from'./src/online/Online.jsx';import{AccountContext,NULL_ACCOUNT}from'./src/shared/account/context.js';import{PlatformContext}from'./src/platform/context.js';
    const server=${JSON.stringify(origin)},noop=()=>{},params=new URLSearchParams(location.search),initialOwner=params.has('guest')?null:'account-a';
    window.sent=[];window.closes=0;window.fetch=async()=>new Response(JSON.stringify({enabled:true,rooms:[]}),{headers:{'content-type':'application/json'}});
    const now=Date.now();const room={game:'fabraka',protocol:${GAME_PROTOCOLS.fabraka},code:'123456',revision:1,serverNow:now,expiresAt:now+3600000,hostId:'seat-a',hostMissingSince:null,phase:'write',matchId:1,round:1,rounds:5,deadlineAt:now+60000,reason:null,directory:{visibility:'public',name:'غرفة عامة'},settings:{mode:'friends',finalDouble:false},members:[{id:'seat-a',name:'صاحب المقعد',avatar:0,color:'#118d96',connected:true,ready:true,left:false,score:0,stats:{}},{id:'seat-other',name:'لاعب آخر',avatar:1,color:'#9250bd',connected:true,ready:true,left:false,score:0,stats:{}}],participants:['seat-a','seat-other'],question:{text:'سؤال عام'},truthHostId:'seat-a',myTruth:'PRIVATE_OWNER_A_TRUTH',mySubmission:{submitted:false},myVote:{submitted:false},writerCount:1,writingCount:0,options:[],history:[],truthWriters:[]};
    room.directory.visibility=params.get('visibility')||'public';
    window.WebSocket=class{constructor(){this.readyState=0;window.repeatOldState=()=>this.onmessage?.({data:JSON.stringify({type:'state',state:room})});setTimeout(()=>{this.readyState=1;this.onopen?.();},0);}send(raw){window.sent.push(raw);if(raw==='ping'){queueMicrotask(()=>this.onmessage?.({data:'pong'}));return;}const message=JSON.parse(raw);if(message.type==='auth')queueMicrotask(()=>this.onmessage?.({data:JSON.stringify({type:'state',state:room})}));}close(){if(this.readyState===3)return;this.readyState=3;window.closes++;this.onclose?.({code:1000,reason:'closed'});}};
    localStorage.setItem('maydan:online:'+server+':123456',JSON.stringify({id:'seat-a',token:'synthetic-seat-token'}));if(initialOwner)localStorage.setItem('maydan:online:'+server+':roomOwner:123456',JSON.stringify(initialOwner));else localStorage.removeItem('maydan:online:'+server+':roomOwner:123456');
    const sound={emit:noop,music:{scene:noop,releaseScene:noop}},platform={toast:noop,sound,haptics:{vibrate:noop},confetti:{fire:noop}};
    function App(){const[owner,setOwner]=useState(initialOwner);window.changeOwner=value=>{flushSync(()=>setOwner(value));window.secretAfterOwnerChange=document.body.textContent.includes('PRIVATE_OWNER_A_TRUTH');};const account={...NULL_ACCOUNT,ready:true,signedIn:!!owner,user:owner?{id:owner,name:owner}:null,authHeaders:()=>owner?{Authorization:'Bearer synthetic-'+owner}:{}};return <PlatformContext.Provider value={platform}><AccountContext.Provider value={account}><Online code='123456' game='fabraka'/></AccountContext.Provider></PlatformContext.Provider>;}createRoot(document.getElementById('root')).render(<App/>);`;
  const result = await build({ stdin: { contents: source, resolveDir: process.cwd(), loader: 'jsx' }, bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.js': 'jsx', '.css': 'text', '.webp': 'dataurl', '.woff2': 'dataurl' }, define: { __MAYDAN_ROOMS_URL__: JSON.stringify(origin), 'process.env.NODE_ENV': JSON.stringify('production') }, logLevel: 'silent' });
  bytes = result.outputFiles[0].contents;
});
after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });

for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]]) {
  test(`actual Online ${name} masks public-room private data synchronously on account switch`, async () => {
    const browser = await engine.launch({ headless: true }), page = await browser.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
      for (const visibility of ['public', 'private']) for (const owner of ['account-b', null]) {
        await page.goto(origin + '?visibility=' + visibility);
        await page.getByText(/PRIVATE_OWNER_A_TRUTH/).waitFor();
        assert.equal(await page.evaluate(() => window.closes), 0);
        await page.evaluate(value => window.changeOwner(value), owner);
        assert.equal(await page.evaluate(() => window.secretAfterOwnerChange), false, 'A private truth must not survive a different account or logout');
        await page.waitForFunction(() => window.closes > 0);
        assert.equal(await page.evaluate(() => localStorage.getItem('maydan:online:' + location.origin + ':roomOwner:123456')), null, 'clearing the old seat also clears its account-owner marker');
        await page.evaluate(() => window.repeatOldState());
        assert.equal((await page.locator('body').textContent()).includes('PRIVATE_OWNER_A_TRUTH'), false, 'late frames cannot restore the old private room');
        assert.equal(await page.locator('.room-reactions').count(), 0, 'old-seat commands leave with the private room view');
      }
      await page.goto(origin + '?visibility=private&guest=1');
      await page.getByText(/PRIVATE_OWNER_A_TRUTH/).waitFor();
      await page.evaluate(() => window.changeOwner('account-b'));
      assert.equal(await page.evaluate(() => window.secretAfterOwnerChange), true, 'a genuinely anonymous private seat remains usable when its guest signs in');
      assert.equal(await page.evaluate(() => window.closes), 0);
      assert.deepEqual(errors, []);
    } finally { await browser.close(); }
  });
}

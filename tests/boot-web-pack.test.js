import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { chromium, webkit } from 'playwright';
import { ROOT, renderServiceWorker } from '../scripts/lib.mjs';
import { writeWebGamePack } from '../scripts/lib/web-game-pack.mjs';
import { isPackFile, parsePack } from '../src/boot/pack-format.js';

test('only shipped resources can enter the inventory', () => {
  for (const file of ['/media/p.webp','../media/p.webp','media/%2e%2e/f.png','api/profile.json','pay.html',
    'pricing/policy.js','server/data/ersomha/private.json','audio/candidates/sample.wav','audio-warmth-preview/master.wav',
    'assets/.env.json','https://example.org/media/p.webp','studio/index.html','game-pack/digest.json','_headers'])
    assert.equal(isPackFile(file), false, file);
  assert.equal(isPackFile('opening/maydan-bulb.webp'), true);
  assert.throws(() => parsePack({ schema:1, id:'a', files:[] }, 'a'));
});

for (const engine of [chromium, webkit]) test(engine.name() + ' full pack survives retry, byte corruption, offline ranges, and an update with an open tab', { timeout: 120000 }, async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'maydan-boot-pack-fixture-'));
  const outdir = path.join(root, 'out');
  await mkdir(path.join(root, 'public', 'opening'), {recursive:true});
  await mkdir(path.join(root, 'media'), {recursive:true});
  await mkdir(path.join(outdir, 'opening'), {recursive:true});
  await mkdir(path.join(outdir, 'media'), {recursive:true});
  const put = async (dir, file, body) => { await writeFile(path.join(dir, file), body); };
  await put(path.join(root, 'public'), 'opening/mask.webp', 'small-art');
  await put(outdir, 'opening/mask.webp', 'small-art');
  await put(path.join(root, 'public'), 'opening/team.webp', 'other-art');
  await put(outdir, 'opening/team.webp', 'other-art');
  const movie = process.version.repeat(64);
  await put(path.join(root, 'media'), 'voice.mp4', movie);
  await put(outdir, 'media/voice.mp4', movie);
  await put(outdir, 'unexpected.json', 'stale output');
  const worker = await readFile(path.join(ROOT,'public/sw.js'),'utf8');
  const boot = (await build({stdin:{contents:"import {prepareWebPack} from './src/boot/web-pack.js';window.prepare = prepareWebPack;",resolveDir:ROOT},
    write:false, bundle:true, minify:true})).outputFiles[0].text;
  const release = revision => writeWebGamePack({root,outdir,outputs:[],worker,includePackTransport:true,
    template:'<!doctype html><meta charset=utf-8><head><title>Pack '+revision+'</title></head><script>'+boot+'</script>',
    renderWorker:(source, manifest)=>renderServiceWorker(source,{id:'r'+revision, manifest})});
  const pack = await release(1);
  const inventory = JSON.parse(await readFile(path.join(outdir,pack.manifest)));
  assert.equal(inventory.totalFiles,5);
  assert.equal(inventory.files.some(f=>f.file==='unexpected.json'),false);
  for(const entry of inventory.files) {
    const bytes=await readFile(path.join(outdir,entry.file));
    assert.equal(createHash('sha256').update(bytes).digest('hex'),entry.sha256);
  }
  assert.equal(inventory.transport, 'chunks-v1');
  const movieIndex = inventory.files.findIndex(item => item.file === 'media/voice.mp4');
  const movieGroup = inventory.chunks.find(chunk => chunk.first === movieIndex);
  const download = 'game-pack/download/' + movieGroup.sha256 + '.bin';
  const artStart = inventory.files.findIndex(entry => entry.file === 'opening/mask.webp');
  const artGroup = inventory.chunks.find(chunk => chunk.first === artStart);
  const unavailableDownload = 'game-pack/download/' + artGroup.sha256 + '.bin';
  let offline = false, failMovie = true, corruptMovie = false;
  const reads = [];
  const server=createServer(async (req,res)=>{
    if(offline){res.destroy();return;}
    const url=new URL(req.url,'http://localhost');
    let file=url.pathname.slice('/game/'.length);
    if(!file)file='index.html';
    if(req.headers['x-maydan-pack-read'])reads.push(file);
    if(file===download && failMovie){res.writeHead(503).end();return;}
    if(file===unavailableDownload){res.writeHead(404).end();return;}
    if(file==='api/player'||file==='assets/uncatalogued.json'){res.setHeader('content-type','application/json');res.end('{"player":7}');return;}
    try{
      const bytes=await readFile(path.join(outdir,file));
      if (file===download && corruptMovie) bytes[0] ^= 1;
      const types={'.js':'text/javascript','.json':'application/json','.html':'text/html','.mp4':'video/mp4','.webp':'image/webp'};
      res.setHeader('content-type',types[path.extname(file)]||'text/plain');
      res.setHeader('cache-control','no-store');
      res.end(bytes);
    }catch{res.writeHead(404).end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>{server.closeAllConnections();return new Promise(resolve=>server.close(resolve));});
  const browser=await engine.launch();
  t.after(()=>browser.close());
  const context=await browser.newContext();
  const page=await context.newPage();
  const base='http://127.0.0.1:'+server.address().port+'/game/';
  await page.goto(base);
  const attempt=()=>page.evaluate(async()=>{try{return await window.prepare();}catch(error){return error.code;}});
  assert.equal(await attempt(),'network');
  failMovie=false;
  corruptMovie=true;
  assert.equal(await attempt(),'integrity');
  corruptMovie=false;
  const ready=await attempt();
  assert.equal(ready.completedFiles,5);
  assert.ok(reads.includes(download));
  assert.ok(!reads.includes('media/voice.mp4'));
  assert.ok(reads.includes(unavailableDownload) && reads.includes('opening/mask.webp'));
  const warm=await attempt();
  assert.equal(warm.cachedBytes,inventory.totalBytes);
  const reopened = await page.evaluate(async () => {
    const sw = navigator.serviceWorker;
    const post = ServiceWorker.prototype.postMessage;
    let requests = 0, resumeRegistration;
    const registered = await sw.getRegistration();
    const checking = [];
    // Hold the update check and lose the first request. No controllerchange
    // follows on a warm reopen; the current worker must acknowledge a retry.
    sw.register = () => new Promise(resolve => { resumeRegistration = () => resolve(registered); });
    ServiceWorker.prototype.postMessage = function (message, transfer) {
      if (message.type === 'maydan-pack-client' && ++requests === 1) return;
      return post.call(this, message, transfer);
    };
    const stop = new AbortController();
    const deadline = setTimeout(() => stop.abort(), 8000);
    try {
      const result = await window.prepare({ signal: stop.signal, onProgress: progress => checking.push(progress) });
      return { result, requests, checking };
    } finally {
      clearTimeout(deadline);
      delete sw.register;
      ServiceWorker.prototype.postMessage = post;
      resumeRegistration?.();
    }
  });
  assert.ok(reopened.requests >= 2);
  assert.equal(reopened.result.cachedBytes, inventory.totalBytes);
  assert.equal(reopened.checking.at(-1).phase, 'ready');
  assert.equal(reopened.checking.at(-1).completedFiles, inventory.totalFiles);
  const art=inventory.files.find(item=>item.file==='opening/mask.webp');
  const n=inventory.files.indexOf(art);
  const group=inventory.chunks.find(c=>c.first<=n && c.first+c.count>n);
  assert.equal(group.count,2);
  const oldKey=base+'game-pack/chunks/'+group.sha256;
  await page.evaluate(async ({base,oldKey})=>{
    const cache=await caches.open('maydan-game-files:'+base);
    const bytes=new Uint8Array(await (await cache.match(oldKey)).arrayBuffer());
    bytes[0]^=1;
    await cache.put(oldKey,new Response(bytes));
  },{base,oldKey});
  reads.length=0;
  const fixed=await attempt();
  assert.equal(fixed.cachedBytes,inventory.totalBytes-art.bytes);
  assert.deepEqual(reads,[art.file]);
  assert.deepEqual(await page.evaluate(async()=> (await fetch('api/player')).json()),{player:7});
  await page.evaluate(async()=>{
    await (await fetch('assets/uncatalogued.json')).text();
    await (await fetch('opening/mask.webp?account=private')).text();
  });
  offline=true;
  await page.reload({waitUntil:'domcontentloaded'});
  assert.equal((await attempt()).cachedBytes, inventory.totalBytes);
  const slice=await page.evaluate(async()=>{
    const r=await fetch('media/voice.mp4',{headers:{range:'bytes=3-8'}});
    return [r.status,await r.text()];
  });
  assert.deepEqual(slice,[206,movie.slice(3,9)]);
  assert.equal(await page.evaluate(async()=>{try{await fetch('api/player');return true;}catch{return false;}}),false);
  for (const url of ['assets/uncatalogued.json','opening/mask.webp?account=private']) {
    assert.equal(await page.evaluate(async file=>Boolean(await caches.match(new URL(file,document.baseURI))),url),false);
  }
  offline=false;
  await put(path.join(root,'public'),'opening/mask.webp','new-art');
  await put(outdir,'opening/mask.webp','new-art');
  const next=await release(2);
  assert.notEqual(next.manifest,pack.manifest);
  await page.evaluate(async()=>{const sw=navigator.serviceWorker;
    const updated=new Promise(resolve=>sw.addEventListener('controllerchange',resolve,{once:true}));
    await (await sw.getRegistration()).update();
    await updated;
  });
  assert.equal(await page.evaluate(async()=> (await fetch('opening/mask.webp')).text()),'small-art');
  const fresh=await page.context().newPage();
  await fresh.goto(base);
  const updated=await fresh.evaluate(()=>window.prepare());
  assert.ok(updated.cachedBytes>=movie.length);
  assert.equal(await fresh.evaluate(async()=> (await fetch('opening/mask.webp')).text()),'new-art');
  assert.equal(await page.title(),'Pack 1');
  await fresh.evaluate(async ({base,manifest}) => {
    const index=await caches.open('maydan-game-index:'+base);
    const url=new URL(manifest,base);
    const saved=await index.match(url);
    await index.put(url,new Response(await saved.text(),{headers:{'x-maydan-saved-at':'1'}}));
  },{base,manifest:pack.manifest});
  await fresh.evaluate(()=>window.prepare());
  assert.equal(await page.evaluate(async()=> (await fetch('opening/mask.webp')).text()),'small-art');
  await page.close();
  await fresh.evaluate(()=>window.prepare());
  await fresh.waitForFunction(async ({base,manifest}) => {
    const index=await caches.open('maydan-game-index:'+base);
    return !await index.match(new URL(manifest,base));
  },{base,manifest:pack.manifest});
  assert.equal(await fresh.evaluate(async ({base,oldKey})=>Boolean(await (await caches.open('maydan-game-files:'+base)).match(oldKey)),
    {base,oldKey}),false);
});

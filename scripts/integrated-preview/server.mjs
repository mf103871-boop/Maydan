// A real local application and local HTTP/WS services. Never build or serve dist.
// No provider keys, remote migrations, real purchases, or hosted release paths.
import path from 'node:path';
import { readFile, realpath, stat } from 'node:fs/promises';
import { watch } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { ROOT, esbuildOptions, renderHtml, mediaVersions } from '../lib.mjs';
import { startPlusPreview } from '../plus-preview.mjs';
import { localAudioManifestFiles } from '../audio-review/server.mjs';
const DEFAULT_ASSETS='C:/Users/user/Documents/Codex/2026-10-01/new-chat/outputs/maydan-warmth-20261103/assets';
const TYPES={'.js':'text/javascript','.css':'text/css','.webp':'image/webp','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.woff2':'font/woff2','.mp3':'audio/mpeg','.m4a':'audio/mp4','.wav':'audio/wav','.ogg':'audio/ogg','.json':'application/json'};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const confined=(root,file)=>{const relative=path.relative(root,file);return relative!==''&&!relative.startsWith('..')&&!path.isAbsolute(relative);};
export async function startIntegratedPreview({port=4186,apiPort=8796,assetRoot=DEFAULT_ASSETS,watchSource=true}={}) {
  const audioRoot=await realpath(assetRoot), manifestBytes=await readFile(path.join(audioRoot,'manifest.json')),pack=JSON.parse(manifestBytes),registered=localAudioManifestFiles(pack);
  const outRoot=path.join(ROOT,'.cache/integrated-preview');
  const publicRoot=await realpath(path.join(ROOT,'public')),mediaRoot=await realpath(path.join(ROOT,'media'));
  let outputs=new Map(),html='',fixtureHtml='',revision=0,buildError=null,building=null,dirty=false;
  async function rebuild(){
    dirty=true;if(building)return building;
    building=(async()=>{while(dirty){dirty=false;try{
      const options=esbuildOptions({minify:false,version:'1.9-local-integrated',media:await mediaVersions(ROOT),assets:'files'});
      const result=await build({...options,entryPoints:[path.join(ROOT,'scripts/integrated-preview/entry.jsx')],outfile:path.join(outRoot,'bundle.js'),write:false,
        define:{...options.define,__MAYDAN_UI_PREVIEW__:'true',__MAYDAN_LOCAL_AUDIO_REVIEW__:'true',__MAYDAN_AUDIO_PREVIEW__:'false',__MAYDAN_ROOMS_URL__:'"same-origin"'}});
      const next=new Map(result.outputFiles.map(f=>['/'+path.relative(outRoot,f.path).split(path.sep).join('/'),f.contents]));
      const nextHtml=await renderHtml(result.outputFiles.find(f=>f.path.endsWith('/bundle.js')||f.path.endsWith('\\bundle.js')).text,{version:'1.9 · معاينة محلية',assets:[...next.keys()].filter(n=>n!=='/bundle.js').map(n=>'.'+n)});
      const fixture=await build({...options,entryPoints:[path.join(ROOT,'scripts/integrated-preview/fixtures.jsx')],outfile:path.join(outRoot,'fixtures.js'),write:false,define:{...options.define,__MAYDAN_UI_PREVIEW__:'true',__MAYDAN_LOCAL_AUDIO_REVIEW__:'false',__MAYDAN_AUDIO_PREVIEW__:'false',__MAYDAN_ROOMS_URL__:'"same-origin"'}});
      for(const f of fixture.outputFiles)next.set('/'+path.relative(outRoot,f.path).split(path.sep).join('/'),f.contents);
      const fixtureJs=fixture.outputFiles.find(f=>f.path.endsWith('fixtures.js')).text;
      const nextFixture=await renderHtml(fixtureJs,{version:'QA-local',assets:[]});
      outputs=next;html=nextHtml;fixtureHtml=nextFixture;revision++;buildError=null;console.log(`[integrated] built ${revision}`);
    }catch(error){buildError=error.message;console.error('[integrated] build failed:',error.message);}}})().finally(()=>building=null);
    return building;
  }
  await rebuild();if(!html)throw Error(buildError||'Integrated build failed');
  function send(req,res,bytes,type){
    const headers={'content-type':type,'cache-control':'no-store','x-content-type-options':'nosniff','x-maydan-preview':'local-integrated'};
    // Media ranges are essential for Safari's streamed audio.
    if(type.startsWith('audio/')&&req.headers.range){
      const m=/^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
      const start=m&&m[1]?Number(m[1]):m&&m[2]?Math.max(0,bytes.length-Number(m[2])):NaN;
      const end=m&&m[1]&&m[2]?Math.min(bytes.length-1,Number(m[2])):bytes.length-1;
      if(!Number.isSafeInteger(start)||start<0||start>end){res.writeHead(416,{...headers,'content-range':`bytes */${bytes.length}`});res.end();return;}
      res.writeHead(206,{...headers,'accept-ranges':'bytes','content-range':`bytes ${start}-${end}/${bytes.length}`,'content-length':end-start+1});res.end(req.method==='HEAD'?undefined:bytes.subarray(start,end+1));return;
    }
    res.writeHead(200,{...headers,'content-length':bytes.length,...(type.startsWith('audio/')?{'accept-ranges':'bytes'}:{})});res.end(req.method==='HEAD'?undefined:bytes);
  }
  const hook=async({req,res,url,json})=>{
    // Reject cross-site reads/writes too; the inherited server checks Host and Origin.
    if(req.headers['sec-fetch-site']==='cross-site'){json(res,{error:'LOCAL_ONLY'},403);return true;}
    if(!['GET','HEAD'].includes(req.method)){
      if(url.pathname.startsWith('/api/')||url.pathname.startsWith('/__preview__/')||url.pathname.startsWith('/__plus_lab__/'))return false;
      res.setHeader('allow','GET, HEAD');json(res,{error:'METHOD_NOT_ALLOWED'},405);return true;
    }
    if(url.pathname==='/__integrated__/status'){json(res,{localOnly:true,revision,buildError,building:!!building,realProviderVoice:false,realPayments:false,choice:'bossaAlternative',manifestSHA256:sha(manifestBytes)});return true;}
    const pathname=decodeURIComponent(url.pathname);
    if(pathname.includes('\\')||pathname.includes('\0')){json(res,{error:'INVALID_PATH'},400);return true;}
    if(pathname==='/audio-preview/manifest.json'){send(req,res,manifestBytes,'application/json');return true;}
    if(pathname==='/__integrated__/fixtures/'){send(req,res,Buffer.from(fixtureHtml.replace('<head>','<head><base href="/">')),'text/html;charset=utf-8');return true;}
    if(pathname==='/__integrated__/progress/'){send(req,res,await readFile(path.join(ROOT,'scripts/integrated-preview/progress.html')),'text/html;charset=utf-8');return true;}
    if(['/pricing/','/refunds/'].includes(pathname)){send(req,res,await readFile(path.join(publicRoot,pathname.slice(1),'index.html')),'text/html;charset=utf-8');return true;}
    if(pathname.startsWith('/audio-preview/')){
      const key=pathname.slice('/audio-preview/'.length),entry=registered.get(key);
      if(!entry){json(res,{error:'UNREGISTERED_AUDIO'},404);return true;}
      const file=await realpath(path.join(audioRoot,key));if(!confined(audioRoot,file))throw Error('Invalid audio path');
      const bytes=await readFile(file);if(sha(bytes)!==entry.sha256||entry.bytes!==undefined&&bytes.length!==entry.bytes)throw Error('Audio hash mismatch');
      send(req,res,bytes,TYPES[path.extname(file)]);return true;
    }
    if(pathname==='/'||pathname==='/index.html'||pathname==='/__preview__/scene'){
      if(building)await building;
      send(req,res,Buffer.from(pathname==='/'?html:html.replace('<head>','<head><base href="/">')),'text/html;charset=utf-8');return true;
    }
    if(outputs.has(pathname)){send(req,res,outputs.get(pathname),TYPES[path.extname(pathname)]||'application/octet-stream');return true;}
    if(/^\/(assets|media|audio|art)\/[a-zA-Z0-9/_.-]+$/.test(pathname)){
      for(const base of [publicRoot,...(pathname.startsWith('/media/')?[mediaRoot]:[])]){
        const relative=base===mediaRoot?pathname.slice('/media/'.length):'.'+pathname;
        try{const file=await realpath(path.join(base,relative));if(!confined(base,file))continue;const info=await stat(file);if(!info.isFile())continue;send(req,res,await readFile(file),TYPES[path.extname(file)]||'application/octet-stream');return true;}catch(error){if(error.code!=='ENOENT')throw error;}
      }
      json(res,{error:'LOCAL_ASSET_MISSING'},404);return true;
    }
    // Only API/explicit local review routes may reach the existing service.
    if(pathname==='/sw.js'||pathname==='/health'||pathname.startsWith('/api/')||pathname.startsWith('/__preview__/')||pathname.startsWith('/__plus_lab__/'))return false;
    json(res,{error:'LOCAL_ROUTE_NOT_FOUND'},404);return true;
  };
  const app=await startPlusPreview({port,apiPort,build:false,watchSource:false,requestHook:hook});
  let timer;const watchers=[];
  if(watchSource)for(const folder of ['src','scripts/integrated-preview'])watchers.push(watch(path.join(ROOT,folder),{recursive:true},()=>{clearTimeout(timer);timer=setTimeout(()=>void rebuild(),500);}));
  return {...app,url:`http://127.0.0.1:${port}/`,rebuild,close:async()=>{clearTimeout(timer);for(const w of watchers)w.close();await app.close();}};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const app=await startIntegratedPreview();console.log(`[integrated] ${app.url} — actual game + isolated local services + candidate audio; no remote providers.`);
  for(const s of ['SIGINT','SIGTERM'])process.once(s,async()=>{await app.close();process.exit(0);});
}

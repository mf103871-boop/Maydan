// A separate loopback-only authoring entry. Never imported by the game/release.
import http from 'node:http';
import path from 'node:path';
import {readFile,realpath,stat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
import {esbuildOptions,ROOT} from '../lib.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const DEFAULT_ASSETS='C:/Users/user/Documents/Codex/2026-10-01/new-chat/outputs/maydan-audio-rebuild-20261102/assets';
const PREFIX='/audio-lab/';
export function localAudioRequestAllowed(req,port){
  const hosts=new Set([`127.0.0.1:${port}`,`localhost:${port}`,`[::1]:${port}`]);
  if(!hosts.has(req.headers.host)||req.headers['sec-fetch-site']==='cross-site')return false;
  if(!req.headers.origin)return true;
  try{const url=new URL(req.headers.origin);return url.protocol==='http:'&&hosts.has(url.host);}catch{return false;}
}
const mediaType=file=>file.endsWith('.mp3')?'audio/mpeg':file.endsWith('.wav')?'audio/wav':'audio/mp4';
export function localAudioManifestFiles(pack){
  if(pack?.schemaVersion!==1||pack.localPreviewOnly!==true||pack.productionActivated!==false||pack.approval?.listeningApproved!==false||pack.approval?.productionApproved!==false)throw Error('The lab accepts pending local candidates only');
  const files=new Map();
  const add=(url,entry,comparison=false)=>{
    const sizeValid=comparison&&entry.bytes===undefined||Number.isSafeInteger(entry.bytes)&&entry.bytes>0&&entry.bytes<=64*1024*1024;
    if(!/^(audio|originals|current-runtime)\/[a-z\d/_-]+\.(m4a|mp3|wav)$/.test(url||'')||url.includes('..')||!sizeValid||!/^[a-f\d]{64}$/.test(entry.sha256||''))throw Error('Invalid local audio manifest file');
    const old=files.get(url);if(old&&(old.sha256!==entry.sha256||old.bytes!==entry.bytes))throw Error('Conflicting local media file');files.set(url,{...entry,url});
  };
  for(const asset of Object.values(pack.assets||{})){add(asset.file?.url,asset.file);add(asset.source?.url,asset.source);}
  for(const item of [...Object.values(pack.comparison?.cues||{}),...Object.values(pack.comparison?.music||{})])if(item.available)add(item.url,item,true);
  return files;
}
export async function startAudioReview({port=4184,assetRoot=DEFAULT_ASSETS}={}){
  const folder=await realpath(assetRoot),pack=JSON.parse(await readFile(path.join(folder,'manifest.json'),'utf8'));
  const files=localAudioManifestFiles(pack),cache=new Map(),aliases=new Map();
  for(const item of [...Object.values(pack.comparison?.cues||{}),...Object.values(pack.comparison?.music||{})])if(item.available)aliases.set(PREFIX+item.repositoryUrl,item.url);
  async function verified(url){
    const item=files.get(url);if(!item)throw Error('Media is not registered');
    const file=await realpath(path.join(folder,url)),relative=path.relative(folder,file);
    if(relative.startsWith('..')||path.isAbsolute(relative))throw Error('Media escaped local assets');
    const info=await stat(file),cached=cache.get(url);if(info.size>64*1024*1024)throw Error('Media exceeds the local size limit');
    if(cached&&cached.mtimeMs===info.mtimeMs&&cached.size===info.size)return cached.bytes;
    const bytes=await readFile(file);if(item.bytes!==undefined&&bytes.length!==item.bytes||sha(bytes)!==item.sha256)throw Error('Media differs from its manifest');
    cache.set(url,{mtimeMs:info.mtimeMs,size:info.size,bytes});while(cache.size>3)cache.delete(cache.keys().next().value);return bytes;
  }
  let script,livePort=port;
  async function compile(){
    const options=esbuildOptions({minify:false,version:'local-audio-review',assets:'inline'});
    const result=await build({...options,write:false,entryPoints:[path.join(ROOT,'scripts/audio-review/entry.jsx')],outfile:path.join(ROOT,'.cache/audio-review/bundle.js'),define:{...options.define,__MAYDAN_LOCAL_AUDIO_REVIEW__:'true',__MAYDAN_AUDIO_PREVIEW__:'false',__MAYDAN_UI_PREVIEW__:'false',__MAYDAN_ROOMS_URL__:'"same-origin"'}});
    script=result.outputFiles.find(file=>file.path.endsWith('.js')).contents;
  }
  await compile();
  const headers={'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'same-origin','permissions-policy':'microphone=(), camera=(), geolocation=()'};
  const server=http.createServer(async(req,res)=>{
    try{
      if(!localAudioRequestAllowed(req,livePort)){res.writeHead(403,headers);res.end();return;}
      if(!['GET','HEAD'].includes(req.method)){res.writeHead(405,headers);res.end();return;}
      const url=new URL(req.url,`http://127.0.0.1:${livePort}`),pathname=decodeURIComponent(url.pathname);
      if(pathname.includes('\\')||pathname.includes('\0'))throw Error('Invalid path');
      if(pathname==='/'||pathname==='/audio-lab'){res.writeHead(302,{...headers,location:PREFIX});res.end();return;}
      let body,type;
      if(pathname===PREFIX){body=Buffer.from('<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="robots" content="noindex,nofollow"><title>مختبر صوت ميدان · معاينة خاصة</title></head><body><div id="audio-review-root"></div><script src="./bundle.js"></script></body></html>');type='text/html; charset=utf-8';}
      else if(pathname===PREFIX+'bundle.js'){body=script;type='text/javascript; charset=utf-8';}
      else if(pathname===PREFIX+'manifest.json'){body=Buffer.from(JSON.stringify(pack));type='application/json; charset=utf-8';}
      else{
        const key=pathname.startsWith(PREFIX+'media/')?pathname.slice((PREFIX+'media/').length):aliases.get(pathname);
        if(key&&files.has(key)){
          body=await verified(key);type=mediaType(key);
          const range=/^bytes=(\d*)-(\d*)$/.exec(req.headers.range||'');
          if(req.headers.range&&(!range||!range[1]&&!range[2])){res.writeHead(416,{...headers,'content-range':`bytes */${body.length}`});res.end();return;}
          if(range){let start=range[1]?Number(range[1]):Math.max(0,body.length-Number(range[2])),end=range[1]?(range[2]?Number(range[2]):body.length-1):body.length-1;end=Math.min(end,body.length-1);if(!Number.isSafeInteger(start)||start<0||start>end){res.writeHead(416,{...headers,'content-range':`bytes */${body.length}`});res.end();return;}res.writeHead(206,{...headers,'content-type':type,'accept-ranges':'bytes','content-range':`bytes ${start}-${end}/${body.length}`,'content-length':end-start+1});res.end(req.method==='HEAD'?undefined:body.subarray(start,end+1));return;}
        }else if(/^\/(assets|media)\/[a-zA-Z\d/_.-]+\.(webp|png|jpg|jpeg|svg|woff2)$/.test(pathname)){
          const file=await realpath(path.join(ROOT,'public','.'+pathname)),publicRoot=path.resolve(ROOT,'public');if(path.relative(publicRoot,file).startsWith('..'))throw Error('Asset escaped public image folder');body=await readFile(file);const ext=path.extname(file);type=({'.svg':'image/svg+xml','.webp':'image/webp','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.woff2':'font/woff2'})[ext];
        }else{res.writeHead(404,headers);res.end();return;}
      }
      res.writeHead(200,{...headers,'content-type':type,'content-length':body.length,...(type.startsWith('audio/')?{'accept-ranges':'bytes'}:{})});res.end(req.method==='HEAD'?undefined:body);
    }catch(error){res.writeHead(500,{...headers,'content-type':'application/json'});res.end(JSON.stringify({error:'LOCAL_AUDIO_RESOURCE_UNAVAILABLE',detail:error.message.startsWith('Media ')?error.message:'Local resource could not be prepared'}));}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});livePort=server.address().port;
  return {server,url:`http://127.0.0.1:${livePort}${PREFIX}`,compile,close:()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}),manifestSHA256:sha(Buffer.from(await readFile(path.join(folder,'manifest.json'))))};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const lab=await startAudioReview({port:Number(process.env.MAYDAN_AUDIO_REVIEW_PORT||4184),assetRoot:process.env.MAYDAN_AUDIO_REVIEW_ASSETS||DEFAULT_ASSETS});console.log(`[audio-review] ${lab.url} — local pending candidates; no accounts/mic/providers/deploy`);
}

// Exact public question illustrations used only by the private web trial.
// Native/public game builds never install this JSON-loader transform.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import manifest from '../server/design/media-manifest.json' with {type:'json'};

const ROOT=fileURLToPath(new URL('../',import.meta.url));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
assert.equal(manifest.length,69,'Only the 69 reviewed public question images are allowed.');
assert.equal(new Set(manifest.map(item=>item.sha256)).size,69);
assert.equal(new Set(manifest.map(item=>item.source)).size,69);
for(const item of manifest){assert.deepEqual(Object.keys(item).sort(),['bytes','sha256','source']);assert.match(item.source,/^media\/[a-z0-9-]+\/[A-Za-z0-9_.-]+\.webp$/);assert.ok(!item.source.includes('..'));assert.match(item.sha256,/^[a-f0-9]{64}$/);assert.ok(Number.isSafeInteger(item.bytes)&&item.bytes>12&&item.bytes<=5*1024*1024);}
export const studioMediaEntries=Object.freeze(manifest.map(item=>Object.freeze({...item,pathname:`/api/studio/media/${item.sha256}.webp`,keySuffix:`media/${item.sha256}.webp`})));
const bySource=new Map(studioMediaEntries.map(item=>[item.source,item]));
export function assertStudioMediaBytes(entry,bytes){
  assert.equal(bytes.length,entry.bytes,`Studio image size changed: ${entry.source}`);
  assert.equal(hash(bytes),entry.sha256,`Studio image digest changed: ${entry.source}`);
  assert.equal(bytes.subarray(0,4).toString(),'RIFF');assert.equal(bytes.subarray(8,12).toString(),'WEBP');assert.equal(bytes.readUInt32LE(4)+8,bytes.length);
}
export async function readStudioMedia({root=ROOT}={}){
  const result=[];
  for(const entry of studioMediaEntries){const data=await readFile(path.join(root,entry.source));assertStudioMediaBytes(entry,data);result.push({...entry,data});}
  return result;
}
export async function verifyStudioMedia(options){const files=await readStudioMedia(options);return files.map(({data,...entry})=>entry);}
export function transformStudioCategory(category,{onReplace=()=>{}}={}){
  const result=structuredClone(category);
  const replace=value=>{
    if(typeof value!=='string' || /^(?:data:|https?:|\/\/)/i.test(value))return value;
    const source=value.startsWith('media/')?value:value.startsWith('/media/')?value.slice(1):`media/${result.id}/${value}`;
    const entry=bySource.get(source);if(!entry)return value;
    onReplace(entry);return entry.pathname;
  };
  for(const question of result.qs||[]){
    if(typeof question.image==='string')question.image=replace(question.image);
    const media=entry=>typeof entry==='string'?replace(entry):entry&&typeof entry==='object'?{...entry,src:replace(entry.src)}:entry;
    if(question.media!=null)question.media=Array.isArray(question.media)?question.media.map(media):media(question.media);
  }
  return result;
}
export function studioMediaPlugin({root=ROOT}={}){
  const categoryRoot=path.resolve(root,'src/data/categories')+path.sep,seen=new Set();
  return{name:'reviewed-studio-question-media',setup(builder){
    builder.onStart(async()=>{seen.clear();await verifyStudioMedia({root});});
    builder.onLoad({filter:/[\\/]src[\\/]data[\\/]categories[\\/][^\\/]+\.json$/},async args=>{
      if(!path.resolve(args.path).startsWith(categoryRoot))return null;
      const category=JSON.parse(await readFile(args.path,'utf8'));
      const transformed=transformStudioCategory(category,{onReplace:entry=>seen.add(entry.sha256)});
      return{contents:JSON.stringify(transformed),loader:'json',watchFiles:studioMediaEntries.map(item=>path.join(root,item.source))};
    });
    builder.onEnd(result=>{if(!result.errors.length)assert.equal(seen.size,69,'Private trial must cover every reviewed image through the active category JSON.');});
  }};
}

// In-memory review only. Does not write DIST, sign iOS, or contact a provider.
import {build} from 'esbuild';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {esbuildOptions,renderHtml,mediaVersions,ROOT,DIST} from '../lib.mjs';
import {PREVIEW_ORIGIN} from '../audio/private-preview.mjs';

const out=path.resolve(process.argv[2]||'.cache/audio-review-package');await mkdir(out,{recursive:true});
const media=await mediaVersions(ROOT),reports=[];
process.env.MAYDAN_LOCAL_AUDIO_REVIEW='1'; // Environment cannot enable this flag.
process.env.MAYDAN_UI_PREVIEW='0';
for(const privateAudio of ['0','1']){
  process.env.MAYDAN_PRIVATE_AUDIO_PREVIEW=privateAudio;process.env.IOS_RELEASE_ENVIRONMENT='mafia-preview';
  process.env.MAYDAN_ROOMS_URL=privateAudio==='1'?PREVIEW_ORIGIN:'same-origin';
  const options=esbuildOptions({minify:true,version:'audio-local-verification',media,assets:'files'});
  assert.equal(options.define.__MAYDAN_LOCAL_AUDIO_REVIEW__,'false');
  const built=await build({...options,write:false});
  const js=built.outputFiles.find(f=>f.path.endsWith('.js')).text;
  const assets=built.outputFiles.filter(f=>!f.path.endsWith('.js')).map(f=>'./'+path.relative(DIST,f.path).replaceAll('\\','/'));
  const html=await renderHtml(js,{version:'audio-local-verification',assets});
  for(const marker of ['audio-review-root','/audio-lab/','musicDirections','bossaAlternative','music-mission','C:/Users/user','council-scene','/assets/council/'])assert.equal(html.includes(marker),false,marker+' must not ship');
  const bytes=Buffer.byteLength(html),gzip=gzipSync(Buffer.from(html)).length;
  assert.ok(bytes<=3*1024**2,'existing raw budget');assert.ok(gzip<=.85*1024**2,'existing gzip budget');
  reports.push({privateAudioFlag:privateAudio==='1',bytes,gzip,sha256:createHash('sha256').update(html).digest('hex'),labExcluded:true,newCandidateFilesIncluded:false});
}
await writeFile(path.join(out,'PACKAGE-ISOLATION.json'),JSON.stringify({localOnly:true,inMemoryOnly:true,distWritten:false,physicalIPhone:false,reports},null,2));
console.log(JSON.stringify(reports));

// In-memory compilation only. Never overwrites the running local preview or
// prepares/signs/uploads an iPhone bundle. Private audio bytes are not loaded.
import { build } from 'esbuild';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { esbuildOptions, renderHtml, mediaVersions, ROOT, DIST } from './lib.mjs';
import { PREVIEW_ORIGIN } from './audio/private-preview.mjs';

const out=path.resolve(process.argv[2]||'.cache/plus-package-review');
await mkdir(out,{recursive:true});
const media=await mediaVersions(ROOT),reports=[];
process.env.MAYDAN_UI_PREVIEW='0';
process.env.MAYDAN_ROOMS_URL='same-origin';
for(const audio of ['0','1']) {
  process.env.MAYDAN_PRIVATE_AUDIO_PREVIEW=audio;
  // Satisfy the existing isolated-environment guard; no network request occurs
  // and neither this in-memory document nor any audio is written into DIST.
  process.env.IOS_RELEASE_ENVIRONMENT='mafia-preview';
  process.env.MAYDAN_ROOMS_URL=audio==='1'?PREVIEW_ORIGIN:'same-origin';
  const result=await build(esbuildOptions({minify:true,version:'local-plus-review',media,assets:'files'}));
  const js=result.outputFiles.find(file=>file.path.endsWith('.js')).text;
  const packaged=result.outputFiles.filter(file=>!file.path.endsWith('.js'));
  const assets=packaged.map(file=>'./'+path.relative(DIST,file.path).replaceAll('\\','/')).sort();
  assert.ok(assets.every(url=>url.startsWith('./assets/brand/')),'all generated presentation resources remain in the supported packaged asset directory');
  const html=await renderHtml(js,{version:'local-plus-review',assets});
  const bytes=Buffer.byteLength(html),gzip=gzipSync(Buffer.from(html)).length;
  assert.ok(bytes<=3*1024*1024,`HTML ${bytes} exceeds existing 3MiB budget`);
  assert.ok(gzip<=.85*1024*1024,'gzip exceeds existing budget');
  assert.equal(html.includes('/__plus_lab__/scenario'),false,'lab is not shipped');
  assert.equal(html.includes('PLUS_COMMERCE_LOCAL_PREVIEW'),false,'synthetic verifier is not shipped');
  assert.equal(html.includes('C:/Users/user'),false,'no local art source paths');
  assert.doesNotMatch(html,/C:(?:\/|\\+)Users(?:\/|\\+)user(?:\b|\/|\\+)/i,'no escaped local authoring paths');
  assert.equal(html.includes('/assets/council/'),false,'rejected council art is not included in the application');
  assert.equal(html.includes('council-character'),false,'rejected seated-body renderer is not included');
  assert.equal(html.includes('council-scene'),false,'rejected council scene is not included');
  const presentationSheets=packaged.filter(file=>file.path.endsWith('.css')).map(file=>({path:path.relative(DIST,file.path).replaceAll('\\','/'),bytes:file.contents.length,sha256:createHash('sha256').update(file.contents).digest('hex')}));
  assert.ok(presentationSheets.length>=2,'the real Plus presentation is packaged as local CSS');
  reports.push({privateAudioFlag:audio==='1',bytes,gzip,sha256:createHash('sha256').update(html).digest('hex'),presentationSheets,profileOnly:true,rejectedCouncilIncluded:false,compileOnly:true,physicalIPhone:false,privateAudioFilesPackaged:false});
}
await writeFile(path.join(out,'PACKAGE-REVIEW.json'),JSON.stringify({distUntouched:true,providerPayments:false,reports},null,2));
console.log(JSON.stringify({reports,out}));

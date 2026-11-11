import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { build } from 'esbuild';
import { canonical, seal } from '../scripts/audio/private-preview.mjs';
import { warmthAudioBuild, validateWarmthManifest, readWarmthManifest, unpackWarmthAssets, SOURCE_MANIFEST_SHA256, RUNTIME_PACK_SHA256, WARMTH_DIRECTORY } from '../scripts/audio/warmth-preview.mjs';

const preview = 'https://maydan-mafia-preview.mf103871.workers.dev';
const env = { MAYDAN_WARMTH_PREVIEW: '1', MAYDAN_PRIVATE_AUDIO_PREVIEW: '1', IOS_RELEASE_ENVIRONMENT: 'mafia-preview', MAYDAN_ROOMS_URL: preview };
const manifest = await readWarmthManifest();
const options = (pack = manifest.runtimePack, baseUrl = '/audio-warmth-preview/') => ({ pack, baseUrl, mode: 'candidate', directionId: 'bossaAlternative' });
const bundleCache = new Map();
async function runtime({ origin = 'maydan://app/index.html', warmth = true, privateBuild = true, buildOrigin = preview, local = false } = {}) {
  const key = JSON.stringify({warmth,privateBuild,buildOrigin,local});
  if (!bundleCache.has(key)) bundleCache.set(key, build({ stdin: { contents: "export {createLocalAudition,localAuditionScene} from './src/shared/fx/local-audition.js';export {configureIntegratedPreviewAudio,integratedPreviewAudio} from './src/shared/fx/integrated-preview-audio.js';export {createSound} from './src/shared/fx/sound.js';export {createStreamingMusic} from './src/shared/fx/streaming-music.js';export {AudioCredits} from './src/platform/screens/AudioCredits.jsx';", resolveDir:process.cwd() }, bundle:true,write:false,format:'cjs',platform:'node',logLevel:'silent',define:{__MAYDAN_WARMTH_PREVIEW__:JSON.stringify(warmth),__MAYDAN_AUDIO_PREVIEW__:JSON.stringify(privateBuild),__MAYDAN_ROOMS_URL__:JSON.stringify(buildOrigin),__MAYDAN_LOCAL_AUDIO_REVIEW__:JSON.stringify(local),'process.env.NODE_ENV':'"production"'}}).then(result=>result.outputFiles[0].text));
  const sandbox={module:{exports:{}},exports:{},console,URL,Date,setTimeout,clearTimeout};
  vm.runInNewContext(await bundleCache.get(key),sandbox);
  sandbox.window={location:{href:origin},addEventListener(){},removeEventListener(){}};
  sandbox.document={hidden:false,addEventListener(){},removeEventListener(){}};
  return sandbox.module.exports;
}
test('warmth build is opt-in and cannot target production or omit private isolation',()=>{
  assert.equal(warmthAudioBuild({}),false);assert.equal(warmthAudioBuild(env),true);
  for(const changed of [{IOS_RELEASE_ENVIRONMENT:'production'},{MAYDAN_ROOMS_URL:'https://maydan-game.mf103871.workers.dev'},{MAYDAN_PRIVATE_AUDIO_PREVIEW:'0'},{MAYDAN_ROOMS_URL:'same-origin'}])assert.throws(()=>warmthAudioBuild({...env,...changed}),/requires|Private audio/);
});
test('approved projection is pinned and contains only fourteen used assets',()=>{
  assert.equal(manifest.files.length,14);assert.equal(manifest.sourceManifestSHA256,SOURCE_MANIFEST_SHA256);assert.equal(manifest.runtimePackSHA256,RUNTIME_PACK_SHA256);
  assert.equal(createHash('sha256').update(canonical(manifest.runtimePack)).digest('hex'),RUNTIME_PACK_SHA256);
  assert.equal(manifest.bytes,56407493);assert.equal(manifest.userListeningApproved,true);assert.equal(manifest.deviceTested,false);assert.equal(manifest.productionApproved,false);
  assert.deepEqual(Object.keys(manifest.runtimePack.musicDirections),['bossaAlternative']);
  assert.equal(manifest.runtimePack.assets['music-mission'],undefined);
  for(const asset of Object.values(manifest.runtimePack.assets)) { assert.match(asset.source.pageUrl,/^https:\/\/pixabay\.com\//); assert.ok(asset.source.title); assert.ok(asset.source.author); }
});
test('changed runtime decisions, missing files and approvals are rejected',()=>{
  const change=fn=>{const copy=structuredClone(manifest);fn(copy);assert.throws(()=>validateWarmthManifest(copy));};
  change(copy=>{copy.runtimePack.cueMap.tick={decision:'candidate',assetId:'sfx-clock',rate:1};copy.runtimePackSHA256=createHash('sha256').update(canonical(copy.runtimePack)).digest('hex');});
  change(copy=>copy.files.pop());change(copy=>copy.files.push(copy.files[0]));change(copy=>copy.files[0].url='audio/../secret.m4a');
  change(copy=>copy.deviceTested=true);change(copy=>copy.productionApproved=true);change(copy=>copy.sourceManifestSHA256='0'.repeat(64));
});
test('native app and named preview use the same four-chapter 29 minute suite',async()=>{
  for(const origin of ['maydan://app/index.html',preview+'/']){
    const mod=await runtime({origin}),audition=mod.createLocalAudition(options());
    assert.equal(Object.keys(audition.assets).length,14);assert.equal(Object.keys(audition.bank).length,10);
    const suite=audition.suites['warmth-long'];assert.equal(suite.suiteTracks.length,4);assert.equal(suite.introTrackId,'music-bossa');assert.ok(suite.seconds>1768&&suite.seconds<1769);
    const player=mod.createStreamingMusic(suite);assert.equal(player.getStatus().mode,'suite');assert.equal(player.getStatus().trackId,'music-bossa');player.dispose();
    assert.equal(audition.cues.tick,null);assert.equal(audition.cues.tickFast,null);assert.equal(audition.cues.countdown,null);assert.equal(audition.cues.mafiaAssassination,null);assert.equal(audition.cues.timerWarning,'sfx-clock');
    assert.equal(mod.configureIntegratedPreviewAudio(options()),true);assert.equal(mod.createSound({localAudition:mod.integratedPreviewAudio()}).localCandidateAudio,true);
    const scene=mod.localAuditionScene(audition,'home','idle',{gain:1},new Set());assert.equal(scene.track.id,'warmth-long');assert.equal(scene.fallback,null);
    assert.equal(mod.localAuditionScene(audition,'mafia','night',{gain:1},new Set()).track,null);
  }
});
test('wrong custom origin or resource base never falls back to legacy audio',async()=>{
  for(const origin of ['maydan://other/index.html','capacitor://localhost/','file:///app/index.html','https://maydan-game.mf103871.workers.dev/']){
    const mod=await runtime({origin}),audition=mod.createLocalAudition(options());
    assert.equal(Object.keys(audition.bank).length,0);assert.equal(mod.createSound({}).localCandidateAudio,true);
  }
  const mod=await runtime();
  for(const base of ['other://app/audio-warmth-preview/','maydan://other/audio-warmth-preview/','https://example.org/','/audio/candidates/','/audio-warmth-preview/?override=1'])assert.equal(Object.keys(mod.createLocalAudition(options(manifest.runtimePack,base)).bank).length,0);
});
test('missing configuration, changed source fingerprint or old direction fail silent',async()=>{
  const mod=await runtime();assert.equal(mod.createSound().localCandidateAudio,true);
  const changed=structuredClone(manifest.runtimePack);changed.sourceManifestSHA256='0'.repeat(64);
  assert.equal(Object.keys(mod.createLocalAudition(options(changed)).bank).length,0);
  assert.equal(Object.keys(mod.createLocalAudition({...options(),directionId:'primary'}).bank).length,0);
  assert.equal(mod.configureIntegratedPreviewAudio({pack:null,baseUrl:'/audio-warmth-preview/'}),false);
  assert.equal(mod.createSound({localAudition:mod.integratedPreviewAudio()}).localCandidateAudio,true);
});
test('normal release cannot activate warmth through options or query strings',async()=>{
  const mod=await runtime({warmth:false,privateBuild:false,origin:'maydan://app/index.html?warmth=1'});
  assert.equal(mod.createLocalAudition(options()),null);assert.equal(mod.configureIntegratedPreviewAudio(options()),false);assert.equal(mod.createSound({localAudition:options()}).localCandidateAudio,false);
});
test('audio source screen renders all approved credits and remains usable when preview configuration is missing',async()=>{
  const mod=await runtime();
  const missing=JSON.stringify(mod.AudioCredits({}));assert.ok(missing.includes('لم تكتمل تهيئة حزمة صوت المعاينة'));
  assert.equal(mod.configureIntegratedPreviewAudio(options()),true);
  const rendered=JSON.stringify(mod.AudioCredits({}));
  for(const asset of Object.values(manifest.runtimePack.assets)){assert.ok(rendered.includes(asset.source.pageUrl));assert.ok(rendered.includes(asset.source.author));}
});
test('invalid encrypted capsule writes no public resources and production cannot unpack it',async t=>{
  const root=await mkdtemp(path.join(tmpdir(),'maydan-warmth-'));t.after(()=>{const target=path.resolve(root);assert.equal(path.dirname(target),path.resolve(tmpdir()));assert.ok(path.basename(target).startsWith('maydan-warmth-'));return rm(target,{recursive:true,force:true});});
  await mkdir(path.join(root,WARMTH_DIRECTORY),{recursive:true});await writeFile(path.join(root,WARMTH_DIRECTORY,'manifest.json'),JSON.stringify(manifest));
  const key=randomBytes(32),document={schemaVersion:1,files:manifest.files.map(file=>({url:file.url,data:Buffer.from('not the approved asset').toString('base64')}))};
  const result=seal(gzipSync(Buffer.from(JSON.stringify(document))),{key,aad:{schemaVersion:1,appId:'6808385717',environment:'mafia-preview',kind:'warmth-audio',bundleId:manifest.bundleId,sourceManifestSHA256:SOURCE_MANIFEST_SHA256,runtimePackSHA256:RUNTIME_PACK_SHA256},magic:'MAYDAN-WARMTH-1\n',filename:'warmth-preview.json.gz'});
  await writeFile(path.join(root,WARMTH_DIRECTORY,'private-warmth.enc'),result.encrypted);await writeFile(path.join(root,WARMTH_DIRECTORY,'receipt.json'),JSON.stringify(result.receipt));
  await assert.rejects(unpackWarmthAssets({root,env:{...env,IOS_RELEASE_ENVIRONMENT:'production'},key}),/Private audio/);
  await assert.rejects(unpackWarmthAssets({root,env,key}),/integrity/);
  await assert.rejects(readFile(path.join(root,'public/audio-warmth-preview/pack-receipt.json')),/ENOENT/);
});

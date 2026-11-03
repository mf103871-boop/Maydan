import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,mkdir,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {localAudioRequestAllowed,localAudioManifestFiles,startAudioReview} from '../scripts/audio-review/server.mjs';

test('listening server accepts only its explicit loopback host and rejects remote/cross-site requests',()=>{
  const req=headers=>({headers});
  assert.equal(localAudioRequestAllowed(req({host:'127.0.0.1:4184'}),4184),true);
  assert.equal(localAudioRequestAllowed(req({host:'game.example:4184'}),4184),false);
  assert.equal(localAudioRequestAllowed(req({host:'localhost:4184',origin:'https://external.example'}),4184),false);
  assert.equal(localAudioRequestAllowed(req({host:'localhost:4184','sec-fetch-site':'cross-site'}),4184),false);
});

test('manifest rejects promoted packs, unregistered paths and conflicting evidence',()=>{
  const entry={url:'audio/example.m4a',bytes:32,sha256:'a'.repeat(64)};
  const pack={schemaVersion:1,localPreviewOnly:true,productionActivated:false,approval:{listeningApproved:false,productionApproved:false},assets:{one:{file:entry,source:{...entry,url:'originals/example.mp3'}}}};
  assert.equal(localAudioManifestFiles(pack).size,2);
  assert.throws(()=>localAudioManifestFiles({...pack,productionActivated:true}));
  assert.throws(()=>localAudioManifestFiles({...pack,approval:{...pack.approval,listeningApproved:true}}));
  assert.throws(()=>localAudioManifestFiles({...pack,assets:{one:{file:{...entry,url:'../secret.m4a'},source:entry}}}));
  assert.throws(()=>localAudioManifestFiles({...pack,assets:{...pack.assets,two:{file:{...entry,sha256:'b'.repeat(64)},source:entry}}}));
});

test('real listening HTTP server confines files, supports seeking and refuses mismatched bytes without exposing them',async t=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'maydan-audio-review-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  await mkdir(path.join(dir,'audio'));await mkdir(path.join(dir,'originals'));
  const bytes=Buffer.from('local audio fixture bytes only'),sha256=createHash('sha256').update(bytes).digest('hex');
  const entry={url:'audio/example.m4a',bytes:bytes.length,sha256};
  await writeFile(path.join(dir,entry.url),bytes);await writeFile(path.join(dir,'originals/example.mp3'),bytes);
  const pack={schemaVersion:1,localPreviewOnly:true,productionActivated:false,approval:{listeningApproved:false,productionApproved:false},assets:{one:{file:entry,source:{...entry,url:'originals/example.mp3'}}}};
  await writeFile(path.join(dir,'manifest.json'),JSON.stringify(pack));
  const app=await startAudioReview({port:0,assetRoot:dir});t.after(()=>app.close());
  assert.equal((await fetch(app.url)).status,200);
  assert.equal((await fetch(app.url,{headers:{origin:'https://external.example'}})).status,403);
  assert.equal((await fetch(new URL('/api/me',app.url))).status,404);
  assert.equal((await fetch(app.url,{method:'POST'})).status,405);
  const media=new URL('media/'+entry.url,app.url);
  const range=await fetch(media,{headers:{range:'bytes=2-6'}});assert.equal(range.status,206);assert.deepEqual(Buffer.from(await range.arrayBuffer()),bytes.subarray(2,7));
  assert.equal((await fetch(media,{headers:{range:'bytes=999-'}})).status,416);
  assert.equal((await fetch(media,{headers:{range:'bytes=abc'}})).status,416);
  assert.equal((await fetch(new URL('media/private/secret.json',app.url))).status,404);
  await writeFile(path.join(dir,entry.url),Buffer.from('changed file must not be served'));
  const mismatch=await fetch(media);assert.equal(mismatch.status,500);assert.doesNotMatch(await mismatch.text(),/changed file must not be served/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createLocalePackLoader } from '../src/shared/locale-pack-loader.mjs';
import { localePackagingPlugin, shippedEnglishContent } from '../scripts/lib/locale-packaging.mjs';
import { getCategories } from '../src/data/game-content.js';
import { ENGLISH_CONTENT } from '../src/data/locales/en/index.js';

const pack = (id,data,contentVersion='new-en') => ({schemaVersion:1,kind:'game',id,contentLocale:'en',contentVersion,data});
test('language loading deduplicates in flight, rejects mismatched identity and retries after a failure',async()=>{
  const registry={},manifest={beep:{url:'./beep-HASH.json',kind:'game',contentVersion:'new-en',array:true}};
  let calls=0,mode='failure';
  const load=createLocalePackLoader(manifest,registry,{fetchImpl:async()=>{calls++;await Promise.resolve();if(mode==='failure')return new Response('',{status:503});return Response.json(pack('beep',[{id:'retained-id'}],mode==='version'?'legacy-ar':'new-en'));}});
  await Promise.all([assert.rejects(load('beep'),{code:'CONTENT_UNAVAILABLE'}),assert.rejects(load('beep'),{code:'CONTENT_UNAVAILABLE'})]);
  assert.equal(calls,1);assert.equal(Object.hasOwn(registry,'beep'),false);
  mode='version';await assert.rejects(load('beep'),{code:'CONTENT_VERSION'});assert.deepEqual(registry,{});
  mode='ok';await Promise.all([load('beep'),load('beep')]);assert.equal(calls,3);assert.deepEqual(registry.beep,[{id:'retained-id'}]);
  await load('beep');assert.equal(calls,3);
  await assert.rejects(load('beep','legacy-ar'),{code:'CONTENT_VERSION'});
  await assert.rejects(load('ersomha'),{code:'CONTENT_UNAVAILABLE'});
});

test('actual browser packaging keeps Arabic synchronous and loads only the requested English game and UI',async t=>{
  const result=await build({stdin:{contents:"export {getCategories,getGameContent,loadGameContent,hasEnglishContentPack} from './src/data/game-content.js';export {EN,englishUiReady,loadEnglishUi} from './src/shared/i18n/en.js';",resolveDir:process.cwd()},bundle:true,write:false,metafile:true,format:'esm',outfile:'work/locale-test/bundle.js',assetNames:'assets/brand/[name]-[hash]',plugins:[localePackagingPlugin()],logLevel:'silent'});
  const files=result.outputFiles.filter(file=>file.path.endsWith('.json'));
  assert.equal(files.length,7);assert.ok(files.every(file=>/locale-en-[a-z]+-[A-Z0-9]+\.json$/.test(file.path)));
  const payloads=new Map(files.map(file=>[file.path.split(/[\\/]/).at(-1),JSON.parse(file.text)]));
  const original=globalThis.fetch,requested=[];t.after(()=>{globalThis.fetch=original;});
  globalThis.fetch=async url=>{requested.push(url);const payload=payloads.get(String(url).split('/').at(-1));return payload?Response.json(payload):new Response('',{status:404});};
  const js=result.outputFiles.find(file=>file.path.endsWith('.js')).text;
  const client=await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
  assert.deepEqual(client.getCategories().map(c=>c.id),getCategories().map(c=>c.id));assert.equal(requested.length,0);
  assert.equal(client.hasEnglishContentPack('badeeha'),true);assert.throws(()=>client.getCategories('en'),/Content unavailable/);
  assert.equal(client.englishUiReady(),false);const dictionary=client.EN;assert.deepEqual(dictionary,{});
  const english=await client.loadGameContent('badeeha','en','new-en');assert.equal(requested.length,1);assert.equal(english.length,78);
  assert.deepEqual(english.map(c=>c.id),getCategories('en').map(c=>c.id));
  assert.throws(()=>client.getGameContent('fabraka','en'),/Content unavailable/,'unrequested games must stay unloaded');
  await client.loadEnglishUi();assert.equal(client.EN,dictionary);assert.equal(client.englishUiReady(),true);assert.equal(dictionary['إعادة المحاولة'],'Try again');assert.equal(requested.length,2);
  await client.loadGameContent('badeeha','en');await client.loadEnglishUi();assert.equal(requested.length,2);
  await assert.rejects(client.loadGameContent('badeeha','en','legacy-ar'),/CONTENT_VERSION/);
  const badeeha=[...payloads.values()].find(value=>value.id==='badeeha').data;
  assert.deepEqual(badeeha,shippedEnglishContent('badeeha',ENGLISH_CONTENT.badeeha));
  assert.ok(badeeha.every(c=>c.qs.every(q=>!Object.hasOwn(q,'verified')&&!Object.hasOwn(q,'verification'))));
  assert.ok(Object.keys(result.metafile.inputs).every(file=>!/[\\/]server[\\/]data[\\/]ersomha/.test(file)));
  assert.ok(![...payloads.keys()].some(name=>name.includes('ersomha')));
});

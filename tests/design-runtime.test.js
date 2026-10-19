import test from 'node:test';
import assert from 'node:assert/strict';
import * as client from '../src/design/client.js';
import { createDefaultDesign } from '../src/design/schema.js';
import { designRect, layoutFromRect, contrastRatio } from '../src/design/geometry.js';
import { loadDesignImages,referencedDesignImages } from '../src/design/images.js';

function memoryStorage() { const entries = new Map(); return { getItem:key=>entries.get(key)??null, setItem:(key,value)=>entries.set(key,value), removeItem:key=>entries.delete(key), clear:()=>entries.clear(), entries }; }
const published = () => ({ channel:'published', versionId:'version-1', document:createDefaultDesign() });
test('offline storage saves only validated published snapshots, never owner previews or blob URLs', () => {
  const storage = memoryStorage();
  assert.equal(client.savePublishedDesign(published(),storage),true);
  assert.deepEqual(client.readPublishedDesign(storage),published());
  assert.equal(client.savePublishedDesign({ ...published(),channel:'preview',owner:'account-A',assetUrls:{private:'blob:secret-A'} },storage),false);
  assert.deepEqual(client.readPublishedDesign(storage),published());
  assert.equal(client.savePublishedDesign({ ...published(),assetUrls:{private:'blob:secret-A'},owner:'account-A' },storage),true);
  assert.equal([...storage.entries.values()].some(value=>value.includes('blob:secret-A') || value.includes('account-A')),false);
});
test('cached previews, corrupted JSON and unsupported documents do not cross account boundaries', () => {
  const storage = memoryStorage(); client.savePublishedDesign(published(),storage); const key=[...storage.entries.keys()][0];
  for (const raw of ['{',JSON.stringify({...published(),channel:'preview',owner:'account-A'}),JSON.stringify({...published(),document:{...createDefaultDesign(),registryVersion:2}})]) { storage.setItem(key,raw); assert.equal(client.readPublishedDesign(storage),null); }
});
test('returning to bundled defaults revokes the old published offline snapshot', () => {
  const storage = memoryStorage(); client.savePublishedDesign(published(),storage);
  assert.equal(typeof client.clearPublishedDesign,'function','runtime needs an explicit reset after a server default/rollback response');
  client.clearPublishedDesign(storage); assert.equal(client.readPublishedDesign(storage),null);
});
test('configuration envelopes have bounded IDs and cannot smuggle unknown channels or private cache metadata', () => {
  assert.equal(client.normalizeDesignConfig(null),null); assert.equal(client.normalizeDesignConfig({...published(),channel:'editor'}),null);
  for (const versionId of ['javascript:bad','x'.repeat(200),{},7]) assert.equal(client.normalizeDesignConfig({...published(),versionId}),null);
  const preview=client.normalizeDesignConfig({...published(),channel:'preview',owner:'forged-user',assetUrls:{x:'https://evil.test'}});
  assert.equal(preview.channel,'preview'); assert.equal(preview.owner,undefined); assert.equal(preview.assetUrls,undefined);
  assert.deepEqual(client.normalizeDesignConfig({channel:'default',versionId:null,document:null}).document,createDefaultDesign());
});
test('layout changes wait for live rooms, local matches, active calls, typing and modals', () => {
  for (const route of ['play','online','room']) assert.equal(client.designChangeSafe({route}),false);
  for (const flag of ['call','focused','modal']) assert.equal(client.designChangeSafe({route:'home',[flag]:true}),false);
  assert.equal(client.designChangeSafe({route:'home'}),true); assert.equal(client.designChangeSafe({route:'settings'}),true);
});
test('portrait and landscape positions retain complete interactive rectangles inside their viewport', () => {
  for (const container of [{width:390,height:844},{width:844,height:390},{width:320,height:568},{width:1200,height:800}]) {
    for (const anchorX of ['left','center','right']) for (const anchorY of ['top','center','bottom']) for (const x of [0,.5,1]) for (const y of [0,.5,1]) {
      const rect=designRect({x,y,width:.3,height:.2,anchorX,anchorY,z:4},container,{x:10,y:10,width:80,height:44},{required:true,interactive:true});
      for (const value of Object.values(rect)) assert.equal(Number.isFinite(value),true);
      assert.ok(rect.x>=0 && rect.y>=0); assert.ok(rect.width>=44 && rect.height>=44);
      assert.ok(rect.x+rect.width<=container.width+.001,JSON.stringify({container,rect})); assert.ok(rect.y+rect.height<=container.height+.001,JSON.stringify({container,rect}));
    }
  }
});
test('square canvases fit the shorter available dimension and auto height cannot escape the viewport', () => {
  const container={width:844,height:390};
  const square=designRect({x:1,y:1,width:1,height:1},container,{x:0,y:0,width:300,height:300},{required:true,square:true});
  assert.equal(square.width,square.height); assert.ok(square.width<=390); assert.ok(square.x+square.width<=844); assert.ok(square.y+square.height<=390);
  const auto=designRect({x:0,y:1,width:1,height:'auto'},container,{x:0,y:0,width:300,height:900},{interactive:true}); assert.ok(auto.height<=390); assert.ok(auto.y+auto.height<=390);
});
test('normalized saved rectangles round trip across orientation without fixed-pixel drift', () => {
  const portrait={width:390,height:844}; const rect={x:39,y:84.4,width:195,height:168.8};
  const normalized=layoutFromRect(rect,portrait);
  assert.equal(normalized.x,.1); assert.equal(normalized.y,.1); assert.equal(normalized.width,.5); assert.equal(normalized.height,.2);
  const restored=designRect(normalized,{width:844,height:390},rect);
  assert.equal(restored.x,84.4); assert.equal(restored.y,39); assert.equal(restored.width,422); assert.equal(restored.height,78);
});
test('contrast checks match reference black/white and are symmetric for valid opaque colours', () => {
  assert.equal(contrastRatio('#000','#fff'),21); assert.equal(contrastRatio('#ffffff','#000000'),21);
  assert.equal(contrastRatio('#118d96','#fff8eb'),contrastRatio('#fff8eb','#118d96')); assert.equal(contrastRatio('#352547','#352547'),1);
});

const imageConfig=(channel='published')=>({channel,document:{assets:['one','two','unused'],screens:{home:{decorations:[{type:'image',assetId:'one'},{type:'image',assetId:'two'},{type:'image',assetId:'unused',visible:false}]}}}});
test('cold offline launch restores published images without making a network request',async()=>{
  const seen=[],config=imageConfig(),cache={match:async key=>{seen.push(key);return new Response(new Uint8Array([1,2,3]),{headers:{'content-type':'image/png'}});}};
  assert.deepEqual(referencedDesignImages(config.document),['one','two']);
  const images=await loadDesignImages(config,{origin:'https://game.test',cache,cacheOnly:true,read:()=>assert.fail('offline hydration attempted network'),createURL:()=>`blob:fixture-${seen.length}`,revokeURL:()=>assert.fail('valid images revoked')});
  assert.deepEqual(Object.keys(images.assetUrls),['one','two']);assert.equal(seen.length,2);
});
test('preview images never enter the published cache and account changes reclaim pending URLs',async()=>{
  const config=imageConfig('preview'),revoked=[];let active=true,counter=0;
  const result=await loadDesignImages(config,{origin:'https://game.test',cache:{put:()=>assert.fail('private image cached'),match:()=>assert.fail('private image cache fallback')},read:async()=>new Response(new Uint8Array([1])),current:()=>active,createURL:()=>{const value=`blob:private-${++counter}`;if(counter===2)active=false;return value;},revokeURL:url=>revoked.push(url)});
  assert.equal(result,null);assert.deepEqual(revoked,['blob:private-1','blob:private-2']);
});
test('an image failure waits for all requests before revoking partial URLs',async()=>{
  const revoked=[];let finish;
  const pending=new Promise(resolve=>{finish=resolve;});
  const request=loadDesignImages(imageConfig('preview'),{origin:'https://game.test',read:async path=>{if(path.endsWith('/one'))throw new Error('denied');await pending;return new Response(new Uint8Array([1]));},createURL:()=> 'blob:partial',revokeURL:url=>revoked.push(url)});
  finish();await assert.rejects(request,/denied/);assert.deepEqual(revoked,['blob:partial']);
});
test('storage quota failure does not discard successful network images',async()=>{
  const config=imageConfig(),images=await loadDesignImages(config,{origin:'https://game.test',cache:{put:async()=>{throw new Error('QuotaExceededError');},match:async()=>undefined},read:async()=>new Response(new Uint8Array([1])),createURL:()=> 'blob:network',revokeURL:()=>assert.fail('good network image revoked')});
  assert.deepEqual(Object.keys(images.assetUrls),['one','two']);
});

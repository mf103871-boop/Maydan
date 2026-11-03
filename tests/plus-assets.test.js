import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { PLUS_COLLECTIONS, PLUS_ITEMS, COSMETIC_OFFERS, availableCollections, availableSubscriptionItems, subscriptionIncludesKind } from '../src/plus/catalog.js';
import craftedManifest from '../assets/plus/v2/manifest.json' with { type:'json' };

test('all cosmetic assets are bundled, fingerprinted and contain no external sticker content', () => {
  for (const item of PLUS_ITEMS) {
    assert.match(item.assetUrl, /^\/assets\/plus\/v[12]\/[a-z0-9-]+\.(?:webp|svg)$/);
    const bytes = readFileSync(new URL('../public' + item.assetUrl, import.meta.url));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), item.assetHash, item.id);
    if (item.kind === 'sticker') {
      assert.equal(item.version,1,'unchanged v1 sticker art keeps historical message compatibility');
      const svg = bytes.toString('utf8');
      assert.match(svg, /viewBox=/);
      assert.doesNotMatch(svg.replace('xmlns="http://www.w3.org/2000/svg"', ''), /<script|<foreignObject|\bon[a-z]+=|https?:\/\//i);
      assert.ok(svg.includes(item.label), item.id);
    }
  }
});

test('current subscription is profile/frame only; legacy catalog and permanent offer licenses stay readable', async () => {
  assert.deepEqual([...new Set(availableSubscriptionItems(Date.UTC(2026,10,2)).map(item=>item.kind))].sort(),['frame','profileSkin']);
  for(const kind of ['avatar','cover','roomTheme','nameColor','entrance','sticker','councilSkin'])assert.equal(subscriptionIncludesKind(kind),false,kind);
  const profile=PLUS_ITEMS.find(item=>item.id==='sahra.profileSkin');
  assert.equal(profile.membershipOnly,true);assert.equal(profile.artReady,true);assert.equal(profile.assetUrl,'/assets/plus/v2/profile-sahra-background.webp');
  const bytes=readFileSync(new URL('../public'+profile.assetUrl,import.meta.url));
  const{info}=await sharp(bytes).raw().toBuffer({resolveWithObject:true});assert.equal(info.width,1024);assert.equal(info.height,683);
  assert.equal(createHash('sha256').update(bytes).digest('hex'),profile.assetHash);assert.ok(bytes.length<256000);
  for(const kind of ['profileSkin','councilSkin']){
    const item=PLUS_ITEMS.find(value=>value.id===`sahra.${kind}`);assert.equal(item.kind,kind);assert.equal(item.membershipOnly,true);
    assert.equal(COSMETIC_OFFERS.some(offer=>offer.itemIds.includes(item.id)),false);
  }
  assert.equal(availableSubscriptionItems().some(item=>item.id==='sahra.councilSkin'),false);
  const legacy=COSMETIC_OFFERS.find(offer=>offer.id==='sahra.bundle.permanent');
  assert.deepEqual([...legacy.itemIds].sort(),['frame','avatar','cover','roomTheme','nameColor','entrance'].map(kind=>'sahra.'+kind).sort());
});
test('three complete launch collections and two future monthly collections have six original stickers each', () => {
  assert.equal(PLUS_COLLECTIONS.length, 5);
  assert.equal(availableCollections(Date.UTC(2026, 9, 28)).length, 3);
  for (const collection of PLUS_COLLECTIONS) {
    const items = PLUS_ITEMS.filter(item => item.collectionId === collection.id);
    assert.equal(items.filter(item => item.kind === 'sticker').length, 6);
    for (const kind of collection.availableFrom === 0 ? ['frame', 'avatar', 'cover', 'roomTheme'] : ['frame', 'cover']) {
      assert.equal(items.filter(item => item.kind === kind && !item.membershipOnly).length, 1, `${collection.id}:${kind}`);
    }
  }
});

test('v2 cosmetics have independent prepared art, bounded download size and transparent portrait apertures', async () => {
  assert.equal(Object.keys(craftedManifest.assets).length,31);
  let total=0;
  for(const [url,entry] of Object.entries(craftedManifest.assets)) {
    const bytes=readFileSync(new URL('../public'+url,import.meta.url));total+=bytes.length;
    assert.equal(createHash('sha256').update(bytes).digest('hex'),entry.sha256,url);
    assert.equal(bytes.length,entry.bytes,url);assert.ok(bytes.length<(entry.kind==='profileSkin'?256000:160000),url);
    if(url.endsWith('.svg'))assert.doesNotMatch(bytes.toString().replace('xmlns="http://www.w3.org/2000/svg"',''),/<script|<foreignObject|\bon[a-z]+=|https?:\/\//i);
    else {
      const {data,info}=await sharp(bytes).ensureAlpha().raw().toBuffer({resolveWithObject:true});
      assert.equal(info.width,entry.width,url);assert.equal(info.height,entry.height,url);
      if(['frame','avatar','table','entrance'].includes(entry.kind)) {
        assert.equal(data[3],0,url+':corner');
        if(entry.kind==='frame')assert.equal(data[(Math.floor(info.height/2)*info.width+Math.floor(info.width/2))*info.channels+3],0,url+':center');
      }
    }
  }
  assert.ok(total<1_500_000,'all three collections fit the reviewed art budget');
  for(const id of ['sahra','artist','noir']) {
    const items=PLUS_ITEMS.filter(item=>item.collectionId===id&&!item.membershipOnly&&item.kind!=='sticker');
    assert.equal(items.length,6,id);assert.equal(new Set(items.map(item=>item.assetUrl)).size,6,id);
    assert.ok(items.every(item=>item.artReady),id);
    assert.equal(new Set(items.map(item=>item.assetHash)).size,6,id);
    const frame=items.find(item=>item.kind==='frame');assert.equal(new Set(Object.values(frame.frameAssets)).size,3,id);
    assert.ok(craftedManifest.assets[items.find(item=>item.kind==='roomTheme').layerAssets.table],id+':separate table');
    assert.equal(items.find(item=>item.kind==='avatar').motionKind,undefined,'static portrait has no fabricated animated claim');
  }
});

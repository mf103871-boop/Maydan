import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {studioSiteResponse} from '../server/design/site.mjs';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
function fixture(){const reads=[],html=Buffer.from('<!doctype html><html lang="ar"><head><base href="/"></head><body>استوديو ميدان</body></html>');return{reads,html,env:{DESIGN_STUDIO_RELEASE:'studio-20261019-abc123',SOCIAL_AUDIO:{async get(key){reads.push(key);return{size:html.length,arrayBuffer:async()=>html,customMetadata:{sha256:digest(html)}};}}}};}
test('Studio site maps only three fixed HTML keys and never fetches public assets',async()=>{
  const f=fixture();for(const[route,key]of[['/api/studio/','editor'],['/api/studio/preview/','preview'],['/api/studio/play/','play']]){
    const response=await studioSiteResponse(new Request(`https://maydan.test${route}?nonce=local`),f.env);assert.equal(response.status,200);assert.equal(await response.text(),f.html.toString());assert.equal(f.reads.at(-1),`studio-site/studio-20261019-abc123/${key}.html`);assert.equal(response.headers.get('x-maydan-studio-sha256'),digest(f.html));assert.equal(response.headers.get('cache-control'),'no-store');
  }
  for(const route of ['/','/index.html','/studio/secrets','/studio/preview/index.html','/studio/%2fprivate','/api/design/me'])assert.equal(await studioSiteResponse(new Request(`https://maydan.test${route}`),f.env),null);
  assert.equal(f.reads.length,3);
});
test('only the isolated fixture document permits same-origin framing and all three allow their fixed base',async()=>{
  const f=fixture();for(const route of ['/api/studio/','/api/studio/preview/','/api/studio/play/']){const response=await studioSiteResponse(new Request(`https://maydan.test${route}`),f.env),csp=response.headers.get('content-security-policy');assert.match(csp,/base-uri 'self'/);assert.match(csp,/object-src 'none'/);assert.equal(response.headers.get('x-frame-options'),route==='/api/studio/preview/'?'SAMEORIGIN':'DENY');assert.match(csp,route==='/api/studio/preview/'?/frame-ancestors 'self'/:/frame-ancestors 'none'/);}
});
test('canonical redirects retain nonce while non-read methods cannot request objects',async()=>{
  const f=fixture();for(const route of ['/studio','/studio/','/studio/preview','/studio/preview/','/studio/play','/studio/play/','/api/studio','/api/studio/preview','/api/studio/play']){const response=await studioSiteResponse(new Request(`https://maydan.test${route}?nonce=one`),f.env);assert.equal(response.status,307);assert.equal(response.headers.get('location'),`${route.startsWith('/api')?'':'/api'}${route.endsWith('/')?route:`${route}/`}?nonce=one`);}
  const denied=await studioSiteResponse(new Request('https://maydan.test/api/studio/',{method:'POST',body:'bad'}),f.env);assert.equal(denied.status,405);assert.equal(f.reads.length,0);
  const head=await studioSiteResponse(new Request('https://maydan.test/api/studio/play/',{method:'HEAD'}),f.env);assert.equal(head.status,200);assert.equal(await head.text(),'');assert.equal(head.headers.get('content-length'),String(f.html.length));
});
test('missing/invalid releases, corrupt objects and metadata mismatch fail closed without leaking keys',async()=>{
  for(const release of [undefined,'../private','x','studio/other','studio-2026?secret']){const f=fixture();f.env.DESIGN_STUDIO_RELEASE=release;const response=await studioSiteResponse(new Request('https://maydan.test/api/studio/'),f.env);assert.equal(response.status,503);assert.equal(f.reads.length,0);}
  for(const object of [null,{size:17*1024*1024},{size:20,arrayBuffer:async()=>Buffer.from('not HTML')},{size:30,arrayBuffer:async()=>Buffer.from('<!doctype html><html>broken digest'),customMetadata:{sha256:'bad'}}]){const f=fixture();f.env.SOCIAL_AUDIO.get=async()=>object;assert.equal((await studioSiteResponse(new Request('https://maydan.test/api/studio/'),f.env)).status,503);}
});

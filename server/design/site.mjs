import mediaManifest from './media-manifest.json' with {type:'json'};
const ROUTES = Object.freeze({'/api/studio/':'editor','/api/studio/preview/':'preview','/api/studio/play/':'play'});
const RELEASE = /^[a-z0-9][a-z0-9-]{7,79}$/;
const MAX_HTML = 16 * 1024 * 1024;
const PUBLIC_MEDIA=new Map(mediaManifest.map(entry=>[entry.sha256,entry]));
const digestOf=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(value=>value.toString(16).padStart(2,'0')).join('');
export async function studioMediaResponse(request,env){
  const url=new URL(request.url);
  if(!url.pathname.startsWith('/api/studio/media/'))return null;
  const match=/^\/api\/studio\/media\/([a-f0-9]{64})\.webp$/.exec(url.pathname),entry=match&&PUBLIC_MEDIA.get(match[1]);
  if(!entry)return new Response(null,{status:404,headers:{'cache-control':'no-store'}});
  if(!['GET','HEAD'].includes(request.method))return new Response(null,{status:405,headers:{allow:'GET, HEAD','cache-control':'no-store'}});
  const release=env.DESIGN_STUDIO_RELEASE;
  if(typeof release!=='string'||!RELEASE.test(release)||!env.SOCIAL_AUDIO)return new Response(null,{status:503});
  let object,bytes;
  try{
    object=await env.SOCIAL_AUDIO.get(`studio-site/${release}/media/${entry.sha256}.webp`);
    if(!object || object.size!==entry.bytes)return new Response(null,{status:503});
    bytes=new Uint8Array(await object.arrayBuffer());
    if(bytes.length!==entry.bytes || bytes.length<12 || String.fromCharCode(...bytes.subarray(0,4))!=='RIFF' || String.fromCharCode(...bytes.subarray(8,12))!=='WEBP' || new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).getUint32(4,true)+8!==bytes.length || await digestOf(bytes)!==entry.sha256 || object.customMetadata?.sha256 && object.customMetadata.sha256!==entry.sha256)return new Response(null,{status:503});
  }catch{return new Response(null,{status:503});}
  return new Response(request.method==='HEAD'?null:bytes,{headers:{'content-type':'image/webp','content-length':String(entry.bytes),'cache-control':'public, max-age=31536000, immutable','x-content-type-options':'nosniff','cross-origin-resource-policy':'same-origin',etag:`"${entry.sha256}"`,'x-maydan-studio-media-sha256':entry.sha256}});
}
function headers(kind) {
  return {
    'content-type':'text/html; charset=utf-8',
    'cache-control':'no-store',
    'x-content-type-options':'nosniff',
    'referrer-policy':'same-origin',
    'x-frame-options':kind==='preview'?'SAMEORIGIN':'DENY',
    'content-security-policy':[
      "default-src 'self'", "script-src 'self' 'unsafe-inline'", "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:", "media-src 'self' data: blob: https:", "font-src 'self' data:",
      kind==='preview'?"connect-src 'self'":"connect-src 'self' https: wss:",
      "frame-src 'self'", "worker-src 'self'", "manifest-src 'self'", "base-uri 'self'", "object-src 'none'",
      "form-action 'none'", kind==='preview'?"frame-ancestors 'self'":"frame-ancestors 'none'",
    ].join('; '),
  };
}
export async function studioSiteResponse(request,env) {
  const url=new URL(request.url),kind=ROUTES[url.pathname];
  if(url.pathname.startsWith('/api/studio/media/'))return studioMediaResponse(request,env);
  if(!kind) {
    const target=Object.hasOwn(ROUTES,`${url.pathname}/`)?`${url.pathname}/`:
      /^\/studio(?:\/(?:preview|play))?\/?$/.test(url.pathname)?`/api${url.pathname.endsWith('/')?url.pathname:`${url.pathname}/`}`:null;
    if(target) {
      if(!['GET','HEAD'].includes(request.method))return new Response(null,{status:405,headers:{allow:'GET, HEAD','cache-control':'no-store'}});
      return new Response(null,{status:307,headers:{location:target+url.search,'cache-control':'no-store'}});
    }
    return null;
  }
  if(!['GET','HEAD'].includes(request.method))return new Response(null,{status:405,headers:{...headers(kind),allow:'GET, HEAD'}});
  const release=env.DESIGN_STUDIO_RELEASE;
  if(typeof release!=='string' || !RELEASE.test(release) || !env.SOCIAL_AUDIO)return new Response(request.method==='HEAD'?null:'استوديو ميدان غير متاح حاليًا.',{status:503,headers:headers(kind)});
  let object;
  try{object=await env.SOCIAL_AUDIO.get(`studio-site/${release}/${kind}.html`);}catch{return new Response(null,{status:503,headers:headers(kind)});}
  if(!object)return new Response(request.method==='HEAD'?null:'لم تكتمل حزمة الاستوديو.',{status:503,headers:headers(kind)});
  if(object.size>MAX_HTML)return new Response(null,{status:503,headers:headers(kind)});
  let bytes;
  try{bytes=new Uint8Array(await object.arrayBuffer());}catch{return new Response(null,{status:503,headers:headers(kind)});}
  if(bytes.length>MAX_HTML || !new TextDecoder().decode(bytes.subarray(0,128)).trimStart().toLowerCase().startsWith('<!doctype html'))return new Response(null,{status:503,headers:headers(kind)});
  const digest=await digestOf(bytes);
  if(object.customMetadata?.sha256 && object.customMetadata.sha256!==digest)return new Response(null,{status:503,headers:headers(kind)});
  return new Response(request.method==='HEAD'?null:bytes,{headers:{...headers(kind),'content-length':String(bytes.length),'x-maydan-studio-release':release,'x-maydan-studio-sha256':digest,etag:`"${digest}"`}});
}

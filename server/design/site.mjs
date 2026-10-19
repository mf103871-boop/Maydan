const ROUTES = Object.freeze({'/api/studio/':'editor','/api/studio/preview/':'preview','/api/studio/play/':'play'});
const RELEASE = /^[a-z0-9][a-z0-9-]{7,79}$/;
const MAX_HTML = 16 * 1024 * 1024;
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
  const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(value=>value.toString(16).padStart(2,'0')).join('');
  if(object.customMetadata?.sha256 && object.customMetadata.sha256!==digest)return new Response(null,{status:503,headers:headers(kind)});
  return new Response(request.method==='HEAD'?null:bytes,{headers:{...headers(kind),'content-length':String(bytes.length),'x-maydan-studio-release':release,'x-maydan-studio-sha256':digest,etag:`"${digest}"`}});
}

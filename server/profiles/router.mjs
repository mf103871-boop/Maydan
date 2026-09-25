import { fail } from '../room-model.mjs';
import { json, readJson, errorResponse } from '../protocol.mjs';
import { requireSession, withRotation } from '../accounts/session.mjs';
import { chargeUser, friendIds } from '../social/db.mjs';
import { notifyUsers } from '../social/realtime.mjs';
import * as db from './db.mjs';
import { patchOf, revisionOf, userId } from './model.mjs';
import { base64ToBytes, imageFromDataUrl, IMAGE_LIMITS } from './images.mjs';

const IMAGE_PATH=/^\/api\/profiles\/([A-Za-z0-9_-]{1,80})\/images\/(avatar|cover)\/([a-f0-9]{64})$/;
export const isPublicProfileImagePath = pathname => IMAGE_PATH.test(pathname);
export const isProfilePath = pathname => pathname==='/api/profiles' || pathname.startsWith('/api/profiles/');
async function notifyProfile(env,id) {
  try { await notifyUsers(env,[id,...await friendIds(env,id)],{type:'refresh',reason:'profile',userId:id}); } catch { /* saved profile remains successful */ }
}
export async function routeProfiles(request,env,url=new URL(request.url),charge) {
  if(!isProfilePath(url.pathname)) return null;
  if(!env.DB) fail('NOT_FOUND',404);
  const image=IMAGE_PATH.exec(url.pathname);
  if(image && ['GET','HEAD'].includes(request.method)) {
    if(charge) await charge('profileImage');
    // Only this exact current-version binary path is anonymous. Profile metadata is not.
    const found=await db.currentImage(env,image[1],image[2],image[3]);
    if(!found) return json({error:'NOT_FOUND'},404,{'x-content-type-options':'nosniff'});
    return new Response(request.method==='HEAD'?null:base64ToBytes(found.data_base64),{headers:{
      'content-type':'image/jpeg','content-length':String(found.byte_length),'cache-control':'no-store',
      'x-content-type-options':'nosniff','content-security-policy':"default-src 'none'; sandbox",'cross-origin-resource-policy':'cross-origin',
    }});
  }
  if(charge) await charge(request.method==='GET'?'profileRead':'profileWrite');
  const auth=await requireSession(env,request);
  try {
    const response=await dispatch(request,env,url,auth.user.id);
    return withRotation(response,auth.rotated);
  } catch(error) { return withRotation(errorResponse(error),auth.rotated); }
}
async function dispatch(request,env,url,id) {
  const path=url.pathname.slice('/api/profiles'.length); const method=request.method; const now=Date.now();
  await db.ensurePlayerProfile(env,id,now);
  if(method!=='GET') await chargeUser(env,id,'write',now);
  if(path==='/me' && method==='GET') return json({profile:await db.profileFor(env,id,id)});
  if(path==='/search' && method==='GET') {
    const q=String(url.searchParams.get('q')||'').normalize('NFKC').trim();
    if(Array.from(q).length<2 || Array.from(q).length>80) fail('INVALID',400);
    return json({users:await db.searchProfiles(env,id,q)});
  }
  if(path==='/me' && method==='PATCH') {
    const body=await readJson(request,8192);
    const existing=await db.profileFor(env,id,id);
    const {patch,revision}=patchOf(body,existing);
    await db.patchProfile(env,id,patch,revision);
    await notifyProfile(env,id);
    return json({profile:await db.profileFor(env,id,id)});
  }
  const image=/^\/me\/images\/(avatar|cover)$/.exec(path);
  if(image && ['PUT','DELETE'].includes(method)) {
    const body=method==='DELETE' && !request.body ? {} : await readJson(request,Math.ceil(IMAGE_LIMITS[image[1]]/3)*4+2048);
    if(Object.keys(body).some(key=>!['dataUrl','revision'].includes(key)) || (method==='DELETE' && 'dataUrl' in body)) fail('INVALID',400);
    const revision=revisionOf(body.revision);
    const value=method==='PUT'?await imageFromDataUrl(body.dataUrl,image[1]):null;
    await db.setImage(env,id,image[1],value,revision);
    await notifyProfile(env,id);
    return json({profile:await db.profileFor(env,id,id)});
  }
  if(path==='/me/sessions' && method==='POST') {
    const body=await readJson(request);
    if(Object.keys(body).some(key=>key!=='game')) fail('INVALID',400);
    return json({sessionId:await db.startLocalSession(env,id,body.game)});
  }
  const completion=/^\/me\/sessions\/([A-Za-z0-9_-]{1,80})\/complete$/.exec(path);
  if(completion && method==='POST') {
    const body=request.body?await readJson(request):{};
    if(Object.keys(body).length) fail('INVALID',400);
    const result=await db.completeLocalSession(env,id,completion[1]);
    await notifyProfile(env,id);
    return json({ok:true,...result,profile:await db.profileFor(env,id,id)});
  }
  const profile=/^\/([A-Za-z0-9_-]{1,80})$/.exec(path);
  if(profile && method==='GET') return json({profile:await db.profileFor(env,id,userId(profile[1]))});
  fail('NOT_FOUND',404);
}

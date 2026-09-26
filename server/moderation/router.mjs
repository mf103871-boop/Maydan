import { fail } from '../room-model.mjs';
import { requireSession, withRotation } from '../accounts/session.mjs';
import { readJson,json,errorResponse } from '../protocol.mjs';
import { isModerator } from './access.mjs';
import * as db from './db.mjs';
import { base64ToBytes } from '../profiles/images.mjs';
import { friendIds,chargeUser } from '../social/db.mjs';
import { notifyUsers,forgetSocialUser } from '../social/realtime.mjs';

export async function routeModeration(request,env,url=new URL(request.url),charge) {
  if(!url.pathname.startsWith('/api/moderation/'))return null;
  if(!env.DB)fail('NOT_FOUND',404);
  if(charge)await charge(request.method==='GET'?'profileRead':'profileWrite');
  const auth=await requireSession(env,request);
  try {
    const path=url.pathname.slice('/api/moderation'.length);
    const moderator=isModerator(env,auth.user.id);
    if(path==='/me' && request.method==='GET')return withRotation(json({moderator}),auth.rotated);
    if(!moderator)fail('FORBIDDEN',403);
    let response;
    if(path==='/reports' && request.method==='GET')response=json(await db.reportsOf(env,db.pageOf(url.searchParams),url.searchParams.get('status')||'open'));
    else if(path==='/images' && request.method==='GET')response=json(await db.imagesOf(env,db.pageOf(url.searchParams)));
    else if(path==='/audit' && request.method==='GET')response=json(await db.auditOf(env,db.pageOf(url.searchParams)));
    else if(path==='/actions' && request.method==='POST') {
      await chargeUser(env,auth.user.id,'write');
      const result=await db.performAction(env,{userId:auth.user.id,sessionId:auth.rotated?.id||auth.session.id},await readJson(request,8192));
      try {
        if(result.action==='suspend_user')await forgetSocialUser(env,result.subjectUserId);
        const peers=result.subjectUserId?await friendIds(env,result.subjectUserId):[];
        await notifyUsers(env,[auth.user.id,result.subjectUserId,...peers,...(result.relatedUsers||[])].filter(Boolean),{type:'refresh',reason:'moderation'});
      } catch {/* Moderation is committed; reconnect/refresh also enforces it. */}
      response=json({ok:true,actionId:result.actionId});
    } else {
      const image=/^\/images\/([A-Za-z0-9_-]{1,100})\/([a-f0-9]{64})$/.exec(path);
      if(!image||request.method!=='GET')fail('NOT_FOUND',404);
      const found=await db.reviewImage(env,image[1],image[2]);if(!found)fail('NOT_FOUND',404);
      response=new Response(base64ToBytes(found.data_base64),{headers:{'content-type':'image/jpeg','cache-control':'no-store',
        'x-content-type-options':'nosniff','content-security-policy':"default-src 'none'; sandbox"}});
    }
    return withRotation(response,auth.rotated);
  } catch(error){return withRotation(errorResponse(error),auth.rotated);}
}

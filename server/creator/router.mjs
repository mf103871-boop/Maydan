import { fail } from '../room-model.mjs';
import { json, readJson, errorResponse } from '../protocol.mjs';
import { requireSession, withRotation } from '../accounts/session.mjs';
import { collectionEnabled, missingCreatorSchema } from './access.mjs';
import { creatorAnalytics, recordPresence } from './db.mjs';

export const isCreatorPath = path => path === '/api/creator/analytics' || path === '/api/creator/presence';
export async function routeCreator(request,env,url=new URL(request.url),charge) {
  if (!isCreatorPath(url.pathname)) return null;
  if (!env.DB || !collectionEnabled(env)) fail('CREATOR_UNAVAILABLE',503);
  const analytics = url.pathname === '/api/creator/analytics';
  if (request.method !== (analytics?'GET':'POST')) fail('NOT_FOUND',404);
  if (charge) await charge(analytics?'creatorReadIP':'creatorPresenceIP');
  const auth = await requireSession(env,request), actor = {userId:auth.user.id,sessionId:auth.session.id,secretHash:auth.session.secret_hash};
  try {
    if (url.search) fail('INVALID',400);
    if (charge) await charge(analytics?'creatorRead':'creatorPresence','RATE_LIMIT',actor.userId);
    const value = analytics ? await creatorAnalytics(env,actor) : await recordPresence(env,actor,await readJson(request,512));
    return withRotation(json(value,200),auth.rotated);
  } catch (error) {
    return withRotation(missingCreatorSchema(error)?json({error:'CREATOR_UNAVAILABLE'},503):errorResponse(error),auth.rotated);
  }
}

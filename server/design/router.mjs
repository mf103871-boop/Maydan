import { fail } from '../room-model.mjs';
import { requireSession, readSession, withRotation } from '../accounts/session.mjs';
import { readJson, json, errorResponse } from '../protocol.mjs';
import { isDesignEditor, publishEnabled } from './access.mjs';
import * as db from './db.mjs';
import { isPublicDesignAssetPath, assetResponse, uploadAsset, listAssets } from './assets.mjs';
export { isPublicDesignAssetPath } from './assets.mjs';

const body = async (request, allowed) => {
  const value = await readJson(request, 512 * 1024);
  if (Object.keys(value).some(key => !allowed.includes(key))) fail('INVALID', 400);
  return value;
};
export async function routeDesign(request, env, url = new URL(request.url), charge) {
  const config = url.pathname === '/api/ui-config';
  if (!config && !url.pathname.startsWith('/api/design/')) return null;
  if (!env.DB && !config) fail('NOT_FOUND', 404);
  const publicAsset = isPublicDesignAssetPath(url.pathname) && ['GET','HEAD'].includes(request.method);
  if (config && request.method !== 'GET') fail('NOT_FOUND', 404);
  const writing=!config && !publicAsset && !['GET','HEAD'].includes(request.method);
  if (charge) await charge(writing ? 'designWriteIP' : 'designRead');
  let auth = null;
  try {
    if (config || publicAsset) {
      // A stale Authorization header must not silently expose a different account's preview.
      auth = env.DB ? await readSession(env, request) : null;
      const editorId = auth && isDesignEditor(env, auth.user.id) ? auth.user.id : null;
      if (publicAsset) return withRotation(await assetResponse(env, request, url.pathname.split('/').at(-1), editorId ? {userId:editorId,sessionId:auth.rotated?.id||auth.session.id} : null), auth?.rotated);
      const number = key => { const values = url.searchParams.getAll(key); return values.length === 0 ? 1 : values.length === 1 && /^\d{1,6}$/.test(values[0]) ? Number(values[0]) : 0; };
      return withRotation(json(await db.configOf(env, { schemaVersion: number('schemaVersion'), registryVersion: number('registryVersion'), editorId }), 200, { vary: 'Authorization, Origin' }), auth?.rotated);
    }
    auth = await requireSession(env, request);
    const allowed = isDesignEditor(env, auth.user.id);
    if (url.pathname === '/api/design/me' && request.method === 'GET') {
      const preview = allowed ? await db.first(env, 'SELECT version_id FROM design_previews WHERE user_id=?', auth.user.id) : null;
      const published = allowed ? await db.publicationOf(env) : null;
      return withRotation(json({ allowed, publishEnabled: allowed && publishEnabled(env), previewVersionId: preview?.version_id || null, ...(published ? {publishedVersionId: published.versionId, publishedRevision: published.revision} : {}) }), auth.rotated);
    }
    if (!allowed) fail('FORBIDDEN', 403);
    if(writing && charge)await charge('designWrite','RATE_LIMIT',auth.user.id);
    const actor = { userId: auth.user.id, sessionId: auth.rotated?.id || auth.session.id };
    const path = url.pathname.slice('/api/design'.length); let result, status = 200;
    if (path === '/draft' && request.method === 'GET') result = await db.draftOf(env);
    else if (path === '/draft' && request.method === 'PUT') { const value = await body(request, ['document','expectedRevision']); result = await db.saveDraft(env, actor, value.document, value.expectedRevision); }
    else if (path === '/versions' && request.method === 'GET') result = await db.versionsOf(env);
    else if (path === '/versions' && request.method === 'POST') { const value = await body(request, ['name','expectedRevision']); result = await db.createVersion(env, actor, value.name, value.expectedRevision); status = 201; }
    else if (/^\/versions\/[A-Za-z0-9_-]{1,80}$/.test(path) && request.method === 'GET') result = { version: await db.versionOf(env, path.split('/').at(-1)) };
    else if (path === '/preview' && request.method === 'PUT') { const value = await body(request, ['versionId']); result = await db.setPreview(env, actor, db.idOf(value.versionId)); }
    else if (path === '/preview' && request.method === 'DELETE') result = await db.setPreview(env, actor, null);
    else if (['/publish','/rollback'].includes(path) && request.method === 'POST') { const value = await body(request, ['versionId','expectedPublished']); result = await db.publishVersion(env, actor, db.idOf(value.versionId), value.expectedPublished, path === '/rollback'); }
    else if (path === '/assets' && request.method === 'GET') result = await listAssets(env);
    else if (path === '/assets' && request.method === 'POST') { result = await uploadAsset(env, actor, request); status = 201; }
    else fail('NOT_FOUND', 404);
    return withRotation(json(result, status), auth.rotated);
  } catch (error) { return withRotation(errorResponse(error), auth?.rotated); }
}

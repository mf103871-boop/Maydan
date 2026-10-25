import { fail } from '../room-model.mjs';
import { sanitizeStudioImage, readImageBody } from './images.mjs';
import { writeGuard, requireEditor, isDesignEditor } from './access.mjs';
import { stmt, first, idOf } from './db.mjs';

export const isPublicDesignAssetPath = pathname => /^\/api\/design\/assets\/[A-Za-z0-9_-]{1,80}$/.test(pathname);
const publicMembership = alias => `EXISTS(SELECT 1 FROM design_publication p JOIN design_version_assets va ON va.version_id=p.version_id WHERE p.id='main' AND va.asset_id=${alias}.id)`;
const assetView = row => ({ id: row.id, name: row.name, url: `/api/design/assets/${row.id}`, mime: row.mime, width: row.width, height: row.height, byteLength: row.byte_length, sha256: row.sha256, createdAt: row.created_at, published: !!row.is_public });
export async function listAssets(env) { return { assets: ((await env.DB.prepare(`SELECT a.*,${publicMembership('a')} AS is_public FROM design_assets a WHERE a.ready_at IS NOT NULL ORDER BY a.created_at DESC,a.id DESC LIMIT 200`).all()).results || []).map(assetView) }; }
export async function uploadAsset(env, actor, request, now = Date.now()) {
  requireEditor(env, actor); if (!env.SOCIAL_AUDIO) fail('STORAGE_UNAVAILABLE', 503);
  const mime = request.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  if (!['image/png','image/jpeg','image/webp'].includes(mime)) fail('IMAGE_TYPE', 415);
  const image = sanitizeStudioImage(await readImageBody(request), mime);
  let name = request.headers.get('x-design-name') || 'صورة';
  try { name = decodeURIComponent(name); } catch { fail('INVALID', 400); }
  name = [...name.normalize('NFC').replace(/[\u0000-\u001f\u007f]/g, '').trim()].slice(0, 120).join('') || 'صورة';
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', image.bytes))].map(value => value.toString(16).padStart(2,'0')).join('');
  const id = crypto.randomUUID(), key = `studio-assets/${id}`, receiptId = crypto.randomUUID();
  // Reserve under the live session before sending private bytes to storage.
  let guard = writeGuard(env, actor, now);
  await stmt(env, `INSERT INTO design_assets(id,object_key,name,mime,width,height,byte_length,sha256,created_by,created_at) SELECT ?,?,?,?,?,?,?,?,?,? WHERE ${guard.sql}`, id, key, name, mime, image.width, image.height, image.bytes.length, hash, actor.userId, now, ...guard.args).run();
  if (!await first(env, 'SELECT id FROM design_assets WHERE id=?', id)) fail('FORBIDDEN', 403);
  try {
    await env.SOCIAL_AUDIO.put(key, image.bytes, { httpMetadata: { contentType: mime }, customMetadata: { sha256: hash } });
    guard = writeGuard(env, actor, Date.now());
    await env.DB.batch([
      stmt(env, `INSERT INTO design_actions(id,actor_id,action,created_at) SELECT ?,?,'upload_asset',? WHERE ${guard.sql} AND EXISTS(SELECT 1 FROM design_assets WHERE id=? AND ready_at IS NULL)`, receiptId, actor.userId, now, ...guard.args, id),
      stmt(env, 'UPDATE design_assets SET ready_at=? WHERE id=? AND EXISTS(SELECT 1 FROM design_actions WHERE id=?)', now, id, receiptId),
    ]);
    const row = await first(env, 'SELECT * FROM design_assets WHERE id=? AND ready_at IS NOT NULL', id);
    if (!row) fail('FORBIDDEN', 403);
    return { asset: assetView(row), receipt: { id: receiptId, action: 'upload_asset', createdAt: now, assetId: id } };
  } catch (error) {
    // A transport failure may happen after the D1 transaction committed. Never
    // remove bytes from a finalized asset, or guess when D1 cannot be read.
    const saved = await first(env, 'SELECT ready_at FROM design_assets WHERE id=?', id).catch(() => undefined);
    if (saved !== undefined && !saved?.ready_at) {
      try { await env.SOCIAL_AUDIO.delete(key); } catch { /* A failed upload remains private and unreachable. */ }
      await stmt(env, 'DELETE FROM design_assets WHERE id=? AND ready_at IS NULL', id).run();
    }
    throw error;
  }
}
async function authorizedAsset(env,id,actor) {
  const guard=actor && isDesignEditor(env,actor.userId)?writeGuard(env,actor,Date.now()):null;
  const row=await first(env,`SELECT a.*,${publicMembership('a')} AS is_public,${guard?`(${guard.sql})`:'0'} AS is_editor FROM design_assets a WHERE a.id=? AND a.ready_at IS NOT NULL`,...(guard?.args||[]),id);
  if(!row || !row.is_public && !row.is_editor)fail('NOT_FOUND',404);
  return row;
}
export async function assetResponse(env, request, id, actor = null) {
  idOf(id);
  let row=await authorizedAsset(env,id,actor);
  if (!env.SOCIAL_AUDIO) fail('STORAGE_UNAVAILABLE', 503);
  const object = await env.SOCIAL_AUDIO.get(row.object_key);
  if (!object) fail('NOT_FOUND', 404);
  // Publication, role, account or session can be revoked during R2 network IO.
  // Recheck before exposing bytes, using the current publication for cache rules.
  try { row=await authorizedAsset(env,id,actor); }
  catch(error) { await object.body?.cancel?.().catch(()=>{});throw error; }
  // Publication membership can change on rollback; neither edge nor browser may
  // retain a public authorization decision after that change.
  return new Response(request.method === 'HEAD' ? null : object.body, { headers: { 'content-type': row.mime, 'content-length': String(row.byte_length), 'cache-control': row.is_public ? 'no-store' : 'private, no-store', etag: `"${row.sha256}"`, 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; sandbox", 'cross-origin-resource-policy': 'cross-origin' } });
}

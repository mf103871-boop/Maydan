import { fail } from '../room-model.mjs';
import { sha256 } from '../protocol.mjs';
import { validateDesignDocument, DESIGN_LIMITS } from '../../src/design/schema.js';
import { requireEditor, writeGuard, publishEnabled, isDesignEditor } from './access.mjs';

export const MAX_DOCUMENT_BYTES = DESIGN_LIMITS.bytes;
export const stmt = (env, sql, ...args) => env.DB.prepare(sql).bind(...args);
export const first = (env, sql, ...args) => stmt(env, sql, ...args).first();
const all = async (env, sql, ...args) => (await stmt(env, sql, ...args).all()).results || [];
const parsed = value => value ? JSON.parse(value) : null;
export const revisionOf = value => { if (!Number.isSafeInteger(value) || value < 0) fail('INVALID', 400); return value; };
export const idOf = value => { if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(value)) fail('INVALID', 400); return value; };
export function documentOf(value) {
  if (new TextEncoder().encode(JSON.stringify(value)).length > MAX_DOCUMENT_BYTES) fail('INVALID', 413);
  const checked = validateDesignDocument(value);
  if (!checked.ok) fail('DESIGN_INVALID', 400, { errors: checked.errors });
  return checked.document;
}
export function assetIdsOf(document) {
  const ids = document.assets || [];
  if (!Array.isArray(ids) || ids.length > 200 || ids.some(id => typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(id)) || new Set(ids).size !== ids.length) fail('DESIGN_INVALID', 400);
  return ids;
}
async function validateAssets(env, document) {
  const ids = assetIdsOf(document);
  if (!ids.length) return;
  const found = await first(env, 'SELECT COUNT(*) AS n FROM design_assets WHERE id IN (SELECT value FROM json_each(?)) AND ready_at IS NOT NULL', JSON.stringify(ids));
  if (found.n !== ids.length) fail('ASSET_NOT_FOUND', 400);
}
export async function draftOf(env) {
  const row = await first(env, "SELECT document_json,revision,updated_by,updated_at FROM design_draft WHERE id='main'");
  return { document: parsed(row?.document_json), revision: row?.revision || 0, updatedBy: row?.updated_by || null, updatedAt: row?.updated_at || null };
}
export const publicationOf = async env => { const row = await first(env, "SELECT version_id,revision,updated_at FROM design_publication WHERE id='main'"); return { versionId: row?.version_id || null, revision: row?.revision || 0, updatedAt: row?.updated_at || null }; };
const receiptOf = (id, action, now, values = {}) => ({ id, action, createdAt: now, ...values });
async function assertReceipt(env, id) { if (!await first(env, 'SELECT id FROM design_actions WHERE id=?', id)) fail('CONFLICT', 409); }
export async function saveDraft(env, actor, document, expectedRevision, now = Date.now()) {
  requireEditor(env, actor); revisionOf(expectedRevision); document = documentOf(document); await validateAssets(env, document);
  const guard = writeGuard(env, actor, now), id = crypto.randomUUID();
  await env.DB.batch([
    stmt(env, `INSERT INTO design_actions(id,actor_id,action,draft_revision,created_at) SELECT ?,?,'save_draft',?,? WHERE ${guard.sql} AND EXISTS(SELECT 1 FROM design_draft WHERE id='main' AND revision=?)`, id, actor.userId, expectedRevision + 1, now, ...guard.args, expectedRevision),
    stmt(env, "UPDATE design_draft SET document_json=?,revision=revision+1,updated_by=?,updated_at=? WHERE id='main' AND revision=? AND EXISTS(SELECT 1 FROM design_actions WHERE id=?)", JSON.stringify(document), actor.userId, now, expectedRevision, id),
  ]);
  await assertReceipt(env, id);
  return { document, revision: expectedRevision + 1, receipt: receiptOf(id, 'save_draft', now, { revision: expectedRevision + 1 }) };
}
export async function versionsOf(env) {
  const versions = await all(env, `SELECT id,name,document_hash AS documentHash,schema_version AS schemaVersion,registry_version AS registryVersion,source_revision AS sourceRevision,created_by AS createdBy,created_at AS createdAt FROM design_versions ORDER BY created_at DESC,id DESC LIMIT 100`);
  return { versions, published: await publicationOf(env) };
}
export async function createVersion(env, actor, name, expectedRevision, now = Date.now()) {
  requireEditor(env, actor); revisionOf(expectedRevision);
  if (typeof name !== 'string' || !name.trim() || [...name.trim()].length > 80 || /[\u0000-\u001f\u007f]/.test(name)) fail('INVALID', 400);
  const draft = await draftOf(env);
  if (draft.revision !== expectedRevision || !draft.document) fail('CONFLICT', 409);
  const document = documentOf(draft.document); await validateAssets(env, document);
  const serialized = JSON.stringify(document), hash = await sha256(serialized), versionId = crypto.randomUUID(), id = crypto.randomUUID(), guard = writeGuard(env, actor, now);
  const statements = [
    stmt(env, `INSERT INTO design_actions(id,actor_id,action,version_id,draft_revision,created_at) SELECT ?,?,'create_version',?,?,? WHERE ${guard.sql} AND EXISTS(SELECT 1 FROM design_draft WHERE id='main' AND revision=? AND document_json=?)`, id, actor.userId, versionId, expectedRevision, now, ...guard.args, expectedRevision, serialized),
    stmt(env, `INSERT INTO design_versions(id,name,document_json,document_hash,schema_version,registry_version,source_revision,created_by,created_at) SELECT ?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM design_actions WHERE id=?)`, versionId, name.trim(), serialized, hash, document.schemaVersion, document.registryVersion, expectedRevision, actor.userId, now, id),
    stmt(env, 'INSERT INTO design_version_assets(version_id,asset_id) SELECT ?,value FROM json_each(?) WHERE EXISTS(SELECT 1 FROM design_actions WHERE id=?)', versionId, JSON.stringify(assetIdsOf(document)), id),
  ];
  await env.DB.batch(statements); await assertReceipt(env, id);
  return { version: { id: versionId, name: name.trim(), document, documentHash: hash, schemaVersion: document.schemaVersion, registryVersion: document.registryVersion, sourceRevision: expectedRevision, createdBy: actor.userId, createdAt: now }, receipt: receiptOf(id, 'create_version', now, { versionId }) };
}
export async function versionOf(env, id) {
  const row = await first(env, 'SELECT id,name,document_json,document_hash FROM design_versions WHERE id=?', idOf(id));
  if (!row) fail('NOT_FOUND', 404);
  return { id: row.id, name: row.name, document: parsed(row.document_json), documentHash: row.document_hash };
}
export async function setPreview(env, actor, versionId, now = Date.now()) {
  requireEditor(env, actor); if (versionId !== null) await versionOf(env, versionId);
  const guard = writeGuard(env, actor, now), id = crypto.randomUUID();
  const statements = [stmt(env, `INSERT INTO design_actions(id,actor_id,action,version_id,created_at) SELECT ?,?,'preview',?,? WHERE ${guard.sql}`, id, actor.userId, versionId, now, ...guard.args)];
  statements.push(versionId === null
    ? stmt(env, 'DELETE FROM design_previews WHERE user_id=? AND EXISTS(SELECT 1 FROM design_actions WHERE id=?)', actor.userId, id)
    : stmt(env, `INSERT INTO design_previews(user_id,version_id,updated_at) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM design_actions WHERE id=?) ON CONFLICT(user_id) DO UPDATE SET version_id=excluded.version_id,updated_at=excluded.updated_at`, actor.userId, versionId, now, id));
  await env.DB.batch(statements); await assertReceipt(env, id);
  return { versionId, receipt: receiptOf(id, 'preview', now, { versionId }) };
}
export async function publishVersion(env, actor, versionId, expectedPublished, rollback = false, now = Date.now()) {
  requireEditor(env, actor);
  if (!publishEnabled(env)) fail('PUBLISH_DISABLED', 403);
  if (expectedPublished !== null) idOf(expectedPublished);
  const version = await versionOf(env, versionId); documentOf(version.document); await validateAssets(env, version.document);
  if (expectedPublished === undefined) fail('INVALID', 400);
  if (!publishEnabled(env)) fail('PUBLISH_DISABLED', 403);
  const guard = writeGuard(env, actor, now), id = crypto.randomUUID(), action = rollback ? 'rollback' : 'publish';
  const statements = [
    stmt(env, `INSERT INTO design_actions(id,actor_id,action,version_id,previous_version_id,published_revision,created_at) SELECT ?,?,?,?,?,p.revision+1,? FROM design_publication p WHERE p.id='main' AND p.version_id IS ? AND ${guard.sql}`, id, actor.userId, action, versionId, expectedPublished, now, expectedPublished, ...guard.args),
    stmt(env, "UPDATE design_publication SET version_id=?,revision=revision+1,updated_by=?,updated_at=? WHERE id='main' AND version_id IS ? AND EXISTS(SELECT 1 FROM design_actions WHERE id=?)", versionId, actor.userId, now, expectedPublished, id),
    stmt(env, 'UPDATE design_assets SET published_at=COALESCE(published_at,?) WHERE id IN (SELECT asset_id FROM design_version_assets WHERE version_id=?) AND EXISTS(SELECT 1 FROM design_actions WHERE id=?)', now, versionId, id),
  ];
  await env.DB.batch(statements); await assertReceipt(env, id);
  const published = await publicationOf(env);
  return { ...published, receipt: receiptOf(id, action, now, published) };
}
export async function configOf(env, { schemaVersion = 1, registryVersion = 1, editorId = null } = {}) {
  const fallback = { document: null, versionId: null, channel: 'default', revision: 0 };
  if (schemaVersion !== 1 || registryVersion !== 1 || !env.DB) return fallback;
  if (editorId && isDesignEditor(env, editorId)) {
    const preview = await first(env, `SELECT v.id,v.document_json FROM design_previews p JOIN design_versions v ON v.id=p.version_id JOIN users u ON u.id=p.user_id WHERE p.user_id=? AND NOT EXISTS(SELECT 1 FROM account_deletions WHERE user_id=p.user_id) AND NOT EXISTS(SELECT 1 FROM moderation_suspensions WHERE user_id=p.user_id) AND v.schema_version=? AND v.registry_version=?`, editorId, schemaVersion, registryVersion);
    if (preview) return { document: documentOf(parsed(preview.document_json)), versionId: preview.id, channel: 'preview', revision: null };
  }
  const found = await first(env, `SELECT v.id,v.document_json,p.revision FROM design_publication p JOIN design_versions v ON v.id=p.version_id WHERE p.id='main' AND v.schema_version=? AND v.registry_version=?`, schemaVersion, registryVersion);
  if (!found) return fallback;
  return { document: documentOf(parsed(found.document_json)), versionId: found.id, channel: 'published', revision: found.revision };
}

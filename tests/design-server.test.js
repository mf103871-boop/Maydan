import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { createLocalD1 } from '../server/local-d1.mjs';
import { issueSession } from '../server/accounts/session.mjs';
import { deleteUser } from '../server/accounts/db.mjs';
import { routeDesign } from '../server/design/router.mjs';
import { saveDraft, createVersion, publishVersion, configOf, setPreview } from '../server/design/db.mjs';
import { sanitizeStudioImage, MAX_IMAGE_BYTES } from '../server/design/images.mjs';

const document = () => ({ schemaVersion: 1, registryVersion: 1, tokens: {}, screens: {}, assets: [] });
async function fixture() {
  const DB = createLocalD1(), objects = new Map();
  const env = { DB, DESIGN_EDITOR_USER_IDS: 'editor', DESIGN_PUBLISH_ENABLED: '0', SOCIAL_AUDIO: {
    async put(key, value) { objects.set(key, new Uint8Array(value)); },
    async get(key) { const bytes = objects.get(key); return bytes ? { body: bytes } : null; },
    async delete(key) { objects.delete(key); },
  } };
  const sessions = {};
  for (const id of ['editor','player','moderator']) { await DB.prepare('INSERT INTO users(id,name,created_at,updated_at) VALUES(?,?,?,?)').bind(id,id,Date.now(),Date.now()).run(); sessions[id] = await issueSession(env, id); }
  const actor = { userId: 'editor', sessionId: sessions.editor.id };
  const call = (path, method = 'GET', body, user = 'editor') => {
    const headers = { ...(user ? { authorization: `Bearer ${sessions[user].token}` } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) };
    const request = new Request(`https://maydan.test${path}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    return routeDesign(request, env);
  };
  return { DB, env, sessions, actor, call, objects };
}
test('Studio requires an explicitly allowed existing account, not moderator or group ownership', async () => {
  const f = await fixture();
  try {
    f.env.MODERATOR_USER_IDS = 'moderator';
    assert.equal((await f.call('/api/design/me', 'GET', undefined, 'player')).status, 200);
    assert.deepEqual(await (await f.call('/api/design/me', 'GET', undefined, 'player')).json(), { allowed: false, publishEnabled: false, previewVersionId: null });
    assert.equal((await f.call('/api/design/draft', 'GET', undefined, 'moderator')).status, 403);
    assert.equal((await f.call('/api/design/draft', 'GET', undefined, null)).status, 401);
    assert.equal((await f.call('/api/design/draft')).status, 200);
    f.env.DESIGN_EDITOR_USER_IDS = '';
    assert.equal((await f.call('/api/design/draft')).status, 403);
  } finally { f.DB.close(); }
});
test('draft saves use optimistic revision checks and immutable named snapshots', async () => {
  const f = await fixture();
  try {
    assert.equal((await (await f.call('/api/design/draft')).json()).revision, 0);
    const saved = await saveDraft(f.env, f.actor, document(), 0); assert.equal(saved.revision, 1); assert.ok(saved.receipt.id);
    await assert.rejects(saveDraft(f.env, f.actor, document(), 0), error => error.code === 'CONFLICT');
    const version = (await createVersion(f.env, f.actor, 'نسخة أولى', 1)).version;
    await saveDraft(f.env, f.actor, document(), 1);
    assert.equal((await (await f.call(`/api/design/versions/${version.id}`)).json()).version.documentHash, version.documentHash);
    assert.equal((await f.call('/api/design/versions', 'POST', { name: 'قديمة', expectedRevision: 1 })).status, 409);
    assert.equal((await f.call('/api/design/draft', 'PUT', { document: { ...document(), injected: '<script>' }, expectedRevision: 2 })).status, 400);
  } finally { f.DB.close(); }
});
test('owner preview is opt in, account scoped and never changes public published configuration', async () => {
  const f = await fixture();
  try {
    await saveDraft(f.env, f.actor, document(), 0); const version = (await createVersion(f.env, f.actor, 'معاينة', 1)).version;
    assert.equal((await configOf(f.env, { editorId: 'editor' })).channel, 'default');
    await setPreview(f.env, f.actor, version.id);
    assert.equal((await configOf(f.env, { editorId: 'editor' })).channel, 'preview');
    assert.equal((await configOf(f.env, { editorId: 'player' })).channel, 'default');
    assert.equal((await (await f.call('/api/ui-config', 'GET', undefined, null)).json()).channel, 'default');
    assert.equal((await (await f.call('/api/ui-config?schemaVersion=2&registryVersion=1')).json()).document, null);
    f.env.DESIGN_EDITOR_USER_IDS = ''; assert.equal((await configOf(f.env, { editorId: 'editor' })).channel, 'default');
    f.env.DESIGN_EDITOR_USER_IDS = 'editor'; await setPreview(f.env, f.actor, null);
    assert.equal((await configOf(f.env, { editorId: 'editor' })).channel, 'default');
  } finally { f.DB.close(); }
});
test('publication requires the physical-phone gate, is atomic and rolls back to an immutable snapshot', async () => {
  const f = await fixture();
  try {
    await saveDraft(f.env, f.actor, document(), 0);
    const first = (await createVersion(f.env, f.actor, 'أ', 1)).version;
    const second = (await createVersion(f.env, f.actor, 'ب', 1)).version;
    await assert.rejects(publishVersion(f.env, f.actor, first.id, null), error => error.code === 'PUBLISH_DISABLED');
    assert.equal((await configOf(f.env)).channel, 'default');
    f.env.DESIGN_PUBLISH_ENABLED = '1';
    const published = await publishVersion(f.env, f.actor, first.id, null); assert.equal(published.revision, 1);
    await assert.rejects(publishVersion(f.env, f.actor, second.id, null), error => error.code === 'CONFLICT');
    await publishVersion(f.env, f.actor, second.id, first.id); assert.equal((await configOf(f.env)).versionId, second.id);
    const rollback = await publishVersion(f.env, f.actor, first.id, second.id, true); assert.equal(rollback.receipt.action, 'rollback'); assert.equal(rollback.revision, 3);
    assert.equal((await configOf(f.env)).versionId, first.id);
    const batch = f.DB.batch.bind(f.DB); f.DB.batch = async () => { throw new Error('D1 outage'); };
    await assert.rejects(publishVersion(f.env, f.actor, second.id, first.id), /D1 outage/); f.DB.batch = batch;
    assert.equal((await configOf(f.env)).versionId, first.id);
  } finally { f.DB.close(); }
});
test('owner metadata returns a fresh publication head for second publish and rollback after reload',async()=>{
  const f=await fixture();try{
    await saveDraft(f.env,f.actor,document(),0);const a=(await createVersion(f.env,f.actor,'أ',1)).version,b=(await createVersion(f.env,f.actor,'ب',1)).version;
    f.env.DESIGN_PUBLISH_ENABLED='1';let me=await(await f.call('/api/design/me')).json();assert.equal(me.publishedVersionId,null);assert.equal(me.publishedRevision,0);
    assert.equal((await f.call('/api/design/publish','POST',{versionId:a.id,expectedPublished:me.publishedVersionId})).status,200);
    me=await(await f.call('/api/design/me')).json();assert.equal(me.publishedVersionId,a.id);assert.equal(me.publishedRevision,1);
    assert.equal((await f.call('/api/design/publish','POST',{versionId:b.id,expectedPublished:me.publishedVersionId})).status,200);
    me=await(await f.call('/api/design/me')).json();assert.equal(me.publishedVersionId,b.id);assert.equal(me.publishedRevision,2);
    assert.equal((await f.call('/api/design/rollback','POST',{versionId:a.id,expectedPublished:me.publishedVersionId})).status,200);
    assert.equal((await(await f.call('/api/design/me')).json()).publishedRevision,3);
  }finally{f.DB.close();}
});
test('design reads and owner writes use independent quotas without charging the generic profile bucket',async()=>{
  const f=await fixture();try{
    const seen=[],charge=async(...args)=>seen.push(args),make=(method,token=f.sessions.editor.token)=>new Request('https://maydan.test/api/design/draft',{method,headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},...(method==='PUT'?{body:JSON.stringify({document:document(),expectedRevision:0})}:{})});
    assert.equal((await routeDesign(make('GET'),f.env,undefined,charge)).status,200);assert.deepEqual(seen,[['designRead']]);seen.length=0;
    assert.equal((await routeDesign(make('PUT'),f.env,undefined,charge)).status,200);assert.deepEqual(seen,[['designWriteIP'],['designWrite','RATE_LIMIT','editor']]);seen.length=0;
    assert.equal((await routeDesign(make('PUT',f.sessions.player.token),f.env,undefined,charge)).status,403);assert.deepEqual(seen,[['designWriteIP']]);
  }finally{f.DB.close();}
});
test('every write checks account/session liveness inside the D1 transaction', async () => {
  for (const mutation of ['revoked','suspended','deleted']) {
    const f = await fixture();
    try {
      const originalBatch = f.DB.batch.bind(f.DB);
      f.DB.batch = async statements => {
        if (mutation === 'revoked') await f.DB.prepare('UPDATE sessions SET revoked_at=1 WHERE id=?').bind(f.actor.sessionId).run();
        if (mutation === 'suspended') await f.DB.prepare('INSERT INTO moderation_suspensions(user_id,actor_id,reason,created_at,updated_at) VALUES(?,?,?,?,?)').bind('editor','moderator','تعليق',1,1).run();
        if (mutation === 'deleted') await f.DB.prepare('DELETE FROM users WHERE id=?').bind('editor').run();
        return originalBatch(statements);
      };
      await assert.rejects(saveDraft(f.env, f.actor, document(), 0), error => error.code === 'CONFLICT');
      assert.equal((await f.DB.prepare("SELECT revision FROM design_draft WHERE id='main'").first()).revision, 0);
      assert.equal((await f.DB.prepare('SELECT COUNT(*) AS n FROM design_actions').first()).n, 0);
    } finally { f.DB.close(); }
  }
});
test('uploads are bounded verified static images, metadata stripped, private until explicitly published', async () => {
  const f = await fixture();
  try {
    const bytes = await sharp({ create: { width: 64, height: 48, channels: 4, background: '#00aabb' } }).png().withMetadata({ exif: { IFD0: { Artist: 'private-author' } } }).toBuffer();
    const request = new Request('https://maydan.test/api/design/assets', { method: 'POST', headers: { authorization: `Bearer ${f.sessions.editor.token}`, 'content-type': 'image/png', 'x-design-name': encodeURIComponent('لوحة') }, body: bytes });
    const response = await routeDesign(request, f.env); assert.equal(response.status, 201); const { asset } = await response.json(); assert.equal(asset.width, 64); assert.equal(asset.height, 48); assert.equal(asset.name, 'لوحة');
    assert.equal((await f.call(asset.url, 'GET', undefined, null)).status, 404);
    const privateImage = await f.call(asset.url); assert.equal(privateImage.status, 200); assert.equal(privateImage.headers.get('cache-control'), 'private, no-store');
    assert.equal(Buffer.from(await privateImage.arrayBuffer()).includes(Buffer.from('private-author')), false);
    await saveDraft(f.env, f.actor, { ...document(), assets: [asset.id] }, 0); const version = (await createVersion(f.env, f.actor, 'صورة', 1)).version;
    assert.equal((await f.call(asset.url, 'GET', undefined, null)).status, 404);
    f.env.DESIGN_PUBLISH_ENABLED = '1'; await publishVersion(f.env, f.actor, version.id, null);
    const publicImage = await f.call(asset.url, 'GET', undefined, null); assert.equal(publicImage.status, 200); assert.equal(publicImage.headers.get('cache-control'), 'no-store');
    await assert.rejects(saveDraft(f.env, f.actor, { ...document(), assets: ['missing'] }, 1), error => error.code === 'ASSET_NOT_FOUND');
    await saveDraft(f.env, f.actor, document(), 1); const withoutImage = (await createVersion(f.env, f.actor, 'بلا صورة', 2)).version;
    await publishVersion(f.env, f.actor, withoutImage.id, version.id);
    assert.equal((await f.call(asset.url, 'GET', undefined, null)).status, 404);
    await publishVersion(f.env, f.actor, version.id, withoutImage.id, true);
    assert.equal((await f.call(asset.url, 'GET', undefined, null)).status, 200);
  } finally { f.DB.close(); }
});
test('asset authorization is rechecked after R2 IO for rollback, role removal and a revoked or deleted editor',async()=>{
  for(const change of ['rollback','role','session','deletion']){
    const f=await fixture();try{
      const bytes=await sharp({create:{width:8,height:8,channels:3,background:'#007788'}}).png().toBuffer();
      const uploaded=await routeDesign(new Request('https://maydan.test/api/design/assets',{method:'POST',headers:{authorization:`Bearer ${f.sessions.editor.token}`,'content-type':'image/png'},body:bytes}),f.env);
      const {asset}=await uploaded.json();assert.equal(uploaded.status,201);
      let replacement;
      if(change==='rollback'){
        await saveDraft(f.env,f.actor,document(),0);replacement=(await createVersion(f.env,f.actor,'أصل بلا صورة',1)).version;
        await saveDraft(f.env,f.actor,{...document(),assets:[asset.id]},1);const version=(await createVersion(f.env,f.actor,'صورة منشورة',2)).version;
        f.env.DESIGN_PUBLISH_ENABLED='1';await publishVersion(f.env,f.actor,version.id,null);
        replacement={versionId:replacement.id,expectedPublished:version.id};
      }
      const originalGet=f.env.SOCIAL_AUDIO.get;
      f.env.SOCIAL_AUDIO.get=async key=>{
        const object=await originalGet(key);
        if(change==='rollback')await publishVersion(f.env,f.actor,replacement.versionId,replacement.expectedPublished,true);
        if(change==='role')f.env.DESIGN_EDITOR_USER_IDS='';
        if(change==='session')await f.DB.prepare('UPDATE sessions SET revoked_at=1 WHERE id=?').bind(f.actor.sessionId).run();
        if(change==='deletion')await deleteUser(f.env,'editor');
        return object;
      };
      const response=await f.call(asset.url,'GET',undefined,change==='rollback'?null:'editor');
      assert.equal(response.status,404,change);
      assert.equal(response.headers.get('content-type'),'application/json; charset=utf-8');
      if(change==='session')assert.equal((await f.call(asset.url)).status,401,'a revoked token does not fall through to private asset access');
      assert.ok(f.objects.size===1,'authorization revocation preserves the shared file');
    }finally{f.DB.close();}
  }
});
test('account deletion removes preview and identifying attribution while preserving shared published designs and assets',async()=>{
  const f=await fixture();try{
    const bytes=await sharp({create:{width:8,height:8,channels:3,background:'#007788'}}).png().toBuffer();
    const response=await routeDesign(new Request('https://maydan.test/api/design/assets',{method:'POST',headers:{authorization:`Bearer ${f.sessions.editor.token}`,'content-type':'image/png'},body:bytes}),f.env);
    const {asset}=await response.json();await saveDraft(f.env,f.actor,{...document(),assets:[asset.id]},0);
    const version=(await createVersion(f.env,f.actor,'تصميم ميدان',1)).version;await setPreview(f.env,f.actor,version.id);
    f.env.DESIGN_PUBLISH_ENABLED='1';await publishVersion(f.env,f.actor,version.id,null);
    await deleteUser(f.env,'editor');
    assert.equal(await f.DB.prepare('SELECT id FROM users WHERE id=?').bind('editor').first(),null);
    assert.equal((await f.DB.prepare('SELECT COUNT(*) AS n FROM design_previews').first()).n,0);
    for(const [table,column] of [['design_draft','updated_by'],['design_publication','updated_by'],['design_versions','created_by'],['design_assets','created_by'],['design_actions','actor_id']])assert.equal((await f.DB.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${column}=?`).bind('editor').first()).n,0,table);
    assert.equal((await f.DB.prepare('SELECT created_by FROM design_versions WHERE id=?').bind(version.id).first()).created_by,'deleted-account');
    assert.equal((await configOf(f.env)).versionId,version.id);
    assert.equal((await configOf(f.env,{editorId:'editor'})).channel,'published');
    assert.equal((await f.call(asset.url,'GET',undefined,null)).status,200);
    assert.equal((await f.call('/api/design/draft')).status,401);
    assert.equal(f.objects.size,1);assert.ok((await f.DB.prepare('SELECT COUNT(*) AS n FROM design_actions').first()).n>0);
  }finally{f.DB.close();}
});
test('JPEG PNG WebP signatures, dimensions and 5 MB bounds are checked, SVG and animation refused', async () => {
  for (const [format,mime] of [['png','image/png'],['jpeg','image/jpeg'],['webp','image/webp']]) {
    const bytes = await sharp({ create: { width: 43, height: 31, channels: 3, background: '#dd8844' } })[format]().toBuffer();
    const checked = sanitizeStudioImage(new Uint8Array(bytes), mime); assert.equal(checked.width, 43); assert.equal(checked.height, 31);
    await sharp(checked.bytes).metadata();
    assert.throws(() => sanitizeStudioImage(new Uint8Array(bytes.subarray(0, -4)), mime), error => error.code === 'IMAGE_INVALID');
    assert.throws(() => sanitizeStudioImage(new Uint8Array(bytes), mime === 'image/png' ? 'image/jpeg' : 'image/png'), error => error.code === 'IMAGE_INVALID');
  }
  assert.throws(() => sanitizeStudioImage(new Uint8Array([60,115,118,103,62]), 'image/svg+xml'), error => error.code === 'IMAGE_TYPE');
  assert.throws(() => sanitizeStudioImage(new Uint8Array(MAX_IMAGE_BYTES + 1), 'image/png'), error => error.code === 'IMAGE_TOO_LARGE');
  const wide = await sharp({ create: { width: 4097, height: 2, channels: 3, background: '#000' } }).png().toBuffer();
  assert.throws(() => sanitizeStudioImage(new Uint8Array(wide), 'image/png'), error => error.code === 'IMAGE_INVALID');
});
test('revocation during R2 upload removes the private object and cannot finalize an asset', async () => {
  const f = await fixture();
  try {
    const put = f.env.SOCIAL_AUDIO.put;
    f.env.SOCIAL_AUDIO.put = async (...args) => { await put(...args); await f.DB.prepare('UPDATE sessions SET revoked_at=1 WHERE id=?').bind(f.actor.sessionId).run(); };
    const bytes = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#000' } }).png().toBuffer();
    const response = await routeDesign(new Request('https://maydan.test/api/design/assets', { method: 'POST', headers: { authorization: `Bearer ${f.sessions.editor.token}`, 'content-type': 'image/png' }, body: bytes }), f.env);
    assert.equal(response.status, 403); assert.equal(f.objects.size, 0); assert.equal((await f.DB.prepare('SELECT COUNT(*) AS n FROM design_assets').first()).n, 0);
  } finally { f.DB.close(); }
});
test('concurrent draft saves and publications cannot overwrite a newer committed head', async () => {
  const f = await fixture();
  try {
    // Local SQLite exposes one connection; serialize transactions as D1 does,
    // while preserving the competing requests' independent preflight reads.
    const batch = f.DB.batch.bind(f.DB); let tail = Promise.resolve();
    f.DB.batch = statements => { const run = tail.then(() => batch(statements)); tail = run.catch(() => {}); return run; };
    const saves = await Promise.allSettled([saveDraft(f.env, f.actor, document(), 0), saveDraft(f.env, f.actor, document(), 0)]);
    assert.equal(saves.filter(value => value.status === 'fulfilled').length, 1);
    assert.equal(saves.find(value => value.status === 'rejected').reason.code, 'CONFLICT');
    const a = (await createVersion(f.env, f.actor, 'أ', 1)).version;
    const b = (await createVersion(f.env, f.actor, 'ب', 1)).version;
    f.env.DESIGN_PUBLISH_ENABLED = '1';
    const publishes = await Promise.allSettled([publishVersion(f.env, f.actor, a.id, null), publishVersion(f.env, f.actor, b.id, null)]);
    assert.equal(publishes.filter(value => value.status === 'fulfilled').length, 1);
    assert.equal(publishes.find(value => value.status === 'rejected').reason.code, 'CONFLICT');
    assert.equal((await f.DB.prepare("SELECT revision FROM design_publication WHERE id='main'").first()).revision, 1);
  } finally { f.DB.close(); }
});
test('publication liveness fencing applies to the head, audit and asset visibility together', async () => {
  const f = await fixture();
  try {
    await saveDraft(f.env, f.actor, document(), 0); const version = (await createVersion(f.env, f.actor, 'محاولة', 1)).version;
    f.env.DESIGN_PUBLISH_ENABLED = '1'; const batch = f.DB.batch.bind(f.DB);
    f.DB.batch = async statements => { await f.DB.prepare('UPDATE sessions SET revoked_at=1 WHERE id=?').bind(f.actor.sessionId).run(); return batch(statements); };
    await assert.rejects(publishVersion(f.env, f.actor, version.id, null), error => error.code === 'CONFLICT');
    assert.equal((await configOf(f.env)).channel, 'default');
    assert.equal((await f.DB.prepare("SELECT COUNT(*) AS n FROM design_actions WHERE action='publish'").first()).n, 0);
  } finally { f.DB.close(); }
});
test('API contracts reject unknown input, missing OCC tokens, duplicate capability and oversized images', async () => {
  const f = await fixture();
  try {
    for (const value of [{ document: document() }, { document: document(), expectedRevision: '0' }, { document: document(), expectedRevision: 0, owner: 'editor' }]) assert.equal((await f.call('/api/design/draft', 'PUT', value)).status, 400);
    assert.equal((await f.call('/api/design/preview', 'PUT', { versionId: 'not-found' })).status, 404);
    const config = await f.call('/api/ui-config?schemaVersion=1&schemaVersion=1'); assert.equal((await config.json()).channel, 'default'); assert.equal(config.headers.get('cache-control'), 'no-store');
    const invalidType = await routeDesign(new Request('https://maydan.test/api/design/assets', { method: 'POST', headers: { authorization: `Bearer ${f.sessions.editor.token}`, 'content-type': 'image/svg+xml' }, body: '<svg></svg>' }), f.env);
    assert.equal(invalidType.status, 415);
    const tooLarge = await routeDesign(new Request('https://maydan.test/api/design/assets', { method: 'POST', headers: { authorization: `Bearer ${f.sessions.editor.token}`, 'content-type': 'image/png', 'content-length': String(MAX_IMAGE_BYTES + 1) }, body: 'x' }), f.env);
    assert.equal(tooLarge.status, 413); assert.equal(f.objects.size, 0);
  } finally { f.DB.close(); }
});
test('a lost response after a successful R2/D1 finalization cannot delete the saved image', async () => {
  const f = await fixture();
  try {
    const batch = f.DB.batch.bind(f.DB); f.DB.batch = async statements => { const result = await batch(statements); if (statements.some(statement => statement.sql.includes("'upload_asset'"))) throw new Error('lost committed response'); return result; };
    const bytes = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#000' } }).png().toBuffer();
    const response = await routeDesign(new Request('https://maydan.test/api/design/assets', { method: 'POST', headers: { authorization: `Bearer ${f.sessions.editor.token}`, 'content-type': 'image/png' }, body: bytes }), f.env);
    assert.equal(response.status, 500); assert.equal(f.objects.size, 1); assert.equal((await f.DB.prepare('SELECT COUNT(*) AS n FROM design_assets WHERE ready_at IS NOT NULL').first()).n, 1);
    const listing = await (await f.call('/api/design/assets')).json(); assert.equal(listing.assets.length, 1); assert.equal(listing.assets[0].published, false);
  } finally { f.DB.close(); }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createStudioApi, StudioError, isStudioSessionRotation } from '../src/studio/api.js';
function fixture(initial = `token-${Math.random()}`) { let token = initial; const store = { readSession: () => token, writeSession: (next) => { token = next; } }; return { store, get token() { return token; } }; }

test('studio refusesanonymousrequests beforefetch', async () => { let called = false; const request = createStudioApi({ store: fixture(null).store, fetchImpl: () => { called = true; } }); await assert.rejects(request('/api/design/me'), (error) => error instanceof StudioError && error.status === 401); assert.equal(called, false); });
test('draftsave sendsOCCrevision andBearerwithout cookies', async () => {
  const account = fixture('session-occ'); let captured;
  const request = createStudioApi({ store: account.store, fetchImpl: async (url, options) => { captured = { url, options }; return Response.json({ revision: 8 }); } });
  assert.deepEqual(await request('/api/design/draft', { method: 'PUT', body: { document: { schemaVersion: 1 }, expectedRevision: 7 } }), { revision: 8 });
  assert.equal(captured.url, '/api/design/draft'); assert.equal(captured.options.credentials, 'omit'); assert.equal(captured.options.cache, 'no-store'); assert.equal(captured.options.headers.authorization, 'Bearer session-occ'); assert.deepEqual(JSON.parse(captured.options.body), { document: { schemaVersion: 1 }, expectedRevision: 7 });
});
test('OCCconflict isexposed distinctly andnever silentlyretried', async () => { let calls = 0; const request = createStudioApi({ store: fixture().store, fetchImpl: async () => { calls += 1; return Response.json({ error: 'REVISION_CONFLICT', revision: 11 }, { status: 409 }); } }); await assert.rejects(request('/api/design/draft', { method: 'PUT', body: {} }), (error) => error.status === 409 && error.payload.revision === 11); assert.equal(calls, 1); });
test('assetupload isbinary andauthenticated;downloadreturnsrawresponse', async () => {
  const account = fixture(); let captured;
  const request = createStudioApi({ store: account.store, fetchImpl: async (_url, options) => { captured = options; return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png' } }); } });
  const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' });
  const response = await request('/api/design/assets/a', { method: 'POST', binary: true, raw: true, body: blob, headers: { 'content-type': 'image/png', 'x-design-name': 'image.png' } });
  assert.equal(captured.body, blob); assert.equal(captured.headers['content-type'], 'image/png'); assert.equal((await response.arrayBuffer()).byteLength, 3);
});
test('sessionrotation isaccepted anddoesnotbecomeanaccountswitch', async () => {
  const account = fixture('rotate-before');
  const request = createStudioApi({ store: account.store, fetchImpl: async () => Response.json({ allowed: true }, { headers: { 'x-maydan-session': 'rotate-after' } }) });
  assert.equal((await request('/api/design/me')).allowed, true); assert.equal(account.token, 'rotate-after'); assert.equal(isStudioSessionRotation('rotate-before', 'rotate-after'), true);
  assert.equal(isStudioSessionRotation('rotate-before', 'other-account'), false);
});
test('lateoldaccountresponse cannotrotate anotheraccounts session', async () => {
  const account = fixture('old-account'); let release;
  const request = createStudioApi({ store: account.store, fetchImpl: () => new Promise((resolve) => { release = resolve; }) });
  const pending = request('/api/design/me'); account.store.writeSession('new-account'); release(Response.json({ allowed: true }, { headers: { 'x-maydan-session': 'old-account-rotated' } }));
  await assert.rejects(pending, (error) => error.status === 401); assert.equal(account.token, 'new-account');
});
test('concurrent responsesrespecttrustedrotationanddonotreloadauth', async () => {
  const account = fixture('concurrent-before'); const releases = [];
  const request = createStudioApi({ store: account.store, fetchImpl: () => new Promise((resolve) => { releases.push(resolve); }) });
  const first = request('/api/design/me'), second = request('/api/design/versions');
  releases[0](Response.json({ allowed: true }, { headers: { 'x-maydan-session': 'concurrent-after' } })); await first;
  releases[1](Response.json({ versions: [] })); assert.deepEqual(await second, { versions: [] }); assert.equal(account.token, 'concurrent-after');
});
test('networktimeout andinvalidJSON areactionable errors', async () => {
  const offline = createStudioApi({ store: fixture().store, fetchImpl: async () => { throw new Error('fetch failed'); } }); await assert.rejects(offline('/api/design/draft'), (error) => error instanceof StudioError && error.status === 0);
  const broken = createStudioApi({ store: fixture().store, fetchImpl: async () => new Response('<html>error</html>') }); await assert.rejects(broken('/api/design/draft'), StudioError);
  const timeout = createStudioApi({ store: fixture().store, timeoutMs: 5, fetchImpl: (_url, { signal }) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })) }); await assert.rejects(timeout('/api/design/draft'), (error) => error.status === 0 && error.message.includes('وقتًا'));
});
test('previewdeletehandles204 whilepermissionfailuresretainstatus', async () => {
  const empty = createStudioApi({ store: fixture().store, fetchImpl: async () => new Response(null, { status: 204 }) }); assert.equal(await empty('/api/design/preview', { method: 'DELETE' }), null);
  const denied = createStudioApi({ store: fixture().store, fetchImpl: async () => Response.json({ error: 'FORBIDDEN' }, { status: 403 }) }); await assert.rejects(denied('/api/design/publish'), (error) => error.status === 403);
});

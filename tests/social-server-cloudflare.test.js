import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { migrationSql } from '../server/local-d1.mjs';

test('D1/workerd: concurrent retries, friendship acceptance, cancellation, blocks, and send guards', { timeout: 60_000 }, async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'maydan-social-server-'));
  let mf;
  try {
    const scriptPath = path.join(dir, 'worker.mjs');
    await build({ stdin: { resolveDir: process.cwd(), sourcefile: 'social-server-test-entry.mjs', contents: `
      import { routeSocial } from './server/social/router.mjs';
      import { createUser } from './server/accounts/db.mjs';
      import { issueSession } from './server/accounts/session.mjs';
      import { json,errorResponse } from './server/protocol.mjs';
      export default { async fetch(request,env) { try {
        if (new URL(request.url).pathname==='/test/user') {
          const user=await createUser(env,{name:'لاعب اختبار',email:'never-public@example.test'});
          const session=await issueSession(env,user.id);
          return json({id:user.id,token:session.token});
        }
        return await routeSocial(request,env) || new Response(null,{status:404});
      } catch(e) { return errorResponse(e); } } };` },
    bundle: true, format: 'esm', platform: 'browser', outfile: scriptPath, logLevel: 'silent' });
    mf = new Miniflare(convertV4MiniflareOptions({ rootPath: dir, name: 'social-server', modules: true, scriptPath,
      compatibilityDate: '2026-09-01', d1Databases: { DB: 'social-server' }, cf: false }));
    const d1 = await mf.getD1Database('DB');
    await d1.exec(migrationSql());
    const user = async () => {
      const result = await (await mf.dispatchFetch('https://test.local/test/user', { method: 'POST' })).json();
      await api(result, '/me');
      return result;
    };
    async function api(actor, pathname, method = 'GET', body) {
      const response = await mf.dispatchFetch(`https://test.local/api/social${pathname}`, { method,
        headers: { authorization: `Bearer ${actor.token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      return { status: response.status, body: await response.json() };
    }
    async function request(a, b) {
      const response = await api(a, '/requests', 'POST', { userId: b.id });
      assert.equal(response.status, 200, JSON.stringify(response.body));
      return response.body.request.id;
    }
    async function connect(a, b) {
      const id = await request(a, b);
      const response = await api(b, `/requests/${id}/accept`, 'POST');
      assert.equal(response.status, 200, JSON.stringify(response.body));
      return response.body.conversationId;
    }
    const a = await user(); const b = await user(); const stranger = await user();
    const conversation = await connect(a, b);
    const clientId = crypto.randomUUID();
    const retries = await Promise.all(Array.from({ length: 12 }, () => api(a, `/conversations/${conversation}/messages`, 'POST', { text: 'نفس الرسالة', clientId })));
    assert.ok(retries.every((r) => r.status === 200), JSON.stringify(retries));
    assert.equal(new Set(retries.map((r) => r.body.message.seq)).size, 1);
    assert.equal((await d1.prepare('SELECT COUNT(*) AS n FROM social_messages WHERE conversation_id=?').bind(conversation).first()).n, 1);
    assert.equal((await api(stranger, `/messages/${retries[0].body.message.seq}`)).status, 404);
    const concurrent = await Promise.all([
      ...Array.from({ length: 8 }, (_, i) => api(a, `/conversations/${conversation}/messages`, 'POST', { text: `متزامن ${i}`, clientId: crypto.randomUUID() })),
      api(b, '/blocks', 'POST', { userId: a.id }),
    ]);
    assert.equal(concurrent.at(-1).status, 200);
    assert.ok(concurrent.slice(0, -1).every((r) => r.status === 200 || r.status === 404));
    const countAfterBlock = (await d1.prepare('SELECT COUNT(*) AS n FROM social_messages WHERE conversation_id=?').bind(conversation).first()).n;
    const blockedSends = await Promise.all(Array.from({ length: 6 }, () => api(a, `/conversations/${conversation}/messages`, 'POST', { text: 'بعد اكتمال الحظر', clientId: crypto.randomUUID() })));
    assert.ok(blockedSends.every((r) => r.status === 404));
    assert.equal((await d1.prepare('SELECT COUNT(*) AS n FROM social_messages WHERE conversation_id=?').bind(conversation).first()).n, countAfterBlock);
    assert.deepEqual((await api(a, '/conversations')).body.conversations, []);
    for (let iteration = 0; iteration < 4; iteration++) {
      const c = await user(); const d = await user();
      const id = await request(c, d);
      const pair = await Promise.all([api(d, `/requests/${id}/accept`, 'POST'), api(c, '/blocks', 'POST', { userId: d.id })]);
      assert.ok([200, 404].includes(pair[0].status));
      assert.equal(pair[1].status, 200);
      assert.deepEqual((await api(c, '/friends')).body.friends, []);
      assert.deepEqual((await api(d, '/requests')).body.incoming, []);
      assert.equal((await d1.prepare('SELECT COUNT(*) AS n FROM social_friendships WHERE id=?').bind(id).first()).n, 0);
      if (pair[0].status === 200) assert.equal((await api(c, `/conversations/${pair[0].body.conversationId}/messages`, 'POST', { text: 'محظور', clientId: crypto.randomUUID() })).status, 404);
    }
    const c = await user(); const d = await user();
    const cancelId = await request(c, d);
    const cancelled = await Promise.all([api(c, `/requests/${cancelId}`, 'DELETE'), api(d, `/requests/${cancelId}/accept`, 'POST')]);
    assert.ok(cancelled.every((r) => [200, 404].includes(r.status)));
    const friendship = await d1.prepare('SELECT status FROM social_friendships WHERE id=?').bind(cancelId).first();
    assert.equal(cancelled[1].status === 200, friendship?.status === 'accepted');
  } finally {
    if (mf) await mf.dispose();
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()));
    await rm(dir, { recursive: true, force: true });
  }
});

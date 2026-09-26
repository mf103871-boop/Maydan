import test from 'node:test';
import assert from 'node:assert/strict';
import { ModerationClient, reviewPreviewPath } from '../src/moderation/client.js';
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { resolve, promise }; };

test('moderation fails closed and never requests private lists for guests or ordinary accounts', async () => {
  const calls = []; const client = new ModerationClient({ request: async path => { calls.push(path); return { moderator: false }; } });
  await client.start(null); await client.load(); assert.deepEqual(calls, []);
  await client.start('ordinary'); await client.load(); assert.deepEqual(calls, ['/api/moderation/me']);
  assert.equal(client.state.moderator, false);
});

test('late private responses are discarded on account switch', async () => {
  const pending = deferred();
  const client = new ModerationClient({ request: path => path.endsWith('/me') ? Promise.resolve({ moderator: true }) : pending.promise });
  await client.start('owner'); const reading = client.load(); await client.start(null);
  pending.resolve({ reports: [{ id: 'private', messageText: 'private report' }], nextBefore: 10 }); await reading;
  assert.equal(client.state.userId, null); assert.deepEqual(client.state.reports, []); assert.equal(client.state.moderator, false);
});

test('permission removal clears cached reports and prevents additional list requests', async () => {
  let reject = false;
  const client = new ModerationClient({ request: async path => {
    if (reject) throw Object.assign(new Error(), { code: 'FORBIDDEN' });
    return path.endsWith('/me') ? { moderator: true } : { reports: [{ id: 'private' }] };
  } });
  await client.start('owner'); await client.load(); assert.equal(client.state.reports.length, 1);
  reject = true; await client.load(); assert.equal(client.state.moderator, false); assert.deepEqual(client.state.reports, []);
});

test('report pagination deduplicates and changing queue removes the old private list', async () => {
  const calls = [];
  const client = new ModerationClient({ request: async path => {
    calls.push(path); if (path.endsWith('/me')) return { moderator: true };
    if (path.includes('/images')) return { images: [{ id: 'image' }] };
    return { reports: path.includes('before=') ? [{ id: 'first' }, { id: 'second' }] : [{ id: 'first' }], nextBefore: 5 };
  } });
  await client.start('owner'); await client.load(); await client.load('reports', 'open', true);
  assert.deepEqual(client.state.reports.map(x => x.id), ['first', 'second']); assert.ok(calls.at(-1).includes('before=5'));
  await client.load('images'); assert.deepEqual(client.state.reports, []); assert.equal(client.state.images[0].id, 'image');
});

test('uncertain action retries retain the same client ID and payload, while duplicate clicks are blocked', async () => {
  const pending = deferred(); const bodies = []; let attempt = 0;
  const client = new ModerationClient({ request: async (path, options) => {
    if (path.endsWith('/me')) return { moderator: true };
    bodies.push(options.body); if (++attempt === 1) { await pending.promise; throw Object.assign(new Error(), { code: 'NETWORK' }); }
    return { ok: true, actionId: 'saved' };
  } });
  await client.start('owner'); const body = { clientId: crypto.randomUUID(), action: 'resolve_report', targetId: 'r', reason: 'تمت المراجعة' };
  const first = client.act(body); await assert.rejects(client.act(body)); pending.resolve(); await assert.rejects(first, { code: 'NETWORK' });
  await client.act(body); assert.deepEqual(bodies, [body, body]); assert.equal(client.state.saving, false);
});

test('review previews accept only authenticated API paths without queries, origins or credentials', () => {
  const version = 'a'.repeat(64);
  const path = `/api/moderation/images/review-1/${version}`;
  assert.equal(reviewPreviewPath(path), path);
  assert.ok(reviewPreviewPath(`/api/profiles/me/images/avatar/pending/${version}`));
  for (const value of ['https://other.test' + path, path + '?token=secret', path + '#secret', '//other.test/image', '/api/profiles/other/images/avatar/pending/' + version]) assert.equal(reviewPreviewPath(value), null);
});

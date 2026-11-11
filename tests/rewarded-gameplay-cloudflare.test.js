import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { WebSocket } from 'ws';
import { migrationSql } from '../server/local-d1.mjs';
import { RoomClient, newCredentials } from '../src/online/client.js';
import { ROOM_CAPABILITIES } from '../src/online/shared.js';
import { TICKET_POLICY, ENTRY_TICKET_POLICY } from '../src/shared/account/gameplay-policy.mjs';

const ORIGIN = 'http://localhost:3000';
class BrowserSocket extends WebSocket { constructor(url) { super(url, { origin: ORIGIN }); } }
async function until(predicate) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 15)); }
  assert.fail('Workerd room did not reach the expected state');
}

for(const policy of [TICKET_POLICY,ENTRY_TICKET_POLICY])test(`workerd + actual D1: ${policy}, free lobby/guests, and one full-match ticket across concurrent room starts`, { timeout: 40_000 }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'maydan-real-ticket-runtime-'));
  const clients = [];
  let runtime;
  try {
    const scriptPath = path.join(directory, 'worker.mjs');
    await build({ entryPoints: ['server/worker.mjs'], outfile: scriptPath, bundle: true, format: 'esm', platform: 'browser', logLevel: 'silent' });
    runtime = new Miniflare(convertV4MiniflareOptions({ rootPath: directory, name: 'maydan-real-ticket-runtime', modules: true, scriptPath,
      compatibilityDate: '2026-09-01', durableObjects: { ROOMS: { className: 'Room', useSQLite: true }, LIMITERS: { className: 'RequestLimiter', useSQLite: true } },
      d1Databases: { DB: 'rewarded-gameplay-db' }, bindings: { ALLOWED_ORIGINS: ORIGIN, APP_ORIGIN: ORIGIN,
        AUTH_DEV_FAKE: '1', SESSION_SECRET: 'runtime-test-only', REWARDED_ENV: 'local', REWARDED_PREVIEW_ENABLED: '1',
        REWARDED_ADS_ENABLED: '1', GAMEPLAY_ACCESS_POLICY: policy }, port: 0, host: '127.0.0.1', cf: false }));
    const server = (await runtime.ready).origin;
    const db = await runtime.getD1Database('DB'); await db.exec(migrationSql());
    const post = async (endpoint, body, authorization) => {
      const result = await fetch(server + endpoint, { method: 'POST', headers: { origin: ORIGIN,
        'content-type': 'application/json', ...(authorization ? { authorization } : {}) }, body: JSON.stringify(body) });
      return { status: result.status, body: await result.json() };
    };
    const signIn = await post('/api/auth/dev', { subject: 'rewarded-runtime-host', name: 'مضيف' });
    assert.equal(signIn.status, 200, JSON.stringify(signIn.body));
    const owner = signIn.body.me.user.id, authorization = 'Bearer ' + signIn.body.session.token;
    async function lobby() {
      const seats = Array.from({ length: 3 }, (_, n) => ({ ...newCredentials(), game: 'meenfina', name: `لاعب ${n}`, avatar: n, rounds: 5, capabilities:ROOM_CAPABILITIES }));
      const created = await post('/api/rooms', seats[0], authorization);
      assert.equal(created.status, 201, JSON.stringify(created.body));
      const code = created.body.code;
      for (const seat of seats.slice(1)) assert.equal((await post(`/api/rooms/${code}/join`, seat)).status, 200);
      const group = seats.map(session => new RoomClient({ server, code, session, WebSocketImpl: BrowserSocket }));
      clients.push(...group); group.forEach(client => client.start());
      await until(() => group.every(client => client.state?.members.length === 3 && client.state.members.every(member => member.connected)));
      assert.equal(group[0].state.rewardedOffer, 'meenfina-online');
      assert.ok(group.slice(1).every(client => client.state.rewardedOffer === undefined));
      await Promise.all(group.slice(1).map(client => client.command('ready', { ready: true })));
      return { group, start: () => group[0].command('start', { accountAuthorization: authorization }) };
    }
    const first = await lobby();
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM rewarded_match_claims').first()).n, 0);
    await first.start();
    assert.equal(first.group[0].state.phase, 'vote');
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM rewarded_match_claims WHERE source='trial' AND state='committed'").first()).n, 1);
    for(let round=1;round<=5;round++){
      await until(()=>first.group.every(c=>c.state.phase==='vote'&&c.state.round===round));
      const targetId=first.group[0].state.members[0].id;
      await Promise.all(first.group.map(c=>c.command('vote',{targetId})));
      await until(()=>first.group.every(c=>c.state.phase==='result'));await first.group[0].command('next');
    }
    await until(()=>first.group.every(c=>c.state.phase==='over'));
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM rewarded_match_claims WHERE state='committed'").first()).n,1,
      'one full-match grant covers every internal round without an inter-round ad or claim');
    const second = await lobby(), third = await lobby();
    await assert.rejects(second.start(), error => error.code === 'REWARDED_REQUIRED');
    const ticket = crypto.randomUUID(), now = Date.now();
    await db.prepare(`INSERT INTO rewarded_attempts(id,environment,user_id,offer,custom_hash,ad_unit,reward_item,state,created_at,expires_at,verified_at,transaction_id)
      VALUES(?,'local',?, ?,?,'unit','match','verified',?,?,?,?)`).bind(ticket, owner, policy===ENTRY_TICKET_POLICY?'meenfina-entry-v2':'meenfina-online', ticket, now, now + 30_000, now, ticket).run();
    const attempts = await Promise.allSettled([second.start(), third.start()]);
    assert.equal(attempts.filter(result => result.status === 'fulfilled').length, 1);
    assert.ok(['REWARDED_REQUIRED','REWARDED_BUSY'].includes(attempts.find(result => result.status === 'rejected').reason.code));
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM rewarded_match_claims WHERE ticket_id=? AND state='committed'").bind(ticket).first()).n, 1);
  } finally {
    clients.forEach(client => client.stop());
    await runtime?.dispose();
    assert.equal(path.dirname(path.resolve(directory)),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('maydan-real-ticket-runtime-'));
    await rm(directory, { recursive: true, force: true });
  }
});

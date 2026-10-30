import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { migrationStatements } from '../server/local-d1.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
test('workerd/D1 awards and earned licenses commit atomically, scale to twelve participants and obey revocation', { timeout: 60_000 }, async () => {
  const base = path.resolve(os.tmpdir()), directory = await mkdtemp(path.join(base, 'mafia-achievement-edge-')); let mf;
  try {
    const scriptPath = path.join(directory, 'worker.mjs');
    await build({ stdin: { resolveDir: ROOT, contents: `
      import {mafiaProgressStatements} from './server/mafia-progression.mjs';
      import {cosmeticsFor} from './server/plus/access.mjs';
      export default {async fetch(request,env){try{
        const body=await request.json();
        if(new URL(request.url).pathname==='/cosmetics')return Response.json(await cosmeticsFor(env,body.id));
        let statements=await mafiaProgressStatements(env,body);
        if(request.headers.get('x-fixture-failure'))statements=[...statements.slice(0,-1),env.DB.prepare('INSERT INTO missing_achievement_fixture VALUES(1)'),statements.at(-1)];
        await env.DB.batch(statements);return Response.json({ok:true});
      }catch(error){return Response.json({error:error.code||'D1_FAILURE'},{status:error.status||500});}}};
    ` }, bundle: true, platform: 'browser', format: 'esm', outfile: scriptPath, logLevel: 'silent' });
    mf = new Miniflare(convertV4MiniflareOptions({ rootPath: directory, name: 'mafia-achievement-fixture', modules: true, scriptPath,
      compatibilityDate: '2026-09-01', d1Databases: { DB: 'mafia-achievement-fixture' }, bindings: { MAFIA_PROGRESS_ENABLED: '1' }, cf: false }));
    await mf.ready; const db = await mf.getD1Database('DB'); await db.exec(migrationStatements().join('\n'));
    const person = async () => { const id = crypto.randomUUID(); await db.prepare('INSERT INTO users(id,name,created_at,updated_at) VALUES(?,?,?,?)').bind(id, 'Synthetic', Date.now(), Date.now()).run(); return id; };
    const event = (id, roleId = 'citizen', faction = 'town', initialFaction = 'town') => { const finishedAt = Date.now() - 31_000; return {
      eventSchemaVersion: 1, eventKind: 'match_completed', source: 'live', rewardPolicyVersion: 1, key: `edge:${crypto.randomUUID()}`, eventId: `online:${crypto.randomUUID()}`,
      rulesetVersion: 1, startedAt: finishedAt - 200_000, finishedAt, notBefore: finishedAt + 30_000, mode: 'shadow', capacity: 12, participantCount: 12, visibility: 'public', draw: false,
      results: [{ userId: id, roleId, initialFaction, faction, won: true, forfeited: false, eliminatedAt: null }] }; };
    const consume = async (body, failure = false, endpoint = '/consume') => {
      const response = await mf.dispatchFetch('https://achievement-fixture.test' + endpoint, { method: 'POST', headers: { 'content-type': 'application/json', ...(failure ? { 'x-fixture-failure': '1' } : {}) }, body: JSON.stringify(body) });
      return { status: response.status, body: await response.json() };
    };
    const count = async (table, id) => (await db.prepare(`SELECT COUNT(*) n FROM ${table} WHERE user_id=?`).bind(id).first()).n;
    const id = await person(), converted = event(id, 'doctor', 'shadow');
    assert.equal((await consume(converted)).status, 200);
    assert.equal((await db.prepare("SELECT COUNT(*) n FROM mafia_achievements WHERE user_id=? AND achievement_id='mafia_win_town'").bind(id).first()).n, 0);
    await consume(event(id, 'mafia', 'mafia', 'mafia')); const third = event(id); await consume(third);
    const duplicate = await Promise.all(Array.from({ length: 4 }, () => consume(third)));
    assert.ok(duplicate.every(reply => reply.status === 200));
    assert.equal(await count('mafia_achievements', id), 6); assert.equal(await count('mafia_cosmetic_grants', id), 3);
    await db.prepare('INSERT INTO plus_cosmetics(user_id,selection_json,revision,updated_at) VALUES(?,?,1,?)').bind(id, '{"frameId":"noir.frame","avatarId":"artist.avatar","badge":true}', Date.now()).run();
    let appearance = (await consume({ id }, false, '/cosmetics')).body;
    assert.equal(appearance.plusActive, false); assert.equal(appearance.effective.frameId, 'noir.frame'); assert.equal(appearance.effective.avatarId, null); assert.equal(appearance.effective.badge, false);
    await db.prepare("UPDATE mafia_cosmetic_grants SET revoked_at=? WHERE user_id=? AND item_id='noir.frame'").bind(Date.now(), id).run();
    appearance = (await consume({ id }, false, '/cosmetics')).body; assert.equal(appearance.effective.frameId, null);
    const failed = await person(), retry = event(failed);
    assert.equal((await consume(retry, true)).status, 500);
    for (const table of ['mafia_progress_events', 'mafia_player_progress', 'mafia_achievements', 'mafia_cosmetic_grants']) assert.equal(await count(table, failed), 0);
    assert.equal((await consume(retry)).status, 200); assert.equal(await count('mafia_cosmetic_grants', failed), 1);
    const people = []; for (let i = 0; i < 12; i++) people.push(await person());
    const full = event(people[0]); full.results = people.map(userId => ({ ...full.results[0], userId }));
    assert.equal((await consume(full)).status, 200);
    for (const userId of people) { assert.equal(await count('mafia_achievements', userId), 2); assert.equal(await count('mafia_cosmetic_grants', userId), 1); }
  } finally {
    await mf?.dispose(); assert.ok(path.resolve(directory).startsWith(base + path.sep)); await rm(directory, { recursive: true, force: true });
  }
});

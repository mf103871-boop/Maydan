import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { LocalD1, MIGRATIONS_DIR } from '../server/local-d1.mjs';

test('0005 migrates existing accounts and replay preserves friend codes, images and all profile data', async t => {
  const db = new LocalD1();
  t.after(() => db.close());
  for (const name of readdirSync(MIGRATIONS_DIR).filter(name => name.endsWith('.sql') && name < '0005_profiles.sql').sort()) {
    await db.exec(readFileSync(path.join(MIGRATIONS_DIR, name), 'utf8'));
  }
  assert.equal(await db.prepare("SELECT name FROM sqlite_master WHERE name='player_profiles'").first(), null);
  const run = (sql, ...args) => db.prepare(sql).bind(...args).run();
  const rows = async table => (await db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()).results;
  const now = 1_790_000_000_000;
  for (const id of ['kept', 'missing-code', 'deleting', 'deleting-no-code', 'removed']) {
    await run('INSERT INTO users(id,name,email,created_at,updated_at) VALUES(?,?,?,?,?)', id, 'اسم قديم', `${id}@example.test`, now, now + 5);
  }
  await run('INSERT INTO social_profiles(user_id,code,last_active_at,online_until,created_at) VALUES(?,?,?,?,?)',
    'kept', 'MDN-0123456789', now + 10, now + 45010, now);
  await run('INSERT INTO social_profiles(user_id,code,created_at) VALUES(?,?,?)', 'deleting', 'MDN-ABCDEF0123', now);
  for (const id of ['deleting', 'deleting-no-code', 'removed']) {
    await run('INSERT INTO account_deletions(user_id,attempt_id,created_at) VALUES(?,?,?)', id, `delete-${id}`, now);
  }
  await run('DELETE FROM users WHERE id=?', 'removed');
  const originalUsers = await rows('users');
  const originalCodes = await rows('social_profiles');
  const migration = readFileSync(path.join(MIGRATIONS_DIR, '0005_profiles.sql'), 'utf8');

  await db.exec(migration);
  assert.deepEqual(await rows('users'), originalUsers);
  for (const original of originalCodes) {
    assert.deepEqual(await db.prepare('SELECT * FROM social_profiles WHERE user_id=?').bind(original.user_id).first(), original);
  }
  const newCode = await db.prepare('SELECT * FROM social_profiles WHERE user_id=?').bind('missing-code').first();
  assert.match(newCode.code, /^MDN-[A-F0-9]{10}$/);
  assert.notEqual(newCode.code, 'MDN-0123456789');
  assert.deepEqual((await rows('player_profiles')).map(row => row.user_id).sort(), ['kept', 'missing-code']);
  for (const profile of await rows('player_profiles')) {
    assert.equal(profile.created_at, now);
    assert.equal(profile.bio, '');
    assert.equal(profile.revision, 0);
  }
  // Migration creates identity only, never fabricated history, wins or awards.
  for (const table of ['player_images', 'player_stats', 'player_events', 'player_sessions', 'player_achievements']) {
    assert.deepEqual(await rows(table), [], table);
  }
  assert.equal(await db.prepare('SELECT user_id FROM social_profiles WHERE user_id=?').bind('deleting-no-code').first(), null);
  assert.equal(await db.prepare('SELECT user_id FROM social_profiles WHERE user_id=?').bind('removed').first(), null);

  const versions = {};
  for (const [kind, width, height] of [['avatar', 16, 16], ['cover', 48, 16]]) {
    const bytes = await sharp({ create: { width, height, channels: 3, background: '#126d70' } }).jpeg().toBuffer();
    const version = createHash('sha256').update(bytes).digest('hex');
    versions[kind] = version;
    await run('INSERT INTO player_images(user_id,kind,version,data_base64,width,height,byte_length,updated_at) VALUES(?,?,?,?,?,?,?,?)',
      'kept', kind, version, bytes.toString('base64'), width, height, bytes.length, now + 100);
  }
  await run(`UPDATE player_profiles SET bio=?,theme=?,avatar_preset=?,avatar_version=?,cover_version=?,selected_title=?,
    featured_badges=?,revision=?,last_mutation=?,updated_at=? WHERE user_id=?`,
    'نبذة محفوظة بعد الترحيل', 'violet', 'fox', versions.avatar, versions.cover, 'host', '["welcome","host"]', 17, 'saved-mutation', now + 100, 'kept');
  await run('INSERT INTO player_stats(user_id,local_sessions,online_matches,online_wins,online_draws) VALUES(?,?,?,?,?)', 'kept', 4, 3, 2, 1);
  await run('INSERT INTO player_events(user_id,event_id,source,game,won,draw,created_at) VALUES(?,?,?,?,?,?,?)',
    'kept', 'online:existing:1', 'online', 'fabraka', 1, 0, now + 80);
  await run('INSERT INTO player_sessions(id,user_id,game,started_at,completed_at) VALUES(?,?,?,?,?)', 'existing-session', 'kept', 'beep', now, now + 31000);
  await run('INSERT INTO player_achievements(user_id,achievement_id,earned_at) VALUES(?,?,?)', 'kept', 'host', now + 90);

  const tables = ['users', 'account_deletions', 'social_profiles', 'player_profiles', 'player_images', 'player_stats', 'player_events', 'player_sessions', 'player_achievements'];
  const before = Object.fromEntries(await Promise.all(tables.map(async table => [table, await rows(table)])));
  for (let replay = 0; replay < 2; replay++) {
    await db.exec(migration);
    for (const table of tables) assert.deepEqual(await rows(table), before[table], `replay ${replay + 1}: ${table}`);
  }
  for (const id of ['deleting', 'deleting-no-code', 'removed']) {
    assert.equal(await db.prepare('SELECT user_id FROM player_profiles WHERE user_id=?').bind(id).first(), null, id);
  }
});

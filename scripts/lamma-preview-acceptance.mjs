// Explicit, destructive-to-its-own-fixtures remote acceptance test. Never production.
// Run: node scripts/lamma-preview-acceptance.mjs --run-preview
import assert from 'node:assert/strict';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const CONFIG = path.join(ROOT, 'wrangler.lamma-preview.jsonc');
const DATABASE = 'maydan-lamma-preview-accounts';
const DATABASE_ID = '346a7165-9989-4fe2-a5a3-aec017a2d21b';
const ORIGIN = 'https://maydan-lamma-preview.mf103871.workers.dev';
const runCommand = promisify(execFile);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const literal = value => `'${String(value).replaceAll("'", "''")}'`;
const runId = randomUUID();
const report = { runId, startedAt: new Date().toISOString(), origin: ORIGIN, database: DATABASE, checks: [], cleanup: null };
const outputDir = path.join(ROOT, '.cache', 'lamma-preview');
const users = [];
const groupIds = [];
let writes = 0, writeWindow = Math.floor(Date.now() / 60_000), seeded = false;

function assertPreviewURL(url) {
  const parsed = new URL(url);
  assert.equal(parsed.origin, ORIGIN, 'Refusing a non-preview origin');
  assert.equal(parsed.protocol, 'https:');
  assert.equal(parsed.hostname, 'maydan-lamma-preview.mf103871.workers.dev');
  assert.equal(parsed.username + parsed.password, '');
  return parsed;
}
async function guardConfiguration() {
  const source = await readFile(CONFIG, 'utf8');
  // Remove comment-only lines; these assertions intentionally avoid guessing IDs.
  const active = source.split(/\r?\n/).filter(line => !line.trimStart().startsWith('//')).join('\n');
  assert.match(active, /"name"\s*:\s*"maydan-lamma-preview"/);
  assert.match(active, new RegExp(`"database_name"\\s*:\\s*"${DATABASE}"`));
  assert.match(active, new RegExp(`"database_id"\\s*:\\s*"${DATABASE_ID}"`));
  assert.equal((active.match(/"database_id"/g) || []).length, 1, 'Preview must have exactly one D1 binding');
  assert.ok(!active.includes('9d863a31-6a5c-45f1-91f5-79ad400c3f6e'), 'Production DB forbidden');
  assert.ok(!active.includes('"script_name"'), 'Cross-script DO bindings forbidden');
  assertPreviewURL(ORIGIN);
}
async function d1(sql) {
  await guardConfiguration();
  const filename = path.join(outputDir, `${runId}-${randomUUID()}.sql`);
  await writeFile(filename, sql, { mode: 0o600 });
  try {
    await runCommand(process.execPath, [path.join(ROOT, 'node_modules/wrangler/bin/wrangler.js'),
      'd1', 'execute', DATABASE, '--remote', '--config', CONFIG, '--file', filename, '--json'],
    { cwd: ROOT, maxBuffer: 8 * 1024 * 1024, timeout: 120_000, windowsHide: true });
    // Wrangler's --file import can print progress before JSON; its successful
    // exit is sufficient here, and no command output contains a bearer token.
    return true;
  } catch { throw new Error('Preview D1 command failed; no credentials or SQL were printed.'); }
  finally { await unlink(filename).catch(() => {}); }
}
async function request(user, pathname, method = 'GET', body, extraHeaders = {}) {
  const url = assertPreviewURL(new URL(pathname, ORIGIN).href);
  if (method !== 'GET' && pathname.startsWith('/api/social/')) {
    const current = Math.floor(Date.now() / 60_000);
    if (current !== writeWindow) { writeWindow = current; writes = 0; }
    if (++writes > 45) {
      console.log('Waiting for the next preview API quota window.');
      await sleep(60_050 - Date.now() % 60_000); writeWindow = Math.floor(Date.now() / 60_000); writes = 1;
    }
  }
  const response = await fetch(url, { method, redirect: 'error', signal: AbortSignal.timeout(20_000),
    headers: { Origin: 'maydan://app', ...(user ? { Authorization: `Bearer ${user.token}` } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...extraHeaders },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const rotated = response.headers.get('x-maydan-session');
  if (user && rotated) user.token = rotated;
  const data = response.headers.get('content-type')?.includes('application/json') ? await response.json() : new Uint8Array(await response.arrayBuffer());
  return { status: response.status, data, headers: response.headers };
}
const social = (user, suffix, method, body, headers) => request(user, `/api/social${suffix}`, method, body, headers);
function expect(result, status, label) { assert.equal(result.status, status, `${label}: expected HTTP ${status}, received ${result.status} (${result.data?.error || 'no error code'})`); return result.data; }
async function check(name, test) {
  try { await test(); report.checks.push({ name, passed: true }); console.log(`PASS ${name}`); }
  catch (error) { report.checks.push({ name, passed: false, error: error.message.replace(/mdn1\.[A-Za-z0-9_.-]+/g, '[REDACTED]') }); throw new Error(`FAILED ${name}; see the sanitized report.`); }
}
function credential(userId, now) {
  const id = randomBytes(8).toString('hex'), secret = randomBytes(32).toString('base64url');
  return { token: `mdn1.${id}.${secret}`, sql: `INSERT INTO sessions(id,user_id,secret_hash,client,created_at,last_seen,expires_at) VALUES(${literal(id)},${literal(userId)},${literal(createHash('sha256').update(secret).digest('hex'))},'preview-test',${now},${now},${now + 3_600_000});` };
}
function silentWav() {
  const bytes = Buffer.alloc(16_044); bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(8000, 24);
  bytes.writeUInt32LE(16000, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(16000, 40);
  return bytes;
}

async function main() {
  assert.equal(process.argv[2], '--run-preview', 'Explicit --run-preview is required');
  await guardConfiguration(); await mkdir(outputDir, { recursive: true });
  expect(await request(null, '/health'), 200, 'preview health');
  const now = Date.now(), statements = [];
  // Owner + twelve candidates is the minimum population for a real final-seat race.
  for (let i = 0; i < 13; i++) {
    const id = `lamma-test-${runId}-${i}`, main = credential(id, now), cleanup = credential(id, now);
    users.push({ id, token: main.token, cleanupToken: cleanup.token });
    statements.push(`INSERT INTO users(id,name,email,created_at,updated_at) VALUES(${literal(id)},${literal(`لاعب اختبار ${i}`)},NULL,${now},${now});`, main.sql, cleanup.sql);
  }
  seeded = true; await d1(statements.join('\n'));
  const owner = users[0], conversations = new Map();
  let group, winning, losing, capabilities;
  await check('authenticated synthetic accounts and honest provider capabilities', async () => {
    capabilities = expect(await social(owner, '/capabilities'), 200, 'capabilities');
    assert.equal(capabilities.groups, true); assert.equal(capabilities.maxGroupMembers, 12);
    report.capabilities = { voiceMessages: capabilities.voiceMessages, liveCalls: capabilities.liveCalls, pushNotifications: capabilities.pushNotifications };
    expect(await social(null, '/groups'), 401, 'anonymous groups');
  });
  await check('friend request acceptance through remote REST', async () => {
    for (const candidate of users.slice(1)) {
      const sent = expect(await social(candidate, '/requests', 'POST', { userId: owner.id }), 200, 'friend request');
      const accepted = expect(await social(owner, `/requests/${sent.request.id}/accept`, 'POST', {}), 200, 'accept friendship');
      conversations.set(candidate.id, accepted.conversationId);
    }
  });
  await check('direct v1 text DTO and retry identity', async () => {
    const cid = conversations.get(users[4].id), clientId = randomUUID();
    const sent = expect(await social(owner, `/conversations/${cid}/messages`, 'POST', { clientId, text: 'رسالة اختبار مباشرة' }), 200, 'direct send');
    assert.deepEqual(Object.keys(sent.message).sort(), ['seq', 'conversationId', 'senderId', 'text', 'clientId', 'createdAt', 'editedAt', 'deletedAt'].sort());
    const again = expect(await social(owner, `/conversations/${cid}/messages`, 'POST', { clientId, text: 'رسالة اختبار مباشرة' }), 200, 'direct retry');
    assert.equal(again.message.seq, sent.message.seq);
    expect(await social(users[5], `/conversations/${cid}/messages`), 404, 'direct outsider');
  });
  await check('private accepted group invitations and concurrent twelfth seat', async () => {
    group = expect(await social(owner, '/groups', 'POST', { name: 'لمة اختبار معزولة' }), 200, 'create group').group.id; groupIds.push(group);
    expect(await social(owner, `/groups/${group}/messages`, 'POST', { clientId: randomUUID(), text: 'قبل الانضمام' }), 200, 'prejoin message');
    const invites = [];
    for (const candidate of users.slice(1)) invites.push(expect(await social(owner, `/groups/${group}/invites`, 'POST', { userId: candidate.id }), 200, 'invite friend').invitation.id);
    expect(await social(users[1], `/groups/${group}`), 404, 'unaccepted member');
    for (let i = 1; i <= 10; i++) expect(await social(users[i], `/groups/${group}/invites/${invites[i - 1]}/accept`, 'POST', {}), 200, 'accept group');
    const final = await Promise.all([11, 12].map(i => social(users[i], `/groups/${group}/invites/${invites[i - 1]}/accept`, 'POST', {})));
    assert.deepEqual(final.map(x => x.status).sort(), [200, 409]); winning = users[final[0].status === 200 ? 11 : 12]; losing = users[final[0].status === 200 ? 12 : 11];
    const detail = expect(await social(owner, `/groups/${group}`), 200, 'full group'); assert.equal(detail.members.length, 12);
    expect(await social(losing, `/groups/${group}/messages`), 404, 'thirteenth candidate');
    assert.deepEqual(expect(await social(users[1], `/groups/${group}/messages`), 200, 'join boundary').messages, []);
    assert.ok(detail.members.some(m => (m.userId || m.id) === winning.id));
  });
  await check('group blocking filters history without changing membership', async () => {
    expect(await social(users[2], `/groups/${group}/messages`, 'POST', { clientId: randomUUID(), text: 'رسالة صاحب محظور' }), 200, 'group send');
    expect(await social(users[1], '/blocks', 'POST', { userId: users[2].id }), 200, 'block group peer');
    const detail = expect(await social(users[1], `/groups/${group}`), 200, 'blocked group detail'); assert.equal(detail.members.length, 12);
    const history = expect(await social(users[1], `/groups/${group}/messages`), 200, 'blocked group history'); assert.ok(history.messages.every(m => m.senderId !== users[2].id));
  });
  await check('leave and accepted rejoin reset visible history', async () => {
    expect(await social(users[1], `/groups/${group}/leave`, 'POST', {}), 200, 'leave group');
    expect(await social(users[1], `/groups/${group}/messages`), 404, 'former member');
    expect(await social(users[1], `/blocks/${users[2].id}`, 'DELETE'), 200, 'unblock');
    const invitation = expect(await social(owner, `/groups/${group}/invites`, 'POST', { userId: users[1].id }), 200, 'reinvite').invitation;
    expect(await social(users[1], `/groups/${group}/invites/${invitation.id}/accept`, 'POST', {}), 200, 'rejoin');
    assert.deepEqual(expect(await social(users[1], `/groups/${group}/messages`), 200, 'rejoined history').messages, []);
  });
  await check('notification preferences and conversation mutes persist', async () => {
    const settings = { messages: false, calls: false, previews: false, mutedConversations: [{ scope: 'group', conversationId: group }] };
    expect(await social(users[3], '/preferences', 'PUT', settings), 200, 'save preferences');
    const saved = expect(await social(users[3], '/preferences'), 200, 'read preferences'); assert.equal(saved.messages, false); assert.equal(saved.calls, false); assert.deepEqual(saved.mutedConversations, settings.mutedConversations);
  });
  await check('private voice fallback or explicit unavailable storage', async () => {
    const cid = conversations.get(users[4].id), clientId = randomUUID(), audio = silentWav();
    const upload = await social(owner, '/attachments', 'POST', { scope: 'direct', conversationId: cid, clientId, mimeType: 'audio/wav', durationMs: 1000, dataBase64: audio.toString('base64') });
    if (!capabilities.voiceMessages) { assert.equal(expect(upload, 503, 'unconfigured storage').error, 'AUDIO_UNAVAILABLE'); return; }
    const attachment = expect(upload, 200, 'private upload').attachment;
    expect(await social(users[4], `/attachments/${attachment.id}/content`), 404, 'unsent audio private to uploader');
    expect(await social(losing, '/attachments', 'POST', { scope: 'direct', conversationId: cid, clientId: randomUUID(), mimeType: 'audio/wav', durationMs: 1000, dataBase64: audio.toString('base64') }), 404, 'outsider upload denied');
    const sent = expect(await social(owner, `/conversations/${cid}/messages`, 'POST', { kind: 'voice', clientId, attachmentId: attachment.id }), 200, 'typed direct voice').message;
    assert.equal(sent.kind, 'voice'); assert.match(sent.text, /رسالة صوتية/);
    const content = `/attachments/${attachment.id}/content`;
    const played = expect(await social(users[4], content), 200, 'authorized voice'); assert.deepEqual(Buffer.from(played), audio);
    const range = await social(users[4], content, 'GET', undefined, { Range: 'bytes=0-15' });
    assert.deepEqual(Buffer.from(expect(range, 206, 'authorized range')), audio.subarray(0, 16));
    assert.equal(range.headers.get('content-range'), `bytes 0-15/${audio.length}`);
    assert.equal(range.headers.get('cache-control'), 'private, no-store');
    expect(await social(users[4], content, 'GET', undefined, { Range: `bytes=${audio.length}-` }), 416, 'out-of-range playback');
    expect(await social(null, content), 401, 'anonymous playback denied');
    expect(await social(losing, `/attachments/${attachment.id}/content`), 404, 'voice outsider');
    expect(await social(owner, `/messages/${sent.seq}`, 'DELETE'), 200, 'delete voice');
    expect(await social(users[4], `/attachments/${attachment.id}/content`), 404, 'deleted voice');
    report.storageAcceptance = { uploadedBytes: audio.length, byteExactPlayback: true, privateRange: true, unsentAndOutsiderDenied: true, deletedPlaybackDenied: true };
  });
  await check(capabilities.liveCalls ? 'configured call service reserved for separate live-provider acceptance' : 'unconfigured call service fails explicitly without provider work', async () => {
    if (capabilities.liveCalls) { report.liveProviderAcceptance = 'Separate authorized provider/device trial required'; return; }
    const result = await social(owner, '/calls', 'POST', { scope: 'group', conversationId: group, clientId: randomUUID(), deviceId: 'preview-fixture-device' });
    assert.equal(expect(result, 503, 'unconfigured calls').error, 'CALLS_UNAVAILABLE');
  });
  await check('revoked session cannot read social data', async () => {
    const result = await request(losing, '/api/auth/signout', 'POST', {}); assert.ok([200, 204].includes(result.status));
    expect(await social(losing, '/groups'), 401, 'revoked auth');
  });
}

try { await main(); report.passed = true; }
catch (error) { report.passed = false; report.error = error.message; console.error(error.message); process.exitCode = 1; }
finally {
  if (seeded) {
    let removed = 0;
    for (const user of users) {
      try { const result = await request({ token: user.cleanupToken }, '/api/account', 'DELETE'); if (result.status === 204) removed++; }
      catch { /* Recorded below; credentials expire after one hour even on failure. */ }
    }
    report.cleanup = { accountsSeeded: users.length, accountsDeleted: removed, credentials: 'memory-only; D1 hashes expire after one hour' };
    if (removed === users.length && groupIds.length) {
      await d1(groupIds.flatMap(id => ['social_group_invites', 'social_group_messages', 'social_group_members', 'social_groups'].map(table => `DELETE FROM ${table} WHERE ${table === 'social_groups' ? 'id' : 'group_id'}=${literal(id)};`)).join('\n')).catch(() => { report.cleanup.groupTombstonesRetained = true; });
    }
    if (removed !== users.length) { report.passed = false; process.exitCode = 1; }
    console.log(`CLEANUP ${removed}/${users.length} synthetic accounts removed`);
  }
  report.finishedAt = new Date().toISOString();
  await mkdir(outputDir, { recursive: true });
  await writeFile(path.join(outputDir, 'last-result.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  console.log(`Sanitized report: .cache/lamma-preview/last-result.json (${report.passed ? 'PASS' : 'FAIL'})`);
}

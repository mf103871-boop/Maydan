// Real isolated-preview acceptance. Does not deploy, migrate, provision or call a
// billing/media provider. Run only after the release owner authorizes fixtures:
// node scripts/ersomha-preview-acceptance.mjs --run-preview
import assert from 'node:assert/strict';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { WebSocket } from 'ws';
import { RoomClient, newCredentials } from '../src/online/client.js';
import { ROOM_CAPABILITIES } from '../src/online/shared.js';
import { ERSOMHA_BANK, getErsomhaPool } from '../server/ersomha-content.mjs';
import { ersomhaAccountHash } from '../server/ersomha-history.mjs';
import { ERSOMHA_API_CHECKS, ERSOMHA_PREVIEW, ERSOMHA_PREVIEW_ORIGIN, ERSOMHA_PREVIEW_DATABASE,
  ERSOMHA_DATABASE, bundleErsomhaWorker, ersomhaApiClient } from './ersomha-release.mjs';
import { snapshotWorker, assertDeployedBundle } from './lamma-release.mjs';
import { getBackendProvenance } from './lib/lamma-provenance.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const CONFIG = path.join(ROOT, 'wrangler.lamma-preview.jsonc');
const DATABASE = 'maydan-lamma-preview-accounts';
const OUTPUT = path.join(ROOT, '.cache', 'ersomha-preview');
const execute = promisify(execFile);
const hash = value => createHash('sha256').update(value).digest('hex');
const literal = value => `'${String(value).replaceAll("'", "''")}'`;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

export function assertErsomhaPreviewURL(input) {
  const url = new URL(input, ERSOMHA_PREVIEW_ORIGIN);
  assert.equal(url.protocol, 'https:', 'Only HTTPS preview requests are permitted.');
  assert.equal(url.origin, ERSOMHA_PREVIEW_ORIGIN, 'Non-preview origin forbidden.');
  assert.equal(url.username + url.password, '', 'URL credentials forbidden.');
  assert.equal(url.search, '', 'Query credentials or origin overrides forbidden.');
  assert.equal(url.hash, '', 'URL fragments forbidden.');
  return url;
}

export function assertErsomhaPreviewConfig(source) {
  const active = source.split(/\r?\n/).filter(line => !line.trimStart().startsWith('//')).join('\n');
  assert.match(active, /"name"\s*:\s*"maydan-lamma-preview"/);
  assert.match(active, /"main"\s*:\s*"server\/worker\.mjs"/);
  assert.match(active, new RegExp(`"database_name"\\s*:\\s*"${DATABASE}"`));
  assert.match(active, new RegExp(`"database_id"\\s*:\\s*"${ERSOMHA_PREVIEW_DATABASE}"`));
  assert.equal((active.match(/"database_id"/g) || []).length, 1, 'One exact isolated D1 binding required.');
  assert.ok(!active.includes(ERSOMHA_DATABASE), 'Production database forbidden.');
  assert.ok(!active.includes('"script_name"'), 'Cross-script Durable Objects forbidden.');
  assert.ok(!active.includes('"assets"'), 'Preview must remain API-only.');
  assert.match(active, /"bucket_name"\s*:\s*"maydan-lamma-preview-audio"/);
  assert.equal((active.match(/"bucket_name"/g) || []).length, 1, 'Only the preview bucket is permitted.');
  assertErsomhaPreviewURL(ERSOMHA_PREVIEW_ORIGIN);
  return true;
}

export function parsePreviewD1Result(stdout) {
  const start = stdout.search(/\[\s*\{/);
  assert.ok(start >= 0, 'Missing preview D1 JSON result.');
  const results = JSON.parse(stdout.slice(start));
  assert.ok(Array.isArray(results) && results.every(result => result.success), 'Preview D1 operation failed.');
  return results.flatMap(result => result.results || []);
}

export function assertErsomhaStaleLeaseOutcome({ errorCode, before, states, selectedWord,
  exposuresBefore, exposuresAfter, expectedLeases, observedLeases, now = Date.now() }) {
  // advance() may stop the revoked match before the command is dispatched.
  // A generic phase/stale rejection is evidence only alongside the fail-closed
  // terminal state, unchanged exposure history and the new owner's live fences.
  assert.ok(['ERSOMHA_ACTIVE_ELSEWHERE', 'PHASE', 'STALE'].includes(errorCode), 'The old room command must be rejected.');
  assert.equal(before?.phase, 'draw', 'The fixture must have exposed only its initial drawing word.');
  assert.ok(Number.isSafeInteger(before.matchId) && Number.isSafeInteger(before.round) && before.round > 0
    && typeof before.drawerId === 'string' && before.drawerId, 'The original match identity must be recorded.');
  assert.ok(typeof selectedWord === 'string' && selectedWord, 'The original selected word must be recorded privately.');
  assert.ok(Array.isArray(states) && states.length === 2, 'Both old-room seats must observe the terminal state.');
  for (const state of states) {
    assert.equal(state?.phase, 'over', 'A stale match must terminate safely.');
    assert.equal(state.reason, 'account_active_elsewhere', 'A generic phase error alone does not establish fencing.');
    for (const field of ['matchId', 'round', 'drawerId']) assert.equal(state[field], before[field], 'The old match cannot advance to another word.');
    assert.deepEqual(state.myChoices, [], 'A fenced room cannot expose new choices.');
    assert.equal(state.myWord, null, 'The stale drawer cannot retain an active private word.');
    assert.equal(state.revealedWord, selectedWord, 'Only the already selected word may appear in the terminal reveal.');
    assert.equal(state.deadlineAt, null, 'A fenced room cannot retain a next-turn deadline.');
  }
  assert.ok(Number.isSafeInteger(exposuresBefore) && exposuresBefore > 0, 'Initial exposure evidence is required.');
  assert.equal(exposuresAfter, exposuresBefore, 'Old room cannot persist a new exposure after being fenced.');
  assert.equal(expectedLeases.length, 2, 'Both shared accounts must belong to the replacement room.');
  assert.equal(new Set(expectedLeases.map(row => row.account_hash)).size, 2, 'Expected lease accounts must be distinct.');
  assert.equal(new Set(expectedLeases.map(row => row.room_key)).size, 1, 'The replacement room must own the full lease set.');
  assert.equal(observedLeases.length, expectedLeases.length, 'Fencing and old-room cleanup must preserve both replacement leases.');
  assert.equal(new Set(observedLeases.map(row => row.account_hash)).size, expectedLeases.length, 'Observed leases cannot duplicate an account.');
  for (const expected of expectedLeases) {
    const observed = observedLeases.find(row => row.account_hash === expected.account_hash);
    assert.ok(observed, 'The replacement room cannot lose an account lease.');
    assert.equal(observed.room_key, expected.room_key, 'The stale room cannot reclaim or release the new owner.');
    assert.equal(observed.fence, expected.fence, 'The replacement lease generation must remain unchanged.');
    assert.ok(Number.isFinite(observed.expires_at) && observed.expires_at > now
      && observed.expires_at >= expected.expires_at, 'The replacement leases must stay live; normal renewal is allowed.');
  }
  return true;
}

async function until(predicate, label, timeout = 25_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await predicate()) return; await wait(40); }
  throw new Error(`Timed out: ${label}`);
}

export async function runErsomhaPreviewAcceptance(argv = process.argv.slice(2)) {
  assert.deepEqual(argv, ['--run-preview'], 'Explicit --run-preview is required; no origin, database or deployment overrides are accepted.');
  const runId = randomUUID(), users = [], rooms = [], clients = [], reportIds = [];
  const report = { schemaVersion: 1, kind: 'ersomha-api-storage', runId, startedAt: new Date().toISOString(),
    previewOrigin: ERSOMHA_PREVIEW_ORIGIN, scope: 'Real remote preview Worker, isolated D1 and authenticated WebSocket peers; synthetic fixtures only',
    checks: [], passed: false, authenticatedPeers: 0, cleanup: null, physicalDeviceTrialCompleted: false };
  const metrics = { authenticatedAccounts: 0, maximumConnected: 0, privateTurns: 0, noRepeatTurns: 0,
    completedCooperative: 0, completedCompetitive: [], intermediateCompetitiveLobbies: [], privateReports: 0 };
  const privateWords = new Set(), bank = new Map(ERSOMHA_BANK.map(entry => [entry.id, entry]));
  let seeded = false, remoteApi, frozen, firstDeployment, source;
  const guard = async () => assertErsomhaPreviewConfig(await readFile(CONFIG, 'utf8'));
  const safeError = error => {
    if (error instanceof SyntaxError) return 'Unexpected command or API JSON; response body suppressed.';
    let text = String(error?.message || 'Acceptance assertion failed').split('\n')[0];
    for (const user of users) for (const secret of [user.token, user.cleanupToken]) if (secret) text = text.split(secret).join('[SESSION REDACTED]');
    for (const room of rooms) for (const seat of room.seats) text = text.split(seat.session.token).join('[SEAT REDACTED]');
    for (const word of privateWords) text = text.split(word).join('[PRIVATE WORD]');
    return text.replace(/mdn1\.[\w.-]+/g, '[SESSION REDACTED]').replace(/[\w-]{10,}\.[\w-]{10,}\.[\w-]{10,}/g, '[JWT REDACTED]').slice(0, 500);
  };
  const check = async (name, operation) => {
    assert.ok(ERSOMHA_API_CHECKS.includes(name), 'Unrecognized acceptance check.');
    try { const details = await operation(); report.checks.push({ name, passed: true, scope: 'remote-preview', ...(details ? { details } : {}) }); console.log(`PASS ${name}`); }
    catch (error) { report.checks.push({ name, passed: false, scope: 'remote-preview', error: safeError(error) }); throw new Error(`FAILED ${name}`); }
  };
  async function d1(sql, { captureResults = false } = {}) {
    await guard();
    const filename = path.join(OUTPUT, `${runId}-${randomUUID()}.sql`);
    await writeFile(filename, sql, { mode: 0o600 });
    try {
      const { stdout } = await execute(process.execPath, [path.join(ROOT, 'node_modules/wrangler/bin/wrangler.js'),
        'd1', 'execute', DATABASE, '--remote', '--config', CONFIG,
        ...(captureResults ? ['--command', sql] : ['--file', filename]), '--json'],
      { cwd: ROOT, maxBuffer: 8 * 1024 * 1024, timeout: 120_000, windowsHide: true });
      return captureResults ? parsePreviewD1Result(stdout) : [];
    } catch { throw new Error('Isolated preview D1 operation failed; SQL and credentials suppressed.'); }
    finally { await unlink(filename).catch(() => {}); }
  }
  async function request(user, suffix, method = 'GET', body) {
    const url = assertErsomhaPreviewURL(suffix);
    const response = await fetch(url, { method, redirect: 'error', signal: AbortSignal.timeout(25_000),
      headers: { Origin: 'maydan://app', ...(user ? { Authorization: `Bearer ${user.token}` } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const rotated = response.headers.get('x-maydan-session'); if (user && rotated) user.token = rotated;
    return { status: response.status, body: response.status === 204 ? null : await response.json() };
  }
  const expect = (result, status, label) => { assert.equal(result.status, status, `${label}: unexpected HTTP status`); return result.body; };
  const accountList = () => users.map(user => literal(user.id)).join(',');
  const hashList = () => users.map(user => literal(user.accountHash)).join(',');
  const count = async sql => Number((await d1(sql, { captureResults: true }))[0]?.n ?? NaN);
  function credential(id, now) {
    const sessionId = randomBytes(8).toString('hex'), secret = randomBytes(32).toString('base64url');
    return { token: `mdn1.${sessionId}.${secret}`,
      sql: `INSERT INTO sessions(id,user_id,secret_hash,client,created_at,last_seen,expires_at) VALUES(${literal(sessionId)},${literal(id)},${literal(hash(secret))},'ersomha-preview-test',${now},${now},${now + 3_600_000});` };
  }
  async function seed() {
    const statements = [], now = Date.now();
    for (let i = 0; i < 8; i++) {
      const id = `ersomha-test-${runId}-${i}`, main = credential(id, now), cleanup = credential(id, now);
      users.push({ id, token: main.token, cleanupToken: cleanup.token, accountHash: await ersomhaAccountHash(id) });
      statements.push(`INSERT INTO users(id,name,email,created_at,updated_at) VALUES(${literal(id)},${literal(`اختبار ${i + 1}`)},NULL,${now},${now});`, main.sql, cleanup.sql);
    }
    seeded = true; await d1(statements.join('\n'));
    for (const user of users) { const me = expect(await request(user, '/api/me'), 200, 'authenticated fixture'); assert.equal(me.user.id, user.id, 'Session must identify its own fixture account.'); metrics.authenticatedAccounts++; }
    report.authenticatedPeers = 8;
  }
  class PreviewSocket extends WebSocket {
    constructor(input) {
      const url = new URL(input); assert.equal(url.protocol, 'wss:');
      assertErsomhaPreviewURL(`https://${url.host}${url.pathname}`);
      assert.equal(url.search + url.hash, '', 'No credentials in WebSocket URL.');
      super(url.href, { origin: 'maydan://app' });
    }
  }
  async function createRoom(accounts, settings = { cycles: 1, difficulty: 'medium', categories: [] }) {
    assert.ok(rooms.length < 8, 'This runner may create at most eight rooms in the normal ten-minute quota.');
    const seats = accounts.map((account, index) => ({ account, session: { ...newCredentials(), name: `اختبار ${users.indexOf(account) + 1}`, avatar: index % 4, capabilities: ROOM_CAPABILITIES }, client: null }));
    const room = { code: null, seats, closedVerified: false, before: [], testedFamilies: new Set() }; rooms.push(room);
    const created = expect(await request(accounts[0], '/api/rooms', 'POST', { ...seats[0].session, game: 'ersomha', deviceId: randomBytes(16).toString('hex'), settings }), 201, 'create preview room');
    assert.match(created.code, /^\d{6}$/); room.code = created.code;
    for (const [index, seat] of seats.entries()) {
      if (index) expect(await request(seat.account, `/api/rooms/${room.code}/join`, 'POST', seat.session), 200, 'join preview room');
      seat.client = new RoomClient({ server: ERSOMHA_PREVIEW_ORIGIN, code: room.code, session: seat.session,
        getAccountAuthorization: () => `Bearer ${seat.account.token}`, WebSocketImpl: PreviewSocket });
      clients.push(seat.client); seat.client.start();
      const admitted = seats.slice(0, index + 1);
      await until(() => admitted.every(peer => peer.client.state?.members.filter(member => member.connected && !member.left).length === admitted.length), 'account-authenticated lobby admission');
      if (seats.length === 8 && admitted.length >= 3) metrics.intermediateCompetitiveLobbies.push(admitted.length);
    }
    await until(() => seats.every(seat => seat.client.state?.members.filter(member => member.connected && !member.left).length === seats.length), 'all account-authenticated room seats');
    metrics.maximumConnected = Math.max(metrics.maximumConnected, seats.length);
    for (const seat of seats.slice(1)) await seat.client.command('ready', { ready: true });
    return room;
  }
  const state = room => room.seats[0].client.state;
  async function closeRoom(room) {
    if (!room.code || room.closedVerified) return;
    for (const seat of room.seats) { const result = await request(seat.account, `/api/rooms/${room.code}/leave`, 'POST', seat.session); assert.ok([200, 404].includes(result.status), 'Fixture leave failed.'); seat.client?.stop(); }
    const probe = { ...newCredentials(), name: 'تحقق إغلاق', avatar: 0, capabilities: ROOM_CAPABILITIES };
    expect(await request(users[0], `/api/rooms/${room.code}/join`, 'POST', probe), 404, 'closed room cannot be recovered or joined'); room.closedVerified = true;
  }
  async function start(room) {
    const hashes = room.seats.map(seat => literal(seat.account.accountHash)).join(',');
    room.before = await d1(`SELECT family_id,concept_id FROM ersomha_seen WHERE account_hash IN (${hashes});`, { captureResults: true });
    await room.seats[0].client.command('start');
    await until(() => room.seats.every(seat => seat.client.state?.phase === 'select'), 'shared private choice phase');
  }
  async function select(room) {
    const drawer = room.seats.find(seat => seat.session.id === state(room).drawerId);
    const choices = drawer.client.state.myChoices; assert.equal(choices.length, 3, 'Drawer receives exactly three choices.');
    const forbidden = new Set(['visualNote', 'review', 'ersomhaPlan', 'ersomhaLease', 'tokenHash', 'accountUserId', 'accountHash', 'independentReason']);
    const inspect = value => {
      if (!value || typeof value !== 'object') return;
      for (const [key, item] of Object.entries(value)) { assert.ok(!forbidden.has(key), 'Private editorial, history or authentication data appeared in a snapshot.'); inspect(item); }
    };
    room.seats.forEach(seat => inspect(seat.client.state));
    assert.equal(new Set(choices.map(choice => choice.category)).size, 3, 'Choice categories must differ.');
    for (const choice of choices) {
      const card = bank.get(choice.id); assert.ok(card, 'Choice belongs to the frozen private bank.');
      assert.equal(choice.text, card.answer, 'Drawer choice text must match the frozen private concept.');
      assert.ok(!room.before.some(old => old.family_id === card.familyId || old.concept_id === card.conceptId), 'Previously exposed concept/family was offered.');
      assert.ok(!room.testedFamilies.has(card.familyId), 'A family was reused in the same match.'); room.testedFamilies.add(card.familyId);
      privateWords.add(choice.text);
    }
    for (const seat of room.seats.filter(seat => seat !== drawer)) {
      assert.deepEqual(seat.client.state.myChoices, [], 'Choices leaked to a guesser.');
      for (const choice of choices) assert.equal(JSON.stringify(seat.client.state).includes(choice.text), false, 'A private choice leaked through a guesser snapshot.');
    }
    await drawer.client.command('select_word', { choiceId: choices[0].id });
    await until(() => room.seats.every(seat => seat.client.state?.phase === 'draw'), 'shared drawing phase');
    const answer = drawer.client.state.myWord; assert.equal(typeof answer, 'string', 'Drawer must receive its selected word.'); privateWords.add(answer);
    assert.equal(answer, choices[0].text, 'The selected choice must become the private drawing word.');
    for (const seat of room.seats.filter(seat => seat !== drawer)) {
      assert.equal(seat.client.state.myWord, null, 'Selected word leaked to a guesser.'); assert.equal(seat.client.state.revealedWord, null);
      assert.equal(JSON.stringify(seat.client.state).includes(answer), false, 'Hidden answer appeared before reveal.');
    }
    metrics.privateTurns++; metrics.noRepeatTurns++;
    return { drawer, answer };
  }
  const pendingEvidence = [];
  async function privateReport(room, drawer, answer) {
    const reporter = room.seats.find(seat => seat !== drawer), round = state(room).round, matchId = state(room).matchId;
    const messages = room.seats.map(() => []), stops = room.seats.map((seat, i) => seat.client.subscribeDrawing(event => messages[i].push(event)));
    try {
      await assert.rejects(reporter.client.command('drawing_batch', { epoch: reporter.client.state.drawing.epoch,
        strokeId: 'forged-guesser-stroke', tool: 'pen', color: '#118d96', width: 6, points: [[.2, .2]], end: true }),
      error => error.code === 'ERSOMHA_DRAWER_ONLY');
      for (let point = 0; point < 4; point++) await drawer.client.command('drawing_batch', { epoch: drawer.client.state.drawing.epoch,
        strokeId: 'preview-evidence-stroke', tool: 'pen', color: '#118d96', width: 6, points: [[.2 + point / 20, .35]], end: point === 3 });
      await until(() => messages.every(events => events.filter(event => event.kind === 'append').length === 4), 'every peer receives persisted stroke batches');
      const input = { roomCode: room.code, matchId, round, reason: 'بلاغ اختبار رسم معزول', clientId: randomUUID() };
      const saved = expect(await request(reporter.account, '/api/games/ersomha/reports', 'POST', input), 201, 'private participant drawing report'); reportIds.push(saved.reportId);
      assert.equal(expect(await request(reporter.account, '/api/games/ersomha/reports', 'POST', input), 201, 'idempotent drawing report').reportId, saved.reportId);
      expect(await request(reporter.account, '/api/games/ersomha/reports', 'POST', { ...input, reason: 'سبب مختلف لنفس محاولة البلاغ' }), 409, 'conflicting report retry');
      expect(await request(users[7], '/api/games/ersomha/reports', 'POST', { ...input, clientId: randomUUID() }), 404, 'outsider cannot report a drawing they never saw');
      expect(await request(null, `/api/moderation/reports/${saved.reportId}/drawing`), 401, 'anonymous evidence read');
      expect(await request(reporter.account, `/api/moderation/reports/${saved.reportId}/drawing`), 403, 'reporter is not automatically a moderator');
      expect(await request(users[7], `/api/moderation/reports/${saved.reportId}/drawing`), 403, 'outsider evidence read');
      pendingEvidence.push({ id: saved.reportId, answer, points: 4 }); metrics.privateReports++;
    } finally { stops.forEach(stop => stop()); }
  }
  async function playMatch(room, { evidence = false } = {}) {
    await start(room); const count = room.seats.length;
    assert.equal(state(room).settings.mode, count === 2 ? 'cooperative' : 'competitive', 'Player count determines the honest scoring mode.');
    for (let round = 1; round <= count; round++) {
      await until(() => room.seats.every(seat => seat.client.state?.round === round && seat.client.state?.phase === 'select'), 'next drawer choice', 15_000);
      const { drawer, answer } = await select(room);
      if (evidence && round === 1) await privateReport(room, drawer, answer);
      for (const seat of room.seats.filter(seat => seat !== drawer)) await seat.client.command('guess', { text: answer });
      await until(() => room.seats.every(seat => seat.client.state?.phase === 'result'), 'all correct guesses complete the drawing early');
      assert.equal(state(room).revealedWord, answer, 'Word is revealed only after the turn.'); assert.equal(state(room).guessedIds.length, count - 1);
    }
    await until(() => room.seats.every(seat => seat.client.state?.phase === 'over'), 'automatic match completion after seven-second reveal', 15_000);
    if (count === 2) { assert.equal(state(room).cooperative.solvedTurns, 2); assert.ok(state(room).cooperative.remainingMs > 0); metrics.completedCooperative++; }
    else { assert.ok(state(room).members.every(member => member.score > 0)); metrics.completedCompetitive.push(count); }
    await closeRoom(room);
  }
  async function previewSnapshot() {
    const snapshot = await snapshotWorker(remoteApi, ERSOMHA_PREVIEW);
    const bindings = snapshot.settings.bindings;
    assert.equal(bindings.filter(binding => binding.type === 'd1').length, 1, 'One deployed preview D1 binding required.');
    const db = bindings.find(binding => binding.name === 'DB'); assert.equal(db?.id || db?.database_id, ERSOMHA_PREVIEW_DATABASE);
    assert.ok(!bindings.some(binding => binding.type === 'assets'), 'Production assets forbidden.');
    assert.ok(bindings.filter(binding => binding.type === 'durable_object_namespace').every(binding => !binding.script_name || binding.script_name === ERSOMHA_PREVIEW), 'Production Durable Objects forbidden.');
    assert.equal(bindings.find(binding => binding.name === 'SOCIAL_AUDIO')?.bucket_name, 'maydan-lamma-preview-audio');
    assert.equal(snapshot.version.resources.script_runtime.migration_tag, 'v1-lamma-preview');
    await assertDeployedBundle(snapshot.script, ERSOMHA_PREVIEW, frozen.sha256);
    return snapshot;
  }
  try {
    await guard(); await mkdir(OUTPUT, { recursive: true });
    source = await getBackendProvenance(ROOT, { requireClean: true }); Object.assign(report, source);
    frozen = await bundleErsomhaWorker('maydan-rooms'); report.testedModuleSHA256 = frozen.sha256;
    const { stdout } = await execute(process.execPath, [path.join(ROOT, 'node_modules/wrangler/bin/wrangler.js'), 'auth', 'token', '--json'],
      { cwd: ROOT, maxBuffer: 1024 * 1024, timeout: 30_000, windowsHide: true });
    const credential = JSON.parse(stdout); assert.ok(credential.token && /oauth|api/i.test(credential.type), 'Existing Wrangler authentication required.');
    const read = ersomhaApiClient(credential.token, { databaseId: ERSOMHA_PREVIEW_DATABASE });
    remoteApi = (suffix, options) => { assert.ok(suffix.startsWith(`/workers/scripts/${ERSOMHA_PREVIEW}`), 'Only preview Worker metadata may be read.'); return read(suffix, options); };
    firstDeployment = await previewSnapshot(); report.previewDeploymentVersion = firstDeployment.versionId;
    assert.ok(expect(await request(null, '/health'), 200, 'preview health').games.includes('ersomha'), 'Preview must already have Ersomha deployed.');
    await seed();
    await check('two-player-cooperative', async () => { await playMatch(await createRoom([users[0], users[1]])); return { completedMatches: 1, solvedTurns: 2, physicalTrial: false }; });
    await check('three-to-eight-competitive', async () => {
      await playMatch(await createRoom([users[2], users[3], users[4]]), { evidence: true });
      await playMatch(await createRoom([users[5], users[0], users[1], users[2], users[3], users[4], users[6], users[7]]));
      assert.deepEqual(metrics.completedCompetitive, [3, 8]);
      assert.deepEqual(metrics.intermediateCompetitiveLobbies, [3, 4, 5, 6, 7, 8]);
      return { completeMatchSizes: [3, 8], authenticatedLobbySizes: metrics.intermediateCompetitiveLobbies,
        note: 'Boundary matches exercise competitive scoring; intermediate population sizes are admission/lobby checks, not six separate full-match trials.' };
    });
    await check('eight-authenticated-peers', async () => { assert.equal(metrics.authenticatedAccounts, 8); assert.equal(metrics.maximumConnected, 8); return { distinctAccountSessions: 8, simultaneousAuthenticatedWebSockets: 8 }; });
    await check('server-only-choices', async () => { assert.equal(metrics.privateTurns, 13); return { turnsChecked: 13, selectedWordOnlyOnDrawerBeforeReveal: true, noBankOrEditorialEvidenceInSnapshots: true }; });
    await check('history-no-repeat', async () => { assert.equal(metrics.noRepeatTurns, 13); return { turnsChecked: 13, exclusions: 'Exact union of persisted account concept/family history before each match and all offered within-match families.' }; });
    await check('private-drawing-reports', async () => {
      assert.ok(pendingEvidence.length > 0);
      for (const item of pendingEvidence) {
        const rows = await d1(`SELECT evidence_json FROM ersomha_drawing_reports WHERE report_id=${literal(item.id)};`, { captureResults: true });
        assert.equal(rows.length, 1); const evidence = JSON.parse(rows[0].evidence_json);
        assert.equal(evidence.canvas.strokes[0].points.length, item.points, 'Stored private evidence must contain the committed stroke.');
        assert.equal(JSON.stringify(evidence).includes(item.answer), false, 'Reports must not archive the secret word.');
      }
      return { persistedReports: metrics.privateReports, idempotentRetry: true, unauthorizedApiReadsDenied: true, answerExcludedFromEvidence: true };
    });
    await check('concurrent-account-lock', async () => {
      const a = await createRoom([users[6], users[7]]), b = await createRoom([users[7], users[6]]);
      const outcomes = await Promise.allSettled([a.seats[0].client.command('start'), b.seats[0].client.command('start')]);
      assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 1, 'Exactly one room must acquire the shared accounts.');
      assert.equal(outcomes.find(result => result.status === 'rejected').reason.code, 'ERSOMHA_ACTIVE_ELSEWHERE');
      const rows = await d1(`SELECT room_key FROM ersomha_leases WHERE account_hash IN (${literal(users[6].accountHash)},${literal(users[7].accountHash)}) AND expires_at>${Date.now()};`, { captureResults: true });
      assert.equal(rows.length, 2); assert.equal(new Set(rows.map(row => row.room_key)).size, 1, 'No partial cross-room lease acquisition.');
      await closeRoom(a); await closeRoom(b); return { competingRooms: 2, sharedAuthenticatedAccounts: 2, exactlyOneWinner: true };
    });
    await check('history-exhaustion-safe', async () => {
      const selected = [users[1], users[3]], categories = ['animals', 'food', 'home'];
      const room = await createRoom(selected, { cycles: 1, difficulty: 'easy', categories, allowReplay: false });
      const marker = `preview-exhaustion:${runId}`, now = Date.now();
      await d1(selected.flatMap(user => getErsomhaPool({ difficulty: 'easy', categories }).map(card =>
        `INSERT OR IGNORE INTO ersomha_seen(account_hash,family_id,concept_id,exposure_id,seen_at,seen_count) VALUES(${literal(user.accountHash)},${literal(card.familyId)},${literal(card.conceptId)},${literal(marker)},${now},1);`)).join('\n'));
      const before = await count(`SELECT COUNT(*) AS n FROM trials WHERE user_id=${literal(users[1].id)} AND game='ersomha';`); assert.equal(before, 0);
      await assert.rejects(room.seats[0].client.command('start'), error => error.code === 'ERSOMHA_CONTENT_EXHAUSTED');
      assert.ok(room.seats.every(seat => seat.client.state.phase === 'lobby' && seat.client.state.myChoices.length === 0), 'Exhaustion cannot reveal old choices or silently change difficulty.');
      assert.equal(await count(`SELECT COUNT(*) AS n FROM trials WHERE user_id=${literal(users[1].id)} AND game='ersomha';`), before, 'Exhaustion cannot spend the free start.');
      await d1(`DELETE FROM ersomha_seen WHERE exposure_id=${literal(marker)} AND account_hash IN (${selected.map(user => literal(user.accountHash)).join(',')});`);
      await closeRoom(room); return { remoteFaultInjection: 'Synthetic fixture history saturation in isolated preview D1 only', silentReplay: false, trialConsumed: false };
    });
    await check('stale-lease-fencing', async () => {
      const a = await createRoom([users[3], users[4]]), b = await createRoom([users[4], users[3]]);
      await start(a); const { drawer, answer } = await select(a), hashes = [users[3], users[4]].map(user => literal(user.accountHash)).join(',');
      const before = structuredClone(state(a));
      const old = await d1(`SELECT account_hash,room_key,fence FROM ersomha_leases WHERE account_hash IN (${hashes});`, { captureResults: true }); assert.equal(old.length, 2);
      const oldKey = old[0].room_key;
      const exposureQuery = `SELECT COUNT(*) AS n FROM ersomha_seen WHERE account_hash IN (${hashes}) AND exposure_id LIKE ${literal(oldKey + ':%')};`;
      const leaseQuery = `SELECT account_hash,room_key,fence,expires_at FROM ersomha_leases WHERE account_hash IN (${hashes});`;
      const oldExposureCount = await count(exposureQuery);
      await d1(`UPDATE ersomha_leases SET expires_at=0 WHERE account_hash IN (${hashes}) AND room_key=${literal(oldKey)};`);
      await start(b);
      const current = await d1(leaseQuery, { captureResults: true }); assert.equal(current.length, 2);
      assert.ok(current.every(row => row.room_key !== oldKey && row.fence > old.find(previous => previous.account_hash === row.account_hash).fence), 'New room must increment every lease generation.');
      const guesser = a.seats.find(seat => seat !== drawer);
      let errorCode;
      try { await guesser.client.command('guess', { text: answer }); } catch (error) { errorCode = error.code; }
      if (!errorCode) {
        await until(() => ['result', 'over'].includes(state(a).phase), 'old room reaches its reveal or is safely stopped');
        if (state(a).phase === 'result') {
          const revealEnd = state(a).deadlineAt - (a.seats[0].client.clockOffset || 0);
          if (revealEnd > Date.now()) await wait(Math.min(8_000, revealEnd - Date.now() + 100));
        }
        try { await a.seats[0].client.command('next'); } catch (error) { errorCode = error.code; }
      }
      assert.ok(['ERSOMHA_ACTIVE_ELSEWHERE', 'PHASE', 'STALE'].includes(errorCode), 'A command in the revoked room must be rejected.');
      await until(() => a.seats.every(seat => seat.client.state?.phase === 'over'), 'every old-room seat observes lease revocation', 35_000);
      const stopped = a.seats.map(seat => structuredClone(seat.client.state));
      const verify = async () => assertErsomhaStaleLeaseOutcome({ errorCode, before, states: stopped, selectedWord: answer,
        exposuresBefore: oldExposureCount, exposuresAfter: await count(exposureQuery),
        expectedLeases: current, observedLeases: await d1(leaseQuery, { captureResults: true }) });
      await verify(); await closeRoom(a); await verify(); await closeRoom(b);
      return { remoteFaultInjection: 'Only this run\'s fixture leases were expired in preview D1', increasedFences: 2,
        staleNewExposureDenied: true, revokedRoomTerminated: true, replacementLeasesPreservedThroughOldRoomCleanup: true,
        rejectedCommandCode: errorCode };
    });
    report.metrics = metrics;
    report.passed = true;
  } catch (error) { report.passed = false; report.error = safeError(error); }
  finally {
    let verificationFailed = !seeded;
    for (const room of rooms) try { await closeRoom(room); } catch { verificationFailed = true; }
    clients.forEach(client => client.stop());
    if (seeded) for (const user of users) {
      try { const result = await request({ token: user.cleanupToken }, '/api/account', 'DELETE'); if (![204, 401, 404].includes(result.status)) verificationFailed = true; }
      catch { verificationFailed = true; }
    }
    const cleanup = { remainingUsersAndSessions: 0, remainingRooms: rooms.filter(room => room.code && !room.closedVerified).length,
      remainingReports: 0, remainingLeases: 0, remainingHistory: 0, verificationFailed };
    if (seeded) try {
      cleanup.remainingUsersAndSessions = await count(`SELECT (SELECT COUNT(*) FROM users WHERE id IN (${accountList()}))+(SELECT COUNT(*) FROM sessions WHERE user_id IN (${accountList()})) AS n;`);
      cleanup.remainingReports = await count(`SELECT (SELECT COUNT(*) FROM ersomha_drawing_reports WHERE reporter_id IN (${accountList()}) OR reported_id IN (${accountList()}))+(SELECT COUNT(*) FROM social_reports WHERE reporter_id IN (${accountList()}) OR reported_id IN (${accountList()})) AS n;`);
      cleanup.remainingLeases = await count(`SELECT COUNT(*) AS n FROM ersomha_leases WHERE account_hash IN (${hashList()});`);
      cleanup.remainingHistory = await count(`SELECT COUNT(*) AS n FROM ersomha_seen WHERE account_hash IN (${hashList()});`);
    } catch { cleanup.verificationFailed = true; }
    if (Object.entries(cleanup).some(([key, value]) => key !== 'verificationFailed' && (!Number.isFinite(value) || value !== 0))) cleanup.verificationFailed = true;
    report.cleanup = cleanup;
    if (!cleanup.verificationFailed) report.checks.push({ name: 'account-and-report-cleanup', passed: true, scope: 'remote-preview',
      details: { accountDeletionViaAuthenticatedApi: seeded, closedRoomsVerifiedViaDeniedRejoin: rooms.filter(room => room.closedVerified).length, d1ZeroCountsVerified: seeded } });
    else { report.checks.push({ name: 'account-and-report-cleanup', passed: false, scope: 'remote-preview' }); report.passed = false; }
    if (firstDeployment) try {
      const after = await getBackendProvenance(ROOT, { requireClean: true }), deployed = await previewSnapshot();
      assert.equal(after.sourceCommit, source.sourceCommit); assert.equal(after.sourceServerTree, source.sourceServerTree); assert.equal(after.backendTreeSha256, source.backendTreeSha256);
      assert.equal(deployed.versionId, firstDeployment.versionId, 'Preview deployment changed during acceptance.');
      assert.equal((await bundleErsomhaWorker('maydan-rooms')).sha256, frozen.sha256, 'Worker source changed during acceptance.');
      report.finishedPreviewDeploymentVersion = deployed.versionId;
    } catch (error) { report.passed = false; report.provenanceError = safeError(error); }
    if (!ERSOMHA_API_CHECKS.every(name => report.checks.some(check => check.name === name && check.passed))) report.passed = false;
    report.finishedAt = new Date().toISOString();
    await mkdir(OUTPUT, { recursive: true }); await writeFile(path.join(OUTPUT, 'last-result.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  }
  return report;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try { const report = await runErsomhaPreviewAcceptance(); console.log(`Sanitized report: .cache/ersomha-preview/last-result.json (${report.passed ? 'PASS' : 'FAIL'})`); if (!report.passed) process.exitCode = 1; }
  catch { console.error('Use only explicit --run-preview after the isolated preview deployment and fixtures are authorized. No acceptance run started.'); process.exitCode = 1; }
}

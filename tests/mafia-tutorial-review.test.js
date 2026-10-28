import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import * as mafia from '../server/mafia-model.mjs';
import {
  tutorialOwner, tutorialStorageKey, emptyTutorialRecord, readTutorialRecord, saveTutorialRecord,
  clearDeletedTutorialAccount, hasOwnedRoomRestore, shouldStartTutorial, mergeTutorialStatus, createTutorialStatusSync,
} from '../src/games/mafia/tutorial/progress.js';
import { localEnvironment } from '../server/local.mjs';
import { routeRequest } from '../server/worker.mjs';
import { createUser } from '../server/accounts/db.mjs';
import { issueSession } from '../server/accounts/session.mjs';
import { createMafiaTutorial, validateTutorialProgress } from '../src/games/mafia/tutorial/adapter.mjs';

// An independent, pinned pre-extraction oracle. Generated from the complete
// committed dependency graph at 58e4d36, not from the extracted implementation.
const NOW = 1_810_000_000_000;
const PRE_EXTRACTION_DIGEST = 'cc2a5fc2d1f74c5e254a01096c89967dad108bf3fc5943b5b4e772533f69deb0';
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
function random(seed) { let value = seed; return () => (value = (Math.imul(value, 1103515245) + 12345) >>> 0); }
const actor = index => ({ id: `review${index}`, tokenHash: `not-a-real-token-${index}`, name: `مراجع ${index}`, avatar: index % 4 });
function command(engine, room, id, payload, at, options) {
  return engine.action(room, id, { matchId: room.matchId, phaseId: room.phaseId, ...payload }, at, options);
}
function readyRoom(engine, count) {
  const room = engine.createRoom('REVIEW', { ...actor(0), settings: { mode: count >= 9 ? 'shadow' : 'classic', capacity: count, visibility: 'private', voiceMode: 'off' } }, NOW);
  for (let index = 1; index < count; index++) engine.joinRoom(room, actor(index), NOW);
  for (const person of room.members) {
    engine.connected(room, person.id, true, NOW);
    command(engine, room, person.id, { type: 'ready', ready: true }, NOW);
  }
  return room;
}
function semanticDigest(engine) {
  const hash = createHash('sha256');
  let matches = 0, transitions = 0;
  const capture = (room, at) => hash.update(JSON.stringify(canonical({
    room,
    views: room.members.filter(person => !person.left).map(person => engine.snapshot(room, person.id, at)),
    public: engine.publicSnapshot(room),
    voices: engine.voiceGroups(room),
    results: engine.matchResults(room),
  })));
  for (let count = 6; count <= 12; count++) for (const seed of [7, 19, 107, 2029]) {
    const rng = random(count * 20_000 + seed);
    let room = readyRoom(engine, count);
    command(engine, room, room.hostId, { type: 'start' }, NOW, { randomWord: rng });
    capture(room, NOW);
    for (let step = 0; room.phase !== 'over'; step++) {
      assert.ok(step < 100);
      const at = room.deadlineAt - 1;
      const living = room.participants.filter(id => room.roleStates[id].alive);
      const nominee = living[rng() % living.length];
      const attack = living.find(id => room.roleStates[id].faction !== 'mafia');
      for (const id of living) {
        const actions = engine.snapshot(room, id, at).you.actions;
        for (const choice of actions) {
          if (rng() % 11 === 0) continue;
          let payload;
          if (choice.type === 'verdict') payload = { type: choice.type, approve: rng() % 4 !== 0 };
          else if (choice.type === 'herald') { if (rng() % 2 === 0) continue; payload = { type: choice.type }; }
          else if (choice.count === 2 && choice.targets.length >= 2) {
            const first = rng() % choice.targets.length;
            payload = { type: choice.type, targetIds: [choice.targets[first], choice.targets[(first + 1) % choice.targets.length]] };
          } else if (choice.targets.length) {
            payload = { type: choice.type, targetId: choice.type === 'mafia_vote' && choice.targets.includes(attack) ? attack : choice.type === 'nominate' && choice.targets.includes(nominee) ? nominee : choice.targets[rng() % choice.targets.length] };
          }
          if (payload) { command(engine, room, id, payload, at); capture(room, at); }
        }
      }
      engine.tick(room, room.deadlineAt);
      capture(room, room.outcome?.endedAt || room.deadlineAt - 1);
      room = structuredClone(room);
      transitions++;
    }
    matches++;
  }
  return { matches, transitions, sha256: hash.digest('hex') };
}

test('independent review: shared extraction preserves every pre-extraction state and player/public projection over 28 full matches', () => {
  const result = semanticDigest(mafia);
  assert.equal(result.matches, 28);
  assert.ok(result.transitions > 150);
  assert.equal(result.sha256, PRE_EXTRACTION_DIGEST);
});

test('independent review: live command payload cannot inject tutorial roles, RNG, checkpoints or rewinds', () => {
  const normal = readyRoom(mafia, 8), forged = structuredClone(normal);
  command(mafia, normal, normal.hostId, { type: 'start' }, NOW, { randomWord: random(83) });
  command(mafia, forged, forged.hostId, {
    type: 'start', tutorial: true, seed: 1, randomWord: 0, roles: { review0: 'mafia' },
    checkpoint: { phase: 'over', outcome: { faction: 'mafia' } }, rewind: true,
  }, NOW, { randomWord: random(83) });
  assert.deepEqual(forged, normal);
  for (const type of ['tutorial', 'tutorial_rewind', 'rewind', 'set_roles', 'set_seed', 'restore_checkpoint']) {
    const before = structuredClone(forged);
    assert.throws(() => command(mafia, forged, forged.hostId, { type, tutorial: true, seed: 1 }, NOW), { code: 'INVALID' });
    assert.deepEqual(forged, before);
  }
});

test('independent review: browser rules and lesson bundles never traverse server or private content dependencies', async () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  for (const entry of ['src/games/mafia/rules.mjs', 'src/games/mafia/tutorial/adapter.mjs']) {
    const compiled = await build({ absWorkingDir: root, entryPoints: [entry], bundle: true, write: false, metafile: true, platform: 'browser', format: 'esm', logLevel: 'silent' });
    const inputs = Object.keys(compiled.metafile.inputs);
    assert.ok(inputs.length >= 3);
    for (const input of inputs) {
      assert.match(input, /^src\//, input);
      assert.doesNotMatch(input, /(?:^|\/)(?:server|private|bank|banks|node_modules)(?:\/|$)|ersomha.*content|accounts|livekit|voice-session/i, input);
    }
    assert.doesNotMatch(compiled.outputFiles[0].text, /(?:WebSocket\s*\(|getUserMedia\s*\(|fetch\s*\(|\.prepare\s*\(|LIVEKIT_API_SECRET|ERSOMHA_CONTENT)/);
  }
});

const preview = 'https://isolated-mafia.example.test';
const ownAccount = id => ({ ready: true, signedIn: true, user: { id } });
function memoryStorage() {
  const entries = new Map();
  return { entries, getItem: key => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value), removeItem: key => entries.delete(key) };
}
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
const serverStatus = status => ({ tutorialId: 'mafia', scenarioVersion: 1, rulesetVersion: 1, status, updatedAt: 1, outdated: false });

test('independent review: local records reject foreign owners and raw states; account deletion preserves other owners and environments', () => {
  const storage = memoryStorage(), a = tutorialOwner(ownAccount('a'), preview), b = tutorialOwner(ownAccount('b'), preview);
  const productionA = tutorialOwner(ownAccount('a'), 'https://production.example.test');
  const guest = tutorialOwner({ ready: true, signedIn: false }, preview);
  assert.equal(tutorialOwner({ ready: false }, preview), null);
  assert.equal(tutorialOwner({ ready: true, signedIn: true, user: null }, preview), null);
  assert.notEqual(a, b); assert.notEqual(a, productionA); assert.notEqual(a, guest);
  for (const owner of [a, b, productionA, guest]) assert.equal(saveTutorialRecord(storage, owner, { ...emptyTutorialRecord(owner), status: 'skipped' }), true);
  assert.equal(saveTutorialRecord(storage, a, emptyTutorialRecord(b)), false);
  storage.setItem(tutorialStorageKey(a), JSON.stringify({ ...emptyTutorialRecord(b), progress: { room: { phase: 'over' } } }));
  assert.equal(readTutorialRecord(storage, a).invalid, true);
  storage.setItem(tutorialStorageKey(a), JSON.stringify({ ...emptyTutorialRecord(a), status: 'in-progress', progress: { room: { phase: 'over' } } }));
  const rejected = readTutorialRecord(storage, a);
  assert.equal(rejected.progress, null); assert.equal(rejected.invalid, true);
  storage.setItem(tutorialStorageKey(a), JSON.stringify({ ...emptyTutorialRecord(a), rulesetVersion: 700 }));
  assert.equal(readTutorialRecord(storage, a).outdated, true);
  clearDeletedTutorialAccount({ userId: 'a', server: preview, storage });
  assert.equal(storage.getItem(tutorialStorageKey(a)), null);
  for (const owner of [b, productionA, guest]) assert.equal(readTutorialRecord(storage, owner).status, 'skipped');
});

test('independent review: automatic tutorial never intercepts invites, owned room/observer restores, skipped lessons or incomplete account loading', () => {
  const record = emptyTutorialRecord('test');
  assert.equal(shouldStartTutorial({ normalEntry: true, ready: true, hasRestore: false, record }), true);
  for (const patch of [{ normalEntry: false }, { ready: false }, { hasRestore: true }, { record: { ...record, status: 'skipped' } }, { record: { ...record, status: 'completed' } }, { record: { ...record, progress: { decisions: [] } } }, { record: { ...record, invalid: true } }, { record: { ...record, outdated: true } }]) {
    assert.equal(shouldStartTutorial({ normalEntry: true, ready: true, hasRestore: false, record, ...patch }), false);
  }
  for (const observer of [false, true]) {
    const values = observer ? { lastObserverRoom: '234567', 'observer:234567': 'seat-proof', 'observerOwner:234567': 'a' } : { lastRoom: '234567', 234567: 'seat-proof', 'roomOwner:234567': 'a' };
    assert.equal(hasOwnedRoomRestore(key => values[key], 'a'), true);
    assert.equal(hasOwnedRoomRestore(key => values[key], 'b'), false);
    assert.equal(hasOwnedRoomRestore(key => values[key], null), false);
  }
});

test('independent review: delayed status GET and PUT cannot write or emit after account switches or disposal', async () => {
  for (const method of ['load', 'publish']) for (const stop of ['switch', 'dispose']) {
    const pending = deferred(), requests = [], writes = [], emitted = [];
    let owner = 'a';
    const sync = createTutorialStatusSync({ owner: 'a', isCurrent: value => value === owner,
      request: (url, options) => { requests.push({ url, options }); return pending.promise; },
      read: () => emptyTutorialRecord('a'), write: value => writes.push(value), onStatus: value => emitted.push(value) });
    const result = method === 'load' ? sync.load() : sync.publish('completed');
    assert.equal(requests.length, 1); assert.equal(requests[0].url, '/api/me/tutorials/mafia');
    if (method === 'publish') assert.deepEqual(requests[0].options.body, { scenarioVersion: 1, rulesetVersion: 1, status: 'completed' });
    if (stop === 'switch') owner = 'b'; else sync.dispose();
    pending.resolve(serverStatus('completed'));
    assert.equal(await result, null); assert.deepEqual(writes, []); assert.deepEqual(emitted, []);
    assert.equal(await sync.load(), null); assert.equal(requests.length, 1);
  }
});

test('independent review: out-of-order skip completion responses cannot downgrade completion or synchronize checkpoint data', async () => {
  let record = { ...emptyTutorialRecord('a'), status: 'completed', pendingStatus: 'completed', progress: { localOnly: 'checkpoint' } };
  const first = deferred(), second = deferred(), requests = [];
  const sync = createTutorialStatusSync({ owner: 'a', isCurrent: () => true,
    request: (url, options) => { requests.push({ url, options }); return requests.length === 1 ? first.promise : second.promise; },
    read: () => record, write: value => { record = value; } });
  const stale = sync.publish('skipped'), newer = sync.publish('completed');
  second.resolve(serverStatus('completed')); await newer;
  first.resolve(serverStatus('skipped')); await stale;
  assert.equal(record.status, 'completed');
  assert.equal(JSON.stringify(requests).includes('checkpoint'), false);
  assert.equal(JSON.stringify(requests).includes('owner'), false);
  for (const bad of [{ ...serverStatus('completed'), tutorialId: 'other' }, { ...serverStatus('completed'), rulesetVersion: 700 }, { ...serverStatus('completed'), status: 'admin' }]) assert.deepEqual(mergeTutorialStatus(record, bad), record);
});

test('independent review: a malformed or failed status read cannot validate unseen status or emit writes', async () => {
  for (const response of [null, {}, { ...serverStatus('unseen'), tutorialId: 'another' }, { ...serverStatus('unseen'), scenarioVersion: 200 }, { ...serverStatus('unseen'), status: 'in-progress' }]) {
    const writes = [], emits = [];
    const sync = createTutorialStatusSync({ owner: 'a', isCurrent: () => true, request: async () => response,
      read: () => emptyTutorialRecord('a'), write: value => writes.push(value), onStatus: value => emits.push(value) });
    assert.equal(await sync.load(), null);
    assert.deepEqual(writes, []); assert.deepEqual(emits, []);
  }
  const writes = [];
  const sync = createTutorialStatusSync({ owner: 'a', isCurrent: () => true, request: async () => { throw new Error('offline'); },
    read: () => emptyTutorialRecord('a'), write: value => writes.push(value) });
  assert.equal(await sync.load(), null); assert.deepEqual(writes, []);
});

test('independent review: suspension after authentication still fences tutorial status read when another account is eligible', async t => {
  const runtime = localEnvironment({ vars: {} }); t.after(() => runtime.dispose());
  const env = runtime.env;
  const target = await createUser(env, { name: 'صاحب الدرس', email: 'tutorial-review-target@example.test' });
  await createUser(env, { name: 'حساب آخر', email: 'tutorial-review-other@example.test' });
  const session = await issueSession(env, target.id);
  const prepare = env.DB.prepare.bind(env.DB);
  let fenced = false;
  t.mock.method(env.DB, 'prepare', sql => {
    if (!sql.includes('LEFT JOIN mafia_tutorial_status')) return prepare(sql);
    return { bind: (...params) => ({ first: async () => {
      if (!fenced) {
        fenced = true;
        await prepare('INSERT INTO moderation_suspensions(user_id,reason,actor_id,created_at,updated_at) VALUES(?,?,?,?,?)').bind(target.id, 'test race', 'review-moderator', Date.now(), Date.now()).run();
      }
      return prepare(sql).bind(...params).first();
    } }) };
  });
  const response = await routeRequest(new Request('http://localhost:3000/api/me/tutorials/mafia', {
    headers: { origin: 'http://localhost:3000', authorization: `Bearer ${session.token}` },
  }), env);
  assert.equal(fenced, true);
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error, 'ACCOUNT_UNAVAILABLE');
});

async function correctLessonDecision(tutorial) {
  const step = tutorial.getState().coach.stepId;
  if (step === 'lobby-chat') return tutorial.act('chat', { text: 'مرحبًا يا جماعة' });
  if (step === 'lobby-voice') { tutorial.guide('voice-joined'); return tutorial.guide('voice-unmuted'); }
  if (step === 'lobby-ready') return tutorial.act('ready', { ready: true });
  if (step === 'lobby-start') return tutorial.act('start');
  if (step === 'role-open' || step === 'role-close') return tutorial.guide(step);
  if (step === 'night-1-pick' || step === 'night-2-pick') return tutorial.act('night_action', { targetId: step === 'night-1-pick' ? 'tutorial-mafia' : 'tutorial-masker' });
  if (step === 'nomination-1' || step === 'nomination-2') return tutorial.act('nominate', { targetId: step === 'nomination-1' ? 'tutorial-mafia' : 'tutorial-masker' });
  if (step === 'verdict-1' || step === 'verdict-2') return tutorial.act('verdict', { approve: true });
  if (step === 'night-1-result' || step === 'night-2-result') tutorial.guide('clues-open');
  if (step === 'quiz-majority' || step === 'quiz-information') return tutorial.guide('quiz-answer', step === 'quiz-majority' ? 'four' : 'dated');
  if (step === 'encyclopedia') { tutorial.guide('encyclopedia-open'); return tutorial.guide('encyclopedia-close'); }
  return tutorial.guide('continue');
}
async function lessonUntil(tutorial, target) {
  for (let steps = 0; tutorial.getState().coach.stepId !== target; steps++) {
    assert.ok(steps < 50, `lesson did not reach ${target}`);
    assert.equal(await correctLessonDecision(tutorial), true, tutorial.getState().coach.stepId);
  }
  return tutorial.getState();
}
const lessonComparable = ({ checkpointRevision: _revision, restoreStatus: _restored, ...state }) => state;

test('independent review: complete eight-seat two-night lesson preserves real rules, secrecy, unused mask and zero external I/O', async t => {
  let outbound = 0;
  t.mock.method(globalThis, 'fetch', () => { outbound++; throw new Error('forbidden tutorial network'); });
  if (typeof globalThis.WebSocket === 'function') t.mock.method(globalThis, 'WebSocket', () => { outbound++; throw new Error('forbidden tutorial socket'); });
  const tutorial = createMafiaTutorial(); t.after(() => tutorial.dispose());
  const initial = tutorial.getState();
  assert.equal(initial.snapshot.members.length, 8);
  assert.equal(initial.snapshot.members.filter(person => person.trainingBot).length, 7);
  assert.equal(initial.snapshot.you.roleId, null);
  assert.equal(tutorial.advance(1000), false); assert.deepEqual(tutorial.getState().clock, initial.clock);
  const nightOne = await lessonUntil(tutorial, 'night-1-pick');
  assert.equal(nightOne.snapshot.you.roleId, 'investigator'); assert.equal(nightOne.snapshot.you.resources.charges, 2);
  assert.equal(nightOne.coach.expectedTargetId, 'tutorial-mafia');
  assert.equal(nightOne.snapshot.replay, null);
  assert.equal(nightOne.snapshot.members.some(person => person.roleId || person.faction), false);
  const dawnOne = await lessonUntil(tutorial, 'night-1-result');
  assert.equal(dawnOne.snapshot.you.resources.charges, 1);
  assert.equal(dawnOne.snapshot.members.filter(person => person.alive).length, 8);
  assert.equal(dawnOne.snapshot.log.some(event => event.type === 'eliminated'), false);
  assert.equal(dawnOne.snapshot.log.some(event => /protect|doctor|mask/.test(event.type)), false);
  assert.equal(dawnOne.snapshot.you.reports.length, 1);
  const nightTwo = await lessonUntil(tutorial, 'night-2-pick');
  assert.equal(nightTwo.coach.expectedTargetId, undefined);
  assert.equal(nightTwo.coach.mode, 'practice');
  assert.equal(nightTwo.snapshot.members.filter(person => person.alive).length, 7);
  const verdictOne = nightTwo.snapshot.log.find(event => event.type === 'verdict_closed');
  assert.deepEqual([verdictOne.approvals, verdictOne.total, verdictOne.passed], [5, 8, true]);
  const dawnTwo = await lessonUntil(tutorial, 'night-2-result');
  assert.equal(dawnTwo.snapshot.you.resources.charges, 0);
  assert.equal(dawnTwo.snapshot.you.reports.length, 2);
  assert.equal(dawnTwo.snapshot.members.filter(person => person.alive).length, 6);
  assert.equal(dawnTwo.snapshot.members.find(person => person.id === 'tutorial-citizen-3').alive, false);
  const ended = await lessonUntil(tutorial, 'ending');
  assert.equal(ended.snapshot.outcome.faction, 'town');
  assert.equal(ended.snapshot.replay.players.length, 8);
  assert.deepEqual(ended.snapshot.replay.players.map(person => person.roleId).sort(), ['investigator','doctor','guard','citizen','citizen','citizen','mafia','masker'].sort());
  assert.equal(ended.snapshot.replay.events.some(event => event.type === 'night_action' && event.playerId === 'tutorial-masker'), false);
  const verdictTwo = ended.snapshot.log.filter(event => event.type === 'verdict_closed').at(-1);
  assert.deepEqual([verdictTwo.approvals, verdictTwo.total, verdictTwo.passed], [4, 6, true]);
  const complete = await lessonUntil(tutorial, 'complete');
  assert.equal(complete.status, 'completed'); assert.equal(outbound, 0);
  assert.equal(complete.snapshot.you.resources.charges, 0);
  const restored = createMafiaTutorial({ progress: tutorial.exportProgress() }); t.after(() => restored.dispose());
  assert.deepEqual(lessonComparable(restored.getState()), lessonComparable(complete));
  assert.equal(outbound, 0);
});

test('independent review: every wrong core decision and timeout rewinds all checkpoints and produces the same eventual game', async t => {
  const baseline = createMafiaTutorial(); t.after(() => baseline.dispose());
  const expected = lessonComparable(await lessonUntil(baseline, 'complete'));
  const cases = [
    ['night-1-pick', 'night_action', { targetId: 'tutorial-doctor' }],
    ['night-2-pick', 'night_action', { targetId: 'tutorial-doctor' }],
    ['nomination-1', 'nominate', { targetId: 'tutorial-guard' }],
    ['nomination-2', 'nominate', { targetId: 'tutorial-guard' }],
    ['verdict-1', 'verdict', { approve: false }],
    ['verdict-2', 'verdict', { approve: false }],
    ['night-2-pick', 'timeout', null],
  ];
  for (const [step, type, fields] of cases) {
    const tutorial = createMafiaTutorial(); t.after(() => tutorial.dispose());
    const before = lessonComparable(await lessonUntil(tutorial, step)), progress = tutorial.exportProgress();
    if (type === 'timeout') {
      assert.equal(tutorial.guide('continue'), true);
      for (let index = 0; !tutorial.getState().feedback && index < 40; index++) tutorial.advance(1000);
    } else assert.equal(await tutorial.act(type, fields), true);
    assert.equal(tutorial.getState().feedback.canRetry, true, step);
    assert.equal(tutorial.getState().clock.paused, true);
    if (type === 'verdict') {
      const result = tutorial.getState().snapshot.log.filter(event => event.type === 'verdict_closed').at(-1);
      assert.equal(result.passed, false); assert.equal(result.approvals * 2, result.total);
    }
    assert.equal(tutorial.retryCheckpoint(), true);
    assert.deepEqual(lessonComparable(tutorial.getState()), before, `all public/private/clock state restored at ${step}`);
    assert.deepEqual(tutorial.exportProgress(), progress);
    assert.deepEqual(lessonComparable(await lessonUntil(tutorial, 'complete')), expected);
  }
});

test('independent review: saved decisions are bounded semantic replay, never authority for raw roles, clocks or skipped steps', async t => {
  const tutorial = createMafiaTutorial(); t.after(() => tutorial.dispose());
  await lessonUntil(tutorial, 'night-2-pick');
  const valid = tutorial.exportProgress();
  assert.deepEqual(validateTutorialProgress(valid), valid);
  const bad = [
    { ...valid, room: { phase: 'over' } }, { ...valid, owner: 'victim' }, { ...valid, seed: 99 },
    { ...valid, scenarioVersion: 999 }, { ...valid, rulesetVersion: 999 },
    { ...valid, decisions: [...valid.decisions, valid.decisions[0]] },
    { ...valid, decisions: Array.from({ length: 65 }, () => valid.decisions[0]) },
    { ...valid, decisions: [{ ...valid.decisions[0], elapsedMs: -1 }] },
    { ...valid, decisions: [{ ...valid.decisions[0], elapsedMs: 0.5 }] },
    { ...valid, decisions: [{ ...valid.decisions[0], event: 'encyclopedia-close' }] },
    { ...valid, decisions: [{ ...valid.decisions[0], phase: 'over' }] },
    { ...valid, decisions: [...valid.decisions, { stepId: 'night-2-pick', kind: 'act', elapsedMs: 0, type: 'night_action', fields: { targetId: 'not-a-training-player' } }] },
    { ...valid, decisions: [...valid.decisions, { stepId: 'night-2-pick', kind: 'act', elapsedMs: 0, type: 'night_action', fields: { targetId: 'tutorial-masker', charges: 50 } }] },
  ];
  for (const value of bad) {
    assert.equal(validateTutorialProgress(value), null);
    const restored = createMafiaTutorial({ progress: value });
    assert.equal(restored.getState().coach.stepId, 'welcome');
    assert.ok(['invalid', 'incompatible'].includes(restored.getState().restoreStatus));
    assert.equal(restored.getState().snapshot.you.roleId, null);
    restored.dispose();
  }
  const original = tutorial.getState();
  await assert.rejects(tutorial.act('start', { roles: { 'tutorial-human': 'mafia' } }), { code: 'INVALID' });
  await assert.rejects(tutorial.act('night_action', { targetId: 'tutorial-masker', seed: 12 }), { code: 'INVALID' });
  assert.deepEqual(tutorial.getState(), original);
  tutorial.dispose();
  assert.equal(await tutorial.act('night_action', { targetId: 'tutorial-masker' }), false);
  assert.equal(tutorial.guide('continue'), false);
  assert.equal(tutorial.advance(1000), false);
});

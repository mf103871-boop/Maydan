import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { privateBankManifest } from '../scripts/mafia-preserved-bundle.mjs';
import { STUDIO_ARABIC_SEMANTIC_SHA256, localizePreservedBank, mergePreservedEnglish, verifyStudioPrivateManifest,
  inspectStudioPreservedContent, bundleStudioPreviewWorker, bundleStudioPreservedWorker } from '../scripts/studio-preserved-bundle.mjs';
import { createLocalD1 } from '../server/local-d1.mjs';
import { createRoom, joinRoom, connected, snapshot } from '../server/game-model.mjs';
import { issueSession } from '../server/accounts/session.mjs';
import { releaseErsomhaLease } from '../server/ersomha-history.mjs';
import { MemoryStorage } from '../server/local.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const normalize = value => value.trim().toLowerCase();
const original = { id: 'legacy-1', conceptId: 'concept-1', familyId: 'reviewed-family', category: 'home', difficulty: 'hard', answer: 'synthetic source', aliases: [] };
const translated = { ...original, familyId: 'old-family', category: 'animals', difficulty: 'easy', answer: 'synthetic English', contentLocale: 'en', conceptOrigin: 'legacy-ar' };

test('preserved localization uses reviewed identities, categories and tiers without modifying Arabic or English text', () => {
  const active = [original], before = JSON.stringify(active);
  const result = localizePreservedBank([translated], active, active, {}, {}, {}, normalize);
  assert.equal(JSON.stringify(active), before); assert.equal(result[0].answer, translated.answer);
  for (const key of ['conceptId', 'familyId', 'category', 'difficulty']) assert.equal(result[0][key], original[key]);
  assert.equal(translated.familyId, 'old-family'); assert.ok(Object.isFrozen(result) && Object.isFrozen(result[0]));
});

test('preserved localization cannot reactivate retired Arabic concepts or disguise missing legacy translations as new content', () => {
  assert.equal(localizePreservedBank([translated], [], [original], { [original.id]: { reason: 'fixture' } }, {}, {}, normalize).length, 0);
  assert.equal(localizePreservedBank([translated], [], [original], {}, {}, {}, normalize).length, 0);
  assert.throws(() => localizePreservedBank([translated], [], [], {}, {}, {}, normalize), /STUDIO_LEGACY_ID_UNMAPPED/);
});

test('new English concepts reuse private expansion identities through the explicit crosswalk and collapse duplicate concepts', () => {
  const added = { ...original, id: 'private-expanded', conceptId: 'private-concept' };
  const english = { ...translated, id: 'ers-en-home-1-01', conceptId: 'english-only', conceptOrigin: 'new-en' };
  const duplicate = { ...english, id: 'ers-en-home-1-02' };
  const result = localizePreservedBank([english, duplicate], [added], [added], {}, { home: ['synthetic source|synthetic source'] }, {}, normalize);
  assert.equal(result.length, 1); assert.equal(result[0].conceptId, added.conceptId); assert.equal(result[0].conceptOrigin, 'legacy-ar');
  assert.equal(result[0].familyId, added.familyId);
  const distinct = localizePreservedBank([english], [], [], {}, {}, {}, normalize);
  assert.equal(distinct[0].conceptId, 'english-only'); assert.equal(distinct[0].conceptOrigin, 'new-en');
});

test('preparer rejects unreviewed semantics and browser entry points before reading private sources', async () => {
  await assert.rejects(verifyStudioPrivateManifest({ semanticSHA256: '0'.repeat(64) }), /reviewed live Arabic digest/);
  await assert.rejects(bundleStudioPreservedWorker({}, { entryPoint: 'src/platform/PlatformApp.jsx' }), /server entry points/);
});

test('English supplement completes canonical active identities and merges an equivalent new concept without duplicating history', () => {
  const canonical = { ...original, id: 'private-2', conceptId: 'private-concept-2', familyId: 'private-family-2' };
  const added = { ...canonical, answer: 'synthetic second concept', aliases: ['synthetic second synonym'], contentLocale: 'en', conceptOrigin: 'legacy-ar' };
  const extra = { ...added, id: 'english-extra', conceptId: 'english-extra', familyId: 'english-extra', answer: 'synthetic equivalent', aliases: [], conceptOrigin: 'new-en' };
  const base = [{ ...translated, ...original, answer: 'synthetic English', contentLocale: 'en', conceptOrigin: 'legacy-ar' }, extra];
  const supplement = { schemaVersion: 1, contentLocale: 'en', contentVersion: 'new-en', entries: [added], equivalences: [{ englishId: extra.id, arabicId: canonical.id }] };
  const result = mergePreservedEnglish(base, [original, canonical], supplement);
  assert.equal(result.entries.length, 2); assert.equal(result.coverage.untranslatedActiveArabic, 0);
  assert.equal(result.coverage.equivalentEnglishConceptsMerged, 1); assert.equal(result.coverage.translatedActiveArabic, 2);
  assert.ok(result.entries.find(e => e.id === canonical.id).aliases.includes(extra.answer));
  assert.equal(result.entries.some(e => e.id === extra.id), false);
  assert.equal(base[1].id, extra.id); assert.equal(added.aliases.length, 1);
  for (const patch of [ { entries: [] }, { contentVersion: 'unreviewed' },
    { entries: [{ ...added, familyId: 'wrong-family' }] }, { entries: [{ ...added, id: 'retired-or-missing' }] },
    { entries: [{ ...added, answer: '\u0639\u0631\u0628\u064a' }] }, { entries: [{ ...added, aliases: ['SYNTHETIC SECOND CONCEPT'] }] } ]) {
    assert.throws(() => mergePreservedEnglish(base, [original, canonical], { ...supplement, ...patch }), /STUDIO_SUPPLEMENT_/);
  }
});

// The private source directory is explicitly provided only on the release
// reviewer's machine. CI has no private catalog. No words, source bytes, data:
// module stack traces or full assertion diffs can enter its diagnostic output.
const privateSource = process.env.MAYDAN_STUDIO_PRIVATE_SOURCE;
let privateState;
async function privateFixture() {
  if (!privateState) privateState = (async () => {
    const manifest = await privateBankManifest(privateSource, { semanticSHA256: STUDIO_ARABIC_SEMANTIC_SHA256,
      counts: { version: 2, catalog: 1432, active: 1400, retired: 32 } });
    assert.equal(manifest.sourceManifestSHA256, '40907f315f0ba7aeda0486d8fd4d9243ae0b3d5cd554773d60272490431163f4');
    const englishSupplement = { path: process.env.MAYDAN_STUDIO_ENGLISH_SUPPLEMENT, sha256: process.env.MAYDAN_STUDIO_ENGLISH_SUPPLEMENT_SHA256 };
    const content = await inspectStudioPreservedContent(manifest, { englishSupplement }), bundle = await bundleStudioPreviewWorker(manifest, { englishSupplement });
    const worker = await import(`data:text/javascript;base64,${bundle.bytes.toString('base64')}`);
    return { manifest, content, bundle, worker, englishSupplement };
  })();
  return privateState;
}
function privateTest(name, fn) {
  test(name, { skip: !privateSource, timeout: 60_000 }, async t => {
    try { await fn(await privateFixture(), t); }
    catch (error) { throw new Error(`Private release check failed (${error.code || error.name || 'Error'}); inspect privately without logging source or data URLs.`); }
  });
}

privateTest('actual private build preserves the full live Arabic semantic digest, retirement and current bilingual choice runtime', async ({ manifest, content, bundle }) => {
  assert.equal(hash(JSON.stringify(content.ERSOMHA_BANK)), STUDIO_ARABIC_SEMANTIC_SHA256);
  assert.equal(content.ERSOMHA_BANK.length, 1400); assert.equal(content.ERSOMHA_CATALOG.length, 1432);
  assert.equal(Object.keys(content.ERSOMHA_RETIRED).length, 32); assert.equal(content.ERSOMHA_ENGLISH_BANK.length, bundle.contentCoverage.englishTotal);
  assert.equal(bundle.contentCoverage.translatedActiveArabic, 1400); assert.equal(bundle.contentCoverage.untranslatedActiveArabic, 0);
  assert.equal(bundle.englishSupplement.entries, 222);
  const active = new Map(content.ERSOMHA_BANK.map(e => [e.conceptId, e]));
  let mapped = 0; const acceptedNames = new Map(), collisionPairs = new Set();
  for (const entry of content.ERSOMHA_ENGLISH_BANK) {
    assert.ok(!/[\p{Script=Arabic}]/u.test([entry.answer, ...entry.aliases].join(' ')));
    assert.ok(!Object.hasOwn(content.ERSOMHA_RETIRED, entry.id));
    if (entry.conceptOrigin === 'legacy-ar') {
      const legacy = active.get(entry.conceptId); assert.ok(legacy); mapped++;
      for (const key of ['category', 'difficulty', 'familyId']) assert.equal(entry[key], legacy[key]);
    }
    assert.equal(content.matchesErsomhaAnswer(entry.answer.toUpperCase(), entry, 'en'), true);
    assert.equal(content.matchesErsomhaAnswer(`${entry.answer} unrelated suffix`, entry, 'en'), false);
    for (const name of [entry.answer, ...entry.aliases]) {
      assert.equal(content.matchesErsomhaAnswer(name.toUpperCase(), entry, 'en'), true);
      const key = content.normalizeErsomhaGuess(name, 'en'), previous = acceptedNames.get(key);
      if (previous && previous.conceptId !== entry.conceptId) collisionPairs.add([previous.id, entry.id].sort().join(':'));
      acceptedNames.set(key, entry);
    }
  }
  assert.equal(mapped, 1400);
  // A reviewed pre-existing homonym has distinct animal/device meanings.
  // The supplement must add no other ambiguous accepted-answer collisions.
  assert.equal(collisionPairs.size, 1); assert.ok(collisionPairs.has('ers-animals-017:ers-technology-014'));
  for (const contentLocale of ['ar', 'en']) for (const difficulty of ['easy', 'medium', 'hard']) {
    const choices = content.buildErsomhaChoices({ contentLocale, difficulty, random: () => 0.31 });
    assert.equal(choices.length, 3); assert.equal(new Set(choices.map(c => c.familyId)).size, 3);
    const next = content.buildErsomhaChoices({ contentLocale: contentLocale === 'ar' ? 'en' : 'ar', difficulty,
      excludedConceptIds: choices.map(c => c.conceptId), excludedFamilyIds: choices.map(c => c.familyId), random: () => 0.31 });
    assert.equal(next.length, 3); assert.ok(next.every(c => choices.every(old => old.conceptId !== c.conceptId && old.familyId !== c.familyId)));
  }
  assert.equal(hash(bundle.bytes), bundle.sha256); assert.equal(bundle.remoteWrites, false); assert.equal(bundle.publicUploadAllowed, false);
  assert.equal(bundle.privateBank.sourceManifestSHA256, manifest.sourceManifestSHA256);
  const inputs = bundle.sourceInputs.filter(e => e.file.startsWith('studio-private-arabic:'));
  assert.equal(inputs.length, manifest.modules.length);
  assert.ok(inputs.every(e => manifest.modules.some(m => `studio-private-arabic:${m.file}` === e.file && m.sha256 === e.sha256)));
  // Inspection never rewrites the checked-in localized loader.
  const current = await readFile(new URL('../server/ersomha-content.mjs', import.meta.url));
  assert.equal(bundle.sourceInputs.find(e => e.file === 'server/ersomha-content.mjs').sha256, hash(current));
  assert.equal(bundle.sourceInputs.find(e => e.file === 'studio-private-english:english-supplement.json').sha256, bundle.englishSupplement.sha256);
});

privateTest('private worker cannot be prepared with an omitted or changed English supplement', async ({ manifest, englishSupplement }) => {
  await assert.rejects(bundleStudioPreviewWorker(manifest), /Pin the reviewed private English supplement hash/);
  await assert.rejects(bundleStudioPreviewWorker(manifest, { englishSupplement: { ...englishSupplement, sha256: '0'.repeat(64) } }), /changed after review/);
});

privateTest('actual compiled preview advertises versioned English only while enabled, and keeps five game services', async ({ worker }) => {
  const origin = 'https://maydan-mafia-preview.mf103871.workers.dev';
  for (const enabled of [true, false]) {
    const response = await worker.default.fetch(new Request(`${origin}/api/content/capabilities`, { headers: { Origin: 'maydan://app' } }), { APP_ORIGIN: origin, EXTRA_ORIGINS: 'maydan://app', ENGLISH_CONTENT_ENABLED: enabled ? '1' : '0' }, {});
    assert.equal(response.status, 200); const body = await response.json();
    assert.equal(body.localizedContent, 1); assert.equal(body.contentVersions.ar, 'legacy-ar');
    assert.equal(body.contentVersions.en, enabled ? 'new-en' : undefined);
  }
  const health = await worker.default.fetch(new Request(`${origin}/health`), { APP_ORIGIN: origin }, {});
  assert.equal(health.status, 200); assert.equal((await health.json()).games.length, 5);
});

async function roomFixture(WorkerRoom, DB, contentLocale, key, previousHistory = []) {
  const storage = new MemoryStorage(), now = Date.now(), sessions = [];
  for (let n = 0; n < 2; n++) {
    await DB.prepare('INSERT OR IGNORE INTO users(id,name,created_at,updated_at) VALUES(?,?,?,?)').bind(`fixture-account-${n}`, `Player ${n}`, now, now).run();
    sessions.push(await issueSession({ DB }, `fixture-account-${n}`));
  }
  const people = sessions.map((session, n) => ({ id: `seat-${n}`, tokenHash: `token-${n}`, name: `Player ${n}`, avatar: n,
    game: 'ersomha', settings: { cycles: 1, difficulty: 'easy' }, capabilities: { localizedContent: 1 },
    ...(contentLocale === 'en' ? { contentLocale: 'en', contentVersion: 'new-en' } : {}) }));
  const state = createRoom(key, people[0], now); joinRoom(state, people[1], now);
  state.members.forEach((m, n) => { m.accountUserId = `fixture-account-${n}`; connected(state, m.id, true, now); m.ready = true; });
  await storage.put('room', state);
  const sockets = sessions.map((session, n) => ({ readyState: 1, messages: [], a: { id: people[n].id, accountUserId: `fixture-account-${n}`, accountSessionId: session.id, accountExpiresAt: session.expiresAt, seenAt: now, windowAt: now, count: 1 },
    deserializeAttachment() { return structuredClone(this.a); }, serializeAttachment(value) { this.a = structuredClone(value); },
    send(raw) { if (raw !== 'pong') this.messages.push(JSON.parse(raw)); }, close() { this.readyState = 3; } }));
  const ctx = { storage, blockConcurrencyWhile: fn => fn(), getWebSockets: () => sockets };
  let owner = new WorkerRoom(ctx, { DB }); await owner.ready; let sequence = 0;
  return { storage, sockets, get room() { return owner.room; },
    async restore() { owner = new WorkerRoom(ctx, { DB }); await owner.ready; },
    async command(index, type, fields = {}) {
      const requestId = `request-${++sequence}`;
      await owner.webSocketMessage(sockets[index], JSON.stringify({ type, requestId, matchId: owner.room.matchId, round: owner.room.round, ...fields }));
      return sockets[index].messages.findLast(m => m.type === 'ack' && m.requestId === requestId);
    },
    assertHistoryExclusion() { assert.ok(owner.room.ersomhaPlan.flat().every(card => previousHistory.every(old => old.concept_id !== card.conceptId && old.family_id !== card.familyId))); },
    close() { storage.dispose(); }
  };
}

privateTest('actual compiled Room preserves old Arabic history across English starts, private projections, authorization and reconnect', async ({ worker }) => {
  const DB = createLocalD1(); let oldHistory = [];
  try {
    for (const [index, locale] of ['ar', 'en'].entries()) {
      const f = await roomFixture(worker.Room, DB, locale, `12345${index}`, oldHistory);
      try {
        assert.equal((await f.command(0, 'start')).ok, true); f.assertHistoryExclusion();
        const room = f.room, card = room.draw.choices[0], guest = snapshot(room, 'seat-1');
        assert.equal(room.contentLocale, locale); assert.equal(room.contentVersion, locale === 'ar' ? 'legacy-ar' : 'new-en');
        assert.equal(guest.myChoices.length, 0); assert.equal(guest.myWord, null);
        assert.equal((await f.command(1, 'select_word', { choiceId: card.id })).ok, false);
        assert.equal((await f.command(0, 'content_locale', { contentLocale: locale === 'ar' ? 'en' : 'ar' })).error, 'PHASE');
        assert.equal((await f.command(0, 'select_word', { choiceId: card.id })).ok, true);
        const before = JSON.stringify(f.room.ersomhaPlan); await f.restore();
        assert.ok(JSON.stringify(f.room.ersomhaPlan) === before); assert.equal(f.room.contentLocale, locale);
        assert.equal((await f.command(1, 'guess', { text: locale === 'en' ? card.answer.toUpperCase() : card.answer })).ok, true);
        assert.equal(f.room.phase, 'result');
        assert.equal(snapshot(f.room, 'seat-1').revealedWord, card.answer);
        const history = (await DB.prepare('SELECT concept_id,family_id,exposure_id FROM ersomha_seen ORDER BY exposure_id,concept_id').all()).results;
        assert.ok(history.length > oldHistory.length);
        assert.ok(oldHistory.every(old => history.some(row => row.concept_id === old.concept_id && row.family_id === old.family_id && row.exposure_id === old.exposure_id)));
        oldHistory = history; await releaseErsomhaLease({ DB }, f.room.ersomhaLease);
      } finally { f.close(); }
    }
  } finally { DB.close(); }
});

// Local evidence only: real browser compilation, private-state/report tests and
// Chromium/WebKit microphone UI fixture. This is not an iPhone or real SFU trial.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { esbuildOptions } from './lib.mjs';
import { getBackendProvenance } from './lib/lamma-provenance.mjs';
import { ersomhaReviewReport } from './ersomha-content.mjs';
import { ERSOMHA_BANK } from '../server/ersomha-content.mjs';
import { ERSOMHA_PRIVACY_CHECKS, bundleErsomhaWorker } from './ersomha-release.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const execute = promisify(execFile);
const hash = value => createHash('sha256').update(value).digest('hex');
const E2E = 'tests/e2e/ersomha-online.mjs';
export const ERSOMHA_PRIVACY_SUITES = ['tests/ersomha-content.test.js', 'tests/ersomha-server-model.test.js',
  'tests/ersomha-server-room.test.js', 'tests/ersomha-server-history.test.js', 'tests/ersomha-reports.test.js', 'tests/ersomha-ui.test.js'];
export const ERSOMHA_PRIVACY_UNIT_PROOFS = {
  'independent-1200-concepts': ['all 1200 rows have content-bound independent agent editorial reasons without claiming a player trial',
    'an editorial content edit invalidates the old review fingerprint'],
  'secret-choices-and-answer-not-broadcast': ['only the drawer receives choices/word, never future answers, aliases or account identifiers',
    'drawing evidence is private to frozen viewers, survives the next turn and contains no word or guess history'],
  'report-evidence-authorized-only': ['failed evidence authorization and failed D1 transaction cannot leave a report',
    'authenticated report and moderator evidence remain private and clear on account deletion',
    'private evidence strips answers, accounts, guesses and unknown stroke metadata'],
  'report-retention-and-account-deletion': ['reported drawing retention follows the parent report rather than retaining orphan evidence',
    'a fresh room preserves account history after release, and account deletion removes only its private records',
    'account deletion racing an exposure cannot resurrect history or partially expose the remaining players'],
  'drawing-microphone-privacy': ['only the drawer sees word choices; native mute readiness shields all private content'],
};

export function assertNoPrivateBrowserContent(metafile, bytes, bank = ERSOMHA_BANK) {
  assert.ok(metafile && Object.keys(metafile.inputs || {}).length > 0, 'Browser metafile is missing.');
  const inputs = Object.keys(metafile.inputs).map(name => name.replaceAll('\\', '/'));
  assert.ok(inputs.some(name => name.endsWith('src/main.jsx')), 'Inspect the real application entry point.');
  assert.ok(!inputs.some(name => /(?:^|\/)server\/data\/ersomha(?:[-/]|\.)/.test(name)
    || /(?:^|\/)(?:server|scripts)\/ersomha-content\.mjs$/.test(name)), 'Private Ersomha bank or editorial source reached the browser dependency graph.');
  const text = Buffer.isBuffer(bytes) ? bytes.toString('utf8') : String(bytes);
  assert.ok(text.length > 100, 'Browser bundle is missing.');
  // IDs and author-only visual notes are stronger markers than common Arabic
  // answer words, which can legitimately occur in ordinary interface labels.
  for (const entry of bank) {
    assert.ok(!text.includes(entry.id), 'A private bank concept ID was embedded in the browser bundle.');
    if (entry.visualNote?.length > 15) assert.ok(!text.includes(entry.visualNote), 'An author-only visual clue was embedded in the browser bundle.');
  }
  return { inputCount: inputs.length, bundleSHA256: hash(bytes), bytes: Buffer.byteLength(bytes), scannedConcepts: bank.length,
    privateBankDependencyCount: 0, embeddedConceptIds: 0, embeddedVisualClues: 0 };
}

export function assertPrivacyUnitProof(tap, { exitCode = 0 } = {}) {
  assert.equal(exitCode, 0, 'Selected privacy test process failed.');
  const number = key => Number(tap.match(new RegExp(`^# ${key} (\\d+)$`, 'm'))?.[1]);
  assert.ok(number('tests') > 0 && number('pass') === number('tests'), 'Expected a complete passing test run.');
  for (const key of ['fail', 'cancelled', 'skipped', 'todo']) assert.equal(number(key), 0, `Privacy tests contain ${key}.`);
  const passed = new Set([...tap.matchAll(/^ok \d+ - (.+)$/gm)].map(match => match[1]));
  for (const names of Object.values(ERSOMHA_PRIVACY_UNIT_PROOFS)) for (const name of names) assert.ok(passed.has(name), `Missing executed privacy assertion: ${name}`);
  return { tests: number('tests'), passed: number('pass'), failed: 0, skipped: 0, stdoutSHA256: hash(tap), requiredAssertions: Object.values(ERSOMHA_PRIVACY_UNIT_PROOFS).flat() };
}

export function assertMicrophoneFixture(summary) {
  assert.match(summary.scope || '', /local workerd\/D1/); assert.match(summary.scope, /simulated/);
  assert.deepEqual(summary.engines?.map(item => item.engine).sort(), ['chromium', 'webkit'], 'Both browser engines must execute.');
  for (const engine of summary.engines) {
    for (const key of ['groupLaunch', 'cancelledActiveRoomInvitationAllocatesNoSeat', 'automaticGuestJoin', 'bothDrawingsDelivered',
      'drawerMutedBeforeWord', 'microphoneUnmuteBlockedDuringDrawing', 'microphoneNeverAutoReopened', 'bothCallStatesPreserved']) assert.equal(engine[key], true, `${engine.engine} missing ${key}`);
    assert.equal(engine.completedDrawingTurns, 2); assert.deepEqual(engine.browserErrors, []);
    assert.deepEqual(engine.mediaConnectCount, [1, 1]); assert.deepEqual(engine.mediaDisconnectCount, [0, 0]);
  }
  assert.ok(Array.isArray(summary.providerRequests) && summary.providerRequests.length > 0, 'Expected only authenticated local fixture provider requests.');
  assert.ok(summary.providerRequests.every(request => request.provider === 'fixture.livekit.cloud'), 'The local microphone fixture must never contact a real media provider.');
  return { engines: ['chromium', 'webkit'], completedDrawingTurnsPerEngine: 2, actualLiveKitMedia: false, physicalDeviceTrialCompleted: false,
    drawerMutedBeforeWord: true, manualUnmuteDenied: true, microphoneNeverAutoReopened: true, sameCallPreserved: true };
}

export function assertMicrophoneReceipt(receipt, summaryBytes, provenance, sourceInputs, now = Date.now()) {
  assert.equal(receipt.schemaVersion, 1); assert.equal(receipt.kind, 'ersomha-microphone-fixture-receipt');
  assert.equal(receipt.passed, true); assert.equal(receipt.fixturePath, E2E);
  for (const key of ['sourceCommit', 'sourceServerTree', 'backendTreeSha256']) assert.equal(receipt[key], provenance[key], 'Microphone fixture tested different frozen source.');
  assert.deepEqual(receipt.sourceInputs, sourceInputs, 'Microphone fixture source inputs changed or were not recorded.');
  assert.equal(receipt.summarySHA256, hash(summaryBytes), 'Microphone fixture summary digest differs from its execution receipt.');
  const at = Date.parse(receipt.finishedAt); assert.ok(Number.isFinite(at) && now >= at && now - at < 24 * 60 * 60_000, 'Microphone fixture evidence is expired or future-dated.');
  assert.equal(receipt.command, `node ${E2E}`); assert.equal(receipt.exitCode, 0);
  return assertMicrophoneFixture(JSON.parse(summaryBytes));
}

async function sourceDigests(filenames) {
  return Object.fromEntries(await Promise.all([...new Set(filenames)].sort().map(async filename => {
    const relative = path.relative(ROOT, path.resolve(ROOT, filename)).split(path.sep).join('/');
    assert.ok(!relative.startsWith('../') && !path.isAbsolute(relative), 'Privacy proof source is outside the repository.');
    return [relative, hash(await readFile(path.join(ROOT, relative)))];
  })));
}
async function cleanProofInputs(sourceInputs) {
  // Sending the full dependency graph as arguments can exceed Windows' command
  // line length. NUL-delimited porcelain also handles spaces and renames safely.
  const { stdout } = await execute('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'], { cwd: ROOT, windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
  const records = stdout.split('\0'), dirty = [];
  for (let i = 0; i < records.length; i++) {
    const record = records[i]; if (!record) continue;
    const filename = record.slice(3).replaceAll('\\', '/');
    if (Object.hasOwn(sourceInputs, filename)) dirty.push(filename);
    if (/[RC]/.test(record.slice(0, 2))) { const original = records[++i]; if (Object.hasOwn(sourceInputs, original)) dirty.push(original); }
  }
  assert.equal(dirty.length, 0, 'Commit and freeze privacy proof sources, including tests and UI, before generating acceptance evidence.');
}
async function assertUnchanged(provenance, sourceInputs) {
  assert.deepEqual(await getBackendProvenance(ROOT, { requireClean: true }), provenance, 'Source commit or backend changed during privacy acceptance.');
  assert.deepEqual(await sourceDigests(Object.keys(sourceInputs)), sourceInputs, 'A privacy proof source changed during acceptance.');
  await cleanProofInputs(sourceInputs);
}

export async function runErsomhaContentPrivacy({ outputDirectory = '.cache/ersomha-content-privacy', microphoneReceiptPath = null } = {}) {
  const out = path.resolve(ROOT, outputDirectory); await mkdir(out, { recursive: true });
  const runId = randomUUID(), report = { schemaVersion: 1, kind: 'ersomha-content-privacy', runId, startedAt: new Date().toISOString(),
    passed: false, checks: [], scope: 'Local compilation and automated private-state/D1 tests plus Chromium/WebKit microphone UI fixture; external media is simulated. No remote writes, actual LiveKit media, physical iPhone performance or human player trial is claimed.', physicalDeviceTrialCompleted: false };
  const saveReport = () => writeFile(path.join(out, 'content-privacy-result.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  try {
    Object.assign(report, await getBackendProvenance(ROOT, { requireClean: true }));
    const provenance = { sourceCommit: report.sourceCommit, sourceServerTree: report.sourceServerTree, backendTreeSha256: report.backendTreeSha256 };
    const editorial = ersomhaReviewReport(); report.editorial = editorial;
    assert.equal(editorial.validation.ok, true); assert.equal(editorial.validation.total, 1200); assert.equal(editorial.validation.independentPending, 0, 'All 1200 concepts require current independent editorial review.');
    assert.ok(editorial.entries.every(entry => entry.independent === 'reviewed')); assert.equal(editorial.physicalPlaytest, false);
    const pkg = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8'));
    const browser = await build({ ...esbuildOptions({ minify: true, version: pkg.version }), absWorkingDir: ROOT, metafile: true });
    assert.equal(browser.outputFiles.length, 1);
    report.browser = assertNoPrivateBrowserContent(browser.metafile, Buffer.from(browser.outputFiles[0].contents));
    const metafileBytes = Buffer.from(JSON.stringify(browser.metafile, null, 2));
    report.browser.metafilePath = `browser-metafile-${runId}.json`; report.browser.metafileSHA256 = hash(metafileBytes);
    await writeFile(path.join(out, report.browser.metafilePath), metafileBytes, { flag: 'wx', mode: 0o600 });
    const backend = await bundleErsomhaWorker('maydan-rooms'); report.testedModuleSHA256 = backend.sha256;
    // Metafile closure includes local test helpers. Dynamic UI imports inside the
    // fixture are covered by compiling the complete real application above.
    const proofGraph = await build({ entryPoints: [...ERSOMHA_PRIVACY_SUITES, E2E, 'scripts/ersomha-content-privacy.mjs'], absWorkingDir: ROOT, outdir: '.cache/ersomha-proof-unused',
      bundle: true, write: false, metafile: true, platform: 'node', format: 'esm', packages: 'external', external: ['cloudflare:*'],
      jsx: 'automatic', loader: { '.css': 'text', '.webp': 'dataurl', '.png': 'dataurl', '.woff2': 'dataurl' }, logLevel: 'silent' });
    const sourceInputs = await sourceDigests([...Object.keys(browser.metafile.inputs), ...Object.keys(backend.sourceInputs), ...Object.keys(proofGraph.metafile.inputs),
      'scripts/ersomha-content-privacy.mjs', 'scripts/lib.mjs', 'scripts/lib/lamma-provenance.mjs', 'package.json', 'package-lock.json']);
    report.sourceInputs = sourceInputs; await cleanProofInputs(sourceInputs);
    const unit = await execute(process.execPath, ['--test', '--test-concurrency=2', '--test-reporter=tap', ...ERSOMHA_PRIVACY_SUITES],
      { cwd: ROOT, windowsHide: true, timeout: 240_000, maxBuffer: 16 * 1024 * 1024 });
    report.unit = assertPrivacyUnitProof(unit.stdout);
    const unitFile = `privacy-unit-${runId}.tap`; await writeFile(path.join(out, unitFile), unit.stdout, { mode: 0o600, flag: 'wx' });
    report.unit.outputPath = unitFile;
    let summaryBytes, receipt;
    if (microphoneReceiptPath) {
      const receiptFile = path.resolve(ROOT, microphoneReceiptPath); receipt = JSON.parse(await readFile(receiptFile, 'utf8'));
      assert.ok(typeof receipt.summaryPath === 'string' && receipt.summaryPath, 'Microphone receipt must locate its hashed summary.');
      summaryBytes = await readFile(path.resolve(path.dirname(receiptFile), receipt.summaryPath));
      assert.ok(typeof receipt.stdoutPath === 'string' && receipt.stdoutPath, 'Microphone receipt must locate its hashed process output.');
      const stdout = await readFile(path.resolve(path.dirname(receiptFile), receipt.stdoutPath));
      assert.equal(hash(stdout), receipt.stdoutSHA256, 'Microphone process output digest differs from its execution receipt.');
      assert.deepEqual(JSON.parse(stdout), JSON.parse(summaryBytes), 'Microphone process output and saved summary disagree.');
      report.microphone = assertMicrophoneReceipt(receipt, summaryBytes, provenance, sourceInputs);
      report.microphone.receiptSHA256 = hash(await readFile(receiptFile)); report.microphone.reusedVerifiedReceipt = true;
    } else {
      const fixtureDir = path.join(out, `microphone-${runId}`); await mkdir(fixtureDir, { recursive: true });
      const trial = await execute(process.execPath, [E2E], { cwd: ROOT, windowsHide: true, timeout: 300_000, maxBuffer: 8 * 1024 * 1024,
        env: { ...process.env, E2E_OUTPUT_DIR: fixtureDir } });
      summaryBytes = await readFile(path.join(fixtureDir, 'summary.json'));
      report.microphone = assertMicrophoneFixture(JSON.parse(summaryBytes)); await assertUnchanged(provenance, sourceInputs);
      receipt = { schemaVersion: 1, kind: 'ersomha-microphone-fixture-receipt', passed: true, ...provenance, sourceInputs, fixturePath: E2E,
        command: `node ${E2E}`, exitCode: 0, stdoutPath: 'execution.stdout.json', stdoutSHA256: hash(trial.stdout), summaryPath: 'summary.json', summarySHA256: hash(summaryBytes), finishedAt: new Date().toISOString() };
      assert.deepEqual(JSON.parse(trial.stdout), JSON.parse(summaryBytes), 'Microphone fixture output and summary disagree.');
      await writeFile(path.join(fixtureDir, receipt.stdoutPath), trial.stdout, { mode: 0o600, flag: 'wx' });
      await writeFile(path.join(fixtureDir, 'execution-receipt.json'), JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
      report.microphone.receiptSHA256 = hash(await readFile(path.join(fixtureDir, 'execution-receipt.json'))); report.microphone.receiptPath = path.relative(out, path.join(fixtureDir, 'execution-receipt.json')).split(path.sep).join('/');
    }
    report.microphone.summarySHA256 = hash(summaryBytes);
    await assertUnchanged(provenance, sourceInputs);
    report.checks = ERSOMHA_PRIVACY_CHECKS.map(name => ({ name, passed: true,
      evidence: name === 'private-bank-not-in-browser-bundle' ? { browserBundleSHA256: report.browser.bundleSHA256, inputCount: report.browser.inputCount }
        : name === 'drawing-microphone-privacy' ? { assertions: ERSOMHA_PRIVACY_UNIT_PROOFS[name], microphoneReceiptSHA256: report.microphone.receiptSHA256 }
          : { assertions: ERSOMHA_PRIVACY_UNIT_PROOFS[name], unitOutputSHA256: report.unit.stdoutSHA256 } }));
    report.passed = true;
  } catch (error) {
    report.error = error instanceof assert.AssertionError ? error.message.split('\n')[0] : 'Local privacy acceptance failed; inspect the selected test or fixture locally. External data and process output suppressed.';
    throw error;
  } finally { report.finishedAt = new Date().toISOString(); await saveReport(); }
  return { reportPath: path.join(out, 'content-privacy-result.json'), sha256: hash(await readFile(path.join(out, 'content-privacy-result.json'))),
    passed: true, sourceCommit: report.sourceCommit, backendTreeSha256: report.backendTreeSha256, checks: report.checks.length,
    tests: report.unit.tests, actualLiveKitMedia: false, physicalDeviceTrialCompleted: false };
}

async function main() {
  const args = process.argv.slice(2), index = args.indexOf('--e2e-evidence');
  if (index >= 0) assert.ok(args[index + 1], '--e2e-evidence requires an execution receipt with source and summary digests.');
  assert.ok(args.filter(arg => arg.startsWith('--')).every(arg => arg === '--e2e-evidence'), 'Unknown content/privacy option.');
  const outputDirectory = args[0] && !args[0].startsWith('--') ? args[0] : undefined;
  console.log(JSON.stringify(await runErsomhaContentPrivacy({ outputDirectory, microphoneReceiptPath: index >= 0 ? args[index + 1] : null }), null, 2));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => {
  console.error(JSON.stringify({ failed: true, message: error instanceof assert.AssertionError ? error.message.split('\n')[0] : 'Content/privacy acceptance failed; no remote writes were performed.' })); process.exitCode = 1;
});

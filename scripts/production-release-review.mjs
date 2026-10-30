// Read-only review. It intentionally has no upload/apply command. Reuses the
// private-bank, runtime-inheritance and public-activation guards already reviewed.
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { assertMafiaReleasePreservation } from './mafia-release-guard.mjs';
import { preservedMafiaUploadMetadata } from './mafia-preserved-bundle.mjs';
import { assertLease, loadPrivate } from './lamma-release.mjs';
import { settingsDigest } from './cloudflare-settings-plan.mjs';
import { getBackendProvenance } from './lib/lamma-provenance.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const WORKERS = ['maydan-game', 'maydan-rooms'];
export function reviewProductionPair(envelope, provenance, now = Date.now()) {
  assert.equal(envelope?.schemaVersion, 1); assert.equal(envelope.kind, 'production-paired-review');
  const recheckAge = now - Date.parse(envelope.recheckedAt);
  assert.ok(Number.isFinite(recheckAge) && recheckAge >= 0 && recheckAge <= 60_000, 'Immediate live recheck evidence is required.');
  assert.equal(provenance.clean, true, 'A committed, completely clean checkout is required.');
  assert.match(provenance.backendTreeSha256 || '', /^[a-f0-9]{64}$/);
  assert.equal(envelope.evidence.sourceCommit, provenance.sourceCommit, 'Reviewed source changed.');
  assert.equal(envelope.evidence.backendTreeSha256, provenance.backendTreeSha256, 'Backend dependencies changed.');
  const { draft, snapshots, currentSnapshots } = envelope;
  assert.equal(draft?.kind, 'mafia-paired-preservation-draft');
  assert.equal(draft.sourceCommit, provenance.sourceCommit);
  assert.equal(draft.readyToApply, false); assert.equal(draft.remoteWrites, false);
  for (const collection of [draft.workers, snapshots, currentSnapshots]) assert.deepEqual(Object.keys(collection).sort(), WORKERS);
  for (const name of WORKERS) {
    const baseline = snapshots[name], current = currentSnapshots[name], candidate = draft.workers[name];
    assert.equal(current.versionId, current.latestVersionId, 'Latest uploaded version must be the fully active version.');
    assertLease(baseline, current);
    assert.equal(candidate.beforeVersion, baseline.versionId);
    assert.deepEqual(candidate.upload, preservedMafiaUploadMetadata(name, current), 'Inherited live settings or assets changed.');
    assert.deepEqual(envelope.before.workers[name].settings, baseline.settings);
    assert.equal(envelope.before.workers[name].versionId, baseline.versionId);
    assert.equal(candidate.reviewedModuleSHA256, envelope.after.workers[name].moduleSHA256);
  }
  const checked = assertMafiaReleasePreservation(envelope.before, envelope.after, envelope.evidence, now);
  return { ...checked, reviewPassed: true, applyAvailable: false, readyToApply: false, remoteWrites: false,
    nextStep: 'Review a new source-pinned, single-dispatch private paired operator; this review never deploys.' };
}

async function main() {
  const [command, directory, expectedSHA256, ...extra] = process.argv.slice(2);
  assert.equal(command, '--review'); assert.equal(extra.length, 0);
  assert.match(expectedSHA256 || '', /^[a-f0-9]{64}$/);
  const dir = path.resolve(directory || ''), relative = path.relative(ROOT, dir);
  assert.ok(relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative), 'Keep sealed release evidence outside the repository.');
  const envelope = await loadPrivate(dir, 'paired-release-review');
  assert.equal(settingsDigest(envelope), expectedSHA256, 'The reviewed encrypted document changed.');
  const execute = promisify(execFile);
  const status = (await execute('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: ROOT, windowsHide: true })).stdout.trim();
  assert.equal(status, '', 'Commit and freeze all reviewed source before production review.');
  const provenance = { ...await getBackendProvenance(ROOT, { requireClean: true }), clean: true };
  console.log(JSON.stringify(reviewProductionPair(envelope, provenance)));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(() => {
  console.error('Production review rejected. Reconcile the sealed evidence, clean source and live leases; no deployment was attempted.'); process.exitCode = 1;
});

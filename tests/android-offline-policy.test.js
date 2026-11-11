import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

test('the actual offline Android preparer rejects both account-ticket policies before writing assets', () => {
  for (const policy of ['trial-ticket-v1', 'game-entry-ticket-v2']) {
    const result = spawnSync(process.execPath, ['scripts/android/prepare-offline.mjs', path.resolve('android/app/build/generated/maydan')], {
      cwd: process.cwd(), encoding: 'utf8', timeout: 20000,
      env: { ...process.env, MAYDAN_PRIVATE_AUDIO_PREVIEW: '0', MAYDAN_WARMTH_PREVIEW: '0', MAYDAN_GAMEPLAY_ACCESS_POLICY: policy },
    });
    assert.equal(result.error, undefined);
    assert.notEqual(result.status, 0, policy);
    assert.match(result.stderr, /offline Android proof cannot enable account-bound tickets/, policy);
  }
});

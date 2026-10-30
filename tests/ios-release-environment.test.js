import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { DEFAULT_API_ORIGIN, nativeConfig } from '../scripts/ios/native.mjs';
import { MAFIA_PREVIEW_API_ORIGIN, resolveNativeBuildOrigin, validateNativeReleaseConfig } from '../scripts/ios/release-environment.mjs';

test('native builds default to production and only the explicit Mafia choice selects the isolated API', () => {
  assert.equal(resolveNativeBuildOrigin({}), DEFAULT_API_ORIGIN);
  assert.equal(resolveNativeBuildOrigin({ IOS_RELEASE_ENVIRONMENT: 'production' }), DEFAULT_API_ORIGIN);
  assert.equal(resolveNativeBuildOrigin({ IOS_RELEASE_ENVIRONMENT: 'mafia-preview' }), MAFIA_PREVIEW_API_ORIGIN);
  assert.equal(MAFIA_PREVIEW_API_ORIGIN, 'https://maydan-mafia-preview.mf103871.workers.dev');
  for (const environment of ['', 'preview', 'staging', 'production\nOVERRIDE=1']) assert.throws(() => resolveNativeBuildOrigin({ IOS_RELEASE_ENVIRONMENT: environment }));
});

test('a production or preview build cannot silently point at the other API or a caller host', () => {
  for (const environment of ['production', 'mafia-preview']) {
    const expected = resolveNativeBuildOrigin({ IOS_RELEASE_ENVIRONMENT: environment });
    assert.equal(resolveNativeBuildOrigin({ IOS_RELEASE_ENVIRONMENT: environment, MAYDAN_ROOMS_URL: expected }), expected);
    for (const origin of ['http://localhost:8787', 'https://unapproved.test', `${expected}/api`, `${expected}?x=1`, `${expected}\nNEXT=1`, environment === 'production' ? MAFIA_PREVIEW_API_ORIGIN : DEFAULT_API_ORIGIN]) {
      assert.throws(() => resolveNativeBuildOrigin({ IOS_RELEASE_ENVIRONMENT: environment, MAYDAN_ROOMS_URL: origin }), /approved release environment/);
    }
    const config = nativeConfig({ apiOrigin: expected });
    assert.equal(validateNativeReleaseConfig(config, { IOS_RELEASE_ENVIRONMENT: environment }), expected);
    assert.throws(() => validateNativeReleaseConfig({ ...config, apiOrigin: 'https://unapproved.test' }, { IOS_RELEASE_ENVIRONMENT: environment }));
    assert.throws(() => validateNativeReleaseConfig({ ...config, authCallback: 'other://auth' }, { IOS_RELEASE_ENVIRONMENT: environment }));
  }
});

test('workflow env output changes only preview and archived native config is verified by the actual CLI', () => {
  mkdirSync('.cache', { recursive: true });
  const folder = mkdtempSync(path.resolve('.cache/ios-release-env-'));
  try {
    const envfile = path.join(folder, 'github-env'), summary = path.join(folder, 'summary'), native = path.join(folder, 'native-config.json');
    for (const environment of ['production', 'mafia-preview']) {
      writeFileSync(envfile, 'EXISTING=keep\n'); writeFileSync(summary, '');
      const env = { ...process.env, IOS_RELEASE_ENVIRONMENT: environment, MAYDAN_ROOMS_URL: '', GITHUB_ENV: envfile, GITHUB_STEP_SUMMARY: summary };
      const output = spawnSync(process.execPath, ['scripts/ios/release-environment.mjs', '--github-env'], { env, encoding: 'utf8' });
      assert.equal(output.status, 0, output.stderr);
      assert.equal(readFileSync(envfile, 'utf8'), `EXISTING=keep\n${environment === 'mafia-preview' ? `MAYDAN_ROOMS_URL=${MAFIA_PREVIEW_API_ORIGIN}\n` : ''}`);
      writeFileSync(native, JSON.stringify(nativeConfig({ apiOrigin: resolveNativeBuildOrigin(env) })));
      assert.equal(spawnSync(process.execPath, ['scripts/ios/release-environment.mjs', '--verify-native', native], { env, encoding: 'utf8' }).status, 0);
      writeFileSync(native, JSON.stringify(nativeConfig({ apiOrigin: 'https://unapproved.test' })));
      assert.notEqual(spawnSync(process.execPath, ['scripts/ios/release-environment.mjs', '--verify-native', native], { env, encoding: 'utf8' }).status, 0);
    }
  } finally { assert.ok(folder.startsWith(path.resolve('.cache') + path.sep)); rmSync(folder, { recursive: true, force: true }); }
});

test('prepare rejects an unapproved release destination before any resource build begins', () => {
  const result = spawnSync(process.execPath, ['scripts/ios/prepare.mjs'], { env: { ...process.env, IOS_RELEASE_ENVIRONMENT: 'production', MAYDAN_ROOMS_URL: MAFIA_PREVIEW_API_ORIGIN }, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /differs from the approved release environment/);
  assert.doesNotMatch(result.stdout, /built |iOS resources ready/);
});

test('TestFlight choice preserves signing, simulator, audio, storage, archive and optional upload gates', () => {
  const workflow = readFileSync('.github/workflows/ios-testflight.yml', 'utf8');
  assert.match(workflow, /environment:[\s\S]*?type: choice[\s\S]*?default: production[\s\S]*?- production\s+- mafia-preview/);
  assert.match(workflow, /IOS_RELEASE_ENVIRONMENT: \$\{\{ inputs.environment \|\| 'production' \}\}/);
  for (const gate of ['signing.py preflight', 'npm test', 'verify_audio_policy.py', 'verify_storage_migration.py', "unittest discover -s scripts/ios -p 'test_*.py'", 'smoke_release.py', 'verify_runtime_dependencies.py', 'signing.py profile', 'codesign --verify --deep --strict', 'signing.py archive', 'MAYDAN_PROVISIONING_PROFILE_SPECIFIER=$IOS_PROFILE_UUID', 'if: ${{ inputs.upload_to_testflight }}']) assert.ok(workflow.includes(gate), `Lost release gate: ${gate}`);
  assert.match(workflow, /--verify-native ios\/Maydan\/www\/native-config.json/);
  assert.match(workflow, /--verify-native ios\/build\/Maydan.xcarchive\/Products\/Applications\/Maydan.app\/www\/native-config.json/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /default: false/);
});

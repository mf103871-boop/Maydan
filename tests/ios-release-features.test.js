import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { resolveReleaseFeatures, expectedFeatureDefines, assertFeatureDefines, checkServerReadiness, warmthActiveIntro, writePreparedFeatures } from '../scripts/ios/release-features.mjs';
import { readWarmthManifest } from '../scripts/audio/warmth-preview.mjs';
import { SAMPLE_BANK } from '../src/shared/fx/sample-bank.js';
import { MUSIC_BANK } from '../src/shared/fx/music-bank.js';
import { SELECTED_AUDIO } from '../src/shared/fx/selected-audio.js';
import { nativeConfig } from '../scripts/ios/native.mjs';

const policy = 'trial-ticket-v1';
const complete = { IOS_RELEASE_ENVIRONMENT: 'mafia-preview', IOS_RELEASE_PROFILE: 'complete-preview',
  MAYDAN_GAMEPLAY_ACCESS_POLICY: policy, MAYDAN_PRIVATE_AUDIO_PREVIEW: '1', MAYDAN_WARMTH_PREVIEW: '1',
  IOS_REWARDED_MODE: 'testflight-owned', IOS_ADMOB_APP_ID: 'ca-app-pub-1234567890123456~1234567890',
  IOS_ADMOB_REWARDED_UNIT_ID: 'ca-app-pub-1234567890123456/1234567890', IOS_ADMOB_TEST_VERSION: '1.9', IOS_VERSION: '1.9' };

test('compatibility keeps free/ads-off defaults while a complete preview fails before packaging if any required feature is omitted', () => {
  const standard = resolveReleaseFeatures();
  assert.equal(standard.gameplayPolicy, null);
  assert.equal(standard.rewarded, null);
  assert.equal(standard.warmth, false);
  assert.equal(resolveReleaseFeatures(complete).gameplayPolicy, policy);
  for (const changed of [{ MAYDAN_GAMEPLAY_ACCESS_POLICY: 'free' }, { IOS_REWARDED_MODE: 'off', IOS_ADMOB_APP_ID: '', IOS_ADMOB_REWARDED_UNIT_ID: '', IOS_ADMOB_TEST_VERSION: '' },
    { MAYDAN_WARMTH_PREVIEW: '0' }, { MAYDAN_PRIVATE_AUDIO_PREVIEW: '0' }, { IOS_RELEASE_ENVIRONMENT: 'production' }, { IOS_ADMOB_TEST_VERSION: '' }]) {
    assert.throws(() => resolveReleaseFeatures({ ...complete, ...changed }));
  }
  assert.throws(() => resolveReleaseFeatures({ MAYDAN_GAMEPLAY_ACCESS_POLICY: policy }), /requires.*Rewarded/);
  assert.throws(() => resolveReleaseFeatures({ MAYDAN_GAMEPLAY_ACCESS_POLICY: 'trial-ticket-v2' }), /Unknown gameplay/);
  assert.throws(() => resolveReleaseFeatures({ IOS_RELEASE_PROFILE: 'complete' }), /Unknown.*profile/);
  assert.throws(() => resolveReleaseFeatures({ ...complete, MAYDAN_ROOMS_URL: 'https://unapproved.example' }), /approved release/);
});

test('receipt construction rejects a compiler definition that silently disables the selected gate or audio', () => {
  const features = resolveReleaseFeatures(complete), defines = expectedFeatureDefines(features);
  assert.deepEqual(assertFeatureDefines(features, defines), defines);
  for (const name of ['__MAYDAN_GAMEPLAY_POLICY__', '__MAYDAN_REWARDED_PREVIEW__', '__MAYDAN_AUDIO_PREVIEW__', '__MAYDAN_WARMTH_PREVIEW__', '__MAYDAN_ROOMS_URL__']) {
    assert.throws(() => assertFeatureDefines(features, { ...defines, [name]: 'null' }), /definition differs/);
  }
});

test('complete preview preserves the explicit before-mode policy instead of compiling it as free or v1', () => {
  const entryPolicy = 'game-entry-ticket-v2';
  const features = resolveReleaseFeatures({ ...complete, MAYDAN_GAMEPLAY_ACCESS_POLICY: entryPolicy });
  assert.equal(features.gameplayPolicy, entryPolicy);
  const defines = expectedFeatureDefines(features);
  assert.equal(defines.__MAYDAN_GAMEPLAY_POLICY__, JSON.stringify(entryPolicy));
  assert.deepEqual(assertFeatureDefines(features, defines), defines);
  assert.throws(() => assertFeatureDefines(features, { ...defines, __MAYDAN_GAMEPLAY_POLICY__: JSON.stringify(policy) }), /definition differs/);
});

test('Warmth evidence records its real 78.9-second introduction and rejects a missing compiled reference or incomplete inventory', async () => {
  const manifest = await readWarmthManifest();
  const html = manifest.files.map(entry => path.posix.basename(entry.url)).join('\n');
  const intro = warmthActiveIntro(manifest, html);
  assert.equal(intro.id, 'music-bossa');
  assert.equal(intro.url, 'audio-warmth-preview/audio/music-bossa-8173a990b555.m4a');
  assert.equal(intro.sha256, '8173a990b5557975449a9ad87c4a142c54ab70f3c800c8c7d894e8c0132bcbd5');
  assert.ok(intro.seconds > 78.9 && intro.seconds < 79);
  assert.throws(() => warmthActiveIntro(manifest, html.replace(path.posix.basename(manifest.files[0].url), '')), /does not reference/);
  assert.throws(() => warmthActiveIntro({ ...manifest, files: manifest.files.slice(1) }, html), /exactly fourteen/);
  assert.throws(() => warmthActiveIntro({ ...manifest, runtimePackSHA256: '0'.repeat(64) }, html), /fingerprint/);
});

test('complete preview public preflight rejects old or disabled services and never treats public reads as migration or SSV proof', async () => {
  const features = resolveReleaseFeatures(complete);
  const responses = {
    '/health': { ok: true, protocol: 1, accounts: true, games: ['meenfina', 'fabraka', 'badeeha', 'ersomha', 'mafia'] },
    '/api/mafia/capabilities': { enabled: true, capabilities: { mafia: 2 } },
    '/api/cosmetics/catalog': { version: 3, items: [{ id: 'plus.signature.frame', kind: 'frame', motionKind: 'living-frame', frameTheme: 'signature' }] },
    '/api/billing/config': { gameplay: { policy, access: 'trial-ticket' } },
  };
  const requests = [];
  const read = async (url, options) => {
    const target = new URL(url);
    requests.push({ url, ...options });
    return Response.json(responses[target.pathname]);
  };
  const ready = await checkServerReadiness(features, { fetchImpl: read });
  assert.equal(ready.passed, true);
  assert.equal(requests.length, 4);
  assert.ok(requests.every(request => request.method === 'GET' && request.redirect === 'error' &&
    new URL(request.url).origin === features.apiOrigin && !request.headers.Authorization));
  assert.match(ready.limits.join(' '), /do not prove D1 migration 0030, real Google SSV/);
  for (const endpoint of Object.keys(responses)) {
    const result = await checkServerReadiness(features, { fetchImpl: async (url, options) =>
      new URL(url).pathname === endpoint ? Response.json({ error: 'NOT_FOUND' }, { status: 404 }) : read(url, options) });
    assert.equal(result.passed, false, endpoint);
  }
  for (const [endpoint, replacement] of [
    ['/health', { ...responses['/health'], games: ['meenfina'] }],
    ['/api/mafia/capabilities', { enabled: false, capabilities: { mafia: 2 } }],
    ['/api/mafia/capabilities', { enabled: true, capabilities: { mafia: 1 } }],
    ['/api/cosmetics/catalog', { version: 3, items: [] }],
    ['/api/billing/config', { gameplay: { access: 'free' } }],
  ]) {
    const result = await checkServerReadiness(features, { fetchImpl: async (url, options) =>
      new URL(url).pathname === endpoint ? Response.json(replacement) : read(url, options) });
    assert.equal(result.passed, false, endpoint);
  }
  await assert.rejects(checkServerReadiness({ ...features, apiOrigin: 'https://wrong.example' }, { fetchImpl: read }), /approved release/);
});

test('v2 server readiness rejects a v1 server or incomplete before-mode coverage even if other features are healthy', async () => {
  const features = resolveReleaseFeatures({ ...complete, MAYDAN_GAMEPLAY_ACCESS_POLICY: 'game-entry-ticket-v2' });
  const gameplay = { policy: features.gameplayPolicy, access: 'trial-ticket', entryGate: 'before-mode',
    ticketScope: 'game', gameplayCapability: 2, freePacks: [] };
  const data = {
    '/health': { ok: true, protocol: 1, accounts: true, games: ['meenfina', 'fabraka', 'badeeha', 'ersomha', 'mafia'] },
    '/api/mafia/capabilities': { enabled: true, capabilities: { mafia: 2 } },
    '/api/cosmetics/catalog': { version: 3, items: [{ id: 'plus.signature.frame', kind: 'frame', motionKind: 'living-frame', frameTheme: 'signature' }] },
    '/api/billing/config': { gameplay },
  };
  const run = replacement => checkServerReadiness(features, { fetchImpl: async url =>
    Response.json(new URL(url).pathname === '/api/billing/config' ? { gameplay: replacement } : data[new URL(url).pathname]) });
  assert.equal((await run(gameplay)).passed, true);
  for (const change of [{ policy }, { entryGate: undefined }, { ticketScope: 'mode' }, { gameplayCapability: 1 }, { freePacks: ['general'] }])
    assert.equal((await run({ ...gameplay, ...change })).passed, false);
});

test('prepared evidence pins actual HTML, native API and every selected audio byte; changed resources or unexpected SDK fail', async t => {
  await mkdir('.cache', { recursive: true });
  const root = await mkdtemp(path.resolve('.cache/ios-features-'));
  t.after(() => { assert.equal(path.dirname(root), path.resolve('.cache')); return rm(root, { recursive: true, force: true }); });
  const projectDir = path.join(root, 'project'), destination = path.join(projectDir, 'Maydan/www');
  const pbx = 'Maydan.xcodeproj/project.pbxproj', pins = 'Maydan.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved';
  await mkdir(destination, { recursive: true });
  for (const file of [pbx, pins]) {
    await mkdir(path.dirname(path.join(projectDir, file)), { recursive: true });
    await cp(path.join('ios', file), path.join(projectDir, file));
  }
  const env = { IOS_VERSION: '1.9', IOS_BUILD: '57', GITHUB_SHA: 'a'.repeat(40) };
  const features = resolveReleaseFeatures(env), defines = expectedFeatureDefines(features);
  const native = nativeConfig({ apiOrigin: features.apiOrigin });
  await writeFile(path.join(destination, 'native-config.json'), JSON.stringify(native));
  await writeFile(path.join(destination, 'index.html'), '<!doctype html><title>Prepared fixture</title>');
  for (const entry of [...Object.values(SAMPLE_BANK), ...Object.values(MUSIC_BANK), SELECTED_AUDIO.music, ...SELECTED_AUDIO.voices]) {
    await mkdir(path.dirname(path.join(destination, entry.url)), { recursive: true });
    await cp(path.join('public', entry.url), path.join(destination, entry.url));
  }
  const options = { projectDir, destination, build: { version: '1.9' }, defines, env, root };
  const result = await writePreparedFeatures(options);
  assert.equal(result.receipt.audio.activeHome, SELECTED_AUDIO.music.id);
  assert.equal(result.receipt.audio.activeIntro.seconds, 480);
  assert.equal(result.receipt.audio.warmthPreview, false);
  assert.equal(result.receipt.rewarded.sdkProjectConfigured, false);
  assert.equal(result.receipt.sourceCommit, env.GITHUB_SHA);
  const bundled = await readFile(path.join(destination, 'release-features.json'));
  assert.equal(createHash('sha256').update(bundled).digest('hex'), result.sha256);
  assert.equal((await readFile(result.evidence)).equals(bundled), true);
  await writeFile(path.join(destination, SELECTED_AUDIO.music.url), 'different audio');
  await assert.rejects(writePreparedFeatures(options), /audio size differs/);
  await cp(path.join('public', SELECTED_AUDIO.music.url), path.join(destination, SELECTED_AUDIO.music.url));
  await writeFile(path.join(destination, 'native-config.json'), JSON.stringify({ ...native, apiOrigin: 'https://wrong.example' }));
  await assert.rejects(writePreparedFeatures(options), /API origin differs/);
  await writeFile(path.join(destination, 'native-config.json'), JSON.stringify(native));
  await writeFile(path.join(projectDir, pbx), 'MAYDAN_REWARDED_ADS');
  await assert.rejects(writePreparedFeatures(options), /native advertising compilation differs/);
});

test('workflow wires explicit policy/profile, keeps at most 25 dispatch inputs and verifies prepared, simulator, archive and IPA evidence', async () => {
  const workflow = await readFile('.github/workflows/ios-testflight.yml', 'utf8');
  const inputs = workflow.slice(workflow.indexOf('    inputs:'), workflow.indexOf('\npermissions:'));
  assert.equal([...inputs.matchAll(/^      [a-z_]+:$/gm)].length, 12);
  assert.match(workflow, /MAYDAN_GAMEPLAY_ACCESS_POLICY: \$\{\{ inputs.gameplay_policy \|\| 'free' \}\}/);
  assert.match(workflow, /IOS_RELEASE_PROFILE: \$\{\{ inputs.release_profile \|\| 'compatibility' \}\}/);
  assert.ok(workflow.indexOf('release-features.mjs --preflight') < workflow.indexOf('Materialize authenticated'));
  assert.equal([...workflow.matchAll(/python3 scripts\/ios\/verify_release_features.py/g)].length, 4);
  assert.ok(workflow.indexOf('Maydan-features-') < workflow.indexOf('Archive the signed'));
  assert.ok(workflow.indexOf('verify_release_features.py "$ipa"') < workflow.indexOf('Upload to App Store Connect'));
  assert.ok(workflow.indexOf('release-features.mjs --server-readiness') < workflow.indexOf("'AuthKey.p8'"));
  assert.match(workflow, /timeout-minutes: 60/);
  assert.match(workflow, /^          - game-entry-ticket-v2$/m);
});

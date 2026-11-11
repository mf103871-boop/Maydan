// Build evidence describes the prepared client. Server deployment and device
// acceptance need their own evidence; neither is inferred from this receipt.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolveNativeBuildOrigin } from './release-environment.mjs';
import { resolveRewardedBuild } from './rewarded-config.mjs';
import { privateAudioBuild, readManifest } from '../audio/private-preview.mjs';
import { warmthAudioBuild, readWarmthManifest, RUNTIME_PACK_SHA256 } from '../audio/warmth-preview.mjs';
import { TICKET_POLICY, ENTRY_TICKET_POLICY, GAMEPLAY_OFFERS, ticketPolicyEnabled } from '../../src/shared/account/gameplay-policy.mjs';
import { SAMPLE_BANK } from '../../src/shared/fx/sample-bank.js';
import { MUSIC_BANK } from '../../src/shared/fx/music-bank.js';
import { SELECTED_AUDIO } from '../../src/shared/fx/selected-audio.js';
import { ONLINE_GAMES, ROOM_CAPABILITIES } from '../../src/online/shared.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

export function resolveReleaseFeatures(env = {}) {
  const apiOrigin = resolveNativeBuildOrigin(env);
  const configured = { ...env, MAYDAN_ROOMS_URL: apiOrigin };
  const profile = env.IOS_RELEASE_PROFILE || 'compatibility';
  assert.ok(['compatibility', 'complete-preview'].includes(profile), 'Unknown iOS release profile.');
  const policy = env.MAYDAN_GAMEPLAY_ACCESS_POLICY || 'free';
  assert.ok(['free', TICKET_POLICY, ENTRY_TICKET_POLICY].includes(policy), 'Unknown gameplay access policy.');
  const rewarded = resolveRewardedBuild(configured);
  assert.ok(policy === 'free' || rewarded, 'The ticket policy requires an explicitly configured Rewarded build.');
  const privateAudio = privateAudioBuild(configured);
  const warmth = warmthAudioBuild(configured);
  if (profile === 'complete-preview') {
    assert.ok(env.IOS_RELEASE_ENVIRONMENT === 'mafia-preview' && privateAudio && warmth &&
      ticketPolicyEnabled(policy) && rewarded?.mode === 'testflight-owned',
    'Complete preview requires the isolated API, private Warmth audio, ticket policy and owned TestFlight ads.');
  }
  if (env.GITHUB_SHA) assert.match(env.GITHUB_SHA, /^[a-f0-9]{40}$/, 'Invalid source commit.');
  return { profile, environment: env.IOS_RELEASE_ENVIRONMENT || 'production', apiOrigin,
    gameplayPolicy: policy === 'free' ? null : policy, rewarded, privateAudio, warmth };
}

export function expectedFeatureDefines(features) {
  return {
    __MAYDAN_ROOMS_URL__: JSON.stringify(features.apiOrigin),
    __MAYDAN_GAMEPLAY_POLICY__: JSON.stringify(features.gameplayPolicy),
    __MAYDAN_REWARDED_PREVIEW__: JSON.stringify(Boolean(features.rewarded)),
    __MAYDAN_AUDIO_PREVIEW__: JSON.stringify(features.privateAudio),
    __MAYDAN_WARMTH_PREVIEW__: JSON.stringify(features.warmth),
  };
}

export function assertFeatureDefines(features, defines) {
  const expected = expectedFeatureDefines(features);
  for (const [name, value] of Object.entries(expected)) {
    assert.equal(defines[name], value, `Prepared build definition differs: ${name}`);
  }
  return expected;
}

export async function checkServerReadiness(features, { fetchImpl = fetch, now = () => new Date() } = {}) {
  // A fixed approved destination and four public GETs only. No account, room,
  // private word bank, mutation, provider secret or callback is involved.
  assert.equal(resolveNativeBuildOrigin({ IOS_RELEASE_ENVIRONMENT: features.environment,
    MAYDAN_ROOMS_URL: features.apiOrigin }), features.apiOrigin);
  const endpoints = ['/health', '/api/mafia/capabilities', '/api/cosmetics/catalog', '/api/billing/config'];
  const checks = await Promise.all(endpoints.map(async endpoint => {
    const check = { endpoint, status: null, passed: false };
    try {
      const response = await fetchImpl(features.apiOrigin + endpoint, { method: 'GET', redirect: 'error',
        headers: { Origin: 'maydan://app', 'cache-control': 'no-cache' }, signal: AbortSignal.timeout(12000) });
      check.status = response.status;
      if (!response.ok) return check;
      const chunks = []; let size = 0;
      for await (const chunk of response.body) {
        size += chunk.length;
        assert.ok(size <= 1024 * 1024, 'Public readiness response is too large.');
        chunks.push(chunk);
      }
      const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (endpoint === '/health') {
        check.games = Array.isArray(data.games) ? data.games.filter(game => Object.hasOwn(ONLINE_GAMES, game)) : [];
        check.protocol = data.protocol; check.accounts = data.accounts === true;
        check.passed = data.ok === true && data.protocol === 1 && check.accounts &&
          Object.keys(ONLINE_GAMES).every(game => check.games.includes(game));
      } else if (endpoint === '/api/mafia/capabilities') {
        check.enabled = data.enabled === true; check.protocol = data.capabilities?.mafia;
        check.passed = check.enabled && check.protocol === ROOM_CAPABILITIES.mafia;
      } else if (endpoint === '/api/cosmetics/catalog') {
        const frame = Array.isArray(data.items) && data.items.find(item => item.id === 'plus.signature.frame');
        check.catalogVersion = data.version;
        check.signatureFrame = Boolean(frame && frame.kind === 'frame' && frame.motionKind === 'living-frame' && frame.frameTheme === 'signature');
        check.passed = data.version >= 3 && check.signatureFrame;
      } else {
        check.gameplayPolicy = data.gameplay?.policy || null;
        check.gameplayAccess = data.gameplay?.access || null;
        check.passed = check.gameplayPolicy === features.gameplayPolicy && check.gameplayAccess === 'trial-ticket';
        if (features.gameplayPolicy === ENTRY_TICKET_POLICY) {
          check.beforeModeEntry = data.gameplay?.entryGate === 'before-mode' && data.gameplay?.ticketScope === 'game'
            && data.gameplay?.gameplayCapability === 2 && Array.isArray(data.gameplay?.freePacks) && data.gameplay.freePacks.length === 0;
          check.passed &&= check.beforeModeEntry;
        }
      }
    } catch { check.error = 'PUBLIC_READ_FAILED'; }
    return check;
  }));
  return { schemaVersion: 1, checkedAt: now().toISOString(), apiOrigin: features.apiOrigin,
    profile: features.profile, passed: checks.every(check => check.passed), checks,
    limits: ['Public capability checks do not prove D1 migration 0030, real Google SSV, purchase verification, private voice isolation or device acceptance.'] };
}

export function warmthActiveIntro(manifest, html) {
  assert.equal(manifest.files.length, 14, 'The complete Warmth inventory must contain exactly fourteen files.');
  assert.equal(manifest.runtimePackSHA256, RUNTIME_PACK_SHA256, 'Warmth runtime fingerprint differs.');
  for (const entry of manifest.files) {
    assert.ok(html.includes(path.posix.basename(entry.url)), `Prepared HTML does not reference Warmth resource: ${entry.url}`);
  }
  const intro = manifest.runtimePack.assets['music-bossa'];
  return { id: intro.id, url: `audio-warmth-preview/${intro.file.url}`,
    sha256: intro.file.sha256, seconds: intro.file.durationSeconds };
}

export async function writePreparedFeatures({ projectDir, destination, build, defines, env = process.env, root = ROOT }) {
  const features = resolveReleaseFeatures(env);
  const compileDefines = assertFeatureDefines(features, defines);
  const nativeBytes = await readFile(path.join(destination, 'native-config.json'));
  const native = JSON.parse(nativeBytes);
  assert.equal(native.apiOrigin, features.apiOrigin, 'Prepared API origin differs.');
  const expectedRewarded = features.rewarded && { mode: features.rewarded.mode, appId: features.rewarded.appId,
    adUnit: features.rewarded.adUnit, ...(features.rewarded.testVersion ? { testVersion: features.rewarded.testVersion } : {}) };
  assert.deepEqual(native.rewarded || null, expectedRewarded || null, 'Prepared Rewarded configuration differs.');
  const project = await readFile(path.join(projectDir, 'Maydan.xcodeproj/project.pbxproj'), 'utf8');
  const pins = JSON.parse(await readFile(path.join(projectDir, 'Maydan.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved')));
  const adsPackages = pins.pins.filter(pin => ['swift-package-manager-google-mobile-ads', 'swift-package-manager-google-user-messaging-platform'].includes(pin.identity))
    .map(pin => ({ identity: pin.identity, version: pin.state.version, revision: pin.state.revision }));
  assert.equal(adsPackages.length, features.rewarded ? 2 : 0, 'Prepared advertising SDK packages differ.');
  assert.equal(project.includes('MAYDAN_REWARDED_ADS'), Boolean(features.rewarded), 'Prepared native advertising compilation differs.');

  const files = new Map();
  const add = (entry, prefix = '') => {
    const url = prefix + entry.url;
    assert.match(url, /^[a-zA-Z0-9/_-]+\.(?:m4a|wav|mp3|ogg)$/, 'Invalid audio resource path.');
    const previous = files.get(url);
    assert.ok(!previous || previous.sha256 === entry.sha256, 'Conflicting audio resource.');
    files.set(url, { path: `www/${url}`, sha256: entry.sha256, bytes: entry.bytes });
  };
  for (const entry of [...Object.values(SAMPLE_BANK), ...Object.values(MUSIC_BANK), SELECTED_AUDIO.music, ...SELECTED_AUDIO.voices]) add(entry);
  let warmthManifest = null;
  if (features.warmth) {
    warmthManifest = await readWarmthManifest(root);
    for (const entry of warmthManifest.files) add(entry, 'audio-warmth-preview/');
  } else if (features.privateAudio) {
    for (const entry of (await readManifest(root)).files) add(entry);
  }
  const resources = [...files.values()].sort((a, b) => a.path.localeCompare(b.path));
  for (const entry of resources) {
    const bytes = await readFile(path.join(destination, entry.path.slice(4)));
    assert.equal(bytes.length, entry.bytes, `Prepared audio size differs: ${entry.path}`);
    assert.equal(hash(bytes), entry.sha256, `Prepared audio hash differs: ${entry.path}`);
  }
  const html = await readFile(path.join(destination, 'index.html'));
  let gameEntry;
  if (features.gameplayPolicy === ENTRY_TICKET_POLICY) {
    assert.ok(html.includes(Buffer.from('data-maydan-game-entry')) && html.includes(Buffer.from(ENTRY_TICKET_POLICY)),
      'The before-mode entry gate is missing from the actual prepared HTML.');
    const games = [...new Set(GAMEPLAY_OFFERS.map(offer => offer.game))];
    assert.equal(games.length, 8, 'The entry gate must cover all eight current games.');
    gameEntry = { policy: ENTRY_TICKET_POLICY, surface: 'game-entry', games, consumption: 'match-start' };
  }
  const activeIntro = warmthManifest ? warmthActiveIntro(warmthManifest, html.toString('utf8'))
    : { id: SELECTED_AUDIO.music.id, url: SELECTED_AUDIO.music.url,
      sha256: SELECTED_AUDIO.music.sha256, seconds: SELECTED_AUDIO.music.seconds };
  resources.unshift({ path: 'www/index.html', bytes: html.length, sha256: hash(html) },
    { path: 'www/native-config.json', bytes: nativeBytes.length, sha256: hash(nativeBytes) });
  const receipt = {
    schemaVersion: 1, sourceCommit: env.GITHUB_SHA || null, version: build.version, build: env.IOS_BUILD || null,
    profile: features.profile, environment: features.environment, apiOrigin: features.apiOrigin,
    gameplayPolicy: features.gameplayPolicy, compileDefines,
    ...(gameEntry ? { gameEntry } : {}),
    rewarded: { mode: features.rewarded?.mode || 'off', sdkProjectConfigured: Boolean(features.rewarded),
      packages: adsPackages, configuration: expectedRewarded || null },
    audio: {
      mode: features.warmth ? 'warmth-private-preview' : features.privateAudio ? 'private-candidates' : 'standard',
      privatePreview: features.privateAudio, warmthPreview: features.warmth,
      bundledSelectedAudio: { releaseStatus: SELECTED_AUDIO.releaseStatus, musicId: SELECTED_AUDIO.music.id,
        musicURL: SELECTED_AUDIO.music.url, musicSHA256: SELECTED_AUDIO.music.sha256,
        voicesProductionApproved: SELECTED_AUDIO.voicesProductionApproved },
      activeHome: features.warmth ? 'warmth-long' : SELECTED_AUDIO.music.id,
      activeIntro,
      warmth: warmthManifest ? { bundleId: warmthManifest.bundleId,
        runtimePackSHA256: warmthManifest.runtimePackSHA256, sourceManifestSHA256: warmthManifest.sourceManifestSHA256,
        productionApproved: false, directionId: 'bossaAlternative', suiteId: 'warmth-long' } : null,
    },
    resources,
    limits: ['Client package evidence only. Server policy, migrations, provider verification and physical-device acceptance require separate reports.'],
  };
  const text = JSON.stringify(receipt, null, 2) + '\n';
  await writeFile(path.join(destination, 'release-features.json'), text);
  const evidence = path.join(root, 'ios/build/release-features.json');
  await mkdir(path.dirname(evidence), { recursive: true });
  await writeFile(evidence, text);
  return { receipt, sha256: hash(Buffer.from(text)), evidence };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  assert.ok(['--preflight', '--server-readiness'].includes(process.argv[2]), 'Use --preflight or --server-readiness.');
  const features = resolveReleaseFeatures(process.env);
  if (features.profile === 'complete-preview') {
    const proof = await checkServerReadiness(features);
    const filename = path.join(ROOT, 'ios/build/server-readiness.json');
    await mkdir(path.dirname(filename), { recursive: true });
    await writeFile(filename, JSON.stringify(proof, null, 2) + '\n');
    assert.ok(proof.passed, 'The selected server does not expose all complete-preview features. See ios/build/server-readiness.json.');
  }
  console.log(JSON.stringify(features, null, 2));
}

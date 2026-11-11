import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { generateSignedRewardedProject } from '../scripts/ios/rewarded-preview.mjs';
import { resolveRewardedBuild, SAMPLE_APP_ID, SAMPLE_REWARDED_UNIT } from '../scripts/ios/rewarded-config.mjs';

test('Rewarded SDK, sample app ID and inspectable bridge stay in an isolated Debug project', async () => {
  const project = 'Maydan.xcodeproj';
  const projectFile = path.join(project, 'project.pbxproj');
  const packageFile = path.join(project, 'project.xcworkspace/xcshareddata/swiftpm/Package.resolved');
  const schemeFile = path.join(project, 'xcshareddata/xcschemes/Maydan.xcscheme');
  const plistFile = path.join('Maydan', 'Info.plist');
  const read = (directory, file) => readFile(path.join(directory, file), 'utf8');
  const production = await Promise.all([projectFile, packageFile, schemeFile, plistFile].map(file => read('ios', file)));
  assert.doesNotMatch(production.join('\n'), /GoogleMobileAds|GoogleUserMessagingPlatform|GADApplicationIdentifier|SKAdNetworkItems|MAYDAN_REWARDED_PREVIEW/);

  const output = execFileSync(process.execPath, ['scripts/ios/rewarded-preview.mjs', '--project-only'], { encoding: 'utf8' });
  const generated = path.dirname(output.trim().replace('Local sample project: ', ''));
  assert.equal(path.relative('.cache', generated).split(path.sep).length, 1);
  const [pbx, pins, scheme, plist] = await Promise.all(
    [projectFile, packageFile, schemeFile, plistFile].map(file => read(generated, file)));
  assert.match(pbx, /PRODUCT_BUNDLE_IDENTIFIER = org\.maydan\.rewarded\.preview; SKIP_INSTALL = YES;/);
  assert.match(pbx, /MAYDAN_REWARDED_PREVIEW/);
  assert.match(pbx, /RewardedAdCoordinator\.swift in Sources/);
  assert.doesNotMatch(pbx, /name = Release;|CODE_SIGN_ENTITLEMENTS =|DEVELOPMENT_TEAM =/);
  assert.match(scheme, /buildForArchiving="NO"/);
  assert.doesNotMatch(scheme, /ArchiveAction|buildConfiguration="Release"/);
  const versions = Object.fromEntries(JSON.parse(pins).pins.map(pin => [pin.identity, pin.state.version]));
  assert.equal(versions['swift-package-manager-google-mobile-ads'], '13.12.0');
  assert.equal(versions['swift-package-manager-google-user-messaging-platform'], '3.1.0');
  assert.match(plist, /<key>GADApplicationIdentifier<\/key>\s*<string>ca-app-pub-3940256099942544~1458002511<\/string>/);
  const networks = [...plist.matchAll(/<string>([a-z0-9]{10}\.skadnetwork)<\/string>/g)].map(match => match[1]);
  assert.ok(networks.includes('cstr6suwn9.skadnetwork'));
  assert.equal(new Set(networks).size, 50);
  assert.doesNotMatch(plist, /NSUserTrackingUsageDescription|NSAllowsArbitraryLoads|CFBundleURLTypes/);
  assert.deepEqual(await Promise.all([projectFile, packageFile, schemeFile, plistFile].map(file => read('ios', file))), production);
});

test('Rewarded native display accepts only the pinned unit and sends only opaque SSV data', async () => {
  const native = await readFile('ios/RewardedPreview/RewardedAdCoordinator.swift', 'utf8');
  const bridge = await readFile('ios/Maydan/GameViewController.swift', 'utf8');
  assert.match(native, /unit == expectedUnit/);
  assert.match(native, /mode == "testflight"[\s\S]*unit == sampleUnit/);
  assert.match(native, /Self\.mode == "live" \? \.production : \.sandbox/);
  assert.match(native, /AppTransaction\.shared[\s\S]*\.verified\(transaction\)[\s\S]*transaction\.environment == expectedEnvironment/);
  assert.match(native, /mode == "testflight-owned"[\s\S]*MaydanRewardedTestVersion[\s\S]*CFBundleShortVersionString/);
  assert.match(native, /verification\.customRewardText = token/);
  assert.doesNotMatch(native, /verification\.userIdentifier|URLSession|ATTrackingManager/);
  assert.match(native, /ConsentInformation\.shared\.canRequestAds/);
  assert.match(native, /finish\(earned \? \.pending : \.skipped\)/);
  assert.match(bridge, /message\.frameInfo\.isMainFrame/);
  assert.match(bridge, /hasActiveRewardedOffer/);
  assert.match(bridge, /rewardedRequestEpoch == epoch/);
  assert.match(bridge, /expiresAt > Date\(\)\.timeIntervalSince1970/);
  assert.match(bridge, /routePath\(url\) == "\/settings"/);
});

const ownedApp = 'ca-app-pub-1234567890123456~1234567890';
const ownedUnit = 'ca-app-pub-1234567890123456/1234567890';
const testflight = { IOS_RELEASE_ENVIRONMENT: 'mafia-preview', IOS_REWARDED_MODE: 'testflight' };
const live = { IOS_RELEASE_ENVIRONMENT: 'production', IOS_REWARDED_MODE: 'live',
  IOS_ADMOB_APP_ID: ownedApp, IOS_ADMOB_REWARDED_UNIT_ID: ownedUnit };
const ownedBeta = { ...live, IOS_RELEASE_ENVIRONMENT: 'mafia-preview', IOS_REWARDED_MODE: 'testflight-owned',
  IOS_VERSION: '1.9', IOS_ADMOB_TEST_VERSION: '1.9' };

test('signed ads configuration separates the isolated sample from the live publisher', () => {
  assert.equal(resolveRewardedBuild(), null);
  assert.throws(() => resolveRewardedBuild({ IOS_ADMOB_APP_ID: ownedApp }));
  assert.equal(resolveRewardedBuild(testflight).appId, SAMPLE_APP_ID);
  assert.equal(resolveRewardedBuild({ ...testflight, IOS_ADMOB_APP_ID: ownedApp }).adUnit, SAMPLE_REWARDED_UNIT);
  assert.throws(() => resolveRewardedBuild({ ...testflight, IOS_ADMOB_REWARDED_UNIT_ID: ownedUnit }));
  assert.throws(() => resolveRewardedBuild({ ...testflight, IOS_RELEASE_ENVIRONMENT: 'production' }));
  assert.throws(() => resolveRewardedBuild({ ...live, IOS_RELEASE_ENVIRONMENT: 'mafia-preview' }));
  assert.throws(() => resolveRewardedBuild({ ...live, IOS_ADMOB_REWARDED_UNIT_ID: SAMPLE_REWARDED_UNIT }));
  assert.throws(() => resolveRewardedBuild({ ...live, IOS_ADMOB_APP_ID: SAMPLE_APP_ID }));
  assert.equal(resolveRewardedBuild(live).adUnit, ownedUnit);
  assert.equal(resolveRewardedBuild(ownedBeta).testVersion, '1.9');
  assert.equal(resolveRewardedBuild(ownedBeta).adUnit, ownedUnit);
  assert.throws(() => resolveRewardedBuild({ ...ownedBeta, IOS_ADMOB_TEST_VERSION: '' }));
  assert.throws(() => resolveRewardedBuild({ ...ownedBeta, IOS_VERSION: '1.10' }));
  assert.throws(() => resolveRewardedBuild({ ...ownedBeta, IOS_RELEASE_ENVIRONMENT: 'production' }));
  assert.throws(() => resolveRewardedBuild({ ...ownedBeta, IOS_ADMOB_REWARDED_UNIT_ID: SAMPLE_REWARDED_UNIT }));
  assert.throws(() => resolveRewardedBuild({ ...live, IOS_ADMOB_TEST_VERSION: '1.9' }));
});

test('generated signed projects preserve Maydan signing, App Store capabilities and mode-specific IDs', async () => {
  for (const input of [{ ...testflight, IOS_ADMOB_APP_ID: ownedApp }, ownedBeta, live]) {
    const config = resolveRewardedBuild(input);
    const output = await generateSignedRewardedProject(input);
    const [project, plist, scheme] = await Promise.all([
      readFile(path.join(output, 'Maydan.xcodeproj/project.pbxproj'), 'utf8'),
      readFile(path.join(output, 'Maydan/Info.plist'), 'utf8'),
      readFile(path.join(output, 'Maydan.xcodeproj/xcshareddata/xcschemes/Maydan.xcscheme'), 'utf8'),
    ]);
    assert.equal(project.match(/MAYDAN_REWARDED_ADS/g)?.length, 2);
    assert.match(project, /PRODUCT_BUNDLE_IDENTIFIER = Maydan;/);
    assert.match(project, /CODE_SIGN_ENTITLEMENTS = Maydan\/Maydan.entitlements;/);
    assert.match(project, /MAYDAN_PROVISIONING_PROFILE_SPECIFIER/);
    assert.match(scheme, /ArchiveAction buildConfiguration="Release"/);
    assert.match(plist, /CFBundleURLTypes|remote-notification/);
    assert.ok(plist.includes(`<string>${config.appId}</string>`));
    assert.ok(plist.includes(`<string>${config.adUnit}</string>`));
    assert.ok(plist.includes(`<string>${config.mode}</string>`));
    if (config.testVersion) assert.match(plist, /<key>MaydanRewardedTestVersion<\/key>\s*<string>1\.9<\/string>/);
    else assert.doesNotMatch(plist, /MaydanRewardedTestVersion/);
    assert.doesNotMatch(plist, /NSAllowsLocalNetworking|NSUserTrackingUsageDescription/);
  }
});

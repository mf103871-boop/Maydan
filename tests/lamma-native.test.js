// Cross-runtime release contracts: these catch mismatched web/native commands,
// dependency pins and signing settings. macOS CI and physical-device acceptance
// are still required; source checks do not establish audio or APNs delivery.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const coordinator = read('ios/Maydan/SocialCoordinator.swift');
const game = read('ios/Maydan/GameViewController.swift');
const project = read('ios/Maydan.xcodeproj/project.pbxproj');
const recorder = read('ios/Maydan/SocialVoiceRecorder.swift');

test('Lamma web commands match native allowlist and coordinator implementation', () => {
  const web = ['src/social/media.js', 'src/shared/account/AccountProvider.jsx'].map(read).join('\n');
  const commands = [...web.matchAll(/callNative\('((?:social)[A-Za-z]+)'/g)].map(match => match[1]);
  assert.ok(commands.length >= 8);
  const delegated = game.match(/let socialCommands: Set<String> = \[([\s\S]*?)\]/)?.[1] || '';
  for (const command of new Set(commands)) {
    assert.ok(delegated.includes(`"${command}"`), `${command} is not in the trusted bridge allowlist`);
    assert.ok(coordinator.includes(`case "${command}":`), `${command} lacks a native implementation`);
  }
  assert.match(game, /message\.frameInfo\.isMainFrame/);
  assert.match(game, /isTrustedGameURL\(pageURL\)/);
});

test('push entitlement and native registration select the same build environment', () => {
  const key = '$(MAYDAN_PUSH_ENVIRONMENT)';
  assert.ok(read('ios/Maydan/Info.plist').includes(`<key>MaydanPushEnvironment</key>\n    <string>${key}</string>`));
  assert.ok(read('ios/Maydan/Maydan.entitlements').includes(`<key>aps-environment</key>\n    <string>${key}</string>`));
  assert.match(project, /MAYDAN_PUSH_ENVIRONMENT = development;/);
  assert.match(project, /MAYDAN_PUSH_ENVIRONMENT = production;/);
  assert.match(read('scripts/ios/signing.py'), /entitlements\.get\('aps-environment'\) == 'production'/);
  assert.match(coordinator, /environment == "production" \? "production" : "sandbox"/);
  assert.match(read('ios/Maydan/AppDelegate.swift'), /didRegisterForRemoteNotificationsWithDeviceToken/);
});

test('pinned native SDK has a matching lockfile entry and all native sources are built', () => {
  const version = project.match(/kind = exactVersion; version = ([\d.]+);/)?.[1];
  const lock = JSON.parse(read('ios/Maydan.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved'));
  const sdk = lock.pins.find(pin => pin.identity === 'client-sdk-swift');
  assert.equal(sdk.state.version, version);
  for (const pin of lock.pins) {
    assert.match(pin.location, /^https:\/\/github\.com\//);
    assert.match(pin.state.revision, /^[a-f0-9]{40}$/);
    assert.match(pin.state.version, /^\d+\.\d+\.\d+$/);
  }
  for (const source of ['SocialCoordinator', 'SocialSession', 'SocialVoiceRecorder']) {
    assert.equal((project.match(new RegExp(`${source}\\.swift in Sources`, 'g')) || []).length, 2);
  }
});

test('audio capabilities and disclosure accompany real native audio integration', () => {
  const plist = read('ios/Maydan/Info.plist');
  assert.match(plist, /NSMicrophoneUsageDescription/);
  assert.match(plist, /<string>audio<\/string>/);
  assert.match(plist, /<string>voip<\/string>/);
  assert.match(read('ios/Maydan/PrivacyInfo.xcprivacy'), /NSPrivacyCollectedDataTypeAudioData/);
  assert.match(recorder, /record\(forDuration: 120\)/);
  assert.match(recorder, /AVFormatIDKey: kAudioFormatMPEG4AAC/);
  assert.match(coordinator, /import LiveKit/);
  assert.match(coordinator, /didActivate audioSession/);
  assert.match(coordinator, /setEngineAvailability\(\.none\)/);
});

test('cold-launch credentials and notifications remain account-scoped', () => {
  const session = read('ios/Maydan/SocialSession.swift');
  assert.match(session, /kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly/);
  assert.match(session, /x-maydan-session/);
  assert.match(session, /completionHandler\(nil\)/, 'bearer redirects must be refused');
  assert.match(session, /NativeConfig\.shared\.isTrustedAuthURL\(url\)/);
  assert.equal((coordinator.match(/data\["recipientId"\] as\? String ==/g) || []).length, 2);
  assert.match(coordinator, /session\.clear\(\)[\s\S]*await finish\(reason: \.remoteEnded\)/, 'clear local credential before asynchronous network cleanup');
});

// Source contracts supplement executable Swift policy checks in macOS CI.
// They do not establish real AVAudioSession routing or microphone behavior.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = file => readFileSync(new URL('../' + file, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const coordinator = read('ios/Maydan/SocialCoordinator.swift');
const recorder = read('ios/Maydan/SocialVoiceRecorder.swift');
const game = read('ios/Maydan/GameViewController.swift');
const section = (source, start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));

test('native lifecycle covers foreground, both interruption phases, routes and media-server reset without account gating', () => {
  for (const name of ['interruptionNotification', 'routeChangeNotification', 'mediaServicesWereLostNotification', 'mediaServicesWereResetNotification']) assert.ok(coordinator.includes('AVAudioSession.' + name));
  for (const name of ['didBecomeActiveNotification', 'didEnterBackgroundNotification']) assert.ok(coordinator.includes('UIApplication.' + name));
  assert.match(coordinator, /interruptionEnded\(shouldResume: shouldResume\)/);
  assert.match(coordinator, /options\.contains\(\.shouldResume\)/);
  assert.match(coordinator, /audioLifecycle\("interruption-ended", shouldResume: shouldResume && self\.audioPolicy\.resumeAllowed\)/);
  assert.match(coordinator, /audioPolicy\.enteredBackground\(\)[\s\S]{0,90}voice\.cancel/);
  assert.match(coordinator, /reason == \.oldDeviceUnavailable[^\n]*shouldResume: false/);
  const lifecycle = section(coordinator, 'private func audioLifecycle', '// Playback uses');
  assert.match(lifecycle, /onAudioLifecycle\?/); assert.doesNotMatch(lifecycle, /webReady|session\.credential/);
  assert.match(game, /new CustomEvent\('maydan-audio-lifecycle', \{detail:/);
});

test('game playback baseline is restored only after its native owners release audio', () => {
  const restore = section(coordinator, 'private func restoreGameAudio()', 'private func restoreCallOutput()');
  assert.match(restore, /guard audioOwner == \.game else \{ return \}/);
  assert.match(restore, /setCategory\(\.playback, mode: \.default/);
  assert.match(restore, /setActive\(true\)/);
  assert.doesNotMatch(restore, /setMicrophone|overrideOutputAudioPort/);
  assert.match(coordinator, /voice\.onSessionReleased = \{ \[weak self\] in self\?\.restoreGameAudio\(\) \}/);
  assert.match(recorder, /var isBusy: Bool \{ recorder != nil \|\| starting \}/);
  assert.match(recorder, /starting = false\s*if recorder == nil \{ onSessionReleased\?\(\) \}/);
  for (const [start, end] of [['func stop()', 'func cancel('], ['func cancel(', 'nonisolated func audioRecorderDidFinishRecording']]) {
    const release = section(recorder, start, end);
    assert.match(release, /setActive\(false[\s\S]*onSessionReleased\?\(\)/);
  }
  assert.match(coordinator, /defer \{ if pendingCallId == id \{ pendingCallId = nil \}; restoreGameAudio\(\) \}/);
});

test('native call recovery cannot publish a microphone or bypass CallKit activation and privacy', () => {
  const restore = section(coordinator, 'private func restoreCallOutput()', 'private func restoreCurrentAudio()');
  assert.match(restore, /canRecoverCall\(callKitActive: audioActive\)/);
  assert.match(restore, /availability\.isInputAvailable && !muted && !privateTurn/);
  assert.match(restore, /if preferredSpeaker \{ try session\.overrideOutputAudioPort\(\.speaker\) \}/);
  assert.match(restore, /isOutputAvailable: true/);
  assert.doesNotMatch(restore, /setMicrophone|setActive\(true\)|muted = false/);
  const command = section(coordinator, 'case "socialCallResumeAudio":', 'case "socialCallSpeaker":');
  assert.match(command, /session\.credential\?\.userId == current\.userId/);
  assert.match(command, /payload\["callId"\] as\? String == current\.id\.uuidString\.lowercased\(\)/);
  assert.match(command, /try restoreCallOutput\(\)/);
  assert.match(command, /payload\["userInitiated"\] as\? Bool == true \{ audioPolicy\.userRequestedPlayback\(\) \}/);
  assert.doesNotMatch(command, /setMicrophone|muted = false|privateTurn = false|audioLifecycle\(/);
  assert.match(game, /"socialCallResumeAudio"/);
  const activation = section(coordinator, 'didActivate audioSession:', 'didDeactivate audioSession:');
  assert.match(activation, /let activeRoom = self\.room/);
  assert.match(activation, /await activeRoom\?\.localParticipant\.setMicrophone[\s\S]*guard self\.call\?\.id == callId, self\.room === activeRoom/);
  assert.match(activation, /self\.privateTurn \|\| self\.audioPolicy\.interrupted \|\| self\.muted/);
  const finish = section(coordinator, 'private func finish(reason:', 'private func callSnapshot()');
  assert.match(finish, /audioActive = false[\s\S]*call = nil[\s\S]*await previousRoom\?\.disconnect\(\)/);
});

test('gesture recovery is trusted, fire-and-forget, foreground-only and refuses call/recording ownership', () => {
  const command = section(game, 'switch type {', 'case "haptic":');
  assert.match(command, /case "gameAudioResume":[\s\S]*resumeGameAudioFromGesture\(\)/);
  const gesture = section(coordinator, 'func resumeGameAudioFromGesture()', 'func webDidReload()');
  assert.match(gesture, /UIApplication\.shared\.applicationState == \.active, !audioPolicy\.interrupted/);
  assert.match(gesture, /call == nil, pendingCallId == nil, !voice\.isBusy/);
  assert.match(gesture, /audioPolicy\.userRequestedPlayback\(\)/);
  assert.doesNotMatch(gesture, /setMicrophone|muted = false|overrideOutputAudioPort/);
});

test('production policy is built into the application and executable ownership tests are mandatory in native CI', () => {
  const project = read('ios/Maydan.xcodeproj/project.pbxproj');
  assert.equal((project.match(/NativeAudioPolicy\.swift in Sources/g) || []).length, 2);
  assert.match(read('.github/workflows/ios-testflight.yml'), /python3 scripts\/ios\/verify_audio_policy\.py/);
  const runner = read('scripts/ios/verify_audio_policy.py');
  assert.match(runner, /ios\/Maydan\/NativeAudioPolicy\.swift/);
  assert.match(runner, /tests\/native\/audio-policy\.swift/);
  assert.match(runner, /subprocess\.run\(\[str\(executable\)\], check=True/);
  const swift = read('tests/native/audio-policy.swift');
  assert.match(swift, /var policy = NativeAudioPolicy\(\)/);
  assert.match(swift, /interruptionEnded\(shouldResume: false\)/);
  assert.match(swift, /mediaServicesReset\(\)/);
  assert.match(swift, /Headphone hold survives foreground and media reset/);
  const policy = read('ios/Maydan/NativeAudioPolicy.swift');
  assert.doesNotMatch(section(policy, 'mutating func becameActive()', 'mutating func enteredBackground'), /resumeAllowed = true/);
});

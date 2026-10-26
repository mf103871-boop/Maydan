import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CallMedia } from '../src/social/media.js';
import { emitNativeEvent, resetNativeForTests, resolveNative } from '../src/shared/account/native.js';

const CALL = 'b38f4431-ab9a-46f1-8882-7a36838b34db';
const SESSION = 'db90fa81-03f2-4184-a555-cfe680bbf558';
function nativeFixture(handler = () => ({})) {
  resetNativeForTests();
  const previous = { window: globalThis.window, location: globalThis.location };
  const commands = [];
  globalThis.location = { protocol: 'maydan:' };
  globalThis.window = Object.assign(new EventTarget(), { webkit: { messageHandlers: { maydan: { postMessage(command) {
    commands.push(command);
    const result = handler(command);
    if (result !== undefined) queueMicrotask(() => resolveNative(command.id, { ok: true, result }));
  } } } } });
  return { commands, close() { resetNativeForTests(); globalThis.window = previous.window; globalThis.location = previous.location; } };
}
function grant(epoch, { quiet = false, canPublish = true } = {}) {
  return { call: { id: CALL, scope: 'mafia', conversationId: '123456', voiceSessionId: SESSION }, voiceSessionId: SESSION,
    mediaEpoch: epoch, canPublish, quiet,
    connection: quiet ? null : { url: 'wss://private-test.livekit.cloud', token: 'signed-fixture-token-for-the-test-only' } };
}
function event(epoch, extra = {}) {
  return { userId: 'alice', callId: CALL, scope: 'mafia', conversationId: '123456', voiceSessionId: SESSION,
    mediaEpoch: epoch, canPublish: true, quiet: false, state: 'connected', muted: true,
    participants: [{ id: 'alice', muted: true }, { id: 'authorized-peer', speaking: true }], ...extra };
}

test('native older audience events and credentials cannot replace a newer Mafia epoch', async () => {
  const fixture = nativeFixture(), media = new CallMedia(); media.setAccount('alice');
  try {
    await media.transitionGame(grant(4), { muted: true });
    emitNativeEvent('socialCall', event(4));
    const before = structuredClone(media.state), commands = fixture.commands.length;
    emitNativeEvent('socialCall', event(3, { state: 'ended', participants: [{ id: 'old-secret-peer' }] }));
    await media.transitionGame(grant(3), { muted: false });
    assert.deepEqual(media.state, before);
    assert.equal(fixture.commands.length, commands, 'an old grant must not cross the native bridge');
    emitNativeEvent('socialCall', event(5, { state: 'silent', quiet: true, canPublish: false, participants: [] }));
    emitNativeEvent('socialCall', event(4));
    assert.equal(media.state.mediaEpoch, 5); assert.equal(media.state.quiet, true);
    assert.equal(media.state.canPublish, false); assert.deepEqual(media.state.participants, []);
  } finally { await media.dispose(); fixture.close(); }
});

test('a native quiet phase keeps one call identifier and rejects unmute before sending a bridge command', async () => {
  const fixture = nativeFixture(), media = new CallMedia(); media.setAccount('alice');
  try {
    await media.transitionGame(grant(8, { quiet: true, canPublish: false }), { muted: false });
    const command = fixture.commands.find(c => c.type === 'socialCallConnect');
    assert.equal(command.callId, CALL); assert.equal(command.scope, 'mafia');
    assert.equal(command.quiet, true); assert.equal(command.muted, true);
    assert.equal(command.canPublish, false); assert.equal(command.token, undefined);
    await assert.rejects(media.mute(false), error => error.code === 'AUDIO_PRIVATE');
    assert.equal(fixture.commands.some(c => c.type === 'socialCallMute' || c.type === 'socialVoiceStart' || c.type === 'socialCallEnd'), false);
    await media.transitionGame(grant(9, { canPublish: false }), { muted: false });
    assert.ok(fixture.commands.filter(c => c.type === 'socialCallConnect').every(c => c.callId === CALL && c.muted));
  } finally { await media.dispose(); fixture.close(); }
});

test('authorization pause clears the audience synchronously and pauses transport without ending CallKit', async () => {
  let acknowledgePause;
  const fixture = nativeFixture(command => {
    if (command.type === 'socialCallPauseGame') { acknowledgePause = () => resolveNative(command.id, { ok: true, result: {} }); return undefined; }
    return {};
  });
  const media = new CallMedia(); media.setAccount('alice');
  try {
    await media.transitionGame(grant(10), { muted: true }); emitNativeEvent('socialCall', event(10));
    const pending = media.pauseGame();
    assert.equal(media.state.quiet, true); assert.equal(media.state.canPublish, false);
    assert.equal(media.state.muted, true); assert.deepEqual(media.state.participants, []);
    const pause = fixture.commands.find(c => c.type === 'socialCallPauseGame');
    assert.equal(pause.expectedMediaEpoch, 10); assert.equal(pause.callId, CALL);
    assert.equal(fixture.commands.some(c => c.type === 'socialCallEnd'), false);
    acknowledgePause(); await pending;
  } finally { acknowledgePause?.(); await media.dispose(); fixture.close(); }
});

test('a queued native connected event from the suspended epoch cannot restore the old audience without new authorization', async () => {
  const fixture = nativeFixture(), media = new CallMedia(); media.setAccount('alice');
  try {
    await media.transitionGame(grant(12), { muted: true }); emitNativeEvent('socialCall', event(12));
    await media.pauseGame();
    emitNativeEvent('socialCall', event(12, { muted: false }));
    assert.equal(media.state.quiet, true);
    assert.equal(media.state.canPublish, false);
    assert.deepEqual(media.state.participants, []);
    await media.transitionGame(grant(13), { muted: true });
    emitNativeEvent('socialCall', event(13));
    assert.equal(media.state.mediaEpoch, 13); assert.equal(media.state.connected, true);
    assert.equal(media.state.participants.length, 2);
  } finally { await media.dispose(); fixture.close(); }
});

test('a delayed native connect completion carries its old epoch when cleaning up, preserving a newer audience', async () => {
  const fixture = nativeFixture(command => command.type === 'socialCallConnect' ? undefined : {});
  const media = new CallMedia(); media.setAccount('alice');
  try {
    const earlier = media.transitionGame(grant(20), { muted: true });
    const first = fixture.commands.find(c => c.type === 'socialCallConnect');
    const later = media.transitionGame(grant(21), { muted: true });
    const second = fixture.commands.filter(c => c.type === 'socialCallConnect')[1];
    emitNativeEvent('socialCall', event(21));
    resolveNative(second.id, { ok: true, result: {} }); await later;
    resolveNative(first.id, { ok: true, result: {} }); await earlier;
    const cleanup = fixture.commands.find(c => c.type === 'socialCallEnd');
    assert.equal(cleanup.expectedMediaEpoch, 20); assert.equal(cleanup.localOnly, true);
    assert.equal(media.state.mediaEpoch, 21); assert.equal(media.state.connected, true);
  } finally { await media.dispose(); fixture.close(); }
});

test('a replacement session within the same epoch rejects old events and fences late native cleanup by session ID', async () => {
  const replacement = '0c9812b8-d595-4262-915c-8970c40903af';
  const fixture = nativeFixture(command => command.type === 'socialCallConnect' ? undefined : {});
  const media = new CallMedia(); media.setAccount('alice');
  try {
    const old = media.transitionGame(grant(25), { muted: true });
    const first = fixture.commands.find(c => c.type === 'socialCallConnect');
    const newGrant = grant(25); newGrant.voiceSessionId = replacement; newGrant.call.voiceSessionId = replacement;
    const next = media.transitionGame(newGrant, { muted: true });
    const second = fixture.commands.filter(c => c.type === 'socialCallConnect')[1];
    resolveNative(second.id, { ok: true, result: {} }); await next;
    emitNativeEvent('socialCall', event(25, { voiceSessionId: replacement }));
    emitNativeEvent('socialCall', event(25, { state: 'ended' }));
    assert.equal(media.state.voiceSessionId, replacement); assert.equal(media.state.connected, true);
    resolveNative(first.id, { ok: true, result: {} }); await old;
    const cleanup = fixture.commands.find(c => c.type === 'socialCallEnd');
    assert.equal(cleanup.expectedMediaEpoch, 25); assert.equal(cleanup.expectedVoiceSessionId, SESSION);
    assert.equal(media.state.voiceSessionId, replacement); assert.equal(media.state.connected, true);
  } finally { await media.dispose(); fixture.close(); }
});

test('web listening and quiet phases never enable microphone capture even if the caller asks to unmute', async () => {
  const fixture = nativeFixture(); delete window.webkit; location.protocol = 'https:';
  const microphones = [], connections = []; let loads = 0;
  class FakeRoom {
    constructor() {
      this.remoteParticipants = new Map();
      this.localParticipant = { identity: 'alice', isMicrophoneEnabled: false, async setMicrophoneEnabled(value) { microphones.push(value); this.isMicrophoneEnabled = value; } };
    }
    on() {}
    async connect(url, token) { connections.push({ url, token }); }
    async disconnect() {}
  }
  const media = new CallMedia(() => {}, { loadSDK: async () => { loads++; return { Room: FakeRoom, RoomEvent: {}, Track: { Kind: { Audio: 'audio' } } }; } });
  media.setAccount('alice');
  try {
    await media.transitionGame(grant(30, { quiet: true, canPublish: false }), { muted: false });
    assert.equal(loads, 0); assert.deepEqual(microphones, []); assert.equal(connections.length, 0);
    await media.transitionGame(grant(31, { canPublish: false }), { muted: false });
    assert.equal(loads, 1); assert.equal(connections.length, 1); assert.deepEqual(microphones, [false]);
    await assert.rejects(media.mute(false), error => error.code === 'AUDIO_PRIVATE');
    assert.equal(microphones.some(Boolean), false);
  } finally { await media.dispose(); fixture.close(); }
});

test('native source contracts keep listening permission-free, fixed trusted routes and epoch-fenced microphone transitions', async () => {
  // This is a contract check, not Swift compilation or physical-device evidence.
  const coordinator = await readFile(new URL('../ios/Maydan/SocialCoordinator.swift', import.meta.url), 'utf8');
  const session = await readFile(new URL('../ios/Maydan/SocialSession.swift', import.meta.url), 'utf8');
  const connect = coordinator.slice(coordinator.indexOf('private func connectMafia('), coordinator.indexOf('private func pauseMafiaTransport('));
  assert.ok(connect.length > 100);
  assert.doesNotMatch(connect, /await SocialVoiceRecorder\.permission\(\)/);
  assert.match(connect, /mediaEpoch < current\.mediaEpoch/);
  assert.match(connect, /attempt == callGeneration/);
  assert.match(connect, /recordPermission == \.granted/);
  assert.match(coordinator, /current\.canPublish, !current\.quiet/);
  assert.match(coordinator, /self\.call\?\.mediaEpoch == current\.mediaEpoch/);
  assert.match(coordinator, /expectedMediaEpoch/);
  assert.match(session, /\^\/api\/rooms\/\[0-9\]\{6\}\/voice\$/);
  assert.match(session, /NativeConfig\.shared\.isTrustedAuthURL\(url\)/);
  assert.match(session, /completionHandler\(nil\)/);
});

test('native lifecycle covers the whole window synchronously before an inactive snapshot, independently of WebKit or voice', async () => {
  const scene = await readFile(new URL('../ios/Maydan/SceneDelegate.swift', import.meta.url), 'utf8');
  for (const callback of ['sceneWillResignActive', 'sceneDidEnterBackground']) assert.match(scene, new RegExp(`${callback}[^\\{]+\\{\\s*coverPrivateContent\\(\\)\\s*\\}`));
  const cover = scene.slice(scene.indexOf('private func coverPrivateContent('), scene.indexOf('\n    func scene(', scene.indexOf('private func coverPrivateContent(')));
  assert.match(cover, /UIView\(frame: window\.bounds\)/);
  assert.match(cover, /alpha: 1\)/);
  assert.match(cover, /curtain\.isOpaque = true/);
  assert.match(cover, /curtain\.accessibilityViewIsModal = true/);
  assert.match(cover, /window\.addSubview\(curtain\)/);
  assert.match(cover, /window\.bringSubviewToFront\(privacyCurtain\)/);
  assert.doesNotMatch(cover, /Task\s*\{|DispatchQueue|evaluateJavaScript|SocialCoordinator|Microphone/);
  assert.match(scene, /sceneDidBecomeActive[^\{]+\{\s*privacyCurtain\?\.removeFromSuperview\(\)/);
});

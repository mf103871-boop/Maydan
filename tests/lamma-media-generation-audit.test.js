import test from 'node:test';
import assert from 'node:assert/strict';
import { CallMedia, activeAudioOwners } from '../src/social/media.js';
import { emitNativeEvent, resolveNative, resetNativeForTests } from '../src/shared/account/native.js';

function fixture({ holdConnect = false } = {}) {
  resetNativeForTests();
  const previous = { window: globalThis.window, location: globalThis.location };
  globalThis.location = { protocol: 'maydan:' };
  const commands = [], pending = [];
  globalThis.window = Object.assign(new EventTarget(), { webkit: { messageHandlers: { maydan: { postMessage(command) {
    commands.push(command);
    if (holdConnect && command.type === 'socialCallConnect') { pending.push(command); return; }
    queueMicrotask(() => resolveNative(command.id, { ok: true, result: {} }));
  } } } } });
  const engine = new CallMedia(); engine.setAccount('alice');
  return { engine, commands, finish(index, result) { resolveNative(pending[index].id, { ok: true, result }); }, async close() { for (const command of pending) resolveNative(command.id, { ok: true, result: {} }); await engine.dispose(); resetNativeForTests(); globalThis.window = previous.window; globalThis.location = previous.location; } };
}
const snapshot = (callId, mediaGeneration, state = 'connected') => ({ userId: 'alice', callId, scope: 'direct',
  conversationId: 'conversation', state, mediaGeneration, muted: state === 'ended', participants: [] });
const join = engine => engine.connect({ call: { id: 'group', scope: 'group', conversationId: 'conversation' }, connection: { url: 'wss://synthetic.livekit.cloud', token: 'synthetic' } });

test('leave before the first native event fences delayed snapshots and the pending first RPC', async () => {
  const f = fixture({ holdConnect: true });
  try {
    const first = join(f.engine); first.catch(() => {});
    assert.equal(f.engine.state.nativeMediaGeneration, -1);
    await f.engine.disconnect();
    for (const generation of [undefined, 7]) {
      emitNativeEvent('socialCall', snapshot('group', generation));
      f.engine.applyNativeSnapshot(snapshot('group', generation));
      assert.equal(f.engine.state.connected, false);
      assert.equal(activeAudioOwners().includes(f.engine.owner), false);
    }
    f.finish(0, snapshot('group', 7)); await first;
    assert.equal(f.engine.state.connected, false);
    assert.equal(activeAudioOwners().includes(f.engine.owner), false);
  } finally { await f.close(); }
});

for (const legacy of [false, true]) test(`explicit same-call ${legacy ? 'legacy' : 'generation-aware'} rejoin survives a superseded first RPC and queued native events`, async () => {
  const f = fixture({ holdConnect: true });
  try {
    const first = join(f.engine); first.catch(() => {}); await f.engine.disconnect();
    const rejoined = join(f.engine); rejoined.catch(() => {});
    emitNativeEvent('socialCall', snapshot('group', legacy ? undefined : 8));
    if (!legacy) emitNativeEvent('socialCall', snapshot('group', 7));
    assert.equal(f.engine.state.connected, false, 'events wait for the current explicit rejoin RPC');
    f.finish(0, snapshot('group', legacy ? undefined : 7)); await first;
    assert.equal(f.commands.filter(command => command.type === 'socialCallEnd').length, 1, 'only the actual leave may end the call');
    f.finish(1, snapshot('group', legacy ? undefined : 8, 'connecting')); await rejoined;
    assert.equal(f.engine.state.connected, true, 'the newer queued connected event is retained');
    assert.equal(f.engine.state.nativeMediaGeneration, legacy ? -1 : 8);
    assert.equal(activeAudioOwners().includes(f.engine.owner), true);
  } finally { await f.close(); }
});

test('a second leave also invalidates its pending recovery RPC and buffered native event', async () => {
  const f = fixture({ holdConnect: true });
  try {
    const first = join(f.engine); first.catch(() => {}); await f.engine.disconnect();
    const rejoined = join(f.engine); rejoined.catch(() => {});
    emitNativeEvent('socialCall', snapshot('group', 8)); await f.engine.disconnect();
    f.finish(0, snapshot('group', 7)); f.finish(1, snapshot('group', 8)); await Promise.all([first, rejoined]);
    assert.equal(f.engine.state.connected, false);
    assert.equal(activeAudioOwners().includes(f.engine.owner), false);
  } finally { await f.close(); }
});

test('a delayed native session snapshot cannot revive an ended direct call or retain its audio duck', async () => {
  const f = fixture();
  try {
    emitNativeEvent('socialCall', snapshot('old', 4));
    emitNativeEvent('socialCall', snapshot('old', 5, 'ended'));
    await f.engine.disconnect();
    f.engine.applyNativeSnapshot(snapshot('old', 4));
    assert.equal(f.engine.state.connected, false);
    assert.equal(activeAudioOwners().includes(f.engine.owner), false);
    emitNativeEvent('socialCall', snapshot('new', 6));
    assert.equal(f.engine.state.callId, 'new'); assert.equal(f.engine.state.connected, true);
  } finally { await f.close(); }
});

test('local leave retires its exact native generation while a newer same-call join remains valid', async () => {
  const f = fixture();
  try {
    emitNativeEvent('socialCall', snapshot('group-call', 7));
    await f.engine.disconnect();
    emitNativeEvent('socialCall', snapshot('group-call', 7));
    assert.equal(f.engine.state.connected, false);
    emitNativeEvent('socialCall', snapshot('group-call', 8));
    assert.equal(f.engine.state.connected, true);
    assert.equal(f.engine.state.nativeMediaGeneration, 8);
  } finally { await f.close(); }
});

test('unseen native calls and compatible snapshots from older shells still restore', async () => {
  const f = fixture();
  try {
    const legacy = snapshot('legacy', undefined);
    emitNativeEvent('socialCall', legacy); assert.equal(f.engine.state.callId, 'legacy');
    await f.engine.disconnect();
    emitNativeEvent('socialCall', snapshot('restored', 12));
    assert.equal(f.engine.state.callId, 'restored'); assert.equal(f.engine.state.connected, true);
  } finally { await f.close(); }
});

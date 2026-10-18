import { test } from 'node:test';
import assert from 'node:assert/strict';
import { callParticipantId, normalizeCallParticipants, stableCallParticipants, selectDockParticipants, dockCapacity, clampDockPosition, clampFloatingDockPosition } from '../src/social/call-dock-model.js';

const person = (id, speaking = false) => ({ id, userId: id, name: id, speaking });

test('native and web participants share identities, profiles, and the local label', () => {
  const participants = normalizeCallParticipants([
    { id: 'me', name: 'Private account name', speaking: true, muted: false },
    { identity: 'friend', user: { name: '  أحمد ', avatarPreset: 'fox' }, speaking: true },
    { userId: 'friend', name: 'أحمد', avatarPreset: 'fox', speaking: false, muted: true },
    { id: '', name: 'Missing identity' },
    { userId: 'other', name: ' ' },
  ], { currentUserId: 'me', connected: true, muted: false });
  assert.equal(callParticipantId({ identity: ' friend ' }), 'friend');
  assert.equal(callParticipantId({ userId: ' ', id: 'native-id' }), 'native-id');
  assert.deepEqual(participants.map(p => p.id), ['me', 'friend', 'other']);
  assert.equal(participants[0].name, 'أنت');
  assert.equal(participants[0].local, true);
  assert.equal(participants[0].speaking, true);
  assert.equal(participants[1].avatarPreset, 'fox');
  assert.equal(participants[1].muted, true);
  assert.equal(participants[1].speaking, false);
  assert.equal(participants[2].name, 'لاعب ميدان');
});

test('muting, secret turns, and reconnecting cannot display stale speaker activity', () => {
  const source = [{ id: 'me', speaking: true, muted: false }, { id: 'remote', speaking: true, muted: false }];
  for (const patch of [{ muted: true }, { privateTurn: true }]) {
    const people = normalizeCallParticipants(source, { currentUserId: 'me', connected: true, ...patch });
    assert.equal(people[0].speaking, false); assert.equal(people[0].muted, true);
    assert.equal(people[1].speaking, true);
  }
  for (const patch of [{ connected: false }, { connected: true, connecting: true }]) {
    assert.equal(normalizeCallParticipants(source, patch).some(p => p.speaking), false);
  }
});

test('speaker updates preserve arrival positions and new joiners append after survivors', () => {
  const initial = stableCallParticipants([], [person('a'), person('b'), person('c')]);
  const updated = stableCallParticipants(initial.map(p => p.id), [person('c', true), person('a'), person('d')]);
  assert.deepEqual(updated.map(p => p.id), ['a', 'c', 'd']);
  assert.equal(updated[1].speaking, true);
  assert.deepEqual(stableCallParticipants([], [person('d'), person('a')]).map(p => p.id), ['d', 'a']);
});

test('hidden active speakers use only the last rail seat and the remainder counts simultaneous speech', () => {
  const people = Array.from({ length: 12 }, (_, i) => person(String(i), [0, 4, 5, 11].includes(i)));
  const first = selectDockParticipants(people, 4);
  assert.deepEqual(first.visible.map(p => p.id), ['0', '1', '2', '4']);
  assert.equal(first.hidden.length, 8);
  assert.equal(first.hiddenSpeakingCount, 2);
  assert.equal(first.promotedId, '4');
  // A currently highlighted hidden speaker keeps its seat while still talking.
  const stable = selectDockParticipants(people, 4, '5');
  assert.deepEqual(stable.visible.map(p => p.id), ['0', '1', '2', '5']);
  const quiet = selectDockParticipants(people.map(p => ({ ...p, speaking: false })), 4, '5');
  assert.deepEqual(quiet.visible.map(p => p.id), ['0', '1', '2', '3']);
  assert.equal(quiet.promotedId, null);
});

test('a short rail still highlights a hidden speaker and never duplicates its identity', () => {
  const selection = selectDockParticipants([person('me'), person('a'), person('b', true)], 1);
  assert.deepEqual(selection.visible.map(p => p.id), ['b']);
  assert.deepEqual(selection.hidden.map(p => p.id), ['me', 'a']);
  assert.equal(selectDockParticipants([person('a')], 0).visible.length, 0);
});

test('phone orientation and group size determine a bounded number of seats', () => {
  assert.equal(dockCapacity(760, 12), 4);
  assert.equal(dockCapacity(320, 12), 2);
  assert.equal(dockCapacity(220, 12), 1);
  assert.equal(dockCapacity(760, 2), 2);
  assert.equal(dockCapacity(760, 0), 0);
});

test('vertical dragging cannot move controls above or below their visible safe area', () => {
  assert.equal(clampDockPosition(-100, 500, 200), 0);
  assert.equal(clampDockPosition(1000, 500, 200), 300);
  assert.equal(clampDockPosition(100, 150, 200), 0);
  assert.equal(clampDockPosition(123, 500, 200), 123);
  assert.equal(clampDockPosition(Number.NaN, 500, 200), 0);
});

test('floating call bubbles default to the physical right and clamp both axes', () => {
  const bounds = { width: 390, height: 760, dockWidth: 52, dockHeight: 360 };
  assert.deepEqual(clampFloatingDockPosition({ x: null, y: 0 }, bounds), { x: 338, y: 0 });
  assert.deepEqual(clampFloatingDockPosition({ x: 110, y: 250 }, bounds), { x: 110, y: 250 });
  assert.deepEqual(clampFloatingDockPosition({ x: -100, y: -20 }, bounds), { x: 0, y: 0 });
  assert.deepEqual(clampFloatingDockPosition({ x: 1000, y: 1000 }, bounds), { x: 338, y: 400 });
  assert.deepEqual(clampFloatingDockPosition({ x: Number.NaN, y: Number.NaN }, bounds), { x: 338, y: 0 });
  assert.deepEqual(clampFloatingDockPosition({ x: 90, y: 90 }, { width: 30, height: 40, dockWidth: 52, dockHeight: 80 }), { x: 0, y: 0 });
});

test('temporary keyboard bounds do not overwrite the preferred bubble position', () => {
  const preferred = { x: 240, y: 420 };
  const portrait = { width: 390, height: 760, dockWidth: 52, dockHeight: 180 };
  const keyboard = { ...portrait, height: 320 };
  assert.deepEqual(clampFloatingDockPosition(preferred, keyboard), { x: 240, y: 140 });
  assert.deepEqual(preferred, { x: 240, y: 420 });
  assert.deepEqual(clampFloatingDockPosition(preferred, portrait), preferred);
  assert.deepEqual(clampFloatingDockPosition(preferred, { ...portrait, width: 200 }), { x: 148, y: 420 });
  assert.deepEqual(clampFloatingDockPosition(preferred, portrait), preferred);
});

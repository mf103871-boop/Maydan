import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MENU_ITEMS, menuSection, menuRouteVisible, keyboardOccupiesViewport, menuBadges } from '../src/platform/menu-navigation.js';

test('menu navigation has four ordered destinations with compatible hashes', () => {
  assert.deepEqual(MENU_ITEMS.map(item => item.path), ['/', '/friends', '/store', '/settings']);
  assert.deepEqual(MENU_ITEMS.map(item => item.label), ['الألعاب', 'الأصدقاء', 'المتجر', 'الإعدادات']);
});
test('game and room flows hide navigation, menu entry and details retain it', () => {
  for (const name of ['play', 'room', 'online', 'friend-group']) assert.equal(menuRouteVisible({ name }), false, name);
  assert.equal(menuRouteVisible({ name: 'friends', params: { id: 'alice' } }), false);
  for (const name of ['home', 'game', 'players', 'store', 'settings']) assert.equal(menuRouteVisible({ name }), true, name);
  assert.equal(menuRouteVisible({ name: 'friends' }, { presentation: 'page', view: { type: 'list' } }), true);
  assert.equal(menuRouteVisible({ name: 'friends' }, { presentation: 'page', view: { type: 'profile' } }), false);
});
test('nested menu sections highlight their owner and profile keeps its origin', () => {
  assert.equal(menuSection({ name: 'friend-group' }), 'friends');
  for (const name of ['terms', 'privacy', 'moderation', 'about']) assert.equal(menuSection({ name }), 'settings');
  assert.equal(menuSection({ name: 'game' }), 'games');
  assert.equal(menuSection({ name: 'profile' }, 'friends'), 'friends');
  assert.equal(menuSection({ name: 'profile' }, 'settings'), 'settings');
});
test('keyboard detection ignores browser chrome, hardware focus and pinch zoom', () => {
  const baseline = { layoutHeight: 844, visualHeight: 540, editable: true };
  assert.equal(keyboardOccupiesViewport(baseline), true);
  assert.equal(keyboardOccupiesViewport({ ...baseline, visualHeight: 790 }), false);
  assert.equal(keyboardOccupiesViewport({ ...baseline, editable: false }), false);
  assert.equal(keyboardOccupiesViewport({ ...baseline, scale: 1.5 }), false);
  assert.equal(keyboardOccupiesViewport({ ...baseline, visualHeight: 0 }), false);
  assert.equal(keyboardOccupiesViewport({ ...baseline, editable: false, previouslyVisible: true }), true);
  assert.equal(keyboardOccupiesViewport({ ...baseline, visualHeight: 844, previouslyVisible: true }), false);
});
test('badges combine direct and group unread while guests cannot see cached counts', () => {
  const social = { unreadCount: 3, incoming: [{ id: 'request-1' }] };
  const lamma = { groups: [{ unreadCount: 4 }, { unreadCount: -1 }], groupInvites: [{ id: 'invite-1' }] };
  assert.deepEqual(menuBadges(social, lamma, true), { unread: 7, requests: 2 });
  assert.deepEqual(menuBadges(social, lamma, false), { unread: 0, requests: 0 });
});

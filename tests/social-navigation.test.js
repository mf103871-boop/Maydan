import test from 'node:test';
import assert from 'node:assert/strict';
import { socialListTab, socialPagePath, socialPageView, usesSocialDrawer } from '../src/social/social-navigation.js';

test('modern social links distinguish friend and group identifiers', () => {
  assert.deepEqual(socialPageView({ name: 'friends', params: {} }, 'groups'), { type: 'list', tab: 'groups' });
  assert.deepEqual(socialPageView({ name: 'friends', params: { id: 'friend_1' } }), { type: 'direct', id: 'friend_1' });
  assert.deepEqual(socialPageView({ name: 'friend-group', params: { id: 'group_1' } }), { type: 'group', id: 'group_1' });
  assert.equal(socialPageView({ name: 'settings' }), null);
  assert.equal(socialPagePath({ type: 'direct', id: 'friend_1' }), '/friends/friend_1');
  assert.equal(socialPagePath({ type: 'group', id: 'group_1' }), '/friends/group/group_1');
  assert.equal(socialPagePath({ type: 'profile', id: 'friend_1' }), '/friends');
  assert.equal(socialListTab('invalid'), 'friends');
});

test('only screens that own a match open an interruption drawer', () => {
  for (const name of ['play', 'room']) assert.equal(usesSocialDrawer({ name }), true);
  for (const name of ['home', 'game', 'online', 'friends', 'friend-group', 'store', 'settings']) assert.equal(usesSocialDrawer({ name }), false);
});

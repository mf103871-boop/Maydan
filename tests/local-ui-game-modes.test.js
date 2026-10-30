import test from 'node:test';
import assert from 'node:assert/strict';
import { GAME_MODE_SUPPORT, getGameModeSupport } from '../src/shared/game-mode-support.mjs';
import { ONLINE_GAMES } from '../src/online/shared.js';
import { gameModePath, resolveGameMode, gameInstructionsNextPath } from '../src/platform/game-mode-navigation.js';

test('mode support uses actual online bounds and explicit unsupported local capabilities', () => {
  assert.equal(Object.keys(GAME_MODE_SUPPORT).length, 8);
  assert.ok(Object.isFrozen(GAME_MODE_SUPPORT));
  for (const [id, support] of Object.entries(GAME_MODE_SUPPORT)) {
    assert.ok(Object.isFrozen(support));
    assert.equal(typeof support.online, 'boolean');
    assert.equal(typeof support.local, 'boolean');
    assert.ok(['players', 'teams'].includes(support.unit));
    if (support.online) {
      assert.equal(support.onlineMin, ONLINE_GAMES[id].min);
      assert.equal(support.onlineMax, ONLINE_GAMES[id].max);
    } else assert.deepEqual([support.onlineMin, support.onlineMax], [null, null]);
  }
  assert.equal(getGameModeSupport('badeeha').unit, 'teams');
  for (const id of ['mafia', 'ersomha']) assert.equal(getGameModeSupport(id).local, false);
  for (const id of ['beep', 'mamnoo', 'jabeen']) assert.equal(getGameModeSupport(id).online, false);
  for (const id of ['badeeha', 'fabraka', 'meenfina']) assert.equal(getGameModeSupport(id).local, true);
  assert.equal(getGameModeSupport('__proto__'), null);
  assert.equal(getGameModeSupport('unknown'), null);
});

test('mode selection and skipping instructions preserve the game and never invent unsupported routes', () => {
  for (const [id, support] of Object.entries(GAME_MODE_SUPPORT)) {
    if (support.local) {
      assert.equal(gameModePath(id, 'local'), `/game/${id}?mode=local`);
      assert.equal(gameInstructionsNextPath(id, 'local'), `/play/${id}?mode=local`);
    } else {
      assert.equal(gameModePath(id, 'local'), null);
      assert.equal(gameInstructionsNextPath(id, 'local'), null);
    }
    if (support.online) {
      assert.equal(gameModePath(id, 'online'), `/online/${id}?mode=online`);
      assert.equal(gameInstructionsNextPath(id, 'online'), `/online/${id}?mode=online`);
    } else {
      assert.equal(gameModePath(id, 'online'), null);
      assert.equal(gameInstructionsNextPath(id, 'online'), null);
    }
    assert.equal(resolveGameMode(id), support.local ? 'local' : 'online');
  }
  for (const mode of ['__proto__', 'both', '', null]) assert.equal(gameModePath('beep', mode), null);
  assert.equal(gameInstructionsNextPath('unknown', 'local'), null);
});

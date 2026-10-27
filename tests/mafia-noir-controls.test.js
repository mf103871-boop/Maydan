import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasVisibleMafiaCallControls } from '../src/social/mafia-call-controls.js';

function controls({ id = 'call-a', ready = 'true', connected = true, visible = true, hidden = false, style = {}, parentElement = null } = {}) {
  return { isConnected: connected, getAttribute: key => key === 'data-mafia-call-controls' ? id : ready,
    style, parentElement,
    closest: () => hidden ? {} : null, getClientRects: () => visible ? [{}] : [] };
}
const doc = (...nodes) => ({ querySelectorAll: () => nodes, defaultView: { getComputedStyle: node => node.style || {} } });
const call = { id: 'call-a', scope: 'mafia' };
test('Mafia integrated controls replace only their exact active call, never another game/social call', () => {
  assert.equal(hasVisibleMafiaCallControls(doc(controls()), call), true);
  assert.equal(hasVisibleMafiaCallControls(doc(controls()), { ...call, id: 'call-b' }), false);
  assert.equal(hasVisibleMafiaCallControls(doc(controls()), { ...call, scope: 'group' }), false);
  assert.equal(hasVisibleMafiaCallControls(doc(controls()), null), false);
});
test('invisible Studio overrides never remove global escape controls even when layout boxes remain', () => {
  for (const style of [{ visibility: 'hidden' }, { visibility: 'collapse' }, { opacity: '0' }]) {
    assert.equal(hasVisibleMafiaCallControls(doc(controls({ style })), call), false);
    assert.equal(hasVisibleMafiaCallControls(doc(controls({ parentElement: { style } })), call), false);
  }
  assert.equal(hasVisibleMafiaCallControls(doc(controls({ style: { opacity: '0.75', visibility: 'visible' } })), call), true);
});
test('global disconnect controls survive stale, missing, unready or hidden game UI', () => {
  for (const options of [{ connected: false }, { ready: 'false' }, { visible: false }, { hidden: true }]) {
    assert.equal(hasVisibleMafiaCallControls(doc(controls(options)), call), false, JSON.stringify(options));
  }
  assert.equal(hasVisibleMafiaCallControls(doc(), call), false);
  assert.equal(hasVisibleMafiaCallControls(null, call), false);
  assert.equal(hasVisibleMafiaCallControls(doc(controls({ id: 'old-call' }), controls()), call), true);
});

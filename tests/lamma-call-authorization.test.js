import test from 'node:test';
import assert from 'node:assert/strict';
import { createCallAuthorization } from '../src/social/call-authorization.js';

const validCall = deviceId => ({ status: 'active', participants: [{ userId: 'alice', state: 'active', deviceId }] });
test('suspension and explicit authorization revocation terminate immediately', () => {
  const authorization = createCallAuthorization();
  for (const code of ['ACCOUNT_SUSPENDED', 'BLOCKED', 'AUTH_EXPIRED', 'CALL_FORBIDDEN']) {
    assert.equal(authorization.failure({ code }), 'authorization-revoked');
  }
});
test('two failed checks close the call at sixty seconds even while the next request is pending', () => {
  let now = 0; const authorization = createCallAuthorization({ now: () => now });
  now = 5000; assert.equal(authorization.failure({ code: 'NETWORK' }), null);
  now = 30000; assert.equal(authorization.failure({ code: 'UNAVAILABLE', status: 503 }), null);
  now = 59999; assert.equal(authorization.expired(), false);
  now = 60000; assert.equal(authorization.expired(), true);
});
test('a successful authorized check resets the network failure grace period', () => {
  let now = 0; const authorization = createCallAuthorization({ now: () => now });
  authorization.failure({ code: 'NETWORK' }); authorization.failure({ code: 'NETWORK' });
  now = 45000; assert.equal(authorization.response(validCall('phone'), 'alice', 'phone'), null);
  now = 65000; assert.equal(authorization.expired(), false);
  authorization.failure({ code: 'NETWORK' }); authorization.failure({ code: 'NETWORK' });
  now = 104999; assert.equal(authorization.expired(), false);
  now = 105000; assert.equal(authorization.expired(), true);
});
test('ownership lost to another device has a distinct local-only termination reason', () => {
  const authorization = createCallAuthorization();
  assert.equal(authorization.response(validCall('other-phone'), 'alice', 'phone'), 'ownership-lost');
  assert.equal(authorization.response({ status: 'active', participants: [] }, 'alice', 'phone'), 'authorization-revoked');
  assert.equal(authorization.response({ ...validCall('phone'), status: 'ended' }, 'alice', 'phone'), 'call-ended');
});

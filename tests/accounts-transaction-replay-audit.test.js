import test from 'node:test';
import assert from 'node:assert/strict';
import { deliverAppleTransaction } from '../src/shared/account/purchases.js';

for (const code of ['ALREADY_LINKED', 'NOT_ELIGIBLE', 'NETWORK']) {
  test(`a ${code} response cannot discard an uncredited StoreKit transaction`, async () => {
    let pending = true, applied = false;
    const acknowledge = async () => { pending = false; };
    await assert.rejects(deliverAppleTransaction('verified-receipt-A', {
      submit: async () => { throw Object.assign(new Error(code), { code }); },
      apply: () => { applied = true; }, acknowledge,
    }), { code });
    assert.equal(pending, true, 'the rightful account/environment must retain automatic replay');
    assert.equal(applied, false);
    const order = [];
    await deliverAppleTransaction('verified-receipt-A', {
      submit: async () => { order.push('persist-for-A'); return { premium: { active: true } }; },
      apply: () => order.push('apply-for-A'),
      acknowledge: async () => { order.push('finish'); await acknowledge(); },
    });
    assert.deepEqual(order, ['persist-for-A', 'apply-for-A', 'finish']);
    assert.equal(pending, false);
  });
}

test('a verified response whose owner fence rejects application remains unfinished', async () => {
  let finished = false;
  await assert.rejects(deliverAppleTransaction('verified-receipt-A', {
    submit: async () => ({}),
    apply: () => { throw Object.assign(new Error('Account changed'), { code: 'STALE_ACCOUNT' }); },
    acknowledge: async () => { finished = true; },
  }), { code: 'STALE_ACCOUNT' });
  assert.equal(finished, false);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createAndroidRewardedClient, isAndroidRewardedShell } from '../src/shared/account/android-rewarded.js';

function fixture(t) {
  const sent = [];
  const host = { MaydanRewarded: { postMessage: text => sent.push(JSON.parse(text)) } };
  const client = createAndroidRewardedClient({ getHost: () => host });
  t.after(() => client.dispose());
  const reply = (index, result) => host.MaydanRewarded.onmessage({
    data: JSON.stringify({ id: sent[index].id, ok: true, result }),
  });
  return { client, host, sent, reply };
}

test('Android Rewarded never treats the iOS bridge as its transport', async () => {
  assert.equal(isAndroidRewardedShell({ MaydanNative: { postMessage() {} } }), false);
  const client = createAndroidRewardedClient({ getHost: () => ({ MaydanNative: {} }) });
  assert.deepEqual(await client.call('rewardedStatus'), { state: 'unavailable', presented: false });
});

test('Android display sends the opaque attempt only and returns pending without granting access', async t => {
  const { client, sent, reply } = fixture(t);
  const attempt = { customData: 'a'.repeat(64), adUnit: 'test-unit', expiresAt: Date.now() + 60000,
    authorization: 'never-forward-session', accountId: 'never-forward-account' };
  const result = client.call('rewardedShow', attempt);
  assert.deepEqual(Object.keys(sent[0]).sort(), ['adUnit', 'customData', 'expiresAt', 'id', 'type']);
  reply(0, { state: 'pending', presented: true });
  assert.deepEqual(await result, { state: 'pending', presented: true });
});

test('late replies after account ownership changes cannot resolve the new account request', async t => {
  const { client, reply } = fixture(t);
  let owner = 'first';
  const request = client.call('rewardedStatus', {}, { isCurrent: () => owner === 'first' });
  owner = 'second';
  reply(0, { state: 'ready', presented: false });
  await assert.rejects(request, error => error.code === 'NOT_ELIGIBLE');
});

test('aborting an Android load asks native to retire that request without claiming a reward', async t => {
  const { client, sent, reply } = fixture(t);
  const control = new AbortController();
  const request = client.call('rewardedShow', {}, { signal: control.signal });
  const original = sent[0].id;
  control.abort();
  await assert.rejects(request, error => error.code === 'NOT_ELIGIBLE');
  assert.equal(sent[1].type, 'rewardedCancel');
  assert.equal(sent[1].targetId, original);
  reply(0, { state: 'pending', presented: true });
});

test('status and privacy use the Android namespace and reject malformed native results', async t => {
  const { client, sent, reply } = fixture(t);
  const status = client.call('rewardedStatus', {}, { timeout: 1000 });
  reply(0, { state: 'ready', presented: false, privacyOptionsRequired: true });
  assert.equal((await status).privacyOptionsRequired, true);
  const privacy = client.call('rewardedPrivacyOptions');
  assert.equal(sent[1].type, 'rewardedPrivacyOptions');
  reply(1, { state: 'granted', presented: true, ticket: 1 });
  await assert.rejects(privacy, error => error.code === 'REWARDED_UNAVAILABLE');
});

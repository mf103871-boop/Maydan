// Imported only by the loopback Node harness. The Worker has no route for this.
import { requireSession } from '../accounts/session.mjs';
import { json, readJson } from '../protocol.mjs';
import { RoomError, fail } from '../room-model.mjs';
import { LOCAL_REWARDED_UNIT, REWARDED_ITEM, verifyRewardedAttempt } from './attempts.mjs';
import { assertRewardedAccount, rewardedEnvironment, rewardedMatchId } from './ledger.mjs';

export async function routeLocalReward(request, env, url = new URL(request.url)) {
  if (url.pathname !== '/__rewarded_lab__/complete') return null;
  if (request.method !== 'POST' || rewardedEnvironment(env) !== 'local' || env.REWARDED_LOCAL_NATIVE === '1' ||
      url.origin !== env.APP_ORIGIN || request.headers.get('origin') !== env.APP_ORIGIN) {
    return json({ error: 'REWARDED_UNAVAILABLE' }, 404);
  }
  try {
    const { user } = await requireSession(env, request, { rotate: false });
    await assertRewardedAccount(env, user.id);
    const { attemptId } = await readJson(request, 512);
    if (!rewardedMatchId(attemptId)) fail('INVALID');
    return json(await verifyRewardedAttempt(env, {
      environment: 'local', userId: user.id, attemptId, adUnit: LOCAL_REWARDED_UNIT, rewardItem: REWARDED_ITEM,
      timestamp: Date.now(), transactionId: `local-${attemptId}`,
    }));
  } catch (error) {
    return error instanceof RoomError ? json({ error: error.code }, error.status) : json({ error: 'INTERNAL' }, 500);
  }
}

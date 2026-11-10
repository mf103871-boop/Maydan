import { requireSession } from '../accounts/session.mjs';
import { json, readJson, sha256 } from '../protocol.mjs';
import { RoomError, fail } from '../room-model.mjs';
import { verifyAdMobCallback, verifyAdMobPreviewSetup } from './admob-ssv.mjs';
import { cancelRewardedAttempt, issueRewardedAttempt, REWARDED_ITEM, rewardedStatus, rewardedTransport, verifyRewardedAttempt } from './attempts.mjs';
import { assertRewardedAccount, rewardedEnvironment, rewardedMatchId, rewardedOffers, startRewardedLocalMatch } from './ledger.mjs';
import { hostedRewardedSettings, matchesRewardedUnit, rewardedOrigin, REWARDED_PREVIEW_QA_UNIT, validRewardedPreviewSetupExpiry } from './settings.mjs';

const ROOT = '/api/rewarded/';
const verifyDashboard = url => Promise.any(['test', 'production'].map(keys => verifyAdMobCallback(url, keys)))
  .catch(() => fail('REWARDED_SIGNATURE', 400));

export async function routeRewarded(request, env, url = new URL(request.url)) {
  if (!url.pathname.startsWith(ROOT)) return null;
  const environment = rewardedEnvironment(env);
  if (!environment || url.origin !== rewardedOrigin(env, environment)) return json({ error: 'REWARDED_UNAVAILABLE' }, 404);
  const path = url.pathname.slice(ROOT.length);
  const method = request.method;
  if (path === 'config' && method === 'GET') {
    if (environment === 'ios-preview') {
      const { user } = await requireSession(env, request);
      await assertRewardedAccount(env, user.id);
    }
    return json({ offers: rewardedOffers, mode: rewardedTransport(env, environment) });
  }
  const cancellation = method === 'POST' && /^attempt\/([a-f\d-]+)\/cancel$/.exec(path);
  if (!(method === 'GET' && path === 'status') && !(method === 'POST' && ['attempt','local-start'].includes(path)) && !cancellation) {
    return json({ error: 'REWARDED_UNAVAILABLE' }, 404);
  }

  const { user, session } = await requireSession(env, request);
  const client = session.client === 'ios' && request.headers.get('origin') === 'maydan://app' ? 'ios' : 'web';
  if (path === 'status') return json(await rewardedStatus(env, user.id, url.searchParams.get('offer'), client));
  if (cancellation) {
    if (!rewardedMatchId(cancellation[1])) fail('INVALID');
    await assertRewardedAccount(env, user.id);
    await cancelRewardedAttempt(env, environment, user.id, cancellation[1]);
    return json({ cancelled: true });
  }

  const input = await readJson(request, 512);
  if (path === 'attempt') return json(await issueRewardedAttempt(env, user.id, input.offer, client), 201);
  const claim = { offer: input.offer, matchId: input.matchId, userId: user.id };
  // An interrupted response must retry the same already prepared local match ID.
  return json(await startRewardedLocalMatch(env, claim));
}

export async function rewardedWebhook(request, env, url = new URL(request.url), charge = null) {
  // No browser session or Origin here. Only a Google-signed callback can earn a
  // ticket and a disabled new-ad switch must not discard an in-flight reward.
  const environment = rewardedEnvironment(env);
  const settings = hostedRewardedSettings(env, environment);
  if (request.method !== 'GET' || url.origin !== rewardedOrigin(env, environment) || settings?.keys !== 'production') {
    return json({ error: 'REWARDED_UNAVAILABLE' }, 404);
  }
  try {
    if (charge) await charge('webhook');
    const customData = url.searchParams.get('custom_data');
    if (!/^[a-f\d]{64}$/.test(customData || '')) fail('REWARDED_SIGNATURE', 400);
    const customHash = await sha256(customData);
    if (customHash === env.REWARDED_SSV_SETUP_TOKEN_SHA256) {
      // URL setup has its own challenge and never writes the reward ledger.
      const preview = environment === 'ios-preview';
      if (preview && (env.REWARDED_ADS_ENABLED !== '0' || settings.unit !== REWARDED_PREVIEW_QA_UNIT ||
          !validRewardedPreviewSetupExpiry(env.REWARDED_SSV_SETUP_EXPIRES_AT))) fail('REWARDED_UNAVAILABLE', 404);
      const signed = await (preview ? verifyAdMobPreviewSetup(request.url) : verifyDashboard(request.url));
      if ((!preview && !matchesRewardedUnit(signed.adUnit, settings.unit)) || signed.rewardItem !== REWARDED_ITEM) {
        fail('REWARDED_REWARD', 400);
      }
      if (Math.abs(Date.now() - signed.timestamp) > 5 * 60_000) fail('REWARDED_ATTEMPT', 409);
      return json({ verified: true, mode: 'setup' });
    }
    const signed = await verifyAdMobCallback(request.url, settings.keys);
    return json(await verifyRewardedAttempt(env, {
      ...signed, customHash, environment,
    }));
  } catch (error) {
    // Do not send callback URL, token, transaction ID or SQL errors to logs.
    return error instanceof RoomError ? json({ error: error.code }, error.status) : json({ error: 'INTERNAL' }, 500);
  }
}

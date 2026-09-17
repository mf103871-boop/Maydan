// Permanent Live webhook ingress. The public game keeps its own billing environment.
import { routeAccounts } from './accounts/router.mjs';
import { json, errorResponse } from './protocol.mjs';

const PRICE_ID = /^pri_[a-z\d]{26}$/;

function ready(env) {
  return env.PADDLE_ENV === 'production'
    && typeof env.DB?.prepare === 'function'
    && typeof env.PADDLE_PRICE_MONTHLY === 'string'
    && PRICE_ID.test(env.PADDLE_PRICE_MONTHLY)
    && typeof env.PADDLE_WEBHOOK_SECRET === 'string'
    && env.PADDLE_WEBHOOK_SECRET.trim().length > 0;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const health = url.pathname === '/health'
      && ['GET', 'HEAD'].includes(request.method);
    const webhook = url.pathname === '/api/paddle/webhook'
      && request.method === 'POST';
    // Never expose checkout, configuration, authentication, account or asset routes.
    if (!health && !webhook) return json({ error: 'NOT_FOUND' }, 404);
    // An environment typo must not disable the production IP allowlist.
    if (!ready(env)) return json({ error: 'NOT_READY' }, 503);
    if (health) return request.method === 'HEAD'
      ? new Response(null, { status: 200, headers: { 'cache-control': 'no-store' } })
      : json({ ok: true, checkoutEnabled: false });
    try {
      // Keep the original request/body intact for IP validation and Paddle HMAC.
      return await routeAccounts(request, env, url);
    } catch (error) {
      return errorResponse(error);
    }
  },
};

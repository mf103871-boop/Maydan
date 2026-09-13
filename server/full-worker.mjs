// One Cloudflare origin serves the game, assets, and room API.
import { routeRequest } from './worker.mjs';
export { Room, RequestLimiter } from './worker.mjs';

export default {
  fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api' || url.pathname.startsWith('/api/') || url.pathname === '/health') {
      return routeRequest(request, { ...env, ALLOWED_ORIGINS: url.origin });
    }
    return env.ASSETS.fetch(request);
  },
};

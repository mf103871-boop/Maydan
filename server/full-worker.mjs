// One Cloudflare origin serves the game, assets, and room API.
import { routeRequest, scheduled } from './worker.mjs';
export { Room, RequestLimiter } from './worker.mjs';

// The page is one self-contained document: inline script and styles, images and
// audio from this origin, data:/blob: URLs, and question media that may be hosted
// elsewhere over https. Everything else is refused, and the page may not be framed.
// Paddle.js is the one third-party script (web checkout only, lazily loaded), and
// it draws its checkout inside an iframe from buy.paddle.com / sandbox-buy.paddle.com.
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://cdn.paddle.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "media-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https: wss:",
  "frame-src 'self' https://*.paddle.com",
  "worker-src 'self'",
  "manifest-src 'self'",
  "base-uri 'none'",
  "object-src 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');
const SECURITY_HEADERS = {
  'content-security-policy': CONTENT_SECURITY_POLICY,
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'same-origin',
};
// workerd only accepts function exports from the entry module, so the policy is
// read through a helper instead of exported as a constant.
export function securityHeaders() { return { ...SECURITY_HEADERS }; }
export function secured(response) {
  // 101/204/304 carry no body to protect and must keep their exact headers.
  if (response.status === 101 || response.status === 304) return response;
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) headers.set(key, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api' || url.pathname.startsWith('/api/') || url.pathname === '/health') {
      // أصل الموقع نفسه دائمًا مسموح، ويُضاف إليه EXTRA_ORIGINS (مخطط تطبيق iOS مثلًا).
      const extra = String(env.EXTRA_ORIGINS || '').split(',').map((value) => value.trim()).filter(Boolean);
      return routeRequest(request, { ...env, ALLOWED_ORIGINS: [url.origin, ...extra].join(',') });
    }
    return secured(await env.ASSETS.fetch(request));
  },
  scheduled,
};

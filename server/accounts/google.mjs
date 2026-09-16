// جوجل: تدفق code على الويب، والتحقق من id_token عبر JWKS. لا نطلب أي نطاق غير openid/email/profile.
import { failure } from './errors.mjs';
import { providerFetch, verifyJwt } from './jwt.mjs';

export const ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
export const urls = (env) => ({
  authorize: env.GOOGLE_AUTH_URL || 'https://accounts.google.com/o/oauth2/v2/auth',
  token: env.GOOGLE_TOKEN_URL || 'https://oauth2.googleapis.com/token',
  jwks: env.GOOGLE_JWKS_URL || 'https://www.googleapis.com/oauth2/v3/certs',
});
export const configured = (env) => !!env.GOOGLE_CLIENT_ID;

export function authorizeUrl(env, { redirectUri, state, nonce }) {
  if (!env.GOOGLE_CLIENT_ID) failure('NOT_ELIGIBLE');
  const query = new URLSearchParams({
    response_type: 'code', client_id: env.GOOGLE_CLIENT_ID, redirect_uri: redirectUri,
    scope: 'openid email profile', state, nonce, prompt: 'select_account',
  });
  return `${urls(env).authorize}?${query}`;
}

export async function exchangeCode(env, { code, redirectUri }) {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) failure('NOT_ELIGIBLE');
  const body = new URLSearchParams({
    grant_type: 'authorization_code', code, redirect_uri: redirectUri,
    client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET,
  });
  const result = await providerFetch(urls(env).token, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: String(body),
  });
  if (!result.ok || !result.data?.id_token) failure('PROVIDER');
  return result.data;
}

export async function verifyIdentityToken(env, token, { nonce, now = Date.now() } = {}) {
  const payload = await verifyJwt(token, { jwksUrl: urls(env).jwks, issuer: undefined, audience: env.GOOGLE_CLIENT_ID, nonce, now });
  if (!ISSUERS.includes(payload.iss)) failure('SIGNATURE');
  if (!payload.sub) failure('SIGNATURE');
  return payload;
}
// نأخذ البريد فقط إن أكّدته جوجل، ولا نخزّن صورة ولا أي حقل آخر.
export function profileOf(payload) {
  return { subject: payload.sub, name: payload.name || null, email: payload.email_verified === false ? null : (payload.email || null) };
}

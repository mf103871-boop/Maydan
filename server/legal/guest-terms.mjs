import { base64url } from '../accounts/jwt.mjs';
import { fail } from '../room-model.mjs';
import { isCurrentTermsAcceptance, termsIdentity } from '../../src/shared/legal/terms.js';
import { GUEST_TERMS_PREFIX, GUEST_TERMS_PURPOSE, GUEST_TERMS_TTL, parseGuestTermsReceipt, termsApiOrigin } from '../../src/shared/legal/guest-receipt.js';

const encoder = new TextEncoder();
async function signingKey(env, usage) {
  // No OAuth state helper or development fallback: different purpose/lifetime.
  if (typeof env.SESSION_SECRET !== 'string' || !env.SESSION_SECRET.trim()) fail('TERMS_UNAVAILABLE', 503);
  return crypto.subtle.importKey('raw', encoder.encode(env.SESSION_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, [usage]);
}
export async function issueGuestTermsReceipt(env, request, identity, now = Date.now()) {
  const audience = termsApiOrigin(request.url);
  if (!audience || !isCurrentTermsAcceptance(identity) || !Number.isSafeInteger(now) || now <= 0) fail('INVALID', 400);
  const value = { ...termsIdentity(identity.locale), purpose: GUEST_TERMS_PURPOSE, audience, issuedAt: now, expiresAt: now + GUEST_TERMS_TTL };
  const body = `${GUEST_TERMS_PREFIX}.${base64url(JSON.stringify(value))}`;
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', await signingKey(env, 'sign'), encoder.encode(body)));
  return `${body}.${Array.from(signature, byte => byte.toString(16).padStart(2, '0')).join('')}`;
}
export async function verifyGuestTermsReceipt(env, request, receipt, now = Date.now()) {
  const parsed = parseGuestTermsReceipt(receipt, request.url, now);
  if (!parsed) return null;
  const signature = Uint8Array.from(parsed.signature.match(/../g), hex => parseInt(hex, 16));
  if (!(await crypto.subtle.verify('HMAC', await signingKey(env, 'verify'), signature, encoder.encode(parsed.signingInput)))) return null;
  return { ...termsIdentity(parsed.value.locale), acceptedAt: parsed.value.issuedAt, expiresAt: parsed.value.expiresAt };
}

import { isCurrentTermsAcceptance } from './terms.js';

export const GUEST_TERMS_PURPOSE = 'maydan-guest-terms-v1';
export const GUEST_TERMS_TTL = 180 * 24 * 60 * 60 * 1000;
export const GUEST_TERMS_HEADER = 'x-maydan-terms';
export const GUEST_TERMS_PREFIX = 'mgt1';
export function termsApiOrigin(value) {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.origin : null;
  } catch { return null; }
}
// Parsing is NOT signature verification. The client uses this only to avoid
// sending stale/cross-environment receipts; the Worker verifies HMAC separately.
export function parseGuestTermsReceipt(receipt, apiOrigin, now = Date.now()) {
  if (typeof receipt !== 'string' || receipt.length > 2048 || !Number.isSafeInteger(now)) return null;
  const parts = receipt.split('.');
  if (parts.length !== 3 || parts[0] !== GUEST_TERMS_PREFIX || !/^[A-Za-z0-9_-]+$/.test(parts[1]) || !/^[a-f0-9]{64}$/.test(parts[2])) return null;
  try {
    const encoded = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(encoded + '='.repeat((4 - encoded.length % 4) % 4));
    const canonical = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    if (canonical !== parts[1]) return null;
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(binary, c => c.charCodeAt(0))));
    const origin = termsApiOrigin(apiOrigin);
    if (!origin || !isCurrentTermsAcceptance(value) || value.purpose !== GUEST_TERMS_PURPOSE || value.audience !== origin
      || !Number.isSafeInteger(value.issuedAt) || value.issuedAt <= 0 || value.issuedAt > now + 60_000
      || !Number.isSafeInteger(value.expiresAt) || value.expiresAt !== value.issuedAt + GUEST_TERMS_TTL || value.expiresAt <= now) return null;
    return { value, signingInput: `${parts[0]}.${parts[1]}`, signature: parts[2] };
  } catch { return null; }
}

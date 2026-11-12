import { isCurrentTermsAcceptance, termsIdentity } from './terms.js';
import { parseGuestTermsReceipt, termsApiOrigin } from './guest-receipt.js';

export const LOCAL_TERMS_KEY = 'maydan:legal:guest-acceptance-v1';
const storageOrNull = () => { try { return globalThis.localStorage || null; } catch { return null; } };
// Local acceptance is a pending user choice, never account/server evidence.
export function readLocalTermsAcceptance(storage = storageOrNull()) {
  try {
    const value = JSON.parse(storage?.getItem(LOCAL_TERMS_KEY) || 'null');
    return isCurrentTermsAcceptance(value) && value.accepted === true && Number.isSafeInteger(value.acceptedAtClient)
      && value.acceptedAtClient > 0 ? value : null;
  } catch { return null; }
}
export function saveLocalTermsAcceptance(input, storage = storageOrNull(), now = Date.now()) {
  if (!isCurrentTermsAcceptance(input) || input.accepted !== true || !Number.isSafeInteger(now) || now <= 0) return null;
  const value = { ...termsIdentity(input.locale), accepted: true, acceptedAtClient: now };
  try { storage?.setItem(LOCAL_TERMS_KEY, JSON.stringify(value)); return readLocalTermsAcceptance(storage); } catch { return null; }
}
export function clearLocalTermsAcceptance(storage = storageOrNull()) {
  try { storage?.removeItem(LOCAL_TERMS_KEY); } catch { /* Optional local storage. */ }
}
export function localTermsAcceptPayload(value) {
  return isCurrentTermsAcceptance(value) && value.accepted === true ? { ...termsIdentity(value.locale), accepted: true } : null;
}

const receiptKey = (origin, identity) => `maydan:legal:receipt:${encodeURIComponent(origin)}:${identity.termsVersion}:${identity.locale}:${identity.documentHash}`;
// Browser-session fallback when storage is denied. These are actual server
// receipts, never manufactured local consent; the same identity/expiry checks
// apply. Nothing here claims persistence across a reload or a device restart.
const sessionReceipts = new Map();
export function saveGuestTermsReceipt(apiOrigin, response, storage = storageOrNull(), now = Date.now()) {
  const receipt = typeof response === 'string' ? response : response?.guestReceipt;
  const parsed = parseGuestTermsReceipt(receipt, apiOrigin, now);
  if (!parsed) return null;
  const key = receiptKey(termsApiOrigin(apiOrigin), parsed.value);
  sessionReceipts.delete(key);
  sessionReceipts.set(key, receipt);
  while (sessionReceipts.size > 16) sessionReceipts.delete(sessionReceipts.keys().next().value);
  try {
    storage?.setItem(key, receipt);
  } catch { /* The verified-format receipt stays only in this browser session. */ }
  return receipt;
}
export function getGuestTermsReceipt(apiOrigin, storage = storageOrNull(), now = Date.now()) {
  const origin = termsApiOrigin(apiOrigin);
  if (!origin) return null;
  for (const locale of ['ar', 'en']) {
    const key = receiptKey(origin, termsIdentity(locale));
    let value;
    try { value = storage?.getItem(key); } catch { /* Use an actual session receipt, if available. */ }
    if (parseGuestTermsReceipt(value, origin, now)) return value;
    const memory = sessionReceipts.get(key);
    if (parseGuestTermsReceipt(memory, origin, now)) return memory;
    sessionReceipts.delete(key);
  }
  return null;
}

import { ClientError } from '../../online/client.js';
import { isPremium } from './entitlements.js';

// Checkout completion precedes webhook delivery. Only the server can confirm access.
export async function waitForEntitlement(refresh, { attempts = 10, delayMs = 1500, wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const me = await refresh();
    if (isPremium(me) && me.premium.active && me.premium.source === 'paddle') return me;
    if (attempt + 1 < attempts) await wait(delayMs);
  }
  throw new ClientError('ACTIVATION_PENDING');
}

// A transaction bound to another account, or from the other environment, can never be
// accepted later: finish it so StoreKit stops replaying it on every launch.
export const TERMINAL_TRANSACTION_ERRORS = ['ALREADY_LINKED', 'NOT_ELIGIBLE'];
// A failed server request must leave the StoreKit transaction unfinished for retry.
export async function deliverAppleTransaction(jws, { submit, apply, acknowledge }) {
  let next;
  try { next = await submit(jws); }
  catch (error) {
    if (TERMINAL_TRANSACTION_ERRORS.includes(error && error.code)) { try { await acknowledge(jws); } catch { /* replayed */ } }
    throw error;
  }
  apply(next);
  try { await acknowledge(jws); } catch { /* StoreKit replays the unfinished transaction. */ }
  return next;
}

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

// A rejected receipt may still need delivery to its rightful account/environment.
// Even ALREADY_LINKED does not prove an entitlement was persisted: it can be an
// early appAccountToken mismatch. Finish only after successful server delivery.
export async function deliverAppleTransaction(jws, { submit, apply, acknowledge }) {
  const next = await submit(jws);
  apply(next);
  try { await acknowledge(jws); } catch { /* StoreKit replays the unfinished transaction. */ }
  return next;
}

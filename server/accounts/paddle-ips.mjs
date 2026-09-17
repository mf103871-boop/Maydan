// Additional webhook protection. The raw-body Paddle signature is still required.
// CF-Connecting-IP is trusted only at the direct Cloudflare ingress; do not use
// client-controlled forwarding headers or place an untrusted proxy in front of it.
import { RoomError } from './errors.mjs';

export const PADDLE_IPS_URL = 'https://api.paddle.com/ips';
export const PADDLE_IPS_TTL_MS = 60 * 60 * 1000;
export const PADDLE_IPS_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const TIMEOUT_MS = 1500;
const RETRY_MS = 30_000;
const UNKNOWN_RETRY_MS = 5 * 60 * 1000;

function ipv4(value) {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d{0,2})(?:\.(?:0|[1-9]\d{0,2})){3}$/.test(value)) return null;
  return value.split('.').every(part => Number(part) <= 255) ? value : null;
}

function addressesOf(payload) {
  const cidrs = payload?.data?.ipv4_cidrs;
  if (!Array.isArray(cidrs) || !cidrs.length || cidrs.length > 256) throw new Error('Invalid Paddle IP list');
  const addresses = new Set();
  for (const cidr of cidrs) {
    // Paddle currently publishes individual IPv4 /32s. Unexpected wider
    // networks must be reviewed, not silently trusted as a larger allowlist.
    if (typeof cidr !== 'string' || !cidr.endsWith('/32')) throw new Error('Invalid Paddle IP range');
    const address = ipv4(cidr.slice(0, -3));
    if (!address) throw new Error('Invalid Paddle IP address');
    addresses.add(address);
  }
  return addresses;
}

// Each factory owns its cache. Injection is for local tests; production never
// accepts a URL override, API key, allowlist or bypass from request/env data.
export function createPaddleWebhookIpGuard({
  fetchImpl = (...args) => globalThis.fetch(...args),
  now = Date.now,
  timeoutMs = TIMEOUT_MS,
  ttlMs = PADDLE_IPS_TTL_MS,
  maxStaleMs = PADDLE_IPS_MAX_AGE_MS,
} = {}) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs >= 2000
    || !Number.isFinite(ttlMs) || ttlMs <= 0
    || !Number.isFinite(maxStaleMs) || maxStaleMs < ttlMs) throw new TypeError('Invalid Paddle IP cache policy');
  let snapshot = null;
  let inFlight = null;
  let attemptedAt = -Infinity;

  const age = () => snapshot ? Math.max(0, now() - snapshot.fetchedAt) : Infinity;

  async function fetchSnapshot() {
    const controller = new AbortController();
    let timer;
    // The deadline also covers reading/parsing the body, including a fetch
    // implementation that ignores AbortSignal. Late responses never update cache.
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error('Paddle IP timeout')); }, timeoutMs);
    });
    try {
      const addresses = await Promise.race([
        (async () => {
          const response = await fetchImpl(PADDLE_IPS_URL, {
            method: 'GET', headers: { accept: 'application/json' },
            // workerd rejects redirect:'error'. Manual mode plus the status
            // check below rejects redirects without requesting their targets.
            signal: controller.signal, redirect: 'manual',
          });
          if (!response?.ok) throw new Error(`Paddle IP HTTP ${response?.status || 'unavailable'}`);
          return addressesOf(await response.json());
        })(),
        deadline,
      ]);
      snapshot = { addresses, fetchedAt: now() };
    } catch (error) {
      // Preserve a previously validated snapshot; never cache malformed data.
      // This diagnostic contains no payload, caller IP, credentials or signature.
      console.warn('Paddle IP refresh failed:', error instanceof Error ? error.message : 'unknown');
    } finally {
      clearTimeout(timer);
    }
  }

  async function refresh(address) {
    if (inFlight) return inFlight;
    // Cold starts and known senders retry short outages after 30 seconds.
    // Unknown senders cannot force refreshes more often than every 5 minutes.
    const retry = !snapshot || snapshot.addresses.has(address) ? RETRY_MS : UNKNOWN_RETRY_MS;
    if (now() - attemptedAt < retry) return;
    attemptedAt = now();
    inFlight = fetchSnapshot().finally(() => { inFlight = null; });
    return inFlight;
  }

  return async function assertPaddleWebhookIp(request, env = {}) {
    if (env.PADDLE_ENV !== 'production') return;
    const address = ipv4(request.headers.get('cf-connecting-ip'));
    if (!address) throw new RoomError('IP_FORBIDDEN', 403);
    // Fresh lists reject unknown addresses without another network request.
    if (age() >= ttlMs) await refresh(address);
    const currentAge = age();
    if (snapshot && snapshot.addresses.has(address) && currentAge < maxStaleMs) return;
    if (snapshot && currentAge < ttlMs) throw new RoomError('IP_FORBIDDEN', 403);
    // An expired/unavailable list cannot establish whether an unknown sender
    // is newly added by Paddle. Fail closed with a retryable response instead.
    throw new RoomError('IP_UNAVAILABLE', 503);
  };
}

export const assertPaddleWebhookIp = createPaddleWebhookIpGuard();

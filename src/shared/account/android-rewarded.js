import { ClientError } from '../../online/client.js';

const METHODS = new Set(['rewardedStatus', 'rewardedShow', 'rewardedPrivacyOptions']);
const STATES = new Set(['ready', 'initializing', 'unavailable', 'privacy-required', 'blocked',
  'pending', 'skipped', 'busy', 'shown']);
const hostWindow = () => typeof window === 'undefined' ? null : window;

export function isAndroidRewardedShell(host = hostWindow()) {
  return typeof host?.MaydanRewarded?.postMessage === 'function';
}

export function createAndroidRewardedClient({ getHost = hostWindow } = {}) {
  let bridge = null;
  let counter = 0;
  const pending = new Map();

  function rejectEntry(id, error) {
    const entry = pending.get(id);
    if (!entry) return;
    pending.delete(id);
    clearTimeout(entry.timer);
    entry.signal?.removeEventListener('abort', entry.abort);
    entry.reject(error);
  }

  function receive(event) {
    let message;
    try { message = JSON.parse(event.data); }
    catch { return; }
    const entry = message && pending.get(message.id);
    if (!entry) return;
    if (!entry.isCurrent()) {
      rejectEntry(message.id, new ClientError('NOT_ELIGIBLE'));
      return;
    }
    if (message.ok !== true || !STATES.has(message.result?.state)
        || typeof message.result.presented !== 'boolean') {
      rejectEntry(message.id, new ClientError('REWARDED_UNAVAILABLE'));
      return;
    }
    pending.delete(message.id);
    clearTimeout(entry.timer);
    entry.signal?.removeEventListener('abort', entry.abort);
    entry.resolve(message.result);
  }

  function bind() {
    const next = getHost()?.MaydanRewarded;
    if (!next || typeof next.postMessage !== 'function') return null;
    if (bridge !== next) {
      if (bridge?.onmessage === receive) bridge.onmessage = null;
      for (const id of pending.keys()) rejectEntry(id, new ClientError('NOT_ELIGIBLE'));
      bridge = next;
      bridge.onmessage = receive;
    }
    return bridge;
  }

  function cancel(id) {
    const native = bridge;
    if (!native) return;
    try {
      native.postMessage(JSON.stringify({
        id: `mdn-android-${Date.now().toString(36)}-${++counter}`,
        type: 'rewardedCancel',
        targetId: id,
      }));
    } catch { /* The issuing attempt remains pending until the server reconciles it. */ }
  }

  function call(type, payload = {}, { timeout = type === 'rewardedShow' ? 180000 : 8000,
    isCurrent = () => true, signal } = {}) {
    const native = bind();
    if (!native || !METHODS.has(type) || signal?.aborted || !isCurrent()) {
      return Promise.resolve({ state: 'unavailable', presented: false });
    }
    const id = `mdn-android-${Date.now().toString(36)}-${++counter}`;
    const request = { id, type };
    if (type === 'rewardedShow') {
      Object.assign(request, {
        customData: payload.customData,
        adUnit: payload.adUnit,
        expiresAt: payload.expiresAt,
      });
    }
    return new Promise((resolve, reject) => {
      const abort = () => {
        // Do not infer an unshown ad or cancel a server attempt from a transport abort.
        cancel(id);
        rejectEntry(id, new ClientError('NOT_ELIGIBLE'));
      };
      const timer = setTimeout(() => {
        cancel(id);
        rejectEntry(id, new ClientError('REWARDED_UNAVAILABLE'));
      }, Math.max(1, Math.min(timeout, 180000)));
      pending.set(id, { resolve, reject, timer, isCurrent, signal, abort });
      signal?.addEventListener('abort', abort, { once: true });
      try { native.postMessage(JSON.stringify(request)); }
      catch { rejectEntry(id, new ClientError('REWARDED_UNAVAILABLE')); }
    });
  }

  function dispose() {
    for (const id of pending.keys()) {
      cancel(id);
      rejectEntry(id, new ClientError('NOT_ELIGIBLE'));
    }
    if (bridge?.onmessage === receive) bridge.onmessage = null;
    bridge = null;
  }

  return { call, dispose };
}

const client = createAndroidRewardedClient();
export const callAndroidRewarded = (type, payload, options) => client.call(type, payload, options);

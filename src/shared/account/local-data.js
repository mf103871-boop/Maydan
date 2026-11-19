import { configuredBuildOrigin, environmentStorageKey, ONLINE_DEVICE_KEY } from '../lib/environment.js';
import { clearAllPlatformData } from '../lib/storage.js';

export function accountStoragePrefix(apiOrigin) {
  return environmentStorageKey('maydan:account:', apiOrigin);
}

// Used by Settings and both recovery screens, including when React cannot start.
export function clearLocalDataKeepingAccount() {
  const apiOrigin = configuredBuildOrigin();
  // An opaque/file URL cannot identify the owner of a same-origin package's data.
  if (typeof __MAYDAN_ROOMS_URL__ !== 'undefined' && __MAYDAN_ROOMS_URL__ === 'same-origin' && !apiOrigin) return 0;
  return clearAllPlatformData({ apiOrigin, keep: [accountStoragePrefix(apiOrigin), ONLINE_DEVICE_KEY] });
}

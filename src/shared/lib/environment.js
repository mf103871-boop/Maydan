// API selection remains in account/api.js. These helpers only separate local
// identity data when a bundled build explicitly targets a different server.
export const PRODUCTION_API_ORIGIN = 'https://maydan-game.mf103871.workers.dev';
export const MAFIA_PREVIEW_API_ORIGIN = 'https://maydan-mafia-preview.mf103871.workers.dev';
export const ENVIRONMENT_STORAGE_PREFIX = 'maydan:environment:';

export function configuredBuildOrigin() {
  const configured = typeof __MAYDAN_ROOMS_URL__ === 'string' ? __MAYDAN_ROOMS_URL__ : '';
  if (configured !== 'same-origin') return configured;
  // Cloudflare's web build uses its served origin. Resolve the sentinel before
  // choosing keys; treating it as a host would log out old production players.
  try {
    const value = typeof location === 'undefined' ? '' : location.origin;
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) ? url.origin : '';
  } catch { return ''; }
}
export function isMafiaPreview(origin = configuredBuildOrigin()) { return origin === MAFIA_PREVIEW_API_ORIGIN; }
export function environmentStoragePrefix(origin = configuredBuildOrigin()) {
  // Old production keys and unbundled web development keep their exact names.
  // This is storage compatibility, never a network fallback to production.
  return !origin || origin === PRODUCTION_API_ORIGIN ? '' : `${ENVIRONMENT_STORAGE_PREFIX}${encodeURIComponent(origin)}:`;
}
export function environmentStorageKey(key, origin = configuredBuildOrigin()) {
  const prefix = environmentStoragePrefix(origin);
  return prefix ? `${prefix}${String(key).replace(/^maydan:/,'')}` : key;
}
export function belongsToStorageEnvironment(key, origin = configuredBuildOrigin()) {
  const prefix = environmentStoragePrefix(origin);
  if (prefix) return key.startsWith(prefix) || key.startsWith(`maydan:online:${origin}:`);
  // A production reset does not remove a preview identity or its room tokens.
  return !key.startsWith(ENVIRONMENT_STORAGE_PREFIX) && !key.startsWith(`maydan:online:${MAFIA_PREVIEW_API_ORIGIN}:`);
}

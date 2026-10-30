// Build-time prefix compression changes only packaging. The browser recreates
// the same map once, synchronously, before resolving the first media URL.
// Object input remains supported for development and standalone fixtures.
export function decodeMediaVersions(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  const versions = Object.create(null);
  if (typeof value !== 'string' || !/^p[123]\|/.test(value)) return versions;
  const compactPaths = value.startsWith('p3|'), packedHashes = !value.startsWith('p1|');
  const alphabet = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_-';
  let previous = '';
  for (const row of value.slice(3).split('|')) {
    const first = row.indexOf(':'), last = row.lastIndexOf(':');
    if (first < 1 || last <= first) continue;
    const prefix = parseInt(row.slice(0, first), 36);
    const encodedHash = row.slice(last + 1);
    if (packedHashes && !/^[0-9a-zA-Z_-]{4}$/.test(encodedHash)) continue;
    const hash = packedHashes ? [...encodedHash].reduce((n, character) => (n << 6) | alphabet.indexOf(character), 0).toString(16).padStart(6, '0') : encodedHash;
    if (!Number.isInteger(prefix) || prefix < 0 || prefix > previous.length || !/^[a-f0-9]{6}$/.test(hash)) continue;
    let suffix = row.slice(first + 1, last);
    if (compactPaths && suffix.includes('~')) {
      if (suffix.indexOf('~') !== suffix.length - 1) continue;
      suffix = suffix.slice(0, -1) + '.webp';
    }
    const key = previous.slice(0, prefix) + suffix;
    versions[key] = hash;
    previous = key;
  }
  return versions;
}
export const MEDIA_VERSIONS = decodeMediaVersions(typeof __MAYDAN_MEDIA_VERSIONS__ !== 'undefined' ? __MAYDAN_MEDIA_VERSIONS__ : {});

// Build-time prefix compression changes only packaging. The browser recreates
// the same map once, synchronously, before resolving the first media URL.
// Object input remains supported for development and standalone fixtures.
export function decodeMediaVersions(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  const versions = Object.create(null);
  if (typeof value !== 'string' || !value.startsWith('p1|')) return versions;
  let previous = '';
  for (const row of value.slice(3).split('|')) {
    const first = row.indexOf(':'), last = row.lastIndexOf(':');
    if (first < 1 || last <= first) continue;
    const prefix = parseInt(row.slice(0, first), 36), hash = row.slice(last + 1);
    if (!Number.isInteger(prefix) || prefix < 0 || prefix > previous.length || !/^[a-f0-9]{6}$/.test(hash)) continue;
    const key = previous.slice(0, prefix) + row.slice(first + 1, last);
    versions[key] = hash;
    previous = key;
  }
  return versions;
}
export const MEDIA_VERSIONS = decodeMediaVersions(typeof __MAYDAN_MEDIA_VERSIONS__ !== 'undefined' ? __MAYDAN_MEDIA_VERSIONS__ : {});

// Covers describe categories, never questions. Relative paths also work under /Maydan/.
const versions = typeof __MAYDAN_MEDIA_VERSIONS__ !== 'undefined' ? __MAYDAN_MEDIA_VERSIONS__ : {};
// Versions are per file (`folder/file`). Any cover present means covers shipped.
export const BADEEHA_COVER_VERSION = Object.keys(versions).some((key) => key.startsWith('badeeha-covers/')) ? 'per-file' : '';

export function categoryCoverSource(id, version = versions[`badeeha-covers/${id}.webp`] || '') {
  // No file fingerprint means this cover asset has not been shipped.
  if (!/^[a-z][a-z0-9]*$/.test(id || '') || !/^[a-f0-9]{6,64}$/.test(version || '')) return null;
  return `media/badeeha-covers/${id}.webp?v=${version}`;
}

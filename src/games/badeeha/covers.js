// Covers describe categories, never questions. Relative paths also work under /Maydan/.
const versions = typeof __MAYDAN_MEDIA_VERSIONS__ !== 'undefined' ? __MAYDAN_MEDIA_VERSIONS__ : {};
export const BADEEHA_COVER_VERSION = versions['badeeha-covers'] || '';

export function categoryCoverSource(id, version = BADEEHA_COVER_VERSION) {
  // No directory fingerprint means no cover assets have been shipped yet.
  if (!/^[a-z][a-z0-9]*$/.test(id || '') || !/^[a-f0-9]{8,64}$/.test(version || '')) return null;
  return `media/badeeha-covers/${id}.webp?v=${version}`;
}

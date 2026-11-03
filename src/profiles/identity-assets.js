const LEGACY_COLLECTIONS = new Set(['sahra', 'artist', 'noir', 'olive', 'starlight']);

// An unavailable new asset falls back to the existing collection, then the
// player's uploaded image/preset. This does not equip or grant anything.
export function cosmeticPosterSources(item) {
  if (!item) return [];
  const legacy = LEGACY_COLLECTIONS.has(item.collectionId) ? `/assets/plus/v1/${item.collectionId}.webp` : null;
  return [...new Set([item.posterUrl, item.assetUrl, item.fallbackAssetUrl, legacy].filter(Boolean))];
}

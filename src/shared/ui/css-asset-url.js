// A URL in a custom property is resolved where an external stylesheet consumes
// it. Anchor imported relative assets to the document before using that value,
// so hashed sheets do not request assets/brand/assets/brand/... on web or native.
export function cssAssetUrl(asset) {
  const resolved = typeof document === 'undefined' ? asset : new URL(asset, document.baseURI).href;
  return `url(${JSON.stringify(resolved)})`;
}
